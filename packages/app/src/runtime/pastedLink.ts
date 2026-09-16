import { REFUSED } from './claimInvitation'
import type { EntryResult } from './entry'
import { parseInvitationLink } from './invitationLink'

/**
 * An invitation link somebody pasted, and what became of it. #367.
 *
 * # WHY THERE IS A FIELD AT ALL
 *
 * The ordinary way in is the link, touched: the operating system hands it to
 * Messagr and `entry.ts` spends it. That way is closed on an iPhone whenever
 * the invitation is opened inside another messenger's built-in browser --
 * the page's own « Ouvrir dans Messagr » is a link to its own `https` origin,
 * and iOS does not hand a page's link to the application that claims that
 * domain. It is Apple's rule and not a defect to correct. The person can see
 * the invitation, has Messagr installed, and has no door (#308).
 *
 * So there is a second door, and it is the person's hand: they copy the link
 * and paste it.
 *
 * # WHAT THIS DOES NOT DO, AND MUST NEVER
 *
 * IT NEVER READS THE CLIPBOARD. Not at launch, not in the background, not to
 * offer to paste for somebody. An invitation token is a bearer credential --
 * ADR-0004, « whoever intercepts it is the invited person » -- and a
 * clipboard is readable by every other application on the telephone. Today
 * this application writes to the clipboard and never reads it, and that
 * asymmetry is the protection. It may be broken only by a gesture the person
 * makes, into a field they fill, and never by an initiative of the product's.
 * `pastedLink.spec.ts` holds that as a test over the whole of `packages/app`.
 *
 * WHAT THAT COSTS IS SAID WHERE IT IS ASKED FOR, on the field itself
 * (`list_paste_cost`): a copied link is one other applications can read, and
 * it is good for an hour and for a single use.
 *
 * IT DOES NOT READ THE LINK ITSELF. `invitationLink.ts` is the one reader,
 * and a pasted link is exactly the shape it already documents -- « un lien
 * passé par une messagerie peut très bien revenir avec des paramètres de
 * suivi ». A second reader here would be a second definition of what an
 * invitation is, and the two would drift.
 *
 * IT DOES NOT SPEND ANYTHING. What is handed over goes to the very channel a
 * link handed over by the operating system goes through, so there is one
 * entry path and not two: `App.tsx` puts it where a warm link goes, and
 * `spentLinks.ts` and `entry.ts` do the rest exactly as they always have.
 */

/**
 * The link to hand over, or `null` when what was pasted is not an invitation.
 *
 * Read before anything leaves the screen, which is what makes an address that
 * is not an invitation cost nothing: no request, no token, nothing said to
 * any server. The string is handed back whole apart from the spaces a paste
 * brings with it, because the thing that spends it parses it again and must
 * see what the person actually has.
 */
export function invitationPasted(raw: string): string | null {
  const pasted = raw.trim()
  return parseInvitationLink(pasted) === null ? null : pasted
}

/** What became of a link this device pasted and handed over. */
export type PasteOutcome = 'in' | 'refused' | 'retry'

/** What the screen has to say about a pasted link, at each of its moments. */
export type PasteSaid = 'not-a-link' | 'working' | Exclude<PasteOutcome, 'in'>

/**
 * What became of a pasted link, once entry has answered.
 *
 * # ONLY THREE ANSWERS ARE REACHABLE, AND THAT IS NOT A SIMPLIFICATION
 *
 * The field is drawn on one screen: the list's empty state, when this device
 * is not in yet and nothing was lost to a reinstall. A device there holds no
 * session at all -- `entry.ts` answers `entered: false` from exactly the
 * branch where it found none -- so the link goes down the newcomer's road,
 * `claimWithoutAccount`, and comes back entered or with the claim's own
 * reason.
 *
 * # THE DISCRIMINANT IS ENTRY'S OWN
 *
 * `REFUSED` is final and a new link is the only thing that replaces it: the
 * service answers unknown, spent, revoked and expired identically, on
 * purpose, and `claimInvitation.ts` says why telling them apart would rebuild
 * the oracle it refuses to be. Everything else -- a service out of reach, one
 * that failed on its own side, one that did not answer in time, an issuer who
 * has not let the drawn account in yet -- may go through next time, so the
 * answer is to try again rather than to ask for another link.
 *
 * That is the same split `entry.ts` makes between `unusable` and `retry` for
 * a device that already has an account, and #306 is what it cost to have made
 * it once and not twice: a 502 from a restarting service sent somebody
 * holding a perfectly good link to ask for another.
 */
export function whatThePasteBecame(result: EntryResult): PasteOutcome {
  if (result.entered) return 'in'
  return result.reason === REFUSED ? 'refused' : 'retry'
}
