import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from '../runtime/conversationList'
import type { DiscoveryReading } from '../runtime/discovery'
import {
  factsOfTheBlock,
  findableAsFarAsKnown,
  whatTheBlockWillDo,
  type WhatTheBlockWillDo,
} from './blockScreen'

const ME = '@me:example.org'
const BLOCKED = '@bothers:example.org'
const FRIEND = '@friend:example.org'
const HER = '@her:example.org'
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0)

/** Nothing read of discovery yet: which the screen counts as findable. */
const UNREAD: DiscoveryReading = { read: false }

function row(
  scope: string,
  other: string | null,
  extra: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    scope,
    other,
    others: other === null ? 2 : 1,
    preview: 'hello',
    lastAt: 1,
    unread: 0,
    ...extra,
  }
}

function findable(until: number | null): DiscoveryReading {
  return {
    read: true,
    on: true,
    findableUntil: until,
    ended: null,
    countries: [],
  }
}

describe('what the screen of a block says it will do (#469, #472, #498)', () => {
  it('says a conversation of two with that account leaves the list, and nothing of reading it', () => {
    // From the panel of the person, as from the selection there.
    const target = { scope: '!with-them:x', other: BLOCKED }

    expect(
      whatTheBlockWillDo(
        target,
        target,
        [row('!with-them:x', BLOCKED, { participants: [ME, BLOCKED] })],
        UNREAD,
        NOW,
      ),
    ).toEqual({ after: 'leaves', stillReads: false, findable: true })
  })

  it('says a conversation of more than two stays, and that the account still reads it while it takes part in it', () => {
    // Said plainly, so that nothing is found out afterwards (#462, story 22).
    expect(
      whatTheBlockWillDo(
        { scope: '!three-of-us:x', other: BLOCKED },
        null,
        [row('!three-of-us:x', null, { participants: [ME, BLOCKED, FRIEND] })],
        UNREAD,
        NOW,
      ),
    ).toMatchObject({ after: 'stays', stillReads: true })
  })

  it('does not say the account still reads a conversation it has left (#498)', () => {
    // It wrote there, then left: its messages are still in the
    // conversation, and blocking takes them off, but it reads nothing.
    expect(
      whatTheBlockWillDo(
        { scope: '!three-of-us:x', other: BLOCKED },
        null,
        [row('!three-of-us:x', null, { participants: [ME, FRIEND, HER] })],
        UNREAD,
        NOW,
      ),
    ).toMatchObject({ after: 'stays', stillReads: false })
    // Nor one of two it left, with somebody else now.
    expect(
      whatTheBlockWillDo(
        { scope: '!with-a-friend:x', other: BLOCKED },
        { scope: '!with-a-friend:x', other: FRIEND },
        [row('!with-a-friend:x', FRIEND, { participants: [ME, FRIEND] })],
        UNREAD,
        NOW,
      ),
    ).toMatchObject({ after: 'stays', stillReads: false })
  })

  it('counts the account in while who is in the conversation is not read: telling somebody it still reads is the cautious error', () => {
    // A row read from the notebook, which never keeps who is in it.
    expect(
      whatTheBlockWillDo(
        { scope: '!three-of-us:x', other: BLOCKED },
        null,
        [row('!three-of-us:x', null)],
        UNREAD,
        NOW,
      ),
    ).toMatchObject({ after: 'stays', stillReads: true })
  })

  it('claims nothing either way while nothing says who is in the conversation', () => {
    expect(
      whatTheBlockWillDo(
        { scope: '!new:x', other: BLOCKED },
        null,
        [],
        UNREAD,
        NOW,
      ),
    ).toMatchObject({ after: 'not known', stillReads: false })
  })

  it('says what the block does not hide as this device knows the account is findable, unknown counting as findable', () => {
    expect(findableAsFarAsKnown(UNREAD, NOW)).toBe(true)
    expect(findableAsFarAsKnown(findable(NOW + 60_000), NOW)).toBe(true)
    expect(findableAsFarAsKnown(findable(NOW - 60_000), NOW)).toBe(false)
    expect(findableAsFarAsKnown(findable(null), NOW)).toBe(false)
    expect(
      whatTheBlockWillDo(
        { scope: '!with-them:x', other: BLOCKED },
        null,
        [row('!with-them:x', BLOCKED)],
        findable(null),
        NOW,
      ).findable,
    ).toBe(false)
  })
})

describe('the facts the screen of a block states (#469, #472, #498)', () => {
  function stated(will: WhatTheBlockWillDo) {
    return factsOfTheBlock(will).map(fact => `${fact.testID}:${fact.body}`)
  }

  it('says what it does, what it does not, what the operator learns, and how to report, in that order', () => {
    expect(
      stated({ after: 'leaves', stillReads: false, findable: true }),
    ).toEqual([
      'block-fact-nothing:block_explain_nothing',
      'block-fact-gone:block_explain_gone',
      'block-fact-untold:block_explain_untold',
      'block-fact-not-hidden:invited_block_not',
      'block-fact-operator:block_explain_operator',
      'block-fact-report:block_explain_report',
    ])
  })

  it('says of a conversation that stays that it stays, and, while the account is in it, that it still reads it', () => {
    expect(
      stated({ after: 'stays', stillReads: true, findable: true }),
    ).toEqual([
      'block-fact-nothing:block_explain_nothing',
      'block-fact-gone:block_explain_gone_stays',
      'block-fact-still-reads:block_explain_still_reads',
      'block-fact-untold:block_explain_untold',
      'block-fact-not-hidden:invited_block_not',
      'block-fact-operator:block_explain_operator',
      'block-fact-report:block_explain_report',
    ])
  })

  it('says nothing of reading a conversation the account has left (#498)', () => {
    expect(
      stated({ after: 'stays', stillReads: false, findable: true }),
    ).not.toContain('block-fact-still-reads:block_explain_still_reads')
  })

  it('claims neither that the conversation stays nor that it leaves while that is not known', () => {
    const facts = stated({
      after: 'not known',
      stillReads: false,
      findable: true,
    })

    expect(facts).toContain('block-fact-gone:block_explain_gone_not_known')
    expect(facts).not.toContain(
      'block-fact-still-reads:block_explain_still_reads',
    )
  })

  it('says to somebody who is not findable that nobody sees them on Messagr', () => {
    expect(
      stated({ after: 'leaves', stillReads: false, findable: false }),
    ).toContain('block-fact-not-hidden:invited_block_not_hidden')
  })

  it('draws the measure in red, and what is to be weighed in ochre', () => {
    const tones = Object.fromEntries(
      factsOfTheBlock({ after: 'stays', stillReads: true, findable: true }).map(
        fact => [fact.testID, fact.tone],
      ),
    )

    expect(tones).toEqual({
      'block-fact-nothing': 'measure',
      'block-fact-gone': 'plain',
      'block-fact-still-reads': 'weigh',
      'block-fact-untold': 'plain',
      'block-fact-not-hidden': 'weigh',
      'block-fact-operator': 'weigh',
      'block-fact-report': 'plain',
    })
  })
})
