# Matches are made on the device, against numbers their holders have proved

Address book discovery rests on four choices made together. A phone number
becomes a discovery identity only once its holder has consented and proved it,
by a code received by SMS, and only a findable account may look for its own
contacts. The device matches its contacts itself: the service masks their
numbers with an oblivious pseudorandom function (RFC 9497) without being able
to read them, the device downloads the list of findable accounts under the same
mask, and compares locally. The masking key lives outside the database. And
writing to a match goes through an invitation delivered inside Messagr, which
reveals nothing of the recipient's account until they accept.

## What the service learns, and what it does not

This is the guarantee #38 asks to be written down before any code, and the one
the privacy policy and the store declarations will be checked against.

The service learns:

- the number of every findable account, which the SMS provider sees too. It
  keeps the number only in masked form, but it holds the key, so it can recover
  the number from what it keeps;
- how many numbers have been masked for each proven number, a count it keeps,
  with the number, for 30 days after that number leaves discovery;
- who invites whom, at the moment an invitation leaves.

The service does not learn:

- the numbers in anybody's address book, in clear or hashed;
- who is looking for whom;
- whether a search found anybody;
- the name an inviter gives themselves in an invitation delivered inside
  Messagr, which it passes on sealed for the recipient.

Against a malicious client, the only bound is the quota: at most 5,000 numbers
masked per proven number over a sliding 30 days. Nothing else can stop
enumeration, since a legitimate client must be able to test the numbers it
holds.

The count follows the number, not the account. When a number is withdrawn,
when its proof lapses or when its account is deleted, the number leaves
discovery at once. The service still keeps it for 30 days, the length of the
quota window, masked like everything else and just as recoverable with the
key, together with its count. Proving it again, on the same account or on
another, therefore does not start the count afresh. The privacy policy names
this trace and how long it lasts.

A copy of the database without the keys reveals neither the numbers nor which
accounts are findable. It shows who invited whom, as it does today.

## Why a proof, when 24 August removed it

The prototype's first design proved numbers by SMS. It called this
verification, a word `CONTEXT.md` now reserves for trust states. The proof was
removed on 24 August 2026: an SMS-proven directory added a third party that
sees numbers go by, and identity was left to the recognition ceremony, which
was never wired on iOS.

That reason still holds, and its price is now paid knowingly. Without a proof,
anybody can declare the number of Léa's mother. Léa's telephone matches it to
the contact "Mum" and shows the stranger's account under that name, as
`recognized`, because a match is what recognition means. Discovery would hand
the impostor the very signal meant to expose them.

No means of proof avoids a third party, and the SMS code is the only one that
works for everybody on both platforms:

- an SMS sent _by_ the person cannot be confirmed by the application, and no
  authentication of SMS senders was found deployed in France, so that proof
  could be forged;
- operator verification was not found at Free, passes the number to an
  aggregator, and on iOS works only over the cellular network;
- Google Play withdraws in January 2027 the permission exception a flash call
  needs, and iOS does not expose the calling number.

The SMS goes through OVHcloud, a French processor whose affiliates exclude
every American company. Each message is deleted from its history once delivered,
within a day at the latest, though what OVHcloud keeps as an operator under its
legal obligations stays out of reach. Sinch reaches far more countries, but it
acts as an independent controller for the SMS it carries, may process them
outside the European Union, and offers no way to delete them. It is added
only for a country OVHcloud serves poorly, and the number screen names it for
those numbers. The provider is named in the consent screen and in the privacy
policy.

Numbers change hands. A cancelled number can be given to somebody else after 45
days at the earliest in France and in the United States, but after a month in
Spain for a number that was ported, and across the European Union the only
common floor is the month during which a cancelled number stays portable. A
proof therefore lasts 28 days, the shortest month, and has to be renewed.
Otherwise a reassigned number would lead a stranger's friends to the previous
holder's account, shown as recognized.

Numbers are accepted country by country, for that reason and a few more. A
country opens only once its numbers cannot change hands within a proof's
lifetime, it is under no sanctions, its sender rules are met, the message
arrives intact and its price stays under a ceiling. The first to open are the
countries of the European Union and the European Economic Area, Switzerland
and the United Kingdom.

## Why on the device

The cryptographic specification (§8.3) requires that the service never learn
who is looking for whom, and short of that accepts only discovery through an
identifier shared on purpose.

- **Looking numbers up one at a time**, with tokens that cannot be linked to
  the account, is the prototype's scheme once corrected. But the server keeps
  its access logs, IP addresses included, for 366 days
  (`deploy/messagr-eu/retention.json`), and those alone link the requests back
  to the account.
- **Relaxing §8.3** would have cost the promise that no address book is
  harvested.
- **Comparing on the device** is the only way that meets §8.3 as written.

## Why the phone number, and not an email

