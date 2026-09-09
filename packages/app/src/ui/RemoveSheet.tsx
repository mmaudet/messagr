import React from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'

/**
 * The two scopes of removing, named without euphemism.
 *
 * §13.7 asks for exactly that: *« deux portées nommées sans euphémisme :
 * pour moi, pour tout le monde »*. A bar has room for neither label whole,
 * which is why a single "Supprimer" opens this instead.
 *
 * # EACH ONE SAYS WHAT IT DOES, BECAUSE THEY DO DIFFERENT THINGS
 *
 * "For everyone" is a redaction: the other person's copy goes too, and a
 * line stays where the message was -- §13.7 again, *« un retrait est un fait
 * social, pas une disparition silencieuse »*.
 *
 * "For me" cannot mean what it means in other messengers. ADR-0006 keeps
 * nothing decrypted on disk, so there is no local copy to erase; it means
 * this telephone stops drawing it. `hiddenStore.ts` argues that, and the
 * sentence under the choice says the consequence out loud, because somebody
 * who is not told will find the message again on their next device and
 * conclude the product lied.
 *
 * # AND "FOR EVERYONE" IS NOT ALWAYS THERE
 *
 * Only on this account's own messages. Redacting somebody else's is a
 * moderation power rather than a delete button (#196).
 */
export function RemoveSheet({
  count,
  forEveryone,
  onForMe,
  onForEveryone,
  onCancel,
}: {
  readonly count: number
  /** Whether "for everyone" applies to all of what is selected. */
  readonly forEveryone: boolean
  readonly onForMe: () => void
  readonly onForEveryone: () => void
  readonly onCancel: () => void
}) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="remove-sheet">
      <View style={styles.over}>
        <Pressable
          testID="remove-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t('remove_cancel')}
          onPress={onCancel}
        />
        <View style={styles.sheet}>
          <Text style={styles.heading}>{t('remove_title %1$d', count)}</Text>

          {forEveryone && (
            <Pressable
              testID="remove-everyone"
              onPress={onForEveryone}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.choice,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.choiceLabel, styles.destructive]}>
                {t('remove_everyone')}
              </Text>
              <Text style={styles.why}>{t('remove_everyone_why')}</Text>
            </Pressable>
          )}

          <Pressable
            testID="remove-me"
            onPress={onForMe}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('remove_me')}</Text>
            {/* THE CONSEQUENCE, SAID OUT LOUD. Somebody who is not told will
                find the message again on their next device and conclude the
                product lied to them. */}
            <Text style={styles.why}>{t('remove_me_why')}</Text>
          </Pressable>

          <Pressable
            testID="remove-cancel"
            onPress={onCancel}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('remove_cancel')}</Text>
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
    // The ink and an opacity, as `Plate.tsx`: the palette carries no
    // translucent value and invariant 11 forbids inventing one.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  sheet: {
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    padding: space.m,
    gap: space.xs,
  },
  heading: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: space.s,
    paddingBottom: space.s,
  },
  choice: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingVertical: space.s,
    paddingHorizontal: space.s,
    borderRadius: radius.bubble,
    gap: space.xs,
  },
  choiceLabel: { ...type.titleMd, color: color.neutral['900'] },
  destructive: { color: color.deny['700'] },
  why: { ...type.caption, color: color.neutral['600'] },
  pressed: { backgroundColor: color.neutral['200'] },
})
