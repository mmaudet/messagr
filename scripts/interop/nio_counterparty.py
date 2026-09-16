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

import aiohttp
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

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

# RÉCLAMER À NOUVEAU TANT QUE LE SERVICE RÉPOND « PAS ENCORE INVITÉ », ET
# PENDANT COMBIEN DE TEMPS.
#
# Sur le chemin `existing_user_id`, `409 MESSAGR_NOT_YET_INVITED` est une
# étape du protocole et non un refus : voir `claim_place`. Les invitations
# Matrix que le service attend viennent du client de l'inviteur, et
# l'application ne les envoie que pendant sa fenêtre d'admission :
# `admitDrawnEntrant` interroge l'état de l'invitation trente fois, à deux
# secondes d'écart, soit une minute au moins.
#
# QUAND CETTE FENÊTRE S'OUVRE. `App.tsx` affiche le lien, rafraîchit la
# liste, puis appelle `admitEntrant`. La première réclamation ne part
# qu'après que Detox a lu le lien, et Detox attend pour le lire que le
# réseau de l'application soit calme. Sur le run 34721727472 : requêtes de
# la liste finies à 22:25:30.39, lien capturé à 22:25:31.19, premier 409
# reçu à 22:25:32.55. Les interrogations du service ne sont pas
# journalisées, donc le départ de la fenêtre est borné et non lu : elle
# s'ouvre environ deux secondes avant la première réclamation.
#
# Quarante-cinq secondes de réclamations tiennent donc dans cette minute,
# avec plus de dix secondes de marge. Le protocole en demande bien moins :
# au moins trois réclamations, entre lesquelles l'application interroge
# deux fois, soit une dizaine de secondes.
CLAIM_DEADLINE_SECONDS = 45
CLAIM_PAUSE_SECONDS = 2
CLAIM_REQUEST_SECONDS = 20
NOT_YET_INVITED = "MESSAGR_NOT_YET_INVITED"

# TOUTE LA PHASE FINIT AVANT QUE LE HARNAIS NE LA TUE.
#
# `runCounterparty` (roundTrip.test.ts) accorde 120 secondes au processus
# entier. Un processus tué n'imprime rien de ce qu'il savait, et l'appelant
# ne lit que « Command failed » : l'échec sans cause que ce fichier refuse
# partout ailleurs. L'attente de l'invitation durait jusqu'ici 120 secondes
# à elle seule, après la réclamation.
#
# Réclamer finit au plus tard à 45 + 20 = 65 secondes. Attendre
# l'invitation ne lance une synchronisation que s'il reste, avant 100
# secondes comptées depuis le début de la phase, de quoi la finir et
# rejoindre. Les 20 secondes restantes couvrent le démarrage de
# l'interpréteur.
PLACE_DEADLINE_SECONDS = 100
HOMESERVER_REQUEST_SECONDS = 10

# COMBIEN DE TEMPS LE TÉMOIN ATTEND DE VOIR SON PROPRE RETRAIT.
#
# Le retrait est un changement d'état posé par l'application ; il est visible
# dès que le homeserver l'a écrit. L'attente ne couvre donc pas une lenteur de
# protocole, elle couvre le trajet entre le toucher de Detox et cette phase.
# Bornée, parce qu'un retrait qui n'arrive pas est un défaut du produit et doit
# se lire comme tel, pas comme une phase qui pend.
WITNESS_DEADLINE_SECONDS = 60

# Combien d'événements le témoin remonte pour trouver son propre retrait. La
# conversation vient de naître : elle en compte une dizaine. Cent laisse de la
# marge sans jamais paginer, et une pagination silencieuse est ce qui ferait
# lire « rien après le retrait » sur une fenêtre trop courte pour le dire.
WITNESS_EVENTS = 100

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


def errcode_of(body: str) -> str | None:
    """Le `errcode` d'une réponse du service, ou None quand elle n'en porte pas."""
    try:
        parsed = json.loads(body)
    except ValueError:
        return None
    return parsed.get("errcode") if isinstance(parsed, dict) else None


