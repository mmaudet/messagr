/**
 * When the product offers to back up the keys, and when it stops asking.
 *
 * # THE MOMENT, AND WHY IT IS NOT THE FIRST LAUNCH
 *
 * §4.6: *« Recovery does not crush the first-use flow. Soft prompt after the
 * first exchange, first call, or when adding a second device. »* ADR-0013
 * settles it on the first exchange **received**, and the reason is what makes
 * the offer land: before a message has arrived there is nothing to lose, so
 * the promise is abstract and the refusal is free. Afterwards there is a
 * conversation somebody would mind losing.
 *
 * A message this device *sent* is not it. Sending proves the account works;
 * receiving is the first time this device holds a key that only it holds.
 *
 * # ONCE, AND THEN NEVER AGAIN
 *
 * ADR-0013: a line in Réglages and nothing else. *« A product that nags about
 * security teaches people to dismiss it. »* So a refusal is recorded and
 * honoured for good — not for a week, not until the next major version. The
 * way back in is a control somebody goes looking for, which is the only kind
 * of consent worth having about a secret they have to keep.
 *
 * # WHY THIS IS A MODULE AND NOT AN `if`
 *
 * Three facts decide it and each arrives from somewhere different: whether
 * the backup is already on, whether the person has already been asked, and
 * whether a message has arrived. Spread across a screen they would be three
 * conditions nobody could test; here they are one function and a table.
 */

export type BackupOffer =
  /** Say nothing. Almost every launch, and every launch after a refusal. */
  | { readonly offer: false }
  /**
   * Offer it, once. The caller records that it asked **before** the person
   * answers: an offer interrupted -- the application killed, the screen
   * turned -- is an offer that was made, and asking again would be the
   * nagging this decision refuses.
   */
  | { readonly offer: true }

export function offerBackup(state: {
  /** Whether keys are already going somewhere. */
  readonly backedUp: boolean
  /** Whether this device has ever put the question. */
  readonly asked: boolean
  /**
   * Whether a message from somebody else has ever arrived on this device.
   *
   * Received, not sent: sending proves the account works, receiving is the
   * first time this device holds a key nobody else has.
   */
  readonly received: boolean
}): BackupOffer {
  if (state.backedUp || state.asked || !state.received) return { offer: false }
  return { offer: true }
}
