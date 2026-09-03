/**
 * Whether the crypto bridge's native module is loaded and answering across the
 * JSI boundary.
 *
 * The library is a turbo module: on the legacy architecture, or in a bundle
 * where the native side did not link, it does not degrade quietly, it is
 * absent. Asking it to echo something and checking what comes back is the
 * cheapest proof that the whole chain is present, because a stub that merely
 * resolved would pass a call that only checked for the absence of a throw.
 */
import { getErrorMessage } from './errors'

export type BridgeStatus =
  | { readonly loaded: true; readonly coreVersion: string }
  | { readonly loaded: false; readonly reason: string }

/** What the core returns from a probe. Exported: any `ProbeFn` must produce it. */
export interface ProbeReport {
  readonly echoed: string
  readonly payload: Uint8Array
  readonly coreVersion: string
}

export type ProbeFn = (
  input: string,
  payload: Uint8Array,
) => Promise<ProbeReport>

const INPUT = 'messagr'
const PAYLOAD = Uint8Array.from([0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x72])

// The core reverses the payload it is given. That is its documented contract,
// and asserting it rather than identity is what makes this a real proof: a
// stub that echoed the input back untouched would satisfy an identity check.
function isReversalOf(returned: Uint8Array, sent: Uint8Array): boolean {
  return (
    returned.length === sent.length &&
    returned.every((byte, i) => byte === sent[sent.length - 1 - i])
  )
}

export async function fetchBridgeStatus(probe: ProbeFn): Promise<BridgeStatus> {
  let report: ProbeReport
  try {
    report = await probe(INPUT, PAYLOAD)
  } catch (cause: unknown) {
    return { loaded: false, reason: getErrorMessage(cause) }
  }

  if (report.echoed !== INPUT) {
    return { loaded: false, reason: 'the bridge altered the text it echoed' }
  }
  if (!isReversalOf(report.payload, PAYLOAD)) {
    return {
      loaded: false,
      reason: 'the bridge did not reverse the bytes it was given',
    }
  }
  if (report.coreVersion.length === 0) {
    return { loaded: false, reason: 'the bridge named no core version' }
  }

  return { loaded: true, coreVersion: report.coreVersion }
}
