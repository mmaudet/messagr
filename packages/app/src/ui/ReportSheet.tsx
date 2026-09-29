import React, { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t, type CopyKey } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'
import type { ReportedMessage } from '../runtime/reportFormat'
import { REPORT_REASONS, type ReportReason } from '../runtime/reportFormat'
import { NotchedButton } from './NotchedButton'
import { dayOf, timeOf } from './whenLabel'

/**
 * Reporting messages to the operator (#468, ADR 0015): the reason, what
 * leaves, who sends it, who can open it, and « Envoyer ».
 *
 * # WHAT APPLE'S « OPTIONAL DISCLOSURE » ASKS OF IT, AND WHERE EACH IS
 *
 * The report is a gesture somebody makes rarely, of their own accord, and
 * the sheet has to hold three things for it to stay one (#462): the account
 * that sends it, named (`report_account`); what leaves, said and shown, the
 * messages exactly as they read them with their author and their time, and
 * nothing else of the conversation; and a sending that is wanted every time,
 * which is why no reason is chosen in advance and « Envoyer » sends nothing
 * until one is.
 *
 * # « ENVOYER » IS NEVER GREYED
 *
 * Without a reason it says what is missing rather than looking dead, as the
 * first launch's own action does: a greyed button gives no reason.
 *
 * # TWO OUTCOMES
 *
 * Sent, with the report number and how to learn the decision; or not sent,
 * saying that nothing left, with the form still there to send again. The
 * reported messages stay in the conversation either way: reporting removes
 * nothing.
 */

/** Where a report stands, as the sheet shows it. */
export type ReportStage =
  | { readonly stage: 'choosing' }
  | { readonly stage: 'sending' }
  | { readonly stage: 'failed' }
  | { readonly stage: 'sent'; readonly number: string }

/** Each reason of the terms, in the words of the catalogue. */
const REASON_LABELS: Readonly<Record<ReportReason, CopyKey>> = {
  child_sexual_abuse: 'report_reason_child_sexual_abuse',
  threat: 'report_reason_threat',
  harassment: 'report_reason_harassment',
  impersonation: 'report_reason_impersonation',
  hate: 'report_reason_hate',
  sexual_without_consent: 'report_reason_sexual_without_consent',
  solicitation: 'report_reason_solicitation',
  other_illegal: 'report_reason_other_illegal',
}