async def claim_place(session_file: Path, store: Path) -> int:
    """Réclamer une invitation émise par l'application, avec CETTE identité.

    # POURQUOI UN COMPTE EXISTANT PLUTÔT QU'UN COMPTE NEUF

    `ClaimRequest` porte `existing_user_id`, et c'est ce chemin-là qui sert
    ici : la contrepartie a déjà une identité, des clés publiées et une
    signature croisée. Lui faire tirer un compte réservé donnerait un
    troisième inconnu, et la preuve que #35 demande — « prouvée avec un
    client indépendant plutôt qu'avec le nôtre » — perdrait ce qui la rend
    indépendante.

    # CE QUE CETTE PHASE NE FAIT PAS

    Elle n'envoie aucune invitation. Le service place la demande ; c'est le
    client de l'INVITEUR -- l'application -- qui lit l'état et envoie
    l'invitation Matrix, parce qu'un compte réservé ne peut pas inviter dans
    un salon dont le niveau « invite » est à 50. La migration 008 raconte
    cette contrainte au long.

    Elle n'ouvre pas non plus le magasin de nio, et ne se sert pas de son
    `join` : l'attente de l'invitation, plus bas, dit pourquoi.

    # TROIS RÉCLAMATIONS AU MOINS, ET LES DEUX PREMIÈRES RÉPONDENT 409

    Lu dans `claim.rs` et `status.rs`, pas supposé. Sur ce chemin, le service
    attend DEUX invitations Matrix, et l'application envoie les deux :

    1. La première réclamation tire un compte réservé pour ce lien. Personne
       ne l'a invité : `409 MESSAGR_NOT_YET_INVITED`. L'état de l'invitation
       le nomme, et l'application l'invite.
    2. Une fois ce compte invité, la réclamation suivante le fait entrer
       dans le salon et tenter d'y inviter la contrepartie. Il n'a pas le
       niveau : 403. Le service note la contrepartie comme attendue et
       répond encore 409. L'état la nomme alors avant le compte tiré, et
       l'application l'invite.
    3. La réclamation suivante trouve la contrepartie déjà invitée : le
       compte tiré se retire et se neutralise, et le service répond 200.

    Une réclamation unique ne pouvait donc qu'échouer, et c'est ce qu'elle
    faisait. `provision-bench-accounts.sh` décrit la même attente pour un
    nouveau venu, dont le chemin s'arrête à la deuxième réclamation.

    Réclamer à nouveau ne coûte rien au service : `account_for_claim`
    reprend le compte déjà tiré au lieu d'en créer un autre. Et seul
    `MESSAGR_NOT_YET_INVITED` se réclame à nouveau. Tout autre refus sort
    tout de suite : le reposer serait poser une question déjà répondue, et
    l'attendre derrière une échéance le ferait lire quarante-cinq secondes
    plus tard, sous le nom de l'échéance au lieu du sien.

    Alors cette phase réclame jusqu'à ce que le service réponde 200, puis
    attend d'être invitée, puis rejoint. Chaque attente est bornée : une
    invitation qui n'arrive pas est un défaut du produit et doit se lire
    comme tel, pas comme une phase qui pend.
    """
    homeserver = env("MESSAGR_INTEROP_HOMESERVER")
    # LE SERVICE EST DONNÉ, PAS DEVINÉ.
    #
    # Cette ligne construisait `{homeserver}/_messagr`, ce qui est le défaut
    # de `provision-bench-accounts.sh` et non sa valeur : un banc qui pose
    # `MESSAGR_BENCH_SERVICE` met le service ailleurs, et les deux
    # dérivations d'une même chose finissent par diverger.
    #
    # Ce n'était PAS la cause du 401 -- voir l'en-tête plus bas. La valeur
    # voyage quand même, parce qu'une duplication qui n'a pas encore mordu
    # reste une duplication.
    service = os.environ.get("MESSAGR_INTEROP_SERVICE") or f"{homeserver}/_messagr"
    token = env("MESSAGR_INTEROP_CLAIM_TOKEN")

    session = json.loads(session_file.read_text())
    user_id = session["user_id"]

    clock = asyncio.get_running_loop()
    started = clock.time()
    deadline = started + CLAIM_DEADLINE_SECONDS
    attempts = 0
    last = "none"

    async with aiohttp.ClientSession() as http:
        while True:
            attempts += 1
            try:
                async with http.post(
                    f"{service}/invitations/claim",
                    json={"token": token, "existing_user_id": user_id},
                    # AUTHENTIFIÉ, ET LE SERVICE DIT POURQUOI À CET ENDROIT PRÉCIS.
                    #
                    # `POST /invitations/claim` ne l'est pas : c'est le principe
                    # même d'accueillir un nouveau venu. Mais sur le chemin
                    # `existing_user_id`, l'appelant désigne un TIERS, et
                    # `claim.rs` refuse sans preuve qu'il est bien cette
                    # personne -- sans quoi n'importe qui ferait inviter un
                    # identifiant Matrix arbitraire dans un vrai salon, ce qui
                    # est irréversible.
                    #
                    # La contrepartie prouve donc qu'elle est `existing_user_id`
                    # avec le jeton de sa propre session. Le service compare, et
                    # refuse si les deux diffèrent.
                    headers={"Authorization": f"Bearer {session['access_token']}"},
                    timeout=aiohttp.ClientTimeout(total=CLAIM_REQUEST_SECONDS),
                ) as response:
                    status = response.status
                    body = await response.text()
            except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                print(
                    f"FAIL: claim {attempts} got no answer, "
                    f"{clock.time() - started:.1f}s in "
                    f"({type(error).__name__}: {error}).\n"
                    f"      last answer before it: {last}",
                    file=sys.stderr,
                )
                return 1

            elapsed = clock.time() - started
            errcode = errcode_of(body)
            last = f"{status} {errcode}" if errcode else f"{status} {body[:200]!r}"
            if status == 200:
                break

            # LE SEUL REFUS QUI SE RÉCLAME À NOUVEAU. Le docstring dit
            # pourquoi ; ici, tout le reste sort avec le corps tel quel.
            if status != 409 or errcode != NOT_YET_INVITED:
                print(
                    f"FAIL: the claim was refused ({status}) on attempt "
                    f"{attempts}, {elapsed:.1f}s in: {body}",
                    file=sys.stderr,
                )
                return 1

            if clock.time() + CLAIM_PAUSE_SECONDS > deadline:
                print(
                    f"FAIL: no place after {attempts} claims over "
                    f"{elapsed:.1f}s; last answer: {last}.\n"
                    f"      Every answer was {NOT_YET_INVITED}: the Matrix "
                    "invitation the service waits for was not there when it "
                    "looked.\n"
                    "      On this path it waits for two, both sent by the "
                    "inviter's client -- the application, in the minute it\n"
                    "      spends admitting after showing the link "
                    "(admitDrawnEntrant): one for the account the service\n"
                    "      drew for this link, then one for this account.",
                    file=sys.stderr,
                )
                return 1

            print(
                f"claim {attempts}: {last}, {elapsed:.1f}s in; "
                f"claiming again in {CLAIM_PAUSE_SECONDS}s"
            )
            await asyncio.sleep(CLAIM_PAUSE_SECONDS)

        print(
            f"OK: {user_id} claimed the application's invitation "
            f"on attempt {attempts}, {elapsed:.1f}s in"
        )

        # ATTENDRE L'INVITATION, PUIS REJOINDRE, SANS nio. Deux raisons, et
        # toutes deux sont déjà écrites dans ce dépôt.
        #
        # LE `join` DE nio N'ENVOIE AUCUN CORPS. Dans nio 0.26, `Api.join`
        # rend une méthode et un chemin, rien d'autre, et ce homeserver le
        # refuse : « M_BAD_JSON deserialization failed: EOF while parsing a
        # value », mesuré au premier run de cette contrepartie (27a4c0e) et
        # rappelé dans `login` plus haut. Le service rejoint avec `{}`
        # (`join_room`, dans `matrix.rs`) ; cette phase fait de même.
        #
        # UNE SYNCHRONISATION nio AVANCERAIT LE JETON QUE `collect` REPREND.
        # Le magasin est partagé entre les phases : `store_sync_tokens`
        # enregistre le jeton à chaque réponse, et le `sync` suivant repart de
        # lui. `collect` tourne après la suite et lit ce que l'application a
        # envoyé dans le salon du banc. Aucune relance ne suit cette phase,
        # donc le dernier message de l'application passerait derrière le
        # jeton, et `collect` conclurait à un salon muet. Une synchronisation
        # sans `since`, avec le jeton d'accès, n'avance rien : c'est ainsi que
        # le service trouve le salon d'un compte tiré (`pending_invite_room`).
        bearer = {"Authorization": f"Bearer {session['access_token']}"}
        place_deadline = started + PLACE_DEADLINE_SECONDS
        syncs = 0
        invited: list[str] = []
        while clock.time() + 2 * HOMESERVER_REQUEST_SECONDS <= place_deadline:
            syncs += 1
            try:
                async with http.get(
                    f"{homeserver}/_matrix/client/v3/sync",
                    params={"timeout": "0"},
                    headers=bearer,
                    timeout=aiohttp.ClientTimeout(total=HOMESERVER_REQUEST_SECONDS),
                ) as response:
                    status = response.status
                    body = await response.text()
            except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                print(
                    f"FAIL: sync {syncs} got no answer, "
                    f"{clock.time() - started:.1f}s in "
                    f"({type(error).__name__}: {error})",
                    file=sys.stderr,
                )
                return 1
            if status != 200:
                print(f"FAIL: the sync was refused ({status}): {body}", file=sys.stderr)
                return 1
            rooms = json.loads(body).get("rooms") or {}
            invited = sorted(rooms.get("invite") or {})
            if invited:
                break
            await asyncio.sleep(CLAIM_PAUSE_SECONDS)

        if not invited:
            print(
                "FAIL: the claim succeeded, and no Matrix invitation was "
                f"visible to {user_id} after {syncs} sync(s), "
                f"{clock.time() - started:.1f}s into this phase.\n"
                "      On this path the service answers 200 only once this "
                "account is invited or joined.",
                file=sys.stderr,
            )
            return 1

        room_id = invited[0]
        try:
            async with http.post(
                f"{homeserver}/_matrix/client/v3/join/{quote(room_id, safe='!')}",
                json={},
                headers=bearer,
                timeout=aiohttp.ClientTimeout(total=HOMESERVER_REQUEST_SECONDS),
            ) as response:
                status = response.status
                body = await response.text()
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            print(
                f"FAIL: the join of {room_id} got no answer "
                f"({type(error).__name__}: {error})",
                file=sys.stderr,
            )
            return 1
        if status != 200:
            print(
                f"FAIL: the join of {room_id} was refused ({status}): {body}",
                file=sys.stderr,
            )
            return 1

    # LE SALON REJOINT VOYAGE JUSQU'AU TEST, PARCE QUE LUI SEUL LE CONNAÎT.
    #
    # `roundTrip.test.ts` doit ouvrir CETTE conversation, et la liste de
    # l'application ne la met pas en tête : elle trie par dernière activité, et
    # rien n'y a encore été dit. Son identifiant naît avec l'invitation, donc
    # ni le test ni l'écran ne le connaissent d'avance ; la contrepartie vient
    # de le rejoindre. Il est écrit à côté du fichier de session, dans le
    # dossier que l'appelant fournit et supprime.
    session_file.with_name("claimed-room").write_text(room_id)
    also = f"; also invited to {', '.join(invited[1:])}" if invited[1:] else ""
    print(f"OK: joined {room_id} on the application's invitation{also}")
    return 0


