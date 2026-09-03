# Spike: linking the crypto core into a Tauri binary

**Question.** The product specification's desktop section is normative and
declares itself structural, and its whole argument rests on one claim: the
same Rust crate that serves mobile is linked directly into the desktop
binary. No such binding existed. The claim was plausible — the crate knows
nothing of the layers above it, and a continuous-integration gate enforces
that — but plausible is not linked.

**Answer: yes.** A Tauri binary links `matrix-crypto-core` and encrypts a
real event with it.

```
SPIKE RESULT: linked and encrypted
  algorithm:      m.megolm.v1.aes-sha2
  ciphertext len: 492
```

The experiment is `spikes/tauri-crypto-link`. It runs the crypto inside
Tauri's `setup` hook rather than in `main` before the application is built, so
what this shows is the crate working inside a running Tauri application, not
merely two things compiled into the same executable. The crate is taken from
its public repository pinned to a commit, so the result does not depend on the
machine it was first run on.

The desktop section stands. Nothing in it needs rewriting on this account.

## What made it work, and what did not

Nothing about Tauri was in the way. There was no shim, no feature flag, no
`cfg` branch, and no patched dependency: the crate compiled for the host and
linked like any other. Two things are worth naming as reasons rather than
luck.

`matrix-crypto-core` takes no mobile dependency at all. Its manifest names
`matrix-sdk-crypto`, `matrix-sdk-sqlite`, `serde`, `tokio` and little else,
and the library's own `scripts/assert-core-boundary.sh` keeps `uniffi` out of
it in CI. The mobile-specific layer lives one crate over, in
`matrix-crypto-ffi`, which a desktop binary simply does not depend on.

`matrix-sdk-sqlite` is configured with `bundled`, so SQLite is compiled from
source rather than linked against whatever the host provides. That was done
for Android, whose NDK sysroot ships none; it is the same reason the store
opens on a desktop without anyone arranging a system library first.

## The one real finding

**`encrypt_event` panics, rather than returning an error, when no group
session exists yet.** Called without a prior `share_scope_key`, it does not
return `Err`: it panics inside upstream's own session manager —

```
matrix-sdk-crypto-0.18.0/src/session_manager/group_sessions/mod.rs:218
Session wasn't created nor shared
```

— and on a tokio worker thread that panic was non-unwinding, so it aborted
the process rather than surfacing anywhere a caller could catch it.

This is a finding about the crate's API, not about Tauri, and it applies to
the mobile client already shipping against the same crate. Two consequences
worth carrying forward:

- Any caller must establish the session before encrypting into a scope. The
  ordering is not advisory, and the failure mode for getting it wrong is the
  loudest one available.
- A UniFFI `catch_unwind` at the boundary does not necessarily save a caller
  here. The bridge deliberately keeps `panic = "unwind"` so that panics become
  catchable errors, but a non-unwinding panic on a worker thread aborts before
  that boundary is reached.

Whether the mobile bridge can currently be driven into this state from
TypeScript was not investigated: it is out of this spike's question, and it is
worth a ticket of its own rather than a guess here.

## Scope, and what was deliberately not done

No product code was written. No window is shown, nothing is persisted beyond
a temporary directory, and no key management, verification, or transport
exists. The spike is kept as a fixture so the claim can be re-tested rather
than re-argued; `spikes/tauri-crypto-link/README.md` says why it must not be
grown into the desktop client.

It is not wired into CI. The dependency tree is large and the build is minutes
long, and no product behaviour depends on this answer staying true commit to
commit. When desktop work actually starts, that is the moment to reconsider —
not before.