export function ReportSheet({
  author,
  reporter,
  messages,
  stage,
  onSend,
  onClose,
}: {
  /** The account every message is from, which the report names. */
  readonly author: string
  /** The account this device holds, which sends the report. */
  readonly reporter: string
  /**
   * What leaves: the selected messages, in the order the conversation reads
   * them (`reportedMessages`, the reading the report itself is made from).
   */
  readonly messages: readonly ReportedMessage[]
  readonly stage: ReportStage
  readonly onSend: (reason: ReportReason) => void
  /** Closes the sheet. Never called while the report is being sent. */
  readonly onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [missing, setMissing] = useState(false)
  const insets = useSafeAreaInsets()
  const sending = stage.stage === 'sending'
  // WHILE IT IS BEING SENT, IT STAYS. Leaving then would leave the person
  // without the number, or without knowing that nothing left.
  const close = () => {
    if (!sending) onClose()
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
      testID="report-sheet">
      <View style={styles.over}>
        <Pressable
          testID="report-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t(
            stage.stage === 'sent' ? 'report_close' : 'report_cancel',
          )}
          onPress={close}
        />
        <View
          style={[styles.sheet, { paddingBottom: space.m + insets.bottom }]}>
          {stage.stage === 'sent' ? (
            <View style={styles.section} testID="report-sent">
              <Text style={styles.title}>{t('report_sent_title')}</Text>
              {/* SELECTABLE, because it is copied into an email. */}
              <Text selectable style={styles.number} testID="report-number">
                {t('report_sent_number %@', stage.number)}
              </Text>
              <Text style={styles.body}>{t('report_sent_decision')}</Text>
              <NotchedButton
                wide
                tone="quiet"
                label={t('report_close')}
                testID="report-close"
                onPress={onClose}
              />
            </View>
          ) : (
            <ScrollView
              testID="report-form"
              contentContainerStyle={styles.form}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>{t('report_title')}</Text>

              <View style={styles.section}>
                <Text style={styles.heading}>{t('report_reason_heading')}</Text>
                {REPORT_REASONS.map(code => {
                  const chosen = code === reason
                  return (
                    <Pressable
                      key={code}
                      testID={`report-reason-${code}`}
                      onPress={() => {
                        setReason(code)
                        setMissing(false)
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: chosen }}
                      accessibilityLabel={t(REASON_LABELS[code])}
                      style={({ pressed }) => [
                        styles.reason,
                        (chosen || pressed) && styles.reasonChosen,
                      ]}>
                      <Text style={styles.reasonLabel}>
                        {t(REASON_LABELS[code])}
                      </Text>
                      {/* The tick repeats the ground, which alone would be
                          a state carried by colour. */}
                      {chosen && <Text style={styles.tick}>{'✓'}</Text>}
                    </Pressable>
                  )
                })}
              </View>

              <View style={styles.section}>
                <Text style={styles.heading}>{t('report_what_heading')}</Text>
                <Text style={styles.body}>{t('report_what')}</Text>
                <View style={styles.leaving} testID="report-messages">
                  <Text style={styles.identifier}>
                    {t('report_author %@', author)}
                  </Text>
                  {messages.map(message => (
                    <View
                      key={message.eventId}
                      style={styles.message}
                      testID={`report-message-${message.eventId}`}>
                      <Text style={styles.when}>
                        {t(
                          'report_when %1$@ %2$@',
                          dayOf(message.sentAt),
                          timeOf(message.sentAt),
                        )}
                      </Text>
                      <Text style={styles.text}>{message.text}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.body} testID="report-account">
                  {t('report_account %@', reporter)}
                </Text>
                <Text style={styles.body}>{t('report_operator_only')}</Text>
              </View>

              {missing && (
                <Text style={styles.waiting} testID="report-reason-required">
                  {t('report_reason_required')}
                </Text>
              )}
              {stage.stage === 'failed' && (
                <Text style={styles.waiting} testID="report-failed">
                  {t('report_failed')}
                </Text>
              )}

              <View style={styles.actions}>
                <NotchedButton
                  wide
                  label={t(sending ? 'report_sending' : 'report_send')}
                  testID="report-send"
                  onPress={() => {
                    if (sending) return
                    if (reason === null) {
                      setMissing(true)
                      return
                    }
                    onSend(reason)
                  }}
                />
                {!sending && (
                  <NotchedButton
                    wide
                    tone="quiet"
                    label={t('report_cancel')}
                    testID="report-cancel"
                    onPress={onClose}
                  />
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  over: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, as `RemoveSheet.tsx`: the palette carries no
    // translucent value.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  // Bounded, so that a long selection scrolls inside the sheet rather than
  // pushing its actions off the screen.
  sheet: {
    maxHeight: '92%',
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    paddingTop: space.m,
    paddingHorizontal: space.m,
  },
  form: { gap: space.l },
  section: { gap: space.s },
  title: { ...type.titleMd, color: color.neutral['900'] },
  heading: { ...type.caption, color: color.neutral['600'] },
  body: { ...type.body, color: color.neutral['900'] },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: floors.touchTargetMin,
    paddingVertical: space.xs,
    paddingHorizontal: space.s,
    borderRadius: radius.bubble,
  },
  reasonChosen: { backgroundColor: color.neutral['200'] },
  reasonLabel: { ...type.body, color: color.neutral['900'], flex: 1 },
  tick: { ...type.body, color: color.neutral['900'] },
  // The conversation's own ground and bubbles: what leaves is drawn as it
  // was read.
  leaving: {
    backgroundColor: color.surface.sunk,
    borderRadius: radius.bubble,
    padding: space.s,
    gap: space.s,
  },
  identifier: { ...type.monoId, color: color.neutral['600'] },
  message: {
    backgroundColor: color.surface.raised,
    borderRadius: radius.bubble,
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    gap: space.xs,
  },
  when: { ...type.caption, color: color.neutral['600'] },
  text: { ...type.body, color: color.neutral['900'] },
  number: { ...type.titleMono, color: color.neutral['900'] },
  // `wait.700`, the palette's text for what waits on a human gesture or on
  // the network: a reason to choose, or a report to send again.
  waiting: { ...type.bodySm, color: color.wait['700'] },
  actions: { gap: space.s },
})