An email would have kept "no phone number anywhere" true, and costs almost
nothing to prove. But few address book entries on a telephone carry one, and
discovery exists to find the people one already knows. An email can be added
later without undoing anything here.

## What is kept from the prototype, and what is not

The RFC 9497 construction it implemented, checked against the RFC's test
vectors, is kept, in the RFC's verifiable mode, which it did not use. Its
architecture is not. It returned the Matrix identifier of
the account found to anybody holding the number, queried the service number by
number with tokens its own specification admitted were linkable, kept its key
in the same database as the directory, and counted its quota over fixed 30-day
periods.

## When the masking key changes

A new key makes every masked number useless: the results devices keep and the
list of findable accounts alike. And the service sees a proven number in clear
again only when its proof is renewed.

- **Once a year, as planned.** Both keys serve together for as long as a proof
  lasts, and every proof renewed in that time moves to the new key. By the end
  every current proof has moved, and the old key is destroyed. No SMS is sent
  for the change: devices redo their comparison once, with a one-off extension
  of their quota on the day of the change.
- **At once, after a theft or a loss.** The old key stops serving immediately.
  Findable accounts stop being findable until their next proof, and are told
  so.
- **No copy of the key outside the server.** A copy would be one more place to
  steal it from, and a lost key costs at most one SMS per findable account.
- **The verifiable mode of RFC 9497.** The service publishes its public key, and
  every device checks that its numbers were masked under it. A change of key is
  therefore visible on every device, and it is what tells a device to redo its
  comparison.

## Consequences

- **Nothing the device sends may depend on a comparison's result** until an
  invitation leaves. A request made only for matches would tell the service
  which searches found somebody.
- **The list grows with the number of findable accounts**, by an estimate of
  1 MB for 10,000 and 10 MB for 100,000. Beyond that it will need another form.
- **Recognition still depends on the service's honesty.** The service holds the
  key and could put any account behind any number in the list. Verification
  (ADR-0004) remains the only defence against the service itself, which is one
  more reason recognition never substitutes for it.
- **The published promises change.** "No phone number appears anywhere in the
  system" stops being true for whoever chooses to be findable, and the store
  declarations list the phone number as collected. What stays true: no address
  book is harvested, a relation starts only with an invitation, and opening an
  account asks for no phone number. The new privacy policy is published 30
  days before discovery goes live, dated and set beside the version in force
  with the list of what changes, since the policy promises that a change is
  announced before it applies.
- **The cryptographic specification has to follow.** It still describes the
  discovery identity as a salted hash (its entity table, its threat table, the
  §6 visibility matrix and its glossary), and §6 limits the service's output to
  a present or absent signal that the device now computes itself. The
  guarantee above goes into §8.3 when the discovery slice is specified.
- **The invitation stays the only door.** An invitation delivered inside
  Messagr goes through the two-stage entry of ADR-0004 unchanged, and discovery
  never grants the right to write.
- **The service bounds what proofs can cost.** Both providers bill fraudulent
  traffic to the customer, and no refund clause was found in either contract.
  Proofs are capped per account, per country per day, and by a monthly budget.
  Past a country's cap or the budget, new proofs wait while renewals still go
  through, so that a fraudster never makes anybody stop being findable.

**Amended on 27 September 2026 (blocking, #406).** A copy of the database also
shows who blocked whom. A recipient may decline an invitation delivered inside
Messagr and block its inviter; the block is a refusal the service keeps, where
a refusal otherwise goes at the invitation's deadline, and it lasts as long as
both accounts exist, lifted by the purge of a deleted account and never by the
announcement of its deletion. The person chooses that trace by blocking, and
the screen that asks says the block does not lift. Nothing tells the blocked
account: its invitations are taken, never delivered, read as pending and run
out, and every limit applies to them as to any other.

**Amended on 27 September 2026 (inviting by SMS, #408).** A contact absent from
Messagr is invited by an ordinary link, sent from the telephone by SMS or by the
share sheet. That link is good for three days where any other is good for an
hour, so the service can tell that it was minted from the results of a search,
for somebody the search did not find there. It learns nothing else of that
person: not the number, which goes to the telephone's messaging application
only, and not who comes in through the link before they do, as for any link.

**Amended on 27 September 2026 (changing the key, #409).** A proof in progress
keeps its number's mask under every key in service, not only the current one,
until it ends. That is how a proof renewed under a new key keeps the reference
devices know the account by and the count of numbers its number had masked,
and how a number proven under the new key ends a proof of it under the old one.
While two keys serve, and for 28 days from the new one's first service, each
proven number may have 5,000 more numbers masked under the new key, so that
devices compare under both keys and nobody drops out of the results before
renewing. A key retired at once takes every mask and count made under it; the
accounts it made findable read that the key changed, which the service keeps
thirty days at most.
