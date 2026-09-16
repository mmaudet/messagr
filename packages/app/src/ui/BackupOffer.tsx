import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

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
 *
 * # IT SCROLLS, AND IT HAD TO (#324)
 *
 * This was a `View` at `flex: 1`, and it sits in an overlay outside the
 * application's own ScrollView — so nothing on it scrolled, and whatever did
 * not fit was not reachable at all.
 *
 * It does not fit. Estimated from the tokens and the French text rather than
 * measured on a device: on 375 by 667 points, which is an iPhone SE, about
 * 647 remain under the safe area. The title wraps to two lines (54), the lead
 * to four (84), the three cards come to about 81, 81 and 119 with their
 * padding, the gaps between them to 48, the actions to 137 with their two
 * 46-point buttons and the « plus tard » line, and the bottom padding to 32.
 * That is around 648 with nothing wrong, and #284 put a failure card of 50 to
 * 70 under the buttons. German and Dutch are longer again, and the system
 * text size can be doubled by somebody who needs it.
 *
 * So the whole screen scrolls, buttons included, rather than a middle section
 * of it: an action pinned outside the scrolling area is an action a longer
 * label can still push off a short telephone, which is the defect itself.
 * `flexGrow: 1` on the content keeps the page full where it does fit.
 */
export function BackupOffer({
  onAccept,
  onRefuse,
  failed,
  working,
}: {
  readonly onAccept: () => void
  /**
   * Whether an acceptance is running (#284). The button waits, inert, under a
   * label that says so: a tap that shows nothing invites another, and two
   * acceptances make two keys.
   */
  readonly working: boolean
  /**
   * Recorded before the answer, and the caller owes that ordering: an offer
   * interrupted — the application killed, the screen turned — is an offer
   * that was made. See `offerBackup.ts`.
   */
  readonly onRefuse: () => void
  /**
   * Whether the acceptance started here did not go through (#284).
   *
   * The screen stays and says so. It used to close, and somebody who had just
   * asked for their keys to be kept was left believing they were. Since #314
   * the offer never comes back after an answer, so this is the one moment it
   * can be said.
   */
  readonly failed: boolean
}) {
  return (
    <ScrollView
      testID="backup-offer"
      style={styles.screen}
      contentContainerStyle={styles.content}>
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
          label={
            working ? t('backup_accept_working') : t('backup_offer_accept')
          }
          onPress={onAccept}
          disabled={working}
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
        {/* UNDER THE BUTTONS, AND NOT FOR THE LOOK OF IT (#284). Above them,
            the card would move the button just pressed from under the finger.
            Here it moves nothing anybody can touch, and the sentence below
            still says where to try again later.
            What this comment used to add -- « and on a short telephone push
            the refusal off the bottom: an overlay with no way out » -- was
            true of a screen that did not scroll, and was the reasoning #324
            found had been protecting the defect rather than the layout: the
            card was placed so as not to make an overflow worse, on a screen
            that already overflowed without it. */}
        {failed && (
          <View
            style={[styles.card, styles.weigh]}
            testID="backup-offer-failed">
            <Text style={styles.body}>{t('backup_accept_failed')}</Text>
          </View>
        )}
        {/* The one sentence that makes the refusal honest. Without it, "Pas
            maintenant" reads as a postponement the product will chase, and
            it will not: ADR-0013 records the refusal for good and leaves a
            line in Réglages. */}
        <Text style={styles.later}>{t('backup_offer_later')}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // The ground and the height are the scroll view's; the padding and the
  // rhythm belong to what scrolls inside it. Splitting them is what a
  // ScrollView wants, and putting the padding on the outer view instead would
  // pad the viewport rather than the page.
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
  },
  content: {
    // So a page shorter than the telephone still fills it, ground and all.
    flexGrow: 1,
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
