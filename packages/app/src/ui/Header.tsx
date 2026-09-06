import React from 'react'
import { StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t, type CopyKey } from '../copy'
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
 * # What it says, and what the mockup said that this does not
 *
 * *« aucun annuaire »* — that no directory exists, which is the product's
 * single most consequential fact and the one nobody would guess. The mockup
 * suffixes it with a phase marker; that marker is a reference to the
 * specification for whoever is reading the mockup, and it is not something to
 * put on the screen of somebody reading their own messages.
 *
 * The mono role, because it is a machine fact about this instance and not a
 * sentence addressed to anybody — the same distinction `ConversationList`
 * draws between a name and an identifier.
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
  state = 'header_no_directory',
  testID = 'header',
}: {
  /** What this instance is, in the mono role. */
  readonly state?: CopyKey
  readonly testID?: string
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.band} testID={testID}>
      {/* No `backgroundColor`: React Native 0.87 dropped it, because
          Android 15 draws edge-to-edge and the bar has no ground of its own
          any more. It does not need one -- the band behind it is `ink900`,
          which is exactly what a background colour would have painted. */}
      <StatusBar barStyle="light-content" />
      <View style={styles.mark}>
        <BrandMark size={space.xl} tint={color.surface.paper} />
        <Text style={styles.wordmark}>{t('brand_name')}</Text>
      </View>
      <Text style={styles.state} testID={`${testID}-state`}>
        {t(state)}
      </Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.brand.ink900,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.m,
    gap: space.m,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  wordmark: {
    ...type.titleMd,
    color: color.surface.paper,
  },
  state: {
    ...type.monoLabel,
    // Not the paper white: this is a fact about the instance, subordinate to
    // the mark beside it, and equal weight would make them read as one label.
    color: color.agent['400'],
  },
})
