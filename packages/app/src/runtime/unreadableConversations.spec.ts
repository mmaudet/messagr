import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from './conversationList'
import { unreadableConversations } from './unreadableConversations'

function row(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    scope: '!a:x',
    other: '@her:x',
    others: 1,
    preview: 'the last thing said',
    lastAt: 1_757_000_000_000,
    unread: 0,
    ...over,
  }
}

describe('counting what a restore would fix', () => {
  it('counts a conversation whose last message will not open', () => {
    const stranded = row({
      preview: null,
      reason: 'this device cannot read the last message',
    })

    expect(unreadableConversations([stranded, row()])).toBe(1)
  })

  it('counts every one of them on a device that lost its keys', () => {
    // The state after a reinstall: the account comes back, the list comes
    // back from the notebook, and not one row opens.
    const stranded = Array.from({ length: 5 }, (_, index) =>
      row({
        scope: `!${index}:x`,
        preview: null,
        reason: 'this device cannot read the last message',
      }),
    )

    expect(unreadableConversations(stranded)).toBe(5)
  })

  it('counts nothing on a device that reads everything', () => {
    expect(unreadableConversations([row(), row({ scope: '!b:x' })])).toBe(0)
  })
})

describe('the two rows it must not count', () => {
  it('ignores a row whose derivation did not run', () => {
    // A reason with NO timestamp: the network, not the keys. Counting it
    // would offer a restore for a problem a key cannot solve -- and would do
    // it on a device with no signal, which is the worst possible moment to
    // ask somebody for their only copy of a secret.
    //
    // This is the row `mergeSummaries` replaces with what it remembered.
    // The two modules read the same two fields and want opposite rows.
    const offline = row({
      preview: null,
      reason: 'Network request failed',
      lastAt: 0,
    })

    expect(unreadableConversations([offline])).toBe(0)
  })

  it('ignores a conversation nothing has been said in', () => {
    // No reason and no timestamp. Nothing to restore, and nothing wrong.
    expect(unreadableConversations([row({ preview: null, lastAt: 0 })])).toBe(0)
  })

  it('ignores an empty list, which is a device with nothing yet', () => {
    expect(unreadableConversations([])).toBe(0)
  })
})
