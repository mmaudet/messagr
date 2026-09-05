#!/usr/bin/env python3
"""A third opinion on whose signatures are wrong.

# Why this exists

The Go counterparty publishes a cross-signing identity, signs its own device
with it, and uploads one-time keys -- and the application still refuses to
share a room key with it, answering `m.room_key.withheld` with `m.no_olm`,
"Unable to establish a secure channel". Every symptom points at the identity,
which is correct. The application claims one-time keys successfully, six times,
all 200, and never opens an Olm session with the device it claimed them from.

Two implementations disagree, and each one's own opinion of the other is
worthless as evidence. So this asks a third: it claims a key the way any
client would and verifies the signature by hand, against the Matrix
specification's own recipe.

# Why the Ed25519 is written out

Borrowing either side's crypto would not be a third opinion. The
implementation below is checked against RFC 8032's own test vectors before it
is trusted -- `--self-test` -- because a verifier that quietly says "invalid"
to everything would produce exactly the finding this script was written to
look for.

# What it found, on 5 September 2026, against the fork

    application  (matrix-sdk-crypto)  one-time key signature   VALID
    counterparty (mautrix-go/goolm)   device keys signature    VALID
    counterparty (mautrix-go/goolm)   one-time key signature   INVALID

Same homeserver, same claim endpoint, same verifier, same signed object shape
`{"key":"..."}`. The homeserver is not mangling anything, since the
application's own key round-trips and verifies. The counterparty's device keys
sign correctly, so its signing key and its canonical JSON are right for that
object. Only its one-time keys are wrong.

So `matrix-sdk-crypto` refusing the claimed key and reporting `m.no_olm` is
**correct behaviour**, and the fault is in mautrix-go's one-time key signing
path. Which is what an independent counterparty is for: a second instance of
matrix-sdk-crypto would have agreed with itself.

# Usage

    HS=https://homeserver REG_TOKEN=... \\
    TARGET_USER=@somebody:homeserver [TARGET_DEVICE=ABCDEF] \\
    ./verify-signed-keys.py

    ./verify-signed-keys.py --self-test

It registers a throwaway account to do the claiming, because claiming consumes
a key and it should not be the account under test doing it.
"""

import base64
import binascii
import hashlib
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.request

# --- Ed25519, written out, so this is a third opinion and not a borrowed one ---
P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P
I = pow(2, (P - 1) // 4, P)


def recover_x(y, sign):
    xx = (y * y - 1) * pow(D * y * y + 1, P - 2, P)
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P != 0:
        x = x * I % P
    if (x * x - xx) % P != 0:
        return None
    if x % 2 != sign:
        x = P - x
    return x


def point_add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    A = (y1 - x1) * (y2 - x2) % P
    B = (y1 + x1) * (y2 + x2) % P
    C = 2 * t1 * t2 * D % P
    Dd = 2 * z1 * z2 % P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % P, G * H % P, F * G % P, E * H % P)


def point_mul(scalar, point):
    result = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = point_add(result, point)
        point = point_add(point, point)
        scalar >>= 1
    return result


def point_equal(a, b):
    x1, y1, z1, _ = a
    x2, y2, z2, _ = b
    return (x1 * z2 - x2 * z1) % P == 0 and (y1 * z2 - y2 * z1) % P == 0


BY = 4 * pow(5, P - 2, P) % P
BX = recover_x(BY, 0)
BASE = (BX, BY, 1, BX * BY % P)


def decompress(data):
    y = int.from_bytes(data, "little") & ((1 << 255) - 1)
    sign = int.from_bytes(data, "little") >> 255
    x = recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % P)


def verify(public, message, signature):
    if len(public) != 32 or len(signature) != 64:
        return False
    A = decompress(public)
    R = decompress(signature[:32])
    if A is None or R is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little") % L
    return point_equal(point_mul(s, BASE), point_add(R, point_mul(h, A)))