def departure_of(events: list, who: str):
    """Le rang du dernier événement qui fait sortir `who`, ou None.

    Le DERNIER, pas le premier : une contrepartie peut avoir été invitée,
    entrée, sortie et réinvitée dans la même fenêtre, et c'est la sortie la
    plus récente qui décide de l'état où le salon se trouve maintenant.
    """
    found = None
    for rank, event in enumerate(events):
        if (
            event.get("type") == "m.room.member"
            and event.get("state_key") == who
            and (event.get("content") or {}).get("membership") == "leave"
        ):
            found = rank
    return found


def inventory(events: list) -> str:
    """Ce qu'une liste d'événements contient, pour qu'un échec le nomme.

    Un échec qui dit « rien ne t'en retire » sans dire ce qu'il a lu envoie
    chercher un défaut du produit là où il y a une fenêtre mal demandée. C'est
    ce qui a coûté le run 35094474747.
    """
    counted: dict = {}
    for event in events:
        key = f"{event.get('type')} from {event.get('sender')}"
        counted[key] = counted.get(key, 0) + 1
    return ", ".join(f"{n}x {key}" for key, n in sorted(counted.items())) or "nothing"


async def witness_eviction(session_file: Path, store: Path) -> int:
    """Constater son propre retrait, du dehors, et ce qu'il ferme.

    # LE JUGE NE DOIT PAS ÊTRE LE JUGE

    Après l'éviction, l'application affiche « la clé a tourné ». C'est son
    propre témoignage, et #35 demande mieux : « prouvée avec un client
    indépendant plutôt qu'avec le nôtre ». Cette phase est ce client-là. Elle
    interroge le homeserver avec la session de la contrepartie, une
    implémentation qui n'a rien de commun avec l'application, et ne croit rien
    de ce que l'écran a dit.

    # OÙ ELLE REGARDE, ET CE QUE LE VRAI HOMESERVER A APPRIS

    **`from` n'est pas facultatif en pratique.** La spécification le dit
    facultatif depuis la v1.3, et annonce qu'un serveur sans `from` repart du
    dernier événement visible quand `dir=b`. Mesuré sur le banc, run Device
    35094474747 : `/messages?dir=b&limit=100` sans `from` a rendu **un seul
    événement**, vingt-trois fois de suite, sur un salon qui en comptait une
    dizaine et où le retrait avait bel et bien eu lieu -- l'écran de
    l'application montrait `evict-outcome-rotated`. Continuwuity repart donc
    du PREMIER événement du salon, et remonter en arrière depuis le premier ne
    rend que lui. La phase a conclu « la contrepartie est encore membre » sur
    une fenêtre mal demandée, ce qui est le genre d'erreur que ce dépôt
    collectionne : une mesure qui accuse le produit.

    Le jeton vient donc d'un `/sync`, et n'est plus supposé. La même réponse
    sert deux fois : elle dit l'appartenance -- le salon est dans `join`, dans
    `leave` ou nulle part -- et elle donne le `next_batch` d'où `/messages`
    repart en arrière. Les deux lectures sont tentées à chaque tour, et la
    première qui porte le retrait l'emporte ; un homeserver qui n'honorerait
    pas `include_leave` ne fait donc pas échouer la phase.

    Et c'est de l'HTTP nu, sans nio : le magasin est partagé entre les phases
    et `store_sync_tokens` fait avancer le jeton à chaque réponse, de sorte
    qu'une synchronisation nio ici ferait passer derrière lui ce que `collect`
    doit encore lire. Un `/sync` sans `since` sur le jeton d'accès n'avance
    rien ; `claim_place` note la même chose.

    # CE QU'ELLE ÉTABLIT

    1. Le retrait a bien eu lieu, et c'est un RETRAIT : l'événement
       d'appartenance de cette contrepartie dit `leave`, et il est posé par le
       compte de l'application. Une contrepartie partie d'elle-même
       ressemblerait à une éviction réussie et n'en serait pas une.
    2. Ce que l'application a écrit dans ce salon avant l'éviction est arrivé
       CHIFFRÉ, avec un identifiant de session Megolm. Un salon où elle
       écrirait en clair passerait toutes les assertions de rotation du monde
       sans que la rotation serve à rien.
    3. Rien de l'application n'est visible après le retrait. Le test envoie un
       message APRÈS l'éviction, exprès : sans lui, « la personne retirée ne
       lit pas la suite » serait une garde qui fabrique son entrée, vraie
       parce qu'il n'y a pas de suite. Il y en a une, et elle n'arrive pas
       ici.

    # CE QU'ELLE N'ÉTABLIT PAS, ET IL FAUT LE DIRE ICI

    **Elle ne prouve pas la rotation de la clé.** Sur ce banc, elle ne le peut
    pas, et l'écrire serait pire que de ne pas le faire.

    L'application tient une identité signée et partage ses clés de salon par
    identité (MSC4153) ; matrix-nio n'a aucune signature croisée, donc rien ne
    répond pour cet appareil et l'application ne lui a JAMAIS donné de clé de
    salon -- c'est ce que `collect` assert, sous
    `MESSAGR_INTEROP_EXPECT=excluded`. « Un message envoyé après l'éviction
    n'est plus lisible de son côté » est donc déjà vrai avant l'éviction :
    l'assertion passerait sur une rotation qui n'a pas eu lieu, ce qui est
    exactement le défaut de #276 déplacé d'un cran.

    Et la rotation se lit dans l'identifiant de session Megolm du message
    SUIVANT, que seul un membre du salon voit. Une partie retirée n'en est
    plus un ; le salon ne compte que deux comptes, celui de l'application et
    celui-ci ; et le jeton du banc est un jeton d'inscription, pas
    d'administration. Il n'existe donc, aujourd'hui, aucun témoin qui reste
    dans le salon après l'éviction.

    Ce qu'il faudrait : une contrepartie qui fasse de la signature croisée et
    qui ne soit pas bâtie sur `matrix-sdk-crypto`. La même qui manque pour
    rendre l'autre moitié de l'aller-retour (voir `EXPECT_EXCLUDED`). Elle
    tiendrait une clé de l'application, et « ce qui vient après ne s'ouvre
    plus avec » deviendrait une assertion de deux lignes. C'est un ticket, pas
    une ligne à écrire ici.

    L'identifiant de session d'avant l'éviction est donc IMPRIMÉ plutôt
    qu'asserté : le jour où ce témoin peut voir le message d'après, la
    comparaison est écrite.
    """
    homeserver = env("MESSAGR_INTEROP_HOMESERVER")
    application = env("MESSAGR_INTEROP_SENDER")

    # Le salon que `claim-place` a rejoint. Personne d'autre ne le connaît : il
    # naît avec l'invitation que l'application vient d'émettre.
    room_file = session_file.with_name("claimed-room")
    if not room_file.exists():
        print(
            "FAIL: no claimed-room beside the session file, so there is no "
            "conversation to witness.\n"
            "      `claim-place` writes it when it joins; this phase runs "
            "after the eviction, in the same workdir.",
            file=sys.stderr,
        )
        return 1
    room_id = room_file.read_text().strip()
    if not room_id:
        print("FAIL: claimed-room is empty", file=sys.stderr)
        return 1

    session = json.loads(session_file.read_text())
    user_id = session["user_id"]
    bearer = {"Authorization": f"Bearer {session['access_token']}"}
    sync_url = f"{homeserver}/_matrix/client/v3/sync"
    messages_url = (
        f"{homeserver}/_matrix/client/v3/rooms/"
        f"{quote(room_id, safe='!')}/messages"
    )
    leaving = json.dumps(
        {"room": {"include_leave": True, "timeline": {"limit": WITNESS_EVENTS}}}
    )

    clock = asyncio.get_running_loop()
    started = clock.time()
    deadline = started + WITNESS_DEADLINE_SECONDS
    looks = 0
    where = "nowhere"
    counts: dict = {}
    history: list = []
    source = "nothing was read"
    reading = "not asked"
    kick_at = None

    async with aiohttp.ClientSession() as http:

        async def ask(url, params, what):
            try:
                async with http.get(
                    url,
                    params=params,
                    headers=bearer,
                    timeout=aiohttp.ClientTimeout(total=HOMESERVER_REQUEST_SECONDS),
                ) as response:
                    return response.status, await response.text()
            except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                print(
                    f"FAIL: {what} got no answer after {looks} look(s), "
                    f"{clock.time() - started:.1f}s in "
                    f"({type(error).__name__}: {error})",
                    file=sys.stderr,
                )
                return None

        while kick_at is None:
            looks += 1

            # LA SYNCHRONISATION SERT DEUX FOIS : l'appartenance, et le jeton.
            answered = await ask(
                sync_url, {"timeout": "0", "filter": leaving}, "the sync"
            )
            if answered is None:
                return 1
            status, body = answered
            if status != 200:
                print(
                    f"FAIL: the sync was refused ({status}) for {user_id}: "
                    f"{body}",
                    file=sys.stderr,
                )
                return 1
            payload = json.loads(body)
            token = payload.get("next_batch")
            rooms = payload.get("rooms") or {}
            sections = {
                name: (rooms.get(name) or {}) for name in ("join", "invite", "leave")
            }
            counts = {name: len(held) for name, held in sections.items()}
            where = next(
                (name for name, held in sections.items() if room_id in held),
                "nowhere",
            )

            if where == "leave":
                left = sections["leave"][room_id]
                timeline = list((left.get("timeline") or {}).get("events") or [])
                found = departure_of(timeline, user_id)
                if found is not None:
                    history, kick_at = timeline, found
                    source = "the leave section of /sync"
                    break
                if timeline:
                    history, source = timeline, "the leave section of /sync"

            # PUIS L'HISTOIRE, REPRISE EN ARRIÈRE DEPUIS CE JETON. Sans
            # `from`, ce homeserver repart du premier événement du salon et
            # n'en rend qu'un : voir le docstring.
            if isinstance(token, str) and token:
                answered = await ask(
                    messages_url,
                    {"from": token, "dir": "b", "limit": str(WITNESS_EVENTS)},
                    "the room history",
                )
                if answered is None:
                    return 1
                status, body = answered
                reading = str(status)
                if status == 200:
                    # `dir=b` remonte le fil : remis dans l'ordre du salon.
                    back = list(reversed(json.loads(body).get("chunk") or []))
                    found = departure_of(back, user_id)
                    if found is not None:
                        history, kick_at = back, found
                        source = "/messages, back from the sync token"
                        break
                    if len(back) > len(history):
                        history = back
                        source = "/messages, back from the sync token"

            if clock.time() + CLAIM_PAUSE_SECONDS + HOMESERVER_REQUEST_SECONDS > deadline:
                print(
                    f"FAIL: nothing removes {user_id} from {room_id}, after "
                    f"{looks} look(s) over {clock.time() - started:.1f}s.\n"
                    f"      /sync puts that room in: {where} "
                    f"(rooms seen: {counts}).\n"
                    f"      /messages answered {reading}, and the best window "
                    f"read was {len(history)} event(s) from {source}:\n"
                    f"      {inventory(history)}\n"
                    "      READ THAT INVENTORY BEFORE BLAMING THE EVICTION. A "
                    "window carrying the room's FIRST events rather than\n"
                    "      its last is a window asked for wrongly, not a "
                    "removal that did not happen -- which is what cost run\n"
                    "      35094474747, where `/messages` without `from` "
                    "answered with one event, twenty-three times.\n"
                    "      An eviction that genuinely did not happen reads "
                    "differently: the room stays in `join`, and the window\n"
                    "      carries the application's recent events with no "
                    "departure of this account's among them.",
                    file=sys.stderr,
                )
                return 1
            await asyncio.sleep(CLAIM_PAUSE_SECONDS)

    kick = history[kick_at]
    remover = kick.get("sender")
    if remover == user_id:
        print(
            f"FAIL: {user_id} left {room_id} by itself. Nobody removed it, so "
            "there is no eviction to witness here.\n"
            "      A counterparty that walked out looks exactly like one that "
            "was put out, and only the sender tells them apart.",
            file=sys.stderr,
        )
        return 1
    if remover != application:
        print(
            f"FAIL: {user_id} was removed from {room_id} by {remover}, not by "
            f"the application ({application}).",
            file=sys.stderr,
        )
        return 1

    # APRÈS LE RETRAIT : ce que l'application a envoyé ensuite, et qui ne doit
    # pas être ici. Le test en envoie un exprès, sinon cette assertion serait
    # vraie faute de matière.
    after = [
        event for event in history[kick_at + 1 :] if event.get("sender") == application
    ]
    if after:
        kinds = sorted({str(event.get("type")) for event in after})
        print(
            f"FAIL: {len(after)} event(s) from the application are visible to "
            f"{user_id} AFTER its removal from {room_id}: {kinds}.\n"
            "      The removal did not close the conversation behind it.",
            file=sys.stderr,
        )
        return 1

    # AVANT LE RETRAIT : ce que l'application avait écrit, et sous quelle forme
    # il est passé sur le fil.
    before = [event for event in history[:kick_at] if event.get("sender") == application]
    clear = [event for event in before if event.get("type") == "m.room.message"]
    if clear:
        print(
            f"FAIL: the application put {len(clear)} message(s) in clear in "
            f"{room_id}. Rotating a key behind somebody who could read the\n"
            "      room without one proves nothing at all.",
            file=sys.stderr,
        )
        return 1

    sealed = [event for event in before if event.get("type") == "m.room.encrypted"]
    if not sealed:
        print(
            "FAIL: the application wrote nothing this witness could see in "
            f"{room_id} before the removal.\n"
            f"      The window read was {len(history)} event(s) from "
            f"{source}: {inventory(history)}\n"
            "      Without an encrypted event of the application's, « the key "
            "was rotated » has nothing to be about: no key of\n"
            "      hers ever existed in this conversation, and the outcome "
            "the screen owes is evict-outcome-no-key rather\n"
            "      than evict-outcome-rotated. The end-to-end test sends one "
            "before it evicts.",
            file=sys.stderr,
        )
        return 1

    seen = sorted(
        {str((event.get("content") or {}).get("session_id")) for event in sealed}
    )
    print(
        f"OK: {user_id} was removed from {room_id} by {application}, and "
        f"nothing the application sent afterwards is visible to it.\n"
        f"    Read from {source}, {len(history)} event(s), {looks} look(s) in "
        f"{clock.time() - started:.1f}s.\n"
        f"    Before the removal the application sent {len(sealed)} encrypted "
        f"event(s), under Megolm session(s) {seen}.\n"
        "    NOT PROVEN HERE, ON PURPOSE: that the room key rotated. This "
        "device never held a key of the application's --\n"
        "    identity-based sharing excludes it, which `collect` asserts -- "
        "so « it can no longer read » would be true\n"
        "    whether or not anything rotated. See this phase's docstring for "
        "what a witness able to prove it would need."
    )
    return 0


