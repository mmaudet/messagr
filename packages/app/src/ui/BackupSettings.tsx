import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
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
 * # THE CURRENT KEY IS NOT HERE, AND THAT IS THE POINT
 *
 * No screen in this product can show it again, including this one. Saying so
 * here is what stops somebody hunting for it in Réglages and concluding the
 * product lost it — the key was theirs from the moment it was shown, and the
 * only thing this screen can offer is a different one.
 */
export function BackupSettings({
  enabled,
  total,
  backedUp,
  onBack,
  onEnable,
  onReplace,
}: {
  readonly enabled: boolean
  /** How many message keys this device holds. */
  readonly total: number
  /** How many of them the homeserver has a copy of. */
  readonly backedUp: number
  readonly onBack: () => void
  /** Offered only when the backup is off: accepting after a refusal. */
  readonly onEnable: () => void
  /** Offered only when it is on: a new key, and the old one retired. */
  readonly onReplace: () => void
}) {
  const behind = enabled && backedUp < total

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

      <View
        style={[styles.card, enabled ? styles.on : styles.off]}
        testID="backup-settings-state">
        <Text style={styles.body}>
          {enabled ? t('backup_settings_on') : t('backup_settings_off')}
        </Text>
      </View>

      {/* Only while they differ. Two numbers that agree say nothing the
          sentence above has not already said, and a progress line that never
          goes away is a progress line nobody reads. */}
      {behind && (
        <View style={styles.section} testID="backup-settings-progress">
          <Text style={styles.count}>
            {t('backup_settings_progress %1$d %2$d', backedUp, total)}
          </Text>
          <Text style={styles.note}>{t('backup_settings_catching_up')}</Text>
        </View>
      )}

      {enabled ? (
        <View style={styles.section}>
          {/* BEFORE THE CONTROL. Somebody who reads this after tapping has
              been told what it costs when it has already cost it. */}
          <Text style={styles.note} testID="backup-settings-never-shown">
            {t('backup_settings_never_shown')}
          </Text>
          <Text style={styles.note}>{t('backup_settings_replace_why')}</Text>
          <NotchedButton
            testID="backup-settings-replace"
            label={t('backup_settings_replace')}
            onPress={onReplace}
            tone="quiet"
            wide
          />
        </View>
      ) : (
        <View style={styles.section}>
          {/* The way back in after a refusal, which ADR-0013 requires to
              exist precisely because the refusal is honoured for good: a
              product that will not ask again owes a door somebody can find. */}
          <NotchedButton
            testID="backup-settings-enable"
            label={t('backup_settings_enable')}
            onPress={onEnable}
            wide
          />
        </View>
      )}
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
  body: {
    ...type.body,
    color: color.neutral['900'],
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