def self_test():
    """RFC 8032 section 7.1, and one case that must fail."""
    cases = [
        (
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
            "",
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a"
            "33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
        (
            "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
            "72",
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e1"
            "5996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        ),
    ]
    ok = True
    for public, message, signature in cases:
        good = verify(
            binascii.unhexlify(public), binascii.unhexlify(message), binascii.unhexlify(signature)
        )
        print("RFC 8032 vector:", "pass" if good else "FAIL")
        ok &= good
    tampered = verify(
        binascii.unhexlify(cases[1][0]), b"\x73", binascii.unhexlify(cases[1][2])
    )
    print("altered message rejected:", "pass" if not tampered else "FAIL")
    ok &= not tampered
    print()
    print("verifier trustworthy:", ok)
    return 0 if ok else 1


def unpad(value):
    return base64.b64decode(value + "=" * (-len(value) % 4))


def signed_bytes(obj):
    """The specification's recipe: drop `signatures` and `unsigned`, canonicalise."""
    unsigned = {k: v for k, v in obj.items() if k not in ("signatures", "unsigned")}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def main():
    if "--self-test" in sys.argv:
        return self_test()

    homeserver = os.environ["HS"]
    token = os.environ["REG_TOKEN"]
    user = os.environ["TARGET_USER"]
    wanted_device = os.environ.get("TARGET_DEVICE") or None

    def post(path, body, auth=None):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + auth
        request = urllib.request.Request(
            homeserver + path, data=json.dumps(body).encode(), method="POST", headers=headers
        )
        try:
            return json.load(urllib.request.urlopen(request)), None
        except urllib.error.HTTPError as error:
            return None, (error.code, error.read().decode()[:300])

    started, refusal = post("/_matrix/client/v3/register", {})
    if started is None:
        started = json.loads(refusal[1])
    account, refusal = post(
        "/_matrix/client/v3/register",
        {
            "username": "otk-probe-"
            + "".join(secrets.choice(string.ascii_lowercase) for _ in range(8)),
            "password": secrets.token_urlsafe(20),
            "auth": {
                "type": "m.login.registration_token",
                "token": token,
                "session": started["session"],
            },
        },
    )
    if account is None:
        print("registration refused:", refusal, file=sys.stderr)
        return 1
    auth = account["access_token"]

    queried, refusal = post(
        "/_matrix/client/v3/keys/query",
        {"device_keys": {user: [wanted_device] if wanted_device else []}},
        auth,
    )
    if queried is None:
        print("keys/query refused:", refusal, file=sys.stderr)
        return 1
    devices = queried.get("device_keys", {}).get(user) or {}
    if not devices:
        print("no device published for", user, file=sys.stderr)
        return 1
    device = wanted_device or next(iter(devices))
    device_keys = devices[device]
    ed25519 = device_keys["keys"]["ed25519:" + device]

    print("user   :", user)
    print("device :", device)
    print()

    device_ok = verify(
        unpad(ed25519),
        signed_bytes(device_keys),
        unpad(device_keys["signatures"][user]["ed25519:" + device]),
    )
    print("device keys signature      :", "VALID" if device_ok else "INVALID")

    claimed, refusal = post(
        "/_matrix/client/v3/keys/claim",
        {"one_time_keys": {user: {device: "signed_curve25519"}}},
        auth,
    )
    if claimed is None:
        print("claim refused:", refusal, file=sys.stderr)
        return 1
    got = claimed.get("one_time_keys", {}).get(user, {}).get(device, {})
    if not got:
        print("one-time key signature     : no key available to claim")
        return 1
    _, key_object = next(iter(got.items()))
    body = signed_bytes(key_object)
    otk_ok = verify(
        unpad(ed25519), body, unpad(key_object["signatures"][user]["ed25519:" + device])
    )
    print("one-time key signature     :", "VALID" if otk_ok else "INVALID")
    print("  signed object            :", body.decode())
    print()

    if device_ok and not otk_ok:
        print(
            "This device signs its DEVICE keys correctly and its ONE-TIME keys\n"
            "incorrectly. Its signing key and its canonical JSON are therefore\n"
            "right; only the one-time key path is wrong. A client that refuses\n"
            "to open an Olm session with it, and reports m.no_olm, is correct."
        )
    return 0 if (device_ok and otk_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
