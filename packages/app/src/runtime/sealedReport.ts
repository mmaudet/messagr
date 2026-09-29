import { bytesOf } from './base64'
import { generateKeyPair, sealWithEphemeral, type KeyPair } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import {
  padded,
  REPORT_INFO,
  reportAad,
  toWire,
  type ReportBinding,
} from './reportFormat'

/**
 * A report, sealed on the device for the operator key (#465, ADR 0015): what
 * the service receives and keeps, and cannot open. Only the operator opens it,
 * on its own machine, with `scripts/ouvrir-un-signalement.mjs`.
 *
 * The caller assembles the payload in memory, and this module seals it in
 * memory: nothing of it is written anywhere (ADR 0006). What it returns is
 * sealed, and is what the service receives beside the reason code.
 *
 * The format is `reportFormat.ts`'s, which the operator's tool reads too. The
 * reason and the reporting account travel unsealed, since the service keeps
 * them, and the seal binds both: a report whose reason or account was changed
 * on the way does not open.
 *
 * # IN TYPESCRIPT, UNTIL THE BRIDGE SEALS
 *
 * ADR 0001, amended on 29 September 2026: the seal belongs in the bridge, and
 * the first release after Apple's refusal seals here, with the assembly of
 * the declared name (`hpke.ts`), in the same format. #482 moves the seal into
 * the bridge without changing a byte of what it produces.
 */

/**
 * `payload` sealed for `operatorKey` (standard base64, the key built into the
 * application unless told otherwise), bound to `binding`, in standard base64,
 * under an ephemeral key drawn for this report alone.
 *
 * Throws a `RangeError` for a key that is not 32 bytes of base64, or a reason
 * or an account `reportAad` cannot bind; and what X25519 throws for a key of
 * low order, as `hpke.ts` says. Nothing is sealed then, so nothing is sent.
 */
export function sealReport(
  payload: Uint8Array,
  binding: ReportBinding,
  operatorKey: string = OPERATOR_KEY,
): string {
  return sealReportWithEphemeral(
    generateKeyPair(),
    payload,
    binding,
    operatorKey,
  )
}

/**
 * `sealReport`, under the ephemeral key given: FOR THE TEST VECTORS ONLY,
 * which fix it. The same ephemeral key used twice for the same operator key
 * gives two reports the same key and nonce, and gives both away.
 */
export function sealReportWithEphemeral(
  ephemeral: KeyPair,
  payload: Uint8Array,
  binding: ReportBinding,
  operatorKey: string = OPERATOR_KEY,
): string {
  const recipient = publicKeyIn(operatorKey)
  const aad = reportAad(binding)
  return base64Of(
    toWire(
      sealWithEphemeral(
        ephemeral,
        recipient,
        REPORT_INFO,
        aad,
        padded(payload),
      ),
    ),
  )
}

/** The 32 bytes `base64` holds, or a `RangeError`. */
function publicKeyIn(base64: string): Uint8Array {
  let key: Uint8Array
  try {
    key = bytesOf(base64)
  } catch {
    throw new RangeError('operator key: not base64')
  }
  if (key.length !== 32) {
    throw new RangeError('operator key: not an X25519 public key')
  }
  return key
}
