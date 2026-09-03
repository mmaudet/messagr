# Matrix crypto through a native bridge, transport in TypeScript

End-to-end encryption comes from `react-native-matrix-crypto`, which wraps
unforked `matrix-sdk-crypto` 0.18 through JSI. Matrix transport, meaning session,
sync, rooms, timeline, sending and to-device, comes from `matrix-js-sdk` driven
in TypeScript with its own crypto never initialised. The application owns the
pump between them: it drains the crypto machine's outgoing requests, returns the
responses, and feeds it sync deltas.

The reason is that exactly one implementation of the cryptography may exist in
the binary. Driving `matrix-sdk` instead, whether ported from the previous
codebase or bound afresh, brings a second `matrix-sdk-crypto` and a second
encrypted store, which the product specification forbids for the desktop target
and which would be no better on mobile.

## Considered options

- **Port `messagr-core` wholesale.** It already does full Matrix transport, is
  UniFFI-exposed and carries 635 tests. Rejected: its transport engine drives
  `matrix-sdk`, so adopting it reintroduces the second crypto machine. Its
  fork-free modules are still being ported; see the consequences below.
- **`@vector-im/matrix-bot-sdk`.** The precedent worth knowing:
  `matrix-appservice-bridge` ran this exact crypto-less pattern on `matrix-js-sdk`
  for 22 months, then dropped `matrix-js-sdk` entirely and moved here. Rejected
  for now because that project is a server-side bridge with neither React Native
  nor JSI, so its migration says little about ours.
- **A hand-rolled client-server client.** Held in reserve. It becomes the answer
  only if the first increment fails.

## Consequences

The fork is not inherited. The previous codebase pins `matrix-sdk` to a personal
fork for three methods; all three are already public in unforked
`matrix-sdk-crypto`, because the fork existed only to pierce `matrix-sdk`'s
high-level wrapper. Taking crypto from the crate directly sidesteps it.

Three things must be written that the libraries do not give us:

- **The receive-side key-bundle policy.** `should_accept_key_bundle` is
  `pub(crate)` upstream. It enforces accepting a room-key bundle only from the
  inviter, only once joined, and only within a day of accepting. Forgotten, the
  application accepts key bundles from anyone.
- **Plaintext re-injection.** `MatrixEvent.attemptDecryption` accepts a
  duck-typed decryptor and works, but is marked `@internal` and is not exported.
  This is the largest exposure to an upstream API break.
- **Device list and one-time-key counts.** No public accessor reads
  `device_lists` or `device_one_time_keys_count` out of the sync response; the
  fields are dropped when no crypto is configured. Upstream carries a `FIXME`
  acknowledging it.

Sending a self-built `m.room.encrypted` event passes through untouched, because
the send path treats an already-encrypted type as needing no encryption. The
`usingExternalCrypto` flag must stay false: it sends plaintext into encrypted
rooms, and the proxy it was written for is archived. Outgoing pump requests go
through `client.http.authedRequest`, which is what `matrix-js-sdk`'s own pump
uses, rather than the typed endpoint wrappers, whose shape does not fit.

React Native is the real risk rather than the seam. `matrix-js-sdk` does not
support it: no continuous integration, not named in its supported platforms, and
no production-grade project running it. Only the in-memory store works, so every
cold start resynchronises in full until a store is written.

**Amended after measurement.** This paragraph named four polyfills, taken from
research rather than from a runtime. Probed behaviourally on React Native
0.87.1, across an iOS simulator, an Android emulator and an Android phone, the
runtime leaves exactly two gaps: `crypto.getRandomValues` and `TextDecoder`,
which this ADR did not list. `Promise.withResolvers`, `TextEncoder` and `URL`
all work, `URL` including the query parsing its shim was expected to fail.
Nothing is polyfilled for those three. The bundler stub for
`matrix-sdk-crypto-wasm` was needed, and does deliver the single-crypto goal.
See `docs/runtime-gaps.md`.

**Amended after implementation (device lists and one-time-key counts).** The
second exposure named above is closed by a workaround, not by an upstream
accessor, which did not appear. `device_lists` and `device_one_time_keys_count`
are recovered with a second, raw request: a non-blocking (`timeout=0`) `GET
/sync`, sent through the same `client.http.authedRequest` escape hatch the
outgoing pump already uses, independent of `matrix-js-sdk`'s own long-polling
sync loop, which has already been stopped by the time this runs. The response
passes through `react-native-matrix-crypto`'s own `encryptionSlice`, its pure
field-rename from a raw sync body to the shape `receiveSyncChanges` accepts, so
this application decides nothing about which fields matter — only that a
second request is where they come from. See `syncDelta.ts` and `cryptoPump.ts`.

This duplicates a round trip the SDK's own loop already made moments earlier,
which is accepted rather than fixed here, because that loop is stopped
immediately after its one sync (see the transport-half consequence above) and
this application reads nothing else from it. Should `matrix-js-sdk` ever expose
`device_lists`/`device_one_time_keys_count` publicly, this second request is
deleted and `fetchEncryptionSyncDelta`'s caller reads the accessor instead;
nothing downstream of `encryptionSlice` changes.

**This decision carries a stopping criterion.** The first increment sends and
receives an encrypted event across this seam against a real homeserver, or the
transport half is reopened. No second increment before that verdict.

## The verdict

**The seam holds.** The transport half is not reopened.

An application built on it encrypts a message through the bridge, sends it as
an `m.room.encrypted` event through the raw authenticated request path, and an
independent `matrix-nio` client decrypts it. In the other direction, that same
client encrypts a message and this application decrypts it and shows the
plaintext. Both directions run against a real homeserver in continuous
integration, driven from the application rather than from the library
(`packages/app/e2e/roundTrip.test.ts`, `scripts/interop/nio_counterparty.py`).

**The largest named exposure was not taken.** This ADR called plaintext
re-injection through `MatrixEvent.attemptDecryption` -- duck-typed, marked
`@internal`, not exported -- the biggest risk of an upstream break in the
design. Nothing in this application calls it. The exposure exists only for a
product that wants matrix-js-sdk's own timeline model to hold decrypted
events; this one renders its own screen from its own state, so it reads the
raw event out of a raw sync and decrypts it through the bridge
(`receiveDecrypt.ts`).

That is a narrowing, not an escape, and it comes with a condition worth
stating plainly: **the day a timeline is built on the SDK's room model, this
exposure returns exactly as described above.** Whoever builds that screen
inherits this paragraph. How a break would be detected needs a straighter answer than "there is
nothing to break". Two surfaces are load-bearing and neither is a documented
contract. `client.http.authedRequest` is what the outgoing pump and every
raw read here go through, and matrix-js-sdk calls it "intended private, used
in code". And the raw `/sync` shape this reads `to_device` and `timeline`
out of is the protocol's, not the SDK's, so it moves with the homeserver
rather than with a dependency bump.

Both are watched by the same thing, and it is the only thing that can watch
them: the round trip above, run against a real homeserver on every pull
request. A signature change breaks the build; a shape change breaks a test
that decrypts nothing. Neither fails quietly, which is the property that
matters -- this design's characteristic failure, seen twice while building
it, is a message that encrypts, sends, and reports success while arriving
unreadable.

**What the seam does not give.** Decrypting an event does not establish who
sent it. The sender is transport metadata read off the event, verifying a
device does not change that, and sender verification is computed once per
session and never backfilled -- a message decrypted before its sender was
verified keeps reporting what it reported then. The application names the
field `claimedSender` and prints it as unauthenticated for that reason. This
is a property of the design, not a gap in it, and a product surface that
implies otherwise would be the first place it is lost.
