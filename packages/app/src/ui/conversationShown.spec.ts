import { describe, expect, it } from 'vitest'

import { EVERYTHING_SHOWN } from '../runtime/notShown'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { LooseReaction } from '../timeline/reactions'
import { conversationShown } from './conversationShown'

const ME = '@me:example.org'
const HER = '@her:example.org'
const BLOCKED = '@bothers:example.org'

function said(eventId: string, sender: string): TimelineEntry {
  return {
    eventId,
    claimedSender: sender,
    sentAt: 1,
    body: eventId,
    msgtype: 'm.text',
  }
}

function reaction(
  eventId: string,
  target: string,
  sender: string,
): LooseReaction {
  return { eventId, target, key: '👍', claimedSender: sender }
}

/**
 * A conversation of three, as the homeserver holds it: this account's own
 * message, somebody else's, and those of an account since blocked.
 */
const CONVERSATION: readonly TimelineEntry[] = [
  said('$mine', ME),
  said('$hers', HER),
  said('$theirs', BLOCKED),
]

const REACTIONS: readonly LooseReaction[] = [
  reaction('$r-mine', '$hers', ME),
  reaction('$r-hers', '$mine', HER),
  reaction('$r-theirs', '$mine', BLOCKED),
]

/** The conversation open, for the account the session holds, `ME`. */
function asMine(
  selected: readonly string[],
  notShown = { hidden: new Set<string>(), blocked: new Set([BLOCKED]) },
) {
  return conversationShown(ME, {
    conversation: CONVERSATION,
    notShown,
    reactions: REACTIONS,
    selected: new Set(selected),
  })
}

describe('the conversation open, as this account reads it (#472, #494, #498)', () => {
  it('reads this account’s own message as its own: removable for everyone, and neither reported nor blocked', () => {
    // After a launch that found no conversation, the account was the empty
    // string here: a conversation joined afterwards offered this account's
    // own messages for reporting, and never « pour tout le monde ».
    const shown = asMine(['$mine'])

    expect(shown.forEveryone).toBe(true)
    expect(shown.reportable).toBeNull()
    expect(shown.blockable).toBeNull()
    expect(shown.offers).toMatchObject({ report: false, block: false })
  })

  it('reads somebody else’s as theirs: « Signaler » and « Bloquer l’expéditeur » offered, « pour tout le monde » not', () => {
    const shown = asMine(['$hers'])

    expect(shown.forEveryone).toBe(false)
    expect(shown.reportable?.author).toBe(HER)
    expect(shown.blockable).toBe(HER)
    expect(shown.offers).toMatchObject({
      copy: true,
      forward: true,
      favourite: true,
      keep: false,
      report: true,
      block: true,
      remove: true,
    })
  })

  it('tells this account’s own reaction from the others’, by the same account', () => {
    const shown = asMine([])

    expect(shown.reactions.get('$hers')).toEqual([
      { key: '👍', count: 1, mine: '$r-mine' },
    ])
    // The blocked account's reaction is not drawn: one of one, and not ours.
    expect(shown.reactions.get('$mine')).toEqual([
      { key: '👍', count: 1, mine: null },
    ])
  })

  it('draws nothing of the account blocked, and offers nothing on it', () => {
    const shown = asMine(['$theirs'])

    expect(shown.entries.map(one => one.eventId)).toEqual(['$mine', '$hers'])
    expect(shown.reportable).toBeNull()
    expect(shown.blockable).toBeNull()
    expect(shown.forEveryone).toBe(false)
    expect(shown.offers).toMatchObject({
      copy: false,
      forward: false,
      favourite: false,
      report: false,
      block: false,
    })
  })

  it('offers on the conversation as it is shown: a message hidden here offers nothing', () => {
    const shown = asMine(['$hers'], {
      hidden: new Set(['$hers']),
      blocked: new Set(),
    })

    expect(shown.entries.map(one => one.eventId)).toEqual(['$mine', '$theirs'])
    expect(shown.offers).toMatchObject({
      copy: false,
      forward: false,
      report: false,
      block: false,
    })
  })

  it('offers nothing to report or block while nothing is selected, and still the bin', () => {
    const shown = conversationShown(ME, {
      conversation: CONVERSATION,
      notShown: EVERYTHING_SHOWN,
      reactions: [],
      selected: new Set(),
    })

    expect(shown.reportable).toBeNull()
    expect(shown.blockable).toBeNull()
    expect(shown.offers.remove).toBe(true)
  })
})
