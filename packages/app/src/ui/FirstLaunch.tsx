import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t, type CopyKey } from '../copy'
import { color, layout, space, type } from '../design/tokens'
import { BrandMark } from './BrandMark'
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
 * The component takes one callback and no data at all, which is not
 * minimalism: it is the property, expressed in a signature. A screen that
 * cannot fetch cannot leak, and a reviewer can see that in three lines rather
 * than by reading the body.
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

export function FirstLaunch({ onBegin }: { readonly onBegin: () => void }) {
  return (
    <SafeAreaView style={styles.ground} testID="first-launch">
      {/* Scrolls, because the four points and the thesis do not fit a small
          phone at the largest system text size, and a promise with its
          action below the fold is a promise nobody can accept. */}
      <ScrollView
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

        <NotchedButton
          label={t('promise_action')}
          testID="promise-action"
          onPress={onBegin}
        />
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
    ...type.display,
    color: color.surface.paper,
  },
  saying: {
    gap: space.xl,
  },
  thesis: {
    ...type.titleLg,
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
  bullet: {
    ...type.caption,
    color: color.brand.green500,
  },
  pointLabel: {
    ...type.bodySm,
    color: color.surface.paper,
    flexShrink: 1,
  },
})
