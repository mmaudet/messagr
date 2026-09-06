import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, layout, radius, space, stroke, type } from '../design/tokens'
import { TabIcon, type TabGlyph } from './TabIcon'

/**
 * A tab that exists before the thing it holds does.
 *
 * # Why this is not the inert row `Settings` refuses
 *
 * `Settings` says sections not built are absent rather than present and
 * greyed, and that is right there: a switch that toggles nothing lies about a
 * capability somebody might rely on.
 *
 * This is the opposite case and the mockup states its reason plainly — *«
 * L'onglet est réservé dès la V1 pour ne pas déplacer la barre plus tard. »*
 * A navigation bar that gains an item later moves every other item under
 * people's thumbs, and muscle memory is the one thing a messenger's bottom bar
 * is for. Reserving the slot costs a screen; not reserving it costs everybody
 * who had learned where "Réglages" was.
 *
 * The difference between the two is whether the empty thing pretends. A
 * greyed switch pretends to be a setting. This says what is missing, when it
 * is expected, and why the space is being held.
 */
export function Reserved({
  glyph,
  title,
  why,
  stages,
  testID,
}: {
  readonly glyph: TabGlyph
  readonly title: CopyKey
  readonly why: CopyKey
  /** What is coming and when. Empty when there is nothing dated to say. */
  readonly stages?: readonly CopyKey[]
  readonly testID: string
}) {
  return (
    <View style={styles.screen} testID={testID}>
      {/* The tab's own glyph, outlined rather than filled: the dashed ring is
          the mockup's way of saying "a place kept" without drawing something
          that looks like a control. */}
      <View style={styles.ring}>
        <TabIcon glyph={glyph} tint={color.neutral['400']} size={28} />
      </View>

      <Text style={styles.title}>{t(title)}</Text>
      <Text style={styles.why}>{t(why)}</Text>

      {stages !== undefined && stages.length > 0 && (
        <View style={styles.stages}>
          {stages.map(stage => (
            <View key={stage} style={styles.stage}>
              <Text style={styles.stageLabel}>{t(stage)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.m,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.xxl,
  },
  ring: {
    width: space.xxl * 2,
    height: space.xxl * 2,
    borderRadius: radius.pill,
    borderWidth: stroke.base,
    borderStyle: 'dashed',
    borderColor: color.neutral['300'],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.s,
  },
  title: {
    ...type.titleMd,
    color: color.neutral['900'],
    textAlign: 'center',
  },
  why: {
    ...type.bodySm,
    color: color.neutral['600'],
    textAlign: 'center',
  },
  stages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.s,
    marginTop: space.s,
  },
  stage: {
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.surface.sunk,
  },
  stageLabel: {
    ...type.monoLabel,
    color: color.neutral['600'],
  },
})
