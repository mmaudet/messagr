# Trust and verification: inputs for the lot-2 scoping

Written the night the first increment landed, from what building it and
reading the previous codebase turned up. Not a decision record: the decisions
below are the ones the scoping session has to take, and this exists so it
takes them knowing what is already true.

## What the previous codebase actually did, and did not

The mechanic exists in `~/work/old_messagr` and is worth knowing before
reusing anything from it.

**It answered the inviter's question, not the invitee's.** The ceremony keyed
off a Matrix user id alone (`start_recognition(user_id)`), and **nothing bound
it to the invitation**. The nominal path was human: _"Après quelques messages,
l'inviteur sait si c'est bien sa fille au bout du fil, et il appuie sur un
bouton qui dit « oui, c'est bien elle »"_ (PRD §8.3). The question "is the
person who invited _me_ the one I think?" was never mechanised.

**The ceremony was never a gate.** No call site linked recognition to
promotion. It was dead code for about three weeks, promotion shipped without
it, and `2026-08-11-promotion-historique-design.md` §6.1 ended up recording
_"La promotion sans cérémonie est acceptable en V1."_

**The doctrine shift is sound and worth keeping** (PRD §8.1): _"On a cherché
pendant quatre versions à empêcher l'interception. C'est une course qu'on ne
gagne pas… La v0.20 renonce à empêcher l'interception et entreprend de la
rendre sans valeur."_ The invitation token is bearer by design; whoever
intercepts it is the invited person. The answer is to bound what that buys,
not to try to prevent it.

**A short out-of-band code was audited and killed** (2026-08-09): 7 500 to
12 800 lines, two to three months, four blockers, two fatal — _"le code court
est forgeable hors ligne en 2,5 s."_ A full key fingerprint is not that
proposal and does not carry that flaw; a short human-typed code is, and does.

**The wording research is better evidenced than most technical decisions in
either repository**, and it binds whatever is built: Dechand (USENIX 2016)
measured 6.4 % missed attacks, Schröder (EuroUSEC 2016) 21–25 %, Vaziripour
(SOUPS 2017/18) a success rate moving from 14 % to 90 % **on wording alone**.
Hence PRD §8.3: _"Le libellé décide plus que le mécanisme. Aucun écran ne doit
porter le mot « vérifier »."_ It is recognition, not authentication, and the
realistic attacker belongs to the same social circle.

## The constraint that decides the shape

Proving _who_ someone is requires a channel the app does not control. The
crypto library states it plainly: _"Two people who can talk to each other out
of band read a seven-symbol string off their screens."_ No amount of interface
work removes this.

The useful consequence: **the invitation is already such a channel.** A link
travels by Signal, by SMS, by a screen shown across a table — never through
Messagr. That is what makes it usable as evidence rather than merely as a
door.

## Recommended shape

Three layers, because remote verification has to work in most cases and
in-person is the minority.

1. **The link carries the inviter's identity fingerprint.** Zero gestures,
   works remotely, always. It proves the inviting account holds the key the
   link announced. It does **not** prove the link reached its recipient
   unaltered — a compromised carrying channel substitutes both. This is
   pinning, not authentication, and calling it anything else would be the
   product lying about its own trust model.
2. **SAS emoji, remotely**, over whatever channel the two already share.
   Seven emoji, which is what the library implements. It must be _bound to
   the invitation_ — offered as "confirm this is the person who invited you",
   prefilled on the inviter — and not as a generic device entry in a menu.
   That binding is precisely what the previous codebase lacked.
3. **QR in person**, strongest, when the two happen to be together. The scan
   is the out-of-band channel.

## The escalation question, and why a naive gate is worse than nothing

**Do not gate promotion on the ceremony.** If comparing emoji is what stands
between someone and using the application, they will say the emoji match.
That is the psychology the studies above measure, and they measured it on
people who were _not_ in a hurry. A gate also makes an invitee's first use
depend on the inviter being awake and available at that moment, which is not
a security incident but a broken product.

**A purely optional escalation does not work either**, and the previous
codebase is the evidence: optional, and therefore never wired, never used,
and eventually written off in the PRD.

**So gate on the pinning, not on the ceremony.** Layer 1 is automatic and
free, so let it be the normal discharge: a fingerprint that matches promotes
the entrant with no human gesture at all. The gate bites only when layer 1 is
absent or fails — an older link, a link retyped by hand, a genuine mismatch —
and layer 2 is what discharges it there. A mismatch should be loud; it is the
one place friction is correct.

This keeps both invariants: limited rights until verified becomes real, and
§4.1's _"No trust ceremony imposed before first use"_ stays true on the
nominal path, because verification there is automatic.

## What the limited period should restrict, in priority order

1. **Cannot invite.** The only genuinely critical one: it is the propagation
   vector. An intercepted token that reads one conversation does bounded
   damage; one that mints accounts is a foothold that grows. The previous
   codebase was right to forbid it _at the type level_ — `EntrantSession`
   cannot express the operation — rather than by a permission check, because
   there is no check to forget.
2. **Does not appear in discovery**, so an unpromoted account cannot serve as
   social proof to a third party.
3. **Reads and writes the live conversation, but not its past.** This one is
   free: Megolm does not give access to history by default, so the
   restriction is something not done rather than something enforced, and
   promotion is the doing of it. Keep the previous codebase's ordering —
   share history keys **first**, raise the power level **after** — which makes
   the power level a guarantee that the keys already arrived.

**Do not restrict writing.** Writing is what lets the inviter recognise the
person, which is the signal the whole human half of this rests on. Removing
it frustrates the legitimate case, which is nearly every case, and removes the
evidence at the same time.

## The decisions this leaves open

- **Does the inviter still confirm?** The recommendation promotes
  automatically on a fingerprint match, which removes the "oui, c'est bien
  elle" gesture the previous product was built around. That is a real change
  in what the product feels like, and it is the scoping session's to take.
- **What the mismatch screen does.** Refuse outright, warn and allow, or
  allow while marking the conversation. This is the only screen where the
  wording research bites hardest.
- **The words themselves.** Given a 14 % → 90 % swing on wording alone, the
  copy is not a detail to be written afterwards by whoever implements it.
- **Whether promotion is revocable**, and what eviction looks like from both
  sides. The previous codebase's residual risk statement — _"il lit cette
  conversation jusqu'à son éviction"_ — assumes eviction exists.
- **`PROMOTED_POWER_LEVEL = 50` was never verified against a real room.** The
  previous codebase records that homeservers commonly pin
  `m.room.power_levels` at 100 and _"That map was never read back."_ Anything
  reusing that number should read it back.
