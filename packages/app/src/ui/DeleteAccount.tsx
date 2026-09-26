import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'
import { Consequences } from './Consequences'
import { DELETION_ADDRESS } from './deletionMail'
import { NotchedButton } from './NotchedButton'

/**
 * Where deleting the account stands (#382), one stage at a time, so that no
 * two of them can be true together: shut; the screen of facts, with whether
 * the last attempt failed; the same screen with the e-mail way, for a device
 * that kept no password (#384); the request under way; and the account gone,
 * after which nothing else is drawn.
 */
export type DeletionStage =
  | { readonly stage: 'shut' }
  | { readonly stage: 'asking'; readonly failed: boolean }
  | { readonly stage: 'by-email' }
  | { readonly stage: 'working' }
  | { readonly stage: 'deleted' }

/** The stages in which the screen of facts is drawn. */
export type ShownDeletion = Extract<
  DeletionStage,
  { readonly stage: 'asking' | 'by-email' | 'working' }
>

/** Whether the screen of facts is drawn in this stage. */
export function isDeletionShown(stage: DeletionStage): stage is ShownDeletion {
  return (
    stage.stage === 'asking' ||
    stage.stage === 'by-email' ||
    stage.stage === 'working'
  )
}

/**
 * Whether the person can leave the screen, by the back gesture or another
 * tab. Not while the server is being asked: its answer would come back to a
 * screen that has gone, and the person would not learn it.
 */
export function isDeletionLeavable(stage: DeletionStage): boolean {
  return stage.stage === 'asking' || stage.stage === 'by-email'
}

/**
 * Deleting the account this device holds, from the last row of Settings.
 * #382.
 *
 * The shape of every gesture nothing takes back (`Consequences.tsx`), as
 * leaving an account already has it: what goes, what stays, then the word.
 * No word to type: a typed confirmation guards against a pipe, and Apple
 * asks for a gesture somebody can make.
 *
 * THE DEFAULT TONE, NOT THE MEASURE. Red is `deny`, a measure taken against
 * somebody in the token's own words, and deleting one's own account is not
 * that; `LeaveAccount.tsx` settled the same question the same way.
 *
 * BY E-MAIL, NO « OUI », AND ONE FACT THAT CHANGES (#384). A device that kept
 * no password cannot delete: the server asks for it. The screen says so
 * before anybody decides, and its one action writes to the address, with
 * what finds the account already in the mail (`deletionMail.ts`). What to
 * write by hand stays on the screen, for a telephone with no mail
 * application. And this device forgets nothing that way: only the gesture
 * here writes the mark the next launch reads, so the fact about what goes
 * says what stays on the device instead.
 */
export function DeleteAccount({
  stage,
  onDelete,
  onWrite,
  onKeep,
}: {
  readonly stage: ShownDeletion
  readonly onDelete: () => void
  /** Opens a mail to the address, for the e-mail way. */
  readonly onWrite: () => void
  readonly onKeep: () => void
}) {
  const byEmail = stage.stage === 'by-email'
  const keep = (
    <NotchedButton
      testID="delete-account-keep"
      label={t('delete_cancel')}
      tone="quiet"
      onPress={onKeep}
      wide
    />
  )
  return (
    <View style={styles.screen} testID="delete-account">
      <Pressable
        testID="delete-account-back"
        onPress={onKeep}
        disabled={stage.stage === 'working'}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>

      <Consequences
        testID="delete-account-consequences"
        title={t('delete_title')}
        lead={t('delete_lead')}
        facts={[
          {
            tone: 'weigh',
            said: t('delete_fact_gone'),
            body: byEmail ? t('delete_email_gone_body') : t('delete_gone_body'),
            testID: 'delete-account-gone',
          },
          {
            tone: 'plain',
            said: t('delete_fact_stays'),
            body: t('delete_stays_body'),
            testID: 'delete-account-stays',
          },
        ]}
        finally={byEmail ? t('delete_email_final') : t('delete_final')}>
        {stage.stage === 'by-email' ? (
          <>
            <Text testID="delete-account-why-email" style={styles.why}>
              {t('delete_email_why %@', DELETION_ADDRESS)}
            </Text>
            <NotchedButton
              testID="delete-account-write"
              label={t('delete_email_write %@', DELETION_ADDRESS)}
              onPress={onWrite}
              wide
            />
            <Text testID="delete-account-by-hand" style={styles.byHand}>
              {t('delete_email_by_hand %@', DELETION_ADDRESS)}
            </Text>
            {keep}
          </>
        ) : (
          <>
            {/* Not « as it was »: its pusher and its key backup may already
                be gone (#383). */}
            {stage.stage === 'asking' && stage.failed ? (
              <Text testID="delete-account-failed" style={styles.failed}>
                {t('delete_failed')}
              </Text>
            ) : null}
            {stage.stage === 'working' ? (
              <Text testID="delete-account-working" style={styles.working}>
                {t('delete_working')}
              </Text>
            ) : (
              <>
                <NotchedButton
                  testID="delete-account-confirm"
                  label={t('delete_confirm')}
                  onPress={onDelete}
                  wide
                />
                {keep}
              </>
            )}
          </>
        )}
      </Consequences>
    </View>
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
  working: { ...type.bodySm, color: color.neutral['600'] },
  failed: { ...type.bodySm, color: color.neutral['900'] },
  why: { ...type.bodySm, color: color.neutral['900'] },
  byHand: { ...type.bodySm, color: color.neutral['600'] },
})
