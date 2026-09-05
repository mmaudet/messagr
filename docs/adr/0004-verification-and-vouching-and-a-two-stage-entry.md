# Verification and vouching, and a two-stage entry

An invitation carries the inviter's identity fingerprint. The joining
application pins it, and a match lets the entrant participate: join, read the
live conversation, write in it. It does not grant history and does not grant
the right to invite. Those come from a second, human gesture — the inviter **vouching** for the
person after a few exchanges — and that is what promotion means.

## Why two, and not one

They answer different questions, and each is blind to the other's.

The fingerprint proves **which account** issued the invitation. It says
nothing about **which human** holds it: an inviter's stolen phone produces an
invitation whose pin matches perfectly. Only the inviter, reading how the
newcomer writes, catches that.

Vouching proves the opposite direction and has the opposite blind spot: it
says who arrived, and nothing about whether the link the newcomer followed was
the one that was sent.

**The words here are the glossary's, and an earlier draft of this document got
them wrong.** `CONTEXT.md` reserves _verification_ for the cryptographic act —
comparing a short string, scanning a code — and _recognition_ for reaching
`recognized` through the address book. That draft used both against those
definitions, calling the emoji ceremony something other than verification and
the inviter's judgement a recognition. It is the exact confusion the glossary
warns is the most common error in this domain, committed in the document that
settles the area. The inviter's judgement is **vouching**; `entrant` and
`promotion` are _membership_ statuses rather than trust states, so an entrant
may be fully verified and still be an entrant.

An earlier draft of this decision treated them as alternatives and proposed
dropping vouching, on the grounds that the pin had already done the work. That was a conflation of two directions, and it would have removed
the only defence against a compromised inviter account.

## Why the ceremony is not the gate

The emoji comparison discharges the gate when pinning cannot — an old link, a
link retyped by hand, a genuine mismatch — and is available as a voluntary
escalation otherwise. It is deliberately not what stands between a person and
using the application.

If it were, people would confirm without comparing. That is what the research
the previous product assembled measures: 6.4 % missed attacks (Dechand,
USENIX 2016), 21–25 % (Schröder, EuroUSEC 2016), and a success rate moving
from 14 % to 90 % **on wording alone** (Vaziripour, SOUPS 2017/18) — all on
people who were not in a hurry. A ceremony standing between someone and their
messages adds the hurry. It would make verification less truthful, not more.

A gate also makes an invitee's first use depend on the inviter being awake:
SAS needs both parties at once. Someone joining at midnight, unable to do
anything until morning, is not a security posture. It is a broken product.

The opposite failure is just as documented, in the previous codebase itself:
made optional, the ceremony was never wired, was dead code for three weeks,
and was eventually written off — _"La promotion sans cérémonie est acceptable
en V1."_ Optional security in a consumer product does not happen.

## Consequences

**A mismatch does not refuse the join.** It leaves the entrant unpromoted and
says so plainly. Refusing outright would break the two legitimate causes of a
mismatch — an inviter who rotated their identity, and a stale link — which
will be most of them.

**Eviction exists, and it rotates the room key.** The doctrine inherited from
the previous product is that the invitation token is bearer and the answer is
to make interception worthless rather than to prevent it; its residual-risk
statement, _"il lit cette conversation jusqu'à son éviction"_, assumes an
eviction that must therefore exist. Without a key rotation, eviction removes
only the right to write: the evicted party keeps reading everything that
follows with the key it already holds. That is security theatre, and it is the
detail most often left out.

**History is withheld by not being given.** Megolm shares no past by default,
so an entrant reading only the live conversation costs nothing to enforce.
Promotion is the act of sharing history keys, and it happens **before** the
power level rises, so that the power level is a guarantee the keys already
arrived — an ordering the previous codebase discovered repaired a defect it
had not set out to fix.

**How the history half became true, recorded because it nearly did not.**
This decision said promotion shares history keys before the power level
rises, and for a while nothing could do it. Two findings, in order.

First, the obvious mechanism does not work and looks like it does.
`shareScopeKey` shares a Megolm session, and the natural assumption is that
sharing it late gives the recipient everything it ever encrypted. It does
not: `vodozemac`'s `GroupSession::session_key()` exports the session **at
its current message index**, so a session built from that key decrypts from
there forward. Both branches land in the same place — share the existing
session and the newcomer reads nothing earlier; rotate instead and the
newcomer reads nothing earlier. Setting `history_visibility` to `shared` on
the server does not help either: it lets a newcomer _fetch_ the past events,
and gives them no key to open them. They would hold ciphertext, not history.

Second, the mechanism that does work was already in the crypto library and
not reachable. [MSC4268] room key bundles: the inviter assembles the
sessions they hold, encrypts them into a file, uploads it, and tells the
invitee where it is over an encrypted to-device message.
`matrix-sdk-crypto` 0.18 implements every cryptographic step and exposes
none of it to React Native. That exposure was added to the bridge rather
than worked around here, because the alternative was to weaken this decision
to match a bridge, which is the wrong direction for a decision to move.

**The ordering has a step that is easy to leave out, and it is not the
obvious one.** Announcing the bundle only _queues_ the announcement: every
outbound message the crypto library produces is queued for the application
to send. So raising the power level right after the announcing call —
which reads as correct, and passes any test that does not look — publishes a
level whose history is still sitting in a queue. That is the exact inversion
this ordering exists to prevent, reached by a route that looks like
compliance. The gesture therefore waits for a drain that reports a
`to_device` request actually sent, and refuses to promote otherwise.

[MSC4268]: https://github.com/matrix-org/matrix-spec-proposals/pull/4268

**Inviting is impossible to express, not checked and refused.** An entrant's
session type cannot name the operation. A check is something to
forget; an absent method is not.

**`senderTrustRequirement` stays at `'any'` until cross-signing exists.** The
stricter values withhold plaintext from devices no identity vouches for, and
this application creates no identities, so every device is in that category:
tightening now would refuse everything. The question becomes real the day
identities are bootstrapped, not before.

**No screen carries the word "verify".** This is recognition, not
authentication, and the realistic attacker belongs to the same social circle
as the people using it. Given the 14 %-to-90 % swing above, the copy is not a
detail to be settled by whoever implements the screen.
