import React from 'react'
import { StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, layout, space, type } from '../design/tokens'
import { BrandMark } from './BrandMark'

/**
 * The dark band across the top, carrying the mark and the instance's state.
 *
 * # Why the header is a security boundary rather than a title bar
 *
 * `brand.ink900`'s own token says what it is for: *« Fond des frontières de
 * sécurité, texte fort. »* This band is not decoration and not navigation —
 * it is the one place the application says something about itself rather than
 * about a conversation, and the dark ground is the token's way of marking
 * that difference. Putting a title here would waste it; the screen below
 * already says which screen it is.
 *
 * # It carried "aucun annuaire", and no longer does
 *
 * That no directory exists is the product's most consequential fact, and the
 * mockup puts it here. It is also said, in full and in a sentence somebody
 * can read, directly under the conversation list — and saying it twice on one
 * screen is how a thing stops being read at all. Removed at the account
 * holder's request, with `list_no_directory` left carrying it.
 *
 * # It owns the top inset, and the status bar with it
 *
 * The screen used to reserve that inset, which left a pale strip above the
 * band — and the system drew the clock, the signal and the battery into it in
 * white, because the promise screen before it is dark. Reported from a device:
 * *« le bandeau sup de l'android avec le réseau, le niveau de batterie n'est
 * plus visible »*.
 *
 * The band runs to the top of the screen instead, and `light-content` is then
 * simply true: everything behind the status bar in this application is
 * `ink900`, on this screen and on the promise screen both. Same rule as
 * `TabBar` at the other edge — whatever sits on an edge paints to it.
 */

export function Header({
  testID = 'header',
  children,
}: {
  readonly testID?: string
  /**
   * What stands in the band instead of the wordmark.
   *
   * # ONE BAND, MOUNTED ONCE, WHATEVER IS IN IT
   *
   * The selection bar used to be its own `SafeAreaView` with its own
   * `StatusBar`, drawn where this one had been unmounted. Entering the mode
   * therefore tore down the top of the screen and built another one: the
   * safe area was measured again, and the status-bar style popped back to
   * the platform default for the frame between one declaration unmounting
   * and the next mounting. Reported from the Pixel as « un flash vraiment
   * pas agréable », which is exactly what that is.
   *
   * So the band stays mounted and only its contents change. Nothing
   * measures the inset twice and the status bar is declared in one place,
   * for the life of the screen.
   */
  readonly children?: React.ReactNode
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.band} testID={testID}>
      {/* No `backgroundColor`: React Native 0.87 dropped it, because
          Android 15 draws edge-to-edge and the bar has no ground of its own
          any more. It does not need one -- the band behind it is `ink900`,
          which is exactly what a background colour would have painted. */}
      <StatusBar barStyle="light-content" />
      {children ?? (
        <View style={styles.mark}>
          <BrandMark size={space.xl} tint={color.surface.paper} />
          <Text style={styles.wordmark}>{t('brand_name')}</Text>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'column',
    justifyContent: 'center',
    // `green900`, not `ink900`. The band was near-black -- reported from a
    // device -- and `ink900`'s own token says what it is for: the ground of
    // security boundaries, which is the promise screen and not a title bar.
    // A band that is meant to read as the brand should read as the brand.
    backgroundColor: color.brand.green900,
    paddingVertical: space.m,
  },
  mark: {
    paddingHorizontal: layout.screenGutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  wordmark: {
    ...type.titleMd,
    color: color.surface.paper,
  },
})
