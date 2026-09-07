import React, { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import type { CallState, EndReason } from '../calls/machine'
import { t, type CopyKey } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'
import { Avatar } from './Avatar'
import { TabIcon } from './TabIcon'

/**
 * A call, from the moment there is one until there is not.
 *
 * # ONE SCREEN FOR SIX STATES, NOT SIX SCREENS
 *
 * `machine.ts` has six states a person can be in -- placing, being called,
 * connecting, talking, reconnecting, over -- and every one of them is the
 * same two people, the same name, the same round photograph. What changes is
 * one line of text and which buttons are under it. Six screens would be six
 * places to keep that name in step, and a transition between two of them is
 * a flash on a screen somebody is holding to their ear.
 *
 * So the state picks a sentence and a row of controls, and nothing else
 * moves. `reconnecting` is the proof this was right: it is `inCall` with a
 * different sentence and a countdown, every control still working, because
 * underneath it *is* still the call.
 *
 * # EVERY STATE IS VISIBLE, WHICH IS THE POINT OF THE TICKET
 *
 * §4.5 asks for connecting, reconnecting, active, ended and failed to be
 * seen. A call that dies silently is the failure mode: silence on a
 * telephone is indistinguishable from a working call where nobody is
 * talking, and the person holding it will say "allô ?" for thirty seconds
 * before hanging up. So `ended` shows its reason and stays until it is
 * dismissed, rather than closing itself the instant the call drops.
 *
 * # No video, and no control that pretends
 *
 * §4.5 names camera controls; this lot is audio, and #88 says a control that
 * does nothing is worse than an absent one. There is no camera button here
 * and no speaker button either -- routing audio to the loudspeaker needs a
 * platform API neither `react-native-webrtc` nor this application has, and a
 * speaker button that does not move the sound is exactly the control that
 * ticket refuses.
 */

/** What a state says, in one line. */
function sentenceFor(state: CallState): CopyKey {
  switch (state.call) {
    case 'idle':
      return 'call_ended_hung_up'
    case 'outgoingInvite':
      return 'call_ringing'
    case 'incomingInvite':
      return 'call_incoming'
    case 'connecting':
      return 'call_connecting'
    case 'inCall':
      return 'call_active'
    case 'reconnecting':
      return 'call_reconnecting'
    case 'ended':
      return endingFor(state.reason)
  }
}

/**
 * Why it ended, in the person's words rather than the protocol's.
 *
 * The machine's reasons are the specification's, and most of them are the
 * same event from two sides: `remoteHangup` and `localHangup` are one call
 * ending normally. What a screen must separate is the ones somebody has to
 * *do* something about -- nobody answered, it could not connect -- from the
 * ones that are simply the end of a conversation.
 */
function endingFor(reason: EndReason): CopyKey {
  switch (reason.ended) {
    case 'hangup':
      // The wire reason, when it says something a person would: an invite
      // that timed out is "nobody answered", and everything else here is a
      // conversation that finished.
      return reason.reason === 'invite_timeout'
        ? 'call_ended_unanswered'
        : 'call_ended_hung_up'
    case 'rejected':
      return 'call_ended_declined'
    case 'inviteExpired':
      return 'call_ended_unanswered'
    case 'answeredElsewhere':
      return 'call_ended_elsewhere'
    case 'rejectedElsewhere':
      return 'call_ended_declined'
    case 'sendFailed':
      // "We could not reach them", which is not "they did not pick up".
      // `machine.ts` keeps the two apart on purpose and this is the screen
      // that would otherwise collapse them.
      return 'call_ended_unreachable'
    default:
      return 'call_ended_failed'
  }
}

export function CallScreen({
  state,
  shown,
  muted,
  onAnswer,
  onReject,
  onHangup,
  onMute,
  onDismiss,
}: {
  readonly state: CallState
  /** The name or the identifier, exactly as the conversation header shows it. */
  readonly shown: string
  readonly muted: boolean
  readonly onAnswer: () => void
  readonly onReject: () => void
  readonly onHangup: () => void
  readonly onMute: (muted: boolean) => void
  /** Leaves the call screen. Only offered once the call is over. */
  readonly onDismiss: () => void
}) {
  const ringing = state.call === 'incomingInvite'
  const over = state.call === 'ended' || state.call === 'idle'

  return (
    <Modal
      visible
      transparent={false}
      animationType="slide"
      // The hardware back button. It hangs up rather than hiding the call:
      // a call still running behind a screen that is gone is a microphone
      // nobody can see they left open.
      onRequestClose={over ? onDismiss : onHangup}
      testID="call-screen">
      <View style={styles.ground}>
        <View style={styles.who}>
          <Avatar shown={shown} size={AVATAR} testID="call-avatar" />
          <Text style={styles.name} numberOfLines={1} testID="call-name">
            {shown}
          </Text>
          <Text style={styles.sentence} testID="call-state">
            {t(sentenceFor(state))}
            {state.call === 'reconnecting' && ` ${state.secondsLeft}`}
          </Text>
          {state.call === 'inCall' && <Elapsed />}
        </View>

        <View style={styles.controls}>
          {ringing && (
            <>
              <Round
                testID="call-reject"
                label={t('call_reject')}
                tint={color.deny['500']}
                onPress={onReject}
                glyph="calls"
              />
              <Round
                testID="call-answer"
                label={t('call_answer')}
                tint={color.brand.green500}
                onPress={onAnswer}
                glyph="calls"
              />
            </>
          )}

          {!ringing && !over && (
            <>
              <Round
                testID="call-mute"
                label={muted ? t('call_unmute') : t('call_mute')}
                tint={muted ? color.brand.green500 : color.neutral['600']}
                onPress={() => onMute(!muted)}
                glyph="mic"
              />
              <Round
                testID="call-hangup"
                label={t('call_hangup')}
                tint={color.deny['500']}
                onPress={onHangup}
                glyph="calls"
              />
            </>
          )}

          {over && (
            <Round
              testID="call-dismiss"
              label={t('call_dismiss')}
              tint={color.neutral['600']}
              onPress={onDismiss}
              glyph="calls"
            />
          )}
        </View>
      </View>
    </Modal>
  )
}

/**
 * How long the call has been up.
 *
 * Counted here rather than in the machine, unlike `reconnecting`'s countdown,
 * and the difference is what each number *is*. The countdown is a threshold
 * -- at zero the call ends -- and thresholds are the machine's. Elapsed time
 * decides nothing; it is a comfort, and a comfort that stopped at the same
 * moment the protocol did would be a clock the machine has to carry for a
 * screen's sake.
 */
function Elapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const ticking = setInterval(() => setSeconds(held => held + 1), 1000)
    return () => clearInterval(ticking)
  }, [])
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return (
    <Text style={styles.elapsed} testID="call-elapsed">
      {`${minutes}:${rest < 10 ? '0' : ''}${rest}`}
    </Text>
  )
}

