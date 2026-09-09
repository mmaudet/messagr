import type { ConversationSummary } from '../runtime/conversationList'

/**
 * Which conversations a picker may offer.
 *
 * A function rather than a filter written inside the sheet, for the reason
 * this repository tests logic and not components: the rule here is worth
 * asserting, and none of the drawing is.
 */

/**
 * Everything but the one it came from.
 *
 * FORWARDING INTO THE CONVERSATION IT IS ALREADY IN IS NOT A GESTURE, and
 * only the caller knows which that is -- the sheet is a piece with several
 * futures (#194, and sharing a contact after it), so the exclusion is an
 * argument rather than a rule it carries.
 *
 * `undefined` excludes nothing, which is what a caller with nothing to
 * exclude means.
 */
export function pickable(
  summaries: readonly ConversationSummary[],
  except?: string,
): readonly ConversationSummary[] {
  if (except === undefined) return summaries
  return summaries.filter(summary => summary.scope !== except)
}
