/**
 * Which entries belong to the launch that started this JavaScript context.
 * #304.
 *
 * # NOT "NO LINK EVENT HAS ARRIVED YET"
 *
 * The account changes only at a cold launch, and a cold launch was first told
 * apart by where its link came from: `getInitialURL` was the launch, a `url`
 * event was an application already running. That rests on an ordering
 * `spentLinks.ts` says it does not rely on. Under the New Architecture iOS can
 * hand the launch link over as an event before the launch has read it, and a
 * real cold launch then answered « fermez Messagr et rouvrez le lien » each
 * time it was reopened -- on the platform #304 was reported from.
 *
 * So a launch is not what its link came through but when it was read. The
 * first entry of this context is the launch, and so is every entry that
 * begins before that first one ends, which is how one opening delivered twice
 * stays one launch. An entry that begins afterwards reads a link handed to an
 * application that was already running.
 *
 * `App.tsx` holds one per mounted screen. A screen mounted again -- an
 * activity started again in a process that survived -- reads its link the way
 * a launch does. Whether that launch can change accounts without a second
 * crypto machine is `oneMachine.ts`'s question, which entry asks, and not this
 * one's: counting entries per process instead would answer « rouvrez » in a
 * surviving process even where no machine runs.
 */
export interface LaunchEntries {
  /** Begins an entry: whether it belongs to the launch, and what ends it. */
  readonly begin: () => { readonly cold: boolean; readonly end: () => void }
}

export function launchEntries(): LaunchEntries {
  let begun = false
  let ended = false
  return {
    begin: () => {
      const first = !begun
      begun = true
      return {
        cold: !ended,
        end: () => {
          if (first) ended = true
        },
      }
    },
  }
}
