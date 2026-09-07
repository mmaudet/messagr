import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, radius, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import {
  smallestCopyOf,
  type ReadFile,
  type ReadImage,
} from '../timeline/imageEvent'

/**
 * A photograph inside a conversation.
 *
 * # Fetched when it is drawn, not when the conversation is
 *
 * A conversation derives its whole timeline on every launch (ADR-0005), and
 * downloading and decrypting every photograph it ever carried would make that
 * derivation cost megabytes. So each one fetches itself, once, when its
 * message is drawn — which is also what makes it possible for a picture to
 * fail on its own without taking the message with it.
 *
 * # It draws the smallest copy that will do, and `full` is opted into
 *
 * A tile is about 130 points and a photograph up to twelve megabytes, so a
 * surface that is not the full-screen viewer asks for the sender's thumbnail
 * (#117). `full` is the exception rather than the default on purpose: a
 * surface that forgets to ask gets a soft picture, which somebody can see,
 * where the opposite default would give it a full download, which nobody can
 * — and an invisible megabyte per tile is precisely the defect this argument
 * exists to remove.
 *
 * # Three states, and the middle one is not a spinner
 *
 * Loading shows a rectangle at the picture's own proportions rather than a
 * turning circle: the layout does not jump when the image lands, and a
 * conversation that reflows as photographs arrive is one a person loses their
 * place in. The proportions come from the sender's `info`, which is a
 * rendering hint and is treated as one — a missing one falls back to a
 * square.
 *
 * Failure is a sentence (§13.19.6). The technical reason goes to the log,
 * where somebody debugging looks and nobody else does.
 */

/** What a picture with no stated proportions is drawn as. */
const ASSUMED_RATIO = 1

export function Photograph({
  image,
  fetch,
  testID,
  fill = false,
  full = false,
}: {
  readonly image: ReadImage
  readonly fetch: (file: ReadFile) => Promise<ShownImage>
  readonly testID: string
  /**
   * Fill the space given rather than take the picture's own proportions.
   *
   * A plate's tiles are square and the pictures are not; a grid of
   * differently-shaped tiles is a grid nobody can scan. So a tile crops,
   * which is what a thumbnail is for, and full screen shows the whole
   * picture.
   */
  readonly fill?: boolean
  /**
   * Fetch the photograph itself rather than the sender's thumbnail.
   *
   * For the full-screen viewer, which is the one surface a thumbnail is not
   * good enough for — and the one where the photograph's cost is affordable,
   * because it is one picture at a time with nothing else competing for the
   * thread that draws.
   */
  readonly full?: boolean
}) {
  const [shown, setShown] = useState<ShownImage | null>(null)
  // An event with no thumbnail — every one sent before #117 — answers the
  // photograph, so this is the whole of the backward compatibility.
  const drawn = full ? image : smallestCopyOf(image)

  useEffect(() => {
    let wanted = true
    fetch(drawn)
      .then(answer => {
        if (wanted) setShown(answer)
      })
      .catch(() => {
        // `fetchImage` reports rather than throws; this catch is for a port
        // that does not, and a picture is not worth an unhandled rejection.
        if (wanted) setShown({ shown: false, reason: 'unknown' })
      })
    // A message scrolled past before its picture arrived must not set state
    // on a view that has gone.
    return () => {
      wanted = false
    }
  }, [drawn, fetch])

  // The proportions of the copy actually drawn, not of the photograph: a
  // picker is free to re-encode, and a frame reserved at one shape for a
  // picture that lands at another is the reflow the frame exists to prevent.
  const ratio =
    drawn.width !== null && drawn.height !== null && drawn.height > 0
      ? drawn.width / drawn.height
      : ASSUMED_RATIO

  if (shown === null) {
    return (
      <View
        testID={`${testID}-waiting`}
        style={[
          styles.frame,
          styles.waiting,
          fill ? styles.filling : { aspectRatio: ratio },
        ]}
      />
    )
  }

  if (!shown.shown) {
    return (
      <Text testID={`${testID}-failed`} style={styles.failed}>
        {t('image_unreadable')}
      </Text>
    )
  }

  return (
    <Image
      testID={testID}
      source={{ uri: shown.uri }}
      style={[styles.frame, fill ? styles.filling : { aspectRatio: ratio }]}
      // On its own, `contain`: cropping somebody's photograph to fit a box
      // this application chose is not this application's decision. In a
      // plate's tile, `cover`, because the tile is a thumbnail and a
      // thumbnail's whole job is to be the same shape as its neighbours.
      resizeMode={fill ? 'cover' : 'contain'}
      accessibilityLabel={t('image_alt')}
    />
  )
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: radius.bubble,
  },
  waiting: {
    backgroundColor: color.neutral['200'],
  },
  filling: {
    width: '100%',
    height: '100%',
  },
  failed: {
    ...type.body,
    color: color.neutral['600'],
    paddingVertical: space.s,
  },
})
