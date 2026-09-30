import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from '../runtime/conversationList'
import type { TrustReading } from '../runtime/cryptoPump'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import {
  backToTheList,
  leavesNow,
  NOTHING_OVER,
  overAfterTheBlock,
  type OpenPlate,
  type OverTheConversation,
  type TheScreen,
} from './overTheConversation'
import type { OpenReport } from './reportStage'

const ME = '@me:example.org'
const BLOCKED = '@bothers:example.org'
const FRIEND = '@friend:example.org'

function said(eventId: string, sender: string): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt: 1, body: eventId }
}

/** A conversation of three: the blocked account, a friend, and this one. */
const THREE_OF_US: readonly TimelineEntry[] = [
  said('$theirs-1', BLOCKED),
  said('$friends', FRIEND),
  said('$mine', ME),
  said('$theirs-2', BLOCKED),
]

function row(
  scope: string,
  other: string | null,
  extra: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    scope,
    other,
    others: other === null ? 2 : 1,
    preview: 'hello',
    lastAt: 1,
    unread: 0,
    ...extra,
  }
}

function plateOf(...entries: TimelineEntry[]): OpenPlate {
  return {
    plate: {
      at: entries[0]?.eventId ?? '',
      entries,
      swallowed: new Set(entries.slice(1).map(one => one.eventId)),
    },
    at: 0,
  }
}

function reportOn(author: string, eventIds: readonly string[]): OpenReport {
  return {
    opening: 1,
    scope: '!three-of-us:x',
    eventIds: new Set(eventIds),
    author,
    sheet: { stage: 'choosing' },
  }
}

/** Everything that can be over the conversation, up, and about the blocked account. */
const EVERYTHING_UP: OverTheConversation = {
  selected: new Set(['$theirs-1']),
  trust: {} as TrustReading,
  personOpen: true,
  blockingSender: { scope: '!three-of-us:x', other: BLOCKED },
  reporting: reportOn(BLOCKED, ['$theirs-1']),
  removing: true,
  forwarding: ['$theirs-1'],
  openPlate: plateOf(said('$photo', BLOCKED)),
}

describe('what is over the conversation, put down (#494, #498)', () => {
  it('puts every layer down: the selection, the panels, every sheet, the forward picker and the photograph full screen', () => {
    // What every closing leaves, and every opening starts from: left up,
    // each outlived its conversation.
    expect(NOTHING_OVER).toEqual({
      selected: new Set(),
      trust: null,
      personOpen: false,
      blockingSender: null,
      reporting: null,
      removing: false,
      forwarding: null,
      openPlate: null,
    })
  })
})

describe('a share that fails while a conversation is open (#498)', () => {
  it('comes back to the list: no conversation, nothing over it, the conversations’ tab, and nothing over the list or in its place', () => {
    // Its sentence is read on the list. Closing the conversation by hand
    // left the sheets, the forward picker and the photograph standing over
    // the list, and looking for one's contacts drawn in its place.
    const screen: TheScreen = {
      open: '!three-of-us:x',
      over: EVERYTHING_UP,
      tab: 'settings',
      invite: { stage: 'resting' },
      plusOpen: true,
      admission: 'waiting',
      finding: { stage: 'looking' },
    }

    expect(backToTheList(screen)).toEqual({
      open: null,
      over: NOTHING_OVER,
      tab: 'chat',
      invite: { stage: 'shut' },
      plusOpen: false,
      admission: null,
      finding: { stage: 'shut' },
    })
  })
})

