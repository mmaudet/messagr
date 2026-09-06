import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'

/**
 * Settings.
 *
 * The prototype specifies six sections at full desktop parity (screen 19,
 * `product-spec.md` §13.18). This lot builds the sections its own features
 * need, and **the rest are absent rather than present and inert** — which is
 * the ticket's own criterion and the harder discipline: a greyed row for a
 * setting nothing implements looks like a feature that is coming, and the
 * only honest version of "not built" is nothing at all plus a sentence saying
 * so.
 *
 * That sentence matters more than it looks. §13.19 invariant 9 says a
 * capability *locked by a room policy* stays visible and greyed with its
 * reason — and that is a different case from this one. Something switched off
 * by a policy exists; something not built does not, and dressing the second as
 * the first would be a lie the invariant never asked for.
 *
 * # Why the legal row is not one row among several
 *
 * It is the reason this screen exists at all. The conditions published at
 * messagr.eu say the article 14 information is carried by a screen reachable
 * *from Settings*, so Settings is load-bearing for a published legal claim
 * before it is load-bearing for any preference.
 */
export function Settings({
  onBack,
  onLegal,
  receipts,
  onReceipts,
  receiptsNotKept,
}: {
  readonly onBack: () => void
  readonly onLegal: () => void
  readonly receipts: boolean
  readonly onReceipts: (on: boolean) => void
  /** `true` when the last change could not be kept. */
  readonly receiptsNotKept: boolean
}) {
  return (
    <View style={styles.screen} testID="settings">
      <Pressable
        testID="settings-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('list_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('settings_title')}</Text>

      <Pressable
        testID="settings-legal"
        onPress={onLegal}
        accessibilityRole="button"
        accessibilityLabel={t('settings_legal')}
        style={styles.row}>
        <Text style={styles.rowLabel}>{t('settings_legal')}</Text>
      </Pressable>

      {/* The one setting this lot's own features need. Its hint says what
          turning it on costs rather than what it does: everybody knows what a
          read receipt does, and nobody is told who else finds out. */}
      <View style={styles.setting} testID="setting-receipts">
        <Pressable
          testID="toggle-receipts"
          onPress={() => onReceipts(!receipts)}
          accessibilityRole="switch"
          accessibilityState={{ checked: receipts }}
          accessibilityLabel={t('settings_receipts')}
          style={styles.row}>
          <Text style={styles.rowLabel}>{t('settings_receipts')}</Text>
          <Text style={styles.rowValue}>
            {receipts ? t('settings_receipts_on') : t('settings_receipts_off')}
          </Text>
        </Pressable>
        <Text style={styles.hint}>{t('settings_receipts_hint')}</Text>
        {receiptsNotKept && (
          <Text style={styles.notKept}>{t('settings_receipts_not_kept')}</Text>
        )}
      </View>

      <Text style={styles.nothingElse}>{t('settings_nothing_else')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    gap: space.l,
  },
  back: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  backLabel: {
    ...type.bodySm,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  row: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    borderTopWidth: stroke.hairline.value,
    borderBottomWidth: stroke.hairline.value,
    borderColor: color.neutral['200'],
  },
  rowLabel: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  setting: { gap: space.s },
  rowValue: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  hint: {
    ...type.caption,
    color: color.neutral['600'],
  },
  notKept: {
    ...type.caption,
    color: color.deny['700'],
  },
  nothingElse: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
