import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from './conversationList'
import { mergeSummaries } from './mergeSummaries'

function row(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    scope: '!scope:example.org',
    other: '@someone:example.org',
    others: 1,
    preview: 'the last thing said',
    lastAt: 1_757_000_000_000,
    unread: 0,
    ...over,
  }
}

/** What `summarise` hands back when its request did not get through. */
function unreachable(scope: string): ConversationSummary {
  return {
    scope,
    other: null,
    others: null,
    preview: null,
    reason: 'Network request failed',
    lastAt: 0,
    unread: 0,
  }
}

describe('a row whose derivation did not run', () => {
  it('keeps what the row already said', () => {
    const before = row({ scope: '!a:example.org' })

    const merged = mergeSummaries([before], [unreachable('!a:example.org')])

    expect(merged).toEqual([before])
  })

  it('keeps the unread count with it, and the person', () => {
    // The whole row, not a patched preview: `other`, `others` and `unread`
    // all come back null or zero from a failed derivation, and a row that
    // kept its words while losing its badge and its name would be a row
    // nobody recognises.
    const before = row({
      scope: '!a:example.org',
      unread: 4,
      other: '@camille:example.org',
      others: 1,
    })

    const [kept] = mergeSummaries([before], [unreachable('!a:example.org')])

    expect(kept).toMatchObject({
      unread: 4,
      other: '@camille:example.org',
      others: 1,
    })
  })

  it('takes the fresh answer when nothing better is remembered', () => {
    const fresh = unreachable('!a:example.org')

    expect(mergeSummaries([], [fresh])).toEqual([fresh])
    expect(
      mergeSummaries([row({ scope: '!a:example.org', lastAt: 0 })], [fresh]),
    ).toEqual([fresh])
  })
})

describe('the two answers this must never overwrite', () => {
  it('lets a conversation whose last message is unreadable through', () => {
    // A reason WITH a timestamp: the keys never arrived, or the message was
    // removed. `list_unreadable` is the true sentence for it, and preferring
    // a remembered preview here would show words the device can no longer
    // read -- which is the opposite of what ADR-0006 promises.
    const before = row({ scope: '!a:example.org', preview: 'once readable' })
    const now = row({
      scope: '!a:example.org',
      preview: null,
      reason: 'this device cannot read the last message',
    })

    expect(mergeSummaries([before], [now])).toEqual([now])
  })

  it('lets a conversation nothing has been said in through', () => {
    // No timestamp and no reason. An ordinary empty conversation, and a
    // merge that treated a zero as a failure would keep showing a preview
    // for a conversation somebody has just cleared.
    const now = row({ scope: '!a:example.org', preview: null, lastAt: 0 })
    const before = row({ scope: '!a:example.org' })

    expect(mergeSummaries([before], [now])).toEqual([now])
  })
})

describe('the shape of the list itself', () => {
  it('drops a conversation that is no longer derived', () => {
    // Driven by the derived list and never by the remembered one. A union
    // would resurrect conversations somebody left, which is worse than a
    // stale preview by a long way.
    const left = row({ scope: '!left:example.org' })
    const stayed = row({ scope: '!stayed:example.org' })

    const merged = mergeSummaries([left, stayed], [stayed])

    expect(merged.map(one => one.scope)).toEqual(['!stayed:example.org'])
  })

  it('puts a kept row back in its place rather than at the bottom', () => {
    // `lastAt: 0` sorts a failed row to the bottom, so the derived order was
    // decided while every timestamp was zero. A kept row brings its own
    // timestamp back and has to be re-sorted with it -- otherwise the list
    // reorders itself under somebody's eyes on a bad signal, which is the
    // "ralentit" in the report and is movement rather than latency.
    const older = row({ scope: '!older:example.org', lastAt: 1_000 })
    const newer = row({ scope: '!newer:example.org', lastAt: 9_000 })

    const merged = mergeSummaries(
      [older, newer],
      [older, unreachable('!newer:example.org')],
    )

    expect(merged.map(one => one.scope)).toEqual([
      '!newer:example.org',
      '!older:example.org',
    ])
  })

  it('answers with the derivation when there is nothing on screen', () => {
    const fresh = [row({ scope: '!a:example.org' })]

    expect(mergeSummaries([], fresh)).toBe(fresh)
  })
})
