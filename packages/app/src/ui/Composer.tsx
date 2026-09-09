import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

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
 * # THE FIELD TAKES SEVERAL LINES, AND THAT IS WHY THERE IS A SEND BUTTON
 *
 * This said "there is no send button. The return key sends. Asked for
 * outright." Then a second thing was asked for outright -- « le champ doit
 * pouvoir accepter les retours à la ligne et donc on doit pouvoir naviguer
 * dans le champ de saisie » -- and the two cannot both be true of one key.
 * A return that sends is a return that cannot make a paragraph.
 *
 * So the round button carries the send now, and it does it **without the bar
 * moving**, which was the whole reason that place was reserved. Empty, it is
 * the microphone it always was: grey, V2, and it says so when tapped. With
 * something written in it, it is green and it sends. The place never changes,
 * only what stands in it -- which is what every messenger does and what
 * anybody's thumb already expects.
 *
 * `state.disabled` is normative and the microphone follows it exactly:
 * `neutral.200` plate, `neutral.300` glyph, **no opacity** -- the token
 * forbids it, because a global opacity greys the reason too and makes
 * contrast depend on the ground. And it keeps its reason, which a tap reveals
 * rather than a line of permanent noise above every conversation.
 *
 * # HOW TALL THE FIELD GETS
 *
 * It grows with what is typed and stops at `TALLEST_FIELD`, after which it
 * scrolls inside itself. A field that grew without a bound would push the
 * conversation off the top of its own screen, which is the failure mode of
 * every composer that forgets to stop.
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

/**
 * How tall the field is allowed to grow: five lines of `body`, plus the
 * padding above and below. Past that it scrolls inside itself.
 */
const TALLEST_FIELD = typeScale.body.lineHeight * 5 + space.s * 2

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
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // This read `useColorScheme()` and switched to `color.dark`. Four
  // components did, and nothing else in the application does -- so on a
  // phone set to dark mode these four turned dark inside screens that stayed
  // pale: a black composer under a paper conversation, reported from an
  // iPhone on 7 September 2026 with the words "meme pb de fond".
  //
  // The application has a light palette and a dark one reserved for surfaces
  // that ASK for it -- the promise screen, a photograph full screen. Which
  // ground a component sits on is its parent's business, which is why
  // `LanguagePicker` takes `onDark` and does not guess. A component that reads
  // the system theme is guessing, and it guessed wrong here.
  const palette = color

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
            // SEVERAL LINES, AND THE RETURN KEY MAKES THEM.
            //
            // With `multiline` the return key inserts a newline and the
            // caret can be put anywhere with a tap, which is the second half
            // of what was asked for: navigating inside what you have
            // written. Sending moved to the button beside the field -- see
            // the note at the top for why that costs the bar nothing.
            multiline
            // Grows to `TALLEST_FIELD` and scrolls after that. `top` so a
            // field that has grown fills from its first line rather than
            // centring one line in a tall box.
            textAlignVertical="top"
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

        {/* ONE PLACE, TWO CONTROLS, AND THE BAR NEVER MOVES.
            With something written, it sends; empty, it is the microphone it
            has always been -- grey, V2, and it says so when tapped. */}
        {draft.trim() === '' ? (
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
                button -- `state.disabled` forbids opacity outright, because
                it would grey the reason too. */}
            <TabIcon glyph="mic" tint={palette.neutral['300']} />
          </Pressable>
        ) : (
          <Pressable
            testID="composer-send"
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel={t('composer_send')}
            style={({ pressed }) => [
              styles.round,
              { backgroundColor: palette.brand.green500 },
              pressed && styles.pressed,
            ]}>
            {/* AN ARROW WRITTEN, NOT AN ICON DRAWN. The identity's set has
                no send glyph, and `TabIcon` says why one must not be
                invented in a component: "an icon invented in a component is
                one the identity never agreed to". A typographic arrow is
                the same idiom the chevron of `LanguagePicker` and the tick
                of `EmojiPicker` use, and it costs the set nothing. */}
            <Text style={[styles.sendMark, { color: palette.surface.paper }]}>
              {'↑'}
            </Text>
          </Pressable>
        )}
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
    // Five lines of `body`, then it scrolls. A composer that grows without
    // a bound pushes the conversation off the top of its own screen.
    maxHeight: TALLEST_FIELD,
  },
  pressed: { opacity: 0.8 },
  sendMark: {
    ...typeScale.titleMd,
    // The arrow is the whole content of a round button, so it is centred by
    // the button rather than by a line box that assumes a descender.
    lineHeight: typeScale.titleMd.fontSize,
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
