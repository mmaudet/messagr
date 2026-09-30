import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { LooseReaction } from '../timeline/reactions'
import {
  allShown,
  EVERYTHING_SHOWN,
  reactionsShown,
  shownOf,
  type NotShown,
} from './notShown'

const ME = '@me:example.org'
const BLOCKED = '@bothers:example.org'
const FRIEND = '@friend:example.org'

function said(eventId: string, sender: string): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt: 1, body: eventId }
}

describe('what this device does not draw of a conversation', () => {
  it('leaves out the events hidden here and every message of a blocked account', () => {
    const conversation = [
      said('$mine', ME),
      said('$hidden-here', FRIEND),
      said('$theirs', BLOCKED),
      said('$friends', FRIEND),
    ]

    expect(
      shownOf(conversation, {
        hidden: new Set(['$hidden-here']),
        blocked: new Set([BLOCKED]),
      }).map(one => one.eventId),
    ).toEqual(['$mine', '$friends'])
  })

  it('draws everything when nothing is withheld, and hands the same list back', () => {
    const conversation = [said('$a', BLOCKED)]
    expect(shownOf(conversation, EVERYTHING_SHOWN)).toBe(conversation)
  })
})

describe('the reactions drawn under the messages (#494)', () => {
  function reacted(
    eventId: string,
    target: string,
    key: string,
    claimedSender: string,
  ): LooseReaction {
    return { eventId, target, key, claimedSender }
  }

  it('leaves out a blocked account’s reactions in the same render as its messages', () => {
    // One value says what is not drawn, and both are drawn from it: the
    // reactions no longer wait for the conversation to be read again.
    const notShown: NotShown = {
      hidden: new Set(),
      blocked: new Set([BLOCKED]),
    }
    const conversation = [said('$friends', FRIEND), said('$theirs', BLOCKED)]
    const reactions = [
      reacted('$r1', '$friends', '👍', BLOCKED),
      reacted('$r2', '$friends', '👍', FRIEND),
      reacted('$r3', '$friends', '😂', BLOCKED),
      reacted('$r4', '$friends', '❤️', ME),
    ]

    expect(shownOf(conversation, notShown).map(one => one.eventId)).toEqual([
      '$friends',
    ])
    expect(reactionsShown(reactions, notShown, ME).get('$friends')).toEqual([
      { key: '👍', count: 1, mine: null },
      { key: '❤️', count: 1, mine: '$r4' },
    ])
  })

  it('tallies every reaction when nothing is withheld', () => {
    const reactions = [
      reacted('$r1', '$friends', '👍', BLOCKED),
      reacted('$r2', '$friends', '👍', ME),
    ]

    expect(
      reactionsShown(reactions, EVERYTHING_SHOWN, ME).get('$friends'),
    ).toEqual([{ key: '👍', count: 2, mine: '$r2' }])
  })
})

describe('a photograph open full screen, once its sender is blocked (#472)', () => {
  // In a conversation that stays, what a blocked account sent leaves the
  // viewer as it leaves the thread: the viewer shows a plate only while the
  // filter still draws every photograph in it.
  const plate = [said('$p1', BLOCKED), said('$p2', BLOCKED)]

  it('is drawn no more once its sender is blocked', () => {
    expect(
      allShown(plate, { hidden: new Set(), blocked: new Set([BLOCKED]) }),
    ).toBe(false)
  })

  it('stays drawn while its sender is not', () => {
    expect(
      allShown(plate, { hidden: new Set(), blocked: new Set([FRIEND]) }),
    ).toBe(true)
    expect(allShown(plate, EVERYTHING_SHOWN)).toBe(true)
  })
})
