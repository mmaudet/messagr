import React, { useState } from 'react'
import {
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t, type CopyKey } from '../copy'
import type { Language } from '../copy/languages'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import { BrandMark } from './BrandMark'
import { LanguageStrip } from './LanguageStrip'
import { NotchedButton } from './NotchedButton'

/**
 * The promise, shown before anything is asked.
 *
 * The prototype's §1, and the only brand screen of the whole journey. Its own
 * note says what this screen must not do, and it is the harder half of the
 * specification: "aucune création de compte, aucun formulaire, aucune
 * permission demandée ici — l'application ne réclame rien avant d'avoir montré
 * ce qu'elle promet."
 *
 * So nothing here reads a store, asks a permission, or touches the network.
 * The component takes callbacks and no data at all, which is not minimalism:
 * it is the property, expressed in a signature. A screen that cannot fetch
 * cannot leak, and a reviewer can see that in three lines rather than by
 * reading the body.
 *
 * # Two things happen here before anything else can
 *
 * **The language.** Somebody who does not read French met a French screen and
 * had no way out of it. Now the strip is under the thumb and the screen
 * retranslates as it moves — `LanguageStrip` says why the gesture is the
 * design rather than a dropdown.
 *
 * **The terms.** The action does nothing until the box is ticked, and a gate
 * that can be walked past is not a gate. The conditions themselves are one tap
 * away, at the address the published page and `assert-legal-screen.sh` already
 * agree on — the acceptance is of a text somebody can read, not of a sentence
 * about a text.
 *
 * THE DARK GROUND IS THE MARK'S, NOT A THEME. `ink900` is the token for "fond
 * des frontières de sécurité", and the prototype puts this screen among the
 * dark ones for that reason rather than as a style. It does not follow the
 * system's colour scheme: the brand screen is the brand screen on a phone set
 * to light.
 */

/** The four claims, in the prototype's order. Each is falsifiable; none is a slogan. */
const POINTS: readonly CopyKey[] = [
  'promise_point_encrypted',
  'promise_point_no_harvest',
  'promise_point_agents',
  'promise_point_invitation',
]

/** Where the conditions are published. The one `assert-legal-screen.sh` reads. */
const TERMS = 'https://messagr.eu/conditions-generales/'

