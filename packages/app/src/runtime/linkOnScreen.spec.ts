import { describe, expect, it } from 'vitest'

import { linkOnScreen, type Described } from './linkOnScreen'

const LINK = {
  instance: 'messagr.eu',
  declared: 'Nadia',
  elsewhere: false,
}

/** A screen that remembers what it was last told to show. */
function screen() {
  const shown: Array<Described | null> = []
  const described = linkOnScreen(what => {
    shown.push(what)
  })
  return { described, last: () => shown[shown.length - 1] ?? null }
}

describe('linkOnScreen', () => {
  it('describes the link, and answers what the person decides', async () => {
    const here = screen()
    const put = here.described.put(LINK)
    expect(here.last()).toEqual({ ...LINK, answered: false })
    here.described.answer('join')
    expect(await put.answer).toBe('join')
    // A join stays on the screen, drawn as under way, until entry has
    // answered: a claim is two calls with somebody else's application in
    // between, and a screen that closed on the tap would leave the person
    // watching nothing for half a minute.
    expect(here.last()).toEqual({ ...LINK, answered: true })
    put.settle()
    expect(here.last()).toBeNull()
  })

  it('takes a refusal off the screen at once, since nothing follows it', async () => {
    const here = screen()
    const put = here.described.put(LINK)
    here.described.answer('refuse')
    expect(await put.answer).toBe('refuse')
    expect(here.last()).toBeNull()
  })

  it('answers « refuser » to the back gesture, which sends nothing', async () => {
    // `questionOnScreen.ts`'s rule, and it holds harder here: back is the
    // gesture for « not this », and refusing spends nothing, claims nothing
    // and says nothing to any server. The link is still good afterwards.
    const here = screen()
    const put = here.described.put(LINK)
    expect(here.described.back()).toBe(true)
    expect(await put.answer).toBe('refuse')
    expect(here.last()).toBeNull()
  })

  it('keeps the back gesture, and answers nothing more, while a join runs', async () => {
    const here = screen()
    const put = here.described.put(LINK)
    here.described.answer('join')
    expect(here.described.back()).toBe(true)
    expect(await put.answer).toBe('join')
    expect(here.last()).toEqual({ ...LINK, answered: true })
  })

  it('answers « refuser » when the screen goes away undecided', async () => {
    // Nobody is left to join, and entry must not wait inside a launch on a
    // screen no one can see.
    const here = screen()
    const put = here.described.put(LINK)
    here.described.unmounted()
    expect(await put.answer).toBe('refuse')
  })

  it('refuses a second link without showing it', async () => {
    // One decision at a time. Refusing sends nothing, so the run whose link
    // was not shown spends nothing either.
    const here = screen()
    const first = here.described.put(LINK)
    const second = here.described.put({ ...LINK, instance: 'other.example' })
    expect(await second.answer).toBe('refuse')
    second.settle()
    expect(here.last()).toEqual({ ...LINK, answered: false })
    here.described.answer('refuse')
    expect(await first.answer).toBe('refuse')
  })

  it('leaves the back gesture alone when nothing is showing', () => {
    expect(screen().described.back()).toBe(false)
  })
})
