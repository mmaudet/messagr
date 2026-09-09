import React from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import type { ConversationSummary } from '../runtime/conversationList'
import { t } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import { displayNameFor } from '../runtime/givenName'
import { pickable } from '../timeline/pickable'
import { Avatar } from './Avatar'

/**
 * « Vers quelle conversation ? », and an answer.
 *
 * # A PIECE, NOT A FEATURE
 *
 * Forwarding a message needs one (#194); sharing a contact and passing on an
 * invitation will need the same one. It is written once and comes out first
 * for that reason, with no caller at all -- #193 says so in its own
 * acceptance criteria.
 *
 * # THE SAME LIST, AND DELIBERATELY NOT A SECOND ONE
 *
 * The rows carry the given names the conversation list carries, because a
 * screen showing identifiers where the rest of the product shows names would
 * be a second inventory to keep in step. The names come from the caller
 * rather than being read here: `ADR-0010` keeps them in the notebook, and a
 * component that opened it would be a component that cannot be rendered
 * without one.
 *
 * # A SHEET, NOT A DESTINATION
 *
 * You arrive from an action and leave with an answer or with nothing.
 * `onPick(null)` is the nothing, and it is what the scrim, the cancel and
 * the hardware back button all do -- one way out expressed three times,
 * because a person reaches for whichever is nearest.
 */
export function PickConversation({
  summaries,
  names,
  except,
  onPick,
}: {
  readonly summaries: readonly ConversationSummary[]
  readonly names: ReadonlyMap<string, string>
  /**
   * A conversation the answer must not be.
   *
   * Forwarding a message into the conversation it is already in is not a
   * gesture, and the caller is the only one that knows which that is.
   */
  readonly except?: string
  /** The chosen conversation, or `null` when the person closed it. */
  readonly onPick: (scope: string | null) => void
}) {
  const offered = pickable(summaries, except)

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => onPick(null)}
      testID="pick-conversation">
      <View style={styles.over}>
        <Pressable
          testID="pick-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t('pick_cancel')}
          onPress={() => onPick(null)}
        />
        <View style={styles.sheet}>
          <Text style={styles.heading}>{t('pick_title')}</Text>

          {offered.length === 0 ? (
            // A person with one conversation has nowhere to forward to, and
            // saying so is better than a sheet that opens onto nothing.
            <Text style={styles.empty} testID="pick-empty">
              {t('pick_empty')}
            </Text>
          ) : (
            <ScrollView
              style={styles.list}
              showsVerticalScrollIndicator={false}>
              {offered.map(summary => {
                const shown =
                  summary.other === null
                    ? summary.scope
                    : displayNameFor(summary.other, names.get(summary.other))
                return (
                  <Pressable
                    key={summary.scope}
                    testID={`pick-${summary.scope}`}
                    onPress={() => onPick(summary.scope)}
                    accessibilityRole="button"
                    accessibilityLabel={shown}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}>
                    <Avatar shown={shown} />
                    <Text style={styles.name} numberOfLines={1}>
                      {shown}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )}

          <Pressable
            testID="pick-cancel"
            onPress={() => onPick(null)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
            <Text style={styles.cancelLabel}>{t('pick_cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  over: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, as `Plate.tsx` argues: the palette carries no
    // translucent value and invariant 11 forbids inventing one.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  sheet: {
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    paddingTop: space.m,
    paddingBottom: space.m,
    paddingHorizontal: space.s,
    gap: space.s,
    // Half the screen. A sheet that covers everything is a screen, and this
    // one opens over something somebody was reading.
    maxHeight: '62%',
  },
  heading: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: floors.touchTargetMin,
    paddingVertical: space.s,
    paddingHorizontal: layout.screenGutter,
    borderBottomWidth: stroke.hairline.value,
    borderBottomColor: color.neutral['200'],
  },
  name: { ...type.titleMd, color: color.neutral['900'], flex: 1 },
  empty: {
    ...type.body,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.l,
  },
  cancel: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
  },
  cancelLabel: { ...type.action, color: color.brand.green700 },
  pressed: { backgroundColor: color.neutral['200'] },
})