export function FirstLaunch({
  onBegin,
  language,
  onLanguage,
  onLanguageSettled,
  onGeometry,
}: {
  readonly onBegin: () => void
  readonly language: Language
  readonly onLanguage: (language: Language) => void
  /** Called when the strip stops. Only this one persists. */
  readonly onLanguageSettled: (language: Language) => void
  /**
   * The shape this screen's action actually laid out at.
   *
   * The notch is the identity's, and the product has to be able to check it
   * on a device rather than only in a unit test -- `NotchedButton` says so.
   * It used to be checked on a button rendered into the diagnostic readout
   * for no other purpose, which measured the right arithmetic on the wrong
   * button. This is a real one, on the first screen of the journey, so what
   * is measured is what somebody presses.
   */
  readonly onGeometry?: (geometry: { height: number; leg: number }) => void
}) {
  const [accepted, setAccepted] = useState(false)
  const [nagged, setNagged] = useState(false)

  return (
    <SafeAreaView style={styles.ground} testID="first-launch">
      {/* The ground is `ink900` on this screen whatever the phone is set to,
          so the clock and the battery beside it have to be light. */}
      <StatusBar barStyle="light-content" />
      {/* Scrolls, because the four points and the thesis do not fit a small
          phone at the largest system text size, and a promise with its
          action below the fold is a promise nobody can accept. */}
      <ScrollView
        testID="promise-scroll"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.mark}>
          <BrandMark size={72} testID="brand-mark" />
          <Text style={styles.wordmark}>Messagr</Text>
        </View>

        <View style={styles.saying}>
          <Text style={styles.thesis} testID="promise-thesis">
            {t('promise_thesis')}
          </Text>
          <Text style={styles.subtitle}>{t('promise_subtitle')}</Text>
          <View style={styles.points}>
            {POINTS.map(point => (
              <View key={point} style={styles.point}>
                <Text style={styles.bullet}>◆</Text>
                <Text style={styles.pointLabel}>{t(point)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.gate}>
          <Text style={styles.gateHeading}>{t('promise_language')}</Text>
          {/* UNE LANGUE À LA FOIS, COMME DANS RÉGLAGES.
              Quatre lignes ici demandaient à quelqu'un qui n'a encore rien
              lu de choisir dans une liste, sous un écran déjà long : sur un
              iPhone, la case des conditions passait sous le pli. Une seule
              ligne rend l'écran plus court que ce qu'il présente, et c'est
              le même contrôle qu'aux Réglages -- deux formes différentes
              pour un même geste seraient deux contrôles. */}
          <LanguageStrip
            onDark
            rows={1}
            chosen={language}
            onChoose={onLanguage}
            onSettle={onLanguageSettled}
          />

          {/* THE BOX, AND WHY IT IS A BOX AND NOT A SENTENCE UNDER A BUTTON.
              "By continuing you accept…" is an acceptance nobody made. A tick
              is a thing a person did, and it is the only shape of this that
              can be shown to have happened. */}
          <Pressable
            testID="promise-terms"
            onPress={() => {
              setAccepted(held => !held)
              setNagged(false)
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel={t('promise_terms')}
            style={styles.terms}>
            <View style={[styles.box, accepted && styles.boxTicked]}>
              {accepted && <Text style={styles.tick}>✓</Text>}
            </View>
            <Text style={styles.termsLabel}>{t('promise_terms')}</Text>
          </Pressable>

          <Pressable
            testID="promise-terms-link"
            onPress={() => {
              // Failure is ordinary: no browser, or somebody dismissed it.
              // There is nothing to report and nothing to retry.
              Linking.openURL(TERMS).catch(() => {})
            }}
            accessibilityRole="link"
            style={styles.linkRow}>
            <Text style={styles.link}>{t('promise_terms_link')}</Text>
          </Pressable>

          {nagged && (
            <Text testID="promise-terms-required" style={styles.required}>
              {t('promise_terms_required')}
            </Text>
          )}

          <NotchedButton
            wide
            label={t('promise_action')}
            testID="promise-action"
            onGeometry={onGeometry}
            // NOT DISABLED, AND SAYING WHY WHEN PRESSED.
            //
            // A greyed button is a control that gives no reason, and somebody
            // who missed the box has no way to learn what is wrong with the
            // screen. This one is pressable, does nothing, and says what is
            // missing -- which is the same rule §13.19.6 puts on errors.
            onPress={() => (accepted ? onBegin() : setNagged(true))}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: space.xxl,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.xxl,
  },
  mark: {
    alignItems: 'center',
    gap: space.l,
  },
  wordmark: {
    // The brand screen's own roles, added to `tokens.json` in 3.2.0 rather
    // than approximated with the nearest general one. The prototype draws
    // this screen off the eight-role scale, and snapping it to them made the
    // wordmark 30 where the mockup says 36 and the thesis 22 where it says
    // 26 -- visible, and wrong. Putting the sizes in the token file is the
    // only answer that keeps invariant 11 and the mockup both true.
    ...type.brandWordmark,
    color: color.surface.paper,
  },
  saying: {
    gap: space.xl,
  },
  thesis: {
    ...type.brandThesis,
    color: color.surface.paper,
  },
  subtitle: {
    ...type.body,
    // The palette's own light-on-dark secondary. Not an opacity on paper:
    // ADR-aside, the token list is normative and an alpha would be a colour
    // outside it.
    color: color.agent['400'],
  },
  points: {
    gap: space.m,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.m,
  },
  gate: {
    gap: space.l,
  },
  gateHeading: {
    ...type.caption,
    color: color.agent['400'],
  },
  terms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: floors.touchTargetMin,
  },
  box: {
    width: space.l,
    height: space.l,
    borderRadius: radius.bubbleAuthorCorner,
    borderWidth: stroke.base,
    borderColor: color.agent['400'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxTicked: {
    // THE DARK PALETTE, ON A SCREEN THAT IS ALWAYS DARK.
    //
    // `color.brand.green500` is the light-ground green, and the token file
    // says outright why it will not do here: the dark palette's own green500
    // is *« remonté en clarté pour tenir sur fond sombre »*. Using the light
    // one on `ink900` is a contrast decision made by accident.
    backgroundColor: color.dark.brand.green500,
    borderColor: color.dark.brand.green500,
  },
  tick: {
    ...type.monoLabel,
    color: color.brand.ink900,
  },
  termsLabel: {
    ...type.bodySm,
    color: color.surface.paper,
    flexShrink: 1,
  },
  linkRow: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  link: {
    ...type.bodySm,
    // The "text, border, link" role, in the dark palette where it is
    // *lighter* than green500 rather than darker. That inversion is the
    // token's own note, and it is exactly what a link on `ink900` needs.
    color: color.dark.brand.green700,
    textDecorationLine: 'underline',
  },
  required: {
    ...type.caption,
    color: color.wait['500'],
  },
  bullet: {
    ...type.caption,
    color: color.dark.brand.green500,
  },
  pointLabel: {
    ...type.brandPoint,
    color: color.surface.paper,
    flexShrink: 1,
  },
})
