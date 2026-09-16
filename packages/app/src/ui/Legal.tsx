import React from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

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
 * # The fourth thing on this screen, and it is not article 14's
 *
 * Deleting an account. It is here rather than as a row of its own in Settings
 * because this is the screen Settings already opens for everything the
 * published pages promise, and because what Play requires is a *path* to the
 * web resource rather than a screen of its own: Settings, this screen, the
 * link, and the browser opens on the section. See `DELETE_ACCOUNT` below and
 * #333.
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

/**
 * Where an account is deleted, and the anchor is part of the address.
 *
 * #333: Play requires an application that creates an account to offer *« an
 * in-app path to delete their app accounts »*, and accepts a link towards the
 * web resource as that path. Messagr creates an account when an invitation is
 * opened, and carried neither the path nor the resource.
 *
 * The fragment is load-bearing. `deploy/messagr-eu/site/aide/index.html`
 * carries `id="supprimer-votre-compte"` and says, in a comment beside it, what
 * renaming it would cost: the page still answers 200, the reader still lands
 * on it, and nothing anywhere reports that they landed above what they came
 * for.
 */
const DELETE_ACCOUNT = 'https://messagr.eu/aide/#supprimer-votre-compte'

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

      {/* #333, AND IT IS A LINK WHERE THE LINE UNDER IT IS NOT.
          A readable address is enough for a document somebody consults once.
          It is not enough here: what Play asks for is a PATH -- something a
          person can follow from inside the application -- and an address
          somebody has to retype by hand is not one. So the two differ on
          purpose, and this is where that difference is written down.

          The screen says what the page says, which is the rule this whole
          screen lives under: `scripts/assert-legal-screen.sh` exists because a
          published text once promised a gesture the code did not carry. No
          deadline is shown here. The page carries the one the privacy policy
          commits to, and says in the same breath that the purge is done by
          hand today (#71). */}
      <View style={styles.section}>
        <Text style={styles.heading}>{t('legal_delete_title')}</Text>
        <Text style={styles.paragraph}>{t('legal_delete_body')}</Text>
        <Pressable
          testID="legal-delete-link"
          onPress={() => {
            // Failure is ordinary: no browser, or somebody dismissed it.
            // Nothing to report and nothing to retry -- the same as the first
            // screen's link to the terms.
            Linking.openURL(DELETE_ACCOUNT).catch(() => {})
          }}
          accessibilityRole="link"
          style={styles.linkRow}>
          <Text style={styles.link}>{t('legal_delete_link')}</Text>
        </Pressable>
      </View>

      {/* Not a link. Opening a browser from a legal screen is a gesture that
          leaves the application, and this one has nowhere to come back to
          yet; the address is readable and that is enough for a page a person
          consults once. The deletion link above is the exception, and the
          comment there says why it had to be one. */}
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
  // A row rather than a bare `Text`, so the tap target is the floor's height
  // whatever the label's line-height is. The same shape as the terms link on
  // the first screen.
  linkRow: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  link: {
    ...type.action,
    color: color.brand.green700,
    textDecorationLine: 'underline',
  },
  terms: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
