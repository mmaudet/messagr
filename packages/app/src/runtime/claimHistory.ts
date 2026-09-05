/**
 * Taking the history somebody vouched for you with.
 *
 * The other half of `vouch.ts`, and the passive one. The entrant does
 * nothing and asks for nothing: the inviter decides, the announcement
 * arrives as an ordinary to-device event, and this is what notices it and
 * turns it into a readable past.
 *
 * # Why this runs on launch rather than on a notification
 *
 * The announcement is a to-device event, so it exists for this device only
 * once a sync carrying it has been fed through `receiveSyncChanges`. This
 * application has no live sync loop (ADR-0005): it syncs once per launch and
 * derives what it shows from that. So the natural place to ask "has anybody
 * vouched for me since last time" is the same place everything else is
 * derived -- after the sync, before the conversation is built.
 *
 * That also decides what "missing" means. No offer recorded is not a
 * refusal; it is the ordinary answer for a device whose sync has not yet
 * carried one. Nothing is retried and nothing is logged as an error.
 *
 * # Why a failure here is not a failure of the launch
 *
 * Every outcome except a successful import leaves the conversation exactly
 * as it would have been: some messages readable, the older ones shown as
 * unreadable, which is what ADR-0006 already says a device does with a gap.
 * So this reports what happened and never throws into the launch path. A
 * history that did not arrive is a smaller thing than an application that
 * did not start.
 */

/** What this needs to fetch a file out of the media repository. */
export interface MediaDownloader {
  /** Fetches the bytes at an `mxc://` URI. */
  readonly download: (url: string) => Promise<Uint8Array>
}

/** What this needs from the crypto library. */
export interface HistoryReceiver {
  readonly offeredHistoryBundle: (
    scope: string,
    senderId: string,
  ) => Promise<{ readonly url: string } | null>
  readonly receiveHistoryBundle: (
    scope: string,
    senderId: string,
    ciphertext: Uint8Array,
  ) => Promise<{ readonly offered: number; readonly imported: number }>
}

export type HistoryClaim =
  /** Nobody has vouched for this device in this conversation, yet. */
  | { readonly claimed: 'none' }
  /** History arrived and was imported. */
  | {
      readonly claimed: 'imported'
      readonly offered: number
      readonly imported: number
    }
  /**
   * An offer existed and could not be taken.
   *
   * `reason` is for a person to read; `kind` is what a product branches on.
   * `untrusted` is the one worth telling somebody about: the sender's device
   * is not one this account can vouch for, and what fixes it is verifying
   * them rather than trying again.
   */
  | {
      readonly claimed: 'refused'
      readonly kind: 'untrusted' | 'unreadable' | 'unavailable'
      readonly reason: string
    }

function kindOf(cause: unknown): 'untrusted' | 'unreadable' | 'unavailable' {
  const kind =
    typeof cause === 'object' && cause !== null && 'kind' in cause
      ? (cause as { kind: unknown }).kind
      : undefined
  if (kind === 'sender_not_trusted') return 'untrusted'
  if (kind === 'bundle_unreadable') return 'unreadable'
  return 'unavailable'
}

function why(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Asks whether `voucherId` has offered this device the history of `scope`,
 * and takes it if so.
 *
 * Safe to call on every launch. A bundle already imported imports again:
 * the sessions are the same, the store recognises them, and nothing about
 * the conversation changes. That is why this does not need to remember
 * whether it has run.
 */
export async function claimHistory(
  receiver: HistoryReceiver,
  media: MediaDownloader,
  scope: string,
  voucherId: string,
): Promise<HistoryClaim> {
  let offer
  try {
    offer = await receiver.offeredHistoryBundle(scope, voucherId)
  } catch (cause) {
    return { claimed: 'refused', kind: kindOf(cause), reason: why(cause) }
  }
  if (offer === null) return { claimed: 'none' }

  let ciphertext: Uint8Array
  try {
    ciphertext = await media.download(offer.url)
  } catch (cause) {
    // The file the announcement pointed at could not be fetched. Not
    // `unreadable`, which means the bytes came back and were wrong: this is
    // a download that did not happen, and it can succeed later.
    return { claimed: 'refused', kind: 'unavailable', reason: why(cause) }
  }

  try {
    const report = await receiver.receiveHistoryBundle(
      scope,
      voucherId,
      ciphertext,
    )
    return {
      claimed: 'imported',
      offered: report.offered,
      imported: report.imported,
    }
  } catch (cause) {
    return { claimed: 'refused', kind: kindOf(cause), reason: why(cause) }
  }
}
