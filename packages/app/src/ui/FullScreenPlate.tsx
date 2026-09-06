import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadImage } from '../timeline/imageEvent'
import type { Plate } from '../timeline/plates'
import { Photograph } from './Photograph'

/**
 * A plate, one photograph at a time, filling the screen.
 *
 * # It pages through the whole plate, not the four that were drawn
 *
 * The grid shows four and counts the rest. Somebody who taps the count is
 * asking to see what the count stands for, and a viewer that could only
 * reach the four already on screen would answer a question nobody asked.
 *
 * # Dark ground, and it is the only screen that gets one
 *
 * `ink900` is the token for a security boundary and this is not one — it is
 * here because a photograph is the content, and a pale ground around it
 * changes how the photograph reads. Recorded rather than smuggled: a reader
 * revisiting invariant 11 should find the reason next to the use.
 *
 * # Paging is two taps, not a gesture
 *
 * A swipe would be the ordinary way and it needs a gesture handler this
 * application does not have. Two targets at the screen's edges do the same
 * job, work with a screen reader, and cost no dependency. When a pager
 * arrives, this is what it replaces.
 */

export function FullScreenPlate({
  plate,
  at,
  fetch,
  onClose,
}: {
  readonly plate: Plate
  /** Which photograph to open on. */
  readonly at: number
  readonly fetch: (image: ReadImage) => Promise<ShownImage>
  readonly onClose: () => void
}) {
  const [showing, setShowing] = useState(at)
  const entries = plate.entries
  const entry = entries[Math.min(showing, entries.length - 1)]

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      testID="plate-full">
      <View style={styles.ground}>
        <View style={styles.bar}>
          <Pressable
            testID="plate-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('plate_close')}
            style={styles.target}>
            <Text style={styles.chevron}>{'←'}</Text>
          </Pressable>
          <Text style={styles.of} testID="plate-of">
            {t('plate_of %1$d %2$d', showing + 1, entries.length)}
          </Text>
        </View>

        <View style={styles.stage}>
          {entry?.image !== undefined && (
            <Photograph
              image={entry.image}
              fetch={fetch}
              testID={`full-${entry.eventId}`}
            />
          )}
        </View>

        <View style={styles.paging}>
          <Pressable
            testID="plate-previous"
            disabled={showing === 0}
            onPress={() => setShowing(now => Math.max(0, now - 1))}
            accessibilityRole="button"
            accessibilityState={{ disabled: showing === 0 }}
            accessibilityLabel={t(
              'plate_of %1$d %2$d',
              showing,
              entries.length,
            )}
            style={styles.target}>
            <Text
              style={[styles.chevron, showing === 0 && styles.chevronSpent]}>
              {'‹'}
            </Text>
          </Pressable>
          <Pressable
            testID="plate-next"
            disabled={showing >= entries.length - 1}
            onPress={() =>
              setShowing(now => Math.min(entries.length - 1, now + 1))
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: showing >= entries.length - 1 }}
            accessibilityLabel={t(
              'plate_of %1$d %2$d',
              showing + 2,
              entries.length,
            )}
            style={styles.target}>
            <Text
              style={[
                styles.chevron,
                showing >= entries.length - 1 && styles.chevronSpent,
              ]}>
              {'›'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.xxl,
    paddingBottom: space.s,
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.s,
  },
  paging: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
  },
  target: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    ...type.titleLg,
    color: color.surface.paper,
  },
  chevronSpent: {
    // `state.disabled`'s only permitted grey, and no opacity -- the token
    // forbids one outright.
    color: color.neutral['600'],
  },
  of: {
    ...type.monoLabel,
    color: color.agent['400'],
  },
})
