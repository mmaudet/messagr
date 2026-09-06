# Reactions are encrypted like everything else

A reaction is sent as an encrypted event, decrypted by the recipient, and
aggregated by the application. It is not sent as a plaintext `m.reaction`, as
the rest of the Matrix ecosystem does.

## Why this is a decision and not a detail

Matrix's convention is that reactions travel **unencrypted**. Element sends
them that way, and there is a reason: aggregation of annotations is specified
server-side, and a server cannot aggregate what it cannot read. A client that
encrypts its reactions leaves that machinery unable to help it.

So the convention is not arbitrary, and departing from it costs something
real. It is written down here because a later reader will find `m.reaction`
absent from this codebase and reasonably wonder whether it was forgotten.

## What the convention publishes

An unencrypted reaction carries, in the clear: who reacted, to which event,
with which emoji, and when. On a server that is otherwise told nothing about a
conversation's contents, that is a remarkable amount — the shape of a
conversation, its rhythm, who agrees with whom, and often enough its subject.

This product's whole posture is that the operator holds messages it is
cryptographically unable to read. #84's own ticket makes the same argument
about read receipts: _"a product that refuses to let a server read content and
then publishes the hour somebody read it contradicts itself"_. A reaction is
the stronger case, because it carries a payload and not merely a timestamp.

## Why the cost is small here and would not be elsewhere

**This application aggregates its own reactions**, because ADR-0005 already
made the timeline the application's own state. There is no server-side
aggregation to lose, because there was none being used. What another client
would have to give up, this one never had.

**Nothing else reads this conversation.** The product is its own client. The
day a Messagr conversation must be legible to Element, this decision is one of
the things that will have to be paid for — along with the given names, the
history bundles, and every other place the product does its own thing. That
day is not in this lot, and pre-paying for it by leaking now would be paying
before there is anything to buy.

## The cost, stated plainly

**A reaction whose key never arrived is unreadable**, exactly like a message.
The application already shows an unreadable message as unreadable rather than
dropping it; an unreadable reaction is simply not counted, which is quieter
and slightly worse — a count that is short by one looks like a correct count.

**Redaction still leaks.** Removing a reaction is a redaction, and a redaction
names the event it removes. The server learns that somebody withdrew
_something_ attached to a particular message. Encrypting the reaction hides
what it was, not that it happened.

**No interoperability.** A third-party client in the same conversation sees an
encrypted event it will render as an unreadable message, not as a reaction on
another message. That is worse than not seeing it at all, and it is the
sharpest edge of this decision.

## Consequences

Reactions go through `encryptEvent` with their own event type and the ordinary
`m.relates_to` shape inside the ciphertext, so nothing about the payload is
novel — only where the boundary sits. `buildTimeline.ts` learns to recognise a
decrypted reaction and fold it into the message it points at, which is where
the aggregation the server would have done now happens.
