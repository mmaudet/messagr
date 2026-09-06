import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, radius, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadImage } from '../timeline/imageEvent'

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
}: {
  readonly image: ReadImage
  readonly fetch: (image: ReadImage) => Promise<ShownImage>
  readonly testID: string
}) {
  const [shown, setShown] = useState<ShownImage | null>(null)

  useEffect(() => {
    let wanted = true
    fetch(image)
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
  }, [image, fetch])

  const ratio =
    image.width !== null && image.height !== null && image.height > 0
      ? image.width / image.height
      : ASSUMED_RATIO

  if (shown === null) {
    return (
      <View
        testID={`${testID}-waiting`}
        style={[styles.frame, styles.waiting, { aspectRatio: ratio }]}
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
      style={[styles.frame, { aspectRatio: ratio }]}
      // `cover` would crop somebody's photograph to fit a box this
      // application chose. The box is the photograph's shape instead.
      resizeMode="contain"
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
  failed: {
    ...type.body,
    color: color.neutral['600'],
    paddingVertical: space.s,
  },
})
