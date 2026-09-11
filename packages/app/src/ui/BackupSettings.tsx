import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Whether the backup is on, and the two things somebody can do about it.
 *
 * # ONE LINE IN RÉGLAGES, AND NOTHING ELSE
 *
 * ADR-0013, after the soft prompt: *« une ligne dans Réglages et rien
 * d'autre »*. No recurring banner, no reminder — *« un produit qui harcèle
 * sur la sécurité apprend surtout à ignorer ses propres avertissements »*.
 * This screen is where the state is legible at any time, beside «&nbsp;Messages
 * favoris&nbsp;» and «&nbsp;Informations légales&nbsp;», and it is the only
 * place the subject appears once the offer has been answered.
 *
 * # THE COUNT IS SHOWN WITH ITS EXPLANATION OR NOT AT ALL
 *
 * `backedUp` below `total` is the ordinary state of a device that has just
 * accepted, and of one that has just replaced its key — the bridge counts
 * against the *enabled* version, so replacing reads zero out of everything
 * while nothing whatever has been lost. A screen that printed «&nbsp;0 sur
 * 1&nbsp;240&nbsp;» and stopped would frighten somebody about a number that
 * means the opposite of what it looks like.
 *
 * So the sentence that says the rest is on its way is not optional
 * decoration: it is shown whenever the two numbers differ, and the numbers
 * are not shown at all when they agree, because «&nbsp;1 240 sur
 * 1 240&nbsp;» is a fact nobody needs and «&nbsp;vos messages sont
 * sauvegardés&nbsp;» is the same fact in words.
 *
 * # REPLACING, AND WHY THE SCREEN SAYS WHAT IT COSTS BEFORE OFFERING IT
 *
 * Replacing is the answer to *« elle est montrée une fois et jamais plus »*:
 * whoever wrote their key down badly finds out at the worst possible moment,
 * and the only honest remedy is a new one. It makes a new backup version and
 * retires the old key — so the old key stops opening anything, which is
 * exactly what should happen to a key on a piece of paper nobody can find,
 * and exactly the wrong surprise for somebody who still had theirs.
 *
 * The sentence therefore comes before the control, not after it.
 *
 * # THREE READINGS, BECAUSE A SCREEN THAT DRAWS NOTHING IS A BLANK PAGE
 *
 * This took `enabled`, `total` and `backedUp` and was rendered only once its
 * caller had them. The caller hides the Réglages list to show this, so a
 * reading that never arrived left **a blank white page with no way back** --
 * found by a tester on iOS, where the reading fails.
 *
 * It now takes the reading itself and draws all three. `waiting` asserts
 * nothing, which was the true half of the old reasoning. `unreadable` says
 * so and offers to ask again, because a reading that failed once is usually
 * a reading that succeeds twice, and leaving and re-entering the screen to
 * discover that is a thing nobody should have to guess.
 *
 * Neither claims the backup is on or off. That distinction -- between not
 * knowing and knowing the answer is no -- is the whole reason this is three
 * states and not a boolean with a spinner.
 *
 * # THE CURRENT KEY IS NOT HERE, AND THAT IS THE POINT
 *
 * No screen in this product can show it again, including this one. Saying so
 * here is what stops somebody hunting for it in Réglages and concluding the
 * product lost it — the key was theirs from the moment it was shown, and the
 * only thing this screen can offer is a different one.
 */
/** What this device could learn about its backup, including nothing. */
export type BackupReading =
  /** Asked, and the bridge has not answered yet. */
  | { readonly reading: 'waiting' }
  /** Asked, and it could not be answered. Says nothing about the backup. */
  | { readonly reading: 'unreadable' }
  | {
      readonly reading: 'read'
      readonly enabled: boolean
      /** How many message keys this device holds. */
      readonly total: number
      /** How many of them the homeserver has a copy of. */
      readonly backedUp: number
    }

