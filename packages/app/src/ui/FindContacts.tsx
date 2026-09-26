import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { FindingStage } from '../runtime/findContacts'
import { NotchedButton } from './NotchedButton'

/**
 * « Retrouver mes contacts » (#400, #392): the reminder, then what the
 * search found.
 *
 * Every stage is `findContacts.ts`'s, and every gesture is handed back to it:
 * this file draws and decides nothing.
 *
 * # THE REMINDER HAS ONE BUTTON
 *
 * It comes right before the system's own question about the address book,
 * and Apple wants a screen in that place to lead to the question and nowhere
 * else. The way back is the arrow above it, as on every screen.
 *
 * # NOTHING HERE ACTS ON A CONTACT YET
 *
 * The contacts on Messagr come first, under the name of their card, then the
 * others. Inviting one comes with #404 and #408, one contact at a time: no
 * gesture here, now or then, takes the whole address book.
 */
export function FindContacts({
  stage,
  onContinue,
  onClose,
}: {
  readonly stage: Exclude<FindingStage, { readonly stage: 'shut' }>
  /** « Continuer », on the reminder. */
  readonly onContinue: () => void
  /** The arrow, « Terminé », and every way back to the list. */
  readonly onClose: () => void
}) {
  return (
    <View style={styles.screen} testID="find-contacts">
      <Pressable
        testID="find-contacts-back"
        onPress={onClose}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('tab_discussions')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t('plus_find_contacts')}</Text>
      {stage.stage === 'reminder' && (
        <View style={styles.body} testID="find-contacts-reminder">
          <Text style={styles.text}>{t('find_reminder')}</Text>
          <View style={styles.actions}>
            <NotchedButton
              testID="find-contacts-continue"
              label={t('findable_continue')}
              onPress={onContinue}
              wide
            />
          </View>
        </View>
      )}
      {stage.stage === 'looking' && (
        <Text style={styles.hint} testID="find-contacts-looking">
          {t('find_looking')}
        </Text>
      )}
      {stage.stage === 'found' && (
        <Found
          matches={stage.matches.map(m => m.contact.name)}
          others={stage.others.map(c => c.name)}
          onDone={onClose}
        />
      )}
      {stage.stage === 'refused' && (
        <View style={styles.body}>
          <View style={styles.refusal} testID="find-contacts-refused">
            <Text style={styles.refusalText}>{t(REFUSED[stage.why])}</Text>
          </View>
          <NotchedButton
            testID="find-contacts-done"
            label={t('findable_done')}
            onPress={onClose}
            wide
          />
        </View>
      )}
    </View>
  )
}

/** Why nothing is shown, in a sentence each. */
const REFUSED: Readonly<
  Record<Extract<FindingStage, { stage: 'refused' }>['why'], CopyKey>
> = {
  'no-access': 'find_no_access',
  'not-findable': 'find_not_findable',
  'proof-rejected': 'find_proof_rejected',
  off: 'find_off',
  unreachable: 'find_unreachable',
}

function Found({
  matches,
  others,
  onDone,
}: {
  readonly matches: readonly string[]
  readonly others: readonly string[]
  readonly onDone: () => void
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      testID="find-contacts-found">
      <Text style={styles.heading}>{t('find_on_messagr')}</Text>
      {matches.length === 0 ? (
        <Text style={styles.hint} testID="find-contacts-nobody">
          {t('find_nobody')}
        </Text>
      ) : (
        matches.map((name, i) => (
          <Text key={`m${i}`} style={styles.row} testID="find-contacts-match">
            {name}
          </Text>
        ))
      )}
      {others.length > 0 && (
        <>
          <Text style={styles.heading}>{t('find_others')}</Text>
          {others.map((name, i) => (
            <Text
              key={`o${i}`}
              style={styles.other}
              testID="find-contacts-other">
              {name}
            </Text>
          ))}
        </>
      )}
      <View style={styles.actions}>
        <NotchedButton
          testID="find-contacts-done"
          label={t('findable_done')}
          onPress={onDone}
          wide
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
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
    marginBottom: space.m,
  },
  body: { gap: space.m },
  text: { ...type.body, color: color.neutral['900'] },
  hint: { ...type.bodySm, color: color.neutral['600'] },
  heading: { ...type.titleMd, color: color.neutral['900'] },
  row: { ...type.body, color: color.neutral['900'] },
  other: { ...type.body, color: color.neutral['600'] },
  actions: { gap: space.s, marginTop: space.m },
  refusal: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  refusalText: { ...type.bodySm, color: color.neutral['900'] },
})
