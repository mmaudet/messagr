import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import { displayNameFor } from '../runtime/givenName'
import { headlineOf, type TrustReading } from '../runtime/trustReading'

/**
 * What is known about the person on the other side, and what is not.
 *
 * Screen 25 of the prototype, and it is emphatic about two things.
 *
 * **A screen, not a badge.** A badge has to rank three facts that do not rank:
 * what that person's account asserts, what this side confirmed, and what a
 * human judged. Any of them can be true without the others, and a single
 * pastille would have to pick one and hide the rest.
 *
 * **No alarm.** The starting state is normal and is drawn as such. The
 * prototype's own words: *« non vérifié n'est pas une alerte, c'est un état de
 * départ normal. Le chiffrement est déjà là ; ce qui manque, c'est la
 * certitude sur la personne. »* So the first paragraph of this screen says the
 * encryption is not in question, before anything else is said at all.
 *
 * # The colour is the information
 *
 * §13.19 invariant 3 reserves the brand green for a confirmed human, and the
 * prototype spends it exactly once: on the strongest state and nowhere else. A
 * vouch takes the `wait` ochre — something a person did, waiting on something
 * stronger — and the ordinary starting state stays neutral. Nothing here is
 * red, because nothing here is wrong.
 *
 * # What it does not offer
 *
 * A button. Comparing a short string and scanning a code are Phase 2 of
 * `product-spec.md` §11 and are not in this lot, so the screen says what the
 * gesture would be and that it is not built. An action that did nothing would
 * be worse than the sentence it replaced.
 */
export function Trust({
  participant,
  given,
  reading,
  cardName,
  onBack,
}: {
  readonly participant: string | null
  readonly given: string | undefined
  readonly reading: TrustReading
  /**
   * The name of the card this account came from, when it joined through an
   * invitation from a number this device found in its address book (#407):
   * what the product calls « recognized », matched through the address book
   * and never verified. `recognizedStore.ts`.
   */
  readonly cardName?: string
  readonly onBack: () => void
}) {
  const headline = headlineOf(reading)
  // THE ADDRESS BOOK SAID IN THE HEADLINE when nothing stronger is known,
  // and under its own title otherwise (#407): said once either way.
  const bookInHeadline = headline === 'nothing-yet' && cardName !== undefined
  const tone =
    headline === 'confirmed'
      ? styles.confirmed
      : headline === 'vouched'
        ? styles.vouched
        : styles.nothing

  return (
    <View style={styles.screen} testID="trust">
      <Pressable
        testID="trust-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{'←'}</Text>
      </Pressable>

      <Text style={styles.title}>{t('trust_title')}</Text>
      <Text style={styles.who}>{displayNameFor(participant, given)}</Text>

      {/* Before anything else. What a person fears on this screen is that
          their messages were not protected, and that is not what is in
          question. */}
      <Text style={styles.calm}>{t('trust_calm')}</Text>

      <View style={[styles.card, tone]} testID="trust-headline">
        <Text style={styles.headline}>
          {headline === 'confirmed'
            ? t('trust_state_confirmed')
            : headline === 'vouched'
              ? t('trust_state_vouched')
              : bookInHeadline
                ? t('trust_state_book %@', cardName)
                : t('trust_state_nothing')}
        </Text>
      </View>

      {/* WHAT THE ADDRESS BOOK ESTABLISHES, AND WHAT IT DOES NOT (#407):
          that a code sent by SMS showed this account had the number, not
          long ago. Only when it is so; the words are neither of the two the
          catalogue's guards refuse. */}
      {cardName !== undefined && (
        <View style={styles.section} testID="trust-in-book">
          <Text style={styles.heading}>{t('trust_book_title')}</Text>
          {!bookInHeadline && (
            <Text style={styles.paragraph}>
              {t('trust_state_book %@', cardName)}
            </Text>
          )}
          <Text style={styles.paragraph}>{t('trust_book_means')}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.heading}>{t('trust_devices_title')}</Text>
        <Text style={styles.paragraph}>
          {t('trust_devices %d', reading.devices)}
        </Text>
        {reading.claimedByThem > 0 && (
          <Text style={styles.paragraph}>
            {t('trust_claimed %d', reading.claimedByThem)}
          </Text>
        )}
        <Text style={styles.paragraph}>
          {reading.confirmedHere > 0
            ? t('trust_confirmed %d', reading.confirmedHere)
            : t('trust_none_confirmed')}
        </Text>
      </View>

      {/* Shown whether or not it happened. Somebody who was not vouched for
          still needs to know what the gesture would have established, because
          it is the one they are most likely to be told about by the person
          who let them in. */}
      <View style={styles.section}>
        <Text style={styles.heading}>{t('trust_vouch_title')}</Text>
        <Text style={styles.paragraph}>{t('trust_vouch_means')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>{t('trust_raise_title')}</Text>
        <Text style={styles.paragraph}>{t('trust_raise_how')}</Text>
        <Text testID="trust-not-built" style={styles.missing}>
          {t('trust_raise_missing')}
        </Text>
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
    gap: space.l,
  },
  back: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  backLabel: {
    ...type.titleMd,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  who: {
    ...type.titleMd,
    color: color.neutral['600'],
  },
  calm: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  card: {
    padding: space.l,
    borderLeftWidth: stroke.accent,
  },
  // Green once, on the strongest state and nowhere else: invariant 3.
  confirmed: {
    backgroundColor: color.brand.green100,
    borderLeftColor: color.brand.green500,
  },
  // A person's judgement, waiting on something stronger.
  vouched: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  // The ordinary starting state. Neutral, because nothing is wrong.
  nothing: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  headline: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  section: {
    gap: space.s,
  },
  heading: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  paragraph: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  missing: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
