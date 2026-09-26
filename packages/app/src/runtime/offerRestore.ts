import type { SecretStore } from './sessionStore'

/**
 * What a device with an unreadable past should do about it, and in what
 * order.
 *
 * # THE ORDER IS THE DECISION, AND ADR-0013 FIXES IT
 *
 * *« L'appareil montre ses conversations d'abord, illisibles, et propose la
 * clé ensuite. Demander un secret à la porte est ce que fait une banque, pas
 * un messager — et c'est le seul ordre où quelqu'un sans clé n'est pas
 * bloqué dehors. »*
 *
 * So this never gates anything. It answers whether to *offer*, and the
 * screen it belongs to sits beside a conversation list that has already
 * drawn. A device whose owner has lost their key, or never made one, keeps
 * working: the past stays unreadable and the present does not.
 *
 * # WHEN THERE IS SOMETHING TO OFFER
 *
 * Three facts, and all three have to be true at once.
 *
 * **A backup exists on the homeserver, and it holds something this device
 * does not have.** Read from `GET /room_keys/version`, which is the product's
 * request. Without one there is nothing to restore and offering would be
 * offering to open a door that was never built.
 *
 * Two facts rather than one, since #328, and both came from the same defect.
 * Accepting the backup on a telephone whose past is unreadable, and then
 * dismissing the key screen, runs this decision again -- and what the
 * homeserver holds is then the version THIS DEVICE made a moment ago: empty,
 * sealed by the key just shown, and about to be offered as « vos anciens
 * messages sont là ». So a version this device writes to is not offered, and
 * neither is one the homeserver says holds no keys. The second catches it
 * from the other side, on a device whose keystore lost its commitment.
 *
 * A homeserver that names no count is not an empty backup: silence is
 * refused as a reason to withhold the offer, because the cost of being wrong
 * that way is somebody with a key in their hand and no door.
 *
 * **This device cannot read its past.** Not "this device is new": a
 * reinstalled device that was never backed up is in exactly the same
 * position as one that was, and both want the same offer. What decides it
 * is whether anything in view is unreadable.
 *
 * **Nobody has already said no.** Same rule as the acceptance prompt, for
 * the same reason ADR-0013 gives about nagging — and the same door back in,
 * which is Réglages.
 *
 * # WHY UNREADABLE COUNT AND NOT "IS THE STORE FRESH"
 *
 * A fresh store was the obvious test and it is the wrong one. It is true on
 * a device that has never had a conversation, where there is nothing to
 * restore and the offer is noise; and it is false on a device whose store
 * survived but whose keys were partly lost, where the offer is exactly what
 * is wanted. Counting what cannot be read asks the question the person is
 * actually asking, which is *why can I not read this*.
 *
 * It also means the answer changes as keys arrive, which is right: a device
 * that recovers its keys some other way stops being offered a restore
 * without anyone having to remember to withdraw the offer.
 */
export type RestoreOffer =
  /** Say nothing, and show whatever is readable. */
  | { readonly offer: false }
  /**
   * Offer it, beside conversations that have already drawn.
   *
   * `unreadable` is carried so the screen can say how much is at stake
   * rather than "some messages". A number somebody can check against what
   * they can see is the difference between a sentence they believe and one
   * they skip.
   */
  | { readonly offer: true; readonly unreadable: number }

export function offerRestore(state: {
  /** Whether `GET /room_keys/version` found one. */
  readonly backupExists: boolean
  /** How many entries in view this device could not read. */
  readonly unreadable: number
  /** Whether this device has already put the question and been refused. */
  readonly asked: boolean
  /**
   * Whether the version the homeserver holds is the one this device writes
   * to, from the keystore commitment (#328).
   *
   * Its keys are the ones this device already has, by definition, so it can
   * restore nothing -- and a device that has just accepted is in exactly
   * that position, with an empty version and the offer about to fire.
   */
  readonly mine: boolean
  /**
   * How many keys the homeserver says the version holds, or `null` when it
   * named none. See `backupCalls.ts`: `null` is unknown, never zero.
   */
  readonly keys: number | null
}): RestoreOffer {
  if (!state.backupExists || state.asked) return { offer: false }
  if (state.unreadable <= 0) return { offer: false }
  if (state.mine) return { offer: false }
  // `<= 0` rather than `=== 0`, like the count above and for the same reason.
  if (state.keys !== null && state.keys <= 0) return { offer: false }
  return { offer: true, unreadable: state.unreadable }
}

/**
 * Whether this device has already put the question.
 *
 * **Defaults to TRUE when the store will not answer**, which is the same
 * direction `backupPrompt.ts` chose and for the same reason: of the two ways
 * to be wrong, asking again somebody who already said no is the one this
 * product refuses. A device whose keystore is having a bad day says nothing
 * and offers the door in Réglages instead.
 */
export async function askedToRestore(store: SecretStore): Promise<boolean> {
  try {
    return (await store.read()) !== null
  } catch {
    return true
  }
}

/**
 * Records that the question was put.
 *
 * Called BEFORE the answer, like the backup's: an offer interrupted -- the
 * application killed, the screen turned -- is an offer that was made, and
 * asking again is the nagging ADR-0013 refuses.
 *
 * `false` when it could not be kept, rather than a throw. Failing to
 * remember a question is not a reason to stop somebody answering it.
 */
export async function rememberRestoreAsked(
  store: SecretStore,
): Promise<boolean> {
  try {
    await store.write('yes')
    return true
  } catch {
    return false
  }
}
