# The unassisted trial

#49 is the criterion that says the lot is finished, and it is the one nobody
in the project can satisfy by working harder. It needs a person who did not
write the code to receive an invitation, install from the store's internal
testing track, enter, exchange encrypted messages, be vouched for, and see the
conversation's history — **without being helped**.

This document is what to do on the day, and what to write down. It exists
because a trial improvised on the spot measures whatever the observer happened
to notice.

## Before the day

- [ ] A build carrying the vouching gesture is **on the internal testing
      track**, not on a laptop. Sideloading fails the trial by definition:
      what is being tested includes the distribution.
- [ ] The person's Google account is enrolled as an internal tester, and they
      have opted in through the tester link, on their own device, before the
      session.
- [ ] The inviter is `@mmaudet:messagr.eu` — the production entry point (see
      `production-entry-point.md`). Not a bench account: the trial goes
      through the real service or it proves nothing about the real service.
- [ ] The observer has this document open and somewhere to write.

## The rule that makes it a trial

**No help. None.** Not a hint, not a "try tapping there", not reading the
screen aloud. The person may ask; the answer is "I would like to see what you
do without me". That refusal is itself data: **write down every question
asked**, because a question asked is a screen that did not answer it.

The single exception is a hard stop — the application crashes, or a step is
impossible rather than unclear. Then help, and record that the path was
blocked rather than confusing. Those two are different findings and lead to
different work.

## The path, and what to watch at each step

Time each step from the person's first look at the screen to the moment they
act. The number matters less than where the long ones are.

1. **Receiving the invitation.** They are sent a link. Do they know what it
   is? Do they open it, or do they ask what it is first?
2. **Installing.** From the tester link, through the store. Watch for the
   step where the store says the app is unavailable — a known confusion when
   the opt-in has not propagated.
3. **First launch and entry.** The link is claimed. Does the screen say
   anything they understand? Do they know they are now _in_ something?
4. **Sending a message.** Do they find the composer? Does the message appear?
5. **Reading a reply.** The inviter answers. Do they see it arrive, or do
   they relaunch to find it? (There is no live sync — ADR-0005 — so a
   relaunch is currently how anything arrives. **Expect this to be the worst
   moment of the trial**, and record exactly what they did while waiting.)
6. **Being vouched for.** The inviter performs the gesture. Nothing is asked
   of the person. Do they notice anything changed? Does the line about
   history arriving mean anything to them?
7. **Reading the history.** Do they scroll up? Do they realise there is a
   past they can now read, or does it simply look like a longer conversation?

## What to write down

For every step, one line each, even when nothing happened:

    step  what they did  how long  what they said  what they asked for

And then, at the end:

- **Every question asked**, verbatim, and what the answer would have been.
- **Every wrong turn**, including ones they recovered from unaided. A recovery
  is not a success; it is a screen that misled somebody who was clever enough
  to escape it.
- **The moment they were least sure of what was happening.** Ask them
  afterwards. It is rarely the step the team expects.
- **What they thought the product was for**, in their own words, after using
  it. If that answer is wrong, no screen fixed it.

## What happens to the findings

**Recorded whether it passed or not.** A trial that only reports success has
measured nothing, and a trial nobody wrote up did not happen.

- Confusion, hesitation, a question asked → a line in the trial's write-up,
  filed as a comment on #49.
- **Anything that blocked the path outright → its own ticket**, not a note.
  A blocker buried in a paragraph is a blocker nobody schedules.

## What this trial cannot tell you

It has one participant. It finds the things that are obviously wrong to
somebody seeing them for the first time, which is most of what is wrong at
this stage, and it says nothing about what a hundred people would find. Do not
read a pass as evidence the product is clear; read a failure as evidence it is
not.
