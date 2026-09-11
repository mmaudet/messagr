import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, layout, space, stroke, type } from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * The offer to make a past readable again, drawn beside a conversation list
 * that has already appeared.
 *
 * # IT IS NOT A DOOR, AND THAT IS THE WHOLE DESIGN
 *
 * ADR-0013 fixes the order and `offerRestore.ts` carries the argument in
 * full: *« L'appareil montre ses conversations d'abord, illisibles, et
 * propose la clé ensuite. Demander un secret à la porte est ce que fait une
 * banque, pas un messager. »*
 *
 * So this screen never blocks. Somebody who has lost their key, or never
 * made one, dismisses it and goes on writing. What stays shut is the past,
 * not the application — and `restore_offer_later` says exactly that, because
 * a refusal whose cost is unstated is a refusal nobody can make.
 *
 * # THE NUMBER IS CARRIED, NOT ROUNDED
 *
 * `offerRestore.ts` returns `unreadable` for this screen and says why: *« A
 * number somebody can check against what they can see is the difference
 * between a sentence they believe and one they skip. »* Somebody looking at
 * four grey messages and reading « 4 » believes the rest of the sentence.
 *
 * # NO SENTENCE HERE MENTIONS ENCRYPTION
 *
 * The same product rule ADR-0013 imposes on the acceptance, for the same
 * reason, and `copy.spec.ts` is extended to `restore_*` alongside these
 * keys. What became a choice is durability; encryption did not, and a screen
 * explaining it where somebody decides something would make it look like a
 * setting.
 *
 * # NOTHING IS RED
 *
 * An unreadable past is a fact, not an error. The ochre of `Trust.tsx` is
 * the colour of something to weigh; red here would be the product
 * frightening somebody who may simply not have their key.
 */
export function RestoreOffer({
  unreadable,
  onEnterKey,
  onRefuse,
}: {
  /** How many entries in view this device could not read. */
  readonly unreadable: number
  readonly onEnterKey: () => void
  /**
   * Recorded before the answer, for the reason `offerBackup.ts` gives: an
   * offer interrupted is an offer that was made.
   */
  readonly onRefuse: () => void
}) {
  return (
    <View style={styles.screen} testID="restore-offer">
      <Text style={styles.title}>{t('restore_offer_title')}</Text>
      <Text style={styles.lead}>{t('restore_offer_lead')}</Text>

      <View style={[styles.card, styles.weigh]} testID="restore-offer-scope">
        <Text style={styles.body}>
          {t('restore_offer_scope %1$d', unreadable)}
        </Text>
      </View>

      <View style={[styles.card, styles.plain]} testID="restore-offer-have">
        <Text style={styles.body}>{t('restore_offer_have')}</Text>
      </View>

      <View style={styles.actions}>
        <NotchedButton
          testID="restore-offer-accept"
          label={t('restore_offer_accept')}
          onPress={onEnterKey}
          wide
        />
        <NotchedButton
          testID="restore-offer-refuse"
          label={t('restore_offer_refuse')}
          onPress={onRefuse}
          tone="quiet"
          wide
        />
        <Text style={styles.later}>{t('restore_offer_later')}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
    gap: space.m,
  },
  title: { ...type.titleLg, color: color.neutral['900'] },
  lead: { ...type.body, color: color.neutral['600'] },
  card: { padding: space.m, borderLeftWidth: stroke.accent },
  weigh: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  plain: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  body: { ...type.bodySm, color: color.neutral['900'] },
  actions: { marginTop: space.m, gap: space.s },
  later: { ...type.caption, color: color.neutral['600'] },
})
