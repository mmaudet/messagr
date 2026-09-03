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
no production-grade project running it. It needs polyfills for
`crypto.getRandomValues`, `Promise.withResolvers`, `TextEncoder` and `URL`, and a
bundler stub for `matrix-sdk-crypto-wasm` which also delivers the single-crypto
goal. Only the in-memory store works, so every cold start resynchronises in full
until a store is written.

**This decision carries a stopping criterion.** The first increment sends and
receives an encrypted event across this seam against a real homeserver, or the
transport half is reopened. No second increment before that verdict.
