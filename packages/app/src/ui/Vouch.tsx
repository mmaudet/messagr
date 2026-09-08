import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import {
  color,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import type { VouchOutcome } from '../runtime/vouch'
import { NotchedButton } from './NotchedButton'

/**
 * The inviter's gesture: saying they answer for the person they invited.
 *
 * # Why it asks twice
 *
 * What this does cannot be undone. The keys it hands over are keys the other
 * device keeps -- no revocation, no expiry, no narrowing afterwards -- and it
 * hands them to one named person rather than to a room. A single tap that did
 * that would be a single tap somebody could make by mistake, once, forever.
 *
 * So the first press does nothing but explain, in the plainest words the
 * product has, and the second press is the one that acts. That is the same
 * shape the crypto library gives its own surface, and for the same reason:
 * `buildHistoryBundle` has no side effect and reports what the gesture would
 * give away, precisely so a screen can put it in front of a person before
 * anything leaves the device.
 *
 * # Why no number appears
 *
 * The library reports how many Megolm sessions a bundle carries, and the
 * temptation is to show it. It is not a count of messages and does not
 * correspond to anything a person could check -- two sessions may be a
 * thousand messages or none. Showing it would be precision about a quantity
 * nobody can interpret, which reads as information and is not.
 *
 * The one thing the count genuinely settles is whether there is a past at
 * all, and that changes what is true enough to change the sentence. So the
 * screen branches on empty and says nothing numeric.
 *
 * # The word that is not here
 *
 * "Vérifier" appears nowhere, and `copy.spec.ts` fails the build if it ever
 * does. Verification is a real act in this product -- comparing a short
 * string, scanning a code -- and vouching is a human judgement that proves
 * nothing cryptographically. Borrowing the word would tell somebody they had
 * done the one when they had done the other.
 */
export interface VouchProps {
  /** Who is being vouched for. Shown so the gesture names its target. */
  readonly entrantId: string
  /**
   * Whether this conversation has a past to hand over.
   *
   * From `buildHistoryBundle`'s `shared` count, reduced to the one thing it
   * settles. `null` when nothing has looked yet, which reads the same as
   * "assume there is": the sentence about history is the cautious one.
   */
  readonly hasHistory: boolean | null
  readonly onVouch: () => void
  readonly state: 'idle' | 'working' | VouchOutcome
}

export function Vouch({ entrantId, hasHistory, onVouch, state }: VouchProps) {
  const [asked, setAsked] = useState(false)
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // This read `useColorScheme()` and switched to `color.dark`. Four
  // components did, and nothing else in the application does -- so on a
  // phone set to dark mode these four turned dark inside screens that stayed
  // pale: a black composer under a paper conversation, reported from an
  // iPhone on 7 September 2026 with the words "meme pb de fond".
  //
  // The application has a light palette and a dark one reserved for surfaces
  // that ASK for it -- the promise screen, a photograph full screen. Which
  // ground a component sits on is its parent's business, which is why
  // `LanguagePicker` takes `onDark` and does not guess. A component that reads
  // the system theme is guessing, and it guessed wrong here.
  const palette = color

  // `!asked` GUARDS THIS, AND WITHOUT IT THE BUTTON BELOW IS A LIE.
  //
  // The outcome outlives the gesture -- it is held above, in `App.tsx` --
  // so somebody pressing "try again" would set `asked` and then be shown
  // this same outcome, because `state` had not changed. A control that
  // answers the finger and changes nothing is worse than no control.
  if (!asked && state !== 'idle' && state !== 'working') {
    // A FAILURE IS A STATE YOU CAN LEAVE. A SUCCESS IS NOT.
    //
    // This rendered the outcome and nothing else, whichever it was -- so a
    // failed vouch said « Vous pouvez réessayer » and took the button away,
    // permanently: leaving the person screen and coming back did not bring
    // it back, and only a relaunch did. A screen that names an action and
    // then withholds it is worse than one that says nothing, because the
    // person now knows what to do and cannot find it (#119).
    //
    // Success keeps the old shape, and that is not an oversight: what was
    // handed over cannot be taken back, so there is nothing to offer again.
    const failed = !state.vouched
    return (
      <View style={styles.block}>
        <Text
          testID="vouch-outcome"
          style={[styles.outcome, { color: palette.neutral['600'] }]}>
          {failed
            ? t('vouch_failed_nothing_changed')
            : state.shared === 0
              ? t('vouch_done_no_history')
              : t('vouch_done')}
        </Text>
        {failed && (
          <>
            {/* The reason, under the sentence rather than instead of it.
                Invariant 6 governs what a person is told; it does not
                require hiding what somebody diagnosing it would need -- and
                "not yet" and "refused" want different things from them. */}
            <Text
              testID="vouch-failed-reason"
              style={[styles.hint, { color: palette.neutral['600'] }]}>
              {state.reason}
            </Text>
            <NotchedButton
              label={t('vouch_action')}
              testID="vouch-open"
              onPress={() => setAsked(true)}
            />
          </>
        )}
      </View>
    )
  }

  if (state === 'working') {
    return (
      <Text
        testID="vouch-working"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {t('vouch_working')}
      </Text>
    )
  }

  if (!asked) {
    return (
      <View style={styles.block}>
        <NotchedButton
          label={t('vouch_action')}
          testID="vouch-open"
          onPress={() => setAsked(true)}
        />
        <Text
          testID="vouch-hint"
          style={[styles.hint, { color: palette.neutral['600'] }]}>
          {t('vouch_hint')}
        </Text>
      </View>
    )
  }

  return (
    <View
      testID="vouch-explain"
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface.sunk,
          borderColor: palette.neutral['300'],
        },
      ]}>
      <Text style={[styles.title, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_title')}
      </Text>
      <Text style={[styles.line, { color: palette.neutral['900'] }]}>
        {hasHistory === false
          ? t('vouch_explain_history_empty')
          : t('vouch_explain_history')}
      </Text>
      <Text style={[styles.line, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_invite')}
      </Text>
      {/* Last, and on its own, because it is the sentence somebody has to have
          read before the button below means anything. */}
      <Text
        testID="vouch-final"
        style={[styles.final, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_final')}
      </Text>
      <Text style={[styles.target, { color: palette.neutral['600'] }]}>
        {entrantId}
      </Text>

      <View style={styles.actions}>
        {/* THE REFUSAL IS A BUTTON OF THE SAME RANK.
            It was a grey text link beside a filled button -- on a gesture
            that cannot be undone, which is exactly backwards. The prototype
            states the rule on its verification screen and it applies here
            with more force: "Le refus est un bouton de même rang que
            l'acceptation." Same height, same target, same weight; the colour
            is what distinguishes them, not the size. */}
        <NotchedButton
          label={t('vouch_confirm')}
          testID="vouch-confirm"
          onPress={onVouch}
        />
        <NotchedButton
          label={t('vouch_cancel')}
          testID="vouch-cancel"
          tone="quiet"
          onPress={() => setAsked(false)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: space.s, marginTop: space.m },
  hint: typeScale.caption,
  outcome: { ...typeScale.bodySm, marginTop: space.m },
  panel: {
    gap: space.s,
    marginTop: space.m,
    padding: space.m,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
  },
  title: typeScale.bodySm,
  line: typeScale.bodySm,
  final: typeScale.bodySm,
  target: typeScale.caption,
  actions: { gap: space.s, marginTop: space.s },
  cancel: typeScale.caption,
})
