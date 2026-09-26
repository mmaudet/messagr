/**
 * What Réglages may truthfully say about the backup, from the three places
 * that each hold a piece of the answer (#323).
 *
 * # WHY THE BRIDGE'S READING WAS NOT ENOUGH
 *
 * Réglages read `getKeyBackupState()` and nothing else. In that answer
 * `enabled` means *« `enableKeyBackup` a été appelé dans ce processus »* and
 * nothing more: it is true of a device whose version the homeserver retired
 * an hour ago, and of one another telephone replaced this morning. `backedUp`
 * is a local counter, and the `version` that came back was thrown away. So
 * the screen printed « vos messages sont sauvegardés sur le serveur » from a
 * reading that had never asked the server anything — which is #323's whole
 * complaint, and the one sentence on this screen that has to be believable.
 *
 * `matrix-js-sdk`'s own backup API — `getKeyBackupInfo`,
 * `getActiveSessionBackupVersion`, `checkKeyBackupAndEnable` — goes through
 * `client.getCrypto()`, which is null in this application: the crypto is the
 * Linagora bridge and the client is transport only. The single reading of the
 * account is `GET /room_keys/version`, which `backupCalls.ts` owns and the
 * restore offer already made.
 *
 * # THREE FACTS, AND NONE OF THEM ANSWERS ALONE
 *
 * **The bridge** says whether this process is writing, and how much of what
 * it holds has gone. **The account** says which version the homeserver holds
 * now, which is the only thing that decides whether an upload is accepted.
 * **The keystore** says which version this device writes to, and it is the
 * one this module compares against the account's: the bridge does not hand it
 * back through `readKeyBackupState`, and the commitment is what
 * `resumeKeyBackup` enables on every launch, so it is what this device will
 * still be writing to tomorrow.
 *
 * Gathering them is the caller's business, as `backupPrompt.ts` does for the
 * offer and for the same reason: spread across a screen, three conditions are
 * a thing nobody can test.
 *
 * # THE TWO STATES THAT KNOW NOTHING ARE KEPT APART
 *
 * A bridge that did not answer and a homeserver that did not answer are two
 * different sentences, and neither may be rounded to a third. « L'état n'a
 * pas pu être lu sur cet appareil » is about this telephone; « le serveur n'a
 * pas répondu » is about the request. Both leave the backup exactly as it
 * was, both say so, and both offer to ask again — but a person reading the
 * wrong one of the two goes looking in the wrong place.
 */
export type BackupStanding =
  /** Asked, and nothing has answered yet. */
  | { readonly standing: 'waiting' }
  /** This device could not read its own state. Says nothing of the backup. */
  | { readonly standing: 'unreadable' }
  /** The homeserver did not answer. Nothing was changed here. */
  | { readonly standing: 'unchecked' }
  /**
   * On, and what the homeserver holds is the version this device writes to.
   *
   * The counts travel with it because this is the only state that has a
   * number worth showing: what a device that is not sending has counted
   * locally says nothing anybody can act on.
   */
  | {
      readonly standing: 'sending'
      /** How many of this device's keys have gone. */
      readonly backedUp: number
      /** How many it holds. */
      readonly total: number
    }
  /**
   * On here, and the account holds another version — or none at all.
   *
   * Nothing leaves this device: the homeserver refuses an upload to a version
   * that is not its current one, with `M_WRONG_ROOM_KEYS_VERSION`, and the
   * local counter stagnates while the screen said « sauvegardés ».
   */
  | { readonly standing: 'superseded' }
  /** Off here, and the account holds a backup. Where an interrupted acceptance shows. */
  | { readonly standing: 'dormant' }
  /** Off here, and the account holds none. The state every device starts in. */
  | { readonly standing: 'none' }

/** The three readings this decision is made from. */
export interface BackupFacts {
  /**
   * What the bridge answered, or `null` when it could not be read.
   *
   * `enabled` is *« dans ce processus »* and is treated as such here: it is
   * necessary for the first state and never sufficient.
   */
  readonly device: {
    readonly enabled: boolean
    readonly total: number
    readonly backedUp: number
  } | null
  /**
   * The version the account holds: a string, `null` for none — which is what
   * a `404` means and is an ordinary answer — or `'unanswered'` when the
   * request could not be made or refused for any other reason.
   *
   * Opaque, and compared for equality only. Synapse counts from `"1"` and
   * Continuwuity answers a six-digit integer.
   */
  readonly account: string | null | 'unanswered'
  /**
   * The version this device writes to, from the keystore commitment, or
   * `null`.
   *
   * `null` covers both a keystore that refused to answer and a device that
   * holds no commitment, exactly as `readBackupCommitment` answers, and the
   * two need not be told apart here: neither can prove the account's version
   * is this device's, which is all this module asks of it.
   */
  readonly writesTo: string | null
}

export function backupStanding(
  facts: BackupFacts,
): Exclude<BackupStanding, { readonly standing: 'waiting' }> {
  // FIRST, AND BEFORE ANYTHING ABOUT THE ACCOUNT. A device that cannot read
  // its own state cannot say whether it is sending, whatever the homeserver
  // holds, and the sentence for that is about this telephone.
  if (facts.device === null) return { standing: 'unreadable' }
  if (facts.account === 'unanswered') return { standing: 'unchecked' }

  if (!facts.device.enabled) {
    return facts.account === null
      ? { standing: 'none' }
      : { standing: 'dormant' }
  }

  // THE COMPARISON THIS SCREEN EXISTED WITHOUT. `writesTo` null is the same
  // answer as a mismatch: nothing here says which version this device is
  // committed to, so nothing here can promise the next launch resumes one.
  if (facts.writesTo === null || facts.writesTo !== facts.account) {
    return { standing: 'superseded' }
  }

  return {
    standing: 'sending',
    backedUp: facts.device.backedUp,
    total: facts.device.total,
  }
}
