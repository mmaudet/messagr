import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { blockable } from '../timeline/selection'
import {
  blockAccount,
  callsWithoutTheBlocked,
  ignoredInSync,
  keptWithoutTheBlocked,
  mayCall,
  noticeOf,
  readIgnored,
  sameAccounts,
  tellWhatIsWaiting,
  type Blocking,
} from './block'
import type { CallRecord } from './callLogStore'
import {
  isOpenWithTheBlocked,
  listWithoutTheBlocked,
  type ConversationSummary,
} from './conversationList'
import { shownOf } from './notShown'
import { PumpHttpError, type HttpRequester } from './pump'
import type { KeptMessage } from './readFavourites'
import type { UntoldBlocks } from './untoldBlocksStore'

const ME = '@me:example.org'
const BLOCKED = '@bothers:example.org'
const FRIEND = '@friend:example.org'
/** Where Matrix keeps this account's ignored list. */
const LIST_PATH =
  '/_matrix/client/v3/user/%40me%3Aexample.org/account_data/m.ignored_user_list'

/**
 * The homeserver's account data, reduced to the one entry this gesture
 * reads and writes. `held` is what it holds, `undefined` for a list the
 * account never had, which the specification answers 404 `M_NOT_FOUND`.
 */
function homeserver(
  held: Record<string, unknown> | undefined,
  fails: {
    /** `a 404 without its code`: a proxy's, say, and not the specification's. */
    readonly read?: boolean | 'a 404 without its code'
    readonly write?: boolean
  } = {},
  log: string[] = [],
) {
  const state = { held, writes: [] as unknown[] }
  const http: HttpRequester = {
    authedRequest: async (method, path, _query, body) => {
      if (path !== LIST_PATH) throw new Error(`unexpected ${method} ${path}`)
      if (method === 'GET') {
        log.push('read')
        if (fails.read === 'a 404 without its code') {
          throw new PumpHttpError('Not Found', 404)
        }
        if (fails.read === true) {
          throw new PumpHttpError('the homeserver is unwell', 502)
        }
        if (state.held === undefined) {
          throw new PumpHttpError('no such account data', 404, 'M_NOT_FOUND')
        }
        return JSON.stringify(state.held)
      }
      if (method === 'PUT') {
        if (fails.write === true) {
          throw new PumpHttpError('the homeserver is unwell', 502)
        }
        const written = JSON.parse(body ?? 'null') as Record<string, unknown>
        state.writes.push(written)
        state.held = written
        log.push('written')
        return '{}'
      }
      throw new Error(`unexpected ${method}`)
    },
  }
  return { http, state }
}

/** The notebook's page of blocks the service has not heard of, in memory. */
function untoldPage(
  { keeps = true }: { readonly keeps?: boolean } = {},
  log: string[] = [],
) {
  const held = new Set<string>()
  const page: UntoldBlocks = {
    all: async () => [...held],
    remember: async account => {
      log.push('kept')
      if (!keeps) return false
      held.add(account)
      return true
    },
    forget: async account => {
      held.delete(account)
      return true
    },
  }
  return { page, held }
}

/** A gesture, with every double it talks to and the order it did things in. */
function gesture(
  options: {
    readonly held?: Record<string, unknown> | undefined
    readonly readFails?: boolean | 'a 404 without its code'
    readonly writeFails?: boolean
    readonly service?: (blocked: string) => Promise<number>
    readonly keeps?: boolean
    readonly deadline?: () => Promise<void>
  } = {},
) {
  const log: string[] = []
  const server = homeserver(
    'held' in options ? options.held : { ignored_users: {} },
    { read: options.readFails, write: options.writeFails },
    log,
  )
  const untold = untoldPage({ keeps: options.keeps }, log)
  const shown: ReadonlySet<string>[] = []
  const told: string[] = []
  const deps: Blocking = {
    http: server.http,
    selfUserId: ME,
    nowIgnored: ignored => {
      log.push('shown')
      shown.push(ignored)
    },
    untold: untold.page,
    tellTheService: async blocked => {
      log.push('told')
      told.push(blocked)
      return (options.service ?? (async () => 204))(blocked)
    },
    after: options.deadline ?? (() => new Promise<void>(() => undefined)),
  }
  return { deps, log, server, untold, shown, told }
}

