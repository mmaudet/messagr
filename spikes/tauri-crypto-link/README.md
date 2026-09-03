# Spike: does the crypto core link into a Tauri binary?

**This is not product code, and must never become any.** It exists to answer
one question that the product specification's desktop section asserts without
evidence. The answer is recorded in
[`docs/spikes/tauri-crypto-link.md`](../../docs/spikes/tauri-crypto-link.md);
this directory is the experiment that produced it, kept so the claim can be
re-tested rather than re-argued.

It is deliberately not a Tauri application: no window is shown, no product
screen exists, nothing persists. It creates a crypto machine in a temporary
directory, encrypts one event, prints what it got, and exits.

## Running it

```
cd spikes/tauri-crypto-link && cargo run
```

Exit code 0 means the crate linked and encrypted. Anything else is the
negative result, and the reason it prints is the finding.

The crate comes from its public repository pinned to a commit, not from a
sibling checkout, so this runs on a clean machine. It is not wired into CI:
the dependency tree is large, the build is minutes long, and nothing in the
product depends on this answer staying true from one commit to the next. The
day desktop work actually starts is the day to reconsider that.

## If you are tempted to grow this

Don't. The ticket that created it said so, and the reason holds: a spike that
becomes a product acquires all the decisions it deliberately skipped —
persistence, key management, window lifecycle, error surfaces — without anyone
noticing they were skipped. Start the desktop client as its own thing, and let
this stay the one-page proof that doing so is possible.
