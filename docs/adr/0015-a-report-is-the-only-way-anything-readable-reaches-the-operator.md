# A report is the only way anything readable reaches the operator

The operator holds messages it cannot read, and the published terms drew the
consequence: no filter, no takedown of a particular message, and no measure
taken on a reporter's word alone. Apple's guideline 1.2 asks any application
with user-generated content for terms with no tolerance for objectionable
content or abusive users, a way to report content, a way to block an abusive
user that removes their content at once and tells the developer, and action
within 24 hours that removes the content and ejects its author. Build 27 was
refused on it on 29 September 2026.

End-to-end encryption does not stand in the way, because a recipient holds
the plaintext. So: **a report is the only way anything readable reaches the
operator**, and what the operator reads of a conversation is never more than
a report carries.

## What a report carries, and who can open it

- The messages the recipient selects, as they read them, with a reason taken
  from what the terms forbid. A photograph or a document goes as the key to
  its encrypted copy, already on the server; nothing is uploaded again.
- It is sealed on the device for the operator key. Its public half is built
  into the application, so the service cannot swap it; its private half lives
  on the operator's own machine, with one offline copy. The service keeps a
  sealed report it cannot open, and a copy of its database shows nothing that
  was reported. The seal belongs in the bridge, as ADR-0001 requires of
  anything that seals more than a declared name; the first release seals in
  TypeScript, in the same format, until a release of the bridge carries it
  (ADR-0001, amended the same day).
- It receives a report number. Whoever sent it learns the decision by writing
  to the operator with that number. An account sends ten reports a day at
  most.
- Its content is erased six months after the decision, unless it was handed
  to the authorities. What was decided is kept, never what was said.
- It is optional, rare, and names the account sending it, which is how the
  store declarations treat it: Apple's optional disclosure, not a collection
  of user content.

## What the operator does, and when

- Each report sends the operator an SMS without content, grouped at most once
  every fifteen minutes.
- Within 24 hours the operator reads it and, where it shows what the terms
  forbid, takes the reported messages down for everyone, then suspends their
  author. A takedown leaves a line saying the operator took the message down.
  A suspension locks the account on the homeserver: reversible, and keeping
  its devices, keys and conversations. The takedown comes first, because the
  homeserver redacts as the author, who must still be a member.
- A reasoned decision follows within thirty days and can be contested. If it
  confirms the suspension, the account is terminated.
- A measure rests on what the report shows, which the operator reads, and not
  on the reporter's word. That is the form in which « jamais sur la seule
  affirmation d'un signalant » survives.
- A suspended device says it is suspended and how to contest. A terminated one
  says the operator closed it, rather than that it was deleted.

## One block

A block is one lasting relation between two accounts, whether made on an
invitation delivered inside Messagr (ADR-0014, amended on 27 September) or
from a conversation. The homeserver ignores the blocked account for whoever
blocked it, so nothing it sends arrives and what it wrote leaves their
screens; the service keeps it from delivering invitations. A direct
conversation leaves the list without the device leaving the room, so the
blocked account sees nothing change. A block does not lift, as decided on 27
September; unblocking would be a ticket of its own.

The service records who blocked whom, never what was said, and one SMS a day
counts the blocks without naming any account. The homeserver's account data
now shows who ignores whom, as the service's database already showed who
blocked whom.

## Filtering

There is no content filter on the server, and there cannot be one. What
filters is structural: nobody writes to a person who has not accepted their
invitation, an invitation can be refused or blocked, and the homeserver holds
back a blocked account's messages. Blurring photographs from unknown accounts
on the device was considered, and deferred until Apple asks for it.

## Considered and rejected

- **A verifiable report**, forwarding the room key at the reported message's
  index, so that the operator decrypts the server's own ciphertext and knows
  the text was not invented. It would have kept the former doctrine whole,
  but it needs more of the bridge than a seal, and that key also opens the
  author's later messages in the same session.
- **Metadata only.** Without the text the operator cannot know what was
  reported, which is what Apple asks and what a takedown needs.
- **Reports kept readable in the service.** Simpler on call, but a copy of the
  database would show what was reported.
- **Matrix's own report endpoint.** The homeserver posts the event and the
  reason in its administration room, never the content, and alerts nobody.

## Consequences

The terms in force are replaced on the day the new version is published,
which the version in force allows, in French and in English, the French being
authoritative; the upcoming version for discovery is rebuilt on top of it.
The legal screen in seven languages, the privacy policy, `retention.json` and
the store declarations change with it. The review notes describe both
gestures, and a demonstration account writes to the reviewer once they are
in, so that there is something to report and to block.

**Amended on 30 September 2026.** ADR-0006 governs the application; the
operator's tool, on the operator's own machine, shows a reported photograph or
document only when asked, through a temporary copy in a private directory,
erased once seen, on an interruption or on a failure
(`scripts/lib/ouvrir-un-fichier-signale.mjs`). A reported photograph also
goes with the key to its thumbnail's own encrypted copy, when it has one:
the conversation draws the photograph from it, and the operator sees what the
person reporting saw; the tool shows it the same way, on demand (#496).

**Amended on 30 September 2026 (a decision and a termination, #473).** A copy
of the service's database can relate a confirmed report to an account
deletion by their dates, when deletions are few: both are dated by the day,
and a termination, recorded among the account deletions at midnight UTC,
differs from a deletion announced from the application, which carries its
second.
