import React from 'react'
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'

import { t, type CopyKey } from '../copy'
import type { BlockNotice, BlockOnScreen } from '../runtime/block'
import { color, layout, type } from '../design/tokens'

/**
 * The line a block leaves where the person is next (#469, #472): above the
 * list, or under the messages of the conversation it was made from when that
 * one stays. One test identifier per sentence, as #276 asks: a block whose
 * service record waits must not pass for one the service has.
 *
 * # TWO FAMILIES, EACH TRUE WHERE IT IS SAID
 *
 * A block that took the conversation it was made from off the list says so,
 * on the list it came back to: the panel of the person, and the selection in
 * a conversation of two. One made from a conversation that stays says only
 * that what the account wrote left the conversations: in that conversation,
 * then on the list, where that conversation still is.
 */
const SAYS: Readonly<
  Record<
    'left' | 'stays',
    Readonly<
      Record<BlockNotice, { readonly key: CopyKey; readonly testID: string }>
    >
  >
> = {
  left: {
    blocked: { key: 'list_blocked', testID: 'list-blocked' },
    waiting: { key: 'list_blocked_waiting', testID: 'list-blocked-waiting' },
    'not-kept': {
      key: 'list_blocked_not_kept',
      testID: 'list-blocked-not-kept',
    },
  },
  stays: {
    blocked: { key: 'blocked_stays', testID: 'blocked-stays' },
    waiting: { key: 'blocked_stays_waiting', testID: 'blocked-stays-waiting' },
    'not-kept': {
      key: 'blocked_stays_not_kept',
      testID: 'blocked-stays-not-kept',
    },
  },
}

export function BlockLine({
  onScreen,
  style,
}: {
  readonly onScreen: BlockOnScreen
  /** Where it sits among what surrounds it: the caller's to say. */
  readonly style?: StyleProp<TextStyle>
}) {
  const said =
    SAYS[onScreen.stayingIn === null ? 'left' : 'stays'][onScreen.notice]
  return (
    <Text testID={said.testID} style={[styles.line, style]}>
      {t(said.key)}
    </Text>
  )
}

// A line that explains, in the role the list gives its own notices.
const styles = StyleSheet.create({
  line: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
  },
})
