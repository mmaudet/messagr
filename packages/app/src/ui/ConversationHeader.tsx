import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
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
 * A title that happens to be tappable is a title nobody taps. The avatar, the
 * name and the chevron are one target, at the touch-target floor, with an
 * accessibility label that says what it opens rather than repeating the name.
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
        {/* The same typographic distinction the list row makes: a given name
            is set in the title role, an identifier in the mono one. A person
            who has been named must not read differently in two places. */}
        <Text numberOfLines={1} style={named ? styles.name : styles.identifier}>
          {shown}
        </Text>
      </Pressable>

      <Text style={styles.more} accessible={false}>
        {'⋮'}
      </Text>
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
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
    flexShrink: 1,
  },
  identifier: {
    ...type.monoId,
    color: color.neutral['900'],
    flexShrink: 1,
  },
  more: {
    ...type.titleMd,
    color: color.neutral['600'],
    paddingHorizontal: space.s,
  },
})
