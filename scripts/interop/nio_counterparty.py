#!/usr/bin/env python3
"""The independent client that has to decrypt what this application sends.

# Why this exists

Two of our own crypto machines agreeing proves only that the implementation
is self-consistent: a consistent misreading of the Matrix protocol passes
cleanly on both sides. `matrix-nio` implements its own Olm/Megolm session
lifecycle, device tracking and key-sharing decisions, in Python, written by
people who have never seen this code. If it reads what the application wrote,
the two implementations agree on the wire.

The independence is at the protocol level, not all the way down: nio 0.26
took its ratchet from `vodozemac`, which is the same crate
`matrix-sdk-crypto` uses, so a defect inside vodozemac itself would pass both
sides. Everything above it -- the `/keys/*` payloads, to-device routing, the
megolm event body -- is two independent implementations agreeing or not.
That framing is taken from the crypto library's own level 2 proof, which this
replays from the application rather than from the library.

# Three phases, and why the order is not negotiable

Megolm shares a room key with the devices that exist when the key is shared.
A counterparty that logs in *after* the application has sent cannot decrypt
anything, and would look exactly like a protocol disagreement.

So `login` runs first: it creates this device, uploads its keys, and joins the
room, which is what makes it visible to the application's own `/keys/query`.
Only then does the application run. `collect` then resumes the same device
from the same store and reads what arrived.

# Credentials

The password arrives in the environment and is read once. It is never written
to a file, never printed, and never placed on a command line where `ps` would
show it. The session file this writes carries an access token and is created
in a directory the caller supplies and removes.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from nio import (
    AsyncClient,
    AsyncClientConfig,
    LoginResponse,
    MegolmEvent,
    RoomEncryptedFile,
    RoomMessageText,
)

# What the application sends. Kept in one place on each side; if this ever
# disagrees with the application's own constant, the test fails loudly rather
# than passing on an empty match.
EXPECTED_BODY = "encrypted by the bridge, sent by the application"

# What this counterparty sends for the application to decrypt. The other
# direction of the same proof: the application reading what an independent
# implementation encrypted.
COUNTERPARTY_BODY = "encrypted by matrix-nio, for the application to read"
# Le nom EST le corps d'un `m.file`, et c'est ce que l'écran affiche. Accentué
# à dessein : un aller-retour qui ne passerait que de l'ASCII ne dirait rien
# des encodages, et c'est exactement là que deux implémentations divergent.
COUNTERPARTY_FILE_NAME = "relevé-de-nio.txt"
COUNTERPARTY_FILE_BODY = "écrit par matrix-nio, pour que l'application le lise"

SYNC_TIMEOUT_MS = 10_000
COLLECT_DEADLINE_SECONDS = 120

# How long the send phase waits for the application's account to appear as a
# joined member before it refuses to share a room key. Six syncs: the join has
# already happened by then or something else is wrong, and waiting longer only
# moves the failure further from its cause. See #234.
JOIN_DEADLINE_SECONDS = 60

# WHAT THIS COUNTERPARTY IS ENTITLED TO READ, AND WHY IT CHANGED.
#
# The application now holds a cross-signing identity, so its crypto machine
# collects room-key recipients by identity (MSC4153) instead of sharing with
# every unblacklisted device. matrix-nio has no cross-signing at all -- its
# whole surface is device-level verification -- so nothing vouches for this
# device and it receives no room key. That is the feature working, not a
# protocol disagreement.
#
# So the outbound half of the round trip cannot be proven against this
# counterparty any more, and pretending otherwise would be the one thing
# worse than losing it. What is asserted instead is the exclusion itself:
# an event from the application must arrive, and must stay encrypted. That
# still proves the application encrypted and sent -- a silent stop would
# fail it -- and it proves the recipient was excluded on purpose.
#
# The inbound half is untouched and still the real interoperability proof:
# nio encrypts, the application decrypts, and an independent implementation
# is what makes that worth something.
#
# Restoring the outbound proof needs a counterparty that does cross-signing
# and is not built on matrix-sdk-crypto, since two instances of the same
# implementation share any misreading of the protocol. That is a ticket.
EXPECT_EXCLUDED = os.environ.get("MESSAGR_INTEROP_EXPECT") == "excluded"


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} must be set")
    return value


def client_for(store: Path, user_id: str, homeserver: str, device_id=None):
    store.mkdir(parents=True, exist_ok=True)
    return AsyncClient(
        homeserver,
        user_id,
        device_id=device_id,
        store_path=str(store),
        config=AsyncClientConfig(
            store_sync_tokens=True,
            encryption_enabled=True,
        ),
    )


async def login(session_file: Path, store: Path) -> int:
    """Create this device, upload its keys, and confirm it is in the room.

    Runs before the application does, so that the application's own key
    sharing can see a device to share with.
    """
    homeserver = env("MESSAGR_INTEROP_HOMESERVER")
    user_id = env("MESSAGR_INTEROP_USER")
    room_id = env("MESSAGR_INTEROP_ROOM")

    client = client_for(store, user_id, homeserver)
    try:
        response = await client.login(
            os.environ["MESSAGR_INTEROP_PASSWORD"],
            device_name="messagr-interop-counterparty",
        )
        if not isinstance(response, LoginResponse):
            print(f"FAIL: login refused: {response}", file=sys.stderr)
            return 1

        # Membership is checked, not asked for. This account created the room
        # during provisioning, so it is already in it -- and nio's own join
        # sends no request body, which this homeserver rejects outright
        # (M_BAD_JSON, "EOF while parsing a value"). Reading the sync response
        # proves the thing that actually matters, which asking would only have
        # assumed.
        response = await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=True)
        rooms = getattr(response, "rooms", None)
        if rooms is None or room_id not in rooms.join:
            print(
                f"FAIL: this counterparty is not joined to {room_id}, so the "
                "application will never share a room key with it.",
                file=sys.stderr,
            )
            return 1

        # The keys this device is known by. Without this upload the
        # application's /keys/query finds a device with nothing to encrypt to,
        # and skips it silently.
        if client.should_upload_keys:
            await client.keys_upload()

        session_file.write_text(
            json.dumps(
                {
                    "user_id": client.user_id,
                    "device_id": client.device_id,
                    "access_token": client.access_token,
                }
            )
        )
        session_file.chmod(0o600)
        print(f"OK: counterparty is {client.device_id}, in {room_id}")
        return 0
    finally:
        await client.close()


async def collect(session_file: Path, store: Path) -> int:
    """Resume the same device and read what the application sent.

    Two things here are not obvious and both are taken from the crypto
    library's own counterparty, which is known to work.

    The events are read from the **sync response**, not from the room object:
    nio's `MatrixRoom` has no timeline attribute at all, and a loop over one
    finds nothing forever.

    An event that is still a `MegolmEvent` after the sync that carried it is
    retried on every later round, because the room key can arrive in a later
    sync than the message it unlocks, and a sync token only advances
    forwards: an event consumed by one round is never offered again. Without
    the retry, a key that is merely late is indistinguishable from one that
    never came.
    """
    homeserver = env("MESSAGR_INTEROP_HOMESERVER")
    room_id = env("MESSAGR_INTEROP_ROOM")
    sender = env("MESSAGR_INTEROP_SENDER")

    session = json.loads(session_file.read_text())
    client = client_for(
        store, session["user_id"], homeserver, device_id=session["device_id"]
    )
    try:
        client.restore_login(
            user_id=session["user_id"],
            device_id=session["device_id"],
            access_token=session["access_token"],
        )

        pending = {}
        reasons = {}
        decrypted_bodies = []
        files_seen = []
        # Every sender seen in the room, whether or not it is the one being
        # waited for. A filter that drops what it rejects can only ever report
        # an absence, and "nothing arrived" reads identically whether nothing
        # was sent or the wrong account was named -- which costs a whole run
        # to tell apart. This is what makes the two distinguishable.
        seen_senders: dict[str, int] = {}
        deadline = asyncio.get_event_loop().time() + COLLECT_DEADLINE_SECONDS

        while asyncio.get_event_loop().time() < deadline:
            response = await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=False)

            rooms = getattr(response, "rooms", None)
            if rooms is not None and room_id in rooms.join:
                for event in rooms.join[room_id].timeline.events:
                    origin = getattr(event, "sender", None)
                    if origin is not None:
                        seen_senders[origin] = seen_senders.get(origin, 0) + 1
                    if origin != sender:
                        continue
                    if isinstance(event, MegolmEvent):
                        pending[event.event_id] = event
                    elif isinstance(event, RoomMessageText):
                        decrypted_bodies.append(event.body)
                    elif isinstance(event, RoomEncryptedFile):
                        files_seen.append(event.body)

            for event_id, event in list(pending.items()):
                try:
                    plain = client.decrypt_event(event)
                except Exception as error:  # noqa: BLE001 -- reported, not handled
                    reasons[event_id] = f"{type(error).__name__}: {error}"
                    continue
                pending.pop(event_id)
                if isinstance(plain, RoomMessageText):
                    decrypted_bodies.append(plain.body)
                # UN `m.file` NE TOMBE PLUS PAR TERRE EN SILENCE.
                #
                # Cette branche n'existait pas : un fichier arrivant ici était
                # déchiffré, n'était pas un `RoomMessageText`, et disparaissait
                # sans que rien ne le signale. Le relevé d'audit de #111 l'a
                # nommé — « un `m.file` arrivant chez elle tomberait par terre
                # sans que rien ne le signale » — et c'est la forme de silence
                # que ce dépôt collectionne.
                #
                # Il est retenu même quand personne ne l'attend : le compter
                # est ce qui rend visible un envoi que la suite n'avait pas
                # prévu, plutôt que de le confondre avec une absence.
                elif isinstance(plain, RoomEncryptedFile):
                    files_seen.append(plain.body)

            # CE QU'UN FICHIER A DONNÉ, DIT PLUTÔT QUE TU. Rien n'en
            # dépend aujourd'hui : la suite envoie du texte. Mais un `m.file`
            # qui arrive ici et qu'on ne nomme pas est une mesure perdue, et
            # c'est le silence que l'audit de #111 a reproché à ce banc.
            if files_seen:
                print(f"files: {len(files_seen)} — {', '.join(files_seen)}")

            # Decryption first, body second, and reported apart. A body that
            # drifted from the application's own constant is a different
            # failure from a key that never arrived, and saying so is the
            # difference between fixing a string and hunting a protocol bug.
            if decrypted_bodies and EXPECT_EXCLUDED:
                print(
                    "FAIL: this device decrypted the application's message, "
                    "and it should not have been able to.\n"
                    "      Nothing vouches for it, so identity-based sharing "
                    "should have excluded it.\n"
                    "      Either the application has no identity, or it fell "
                    "back to sharing by device.",
                    file=sys.stderr,
                )
                return 1

            if decrypted_bodies:
                if EXPECTED_BODY in decrypted_bodies:
                    print(
                        "OK: the counterparty decrypted the application's message"
                    )
                    return 0
                print(
                    "FAIL: decryption worked, but no message said what was "
                    f"expected.\n      expected: {EXPECTED_BODY!r}\n"
                    f"      decrypted: {decrypted_bodies!r}\n"
                    "      The two sides' message constants have drifted; the "
                    "cryptography is fine.",
                    file=sys.stderr,
                )
                return 1

        if pending:
            if EXPECT_EXCLUDED:
                print(
                    "OK: the application's message arrived and stayed "
                    f"encrypted ({len(pending)} event(s) from {sender}). "
                    "No identity vouches for this device, so it was given no "
                    "room key -- which is what identity-based sharing is for."
                )
                return 0
            print(
                f"FAIL: {len(pending)} event(s) from {sender} stayed encrypted "
                f"for {COLLECT_DEADLINE_SECONDS}s.\n"
                f"      The room key never reached this device.\n"
                f"      last errors: {reasons}",
                file=sys.stderr,
            )
        else:
            others = {who: n for who, n in seen_senders.items() if who != sender}
            print(
                f"FAIL: nothing from {sender} arrived in {room_id} within "
                f"{COLLECT_DEADLINE_SECONDS}s.\n"
                f"      senders actually seen: {seen_senders or 'none'}\n"
                + (
                    "      The room was not silent, so this is more likely the "
                    "wrong account\n      than a send that never happened: "
                    f"{sorted(others)} did send.\n"
                    if others
                    else "      The room was silent: the application did not "
                    "send.\n"
                ),
                file=sys.stderr,
            )
        return 1
    finally:
        await client.close()


async def _send_with(session_file: Path, store: Path, make_content) -> int:
    """Encrypt something for the application to read.

    PARAMETERISED RATHER THAN DUPLICATED. Everything before the send is the
    same for a message and for a file -- the full-state sync, the key query,
    the group session shared on purpose so that "the key could not be shared"
    stays distinct from "the send was refused". Copying a hundred lines to
    change one dictionary is how the two halves drift apart, and the one
    nobody runs is the one that rots.

    Runs after the application has published its keys, not before: Megolm
    shares with the devices that exist and have keys at share time, and the
    application's device has none until it has run once.
    """
    homeserver = env("MESSAGR_INTEROP_HOMESERVER")
    room_id = env("MESSAGR_INTEROP_ROOM")

    session = json.loads(session_file.read_text())
    client = client_for(
        store, session["user_id"], homeserver, device_id=session["device_id"]
    )
    try:
        client.restore_login(
            user_id=session["user_id"],
            device_id=session["device_id"],
            access_token=session["access_token"],
        )

        # Sync first: nio decides whether to encrypt from the room state it
        # holds, and a client that has not seen m.room.encryption sends
        # plaintext without complaining.
        #
        # full_state is load-bearing, not caution. The store carries a sync
        # token from the login phase, so an incremental sync returns no
        # membership at all -- and share_group_session_parallel then shares
        # with the empty set, silently, leaving a message nobody can read.
        await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=True)

        room = client.rooms.get(room_id)
        if room is None:
            print(f"FAIL: {room_id} is not a room this account is in", file=sys.stderr)
            return 1
        if not room.encrypted:
            print(
                f"FAIL: {room_id} is not marked encrypted, so anything sent "
                "here would go out in plaintext.",
                file=sys.stderr,
            )
            return 1

        # THE MEMBER THIS IS FOR, SEEN JOINED BEFORE ANY KEY IS SHARED.
        #
        # #234, measured on run 34615662123 attempt 1: the application had
        # fifty one-time keys on the server and a published identity, this
        # phase printed an event id, and the application reported
        # `MESSAGR_UNREADABLE` for that very event on each of its four
        # launches. So the ciphertext arrived and the room key did not, which
        # no shortage of one-time keys explains. What explains it is sharing
        # with a set the application was not in.
        #
        # Megolm shares with the devices of the members THIS client has
        # synced. `room.users` is the joined set and `room.invited_users` is
        # not part of it, so an account whose join has not reached this sync
        # is an account this share cannot reach -- silently, because there is
        # nothing wrong with sharing a key with everyone you can see.
        reader = env("MESSAGR_INTEROP_SENDER")
        # The clock and not a count of syncs: a sync that has something to say
        # returns at once, so counting them would give up after a second.
        deadline = asyncio.get_event_loop().time() + JOIN_DEADLINE_SECONDS
        while (
            reader not in room.users
            and asyncio.get_event_loop().time() < deadline
        ):
            await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=True)
            room = client.rooms.get(room_id) or room
        if reader not in room.users:
            print(
                f"FAIL: {reader} has not been seen joining {room_id} after "
                f"{JOIN_DEADLINE_SECONDS:.0f}s. A room key shared now would "
                "not reach it, and the message would arrive unreadable a "
                "hundred seconds later, naming nothing. See #234.",
                file=sys.stderr,
            )
            return 1

        # AND ITS DEVICES, ASKED FOR RATHER THAN WAITED FOR.
        #
        # `should_query_keys` is true only once the server has told this
        # client that something changed. A device-list notification that has
        # not arrived yet is indistinguishable from nothing having changed --
        # and the application creates its device AFTER this counterparty
        # logged in, which is the order the workflow deliberately imposes.
        # Asking costs one request. Not asking costs a hundred seconds, four
        # launches, and a run that reads as a protocol disagreement.
        client.olm.add_changed_users({reader})
        await client.keys_query()

        devices = [
            device.id for device in client.device_store.active_user_devices(reader)
        ]
        if not devices:
            print(
                f"FAIL: the server names no device for {reader}, so there is "
                "nothing to share a room key with. See #234.",
                file=sys.stderr,
            )
            return 1
        print(f"sharing with {reader}: {len(devices)} device(s), {', '.join(devices)}")
        # room_send shares the group session itself when it has to. Doing it
        # here as well is deliberate: it separates "the key could not be
        # shared" from "the send was refused", which the combined call
        # reports as one failure.
        if client.olm.should_share_group_session(room_id):
            await client.share_group_session(
                room_id, ignore_unverified_devices=True
            )

        response = await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content=await make_content(client),
            ignore_unverified_devices=True,
        )
        event_id = getattr(response, "event_id", None)
        if event_id is None:
            print(f"FAIL: the send was refused: {response}", file=sys.stderr)
            return 1

        print(f"OK: the counterparty sent an encrypted message ({event_id})")
        return 0
    finally:
        await client.close()


async def send(session_file: Path, store: Path) -> int:
    """A text message, which is what this proof has always carried."""

    async def text(_client):
        return {"msgtype": "m.text", "body": COUNTERPARTY_BODY}

    return await _send_with(session_file, store, text)


async def send_file(session_file: Path, store: Path) -> int:
    """An `m.file` from an independent client, for the application to read.

    # WHY THIS PHASE EXISTS

    #111 asks that a document "arrive as an `m.file` another Matrix client
    would recognise". Until now nothing in this repository established that:
    the only test on the question asserts `msgtype == "m.file"` and the shape
    of `info`, which is Messagr reading itself.

    This is the mirror half, and the one a continuous-integration run can
    actually prove: an independent implementation writes the event, and the
    application reads it. The other direction -- Messagr's own `m.file` read
    by nio -- needs the application to attach a document, and the emulator
    opens no file picker at all. `collect` below is nevertheless taught to
    recognise one, so the day a device suite can send a file, the proof is a
    line of assertion rather than a piece of work.

    # THE ENCRYPTION IS NIO'S, AND THAT IS THE POINT

    `encrypt_attachment` builds the key, the IV and the hashes on its side,
    and this event carries them exactly as the specification says. If
    Messagr's `EncryptedFile` reader disagrees on one field name, one base64
    variant or one hash, this is where it shows -- which is a claim no test
    written inside Messagr can make about itself.
    """
    from nio.crypto import attachments

    async def uploaded(client):
        plaintext = COUNTERPARTY_FILE_BODY.encode("utf-8")
        ciphertext, keys = attachments.encrypt_attachment(plaintext)

        response, _ = await client.upload(
            lambda *_: ciphertext,
            content_type="application/octet-stream",
            filename=None,
            encrypt=False,
            filesize=len(ciphertext),
        )
        url = getattr(response, "content_uri", None)
        if url is None:
            raise RuntimeError(f"the upload was refused: {response}")

        # THE NAME IS THE BODY, which is the inversion `fileEvent.ts` argues
        # on the other side: for a photograph the body is a description, for
        # a file it is the filename itself.
        return {
            "msgtype": "m.file",
            "body": COUNTERPARTY_FILE_NAME,
            "info": {
                "mimetype": "text/plain",
                "size": len(plaintext),
            },
            "file": {
                "url": url,
                "mimetype": "text/plain",
                **keys,
            },
        }

    return await _send_with(session_file, store, uploaded)


def main() -> int:
    phases = {
        "login": login,
        "send": send,
        "send-file": send_file,
        "collect": collect,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in phases:
        print("usage: nio_counterparty.py login|send|collect", file=sys.stderr)
        return 2

    work = Path(env("MESSAGR_INTEROP_WORKDIR"))
    session_file = work / "counterparty-session.json"
    store = work / "store"

    return asyncio.run(phases[sys.argv[1]](session_file, store))


if __name__ == "__main__":
    raise SystemExit(main())
