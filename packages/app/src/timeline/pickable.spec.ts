import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from '../runtime/conversationList'
import { pickable } from './pickable'

function summary(scope: string): ConversationSummary {
  return {
    scope,
    other: '@her:x',
    others: 1,
    preview: null,
    lastAt: 0,
    unread: 0,
  }
}

const LIST = [summary('!a:x'), summary('!b:x'), summary('!c:x')]

describe('which conversations a picker may offer', () => {
  it('offers everything when nothing is excluded', () => {
    expect(pickable(LIST)).toBe(LIST)
  })

  it('leaves out the one it came from', () => {
    // Forwarding a message into the conversation it is already in is not a
    // gesture, and only the caller knows which that is.
    expect(pickable(LIST, '!b:x').map(one => one.scope)).toEqual([
      '!a:x',
      '!c:x',
    ])
  })

  it('offers nothing when that was the only one', () => {
    // A person with one conversation has nowhere to forward to, and the
    // sheet says so rather than opening onto an empty list.
    expect(pickable([summary('!a:x')], '!a:x')).toEqual([])
  })

  it('ignores an exclusion that names no conversation it holds', () => {
    expect(pickable(LIST, '!gone:x')).toHaveLength(3)
  })
})