/**
 * Lets every promise that can settle now settle: the doubles answer within
 * the same turn, so one turn of the event loop is enough.
 */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

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

function said(eventId: string, sender: string): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt: 1, body: eventId }
}

describe('blocking an account from the panel of the person', () => {
  it('adds the account to the ignored list, keeping every entry it had', async () => {
    const g = gesture({
      held: {
        ignored_users: { [FRIEND]: {}, '@other:x': { kept: 'as it was' } },
        written_by_another_client: true,
      },
    })

    await blockAccount(g.deps, BLOCKED)

    expect(g.server.state.writes).toEqual([
      {
        ignored_users: {
          [FRIEND]: {},
          '@other:x': { kept: 'as it was' },
          [BLOCKED]: {},
        },
        written_by_another_client: true,
      },
    ])
  })

  it('starts the list when the account never had one', async () => {
    const g = gesture({ held: undefined })

    await blockAccount(g.deps, BLOCKED)

    expect(g.server.state.writes).toEqual([
      { ignored_users: { [BLOCKED]: {} } },
    ])
  })

  it('writes nothing when the account is ignored already, and goes on', async () => {
    // Blocked from another device of the account, whose service call is its
    // own: this one still hides and tells.
    const g = gesture({ held: { ignored_users: { [BLOCKED]: {} } } })

    const outcome = await blockAccount(g.deps, BLOCKED)

    expect(g.server.state.writes).toEqual([])
    expect(outcome).toEqual({ blocked: true, told: true })
    expect([...(g.shown[0] ?? [])]).toEqual([BLOCKED])
  })

  it('takes the conversation and every message of the blocked account off the screens at once', async () => {
    // The service does not answer: nothing on the screen waits for it.
    const g = gesture({ service: () => new Promise<number>(() => undefined) })
    const list = [
      row('!with-them:x', BLOCKED),
      row('!with-a-friend:x', FRIEND),
      row('!three-of-us:x', null),
    ]
    const received = [
      said('$theirs-1', BLOCKED),
      said('$mine', ME),
      said('$theirs-2', BLOCKED),
      said('$friends', FRIEND),
    ]

    // Started and never awaited: it waits on the service for good.
    const pending = blockAccount(g.deps, BLOCKED)
    await settled()
    expect(pending).toBeInstanceOf(Promise)

    expect(g.log).toEqual(['read', 'written', 'shown', 'kept', 'told'])
    const shown = g.shown[0] ?? new Set<string>()
    // In the order the list draws: most recent first, then by identifier.
    expect(listWithoutTheBlocked(list, shown).map(one => one.scope)).toEqual([
      '!three-of-us:x',
      '!with-a-friend:x',
    ])
    expect(
      shownOf(received, { hidden: new Set(), blocked: shown }).map(
        one => one.eventId,
      ),
    ).toEqual(['$mine', '$friends'])
  })

  it('forgets the block once the service has heard it', async () => {
    const g = gesture()

    const outcome = await blockAccount(g.deps, BLOCKED)

    expect(outcome).toEqual({ blocked: true, told: true })
    expect(g.told).toEqual([BLOCKED])
    expect([...g.untold.held]).toEqual([])
  })

  it('changes nothing, and says so, when the list cannot be written', async () => {
    const g = gesture({ writeFails: true })

    const outcome = await blockAccount(g.deps, BLOCKED)

    expect(outcome.blocked).toBe(false)
    expect(g.shown).toEqual([])
    expect(g.told).toEqual([])
    expect([...g.untold.held]).toEqual([])
  })

  it('changes nothing when the list cannot be read', async () => {
    // A list read wrong and written back would lose somebody else's block.
    // Nor does a 404 without `M_NOT_FOUND` say there is no list: a proxy's
    // 404 taken for an empty list would be written over the one there is.
    for (const readFails of [true, 'a 404 without its code'] as const) {
      const g = gesture({
        held: { ignored_users: { [FRIEND]: {} } },
        readFails,
      })

      const outcome = await blockAccount(g.deps, BLOCKED)

      expect(outcome.blocked).toBe(false)
      expect(g.server.state.writes).toEqual([])
      expect(g.shown).toEqual([])
      expect(g.told).toEqual([])
    }
  })

  it('says what waits when only the service fails, then tells it at the next launch', async () => {
    const g = gesture({ service: async () => 503 })

    const outcome = await blockAccount(g.deps, BLOCKED)

    expect(outcome).toEqual({ blocked: true, told: false, kept: true })
    expect(g.shown).toHaveLength(1)
    expect([...g.untold.held]).toEqual([BLOCKED])

    // The next launch, with the service back.
    const heard: string[] = []
    const round = await tellWhatIsWaiting({
      untold: g.untold.page,
      tellTheService: async blocked => {
        heard.push(blocked)
        return 204
      },
    })
    expect(round).toEqual({ told: 1, waiting: 0 })
    expect(heard).toEqual([BLOCKED])
    expect([...g.untold.held]).toEqual([])
    // And the one after asks nothing.
    const after = await tellWhatIsWaiting({
      untold: g.untold.page,
      tellTheService: async blocked => {
        heard.push(blocked)
        return 204
      },
    })
    expect(after).toEqual({ told: 0, waiting: 0 })
    expect(heard).toEqual([BLOCKED])
  })

  it('asks again at each launch until the service has heard it', async () => {
    const g = gesture({
      service: async () => {
        throw new Error('nobody answered')
      },
    })
    await blockAccount(g.deps, BLOCKED)

    const answers = [500, 0, 204]
    const rounds = []
    for (const answer of answers) {
      rounds.push(
        await tellWhatIsWaiting({
          untold: g.untold.page,
          tellTheService: async () => {
            if (answer === 0) throw new Error('no network')
            return answer
          },
        }),
      )
    }

    expect(rounds).toEqual([
      { told: 0, waiting: 1 },
      { told: 0, waiting: 1 },
      { told: 1, waiting: 0 },
    ])
    expect([...g.untold.held]).toEqual([])
  })

  it('gives the service ten seconds, and a late yes still takes the block off the page', async () => {
    let answer: (status: number) => void = () => undefined
    let waited = 0
    const g = gesture({
      service: () =>
        new Promise<number>(resolve => {
          answer = resolve
        }),
      deadline: async () => {
        waited += 1
      },
    })

    const outcome = await blockAccount(g.deps, BLOCKED)
    expect(waited).toBe(1)
    expect(outcome).toEqual({ blocked: true, told: false, kept: true })

    answer(204)
    await settled()
    expect([...g.untold.held]).toEqual([])
  })

  it('says on the list what is done and what waits', () => {
    // At once, the block; then what the service answered.
    expect(noticeOf({ blocked: true, told: true })).toBe('blocked')
    expect(noticeOf({ blocked: true, told: false, kept: true })).toBe('waiting')
    expect(noticeOf({ blocked: true, told: false, kept: false })).toBe(
      'not-kept',
    )
    // Nothing changed: nothing to say on the list, the panel says it.
    expect(noticeOf({ blocked: false, reason: 'refused' })).toBeNull()
  })

  it('says so when this device could not keep what waits', async () => {
    const g = gesture({ service: async () => 503, keeps: false })

    expect(await blockAccount(g.deps, BLOCKED)).toEqual({
      blocked: true,
      told: false,
      kept: false,
    })
  })
})

