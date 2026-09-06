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
import { TabIcon } from './TabIcon'

/**
 * The input bar, above the tabs.
 *
 * # Its shape is the account holder's, from a screenshot
 *
 * A rounded field carrying the emoji control on its left and the camera on
 * its right, and a round green button outside it. That is the arrangement
 * asked for, and it is the arrangement most people already have their thumbs
 * trained on.
 *
 * # There is no send button
 *
 * The return key sends. Asked for outright, and it is what the round button's
 * place is for: in the bar this copies, that button records, and recording is
 * V2. So it sits there greyed, holding its place so the bar does not move the
 * day voice messages arrive -- the same argument the reserved Appels tab
 * makes, and a different one from the inert switch §13.18 refuses. That one
 * lies about a capability; this one says when it is coming.
 *
 * `state.disabled` is normative and this follows it exactly: `neutral.200`
 * plate, `neutral.300` glyph, **no opacity** -- the token forbids it, because
 * a global opacity greys the reason too and makes contrast depend on the
 * ground. And it keeps its reason, which a tap reveals rather than a line of
 * permanent noise above every conversation.
 *
 * # No paperclip
 *
 * Attachments beyond photographs are #111 -- an `m.file` is not an `m.image`
 * -- and a paperclip that opened a photo picker would be a control lying
 * about what it does. It comes back with the ticket.
 *
 * # The emoji panel is a panel, not a keyboard
 *
 * A full picker is its own screen and its own search. This is the set people
 * reach for, inserted at the caret's end, and the keyboard's own emoji key
 * still does everything this does not. Written down so the next person knows
 * it is a floor rather than an attempt at a ceiling.
 */

/** What a hand reaches for. Not a Unicode inventory. */
const OFFERED = [
  '😀',
  '😅',
  '😂',
  '🥰',
  '😍',
  '😊',
  '👍',
  '🙏',
  '❤️',
  '🎉',
  '🔥',
  '👀',
  '😮',
  '😢',
  '😡',
  '🤔',
  '✅',
  '❌',
  '☕',
  '🍽️',
  '🚗',
  '🏠',
  '⏰',
  '💬',
] as const

export function Composer({
  onSend,
  onAttach,
}: {
  readonly onSend: (body: string) => void
  /** Choosing a photograph. Absent on a build with no picker. */
  readonly onAttach?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [whyDisabled, setWhyDisabled] = useState(false)
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

  function send() {
    const body = draft.trim()
    if (body === '') return
    setDraft('')
    setEmojiOpen(false)
    onSend(body)
  }

  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: palette.surface.paper,
          borderTopColor: palette.neutral['200'],
        },
      ]}
      testID="composer">
      {emojiOpen && (
        <View style={styles.panel} testID="emoji-panel">
          {OFFERED.map(emoji => (
            <Pressable
              key={emoji}
              testID={`emoji-${emoji}`}
              onPress={() => setDraft(held => held + emoji)}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              style={styles.emojiSlot}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* The reason the round button is grey, shown when somebody asks by
          pressing it. `state.disabled` requires a reason and forbids opacity;
          a line above every conversation for ever would be the noise this
          avoids. */}
      {whyDisabled && (
        <Text
          testID="record-soon"
          style={[styles.reason, { color: palette.neutral['600'] }]}>
          {t('composer_record_soon')}
        </Text>
      )}

      <View style={styles.bar}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: palette.surface.raised,
              borderColor: palette.neutral['200'],
            },
          ]}>
          <Pressable
            testID="composer-emoji"
            onPress={() => setEmojiOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: emojiOpen }}
            accessibilityLabel={t('composer_emoji')}
            style={styles.inField}>
            <TabIcon glyph="emoji" tint={palette.neutral['600']} />
          </Pressable>

          <TextInput
            testID="conversation-input"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
            // The return key is the send key. There is no other.
            returnKeyType="send"
            blurOnSubmit={false}
            placeholder={t('message_placeholder')}
            placeholderTextColor={palette.neutral['400']}
            style={[styles.input, { color: palette.neutral['900'] }]}
          />

          {onAttach !== undefined && (
            <Pressable
              testID="conversation-attach"
              onPress={onAttach}
              accessibilityRole="button"
              accessibilityLabel={t('composer_photo')}
              style={styles.inField}>
              {/* A STILL CAMERA, WHICH THE SET DID NOT HAVE UNTIL TODAY.
                  The identity's `cam` is a camcorder -- it belongs to the
                  call screens -- and this control opens a photograph picker:
                  `launchImageLibrary` with `mediaType: 'photo'`. An icon
                  promising video for a control that cannot take one is a
                  promise the product breaks on the next tap.

                  It stood in as `plus` while the set had no still camera
                  (#112) rather than being drawn here beside the four tab
                  glyphs: an icon invented in a component is one the identity
                  never agreed to. The account holder drew it on 6 September
                  2026 and it is in `design/icons/` now, like the rest. */}
              <TabIcon glyph="camera" tint={palette.neutral['600']} />
            </Pressable>
          )}
        </View>

        {/* Outside the field, and grey. See the header: it records, and
            recording is V2. */}
        <Pressable
          testID="composer-record"
          onPress={() => setWhyDisabled(shown => !shown)}
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={t('composer_record')}
          accessibilityHint={t('composer_record_soon')}
          style={[styles.round, { backgroundColor: palette.neutral['200'] }]}>
          {/* `neutral.300` is the only disabling grey the palette allows,
              and it is a tint on the glyph rather than an opacity on the
              button -- `state.disabled` forbids opacity outright, because it
              would grey the reason too. */}
          <TabIcon glyph="mic" tint={palette.neutral['300']} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: stroke.hairline.value,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.s,
    gap: space.s,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: stroke.base,
    paddingHorizontal: space.xs,
    minHeight: floors.touchTargetMin,
  },
  inField: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    ...typeScale.body,
    paddingVertical: space.s,
  },
  round: {
    width: floors.touchTargetMin,
    height: floors.touchTargetMin,
    borderRadius: radius.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emojiSlot: {
    width: '12.5%',
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: typeScale.titleMd,
  reason: typeScale.caption,
})
