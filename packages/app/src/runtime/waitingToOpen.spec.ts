import { describe, expect, it } from 'vitest'

import { waitingToOpen } from './waitingToOpen'

/**
 * A list that remembers what it was last told to draw as under way, and a
 * launch whose opener can be bound whenever a test decides to bind it.
 *
 * NOTHING HERE WAITS FOR A DELAY, and that is the point. The defect is an
 * ordering -- a touch before a binding -- so the tests order the two calls by
 * hand. A test that slept would prove that a particular sleep was long
 * enough on the machine it ran on, which is the property nobody needs.
 */
function screen() {
  const shown: (string | null)[] = []
  const opened: string[] = []
  const waiting = waitingToOpen(scope => {
    shown.push(scope)
  })
  return {
    waiting,
    opened,
    bind: () => {
      waiting.bind(scope => {
        opened.push(scope)
      })
    },
    drawn: () => shown[shown.length - 1] ?? null,
    everShown: () => shown,
  }
}

describe('waitingToOpen', () => {
  it('opens a conversation touched once the launch can open one', () => {
    // The ordinary case, and the one that already worked: by the time most
    // people touch anything, the launch has bound its opener.
    const here = screen()
    here.bind()

    expect(here.waiting.touch('!a:example.invalid')).toBe('opened')
    expect(here.opened).toEqual(['!a:example.invalid'])
    // Nothing to say: the conversation is what the screen shows next.
    expect(here.drawn()).toBeNull()
  })

  it('opens the conversation somebody touched before the launch could open one', () => {
    // #280, measured on run 34717623056: the list is drawn from the notebook
    // at the top of the launch (`MESSAGR_LIST_REMEMBERED`) and the opener is
    // bound four to five seconds later, after the crypto machine, the pump
    // and `enterAnyInvitations`. Three touches landed inside that window and
    // every one of them was dropped -- no conversation, no error, nothing.
    //
    // THIS IS THE ORDER THAT USED TO LOSE THE TOUCH.
    const here = screen()

    expect(here.waiting.touch('!a:example.invalid')).toBe('held')
    expect(here.opened).toEqual([])

    here.bind()

    expect(here.opened).toEqual(['!a:example.invalid'])
  })

  it('says the touch was taken, and stops saying it the moment it opens', () => {
    // « Un toucher qui ne fait rien et ne dit rien est le pire cas »: the
    // person recommends themselves that the telephone is broken. The row says
    // the conversation is opening for exactly as long as that is true.
    const here = screen()

    here.waiting.touch('!a:example.invalid')
    expect(here.drawn()).toBe('!a:example.invalid')

    here.bind()
    expect(here.drawn()).toBeNull()
  })

  it('draws the row under way once, however many times it is touched', () => {
    // A touch that seems to do nothing is a touch somebody repeats. Each
    // repeat asks for the same conversation, so the screen is told once --
    // the list is redrawn by the sync loop every few seconds and a state
    // change per touch would be a redraw per touch for no change at all.
    const here = screen()

    here.waiting.touch('!a:example.invalid')
    here.waiting.touch('!a:example.invalid')
    here.waiting.touch('!a:example.invalid')

    expect(here.everShown()).toEqual(['!a:example.invalid'])
  })

  it('holds the newest touch and opens that one', () => {
    // Somebody who touches one row, sees nothing happen and touches another
    // means the second. Opening both would take them into a conversation they
    // left before they arrived.
    const here = screen()

    here.waiting.touch('!a:example.invalid')
    here.waiting.touch('!b:example.invalid')
    here.bind()

    expect(here.opened).toEqual(['!b:example.invalid'])
  })

  it('opens nothing once the person has gone somewhere else', () => {
    // The touch is held, not stolen. Whatever takes the list off the screen
    // -- the back gesture, another tab, the invitation screen -- lets it go,
    // so a launch that binds afterwards does not pull somebody out of the
    // screen they chose in the meantime.
    const here = screen()

    here.waiting.touch('!a:example.invalid')
    here.waiting.letGo()
    expect(here.drawn()).toBeNull()

    here.bind()

    expect(here.opened).toEqual([])
  })

  it('lets go of a touch the launch turns out never to be able to answer', () => {
    // A launch that ends without an opener -- no session, a crypto machine
    // that would not start, an exception -- must take the row out of
    // « Ouverture… ». A line that says a conversation is coming for the life
    // of the process is worse than the silence it replaced, because it is a
    // lie rather than an omission.
    const here = screen()

    here.waiting.touch('!a:example.invalid')
    here.waiting.giveUp()

    expect(here.drawn()).toBeNull()
    expect(here.opened).toEqual([])
  })

  it('refuses a touch it already knows it cannot answer, rather than holding it', () => {
    // Once the launch has given up, holding would be promising again. The
    // verdict is what `App.tsx` writes to the log: this is the one case where
    // the product genuinely cannot open the conversation, and it should be
    // findable afterwards rather than inferred from an absence.
    const here = screen()
    here.waiting.giveUp()

    expect(here.waiting.touch('!a:example.invalid')).toBe('refused')
    expect(here.drawn()).toBeNull()
    expect(here.opened).toEqual([])
  })

  it('takes touches again when a later run of the launch binds an opener', () => {
    // The launch effect runs again -- a link handed to a running application
    // re-runs it (`launchEntries.ts`) -- and the run that gave up may be
    // followed by one that does not. Giving up is about the run, never about
    // the process.
    const here = screen()
    here.waiting.giveUp()
    here.bind()

    expect(here.waiting.touch('!a:example.invalid')).toBe('opened')
    expect(here.opened).toEqual(['!a:example.invalid'])
  })

  it('ignores a run that gives up after another has bound an opener', () => {
    // Two runs overlap: the first one's launch settles after the second has
    // already bound what a row calls. The late `giveUp` belongs to the run
    // that lost, and must not take the opener away from the screen.
    const here = screen()
    here.bind()
    here.waiting.giveUp()

    expect(here.waiting.touch('!a:example.invalid')).toBe('opened')
  })
})
