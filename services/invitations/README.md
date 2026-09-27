# The invitation service

Creating an invitation, claiming one, revoking one, reading its status. An
account comes into existence at claim time and not before, which is what makes
revocation mean something.

Rust, axum, SQLite. It lives beside the JavaScript workspace rather than
inside it: placed in `packages/`, the package manager would claim to manage
something it cannot build, and every install would carry that lie.

## What is not here

**Private discovery, coming back one ticket at a time.** The prototype's blind
directory, its usage tokens and its quota stayed in the previous repository
when this service was internalised, and they do not come back: #392 rebuilds
discovery on a new design (ADR 0014). The masking of numbers is here
(`masking`, #396), and so is the proof of a number (`handlers::discovery`,
#397); the rest arrives with the tickets after them.

Three variants in `AppError` still describe discovery refusals. They are kept
deliberately, with the reason written at the enum: their documentation
records what each refusal does and does not disclose, which is worth more
preserved than rewritten from memory.

## Running it

```
cargo test          # 374 tests, no network, about a second
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Three further tests in `tests/integration.rs` are `#[ignore]`d: they drive a
real deployment and need credentials, so they are run against one deliberately
rather than on every commit.

## Configuration

Twenty-two variables, four of them mandatory: `DATABASE_URL`, `HOMESERVER_URL`,
`REGISTRATION_TOKEN`, `ENCRYPTION_KEY`, plus optional `EDGE_RETENTION_DAYS`,
`BIND_ADDR`, `MAX_RESERVED_ACCOUNTS_PER_INVITER`, `PUSH_GATEWAY_URL`,
`MASKING_KEYS`, `REFERENCE_KEY`, and the SMS provider's: `OVH_APPLICATION_KEY`,
`OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, `SMS_SENDER`,
`OVH_API_URL` and `SMS_PROVIDER_FOR_TESTS`, the countries open to discovery,
`DISCOVERY_COUNTRIES`, and the ceilings on its SMS,
`SMS_CEILING_PER_COUNTRY_PER_DAY`, `SMS_BUDGET_PER_MONTH`,
`SMS_CREDITS_ALERT_BELOW` and `ALERT_SMS_TO`, without which discovery stays
off.

`MASKING_KEYS` holds the keys that mask the phone numbers of address-book
discovery (`masking`, RFC 9497, ADR 0014), each under its key number. Absent,
discovery stays off and the service starts; malformed, it refuses to start
without showing the value; missing a key that masks still in service were
made with, it refuses to start too. Its format, and the three places a key
lives on the host, are in `deploy/messagr-eu-invitations.md`.

`REFERENCE_KEY` is the key the reference of a findable account is computed
with, so that the same account keeps it whenever it proves its number (#451).
Absent, discovery stays off; malformed, the service refuses to start; one that
served before a masking key was retired at once, it refuses to start too. The
same guide says when it changes.

The SMS provider sends the code that proves a number, through OVHcloud's
European API and no other outside the bench. All four of its credentials, or
none: none leaves discovery off, some of them stop the start. The same guide
says how to create them.

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
