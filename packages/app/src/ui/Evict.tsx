import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, space, type as typeScale } from '../design/tokens'
import type { EvictOutcome } from '../runtime/evict'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Putting somebody out of a conversation.
 *
 * # Why it asks twice, and what the second screen has to say
 *
 * The same shape as vouching, and for the same reason: this cannot be undone.
 * `Consequences.tsx` is that shape, taken from the one screen the prototype
 * draws for an irreversible gesture -- #87, which was about the form rather
 * than the ordering.
 * But the sentence it owes a person is a different one, and it is the one a
 * product is tempted to leave off.
 *
 * Removing somebody bounds the *future*. Every message already delivered to
 * their device, and every key that opened it, is theirs now and stays theirs.
 * No call in this application, in the crypto library, or on the homeserver
 * can take that back. `evict_explain_past` says so where the gesture is
 * offered rather than in a help page nobody opens, which is the difference
 * between a person choosing this and a person discovering it.
 *
 * # Three outcomes, not two
 *
 * "Done" splits, because the key rotation is the part that decides whether
 * the removal meant anything, and it has two honest answers. A key of this
 * device's existed and was replaced; or there was none, because this device
 * had never encrypted here, so nothing of ours was out there to replace.
 * Both are success. Reporting them the same way would hide the one case
 * where a reader might want to know why.
 *
 * And the failure that matters is neither: removed, not rotated. A person
 * told only "cela n'a pas abouti" would reasonably assume nothing happened
 * and stop -- while the departed party goes on reading. That state gets its
 * own sentence, and it asks for a retry.
 */
export interface EvictProps {
  /** Who is being removed. Shown so the gesture names its target. */
  readonly memberId: string
  readonly onEvict: () => void
  readonly state: 'idle' | 'working' | EvictOutcome
}

export function Evict({ memberId, onEvict, state }: EvictProps) {
  const [asked, setAsked] = useState(false)
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // The fifth component, and the one the fix missed. `Vouch`, `Composer`,
  // `Conversation` and `NotchedButton` all read `useColorScheme()` and
  // switched to `color.dark`, which turned them dark inside screens that
  // stayed pale -- reported from an iPhone on 7 September 2026 as "meme pb
  // de fond". Four were changed and this one was not, so on a telephone set
  // to dark mode the removal panel was a black plate on a paper screen.
  //
  // Which ground a component sits on is its parent's business. A component
  // that reads the system theme is guessing, and it guessed wrong here.
  const palette = color

  if (state !== 'idle' && state !== 'working') {
    return (
      <Text
        testID="evict-outcome"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {state.evicted
          ? state.rotated
            ? t('evict_done')
            : t('evict_done_no_key')
          : state.stage === 'removing'
            ? t('evict_failed_nothing_changed')
            : t('evict_failed_key_still_valid')}
      </Text>
    )
  }

  if (state === 'working') {
    return (
      <Text
        testID="evict-working"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {t('evict_working')}
      </Text>
    )
  }

  if (!asked) {
    return (
      <View style={styles.block}>
        <NotchedButton
          label={t('evict_action')}
          testID="evict-open"
          onPress={() => setAsked(true)}
        />
        <Text
          testID="evict-hint"
          style={[styles.hint, { color: palette.neutral['600'] }]}>
          {t('evict_hint')}
        </Text>
      </View>
    )
  }

  return (
    <Consequences
      testID="evict-explain"
      title={t('evict_explain_title')}
      lead={t('evict_explain_lead')}
      facts={[
        {
          // RED, BECAUSE THIS ONE IS THE MEASURE. Putting somebody out of a
          // conversation is « action de mesure » in the token's own words,
          // which is the one thing `deny` is for.
          tone: 'measure',
          said: t('evict_fact_future'),
          body: t('evict_explain_future'),
          testID: 'evict-fact-future',
        },
        {
          // AND THIS ONE IS NOT A WARNING. The sentence the ticket requires,
          // and the one nobody volunteers: what they already read is theirs,
          // and nothing takes it back. It is simply true -- neither a thing
          // to weigh nor a measure -- so it is drawn as the ordinary state
          // rather than dressed as a danger.
          tone: 'plain',
          said: t('evict_fact_past'),
          body: t('evict_explain_past'),
          testID: 'evict-past',
        },
      ]}
      finally={t('evict_explain_final')}
      target={memberId}>
      <NotchedButton
        label={t('evict_confirm')}
        testID="evict-confirm"
        tone="measure"
        onPress={onEvict}
      />
      <NotchedButton
        label={t('evict_cancel')}
        testID="evict-cancel"
        tone="quiet"
        onPress={() => setAsked(false)}
      />
    </Consequences>
  )
}

const styles = StyleSheet.create({
  block: { gap: space.s, marginTop: space.m },
  hint: typeScale.caption,
  outcome: { ...typeScale.bodySm, marginTop: space.m },
})
