import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * The independent counterparty, `matrix-nio`, run for one of its phases.
 *
 * Shared by every suite that needs the other side of the bench: why a
 * subprocess rather than a second device is in roundTrip.test.ts. Each phase
 * fails the suite by its exit code, and says why on the suite's own output.
 */
const COUNTERPARTY = resolve(
  __dirname,
  '../../../scripts/interop/nio_counterparty.py',
)

export function runCounterparty(
  phase:
    | 'send'
    | 'send-file'
    | 'claim-place'
    | 'witness-eviction'
    | 'witness-deletion'
    | 'revoke-invitation',
  extra: Record<string, string> = {},
): void {
  execFileSync('python3', [COUNTERPARTY, phase], {
    env: { ...process.env, ...extra },
    stdio: 'inherit',
    // Long, because a phase can query keys and share a group session against
    // a real homeserver before it does anything else.
    timeout: 120_000,
  })
}
