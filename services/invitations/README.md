# The invitation service

Creating an invitation, claiming one, revoking one, reading its status. An
account comes into existence at claim time and not before, which is what makes
revocation mean something.

Rust, axum, SQLite. It lives beside the JavaScript workspace rather than
inside it: placed in `packages/`, the package manager would claim to manage
something it cannot build, and every install would carry that lie.

## What is not here

**Private discovery.** The blind directory built on an oblivious pseudorandom
function, its usage tokens and its quota stayed in the previous repository
when this service was internalised. Nothing in the current slice exercises
them, and internalising an unexercised cryptographic component is how a
dependency breaks silently — which is the thing internalising was meant to
prevent. Issue #38 brings it back the day a slice needs it.

Three variants in `AppError` still describe discovery refusals. They are kept
deliberately, with the reason written at the enum: their documentation
records what each refusal does and does not disclose, which is worth more
preserved than rewritten from memory.

## Running it

```
cargo test          # 190 tests, no network, about a second
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Three further tests in `tests/integration.rs` are `#[ignore]`d: they drive a
real deployment and need credentials, so they are run against one deliberately
rather than on every commit.

## Configuration

Eight variables, four of them mandatory: `DATABASE_URL`, `HOMESERVER_URL`,
`REGISTRATION_TOKEN`, `ENCRYPTION_KEY`, plus optional `EDGE_RETENTION_DAYS`,
`BIND_ADDR`, `MAX_RESERVED_ACCOUNTS_PER_INVITER` and `PUSH_GATEWAY_URL`.

`PUSH_GATEWAY_URL` was missing from this list. It is where a stripped push
notification is forwarded, and a deployment without it accepts every
notification and wakes nobody — answering "delivered, nothing to clean up",
which is the least wrong thing a gateway with nowhere to send can say and
looks exactly like success. `config::usable_gateway` refuses a value that
would put device tokens on the wire in clear, so a rejected setting is also a
gateway that sends nothing.

Losing `ENCRYPTION_KEY` makes every secret already stored undecipherable, and
the accounts behind them can then neither be handed out nor deactivated —
while the homeserver never releases their localparts.
