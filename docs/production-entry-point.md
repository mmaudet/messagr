# The production instance, and the account the graph starts from

`messagr.eu` carries real conversations. Testers install through the store and
talk to each other there, which is why they are not on a bench: bench accounts
are recreated by every continuous-integration run, and accounts that vanish
nightly test nothing.

This document exists because #47 asks for the entry point to be _documented_,
not only created. An entry point nobody wrote down is one the next person
rediscovers by querying a database, which is how this document came to be
written.

## The entry point

**`@mmaudet:messagr.eu`**, created 5 September 2026 with the production
registration token, holding one encrypted conversation shaped as this product
shapes them — `invite` at 50, members at 0 — which is what lets it issue
invitations at all: the graph cannot start from nothing, since creating an
invitation requires an account that already has the right to invite somewhere.

It is a named person's account rather than a random localpart, deliberately.
The product's pseudonymity does not require its _entry point_ to be anonymous,
and somebody should be answerable for who gets in.

Its credentials live outside this repository, in
`~/.messagr-exploitation/racine-mmaudet.json` on the operator's machine.
Nothing in this repository should ever contain them.

## The root that came before, and no longer issues

**`@maria:messagr.eu`** was the entry point until 5 September 2026 and is the
root of everything on the instance today: 58 invitations issued, and an
invitation graph of 108 invitations, 85 reserved accounts and 79 edges hanging
off it.

**It keeps its tree and stops issuing.** Nothing technical enforces that, and
saying so is the point — lowering its power in its own demonstration room
would be a one-way door, since it is that room's only administrator and could
not restore itself. So the rule lives here rather than in a permission, and a
new invitation appearing under `@maria` after this date is a mistake rather
than a decision.

Its tree cannot be reparented onto the new root. Matrix has no such operation
and neither does the invitation service: an edge records who invited whom, and
that fact does not change because the product's entry point did.

## The two other accounts that hold the registration token, and why

#47 asks that the production registration token be used "for that account and
nothing else". **It is not, and the deviations are deliberate.** Recording
them is what makes them deliberate rather than merely discovered; a reader who
finds four roots and no explanation is right to be alarmed.

**`@exploitation:messagr.eu`** is the operations account. It is what
`admin-messagr.sh` acts as, and it exists so that operating the instance does
not mean acting as the account entrants are rooted under. It has issued one
invitation.

**`@test-root-bb5c4069:messagr.eu`** is a throwaway root, and the reason it
exists is the sharpest of the four. The end-to-end promotion probe **writes to
the account it acts as**: every run uploads a fresh cross-signing identity,
replacing whatever it found, and creates a key backup whose decryption key
dies with the run's temporary store. Pointed at a real root it would damage
it — silently, once per run. So the probe was given a root of its own, whose
tree is disposable because nothing of it is in a demonstration room.

**None of these is a bench account.** The distinction matters: a bench
provisions and discards accounts by the dozen, and a homeserver never releases
a localpart, so a bench pointed at production would burn names on the instance
meant to carry real conversations, permanently.
`scripts/provision-bench-accounts.sh` refuses a homeserver whose name contains
`messagr.eu`, and that refusal is about _bench provisioning specifically_. It
is not a rule that production must never be touched: tester builds legitimately
use production, and so do the four accounts above. Reading the refusal as a
general prohibition, and then removing it because production is obviously used,
would be the wrong lesson drawn from the right rule.

## The invitation service

`messagr-invitations-eu` serves `messagr.eu` and has been up continuously
since late August 2026. `https://messagr.eu/_messagr/health` answers `200`.
Registration on the homeserver requires a token: an anonymous `POST` to
`/_matrix/client/v3/register` comes back with a single flow,
`m.login.registration_token`, which is the invariant the whole product rests
on — nobody arrives except by invitation or by the token, and the token is
held by one person.

`messagr-invitations-fork` is the same service on `messagr-fork.maudet.cloud`,
which is the bench. The two are separate containers with separate databases,
and the bench is where anything that provisions accounts belongs.

## What this document is not

It is not an operations runbook, and it does not say how to restart anything.
It says which accounts exist on production that did not arrive by invitation,
and why each one is allowed to. If a fifth appears, either this file gains a
paragraph or the account should not be there.
