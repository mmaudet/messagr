# Can the bridge be driven into an upstream panic from TypeScript?

**Question.** Encrypting into a scope with no group session does not return an
error inside the Rust core: it panics in upstream's own session manager
(`matrix-sdk-crypto-0.18.0/src/session_manager/group_sessions/mod.rs:218`,
"Session wasn't created nor shared"), and on a tokio worker that panic was
non-unwinding and aborted the process. Seen while linking the crate into a
Tauri binary ([tauri-crypto-link.md](./tauri-crypto-link.md)) — but through
the **core** crate directly, not through `matrix-crypto-ffi`, which is where
`catch_unwind` lives. Whether the net holds for the bridge a React Native
application actually uses is not something reading the source settles.

**Answer: the net holds.** The application survives, and so does the crypto
machine.

```
MESSAGR_PANIC_PROBE {"outcome":"caught","detail":"crypto error: unknown","stillAlive":true}
```

Observed on an Android emulator, release build, `react-native-matrix-crypto`
0.3.0, with `packages/app/src/runtime/panicProbe.ts` behind the
`MESSAGR_PANIC_PROBE` build flag. The process kept its pid, logcat carried no
`SIGABRT` and no native abort, and a harmless call afterwards
(`getDeviceIdentityKeys`) still answered — so no lock was left poisoned. Alive
with dead cryptography would have been barely better than dead and much
harder to notice, which is why that second call is part of the probe rather
than an afterthought.

## Why this mattered beyond one bad call order

The ordering that triggers it is one this application already avoids:
`encryptAndSend.ts` shares the room key until it settles and refuses to
encrypt otherwise. What the answer really decided is whether the net exists at
all — because the same net is what stands between malformed, attacker-shaped
ciphertext reaching `decryptEvent` or `receiveSyncChanges` and a crash. A
self-inflicted call-order bug is an availability defect. A panic reachable
from received data would be a remote denial of service on an encrypted
messenger, and the bridge's own `Cargo.toml` says in as many words that this
is what `panic = "unwind"` is there to prevent. It works.

## The finding that is left, and it is not nothing

**The diagnosis is lost on the way out.** What reached TypeScript was
`crypto error: unknown`. The library declares a variant for exactly this
condition — `UnsharedSession`, mapped to kind `'unshared_session'` — and
another, `Failed`, for a general upstream failure. Neither is what arrived.
`'unknown'` is what the facade produces for a variant name absent from its
map, which is consistent with a caught panic carrying no declared variant at
all.

So a product hitting this learns that something went wrong, and nothing about
what. `errors.ts`'s own comment names this failure mode precisely, about a
different variant: _"arrives as kind 'unknown' with the message 'crypto error:
unknown', which is the failure mode this map exists to prevent and which no
test on the Rust side can see."_

**Where a fix belongs: in the library, not here.** Guarding it in messagr
would protect messagr and leave every other consumer of the bridge with the
same blind error. Two candidates, and the first is better:

1. `matrix-crypto-core` returns `SessionError::UnsharedSession` when no group
   session exists, instead of letting upstream panic. The variant already
   exists and is already mapped; nothing new has to be designed.
2. Failing that, the FFI maps a caught panic to a named kind, so that a
   product can at least tell a panic from an ordinary refusal.

Worth reporting upstream too: a library that panics on a legal-but-unlucky
call order, rather than returning an error, is an upstream defect regardless
of who catches it.

## Scope, and what was not established

Only one panic was provoked, the one already known. This says nothing about
whether _other_ upstream panics exist or whether they would all be caught the
same way; it establishes that the mechanism works for this one, on this
threading model, on Android.

Not run in continuous integration. The probe deliberately provokes a crash and
would break every other assertion if it ran by default, and the question it
answers is "what happens", asked once, not "does it still happen every
commit". It is kept behind the flag so the answer can be re-taken after a
dependency bump — `react-native-matrix-crypto` 0.4.0 records no change to
panic handling, so this answer is expected to survive that upgrade, but
expected is not measured.
