import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, space, stroke, type } from '../design/tokens'
import { Avatar } from './Avatar'

/**
 * The bar at the top of a conversation, and the door to everything rare.
 *
 * # Why the rare gestures moved here
 *
 * Vouching, eviction, naming and the trust reading were stacked in the
 * message flow, under the composer, as full-width buttons. That is not a
 * conversation, and screen 21's own note is the argument against it:
 * *« la spécificité de Messagr ne doit se voir que là où elle apporte quelque
 * chose. Partout ailleurs, l'application ressemble à ce que les gens
 * connaissent déjà. »* Two of those gestures are irreversible and neither is
 * made twice a day; a person reading their messages should not have to scroll
 * past them.
 *
 * So the name at the top opens a screen about the person, which is where
 * every messenger somebody has already used keeps this. What is specific to
 * Messagr lives one tap away rather than in the way.
 *
 * # The name is a control, and it says so
 *
 * A title that happens to be tappable is a title nobody taps. The avatar and
 * the name are one target, at the touch-target floor, with an accessibility
 * label that says what it opens rather than repeating the name.
 *
 * The `⋮` opens the same screen. That is two affordances and not two code
 * paths -- one callback, used twice -- which is a different thing from the
 * two invite entrances #101 removed: those were two places to keep in step,
 * and one of them lived in scrolling content. Both of these are chrome, and
 * both are where a hand already reaches.
 *
 * # It is chrome, so it does not scroll
 *
 * Rendered above the scroll view rather than inside it. It was inside, which
 * meant it inherited the screen's 24pt padding and sat inset from both edges
 * with the messages sliding under it -- reported from a device: "l'espace
 * aujourd'hui existant est tout à fait inutile, le bandeau doit être sur
 * toute la largeur à minima".
 *
 * # One line, and the identifier is one tap away
 *
 * This showed a given name on the first line and the identifier under it, on
 * the argument that somebody who named a person still needs it occasionally
 * and that burying it a screen deeper to save eleven points of height was a
 * trade nobody asked for.
 *
 * Somebody asked for it, on 7 September 2026, looking at a conversation with
 * a person he had just named. The argument was not wrong about the need; it
 * was wrong about the cost. `@5oxlguqkuvkz:messagr-fork.maudet.cloud` under
 * "Quentin" is a line of machine text at the top of every screen of a
 * conversation with somebody whose name is right above it -- and the header
 * is itself the control that opens the screen where the identifier lives in
 * full. It is not buried, it is one tap under the thing you would tap to
 * check it.
 *
 * With no given name the identifier is the only line, exactly as before:
 * there is no second thing to say, and the first one has to be something.
 */

export function ConversationHeader({
  shown,
  named,
  onBack,
  onOpenPerson,
}: {
  /** The name or the identifier, exactly as the list row shows it. */
  readonly shown: string
  /** Whether `shown` is a given name. Decides the typographic role. */
  readonly named: boolean
  readonly onBack: () => void
  readonly onOpenPerson: () => void
}) {
  return (
    <View style={styles.bar} testID="conversation-header">
      <Pressable
        testID="conversation-back"
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t('list_back')}
        style={styles.back}>
        <Text style={styles.chevron}>{'←'}</Text>
      </Pressable>

      <Pressable
        testID="open-person"
        onPress={onOpenPerson}
        accessibilityRole="button"
        accessibilityLabel={t('person_open')}
        style={styles.who}>
        <Avatar shown={shown} testID="conversation-avatar" />
        <View style={styles.said}>
          {/* The same typographic distinction the list row makes: a given
              name is set in the title role, an identifier in the mono one. A
              person who has been named must not read differently in two
              places. */}
          <Text
            numberOfLines={1}
            style={named ? styles.name : styles.identifier}>
            {shown}
          </Text>
        </View>
      </Pressable>

      <Pressable
        testID="open-person-menu"
        onPress={onOpenPerson}
        accessibilityRole="button"
        accessibilityLabel={t('person_open')}
        style={styles.more}>
        <Text style={styles.moreGlyph}>{'⋮'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    // The gutter on the right only: the back arrow's own touch target eats
    // the left one, and WhatsApp's bar starts at the edge.
    paddingRight: space.s,
    paddingVertical: space.xs,
    backgroundColor: color.surface.paper,
    borderBottomWidth: stroke.hairline.value,
    borderBottomColor: color.neutral['200'],
  },
  back: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: floors.touchTargetMin,
  },
  said: { flex: 1 },
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
    flexShrink: 1,
  },
  identifier: {
    // `titleMono`, not `monoId`. The mono role existed at 11 and 9.5 points,
    // sized for a list line, and this is a screen's title -- it rendered a
    // username at 11 points, which was reported as too small and was. The
    // name/identifier distinction stays typographic; it is the family that
    // carries it, not the size.
    ...type.titleMono,
    color: color.neutral['900'],
    flexShrink: 1,
  },
  more: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreGlyph: {
    ...type.titleMd,
    color: color.neutral['600'],
  },
})
