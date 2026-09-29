import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { EVERYTHING_SHOWN, shownOf } from './notShown'

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
