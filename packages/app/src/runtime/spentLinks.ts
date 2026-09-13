/**
 * A link spent once per run of the application, however many times the
 * operating system hands the same one over.
 *
 * # The duplicate this closes
 *
 * A cold launch can deliver the same invitation to the JavaScript twice: once
 * as the address the process was started with (`getInitialURL`), and once as a
 * `url` event a moment later. Under React Native's own ordering the event is
 * usually dropped -- the notification that carries it is posted before the
 * JavaScript has begun listening -- but that ordering is the platform's to
 * change, and this does not depend on it holding.
 *
 * An invitation is single-use, and the whole of it is one credential. Handed
 * to entry twice, the same launch could run the account-creating claim a
 * second time against a token already spent, or re-send an existing account's
 * request needlessly. So each link string is spent at most once here.
 *
 * # Why the string, and why per run
 *
 * Two different invitations differ in their token and so in their string, and
 * each is spent on its own -- this never collapses two real invitations into
 * one. The same string arriving again within one run is the duplicate, and it
 * is what is turned away.
 *
 * A fresh run starts empty on purpose. A relaunch spending the same link again
 * is correct: a claim that a previous run began but did not finish must be
 * retriable, and the keystore, not this, is what remembers a session that was
 * actually obtained.
 *
 * # Why the check and the record are one step
 *
 * `fresh` reads and writes in a single synchronous turn. The cold read and the
 * warm event can reach it in either order and even overlap, and because
 * nothing awaits between the test and the record, whichever reaches it first
 * is the one run that spends the link. The other is told it is not fresh.
 */
export interface SpentLinks {
  /** True the first time this exact link is seen this run, false after. */
  readonly fresh: (url: string) => boolean
}

export function spentLinks(): SpentLinks {
  const spent = new Set<string>()
  return {
    fresh: (url: string) => {
      if (spent.has(url)) return false
      spent.add(url)
      return true
    },
  }
}