describe('the list and the conversations, derived from the homeserver’s ignored list', () => {
  it('reads the list the homeserver keeps, and an empty one only when it has none', async () => {
    const kept = homeserver({ ignored_users: { [BLOCKED]: {}, [FRIEND]: {} } })
    expect([...(await readIgnored(kept.http, ME))].sort()).toEqual([
      BLOCKED,
      FRIEND,
    ])
    const none = homeserver(undefined)
    expect([...(await readIgnored(none.http, ME))]).toEqual([])
    // Anything but `M_NOT_FOUND` is not knowing, which is not the same as
    // nobody: a 404 without its code included.
    const bare = homeserver(
      { ignored_users: {} },
      { read: 'a 404 without its code' },
    )
    await expect(readIgnored(bare.http, ME)).rejects.toThrow()
    const unwell = homeserver({ ignored_users: {} }, { read: true })
    await expect(readIgnored(unwell.http, ME)).rejects.toThrow()
  })

  it('reads the list a sync carries in the account data, and nothing when it carries none', () => {
    const carrying = (content: unknown) => ({
      next_batch: 's_2',
      account_data: {
        events: [
          { type: 'm.push_rules', content: {} },
          { type: 'm.ignored_user_list', content },
        ],
      },
    })

    expect([
      ...(ignoredInSync(carrying({ ignored_users: { [BLOCKED]: {} } })) ?? []),
    ]).toEqual([BLOCKED])
    // A list emptied from another device or another client: it is there, and
    // it names nobody.
    expect([
      ...(ignoredInSync(carrying({ ignored_users: {} })) ?? ['?']),
    ]).toEqual([])
    // Nothing said of it: what this device holds stands.
    expect(ignoredInSync({ next_batch: 's_2' })).toBeNull()
    expect(
      ignoredInSync({ account_data: { events: [{ type: 'm.push_rules' }] } }),
    ).toBeNull()
    expect(ignoredInSync({ account_data: 'strange' })).toBeNull()
  })

  it('hides the conversation on another device of the account, from the list its sync carries', () => {
    // That device made no gesture: all it has is the sync.
    const sync = {
      account_data: {
        events: [
          {
            type: 'm.ignored_user_list',
            content: { ignored_users: { [BLOCKED]: {} } },
          },
        ],
      },
    }
    const list = [row('!with-them:x', BLOCKED), row('!with-a-friend:x', FRIEND)]

    const blocked = ignoredInSync(sync) ?? new Set<string>()

    expect(listWithoutTheBlocked(list, blocked).map(one => one.scope)).toEqual([
      '!with-a-friend:x',
    ])
    expect(
      shownOf([said('$theirs', BLOCKED), said('$mine', ME)], {
        hidden: new Set(),
        blocked,
      }).map(one => one.eventId),
    ).toEqual(['$mine'])
  })

  it('closes the conversation open with the blocked account on that other device, and keeps one of more than two open (#494)', () => {
    // Left open, what is written in it would still leave: it closes, as the
    // conversation blocked from does, when the list its sync carries arrives.
    const sync = {
      account_data: {
        events: [
          {
            type: 'm.ignored_user_list',
            content: { ignored_users: { [BLOCKED]: {} } },
          },
        ],
      },
    }
    const list = [row('!with-them:x', BLOCKED), row('!three-of-us:x', null)]

    const blocked = ignoredInSync(sync) ?? new Set<string>()

    expect(
      isOpenWithTheBlocked(
        { scope: '!with-them:x', other: BLOCKED },
        list,
        blocked,
      ),
    ).toBe(true)
    expect(
      isOpenWithTheBlocked(
        { scope: '!three-of-us:x', other: null },
        list,
        blocked,
      ),
    ).toBe(false)
  })

  it('keeps a conversation hidden once the blocked account has left it', () => {
    // Its row then names nobody on the other side, only who left.
    const list = [
      row('!with-them:x', null, { others: 0, departed: BLOCKED }),
      row('!with-a-friend-gone:x', null, { others: 0, departed: FRIEND }),
    ]

    expect(
      listWithoutTheBlocked(list, new Set([BLOCKED])).map(one => one.scope),
    ).toEqual(['!with-a-friend-gone:x'])
  })

  it('takes the blocked account’s kept messages off the screen that lists them', () => {
    const kept = (
      eventId: string,
      entry: TimelineEntry | null,
    ): KeptMessage => ({
      favourite: { eventId, scope: '!a:x', at: 1 },
      entry,
    })
    const favourites = [
      kept('$theirs', said('$theirs', BLOCKED)),
      kept('$mine', said('$mine', ME)),
      kept('$gone', null),
    ]

    expect(
      keptWithoutTheBlocked(favourites, new Set([BLOCKED])).map(
        one => one.favourite.eventId,
      ),
    ).toEqual(['$mine', '$gone'])
    expect(keptWithoutTheBlocked(favourites, new Set())).toBe(favourites)
  })

  it('tells two lists apart only by who is in them', () => {
    expect(
      sameAccounts(new Set([BLOCKED, FRIEND]), new Set([FRIEND, BLOCKED])),
    ).toBe(true)
    expect(sameAccounts(new Set([BLOCKED]), new Set([BLOCKED, FRIEND]))).toBe(
      false,
    )
    expect(sameAccounts(new Set([BLOCKED]), null)).toBe(false)
  })
})

