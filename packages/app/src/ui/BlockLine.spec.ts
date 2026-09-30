import { createElement, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t, type CopyKey } from '../copy'
import type { BlockNotice } from '../runtime/block'
import { BlockLine } from './BlockLine'

// The package itself is Flow source, which this workspace's transform cannot
// read: stood in, as every screen spec here does (`ConversationList.spec.ts`).
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: object) => styles },
  Text: 'Text',
}))

/** What the line puts in front of somebody, and under which identifier. */
function drawn(stayingIn: string | null, notice: BlockNotice) {
  const element = BlockLine({ onScreen: { notice, stayingIn } })
  if (!isValidElement<{ testID?: string; children?: unknown }>(element)) {
    throw new Error('the line drew nothing')
  }
  return { testID: element.props.testID, said: element.props.children }
}

const NOTICES: readonly BlockNotice[] = ['blocked', 'waiting', 'not-kept']

describe('the line a block leaves (#469, #472)', () => {
  it('says the conversation left the list when the one blocked from did', () => {
    // The panel of the person, and the selection in a conversation of two.
    const keys: readonly CopyKey[] = [
      'list_blocked',
      'list_blocked_waiting',
      'list_blocked_not_kept',
    ]
    expect(NOTICES.map(notice => drawn(null, notice))).toEqual([
      { testID: 'list-blocked', said: t(keys[0]!) },
      { testID: 'list-blocked-waiting', said: t(keys[1]!) },
      { testID: 'list-blocked-not-kept', said: t(keys[2]!) },
    ])
  })

  it('says only that what the account wrote left the conversations, when the one blocked from stays', () => {
    // Saying that the conversation blocked from left the list would be
    // false there, and on the list afterwards: it is still in it.
    expect(NOTICES.map(notice => drawn('!three-of-us:x', notice))).toEqual([
      { testID: 'blocked-stays', said: t('blocked_stays') },
      { testID: 'blocked-stays-waiting', said: t('blocked_stays_waiting') },
      { testID: 'blocked-stays-not-kept', said: t('blocked_stays_not_kept') },
    ])
  })

  it('is one element, whichever screen draws it', () => {
    expect(
      isValidElement(
        createElement(BlockLine, {
          onScreen: { notice: 'blocked', stayingIn: null },
        }),
      ),
    ).toBe(true)
  })
})
