/**
 * The conversation somebody asked for before the launch could open one. #280.
 *
 * # A TOUCH THAT DOES NOTHING AND SAYS NOTHING
 *
 * The list is drawn from the notebook at the top of the launch, before any
 * round trip, so that a person sees their conversations instead of seven
 * seconds of empty screen (`listCacheStore.ts`, and the note above
 * `MESSAGR_LIST_REMEMBERED` in `App.tsx`). What a row calls is bound much
 * later: the closure needs the session and the crypto machine, because a
 * conversation opened before the machine has started draws messages this
 * device cannot yet decrypt.
 *
 * Between the two, every touch was dropped. Not refused -- dropped: the row
 * called a reference that was `null`, and `?.()` on a `null` is a statement
 * that does nothing and returns. Measured on run 34717623056, three launches,
 * windows of 4.1, 4.5 and 4.9 seconds, no conversation and not one line in the
 * log. A person who touches that early sees a screen that looks usable, gets
 * nothing, and either touches again or puts the telephone down.
 *
 * # THE TOUCH IS KEPT, AND THE ROW SAYS SO
 *
 * So the gesture is held rather than thrown away, and replayed the moment the
 * launch can answer it. Meanwhile the screen says the conversation is opening,
 * because the second half of the defect is the silence: a person who is told
 * « Ouverture… » waits, and a person who is told nothing concludes the
 * application is broken.
 *
 * # NO CLOCK, AND THAT IS DELIBERATE
 *
 * Nothing here expires. A deadline would have to be guessed -- the windows
 * above were measured on one emulator, with one conversation, on a network
 * nobody was using -- and a guess that is too short puts the defect back for
 * exactly the people it is worst for, on the slow telephone and the slow
 * network. What ends the wait is an event instead, and there are three:
 *
 * - `bind`, the launch can open conversations now, so the held one opens;
 * - `letGo`, the person went somewhere else, so the gesture is dropped
 *   rather than replayed into a screen they did not ask for;
 * - `giveUp`, this run of the launch ended without ever binding an opener,
 *   so the row must stop claiming a conversation is on its way.
 *
 * `giveUp` is the one that keeps the fix honest. « Ouverture… » left on a row
 * for the life of the process would be worse than the silence it replaced,
 * because a lie is worse than an omission. After it, a touch is refused and
 * said to be refused; `App.tsx` writes that to the log, which is where
 * somebody diagnosing a telephone that opens nothing has to be able to find
 * it.
 *
 * Giving up belongs to a run and never to the process: the launch effect runs
 * again when a link reaches an application that is already open, and a run
 * that binds an opener takes back every refusal an earlier one made.
 */

/** What became of a touch. */
export type Touched =
  /** The conversation is opening. */
  | 'opened'
  /** Held, and it will open as soon as the launch can open one. */
  | 'held'
  /** This launch will never open a conversation. Nothing was held. */
  | 'refused'

export interface WaitingToOpen {
  /** A row was touched. */
  readonly touch: (scope: string) => Touched
  /** The launch can open conversations. Whatever is held opens now. */
  readonly bind: (open: (scope: string) => void) => void
  /** The list is no longer what the person is looking at. */
  readonly letGo: () => void
  /** This run of the launch ended without ever being able to open one. */
  readonly giveUp: () => void
}

/**
 * @param show what the screen draws as opening: the conversation being waited
 * on, or `null` for the ordinary case. Called only when the answer changes,
 * because the list is redrawn by the sync loop every few seconds and a
 * repeated touch must not cost a render each.
 */
export function waitingToOpen(
  show: (scope: string | null) => void,
): WaitingToOpen {
  let open: ((scope: string) => void) | null = null
  let held: string | null = null
  let gaveUp = false

  const hold = (scope: string | null) => {
    if (held === scope) return
    held = scope
    show(scope)
  }

  return {
    touch: scope => {
      if (open !== null) {
        hold(null)
        open(scope)
        return 'opened'
      }
      if (gaveUp) {
        hold(null)
        return 'refused'
      }
      hold(scope)
      return 'held'
    },
    bind: opener => {
      open = opener
      gaveUp = false
      const waiting = held
      if (waiting === null) return
      // Let go BEFORE opening: `open` takes the screen to the conversation,
      // and whatever it sets off must not find a row still drawn as waiting
      // for the conversation it is already showing.
      hold(null)
      opener(waiting)
    },
    letGo: () => hold(null),
    giveUp: () => {
      // A run that ends after another has bound an opener has nothing to say.
      if (open !== null) return
      gaveUp = true
      hold(null)
    },
  }
}
