import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, layout, space, stroke, type } from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * The one time this product asks somebody to take responsibility for a
 * secret.
 *
 * # WHEN IT APPEARS, AND WHY NOT SOONER
 *
 * After the first message **received** — `offerBackup.ts` owns that decision
 * and says why in full. Before then there is nothing to lose, so the promise
 * is abstract and the refusal is free.
 *
 * # WHY THIS IS NOT `Consequences.tsx`
 *
 * That component is the drawn form for a gesture nothing takes back, and it
 * is shaped by two things this screen is not. It prints the word
 * *« Irréversible »* as a label above its last sentence, and it names a
 * `target` — who the gesture is about.
 *
 * Accepting a backup is neither. It can be undone from Réglages, it is about
 * nobody, and a screen that printed *« Irréversible »* over an offer that is
 * refusable would be false in the one place a person is deciding. Reusing it
 * would have been the cheaper change and the wrong one.
 *
 * What is borrowed is the idiom rather than the component: a tinted card with
 * an accent stroke down its left edge, which `Trust.tsx` (screen 25, drawn)
 * established for "a fact with a tone", and a refusal of the same rank as the
 * acceptance, which the prototype states for its verification screen —
 * *« Le refus est un bouton de même rang que l'acceptation. »*
 *
 * # THE THREE FACTS, IN THE ORDER THEY ARE READ
 *
 * **What it costs to do nothing** comes first, because it is the only reason
 * anybody would say yes, and burying it under an explanation of the
 * mechanism would be asking for a decision without its premise.
 *
 * **What the backup does not cover** comes second. ADR-0010 keeps the
 * notebook local and mortal — given names, favourites, read marks — and
 * somebody who accepts this and later loses those would have been misled by
 * silence.
 *
 * **The weakness** comes last and is not softened. ADR-0013: *« C'est le seul
 * endroit où "chiffré de bout en bout" promet un peu plus que le mécanisme ne
 * tient, et ce dépôt a déjà eu à corriger deux fois une affirmation publiée
 * qui dépassait son code. »*
 *
 * # NO SENTENCE HERE MENTIONS ENCRYPTION
 *
 * `copy.spec.ts` refuses any `backup_*` string containing *« chiffr »*, and
 * the reason is a product rule rather than a wording preference. The promise
 * *« Chiffrée de bout en bout, sans réglage »* is about encryption, which
 * stays automatic; what becomes a choice here is durability. A screen that
 * explained encryption where somebody accepts or refuses something would
 * make it look like a setting.
 *
 * # THE COLOURS
 *
 * Green appears once, on the acceptance, which invariant 3 permits: it is
 * *« l'action principale »* of this screen. The two weighed facts take the
 * ochre `Trust.tsx` and `Consequences.tsx` both use for something to hold
 * before deciding. Nothing is red — nothing here is wrong, and a warning
 * colour on an offer would be a product frightening somebody into accepting.
 */
export function BackupOffer({
  onAccept,
  onRefuse,
}: {
  readonly onAccept: () => void
  /**
   * Recorded before the answer, and the caller owes that ordering: an offer
   * interrupted — the application killed, the screen turned — is an offer
   * that was made. See `offerBackup.ts`.
   */
  readonly onRefuse: () => void
}) {
  return (
    <View style={styles.screen} testID="backup-offer">
      <Text style={styles.title}>{t('backup_offer_title')}</Text>
      <Text style={styles.lead}>{t('backup_offer_lead')}</Text>

      <View style={[styles.card, styles.weigh]} testID="backup-offer-loss">
        <Text style={styles.body}>{t('backup_offer_loss')}</Text>
      </View>

      <View style={[styles.card, styles.plain]} testID="backup-offer-scope">
        <Text style={styles.body}>{t('backup_offer_scope')}</Text>
      </View>

      <View style={[styles.card, styles.weigh]} testID="backup-offer-trust">
        <Text style={styles.body}>{t('backup_offer_trust')}</Text>
      </View>

      <View style={styles.actions}>
        <NotchedButton
          testID="backup-offer-accept"
          label={t('backup_offer_accept')}
          onPress={onAccept}
          wide
        />
        {/* `quiet`, which is the tone that exists so a refusal can be a
            button of the same rank as the thing it refuses. Not a link, not
            a smaller word: somebody declining a security prompt must not
            have to hunt for the way out. */}
        <NotchedButton
          testID="backup-offer-refuse"
          label={t('backup_offer_refuse')}
          onPress={onRefuse}
          tone="quiet"
          wide
        />
        {/* The one sentence that makes the refusal honest. Without it, "Pas
            maintenant" reads as a postponement the product will chase, and
            it will not: ADR-0013 records the refusal for good and leaves a
            line in Réglages. */}
        <Text style={styles.later}>{t('backup_offer_later')}</Text>
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
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  lead: {
    ...type.body,
    color: color.neutral['600'],
  },
  card: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
  },
  // Something to hold before deciding. `Trust.tsx` and `Consequences.tsx`
  // both spend this ochre on exactly that, and its token says so.
  weigh: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  // Simply true: nothing is wrong and nothing is being weighed.
  plain: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  body: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  actions: {
    marginTop: space.m,
    gap: space.s,
  },
  later: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
