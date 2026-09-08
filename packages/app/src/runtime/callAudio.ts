import InCallManager from 'react-native-incall-manager'

/**
 * The telephone around the call: where the sound comes out, and what the
 * operating system thinks is happening.
 *
 * # THE ROUTING IS NOT THE HALF THAT MATTERS MOST
 *
 * This was added for a speaker button, and the speaker button is the smaller
 * half of what it does. Starting an in-call session puts the platform into
 * its *communication* audio mode -- `MODE_IN_COMMUNICATION` on Android,
 * `AVAudioSession` category `playAndRecord` with the voice-chat mode on iOS
 * -- and that mode is what turns on the platform's own echo canceller and
 * routes the call to the earpiece at call volume rather than to the
 * loudspeaker at media volume.
 *
 * Without it a call still connects and still carries audio, which is exactly
 * why it is easy to leave out: the first calls on this branch worked. What
 * they did was play out of the loudspeaker, at the volume of a video, with
 * each side hearing the other echoed back.
 *
 * # `react-native-webrtc` does not do this, and it is not an oversight
 *
 * The library gives peer connections and tracks. Audio *sessions* belong to
 * the platform and to whatever else is making noise on the device, which is
 * a different problem with a different lifetime -- a call, not a track. The
 * WebRTC library exposes only the two CallKit hooks (`RTCAudioSession`) and
 * leaves the rest alone.
 *
 * # A seam, like every other native module here
 *
 * `cryptoPump.ts` for the crypto bridge, `callMedia.ts` for WebRTC, this for
 * the audio session. Untested, because it is four calls into a native module
 * and nothing else; anything here that begins to decide belongs upstairs
 * where it can be tested.
 */

/** Which end of the call this device is on. */
export type CallRole = 'caller' | 'callee'

/** What a call does to the device it is on. */
export interface CallAudio {
  /** The call has begun: take the audio session. */
  readonly begin: (role: CallRole) => void
  /**
   * The far end picked up, or the call is over: stop the ringback.
   *
   * Separate from `end`, because a call that connects is not a call that
   * finished, and a ringback still playing under somebody's voice is the
   * loudest possible way of saying the application has lost track.
   */
  readonly stopRinging: () => void
  /** The call is over: give it back. */
  readonly end: () => void
  /**
   * Move the sound between the earpiece and the loudspeaker.
   *
   * `setForceSpeakerphoneOn` rather than `setSpeakerphoneOn`: the second
   * asks politely and the platform's own routing may take it back the next
   * time anything changes -- a headset plugged in, a Bluetooth device
   * appearing. The forced form is a decision somebody made by pressing a
   * button, and it stays made until they press it again.
   */
  readonly speaker: (on: boolean) => void
}

export const deviceCallAudio: CallAudio = {
  begin: role => {
    InCallManager.start({
      media: 'audio',
      // `auto` lets the library follow the proximity sensor: the screen goes
      // dark when the telephone is at somebody's ear, which is what stops a
      // cheek from pressing "hang up".
      auto: true,
      // THE RINGBACK, WHICH THIS ARGUED ITSELF OUT OF AND WAS WRONG ABOUT.
      //
      // It read: "the caller's screen already says «appel en cours…», and a
      // tone this application synthesises would be a second opinion about a
      // state the machine already reports". The premise is true and the
      // conclusion does not follow, and the tester said so the first time he
      // placed a call: "je m'attendais à avoir un feedback sonore qui me dit
      // que ça sonne (comme sur WhatsApp)".
      //
      // A telephone is held to an ear. The screen is against a cheek and the
      // proximity sensor has just turned it off -- on purpose, three lines
      // above this one. The tone is not a second opinion about the state, it
      // is the ONLY report of it that reaches somebody in the position this
      // product puts them in.
      //
      // Only for the caller. The callee is not waiting for anything: they
      // are being rung, and the ring is the notification's own sound.
      ringback: role === 'caller' ? '_DEFAULT_' : '',
    })
    // A call is not something to be interrupted by a screen lock, and the
    // proximity sensor above still takes the display when it should.
    InCallManager.setKeepScreenOn(true)
  },

  stopRinging: () => InCallManager.stopRingback(),

  end: () => {
    // No busy tone, for the reason the ringback has none: the screen says
    // why the call ended, in words, and it says it for every ending rather
    // than for the one that has a sound.
    InCallManager.stop({ busytone: '' })
    InCallManager.setKeepScreenOn(false)
  },

  speaker: on => InCallManager.setForceSpeakerphoneOn(on),
}
