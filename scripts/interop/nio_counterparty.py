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

# Two phases, and why the order is not negotiable

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

from nio import AsyncClient, AsyncClientConfig, LoginResponse, RoomMessageText

# What the application sends. Kept in one place on each side; if this ever
# disagrees with the application's own constant, the test fails loudly rather
# than passing on an empty match.
EXPECTED_BODY = "encrypted by the bridge, sent by the application"

SYNC_TIMEOUT_MS = 10_000
COLLECT_DEADLINE_SECONDS = 120


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
    """Create this device, upload its keys, and join the room.

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

        # Joining before syncing, so the first sync already carries the room:
        # the application reads the member list from the server, and a member
        # who is not joined yet is a member it will not share the key with.
        joined = await client.join(room_id)
        if getattr(joined, "room_id", None) != room_id:
            print(f"FAIL: could not join {room_id}: {joined}", file=sys.stderr)
            return 1

        # The keys this device is known by. Without this upload the
        # application's /keys/query finds a device with nothing to encrypt to,
        # and skips it silently.
        await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=True)
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
        print(f"OK: counterparty is {client.device_id}, joined {room_id}")
        return 0
    finally:
        await client.close()


async def collect(session_file: Path, store: Path) -> int:
    """Resume the same device and read what the application sent."""
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
        client.load_store()

        # Synced in a loop rather than once: the room key arrives as a
        # to-device message and the event as room timeline, and nothing
        # promises they land in the same sync.
        deadline = asyncio.get_event_loop().time() + COLLECT_DEADLINE_SECONDS
        while asyncio.get_event_loop().time() < deadline:
            await client.sync(timeout=SYNC_TIMEOUT_MS, full_state=True)

            room = client.rooms.get(room_id)
            if room is not None:
                for event in reversed(getattr(room, "timeline", []) or []):
                    if (
                        isinstance(event, RoomMessageText)
                        and event.sender == sender
                        and event.body == EXPECTED_BODY
                    ):
                        print(
                            "OK: the counterparty decrypted the application's "
                            f"message ({event.event_id})"
                        )
                        return 0

        print(
            "FAIL: nothing this counterparty could decrypt arrived from "
            f"{sender} in {room_id} within {COLLECT_DEADLINE_SECONDS}s.\n"
            "      An encrypted event that stayed encrypted here means the "
            "room key never reached this device;\n"
            "      no event at all means the application did not send.",
            file=sys.stderr,
        )
        return 1
    finally:
        await client.close()


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("login", "collect"):
        print("usage: nio_counterparty.py login|collect", file=sys.stderr)
        return 2

    work = Path(env("MESSAGR_INTEROP_WORKDIR"))
    session_file = work / "counterparty-session.json"
    store = work / "store"

    phase = login if sys.argv[1] == "login" else collect
    return asyncio.run(phase(session_file, store))


if __name__ == "__main__":
    raise SystemExit(main())
