import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { color, radius, space, type } from '../design/tokens'
import { initialsOf } from './initials'

/**
 * The circle at the start of a list row, carrying initials.
 *
 * # Initials of what
 *
 * Of the given name when there is one, and of the identifier when there is
 * not — which is the same rule the row's first line follows, so the two can
 * never disagree. An avatar showing initials the name beside it does not have
 * is the kind of small lie that makes a list feel wrong without anybody being
 * able to say why.
 *
 * # No photographs, and not because they are hard
 *
 * A profile picture is a piece of content the homeserver would hold
 * unencrypted and serve to anybody who knows the identifier, which is the
 * shape of thing this product spends its whole design avoiding. Initials cost
 * nothing and give away nothing.
 */

export function Avatar({
  shown,
  testID,
  size,
}: {
  readonly shown: string
  readonly testID?: string
  /**
   * A round of this many points instead of the list's own.
   *
   * The default is the touch-target size, which is what a row wants and what
   * the note below argues for. A call screen is the exception the option
   * exists for: there is one person on it and nothing else, and an avatar
   * sized for a list line reads as a decoration on a screen with nothing to
   * decorate.
   */
  readonly size?: number
}) {
  return (
    <View
      style={[
        styles.circle,
        size === undefined
          ? undefined
          : { width: size, height: size, borderRadius: radius.avatar },
      ]}
      testID={testID}>
      <Text style={size === undefined ? styles.initials : styles.large}>
        {initialsOf(shown)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    // A round of the touch-target size: the row is pressable as a whole, and
    // an avatar smaller than the thing it sits in reads as a decoration
    // rather than as part of it.
    width: space.xxl + space.m,
    height: space.xxl + space.m,
    // `avatar` rather than `pill`, which is what the token is named for: a
    // 26pt radius on a 56pt round draws a squircle.
    borderRadius: radius.avatar,
    backgroundColor: color.brand.green100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    ...type.titleMd,
    color: color.brand.green700,
  },
  large: {
    ...type.display,
    color: color.brand.green700,
  },
})
