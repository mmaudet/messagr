import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import {
  codeIsSpent,
  numberRefusal,
  isDueForRenewal,
  whereTheNumberGoes,
  type FinishRefusal,
  type OpenCountry,
  type ProofStage,
  type StartRefusal,
  type WithdrawRefusal,
} from '../runtime/discovery'
import { NotchedButton } from './NotchedButton'
import { dayOf, timeOf } from './whenLabel'

/**
 * « Être trouvable », from Settings (#397, #392): the consent, the number,
 * the code, and the proof with its date.
 *
 * Every stage is `discovery.ts`'s, and every gesture is handed back to it:
 * this file draws and decides nothing. In particular it never sends a number
 * whose country is not open -- its button stays inert, and the journey refuses
 * it again -- and « Pas maintenant » is the same gesture as the way back.
 *
 * # THE CONSENT HAS TWO BUTTONS OF THE SAME WEIGHT
 *
 * #392 asks for it in so many words: « Continuer » and « Pas maintenant »,
 * the same tone, the same width. A consent whose refusal is a quiet link under
 * a green button is a consent designed to be given.
 *
 * # THE CODE FIELD SAYS WHAT IT IS, AND NOTHING READS THE SMS
 *
 * `one-time-code` is the hint both platforms read: iOS offers the code above
 * the keyboard, and only inside Messagr, because the SMS ends with
 * `@messagr.eu #123456` and messagr.eu is this application's associated
 * domain; Android's autofill offers it too. No permission on the SMS is asked
 * for, and the code can always be typed.
 */
export function Findable({
  stage,
  onContinue,
  onClose,
  onSend,
  onProve,
  onAnother,
  onRenew,
  onWithdraw,
  now = Date.now(),
}: {
  readonly stage: Exclude<ProofStage, { readonly stage: 'shut' }>
  /** « Continuer », on the consent. */
  readonly onContinue: () => void
  /** « Pas maintenant », « Terminé », and every way back to Settings. */
  readonly onClose: () => void
  readonly onSend: (typed: string) => void
  readonly onProve: (code: string) => void
  readonly onAnother: () => void
  /** « Renouveler la preuve » (#398). */
  readonly onRenew: () => void
  /** « Retirer mon numéro » (#398). */
  readonly onWithdraw: () => void
  /** The clock, injectable, as `ConversationList`'s is. */
  readonly now?: number
}) {
  return (
    <View style={styles.screen} testID="findable">
      <Pressable
        testID="findable-back"
        onPress={onClose}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>
      {stage.stage === 'consent' && (
        <Consent onContinue={onContinue} onNotNow={onClose} />
      )}
      {(stage.stage === 'number' || stage.stage === 'sending') && (
        <TheNumber
          countries={stage.countries}
          number={stage.number}
          refused={stage.stage === 'number' ? stage.refused : null}
          sending={stage.stage === 'sending'}
          onSend={onSend}
        />
      )}
      {(stage.stage === 'code' || stage.stage === 'proving') && (
        <TheCode
          number={stage.number}
          refused={stage.stage === 'code' ? stage.refused : null}
          proving={stage.stage === 'proving'}
          onProve={onProve}
          onAnother={onAnother}
        />
      )}
      {(stage.stage === 'proven' || stage.stage === 'withdrawing') && (
        <Proven
          findableUntil={stage.findableUntil}
          number={stage.number}
          refused={stage.stage === 'proven' ? stage.refused : null}
          withdrawing={stage.stage === 'withdrawing'}
          now={now}
          onRenew={onRenew}
          onWithdraw={onWithdraw}
          onDone={onClose}
        />
      )}
      {stage.stage === 'withdrawn' && <Withdrawn onDone={onClose} />}
    </View>
  )
}

/** The five points of #392, each a lead and what it says. */
const POINTS: readonly (readonly [CopyKey, CopyKey])[] = [
  ['findable_contacts_title', 'findable_contacts'],
  ['findable_number_point_title', 'findable_number_point'],
  ['findable_others_title', 'findable_others'],
  ['findable_change_title', 'findable_change'],
  ['findable_withdraw_title', 'findable_withdraw'],
]