describe('blocking the author of a selection (#472)', () => {
  // The same gesture as the panel of the person, from « Bloquer
  // l’expéditeur »: the account is the one the selection names.
  const received = [
    said('$theirs-1', BLOCKED),
    said('$friends', FRIEND),
    said('$mine', ME),
    said('$theirs-2', BLOCKED),
  ]

  it('blocks the one other participant every message chosen comes from', async () => {
    const g = gesture()
    const who = blockable(new Set(['$theirs-2', '$theirs-1']), received, ME)
    expect(who).toBe(BLOCKED)

    const outcome = await blockAccount(g.deps, who ?? '')

    expect(outcome).toEqual({ blocked: true, told: true })
    expect(g.server.state.writes).toEqual([
      { ignored_users: { [BLOCKED]: {} } },
    ])
    expect(g.told).toEqual([BLOCKED])
  })

  it('keeps a conversation of more than two in the list and open, and takes only the blocked account’s messages off it', async () => {
    // The conversation of three the App Store reviewer is in, where the
    // panel of the person does not exist and the selection is the only way.
    const g = gesture()
    const list = [row('!three-of-us:x', null), row('!with-them:x', BLOCKED)]

    await blockAccount(
      g.deps,
      blockable(new Set(['$theirs-1']), received, ME) ?? '',
    )
    const shown = g.shown[0] ?? new Set<string>()

    expect(listWithoutTheBlocked(list, shown).map(one => one.scope)).toEqual([
      '!three-of-us:x',
    ])
    expect(
      isOpenWithTheBlocked(
        { scope: '!three-of-us:x', other: null },
        list,
        shown,
      ),
    ).toBe(false)
    expect(
      shownOf(received, { hidden: new Set(), blocked: shown }).map(
        one => one.eventId,
      ),
    ).toEqual(['$friends', '$mine'])
  })

  it('closes a conversation of two, as the panel of the person does', async () => {
    const g = gesture()
    const list = [row('!with-them:x', BLOCKED)]

    await blockAccount(
      g.deps,
      blockable(new Set(['$theirs-1']), received, ME) ?? '',
    )
    const shown = g.shown[0] ?? new Set<string>()

    expect(listWithoutTheBlocked(list, shown)).toEqual([])
    expect(
      isOpenWithTheBlocked(
        { scope: '!with-them:x', other: BLOCKED },
        list,
        shown,
      ),
    ).toBe(true)
  })
})

