import React, { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { RTCView } from 'react-native-webrtc'

import type { CallState, EndReason } from '../calls/machine'
import type { Wants } from '../calls/media'
import { offersVideo } from '../calls/sdp'
import type { CallSessionFailure } from '../calls/session'
import type { Pictures } from '../runtime/callMedia'
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
 * does nothing is worse than an absent one. There is no camera button here.
 *
 * There was no speaker button either, for the same reason, until the routing
 * existed to put behind it: `callAudio.ts` now holds the audio session, so
 * the control moves the sound and has earned its place.
 */

/**
 * Why the call never happened, when it never happened.
 *
 * These two come before every state below, because a call refused before it
 * was placed is still `idle` or `ended` and those sentences would say it
 * finished. Both are things somebody can act on: one is their operator's
 * business, the other is theirs.
 */
function refusalFor(failure: CallSessionFailure): CopyKey {
  switch (failure.kind) {
    case 'no-relay':
      return 'call_failed_no_relay'
    case 'no-microphone':
      return 'call_failed_no_microphone'
  }
}

/**
 * What a state says, in one line.
 *
 * `incoming` is the one that reads the offer: Matrix version 1 has no "this
 * is a video call" flag, so the only place the answer lives is the session
 * description. `sdp.ts` says why that is a parser and not a search, and why
 * a `recvonly` line must not announce a picture that never arrives.
 */
function sentenceFor(state: CallState): CopyKey {
  switch (state.call) {
    case 'idle':
      return 'call_ended_hung_up'
    case 'outgoingInvite':
      return 'call_ringing'
    case 'incomingInvite':
      return offersVideo(state.offer.sdp)
        ? 'call_incoming_video'
        : 'call_incoming'
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
  failure,
  shown,
  muted,
  speaker,
  onAnswer,
  onReject,
  onHangup,
  onMute,
  onSpeaker,
  onCamera,
  onSwitchCamera,
  onDismiss,
  pictures = { local: null, remote: null },
  sendingVideo = false,
}: {
  readonly state: CallState
  /** Why it never started, when that is what happened. */
  readonly failure?: CallSessionFailure
  /** The name or the identifier, exactly as the conversation header shows it. */
  readonly shown: string
  readonly muted: boolean
  /** Whether the sound is going to the loudspeaker rather than the earpiece. */
  readonly speaker: boolean
  /**
   * Answers. `wants` says what THIS side sends back, which the ringing
   * screen decides and the offer does not: see the two buttons.
   */
  readonly onAnswer: (wants?: Wants) => void
  readonly onReject: () => void
  readonly onHangup: () => void
  readonly onMute: (muted: boolean) => void
  readonly onSpeaker: (on: boolean) => void
  /** Turns this side's camera on or off during the call. */
  readonly onCamera: (on: boolean) => void
  /** Front to back and back again. */
  readonly onSwitchCamera: () => void
  /** Leaves the call screen. Only offered once the call is over. */
  readonly onDismiss: () => void
  /**
   * The two pictures, when there are any. Both `null` on an audio call,
   * which is every call that never asked for a camera.
   */
  readonly pictures?: Pictures
  /**
   * Whether this side is sending a picture.
   *
   * Not derived from `pictures.local`: the two are the same today and would
   * drift the moment a preview is kept while the sending stops. What the
   * control draws is what the call carries.
   */
  readonly sendingVideo?: boolean
}) {
  const ringing = state.call === 'incomingInvite'
  // WHETHER THE FAR END IS OFFERING A PICTURE, which decides both the
  // sentence above and whether there is a second way to answer. Read from
  // the offer rather than from anything the invitation carries: Matrix
  // version 1 carries nothing.
  const offered =
    state.call === 'incomingInvite' && offersVideo(state.offer.sdp)
  const over = state.call === 'ended' || state.call === 'idle'
  // A CALL WITH A PICTURE IN IT, which is not the same as a call that asked
  // for one: a camera that would not open leaves an audio call wearing a
  // video call's intent, and the screen draws what arrived rather than what
  // was wanted.
  const showing = !over && (pictures.remote !== null || pictures.local !== null)

  // IT CLOSES ITSELF, AND IT WAITS LONG ENOUGH TO BE READ FIRST.
  //
  // This screen used to stay until somebody pressed "Fermer", on the
  // argument that "a call that dies silently is the failure mode" -- which
  // is right about the SAYING and wrong about the staying. Reported after
  // the first real call between two people: at the end of a call the screen
  // should go and give back the conversation, without being asked.
  //
  // So the ending is still shown, and then it goes. Long enough to read
  // "personne n'a répondu" or "la connexion n'a pas pu s'établir", which is
  // the whole reason those sentences exist; short enough that nobody is
  // left holding a dead screen.
  //
  // AND IT NO LONGER COVERS THE COMMONEST ENDING. Hanging up closes the
  // screen immediately -- see the button -- so what waits here is a call
  // that ended without this person deciding it: no answer, a refusal, a
  // relay that could not be reached. Those are the endings with something
  // to say, which is what the delay was always for.
  //
  // THROUGH A REF, so the timer depends on the call's state and on nothing
  // else. `onDismiss` is written inline at the call site, so it is a new
  // function on every render of the application -- and a timer that listed
  // it as a dependency would be torn down and restarted by any unrelated
  // re-render, which on a device that syncs while the ending is on screen
  // means a screen that never closes at all.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!over) return undefined
    const closing = setTimeout(() => dismiss.current(), LINGERS_MS)
    // Cleared if the state moves again -- a second call in the same three
    // seconds must not be closed by the previous one's timer.
    return () => clearTimeout(closing)
  }, [over])

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
        {/* THE FAR END FILLS THE SCREEN, and this side sits in a corner --
            the arrangement every video call has had for fifteen years, and
            one nobody has to be taught. `cover` rather than `contain`: a
            letterboxed face on a telephone wastes the half of the screen
            that matters. */}
        {pictures.remote !== null && !over && (
          <RTCView
            streamURL={pictures.remote}
            style={styles.far}
            objectFit="cover"
            testID="call-far"
          />
        )}
        {pictures.local !== null && !over && (
          // MIRRORED, because a camera pointing at you is a mirror to you
          // and a window to everybody else. Unmirrored, people move the
          // wrong way when they frame themselves.
          <RTCView
            streamURL={pictures.local}
            style={styles.near}
            objectFit="cover"
            mirror
            testID="call-near"
          />
        )}
        <View style={[styles.who, showing && styles.whoAside]}>
          {/* THE AVATAR IS THE FAR END'S ABSENCE, not the absence of any
              picture at all. It was hidden whenever *this* side had a camera
              on -- so a caller whose peer answered without video saw a dark
              rectangle with a name on it and no face anywhere. The question
              an avatar answers is "who is not on screen", and only
              `pictures.remote` can answer it. */}
          {pictures.remote === null && (
            <Avatar shown={shown} size={AVATAR} testID="call-avatar" />
          )}
          <Text style={styles.name} numberOfLines={1} testID="call-name">
            {shown}
          </Text>
          {/* THEIR CAMERA IS OFF, said rather than left to be guessed from
              an avatar. Only while this side is sending one: two people on
              an audio call are not "camera off", they are on an audio call,
              and the line on every call would be noise. #202. */}
          {pictures.local !== null && pictures.remote === null && !over && (
            <Text style={styles.aside} testID="call-their-camera-off">
              {t('call_their_camera_off')}
            </Text>
          )}
          <Text style={styles.sentence} testID="call-state">
            {t(
              failure === undefined ? sentenceFor(state) : refusalFor(failure),
            )}
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
              {/* ANSWERING WITHOUT A PICTURE, and only where there is one
                  to decline. Two buttons rather than one, because a single
                  one would make a ringing telephone a trap: picking it up
                  would light the camera without anybody asking for it, and
                  somebody in bed must be able to take the call.

                  The middle of the row, so the green one that everybody
                  reaches for stays on the right where it has always been. */}
              {offered && (
                <Round
                  testID="call-answer-audio"
                  label={t('call_answer_audio')}
                  tint={color.neutral['600']}
                  onPress={() => onAnswer({ video: false })}
                  glyph="mic"
                />
              )}
              <Round
                testID="call-answer"
                label={offered ? t('call_answer_video') : t('call_answer')}
                tint={color.brand.green500}
                onPress={() => onAnswer(offered ? { video: true } : undefined)}
                glyph={offered ? 'cam' : 'calls'}
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
              {/* GREEN WHEN IT IS ON, like the mute beside it: on a screen
                  with two toggles and no labels-as-state, the fill IS the
                  state, and one convention for both is one thing to learn. */}
              <Round
                testID="call-speaker"
                label={t('call_speaker')}
                tint={speaker ? color.brand.green500 : color.neutral['600']}
                onPress={() => onSpeaker(!speaker)}
                glyph="speaker"
              />
              {/* THE FIFTH AND FOURTH SLOTS §4.5 NAMES: "camera on/off,
                  switch camera". Green when the camera is on, like the two
                  toggles beside it -- one convention for "this is on",
                  learnt once.

                  Switching only appears while there IS a camera to switch.
                  A control that turns nothing is worse than an absent one,
                  and this screen has said so since #88. */}
              <Round
                testID="call-camera"
                label={
                  sendingVideo ? t('call_camera_off') : t('call_camera_on')
                }
                tint={
                  sendingVideo ? color.brand.green500 : color.neutral['600']
                }
                onPress={() => onCamera(!sendingVideo)}
                glyph="cam"
              />
              {sendingVideo && (
                <Round
                  testID="call-switch-camera"
                  label={t('call_switch_camera')}
                  tint={color.neutral['600']}
                  onPress={onSwitchCamera}
                  glyph="cam"
                />
              )}
              {/* HANGING UP CLOSES THE SCREEN AT ONCE, and does not wait
                  out the linger below. Somebody who hung up knows why the
                  call ended -- the sentence that linger exists to let people
                  read has nothing to tell them. Asked for on 9 September
                  2026, after the first call that worked end to end. */}
              <Round
                testID="call-hangup"
                label={t('call_hangup')}
                tint={color.deny['500']}
                onPress={() => {
                  onHangup()
                  onDismiss()
                }}
                glyph="calls"
              />
            </>
          )}

          {/* THERE IS NO "FERMER". It stood here while the screen waited to
              be dismissed; the screen closes itself now -- at once when the
              person hung up, after `LINGERS_MS` when the call ended some
              other way -- so a button whose only job is to do what is about
              to happen anyway is a button asking to be pressed for nothing.
              Removed at the account holder's word on 9 September 2026. */}
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
  /**
   * Narrower than `TabGlyph` on purpose: these are the five this screen has
   * any business drawing, and a wider type would let a future control reach
   * for a tab icon that means something else entirely.
   */
  readonly glyph: 'calls' | 'mic' | 'speaker' | 'cam'
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

/** How long a finished call stays on screen before it closes itself. */
const LINGERS_MS = 3_000

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
  // WITH A PICTURE BEHIND IT, the name stops being the screen and becomes a
  // label on it. The avatar goes: a photograph of somebody's face over a
  // moving picture of the same face is one of them too many.
  whoAside: { gap: space.xs },
  aside: {
    ...type.bodySm,
    color: color.agent['400'],
    textAlign: 'center',
  },
  far: { ...StyleSheet.absoluteFill },
  // A QUARTER OF THE WIDTH, at the top so the controls at the bottom stay
  // reachable and so a thumb does not rest on it.
  near: {
    position: 'absolute',
    top: space.xxl * 2,
    right: space.m,
    width: '26%',
    aspectRatio: 3 / 4,
    borderRadius: radius.bubble,
    overflow: 'hidden',
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
