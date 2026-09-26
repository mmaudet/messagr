/**
 * §13.3's first screen on the link path, as the screen holds it. #329.
 *
 * *« Toute invitation par lien ouvre l'écran 1 de §13.3 avant toute
 * décision. »* A link touched, scanned or pasted used to be spent the instant
 * the operating system handed it over: an account drawn, a conversation
 * joined, and the first thing anybody saw was a conversation with a stranger
 * in it. The link is now described first, and entry waits here for the
 * answer.
 *
 * # THIS IS `questionOnScreen.ts` AGAIN, AND DELIBERATELY SO
 *
 * #304 already had entry stop inside a launch and wait on a screen, and
 * everything that module learned applies unchanged: every way the screen can
 * end is an answer, one at a time, and a yes stays drawn as under way until
 * entry says it has finished. Two modules rather than one because they hold
 * different things and end differently, and because a single module answering
 * two questions would be the place where one of them quietly answers the
 * other.
 *
 * # EVERY WAY IT LEAVES THE SCREEN IS AN ANSWER, AND THE DEFAULT IS REFUSAL
 *
 * - A button answers what it says.
 * - The back gesture answers « refuser ». It is the gesture for « not this »,
 *   and refusing is the answer that changes nothing: no request, no token
 *   spent, no account drawn, nothing said to any server. The link is still
 *   good afterwards and opening it again describes it again.
 * - A screen that goes away undecided answers « refuser »: nobody is left to
 *   join, and a launch waiting inside entry on a screen nobody can see is the
 *   defect #304 found on Android and paid for once already.
 *
 * Note which way round that is. `questionOnScreen.ts` defaults to « stay »
 * because staying sends nothing; this defaults to « refuser » for exactly the
 * same reason. In both cases the silent answer is the one with no
 * consequence, which is the only honest thing to do on somebody's behalf.
 *
 * # ONE AT A TIME
 *
 * A second link, put while one is on the screen, is refused without being
 * shown. Refusing spends nothing, so that run costs nothing either, and its
 * link is still there to be opened again.
 */

/** What the screen draws, which is everything the link itself says. */
export interface Described {
  /** The instance the link leads to, as a person reads it. */
  readonly instance: string
  /**
   * The name the inviter gave themselves, or `null` when they gave none.
   *
   * A CLAIM AND NOTHING MORE (§13.26). Whoever wrote the link wrote this,
   * and nothing on either side has established that they are who it says.
   */
  readonly declared: string | null
  /** Whether that instance is not the one this device's account lives on. */
  readonly elsewhere: boolean
  /** Whether the person said join, and it is being carried out. */
  readonly answered: boolean
}

export type Decision = 'join' | 'refuse'

export interface LinkOnScreen {
  /**
   * Describes the link and answers with the person's decision. `settle` takes
   * it off the screen once entry has finished: a join stays there, drawn as
   * under way, until then -- a claim is two calls with the issuer's
   * application in between and can take half a minute.
   */
  readonly put: (what: {
    readonly instance: string
    readonly declared: string | null
    readonly elsewhere: boolean
  }) => { readonly answer: Promise<Decision>; readonly settle: () => void }
  /** What a button answers. */
  readonly answer: (given: Decision) => void
  /** The back gesture. `true` when this screen took it. */
  readonly back: () => boolean
  /** The screen went away. */
  readonly unmounted: () => void
}

export function linkOnScreen(
  show: (what: Described | null) => void,
): LinkOnScreen {
  let open:
    | (Omit<Described, 'answered'> & {
        readonly resolve: (given: Decision) => void
        answered: boolean
      })
    | null = null

  const answer = (given: Decision) => {
    const current = open
    if (current === null || current.answered) return
    const { instance, declared, elsewhere } = current
    if (given === 'refuse') {
      // OFF THE SCREEN AT ONCE, because nothing follows a refusal: there is
      // no request to wait for and nothing to report afterwards.
      open = null
      show(null)
    } else {
      current.answered = true
      show({ instance, declared, elsewhere, answered: true })
    }
    current.resolve(given)
  }

  return {
    put: what => {
      if (open !== null) {
        return { answer: Promise.resolve<Decision>('refuse'), settle: () => {} }
      }
      let resolve!: (given: Decision) => void
      const given = new Promise<Decision>(settle => {
        resolve = settle
      })
      const current = { ...what, resolve, answered: false }
      open = current
      show({ ...what, answered: false })
      return {
        answer: given,
        settle: () => {
          if (open !== current) return
          open = null
          show(null)
        },
      }
    },
    answer,
    back: () => {
      if (open === null) return false
      answer('refuse')
      return true
    },
    unmounted: () => answer('refuse'),
  }
}
