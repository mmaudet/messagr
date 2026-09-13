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

            for event_id, event in list(pending.items()):
                try:
                    plain = client.decrypt_event(event)
                except Exception as error:  # noqa: BLE001 -- reported, not handled
                    reasons[event_id] = f"{type(error).__name__}: {error}"
                    continue
                pending.pop(event_id)
                if isinstance(plain, RoomMessageText):
                    decrypted_bodies.append(plain.body)

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


async def send(session_file: Path, store: Path) -> int:
    """Encrypt a message for the application to read.

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
            content={"msgtype": "m.text", "body": COUNTERPARTY_BODY},
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
        "claim-place": claim_place,
        "collect": collect,
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