function Consent({
  onContinue,
  onNotNow,
}: {
  readonly onContinue: () => void
  readonly onNotNow: () => void
}) {
  return (
    <View style={styles.body} testID="findable-consent">
      <Text style={styles.title}>{t('findable_title')}</Text>
      {POINTS.map(([lead, said]) => (
        <View key={lead} style={styles.point} testID={`findable-${lead}`}>
          <Text style={styles.pointLead}>{t(lead)}</Text>
          <Text style={styles.text}>{t(said)}</Text>
        </View>
      ))}
      <View style={styles.actions}>
        <NotchedButton
          testID="findable-continue"
          label={t('findable_continue')}
          onPress={onContinue}
          wide
        />
        <NotchedButton
          testID="findable-not-now"
          label={t('findable_not_now')}
          onPress={onNotNow}
          wide
        />
      </View>
    </View>
  )
}

/** The sentence of a refusal, with the day and hour to ask again when there is one. */
function startRefused(refused: StartRefusal): string {
  switch (refused.why) {
    case 'too-many':
      return t(
        'findable_too_many %1$@ %2$@',
        dayOf(refused.retryAt),
        timeOf(refused.retryAt),
      )
    case 'closed':
      return t('findable_number_closed')
    case 'no-country-code':
      return t('findable_number_country_code')
    case 'not-a-number':
      return t('findable_number_not_a_number')
    case 'off':
      return t('findable_off')
    case 'not-sent':
      return t('findable_not_sent')
    case 'later':
      return t('findable_later')
    case 'unreachable':
      return t('findable_unreachable')
  }
}

function TheNumber({
  countries,
  number,
  refused,
  sending,
  onSend,
}: {
  readonly countries: readonly OpenCountry[]
  readonly number: string
  readonly refused: StartRefusal | null
  readonly sending: boolean
  readonly onSend: (typed: string) => void
}) {
  const [draft, setDraft] = useState(number)
  const where = whereTheNumberGoes(draft, countries)
  const ready = where.verdict === 'open' && where.complete && !sending
  // WHAT THE SCREEN SAYS BEFORE ANYTHING IS SENT: who would send the SMS, or
  // why nothing will be. A refusal from the service, once asked, says more
  // than the verdict and takes its place until the number changes.
  const refusal =
    refused !== null && draft === number ? refused : numberRefusal(where)
  const said: string | null = refusal === null ? null : startRefused(refusal)
  const send = () => {
    if (ready) onSend(draft)
  }

  return (
    <View style={styles.body} testID="findable-number">
      <Text style={styles.title}>{t('findable_number_title')}</Text>
      <Text style={styles.text}>{t('findable_number_lead')}</Text>
      <TextInput
        testID="findable-number-field"
        value={draft}
        onChangeText={setDraft}
        editable={!sending}
        placeholder={t('findable_number_placeholder')}
        placeholderTextColor={color.neutral['400']}
        style={styles.field}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoCorrect={false}
        onSubmitEditing={send}
        returnKeyType="send"
      />
      {where.verdict === 'open' && said === null && (
        <Text style={styles.hint} testID="findable-number-provider">
          {t('findable_number_provider %@', where.country.provider)}
        </Text>
      )}
      {said !== null && (
        <View style={styles.refusal} testID="findable-number-refused">
          <Text style={styles.refusalText}>{said}</Text>
        </View>
      )}
      <NotchedButton
        testID="findable-send"
        label={sending ? t('findable_sending') : t('findable_send')}
        onPress={send}
        disabled={!ready}
        wide
      />
    </View>
  )
}

function codeRefused(refused: FinishRefusal): string {
  switch (refused.why) {
    case 'wrong':
      return refused.attemptsLeft > 0
        ? t('findable_code_wrong %d', refused.attemptsLeft)
        : t('findable_code_spent')
    case 'no-proof':
      return t('findable_code_spent')
    case 'expired':
      return t('findable_code_expired')
    case 'off':
      return t('findable_off')
    case 'unreachable':
      return t('findable_unreachable')
  }
}