describe('the calls, once an account is blocked (#494)', () => {
  function call(
    peerUserId: string,
    at: number,
    extra: Partial<CallRecord> = {},
  ): CallRecord {
    return {
      scope: `!call-${at}:x`,
      peerUserId,
      at,
      direction: 'in',
      outcome: 'missed',
      ...extra,
    }
  }

  it('leaves the blocked account’s calls out of the calls tab, every other in its order', () => {
    // Which way they went and how they ended does not matter: the tab shows
    // no call of that account, so it offers no « Rappeler » for it either.
    const calls = [
      call(BLOCKED, 4),
      call(FRIEND, 3, { direction: 'out', outcome: 'answered', seconds: 42 }),
      call(BLOCKED, 2, { direction: 'out', outcome: 'unplaced' }),
      call(FRIEND, 1),
    ]

    expect(
      callsWithoutTheBlocked(calls, new Set([BLOCKED])).map(one => one.at),
    ).toEqual([3, 1])
    // Nobody blocked: the same list, handed back.
    expect(callsWithoutTheBlocked(calls, new Set())).toBe(calls)
  })

  it('never calls a blocked account, whatever the gesture', () => {
    // « Rappeler », a conversation's header: whatever is on the screen, the
    // call is not placed, and the blocked account's telephone never rings.
    expect(mayCall(BLOCKED, new Set([BLOCKED]))).toBe(false)
    expect(mayCall(FRIEND, new Set([BLOCKED]))).toBe(true)
    expect(mayCall(BLOCKED, new Set())).toBe(true)
  })
})
