import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CallState } from '../calls/machine'
import { CallScreen } from './CallScreen'
import { TabIcon } from './TabIcon'

/**
 * The call screen, drawn without a device.
 *
 * # WHY THE TREE IS WALKED HERE RATHER THAN RENDERED
 *
 * Nothing in this workspace renders React Native off a device: there is no
 * test renderer among the dependencies, and the usual one,
 * `react-test-renderer`, is deprecated from React 19. What the screen hands a
 * device is observable without one. Every component is a function, so each is
 * called with its props, and what is left at the bottom -- a `View`, an
 * `RTCView` -- is what the platform would receive, props and all.
 *
 * Drawn once, so the hooks are what they are on a first render and nothing
 * more: a ref holds what it was given, state is its initial value, and an
 * effect never runs. The timer that closes a finished call is not what these
 * tests are about.
 *
 * The three native modules cannot load in Node, and to this screen they are
 * only the names of the elements it draws, so that is what they become.
 */

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}))

vi.mock('react-native-webrtc', () => ({ RTCView: 'RTCView' }))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}))

/** An element the screen returned, and what it drew under it. */
interface Drawn {
  readonly type: unknown
  readonly props: Readonly<Record<string, unknown>>
  readonly children: readonly Drawn[]
}

function draw(node: ReactNode): Drawn[] {
  if (Array.isArray(node)) return node.flatMap(draw)
  // Text, and the `false` a condition leaves behind, draw nothing a test here
  // looks for.
  if (!isValidElement<Record<string, unknown>>(node)) return []
  const { type, props } = node
  if (type === Fragment) return draw(props.children as ReactNode)
  const under =
    typeof type === 'function'
      ? (type as (given: typeof props) => ReactNode)(props)
      : (props.children as ReactNode)
  return [{ type, props, children: draw(under) }]
}

function* everything(drawn: readonly Drawn[]): Generator<Drawn> {
  for (const node of drawn) {
    yield node
    yield* everything(node.children)
  }
}

/**
 * What the device receives under `testID`: the element the platform draws,
 * not a component of this file on the way to it.
 */
function hostOf(drawn: readonly Drawn[], testID: string): Drawn | undefined {
  for (const node of everything(drawn)) {
    if (typeof node.type === 'string' && node.props.testID === testID) {
      return node
    }
  }
  return undefined
}

/** The glyph inside the control the device receives under `testID`. */
function glyphOn(drawn: readonly Drawn[], testID: string): unknown {
  for (const node of everything(hostOf(drawn, testID)?.children ?? [])) {
    if (node.type === TabIcon) return node.props.glyph
  }
  return undefined
}

type Props = Parameters<typeof CallScreen>[0]

const nothing = () => undefined

function screen(given: Pick<Props, 'state'> & Partial<Props>): Drawn[] {
  return draw(
    createElement(CallScreen, {
      shown: 'Nadia',
      muted: false,
      speaker: false,
      onAnswer: nothing,
      onReject: nothing,
      onHangup: nothing,
      onMute: nothing,
      onSpeaker: nothing,
      onCamera: nothing,
      onSwitchCamera: nothing,
      onDismiss: nothing,
      ...given,
    }),
  )
}

/** Both pictures of a video call, arrived. */
const BOTH = { local: 'near', remote: 'far', refused: false }

/** Every state the screen draws a picture in: all of them, until it is over. */
const UNDER_WAY: readonly CallState[] = [
  { call: 'outgoingInvite', callId: 'call' },
  {
    call: 'incomingInvite',
    callId: 'call',
    autoAccept: false,
    offer: { type: 'offer', sdp: '' },
  },
  { call: 'connecting', callId: 'call' },
  { call: 'inCall', callId: 'call' },
  { call: 'reconnecting', callId: 'call', secondsLeft: 20 },
]

describe('the two pictures of a video call', () => {
  // #288, from the rehearsal of 13 September 2026: the caller saw and heard
  // the far end, and never saw itself.
  //
  // Each picture is a video surface, and two surfaces at the same z-order are
  // stacked in no promised order: in practice the one created last covers the
  // other. The caller's camera opens before the invite goes out and the far
  // end's picture arrives after the answer, so on the caller's telephone the
  // full-screen picture came last and covered the corner. The callee applies
  // the offer first and opens its camera second, which is why the same screen
  // worked from the other side.
  //
  // 0 and 1 are react-native-webrtc's own advice for this very arrangement:
  // 0 for the remote video in the background, 1 for the local one above it.
  // Not 2, which Android places above the window itself, over the controls.
  it.each(UNDER_WAY)('lays this side over the far end while $call', state => {
    const drawn = screen({ state, pictures: BOTH, sendingVideo: true })

    // The stream beside the order, so that a picture the screen stopped
    // drawing fails here as missing rather than passing as unordered.
    expect(hostOf(drawn, 'call-far')?.props).toMatchObject({
      streamURL: 'far',
      zOrder: 0,
    })
    expect(hostOf(drawn, 'call-near')?.props).toMatchObject({
      streamURL: 'near',
      zOrder: 1,
    })
  })
})

describe('the camera controls', () => {
  // #290, from the same rehearsal: the camera control and the switch beside
  // it both drew `cam`, two round buttons with one picture in them. The
  // prototype's video controls give switching a glyph of its own, and turn
  // the camera's between `cam` and `cam.off` with what the camera is doing.
  const IN_CALL: CallState = { call: 'inCall', callId: 'call' }

  it('draws the camera whole while it sends, and crossed out while it does not', () => {
    const sending = screen({
      state: IN_CALL,
      pictures: BOTH,
      sendingVideo: true,
    })
    const silent = screen({ state: IN_CALL, sendingVideo: false })

    expect(glyphOn(sending, 'call-camera')).toBe('cam')
    expect(glyphOn(silent, 'call-camera')).toBe('cam.off')
  })

  it('draws switching as two arrows round a lens, not as a second camera', () => {
    const sending = screen({
      state: IN_CALL,
      pictures: BOTH,
      sendingVideo: true,
    })

    expect(glyphOn(sending, 'call-switch-camera')).toBe('flip')
  })
})
