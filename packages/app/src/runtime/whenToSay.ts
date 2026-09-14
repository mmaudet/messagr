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
 * # ON ENTRY, FOR WHAT #304 ADDED, AND A CLAIM TO TRY AGAIN
 *
 * A link into another server that was not followed -- the person kept their
 * account, Messagr has to be reopened first, or a yes could not be carried
 * out, whichever of three ways it failed -- is told at once. The reason is
 * owed however the rest of the launch goes, a stranded device included, and a
 * failed yes would otherwise wait on a pump that talks to the very server
 * somebody is leaving.
 *
 * So is a link spent for the account this device holds whose claim may go
 * through next time (#306). That was a refusal said after the pump, on the
 * reasoning above, and a 502 from nginx in front of a restarting service does
 * not stop the pump. `retry` stays true whatever the pump does.
 */
const SAID_ON_ENTRY: ReadonlySet<InvitationOutcome['kind']> = new Set([
  'elsewhere',
  'reopen',
  'unusable',
  'retry',
  'spent',
])

export function whenToSay(
  outcome: InvitationOutcome,
): 'on-entry' | 'after-the-pump' {
  return SAID_ON_ENTRY.has(outcome.kind) ? 'on-entry' : 'after-the-pump'
}