/** One round control, at the touch-target floor with its label under it. */
function Round({
  testID,
  label,
  tint,
  onPress,
  glyph,
}: {
  readonly testID: string
  readonly label: string
  readonly tint: string
  readonly onPress: () => void
  readonly glyph: 'calls' | 'mic'
}) {
  return (
    <View style={styles.control}>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.round,
          { backgroundColor: tint },
          pressed && styles.pressed,
        ]}>
        <TabIcon glyph={glyph} tint={color.surface.paper} size={ICON} />
      </Pressable>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const AVATAR = 96
const ICON = 28
const ROUND = 64

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    // The same dark ground the photograph viewer takes, and for the same
    // reason `FullScreenPlate` records: it is not a security boundary, it is
    // a screen whose content is one person and nothing else.
    backgroundColor: color.brand.ink900,
    justifyContent: 'space-between',
    paddingTop: space.xxl * 2,
    paddingBottom: space.xxl * 2,
  },
  who: {
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.xl,
  },
  name: {
    ...type.titleLg,
    color: color.surface.paper,
    textAlign: 'center',
  },
  sentence: {
    ...type.body,
    color: color.dark.brand.green700,
    textAlign: 'center',
  },
  elapsed: {
    ...type.monoLabel,
    color: color.agent['400'],
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xxl,
  },
  control: { alignItems: 'center', gap: space.xs },
  round: {
    width: ROUND,
    height: ROUND,
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  label: {
    ...type.caption,
    color: color.agent['400'],
  },
})