function TheCode({
  number,
  refused,
  proving,
  onProve,
  onAnother,
}: {
  readonly number: string
  readonly refused: FinishRefusal | null
  readonly proving: boolean
  readonly onProve: (code: string) => void
  readonly onAnother: () => void
}) {
  const [draft, setDraft] = useState('')
  const ready =
    /^\d{6}$/.test(draft.trim()) && !proving && !codeIsSpent(refused)
  const prove = () => {
    if (ready) onProve(draft)
  }

  return (
    <View style={styles.body} testID="findable-code">
      <Text style={styles.title}>{t('findable_code_title')}</Text>
      <Text style={styles.text}>{t('findable_code_lead %@', number)}</Text>
      {/* FOCUSED AT ONCE, because iOS offers the code in the bar above the
          keyboard and only while it is up. */}
      <TextInput
        testID="findable-code-field"
        value={draft}
        onChangeText={setDraft}
        editable={!proving}
        style={styles.field}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        onSubmitEditing={prove}
        returnKeyType="done"
      />
      {refused !== null && (
        <View style={styles.refusal} testID="findable-code-refused">
          <Text style={styles.refusalText}>{codeRefused(refused)}</Text>
        </View>
      )}
      <NotchedButton
        testID="findable-prove"
        label={proving ? t('findable_proving') : t('findable_prove')}
        onPress={prove}
        disabled={!ready}
        wide
      />
      <NotchedButton
        testID="findable-another"
        label={t('findable_another')}
        tone="quiet"
        onPress={onAnother}
        disabled={proving}
        wide
      />
    </View>
  )
}

/**
 * The proof, its number and its date, and what can be done with it (#398).
 *
 * THE ACTION OF THE MOMENT LEADS. From its 21st day a proof is to renew, and
 * « Renouveler la preuve » takes the principal place; before that, the
 * person has just proved it or come to look, and « Terminé » does.
 * « Retirer mon numéro » keeps the quiet tone: it ends nothing that cannot be
 * proved again, and a warning colour would say otherwise.
 */
function Proven({
  findableUntil,
  number,
  refused,
  withdrawing,
  now,
  onRenew,
  onWithdraw,
  onDone,
}: {
  readonly findableUntil: number
  readonly number: string | null
  readonly refused: WithdrawRefusal | null
  readonly withdrawing: boolean
  readonly now: number
  readonly onRenew: () => void
  readonly onWithdraw: () => void
  readonly onDone: () => void
}) {
  const renewing = isDueForRenewal(findableUntil, now)
  const renew = (
    <NotchedButton
      key="renew"
      testID="findable-renew"
      label={t('findable_renew')}
      tone={renewing ? undefined : 'quiet'}
      onPress={onRenew}
      wide
    />
  )
  const done = (
    <NotchedButton
      key="done"
      testID="findable-done"
      label={t('findable_done')}
      tone={renewing ? 'quiet' : undefined}
      onPress={onDone}
      wide
    />
  )
  return (
    <View style={styles.body} testID="findable-proven">
      <Text style={styles.title}>{t('findable_proven_title')}</Text>
      {number !== null && (
        <Text style={styles.number} testID="findable-proven-number">
          {number}
        </Text>
      )}
      <Text style={styles.text} testID="findable-proven-until">
        {renewing
          ? t('findable_proven_renew %@', dayOf(findableUntil))
          : t('findable_proven_until %@', dayOf(findableUntil))}
      </Text>
      {refused !== null && (
        <View style={styles.refusal} testID="findable-withdraw-refused">
          <Text style={styles.refusalText}>{t('findable_unreachable')}</Text>
        </View>
      )}
      {withdrawing ? (
        <Text style={styles.hint} testID="findable-withdrawing">
          {t('findable_withdrawing')}
        </Text>
      ) : (
        <View style={styles.actions}>
          {renewing ? [renew, done] : [done, renew]}
          <NotchedButton
            testID="findable-withdraw"
            label={t('findable_withdraw_number')}
            tone="quiet"
            onPress={onWithdraw}
            wide
          />
        </View>
      )}
    </View>
  )
}

function Withdrawn({ onDone }: { readonly onDone: () => void }) {
  return (
    <View style={styles.body} testID="findable-withdrawn">
      <Text style={styles.title}>{t('findable_withdrawn_title')}</Text>
      <Text style={styles.text}>{t('findable_withdrawn')}</Text>
      <NotchedButton
        testID="findable-done"
        label={t('findable_done')}
        onPress={onDone}
        wide
      />
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
  body: { gap: space.m },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  text: { ...type.body, color: color.neutral['900'] },
  number: { ...type.titleMd, color: color.neutral['900'] },
  point: { gap: space.xs },
  pointLead: { ...type.titleMd, color: color.neutral['900'] },
  actions: { gap: space.s, marginTop: space.m },
  hint: { ...type.bodySm, color: color.neutral['600'] },
  field: {
    ...type.body,
    color: color.neutral['900'],
    backgroundColor: color.surface.raised,
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
    borderRadius: radius.bubble,
    padding: space.m,
    minHeight: floors.touchTargetMin,
  },
  refusal: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  refusalText: { ...type.bodySm, color: color.neutral['900'] },
})
