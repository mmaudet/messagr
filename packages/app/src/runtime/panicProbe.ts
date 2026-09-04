import type { CryptoMachineConfig } from './cryptoMachineConfig'
import type { DeviceIdentity } from './deviceIdentity'
import { getErrorMessage } from './errors'

/**
 * A diagnostic, not product code. Issue #27.
 *
 * # The question
 *
 * `encrypt_event` on a scope with no group session does not return an error
 * inside the Rust core: it panics in upstream's own session manager
 * (`matrix-sdk-crypto-0.18.0/src/session_manager/group_sessions/mod.rs:218`,
 * "Session wasn't created nor shared"), and on a tokio worker that panic was
 * non-unwinding and aborted the process. Observed while linking the crate
 * into a Tauri binary for #15, and recorded in
 * `docs/spikes/tauri-crypto-link.md`.
 *
 * That observation went through the *core* crate directly. The bridge this
 * application uses goes through `matrix-crypto-ffi`, which keeps
 * `panic = "unwind"` precisely so UniFFI's `catch_unwind` can turn a Rust
 * panic into a catchable TypeScript error. Whether that net actually holds
 * for this panic, on this threading model, is not something reading the
 * source settles.
 *
 * # Why it matters beyond the one call
 *
 * The ordering that triggers it is one this application now avoids on its own
 * (`encryptAndSend.ts` shares until the key settles, and refuses to encrypt
 * otherwise). What the answer really decides is whether the net exists at
 * all -- and the net is what stands between malformed, attacker-influenced
 * ciphertext reaching `decryptEvent` or `receiveSyncChanges` and a crash.
 * A self-inflicted call-order bug is an availability defect; a panic
 * reachable from received data is a remote denial of service on an encrypted
 * messenger.
 *
 * # How this answers it
 *
 * By attempting it, not by reading. Nothing here needs a homeserver or an
 * account: a machine is created with a local-only identity and asked to
 * encrypt into a room it has never shared a key for. Either an error comes
 * back and is reported, or the process is gone and there is no report at
 * all -- and the absence is the finding.
 */

export interface ProbeMachine {
  readonly createCryptoMachine: (config: CryptoMachineConfig) => Promise<void>
  readonly encryptEvent: (
    scope: string,
    eventType: string,
    payload: unknown,
  ) => Promise<unknown>
  /**
   * Anything harmless that proves the machine still answers. Asked *after*
   * the provocation: a process that survived a caught panic while leaving a
   * poisoned lock behind is alive with dead cryptography, which is barely
   * better than dying and much harder to notice.
   */
  readonly getDeviceIdentityKeys: (
    userId: string,
    deviceId: string,
  ) => Promise<unknown>
}

export interface ProbeReport {
  /** Whether the machine still answered a harmless question afterwards. */
  readonly stillAlive?: boolean
  readonly outcome:
    | 'caught'
    | 'encrypted'
    | 'unavailable'
    /** Never produced here. Set by the caller before the call, so that a
     * process that dies mid-probe leaves this behind as its last known
     * state. */
    | 'attempting'
  readonly detail: string
}

/**
 * A room this device cannot have a session for. Not derived from anything
 * real: a scope the machine has seen would defeat the whole probe.
 */
const UNSHARED_SCOPE = '!no-session-was-ever-shared-here:example.invalid'

const PASSPHRASE = 'messagr-panic-probe'

export async function probeUnsettledEncrypt(
  machine: ProbeMachine,
  identity: DeviceIdentity,
  storeDir: string,
): Promise<ProbeReport> {
  try {
    await machine.createCryptoMachine({
      userId: identity.userId,
      deviceId: identity.deviceId,
      // Its own directory: this machine must share no state with the one the
      // application uses, or the probe would be asking about a warm store.
      storePath: `${storeDir}/panic-probe/${identity.deviceId}`,
      storePassphrase: PASSPHRASE,
    })
  } catch (cause: unknown) {
    return { outcome: 'unavailable', detail: getErrorMessage(cause) }
  }

  try {
    await machine.encryptEvent(UNSHARED_SCOPE, 'm.room.message', {
      msgtype: 'm.text',
      body: 'this must never reach a wire',
    })
  } catch (cause: unknown) {
    return {
      outcome: 'caught',
      detail: getErrorMessage(cause),
      stillAlive: await stillAnswers(machine, identity),
    }
  }

  // Not a pass. A machine that encrypted into a scope it never shared a key
  // for was not in the state this probe meant to create, so nothing was
  // learned about panics.
  return {
    outcome: 'encrypted',
    detail: 'the machine encrypted into a scope it had never shared a key for',
  }
}

/** Asks the machine something it should always be able to answer. */
async function stillAnswers(
  machine: ProbeMachine,
  identity: DeviceIdentity,
): Promise<boolean> {
  try {
    await machine.getDeviceIdentityKeys(identity.userId, identity.deviceId)
    return true
  } catch {
    return false
  }
}
