import { describe, expect, it } from 'vitest'

import { questionOnScreen, type Asked } from './questionOnScreen'

const HOSTS = { account: 'bench.example', link: 'messagr.eu' }

/** A screen that remembers what it was last told to show. */
function screen() {
  const shown: Array<Asked | null> = []
  const question = questionOnScreen(asked => {
    shown.push(asked)
  })
  return { question, last: () => shown[shown.length - 1] ?? null }
}

describe('questionOnScreen', () => {
  it('shows the question, and answers what the person answers', async () => {
    const here = screen()
    const put = here.question.put(HOSTS)
    expect(here.last()).toEqual({ ...HOSTS, answered: false })
    here.question.answer('leave')
    expect(await put.answer).toBe('leave')
    // A yes stays on the screen, drawn as under way, until entry has answered.
    expect(here.last()).toEqual({ ...HOSTS, answered: true })
    put.settle()
    expect(here.last()).toBeNull()
  })

  it('answers « stay » to the back gesture while the question is unanswered', async () => {
    // Found in review on 14 September 2026: on Android the back gesture took
    // the question away and nothing answered it, so the account stayed in
    // question -- and its launch waited -- for the life of the process. Back is
    // the gesture for « not this ».
    const here = screen()
    const put = here.question.put(HOSTS)
    expect(here.question.back()).toBe(true)
    expect(await put.answer).toBe('stay')
    expect(here.last()).toBeNull()
  })

  it('keeps the back gesture, and answers nothing more, while a yes is carried out', async () => {
    const here = screen()
    const put = here.question.put(HOSTS)
    here.question.answer('leave')
    expect(here.question.back()).toBe(true)
    expect(await put.answer).toBe('leave')
    expect(here.last()).toEqual({ ...HOSTS, answered: true })
  })

  it('answers « stay » when the screen goes away unanswered', async () => {
    // Nobody is left to say yes, and entry must not wait on a question no one
    // can see.
    const here = screen()
    const put = here.question.put(HOSTS)
    here.question.unmounted()
    expect(await put.answer).toBe('stay')
  })

  it('answers a second question « stay » without showing it', async () => {
    const here = screen()
    const first = here.question.put(HOSTS)
    const second = here.question.put({ ...HOSTS, link: 'other.example' })
    expect(await second.answer).toBe('stay')
    second.settle()
    expect(here.last()).toEqual({ ...HOSTS, answered: false })
    here.question.answer('stay')
    expect(await first.answer).toBe('stay')
  })

  it('leaves the back gesture alone when no question is showing', () => {
    expect(screen().question.back()).toBe(false)
  })
})
