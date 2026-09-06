import React, { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'

import { t } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * The input bar, and it sits above the tabs rather than inside the scroll.
 *
 * # Why it left the conversation
 *
 * It was the last thing in the conversation's own scroll view, so it scrolled
 * away with the messages and a person had to reach the bottom of the thread to
 * type. Now the bar and the tabs are one dock: the field is where the thumb
 * left it, and the tabs do not move under it either.
 *
 * That is the account holder's arrangement rather than the mockup's — the
 * mockup hides the tabs inside a conversation, which is what every other
 * messenger does. Recorded so the difference is a decision somebody can
 * revisit rather than a drift nobody noticed.
 *
 * # What the attachment offers, and what it does not
 *
 * Photographs. A document picker is a second native dependency and a second
 * send path — a file is not an image, and `imageEvent.ts` builds an `m.image`
 * — so it is a ticket rather than a line here. Nothing is drawn for it: a
 * control that opens nothing is what this codebase keeps taking out.
 *
 * **No emoji button.** Every phone keyboard has one, and a second entrance to
 * the same keyboard is a button whose only effect is to focus a field that
 * tapping the field already focuses.
 */

export function Composer({
  onSend,
  onAttach,
}: {
  readonly onSend: (body: string) => void
  /** Choosing a photograph. Absent on a build with no picker. */
  readonly onAttach?: () => void
}) {
  const [draft, setDraft] = useState('')
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

  function send() {
    const body = draft.trim()
    if (body === '') return
    setDraft('')
    onSend(body)
  }

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: palette.surface.paper,
          borderTopColor: palette.neutral['200'],
        },
      ]}
      testID="composer">
      {onAttach !== undefined && (
        <Pressable
          testID="conversation-attach"
          onPress={onAttach}
          accessibilityRole="button"
          accessibilityLabel={t('conversation_attach')}
          style={styles.attach}>
          <Text style={[styles.attachSign, { color: palette.brand.green700 }]}>
            +
          </Text>
        </Pressable>
      )}

      <TextInput
        testID="conversation-input"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={send}
        placeholder={t('message_placeholder')}
        placeholderTextColor={palette.neutral['400']}
        style={[
          styles.input,
          {
            color: palette.neutral['900'],
            backgroundColor: palette.surface.raised,
            borderColor: palette.neutral['300'],
          },
        ]}
      />

      {/* The notch belongs here. Screen 21 takes it off the bubbles and puts
          it back on the buttons, which is where an accent is an accent. */}
      <NotchedButton
        label={t('conversation_send')}
        testID="conversation-send"
        onPress={send}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.s,
    borderTopWidth: stroke.hairline.value,
  },
  attach: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachSign: {
    ...typeScale.titleLg,
    // The glyph sits low in the title role's line box; Android's extra font
    // padding makes it worse. Turning that off centres it without rewriting
    // the ramp -- see `FloatingAction.tsx` for the version that did.
    includeFontPadding: false,
    textAlign: 'center',
  },
  input: {
    flex: 1,
    ...typeScale.body,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
    minHeight: floors.touchTargetMin,
  },
})
