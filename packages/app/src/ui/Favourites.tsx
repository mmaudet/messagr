import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { KeptMessage } from '../runtime/readFavourites'
import { stampFor } from '../timeline/whenShown'
import { whenLabel } from './whenLabel'

/**
 * The messages somebody kept, and the way back to where each was said.
 *
 * # WHY IT LIVES IN RÉGLAGES
 *
 * #195 left this open with three candidates. The tab bar cannot take a fifth
 * tab -- `TabBar.tsx` states that as an invariant, not a preference -- and
 * the other two do not fit what a favourite is: the conversation header's
 * menu is scoped to one conversation, and favourites cross them, while a
 * filter on the conversation list would be filtering conversations to show
 * messages, which is a different kind of row.
 *
 * Réglages already carries a sub-screen this way (`Legal.tsx`), and it is
 * where every other messenger puts the same list. So it is the shape that
 * already exists rather than a fourth one invented for this.
 *
 * # THE COST IS ON THE SCREEN, WHICH THE TICKET ASKED FOR
 *
 * *« Le coût est réel et doit être écrit dans l'écran, pas seulement ici :
 * un favori ne suit pas la personne sur un autre appareil et ne survit pas à
 * une réinstallation. »* It is the first thing under the title, because
 * somebody deciding whether to rely on this needs it before they rely on it
 * and not after.
 *
 * # A ROW THAT LOST ITS MESSAGE STILL DRAWS
 *
 * `entry: null` is a real answer -- a key that never arrived, a conversation
 * beyond what one fetch reaches, a message removed for everyone since. The
 * row says so and still opens the conversation. Dropping it would leave
 * somebody certain they had kept something they cannot find, which is worse
 * than a line admitting the mark outlived its message.
 */
export function Favourites({
  kept,
  shownFor,
  onBack,
  onOpen,
  now = Date.now(),
}: {
  readonly kept: readonly KeptMessage[]
  /** What to call the conversation a message was said in. */
  readonly shownFor: (scope: string) => string
  readonly onBack: () => void
  readonly onOpen: (scope: string) => void
  readonly now?: number
}) {
  return (
    <View style={styles.screen} testID="favourites">
      <Pressable
        testID="favourites-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('favourites_title')}</Text>
      <Text style={styles.cost} testID="favourites-cost">
        {t('favourites_cost')}
      </Text>

      {kept.length === 0 ? (
        <Text style={styles.empty} testID="favourites-empty">
          {t('favourites_empty')}
        </Text>
      ) : (
        kept.map(({ favourite, entry }) => (
          <Pressable
            key={favourite.eventId}
            testID={`favourite-${favourite.eventId}`}
            onPress={() => onOpen(favourite.scope)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Text
              numberOfLines={3}
              style={entry === null ? styles.lost : styles.said}>
              {entry === null
                ? t('favourites_lost')
                : entry.image !== undefined && entry.body === null
                  ? t('image_alt')
                  : (entry.body ?? t('favourites_lost'))}
            </Text>
            {/* Where and when, in that order: which conversation is what
                somebody scans for, and the moment is what tells two
                messages of the same shape apart. */}
            <Text style={styles.where}>
              {t(
                'favourites_where %1$@ %2$@',
                shownFor(favourite.scope),
                whenLabel(stampFor(favourite.at, now)),
              )}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
    gap: space.m,
  },
  back: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  backLabel: {
    ...type.titleMd,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  // The ochre of something to weigh, which is what `Trust.tsx` and
  // `Consequences.tsx` both use for a fact a person should hold before
  // deciding. Not red: nothing is wrong, and a warning colour would make a
  // limitation look like a fault.
  cost: {
    ...type.bodySm,
    color: color.wait['700'],
    backgroundColor: color.wait['100'],
    borderLeftWidth: stroke.accent,
    borderLeftColor: color.wait['500'],
    padding: space.m,
  },
  empty: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  row: {
    paddingVertical: space.m,
    gap: space.xs,
    borderBottomWidth: stroke.base,
    borderBottomColor: color.neutral['200'],
  },
  pressed: {
    backgroundColor: color.surface.sunk,
  },
  said: {
    ...type.body,
    color: color.neutral['900'],
  },
  // Italic rather than a different colour: §13 wants no state carried by
  // colour alone, and `Conversation.tsx` already draws a removed message
  // this way.
  lost: {
    ...type.body,
    color: color.neutral['600'],
    fontStyle: 'italic',
  },
  where: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
