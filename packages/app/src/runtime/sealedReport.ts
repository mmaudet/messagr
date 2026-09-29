import { generateKeyPair, sealWithEphemeral, type KeyPair } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import {
  keyBytesOf,
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
 * reason and the reporting account's ID travel unsealed, since the service
 * keeps them, and the seal binds both: a report whose reason or account ID
 * was changed on the way does not open.
 *
 * # FOR THE KEY BUILT INTO THE APPLICATION, AND NO OTHER
 *
 * ADR 0015: the operator key's public half is built into the application, so
 * that nothing can swap it. `sealReport` therefore takes no key, and seals
 * for `OPERATOR_KEY`, the very value `scripts/assert-operator-key.mjs` reads
 * before a store build.
 *
 * # IN TYPESCRIPT, UNTIL THE BRIDGE SEALS
 *
 * ADR 0001, amended on 29 September 2026: the seal belongs in the bridge, and
 * the first release after Apple's refusal seals here, with the assembly of
 * the declared name (`hpke.ts`), in the same format. #482 moves the seal into
 * the bridge without changing a byte of what it produces.
 */

/**
 * `payload` sealed for the operator key built into the application, bound to
 * `binding`, under an ephemeral key drawn for this report alone, in standard
 * base64.
 *
 * Throws a `RangeError` for a reason or an account ID `reportAad` cannot
 * bind. Nothing is sealed then, so nothing is sent.
 */
export function sealReport(
  payload: Uint8Array,
  binding: ReportBinding,
): string {
  return sealReportWithEphemeral(generateKeyPair(), payload, binding)
}

/**
 * `sealReport`, under the ephemeral key given, and for another operator key
 * when one is given: FOR THE TEST VECTORS AND THE TESTS ONLY, which fix the
 * first and seal for the test key. The same ephemeral key used twice for the
 * same operator key gives two reports the same key and nonce, and gives both
 * away.
 *
 * Throws a `RangeError` for a key that is not 32 bytes of standard base64,
 * and what X25519 throws for one of low order, as `hpke.ts` says.
 */
export function sealReportWithEphemeral(
  ephemeral: KeyPair,
  payload: Uint8Array,
  binding: ReportBinding,
  operatorKey: string = OPERATOR_KEY,
): string {
  const recipient = keyBytesOf(operatorKey)
  if (recipient === null) {
    throw new RangeError('operator key: not 32 bytes of standard base64')
  }
  return base64Of(
    toWire(
      sealWithEphemeral(
        ephemeral,
        recipient,
        REPORT_INFO,
        reportAad(binding),
        padded(payload),
      ),
    ),
  )
}