def main() -> int:
    # `claim-place` MANQUAIT ICI, ET C'EST LE DÉFAUT QUI REVIENT DANS CE DÉPÔT.
    #
    # `claim_place` était écrite, testée de l'extérieur par
    # `roundTrip.test.ts`, et absente de cette table. Le script répondait donc
    # « usage: login|send|collect » et sortait 2, ce que l'appelant voyait
    # comme « Command failed », sans rien qui nomme la phase inconnue.
    #
    # Une pièce finie que rien n'appelle ne se signale à aucune unité : le
    # script se lit bien, la fonction se lit bien, et seule leur absence de
    # lien est fausse. C'est pour cela que la table est ici plutôt que dans
    # trois endroits, et que la ligne d'usage est dérivée d'elle : les deux ne
    # peuvent plus diverger.
    phases = {
        "login": login,
        "send": send,
        "send-file": send_file,
        "claim-place": claim_place,
        "collect": collect,
        "witness-eviction": witness_eviction,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in phases:
        print(
            f"usage: nio_counterparty.py {'|'.join(phases)}",
            file=sys.stderr,
        )
        return 2

    work = Path(env("MESSAGR_INTEROP_WORKDIR"))
    session_file = work / "counterparty-session.json"
    store = work / "store"

    return asyncio.run(phases[sys.argv[1]](session_file, store))


if __name__ == "__main__":
    raise SystemExit(main())
