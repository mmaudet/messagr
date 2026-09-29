import { describe, expect, it } from 'vitest'

import type { BlockNotice } from '../runtime/block'
import { blockSays } from './blockSays'

const NOTICES: readonly BlockNotice[] = ['blocked', 'waiting', 'not-kept']

describe('what a block says once made (#469, #472)', () => {
  it('says the conversation left the list when the one blocked from did', () => {
    // The panel of the person, and the selection in a conversation of two.
    expect(
      NOTICES.map(notice => blockSays({ notice, stayingIn: null })),
    ).toEqual([
      { key: 'list_blocked', testID: 'list-blocked' },
      { key: 'list_blocked_waiting', testID: 'list-blocked-waiting' },
      { key: 'list_blocked_not_kept', testID: 'list-blocked-not-kept' },
    ])
  })

  it('says only that what the account wrote left the conversations, when the one blocked from stays', () => {
    // A conversation of more than two stays in the list: saying that the
    // conversation blocked from left it would be false, there and on the
    // list afterwards.
    expect(
      NOTICES.map(notice => blockSays({ notice, stayingIn: '!three-of-us:x' })),
    ).toEqual([
      { key: 'blocked_several', testID: 'blocked-several' },
      { key: 'blocked_several_waiting', testID: 'blocked-several-waiting' },
      { key: 'blocked_several_not_kept', testID: 'blocked-several-not-kept' },
    ])
  })
})
