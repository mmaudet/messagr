import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

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
    <View style={styles.band} testID={testID}>
      <View style={styles.mark}>
        <BrandMark size={space.xl} tint={color.surface.paper} />
        <Text style={styles.wordmark}>{t('brand_name')}</Text>
      </View>
      <Text style={styles.state} testID={`${testID}-state`}>
        {t(state)}
      </Text>
    </View>
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
