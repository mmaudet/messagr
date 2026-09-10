# A reinstalled device comes back as a new device, and the password is kept for it

An account's password — drawn by the invitation service when the account is
created, and handed back once with the claim — is kept in the operating
system's keystore. A launch that finds a session whose crypto store is gone
uses it to log in again, takes the new device the homeserver hands back, and
retires the old one.

## What went wrong without it

Reported from an iPhone. Uninstalling removes the data directory — the crypto
store, the encrypted notebook — and **does not remove the keychain**: iOS
never clears keychain entries when an application goes, and
`AccessibleAfterFirstUnlockThisDeviceOnly` does not change that. `ThisDeviceOnly`
stops iCloud syncing, not survival.

So the next launch found a session, an account and a **device identifier**
that were all intact, and a store that was empty. `entered.claimed` was false
and the sign-up marker had been cleared at the first successful sign-up, so
the entitlement resolved to `restored-session` and the pump republished fresh
identity keys **under the old device identifier**.

For every correspondent, that is not somebody reinstalling. It is an existing
device whose identity keys changed underneath them — which in Matrix is the
shape of an attack, and precisely what device verification exists to raise. A
product that teaches people to treat that as an alarm must not manufacture it.

## What was measured before deciding

Against the bench homeserver, in this order:

- `POST /_matrix/client/v1/login/get_token` (MSC3882) is implemented and
  answers `401` demanding `m.login.password`. **A client holding only an
  access token cannot mint a login token**, so a token alone cannot obtain a
  new device.
- `POST /_matrix/client/v3/login` with `m.login.password` answers `200` and a
  **new `device_id` on the same account**.
- `DELETE /_matrix/client/v3/devices/{id}` answers `401` with a
  user-interactive session, then `200` when the same password is presented.
  So the dead device can be retired rather than left standing.

The password already existed and was already reaching the device:
`claimInvitation.ts` read it out of the claim response and deliberately
dropped it, on the reasoning that a restored session needs the triple and
nothing else. That reasoning was right about _restoring_ a session and had
nothing to say about _replacing_ one.

## The alternatives, and why they were not taken

**Say it and stop.** The screen announces that this device lost its keys and
that a new invitation is needed. Honest, and it keeps no new secret. It costs
an invitation on every reinstall and puts somebody outside who did nothing
wrong — a reinstall is not a mistake.

**Wipe the keychain and start over.** Simple, and it destroys a valid session
on the evidence of an empty directory. A failed mount looks exactly like an
uninstall, and the two must not be worth the same answer.

Both were weighed with the account holder on 10 September 2026, against the
measurements above. The password was chosen.

## What it costs

**A password at rest, and it is the heaviest thing this application keeps.**
An access token is a bearer credential for one device and can be revoked
device by device; a password makes devices at will and cannot. Whoever
defeats the keystore now gets the _account_ rather than a session. ADR-0008
is what stands behind it: the entry is `ThisDeviceOnly`, so it does not
travel to another device and does not restore from a backup.

**It is not a key backup and does not become one.** The past stays
unreadable: room keys went with the store, and nothing here brings them
back. Both outcomes say so on the screen rather than leaving somebody to
discover it — coming back as a new device is the good outcome and is still a
loss.

**It only works for accounts claimed from this version on.** Changing a
Matrix password requires the old one, so a device already installed cannot be
given one. Those accounts keep the previous behaviour until they enter again.

## Consequences

`recoverySecret.ts` is the only module that keeps it and `reenter.ts` the
only one that spends it; every other request in the application carries the
access token. It is never shown, never sent anywhere but the account's own
homeserver, and never used to authenticate an ordinary call.

The detection is local: the store lives at `<storeDir>/crypto/<deviceId>`, so
the question is whether that directory exists. A question that cannot be
asked is answered "present" — the cost of being wrong that way is a launch
behaving as it always has, against a launch that would replace a working
device over a read that failed.

§4.6's stance is untouched. This is not universal invisible recovery: it
recovers an _account_, never its history, and only on a device that still
holds its own keystore.
