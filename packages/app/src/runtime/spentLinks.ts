import type { LinkSource } from './incomingLink'

/**
 * The links an entry is claiming right now, so the same link is never claimed
 * by two entries at once.
 *
 * # The duplicate this closes
 *
 * One opening of a link can reach the JavaScript twice: on a cold launch as
 * the address the process was started with (`getInitialURL`) and then as a
 * `url` event, or as two events close together. Under React Native's own
 * ordering the launch event is usually dropped -- its notification is posted
 * before the JavaScript listens -- but that ordering is the platform's to
 * change, and this does not depend on it holding. Each delivery re-runs the
 * launch, and without this each run would start its own claim for the same
 * single-use token.
 *
 * # Only while the claim runs, and not for the whole run
 *
 * A link is turned away only while an entry that took it has not answered.
 * The moment that entry settles -- entered, refused, or failed outright -- the
 * mark is lifted, and the same link opened again is handed over again.
 *
 * It was held for the whole run at first, and that was too broad. A claim
 * gives up after about thirty seconds when the issuer's application has not
 * yet let the drawn account in, and what a person does next is open the same
 * link again without closing the application. That second opening has to
 * claim again, as it always has on Android: turning it away would leave
 * somebody with no way in and nobody beside them to say why.
 *
 * # Why the mark is taken inside the link source
 *
 * Entry reads its link only after reading the keystore, so two runs racing
 * reach the link source in either order. The check and the mark are taken
 * there in one synchronous step, so whichever run reaches it first is the one
 * that claims, and the other is handed no link and claims nothing.
 */
export interface SpentLinks {
  /**
   * Runs one entry with `source` as its link. A link is handed over only when
   * no entry that took the same link is still running, and the mark is lifted
   * once `run` settles, however it settles.
   */
  readonly enter: <T>(
    source: LinkSource,
    run: (link: LinkSource) => Promise<T>,
  ) => Promise<T>
  /**
   * Waits until no entry holds a link, and answers whether it had to.
   *
   * #304. Two runs of the launch overlap when one link is delivered twice, and
   * the run handed no link restores the session it found while the other may
   * be asking the person whether to leave that very account. A run that
   * restored a session waits here before it does anything with it. `true`
   * tells it another entry was running meanwhile, so the account this device
   * holds is worth reading again before it goes on.
   *
   * `false` on almost every launch: one run, whose own mark was lifted when
   * its entry answered, and nothing for the caller to read again.
   */
  readonly settled: () => Promise<boolean>
}

export function spentLinks(): SpentLinks {
  const underway = new Set<string>()
  let waiting: Array<() => void> = []
  return {
    enter: async <T>(
      source: LinkSource,
      run: (link: LinkSource) => Promise<T>,
    ): Promise<T> => {
      const taken: string[] = []
      const link: LinkSource = async () => {
        const url = await source()
        if (url === null || underway.has(url)) return null
        underway.add(url)
        taken.push(url)
        return url
      }
      try {
        return await run(link)
      } finally {
        for (const url of taken) underway.delete(url)
        if (underway.size === 0) {
          const released = waiting
          waiting = []
          for (const release of released) release()
        }
      }
    },
    settled: async () => {
      if (underway.size === 0) return false
      await new Promise<void>(release => waiting.push(release))
      return true
    },
  }
}
