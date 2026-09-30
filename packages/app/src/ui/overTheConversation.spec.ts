import { describe, expect, it } from 'vitest'

import type {
  ConversationSummary,
  WithSomebody,
} from '../runtime/conversationList'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import {
  backToTheList,
  leaveTheConversation,
  lookAgain,
  putDownWhatIsOver,
  takeWhatTheBlockTakes,
  type OpenPlate,
  type TheListScreen,
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

/** What the screen holds: the conversation open, and every layer over it. */
interface Held {
  open: string | null
  selected: ReadonlySet<string>
  trust: string | null
  personOpen: boolean
  blockingSender: WithSomebody | null
  reporting: OpenReport | null
  removing: boolean
  forwarding: readonly string[] | null
  openPlate: OpenPlate | null
  tab: string
  invite: { readonly stage: string }
  plusOpen: boolean
  admission: string | null
}

/**
 * The screen, as a double: every setter writes the value it is handed, or
 * the one its change makes of the value held, as React's do.
 */
function screenWith(over: Partial<Held> = {}) {
  const held: Held = {
    open: '!three-of-us:x',
    selected: new Set(['$theirs-1']),
    trust: 'what is known of them',
    personOpen: true,
    blockingSender: { scope: '!three-of-us:x', other: BLOCKED },
    reporting: reportOn(BLOCKED, ['$theirs-1']),
    removing: true,
    forwarding: ['$theirs-1'],
    openPlate: plateOf(said('$photo', BLOCKED)),
    tab: 'settings',
    invite: { stage: 'resting' },
    plusOpen: true,
    admission: 'waiting',
    ...over,
  }
  function set<K extends keyof Held>(key: K) {
    return (next: Held[K] | ((was: Held[K]) => Held[K])) => {
      held[key] =
        typeof next === 'function'
          ? (next as (was: Held[K]) => Held[K])(held[key])
          : next
    }
  }
  const screen: TheListScreen = {
    closeTheConversation: () => {
      held.open = null
    },
    setSelected: set('selected'),
    setTrust: set('trust'),
    setPersonOpen: set('personOpen'),
    setBlockingSender: set('blockingSender'),
    setReporting: set('reporting'),
    setRemoving: set('removing'),
    setForwarding: set('forwarding'),
    setOpenPlate: set('openPlate'),
    setTab: set('tab'),
    setInvite: set('invite'),
    setPlusOpen: set('plusOpen'),
    setAdmission: set('admission'),
  }
  return { held, screen }
}

/** Every layer that can be drawn over a conversation, put down. */
const NOTHING_OVER = {
  selected: new Set(),
  trust: null,
  personOpen: false,
  blockingSender: null,
  reporting: null,
  removing: false,
  forwarding: null,
  openPlate: null,
}

describe('leaving the conversation open (#494, #498)', () => {
  it('closes it, and puts down everything drawn over it', () => {
    const { held, screen } = screenWith()

    leaveTheConversation(screen)

    expect(held).toMatchObject({ open: null, ...NOTHING_OVER })
  })

  it('puts down what was over one conversation when another opens in its place', () => {
    // The opening sets the conversation; what was over the one before
    // belongs to it and does not come back over this one.
    const { held, screen } = screenWith({ open: '!the-next-one:x' })

    putDownWhatIsOver(screen)

    expect(held).toMatchObject({ open: '!the-next-one:x', ...NOTHING_OVER })
  })
})

describe('a share that fails while a conversation is open (#498)', () => {
  it('comes back to the list by the same way out as every other closing, everything over the conversation put down', () => {
    // Its sentence is read on the list. Closing the conversation by hand
    // left the sheets, the forward picker and the photograph full screen
    // standing over the list.
    const { held, screen } = screenWith()

    backToTheList(screen)

    expect(held).toMatchObject({
      open: null,
      ...NOTHING_OVER,
      tab: 'chat',
      invite: { stage: 'shut' },
      plusOpen: false,
      admission: null,
    })
  })
})

describe('a block that arrives while a conversation is open (#494, #498)', () => {
  it('closes a conversation of two with the blocked account, everything over it put down', () => {
    const { held, screen } = screenWith({
      open: '!with-them:x',
      blockingSender: null,
    })

    const after = takeWhatTheBlockTakes(
      screen,
      { scope: '!with-them:x', other: BLOCKED },
      [row('!with-them:x', BLOCKED)],
      new Set([BLOCKED]),
      [said('$theirs-1', BLOCKED), said('$mine', ME)],
    )

    expect(after).toBe('leaves')
    expect(held).toMatchObject({ open: null, ...NOTHING_OVER })
  })

  it('keeps a conversation that stays open, and takes the blocked account’s messages out of the selection and of the forward picker', () => {
    const { held, screen } = screenWith({
      selected: new Set(['$theirs-1', '$friends', '$theirs-2']),
      forwarding: ['$theirs-2', '$friends', '$theirs-1'],
    })

    const after = takeWhatTheBlockTakes(
      screen,
      { scope: '!three-of-us:x', other: null },
      [row('!three-of-us:x', null)],
      new Set([BLOCKED]),
      THREE_OF_US,
    )

    expect(after).toBe('stays')
    expect(held.open).toBe('!three-of-us:x')
    expect([...held.selected]).toEqual(['$friends'])
    // Nothing of theirs is sent on, whichever conversation is picked.
    expect(held.forwarding).toEqual(['$friends'])
  })

  it('closes the forward picker when only the blocked account’s messages were waiting in it', () => {
    // A picker with nothing left to send is a gesture with nothing to do.
    const { held, screen } = screenWith({
      forwarding: ['$theirs-1', '$theirs-2'],
    })

    takeWhatTheBlockTakes(
      screen,
      { scope: '!three-of-us:x', other: null },
      [row('!three-of-us:x', null)],
      new Set([BLOCKED]),
      THREE_OF_US,
    )

    expect(held.forwarding).toBeNull()
  })

  it('closes what shows the blocked account there: its photograph full screen, and a sheet about it', () => {
    const { held, screen } = screenWith()

    takeWhatTheBlockTakes(
      screen,
      { scope: '!three-of-us:x', other: null },
      [row('!three-of-us:x', null)],
      new Set([BLOCKED]),
      THREE_OF_US,
    )

    expect(held).toMatchObject({
      open: '!three-of-us:x',
      openPlate: null,
      reporting: null,
      blockingSender: null,
    })
  })

  it('leaves standing what shows somebody else', () => {
    const friends = plateOf(said('$their-photo', FRIEND))
    const report = reportOn(FRIEND, ['$friends'])
    const { held, screen } = screenWith({
      selected: new Set(['$friends']),
      forwarding: ['$friends', '$mine'],
      openPlate: friends,
      reporting: report,
      blockingSender: { scope: '!three-of-us:x', other: FRIEND },
    })
    const before = { ...held }

    takeWhatTheBlockTakes(
      screen,
      { scope: '!three-of-us:x', other: null },
      [row('!three-of-us:x', null)],
      new Set([BLOCKED]),
      THREE_OF_US,
    )

    // The very same values: nothing drawn again for nothing.
    expect(held.selected).toBe(before.selected)
    expect(held.forwarding).toBe(before.forwarding)
    expect(held.openPlate).toBe(friends)
    expect(held.reporting).toBe(report)
    expect(held.blockingSender).toBe(before.blockingSender)
  })
})

describe('what becomes known of the conversation open (#498)', () => {
  it('closes a conversation of two whose members were not known when the block arrived, as soon as they are', () => {
    // Opened before anything said who is in it: no row yet, and the other
    // person not found. The block cannot say, and the conversation stays
    // open meanwhile.
    const { held, screen } = screenWith({ open: '!with-them:x' })
    const blocked = new Set([BLOCKED])

    expect(
      takeWhatTheBlockTakes(
        screen,
        { scope: '!with-them:x', other: null },
        [],
        blocked,
        [said('$theirs-1', BLOCKED)],
      ),
    ).toBe('not known')
    expect(held.open).toBe('!with-them:x')

    // Then its other person is found: it was the conversation with them.
    lookAgain(screen, { scope: '!with-them:x', other: BLOCKED }, [], blocked)

    expect(held).toMatchObject({ open: null, ...NOTHING_OVER })
  })

  it('closes it too when it is the list that learns who is in it', () => {
    const { held, screen } = screenWith({ open: '!with-them:x' })
    const blocked = new Set([BLOCKED])
    const open = { scope: '!with-them:x', other: null }

    lookAgain(
      screen,
      open,
      [row('!with-them:x', null, { others: null })],
      blocked,
    )
    expect(held.open).toBe('!with-them:x')

    lookAgain(screen, open, [row('!with-them:x', BLOCKED)], blocked)
    expect(held.open).toBeNull()
  })

  it('closes a conversation this account is now alone in, once its row says the blocked account was the one who left', () => {
    const { held, screen } = screenWith({ open: '!they-left:x' })
    const blocked = new Set([BLOCKED])
    const open = { scope: '!they-left:x', other: null }

    lookAgain(
      screen,
      open,
      [row('!they-left:x', null, { others: 0, membershipsUnread: true })],
      blocked,
    )
    expect(held.open).toBe('!they-left:x')

    lookAgain(
      screen,
      open,
      [row('!they-left:x', null, { others: 0, departed: BLOCKED })],
      blocked,
    )
    expect(held.open).toBeNull()
  })

  it('keeps open a conversation of more than two, and one with somebody else, whatever becomes known', () => {
    const blocked = new Set([BLOCKED])
    const three = screenWith()
    lookAgain(
      three.screen,
      { scope: '!three-of-us:x', other: null },
      [row('!three-of-us:x', null)],
      blocked,
    )
    const friend = screenWith({ open: '!with-a-friend:x' })
    lookAgain(
      friend.screen,
      { scope: '!with-a-friend:x', other: FRIEND },
      [row('!with-a-friend:x', FRIEND)],
      blocked,
    )

    expect(three.held.open).toBe('!three-of-us:x')
    expect(three.held.selected).toEqual(new Set(['$theirs-1']))
    expect(friend.held.open).toBe('!with-a-friend:x')
  })

  it('does nothing while no conversation is open', () => {
    const { held, screen } = screenWith({ open: null })

    lookAgain(screen, null, [row('!with-them:x', BLOCKED)], new Set([BLOCKED]))

    expect(held.personOpen).toBe(true)
  })
})
