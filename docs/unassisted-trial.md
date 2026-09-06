# The unassisted trial

The criterion that says the lot is finished, and the one nobody in the project
can satisfy by working harder. It needs a person who did not write the code to
receive an invitation, install from the store's internal testing track, enter,
exchange encrypted messages, be vouched for, see the conversation's history,
**invite somebody themselves**, and take an audio call — **without being
helped**.

This document is what to do on the day, and what to write down. It exists
because a trial improvised on the spot measures whatever the observer happened
to notice.

## Two tickets, one trial

**#49** is the socle's version: receive, install, enter, exchange, be vouched
for, read the history. **#91** widens it by two steps — issuing an invitation
from inside the application, and taking a call — and it is #91 that closes the
product lot. The path below is written once, with the two new steps marked, so
the same document serves both: run steps 1 to 8 and #49 is answered; run all
ten and #91 is.

## Before the day

- [ ] A build carrying the vouching gesture is **on the internal testing
      track**, not on a laptop. Sideloading fails the trial by definition:
      what is being tested includes the distribution.
- [ ] **That build can be woken.** #90 gives the application a pusher and
      `services/invitations` a push gateway; a build whose Firebase
      configuration is missing registers no pusher and fails silently, so
      step 5 would measure the wrong thing. Confirm a notification arrives on
      the test device with the application closed _before_ the day.
- [ ] **The invitation link opens the application _on a build from the
      track_.** The item most likely to be ticked wrongly. Android App Links
      verify against `/.well-known/assetlinks.json`, which declared a dead
      package name until 6 September 2026 — and which today names the
      fingerprint of a build installed **by hand**. Play App Signing re-signs
      the upload with a certificate Google holds, and that is what reaches a
      device from the internal testing track, so a link that opens the
      application on the observer's own phone may still open a browser on the
      participant's (**#114**, which needs Play Console access). Tap a real
      link on a device that installed from the track, not on one that was
      sideloaded. If it opens a browser the trial is still runnable — the
      landing page offers **Copy the link**, which is what carries an
      invitation across an install — but write down that step 1 measured
      that path rather than the other one. It is a different finding, not
      the same step gone badly.

- [ ] **The language the person reads is one of the six.** French, English,
      German, Spanish, Italian, Dutch. The first screen offers the choice
      (#103) and there is no fallback: a seventh language is a person meeting
      a screen in somebody else's.
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
3. **The promise, the language and the terms.** Before anything is claimed,
   the first screen states what the product promises, offers the six
   languages on a strip under the thumb, and will not continue until the
   terms are ticked (#103). Watch three things: do they find their own
   language without being told the strip scrolls; does the screen retranslate
   in a way they notice; and do they tick the box or press the action first
   and learn about the box from its refusal? A gate somebody walks into is a
   gate that was not visible.
4. **Entry.** The link is claimed. Do they know they are now _in_ something,
   and in something _with somebody_?
5. **Sending a message.** Do they find the composer? There is no send button
   — the return key sends — so watch for a hand hunting for one. Does the
   message appear?
6. **Reading a reply, with the application closed.** The inviter answers
   while the person's phone is locked or the application is shut.

   **THIS IS THE STEP THAT CHANGED, AND THE CHANGE IS THE POINT.** This
   document used to predict it would be the worst moment of the trial: there
   was no live sync (ADR-0005), so a relaunch was how anything arrived, and
   somebody waiting at a screen that never changed was the expected finding.

   ADR-0007 gave the application its own sync loop, and #90 gave it a pusher
   and a push gateway, so a message now wakes a closed phone. The prediction
   is obsolete — and it is kept here rather than deleted, because what
   replaced it is a _different_ set of things to watch, and a reader who only
   saw the new list would not know which ones are new:

   - Does the notification arrive at all, and how long after the message?
   - Does it say enough to be worth opening? #107 decides what a woken device
     may say before it has decrypted anything.
   - Does tapping it land in the _right_ conversation, or at the list?
   - And if the phone is unlocked with the application open, does the message
     simply appear — no pull, no relaunch, no gesture?

   Record what they did while waiting even when the wait is short. Somebody
   who locks the phone and watches it is telling you something different from
   somebody who opens the application to check.

7. **Being vouched for.** The inviter performs the gesture. Nothing is asked
   of the person. Do they notice anything changed? Does the line about
   history arriving mean anything to them?
8. **Reading the history.** Do they scroll up? Do they realise there is a
   past they can now read, or does it simply look like a longer conversation?

   _#49 is answered at the end of step 8. The two below are #91's._

9. **Inviting somebody themselves (#83, #113).** Hand them a second person to
   invite — someone in the room, with a phone. Do they find the action? The
   invitation is a link _and_ a QR code shown side by side: which do they
   reach for with somebody standing next to them, and do they understand
   that the link is valid for an hour and works once? Watch for the person
   who reads the link aloud rather than showing the code, and for the one who
   shows the code to a phone that has no application yet — that is the
   landing page's job (#106) and this is where it is tested.

   And watch what they call it. "Invitation" is the whole entry model of this
   product; somebody who says "I'll add you" has understood something else.

10. **Taking a call (#88, #89).** The inviter calls. Does the phone ring when
    it is locked? Do they know how to answer, and does the audio work in both
    directions?

    **THIS STEP CANNOT BE RUN YET.** #88 and #89 are not built. It is written
    here now so that the day they land, the trial's shape is already decided
    rather than improvised — and so that a trial run before then is honest
    about ending at step 9 rather than quietly redefining what "the whole
    path" means.

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
  filed as a comment on the ticket the run was for (#49 for steps 1 to 8,
  #91 for the whole path).
- **Anything that blocked the path outright → its own ticket**, not a note.
  A blocker buried in a paragraph is a blocker nobody schedules.

## What this trial cannot tell you

It has one participant. It finds the things that are obviously wrong to
somebody seeing them for the first time, which is most of what is wrong at
this stage, and it says nothing about what a hundred people would find. Do not
read a pass as evidence the product is clear; read a failure as evidence it is
not.

It also has **one language**, whichever the person reads. The other five are
held by the compiler — a catalogue missing a key does not build — and by
nothing else. A screen that is grammatical and wrong in Dutch passes every
check this project has, and this trial will not find it either unless the
person happens to read Dutch. Worth choosing the participant with that in
mind at least once.