export function BackupSettings({
  reading,
  onBack,
  onRetry,
  onEnable,
  onReplace,
}: {
  readonly reading: BackupReading
  readonly onBack: () => void
  /** Takes the reading again. Offered only when it could not be taken. */
  readonly onRetry: () => void
  /** Offered only when the backup is off: accepting after a refusal. */
  readonly onEnable: () => void
  /**
   * Offered only when it is on: a new key, and the old one retired.
   *
   * Called only after the confirmation below, never from the row itself.
   */
  readonly onReplace: () => void
}) {
  /**
   * Whether the confirmation is standing between the row and the gesture.
   *
   * Local, because nothing outside this screen has any business knowing that
   * somebody is halfway through thinking about it -- and because leaving the
   * screen must abandon the question rather than remember it.
   */
  const [confirming, setConfirming] = useState(false)
  const enabled = reading.reading === 'read' && reading.enabled
  const behind =
    reading.reading === 'read' &&
    reading.enabled &&
    reading.backedUp < reading.total

  return (
    <View style={styles.screen} testID="backup-settings">
      <Pressable
        testID="backup-settings-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('settings_backup')}</Text>

      {reading.reading === 'waiting' && (
        <View
          style={[styles.card, styles.unknown]}
          testID="backup-settings-waiting">
          <Text style={styles.body}>{t('backup_settings_reading')}</Text>
        </View>
      )}

      {reading.reading === 'unreadable' && (
        <View style={styles.section} testID="backup-settings-unreadable">
          <View style={[styles.card, styles.unknown]}>
            <Text style={styles.body}>{t('backup_settings_unreadable')}</Text>
          </View>
          {/* WHAT IT DOES NOT MEAN, which is the sentence that matters. A
              reading that failed says nothing about the backup, and somebody
              reading « impossible de lire l'état » will otherwise conclude
              their messages stopped being kept. */}
          <Text style={styles.note}>{t('backup_settings_unreadable_why')}</Text>
          <NotchedButton
            testID="backup-settings-retry"
            label={t('backup_settings_retry')}
            onPress={onRetry}
            wide
          />
        </View>
      )}

      {reading.reading === 'read' && (
        <View
          style={[styles.card, enabled ? styles.on : styles.off]}
          testID="backup-settings-state">
          <Text style={styles.body}>
            {enabled ? t('backup_settings_on') : t('backup_settings_off')}
          </Text>
          {/* WITH THE STATE AND NOT WITH THE CONTROL, which is a correction.
              It sat in the replace section, at the same weight as the
              sentence warning what replacing costs -- a fact about the key
              that exists and an instruction about an action, indistinguishable
              from each other. It belongs to the state: it is the rest of
              « vos messages sont sauvegardés ». */}
          {enabled && (
            <Text style={styles.stateNote} testID="backup-settings-never-shown">
              {t('backup_settings_never_shown')}
            </Text>
          )}
        </View>
      )}

      {/* Only while they differ. Two numbers that agree say nothing the
          sentence above has not already said, and a progress line that never
          goes away is a progress line nobody reads. */}
      {behind && reading.reading === 'read' && (
        <View style={styles.section} testID="backup-settings-progress">
          <Text style={styles.count}>
            {t(
              'backup_settings_progress %1$d %2$d',
              reading.backedUp,
              reading.total,
            )}
          </Text>
          <Text style={styles.note}>{t('backup_settings_catching_up')}</Text>
        </View>
      )}

      {reading.reading === 'read' &&
        (enabled ? (
          confirming ? (
            /* THE GESTURE NOTHING TAKES BACK, IN THE FORM THIS PRODUCT
               ALREADY HAS FOR ONE. Unlike accepting -- which `BackupOffer`
               deliberately does NOT draw this way, because it is refusable
               and about nobody -- replacing destroys a backup and ends a key
               somebody may be holding on paper.
               No `target`: it is about nobody, and `Consequences` was
               widened for exactly this. */
            <Consequences
              testID="backup-replace-consequences"
              title={t('backup_replace_title')}
              lead={t('backup_replace_lead')}
              facts={[
                {
                  testID: 'backup-replace-old',
                  tone: 'weigh',
                  said: t('backup_replace_fact_old'),
                  body: t('backup_replace_old_body'),
                },
                {
                  testID: 'backup-replace-new',
                  tone: 'weigh',
                  said: t('backup_replace_fact_new'),
                  body: t('backup_replace_new_body'),
                },
              ]}
              finally={t('backup_replace_final')}>
              <NotchedButton
                testID="backup-replace-confirm"
                label={t('backup_replace_confirm')}
                onPress={() => {
                  // NOT CLOSED HERE. The key screen covers everything the
                  // moment it arrives, and unmounting under the finger is
                  // the defect `App.tsx` records at length: the rest of the
                  // gesture lands on whatever React drew underneath.
                  onReplace()
                }}
                wide
              />
              <NotchedButton
                testID="backup-replace-cancel"
                label={t('backup_replace_cancel')}
                onPress={() => setConfirming(false)}
                tone="quiet"
                wide
              />
            </Consequences>
          ) : (
            <View style={styles.section}>
              {/* BEFORE THE CONTROL. Somebody who reads this after tapping has
                been told what it costs when it has already cost it. */}
              <Text style={styles.note}>
                {t('backup_settings_replace_why')}
              </Text>
              <NotchedButton
                testID="backup-settings-replace"
                label={t('backup_settings_replace')}
                onPress={() => setConfirming(true)}
                tone="quiet"
                wide
              />
            </View>
          )
        ) : (
          <View style={styles.section}>
            {/* The way back in after a refusal, which ADR-0013 requires to
                exist precisely because the refusal is honoured for good: a
                product that will not ask again owes a door somebody can
                find. */}
            <NotchedButton
              testID="backup-settings-enable"
              label={t('backup_settings_enable')}
              onPress={onEnable}
              wide
            />
          </View>
        ))}
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
  card: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
  },
  // Green once, on the state that is working: invariant 3 spends it on the
  // strongest state and nowhere else on a screen.
  on: {
    backgroundColor: color.brand.green100,
    borderLeftColor: color.brand.green500,
  },
  // Ochre, not red. Nothing is wrong with a device that has no backup — it
  // is the state every device starts in, and a warning colour here would be
  // the product frightening somebody into a decision.
  off: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  // Neither green nor ochre: this is the colour of not knowing, and the two
  // states it must not be mistaken for are the ones that do know.
  unknown: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  body: {
    ...type.body,
    color: color.neutral['900'],
  },
  // Inside the state card, under the sentence it belongs to. Lighter than
  // the sentence above it and on the same ground, so it reads as the rest of
  // that fact rather than as a second one.
  stateNote: {
    ...type.caption,
    color: color.neutral['600'],
    marginTop: space.s,
  },
  section: {
    gap: space.s,
  },
  count: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  note: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
