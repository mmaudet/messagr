import type { InvitationOutcome } from './entry'

/**
 * When the list may say what became of the link a launch was opened with.
 *
 * # AFTER THE PUMP, WHERE IT HAD ALWAYS BEEN
 *
 * These sentences were said once the pump had run. #304 moved all of them up
 * to the moment entry answered, and review found the two that then lied.
 * « La conversation qu'elle ouvre va apparaître » reached a device stranded by
 * a reinstall, which can read nothing that arrives. « Demandez-en une
 * nouvelle » reached a launch that could not reach the invitation service,
 * whose link may be perfectly good. Both launches stop before the pump, and
 * that is what had kept them quiet.
 *
 * # ON ENTRY, FOR WHAT #304 ADDED AND NOTHING ELSE
 *
 * A link into another server that was not followed -- the person kept their
 * account, or Messagr has to be reopened first -- is told at once. The reason
 * is owed however the rest of the launch goes, a stranded device included.
 */
export function whenToSay(
  outcome: InvitationOutcome,
): 'on-entry' | 'after-the-pump' {
  return outcome.kind === 'elsewhere' || outcome.kind === 'reopen'
    ? 'on-entry'
    : 'after-the-pump'
}
