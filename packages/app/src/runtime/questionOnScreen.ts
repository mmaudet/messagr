/**
 * The question a link into another server puts, as the screen holds it. #304.
 *
 * # EVERY WAY IT LEAVES THE SCREEN IS AN ANSWER
 *
 * Entry waits on the answer with the account in question: no machine for its
 * device meanwhile, and a run of the launch that restored it waiting too
 * (`accountInQuestion.ts`). So the question must always end, and not only by
 * one of its two buttons. Found in review on 14 September 2026: Android's back
 * gesture took it away and answered nothing, and a screen that went away left
 * it open for the life of the process.
 *
 * - A button answers what it says.
 * - The back gesture answers « stay »: it is the gesture for « not this », and
 *   staying is the answer that changes nothing. Once somebody has said yes,
 *   back is taken and does nothing -- the claim and what follows are under
 *   way, and a gesture made without thinking must not interrupt them.
 * - A screen that goes away unanswered answers « stay »: nobody is left to say
 *   yes.
 *
 * # ONE AT A TIME
 *
 * A second question, put while one is on the screen, is answered « stay »
 * without being shown. Staying sends nothing, and that run then stays on the
 * account it holds.
 *
 * Handed the one thing it draws with, so each ending above is tested without a
 * screen.
 */
export interface Asked {
  /** The server this device's account lives on, as a person reads it. */
  readonly account: string
  /** The server the link leads to. */
  readonly link: string
  /** Whether the person said yes, and it is being carried out. */
  readonly answered: boolean
}

export type Answer = 'leave' | 'stay'

export interface QuestionOnScreen {
  /**
   * Shows the question and answers with the person's answer. `settle` takes
   * it off the screen once entry has answered: a yes stays there, drawn as
   * under way, until then.
   */
  readonly put: (hosts: {
    readonly account: string
    readonly link: string
  }) => { readonly answer: Promise<Answer>; readonly settle: () => void }
  /** What a button answers. */
  readonly answer: (given: Answer) => void
  /** The back gesture. `true` when the question took it. */
  readonly back: () => boolean
  /** The screen went away. */
  readonly unmounted: () => void
}

export function questionOnScreen(
  show: (asked: Asked | null) => void,
): QuestionOnScreen {
  let open: {
    readonly account: string
    readonly link: string
    readonly resolve: (given: Answer) => void
    answered: boolean
  } | null = null

  const answer = (given: Answer) => {
    const current = open
    if (current === null || current.answered) return
    if (given === 'stay') {
      open = null
      show(null)
    } else {
      current.answered = true
      show({ account: current.account, link: current.link, answered: true })
    }
    current.resolve(given)
  }

  return {
    put: hosts => {
      if (open !== null) {
        return { answer: Promise.resolve('stay'), settle: () => {} }
      }
      let resolve!: (given: Answer) => void
      const given = new Promise<Answer>(settle => {
        resolve = settle
      })
      const current = { ...hosts, resolve, answered: false }
      open = current
      show({ ...hosts, answered: false })
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
      answer('stay')
      return true
    },
    unmounted: () => answer('stay'),
  }
}