describe('a block that arrives while a conversation is open (#494, #498)', () => {
  it('closes a conversation of two with the blocked account', () => {
    expect(
      leavesNow(
        '!with-them:x',
        { scope: '!with-them:x', other: BLOCKED },
        [row('!with-them:x', BLOCKED)],
        new Set([BLOCKED]),
      ),
    ).toBe(true)
  })

  it('keeps a conversation that stays open, and takes the blocked account’s messages out of the selection and of the forward picker', () => {
    expect(
      leavesNow(
        '!three-of-us:x',
        null,
        [row('!three-of-us:x', null)],
        new Set([BLOCKED]),
      ),
    ).toBe(false)

    const after = overAfterTheBlock(
      {
        ...EVERYTHING_UP,
        selected: new Set(['$theirs-1', '$friends', '$theirs-2']),
        forwarding: ['$theirs-2', '$friends', '$theirs-1'],
      },
      THREE_OF_US,
      new Set([BLOCKED]),
    )

    expect([...after.selected]).toEqual(['$friends'])
    // Nothing of theirs is sent on, whichever conversation is picked.
    expect(after.forwarding).toEqual(['$friends'])
  })

  it('closes the forward picker when only the blocked account’s messages were waiting in it', () => {
    // A picker with nothing left to send is a gesture with nothing to do.
    expect(
      overAfterTheBlock(
        { ...EVERYTHING_UP, forwarding: ['$theirs-1', '$theirs-2'] },
        THREE_OF_US,
        new Set([BLOCKED]),
      ).forwarding,
    ).toBeNull()
  })

  it('closes what shows the blocked account: its photograph full screen, and a sheet about it', () => {
    expect(
      overAfterTheBlock(EVERYTHING_UP, THREE_OF_US, new Set([BLOCKED])),
    ).toMatchObject({ openPlate: null, reporting: null, blockingSender: null })
  })

  it('leaves as it is what shows somebody else', () => {
    const over: OverTheConversation = {
      ...EVERYTHING_UP,
      selected: new Set(['$friends']),
      forwarding: ['$friends', '$mine'],
      openPlate: plateOf(said('$their-photo', FRIEND)),
      reporting: reportOn(FRIEND, ['$friends']),
      blockingSender: { scope: '!three-of-us:x', other: FRIEND },
    }

    // The very same value: nothing drawn again for nothing.
    expect(overAfterTheBlock(over, THREE_OF_US, new Set([BLOCKED]))).toBe(over)
  })
})

describe('what becomes known of the conversation open (#498)', () => {
  const blocked = new Set([BLOCKED])

  it('closes a conversation of two whose participants were not known when the block arrived, as soon as its other person is', () => {
    // Opened before anything said who is in it: no row yet, the other
    // person not found. It stays open meanwhile.
    expect(leavesNow('!with-them:x', null, [], blocked)).toBe(false)

    expect(
      leavesNow(
        '!with-them:x',
        { scope: '!with-them:x', other: BLOCKED },
        [],
        blocked,
      ),
    ).toBe(true)
  })

  it('closes it too when it is the list that learns who is in it', () => {
    expect(
      leavesNow(
        '!with-them:x',
        null,
        [row('!with-them:x', null, { others: null })],
        blocked,
      ),
    ).toBe(false)
    expect(
      leavesNow('!with-them:x', null, [row('!with-them:x', BLOCKED)], blocked),
    ).toBe(true)
  })

  it('closes one this account is now alone in, once its row says the blocked account was who left', () => {
    expect(
      leavesNow(
        '!they-left:x',
        null,
        [row('!they-left:x', null, { others: 0, membershipsUnread: true })],
        blocked,
      ),
    ).toBe(false)
    expect(
      leavesNow(
        '!they-left:x',
        null,
        [row('!they-left:x', null, { others: 0, departed: BLOCKED })],
        blocked,
      ),
    ).toBe(true)
  })

  it('closes one of more than two that shrank to two with the blocked account', () => {
    // The friend left: the conversation is the one with the blocked account.
    expect(
      leavesNow('!three-of-us:x', null, [row('!three-of-us:x', null)], blocked),
    ).toBe(false)
    expect(
      leavesNow(
        '!three-of-us:x',
        null,
        [row('!three-of-us:x', BLOCKED)],
        blocked,
      ),
    ).toBe(true)
  })

  it('keeps open one with somebody else, and closes nothing while none is open', () => {
    expect(
      leavesNow(
        '!with-a-friend:x',
        { scope: '!with-a-friend:x', other: FRIEND },
        [row('!with-a-friend:x', FRIEND)],
        blocked,
      ),
    ).toBe(false)
    expect(leavesNow(null, null, [row('!with-them:x', BLOCKED)], blocked)).toBe(
      false,
    )
  })

  it('reads the other person found for the conversation open only, never the one found for the conversation before', () => {
    expect(
      leavesNow(
        '!with-a-friend:x',
        { scope: '!with-them:x', other: BLOCKED },
        [row('!with-a-friend:x', FRIEND)],
        blocked,
      ),
    ).toBe(false)
  })
})
