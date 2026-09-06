import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'

/**
 * The legal information screen the published terms already promise.
 *
 * **This is not new work invented here.** The conditions published at
 * messagr.eu say, in their own words, that *« les trois points exigés par
 * l'article 14 sont portés par l'écran "Informations légales", atteignable
 * depuis les Réglages »*. That page is live. Either this screen exists or the
 * page is false — and these texts have already had to correct one false claim
 * about retention, which is the whole reason `scripts/assert-retention.sh`
 * exists.
 *
 * # The three points, and why they are in this order
 *
 * Article 14 of regulation (EU) 2022/2065 asks for the restrictions on use,
 * the means of moderation actually employed, and how a report is handled. They
 * are in that order because it is the order a person reads them in: what is
 * forbidden, what happens when somebody breaks it, and what to do about it.
 *
 * # What this screen says that a marketing page would not
 *
 * That reporting from inside the application **does not exist yet**. The
 * published page says the same, and says why it says it: an earlier version
 * announced a report *"accessible depuis l'application, sur chaque message
 * reçu"*, and confronted with the code, nothing of the sort existed. The two
 * texts say the same thing now, and `scripts/assert-legal-screen.sh` is what
 * keeps them saying it.
 */

/**
 * Each section is a heading and its paragraphs, so the correspondence with
 * the published page is a list a reader can check rather than prose a reader
 * has to compare.
 */
const SECTIONS: readonly {
  readonly heading: CopyKey
  readonly paragraphs: readonly CopyKey[]
}[] = [
  {
    heading: 'legal_forbidden_title',
    paragraphs: ['legal_forbidden_body', 'legal_forbidden_entry'],
  },
  {
    heading: 'legal_moderation_title',
    paragraphs: [
      'legal_moderation_human',
      'legal_moderation_no_tools',
      'legal_moderation_reported',
      'legal_moderation_can',
      'legal_moderation_cannot',
    ],
  },
  {
    heading: 'legal_report_title',
    paragraphs: [
      'legal_report_how',
      'legal_report_delay',
      'legal_report_review',
      'legal_report_scope',
    ],
  },
]

export function Legal({ onBack }: { readonly onBack: () => void }) {
  return (
    <View style={styles.screen} testID="legal">
      <Pressable
        testID="legal-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('legal_title')}</Text>
      <Text style={styles.intro}>{t('legal_intro')}</Text>

      {SECTIONS.map(section => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{t(section.heading)}</Text>
          {section.paragraphs.map(paragraph => (
            <Text key={paragraph} style={styles.paragraph}>
              {t(paragraph)}
            </Text>
          ))}
        </View>
      ))}

      {/* Not a link. Opening a browser from a legal screen is a gesture that
          leaves the application, and this one has nowhere to come back to
          yet; the address is readable and that is enough for a page a person
          consults once. */}
      <Text testID="legal-terms" selectable style={styles.terms}>
        {t('legal_full_terms')}
      </Text>
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
    ...type.bodySm,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  intro: {
    ...type.bodySm,
    color: color.neutral['600'],
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
  terms: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
