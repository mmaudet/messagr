import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, layout, space, type } from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * Where a device that lost access to its account stands (#391), one stage at
 * a time: nothing lost; the choice, with what the last attempt to come back
 * said; the attempt under way; and the two endings that ask the person to
 * close the application -- coming back as a new device, or forgetting.
 *
 * A deactivated account is not a stage here: it ends on the screen of a
 * deleted account (`AccountDeleted.tsx`), which says the same thing.
 */
export type LostAccessStage =
  | { readonly stage: 'none' }
  | {
      readonly stage: 'asking'
      /** Whether « Revenir sur ce compte » is offered: a password was kept. */
      readonly comeBack: boolean
      /** What the last attempt to come back ran into, if one was made. */
      readonly said: 'refused' | 'unreachable' | null
    }
  | { readonly stage: 'working' }
  | { readonly stage: 'back' }
  | { readonly stage: 'forgotten' }

/**
 * The whole screen, once its homeserver no longer lets this telephone in.
 * #391.
 *
 * ONE SENTENCE FOR THREE CAUSES. Deleted by e-mail, revoked, or this
 * telephone taken off the account: a refused token looks the same for all
 * three, so the title says the one thing true of each, and the body names
 * the causes without choosing. `lostAccess.ts` says why coming back is only
 * ever offered.
 *
 * NOT « RECONNAÎT ». Recognition is a word of trust in this product
 * (`CONTEXT.md`), and a server refusing a token is not a judgement about
 * anybody.
 */
export function LostAccess({
  stage,
  onComeBack,
  onForget,
}: {
  readonly stage: Exclude<LostAccessStage, { readonly stage: 'none' }>
  readonly onComeBack: () => void
  readonly onForget: () => void
}) {
  if (stage.stage === 'back' || stage.stage === 'forgotten') {
    return (
      <SafeAreaView style={styles.ground} testID="lost-access-closing">
        <View style={styles.content}>
          <Text style={styles.title}>
            {stage.stage === 'back'
              ? t('lost_back_title')
              : t('lost_forgotten_title')}
          </Text>
          <Text style={styles.body}>
            {stage.stage === 'back' ? t('lost_back_body') : t('deleted_body')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={styles.ground} testID="lost-access">
      <View style={styles.content}>
        <Text style={styles.title}>{t('lost_title')}</Text>
        <Text style={styles.body}>{t('lost_body')}</Text>
        {stage.stage === 'asking' && stage.said !== null ? (
          <Text testID="lost-access-said" style={styles.said}>
            {stage.said === 'refused'
              ? t('lost_refused')
              : t('lost_unreachable')}
          </Text>
        ) : null}
        {stage.stage === 'working' ? (
          <Text testID="lost-access-working" style={styles.said}>
            {t('lost_working')}
          </Text>
        ) : (
          <View style={styles.actions}>
            {stage.comeBack && stage.said !== 'refused' ? (
              <NotchedButton
                testID="lost-access-come-back"
                label={t('lost_come_back')}
                onPress={onComeBack}
                wide
              />
            ) : null}
            <NotchedButton
              testID="lost-access-forget"
              label={t('lost_forget')}
              tone={
                stage.comeBack && stage.said !== 'refused' ? 'quiet' : undefined
              }
              onPress={onForget}
              wide
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: color.surface.paper },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    gap: space.m,
  },
  title: { ...type.titleLg, color: color.neutral['900'] },
  body: { ...type.body, color: color.neutral['600'] },
  said: { ...type.bodySm, color: color.neutral['900'] },
  actions: { gap: space.s, marginTop: space.m },
})
