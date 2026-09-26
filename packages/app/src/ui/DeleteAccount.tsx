import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Where deleting the account stands (#382), one stage at a time, so that no
 * two of them can be true together: shut; the screen of facts, with whether
 * the last attempt failed; the request under way; and the account gone, after
 * which nothing else is drawn.
 */
export type DeletionStage =
  | { readonly stage: 'shut' }
  | { readonly stage: 'asking'; readonly failed: boolean }
  | { readonly stage: 'working' }
  | { readonly stage: 'deleted' }

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
 */
export function DeleteAccount({
  working,
  failed,
  onDelete,
  onKeep,
}: {
  /** While the server is being asked: the buttons give way to a line. */
  readonly working: boolean
  /**
   * Whether the last attempt failed. Not « as it was »: its pusher and its
   * key backup may already be gone (#383).
   */
  readonly failed: boolean
  readonly onDelete: () => void
  readonly onKeep: () => void
}) {
  return (
    <View style={styles.screen} testID="delete-account">
      <Pressable
        testID="delete-account-back"
        onPress={onKeep}
        disabled={working}
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
            body: t('delete_gone_body'),
            testID: 'delete-account-gone',
          },
          {
            tone: 'plain',
            said: t('delete_fact_stays'),
            body: t('delete_stays_body'),
            testID: 'delete-account-stays',
          },
        ]}
        finally={t('delete_final')}>
        {failed ? (
          <Text testID="delete-account-failed" style={styles.failed}>
            {t('delete_failed')}
          </Text>
        ) : null}
        {working ? (
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
            <NotchedButton
              testID="delete-account-keep"
              label={t('delete_cancel')}
              tone="quiet"
              onPress={onKeep}
              wide
            />
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
})
