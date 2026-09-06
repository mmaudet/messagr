import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, radius, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadImage } from '../timeline/imageEvent'
import type { Plate as Grouping } from '../timeline/plates'
import { Photograph } from './Photograph'

/**
 * Several photographs, drawn as one thing.
 *
 * # Four tiles, and a count on the fourth
 *
 * Two by two. Beyond four the last tile carries `+ N` and opens the same
 * full-screen view the others do, at the fifth — so nothing is unreachable
 * and nothing needs a second gesture to reach.
 *
 * # A plate of one is a photograph
 *
 * `platesIn` makes a plate of a lone image so a screen has one shape to
 * handle rather than two. Here is where that choice is paid back: one entry
 * draws as it always did, at its own proportions, without a grid around it.
 *
 * # Every tile is square, and the pictures are not
 *
 * A grid of differently-shaped tiles is a grid nobody can scan. The tiles are
 * square and the pictures fill them, which crops — and cropping a thumbnail
 * is what a thumbnail is for. Full screen shows the whole picture.
 */

/** How many tiles are drawn before the count takes over. */
const TILES = 4

export function Plate({
  plate,
  fetch,
  onOpen,
}: {
  readonly plate: Grouping
  readonly fetch: (image: ReadImage) => Promise<ShownImage>
  /** Opens the plate full screen, at the index tapped. */
  readonly onOpen: (at: number) => void
}) {
  const entries = plate.entries
  const first = entries[0]
  if (first?.image === undefined) return null

  if (entries.length === 1) {
    return (
      <Pressable
        testID={`plate-${plate.at}`}
        onPress={() => onOpen(0)}
        accessibilityRole="button"
        accessibilityLabel={t('plate_open')}>
        <Photograph
          image={first.image}
          fetch={fetch}
          testID={`image-${first.eventId}`}
        />
      </Pressable>
    )
  }

  const shown = entries.slice(0, TILES)
  const hidden = entries.length - TILES

  return (
    <View style={styles.grid} testID={`plate-${plate.at}`}>
      {shown.map((entry, at) => {
        const last = at === TILES - 1 && hidden > 0
        return (
          <Pressable
            key={entry.eventId}
            testID={`plate-tile-${entry.eventId}`}
            // The counted tile opens at the fifth, which is the first one it
            // stands for. Opening at the fourth would show a picture already
            // on screen.
            onPress={() => onOpen(last ? TILES : at)}
            accessibilityRole="button"
            accessibilityLabel={
              last ? t('plate_more %1$d', hidden) : t('plate_open')
            }
            style={styles.tile}>
            {entry.image !== undefined && (
              <Photograph
                image={entry.image}
                fetch={fetch}
                fill
                testID={`image-${entry.eventId}`}
              />
            )}
            {last && (
              <View style={styles.count} testID={`plate-more-${plate.at}`}>
                <Text style={styles.countLabel}>
                  {t('plate_more %1$d', hidden)}
                </Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    borderRadius: radius.bubble,
    overflow: 'hidden',
  },
  tile: {
    // Two per row, minus half the gap each. Square, because a grid of
    // differently-shaped tiles is a grid nobody can scan.
    width: '49%',
    aspectRatio: 1,
    borderRadius: radius.bubbleAuthorCorner,
    overflow: 'hidden',
  },
  count: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // The ink, not an opacity: the palette has no translucent value and
    // invariant 11 forbids inventing one. A solid scrim would hide the
    // picture entirely, so this is the darkest ground the palette has, and
    // the count sits on it in paper.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  countLabel: {
    ...type.titleLg,
    color: color.surface.paper,
  },
})
