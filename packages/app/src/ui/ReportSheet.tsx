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
import { color, floors, layout, radius, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import {
  REPORT_REASONS,
  type ReportedMessage,
  type ReportReason,
} from '../runtime/reportFormat'
import type { ReadFile, ReadImage } from '../timeline/imageEvent'
import { Document } from './Document'
import { NotchedButton } from './NotchedButton'
import { Photograph } from './Photograph'
import type { ReportStage } from './reportStage'
import { dayOf, timeOf } from './whenLabel'

/**
 * Reporting messages to the operator (#468, ADR 0015): the reason, what
 * leaves, who sends it, who can open it, and « Envoyer ».
 *
 * # WHAT APPLE'S « OPTIONAL DISCLOSURE » ASKS OF IT, AND WHERE EACH IS
 *
 * The report is a gesture somebody makes rarely, of their own accord, and
 * the sheet has to hold three things for it to stay one (#462): the account
 * that sends it, named (`report_account`); what leaves, said and shown: the
 * messages exactly as they read them with their author and their time, the
 * identifiers of the conversation and of each message, the moment of the
 * report, and nothing else of the conversation; and a sending that is wanted
 * every time, which is why no reason is chosen in advance and « Envoyer »
 * sends nothing until one is.
 *
 * # A PHOTOGRAPH OR A DOCUMENT, SHOWN AS READ, AND SAID AS IT LEAVES (#471)
 *
 * A photograph is drawn as the conversation draws it, from the copy the
 * conversation already holds, and a document as its row: what the person
 * chose, as they read it. What leaves of either is not the file but the
 * description of its encrypted copy, already on the server, which lets the
 * operator open it: the sheet says so in words (`report_what_files`),
 * whenever the report carries one.
 *
 * # THE AUTHOR IS THE ACCOUNT THE SERVER ATTRIBUTES THE MESSAGES TO
 *
 * Decrypting a message does not establish who wrote it (ADR 0001, « What
 * the seam does not give »): the sender is what the event says, as the
 * homeserver relays it, which the timeline calls `claimedSender`. That is
 * the account the report names, because it is the one a takedown and a
 * suspension act on: the homeserver acts on its own attribution. So the
 * sheet says the messages are attributed to it by the server, and names it
 * the way the conversation does, a given name or the account's own form,
 * without the server's suffix (`product-spec.md` §7.1), rather than as a
 * proof of authorship.
 *
 * # « ENVOYER » IS NEVER GREYED
 *
 * Without a reason it says what is missing rather than looking dead, as the
 * first launch's own action does: a greyed button gives no reason.
 *
 * # WHAT BECOMES OF IT
 *
 * Sent, with the report number and how to learn the decision. Too long, and
 * fewer messages are to be chosen. Refused, when the service answered that
 * it will not take it, which it says before keeping anything: the sheet says
 * so, in the colour of a refusal, and how to report without the application
 * (#491). No longer reportable, when a message chosen was deleted or left
 * the conversation while the sheet was open: the sheet says so as soon as it
 * happens, and nothing leaves (#491). Not sent, when nothing left the
 * telephone, and unavailable, when the service kept nothing for now: both
 * are to be sent again. Or unconfirmed: nothing came back, which cannot tell
 * a report never sent from one whose answer was lost, so the sheet says so,
 * and that sending again sends it once (`reportMessages.ts`). Where sending
 * again cannot help, « Envoyer » is absent. The sheet closes at any
 * time, the sending one included: the report goes on without it, and sent
 * again it is kept once. The reported messages stay in the conversation
 * whatever happens: reporting removes nothing.
 *
 * Its shape is `RemoveSheet.tsx`'s, the ground, the scrim and the sheet: the
 * product has no bottom sheet of its own to borrow.
 */

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
  picture,
  fetch,
  stage,
  onSend,
  onClose,
}: {
  /**
   * The account the messages are attributed to, as the conversation names
   * it: a given name, or the account's own form without its server.
   */
  readonly author: string
  /** The account this device holds, which sends the report, named alike. */
  readonly reporter: string
  /**
   * What leaves: the selected messages, in the order the conversation reads
   * them (`reportable`, the reading the report itself is made from). `null`
   * once they can no longer be reported, a message deleted meanwhile for
   * one.
   */
  readonly messages: readonly ReportedMessage[] | null
  /**
   * The photograph a chosen message is, as the conversation holds it: the
   * same object from one drawing to the next, so that `Photograph` fetches
   * it once, and from the copy the conversation already fetched.
   */
  readonly picture: (eventId: string) => ReadImage | undefined
  /** How the conversation fetches a photograph, stable across renders. */
  readonly fetch: (file: ReadFile) => Promise<ShownImage>
  readonly stage: ReportStage
  readonly onSend: (reason: ReportReason) => void
  readonly onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [missing, setMissing] = useState(false)
  const insets = useSafeAreaInsets()
  const sending = stage.stage === 'sending'
  // NO LONGER REPORTABLE (#491), whether the sending found it or the sheet
  // sees it first. Not while a report is on its way: it was assembled from
  // what was on screen when « Envoyer » was pressed, and its answer decides.
  const unreportable =
    stage.stage === 'unreportable' || (messages === null && !sending)
  // « ANNULER » UNTIL SOMETHING HAS HAPPENED: once it has, closing cancels
  // nothing, and the word must not say it does.
  const closing =
    stage.stage === 'choosing' && !unreportable
      ? 'report_cancel'
      : 'report_close'

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="report-sheet">
      <View style={styles.over}>
        <Pressable
          testID="report-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t(closing)}
          onPress={onClose}
        />
        <View
          style={[styles.sheet, { paddingBottom: space.m + insets.bottom }]}>
          {stage.stage !== 'sent' && unreportable ? (
            // Nothing is left to choose a reason for, and nothing leaves.
            <View style={styles.section} testID="report-unreportable">
              <Text style={styles.title}>{t('report_title')}</Text>
              <Text style={styles.waiting}>{t('report_unreportable')}</Text>
              <NotchedButton
                wide
                tone="quiet"
                label={t(closing)}
                testID="report-cancel"
                onPress={onClose}
              />
            </View>
          ) : stage.stage === 'sent' ? (
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
                {(messages ?? []).some(message => !('text' in message)) && (
                  <Text style={styles.body} testID="report-what-files">
                    {t('report_what_files')}
                  </Text>
                )}
                <View style={styles.leaving} testID="report-messages">
                  <Text style={styles.attributed} testID="report-author">
                    {t('report_author %@', author)}
                  </Text>
                  {(messages ?? []).map(message => (
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
                      {'text' in message ? (
                        <Text style={styles.text}>{message.text}</Text>
                      ) : 'document' in message ? (
                        // A document read here always has a name:
                        // `readFileEvent` refuses one without.
                        <Document
                          name={message.document.name ?? ''}
                          size={message.document.size}
                          testID={`report-document-${message.eventId}`}
                        />
                      ) : (
                        <ReportedPhotograph
                          image={picture(message.eventId)}
                          fetch={fetch}
                          testID={`report-photograph-${message.eventId}`}
                        />
                      )}
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
              {stage.stage === 'unconfirmed' && (
                <Text style={styles.waiting} testID="report-unconfirmed">
                  {t('report_unconfirmed')}
                </Text>
              )}
              {stage.stage === 'not-sent' && (
                <Text style={styles.waiting} testID="report-not-sent">
                  {t('report_not_sent')}
                </Text>
              )}
              {stage.stage === 'unavailable' && (
                <Text style={styles.waiting} testID="report-unavailable">
                  {t('report_unavailable')}
                </Text>
              )}
              {stage.stage === 'too-long' && (
                <Text style={styles.waiting} testID="report-too-long">
                  {t('report_too_long')}
                </Text>
              )}
              {stage.stage === 'refused' && (
                <Text style={styles.refusal} testID="report-refused">
                  {t('report_refused')}
                </Text>
              )}

              <View style={styles.actions}>
                {/* TOO LONG OR REFUSED, SENDING AGAIN CANNOT HELP: absent,
                    like every action here that cannot do what it says. */}
                {stage.stage !== 'too-long' && stage.stage !== 'refused' && (
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
                )}
                {/* « FERMER » ONCE SOMETHING HAS HAPPENED (`closing`). */}
                <NotchedButton
                  wide
                  tone="quiet"
                  label={t(closing)}
                  testID="report-cancel"
                  onPress={onClose}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

/**
 * A photograph a report carries, drawn as the conversation draws it. The
 * conversation always holds it, since `reportable` read the report from it;
 * were it gone, nothing is drawn rather than a picture that is not the one
 * leaving.
 */
function ReportedPhotograph({
  image,
  fetch,
  testID,
}: {
  readonly image: ReadImage | undefined
  readonly fetch: (file: ReadFile) => Promise<ShownImage>
  readonly testID: string
}) {
  return image === undefined ? null : (
    <Photograph image={image} fetch={fetch} testID={testID} />
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
    maxHeight: layout.sheetMaxHeight,
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
  attributed: { ...type.caption, color: color.neutral['600'] },
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
  // the network: a reason to choose, a report to send again, fewer messages
  // to choose.
  waiting: { ...type.bodySm, color: color.wait['700'] },
  // `deny.700`, the palette's text for a measure or a refusal, which is what
  // a refusal of the service is: final, nothing to wait for (`Invite.tsx`
  // says its own failure the same way).
  refusal: { ...type.bodySm, color: color.deny['700'] },
  actions: { gap: space.s },
})
