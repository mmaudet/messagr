import { describe, expect, it } from 'vitest'

import type { Answer } from './discovery'
import {
  declineDelivered,
  deliverInvitation,
  joinDelivered,
  KEPT_AFTER_DEADLINE_MS,
  keptThisLaunchToo,
  letInTheJoined,
  readTheWaiting,
  sayEntered,
  type DeliveryService,
  type SentInvitation,
  type SentInvitations,
} from './deliveredInvitations'
import type { HttpRequester } from './pump'

interface Call {
  readonly method: string
  readonly path: string
  readonly body: string | undefined
}

/**
 * A homeserver that creates conversations and says who is in them, and a
 * service that takes invitations and says where each stands. Either refuses
 * on request, for what this module does when one says no halfway through.
 */
function harness(
  options: {
    createRoom?: string | Error
    send?: Answer | Error
    /** What the service says of each invitation sent, by id. */
    status?: Readonly<Record<string, Answer | Error>>
    /** Who is already invited or in each conversation. */
    there?: Readonly<Record<string, readonly string[]>>
    refuseInvite?: boolean
    /** What `GET /discovery/invitations` answers. */
    waiting?: Answer | Error
    /** What joining or declining answers. */
    answer?: Answer | Error
    /** What saying a conversation was entered answers. */
    entered?: Answer | Error
  } = {},
) {
  const calls: Call[] = []
  const answered: string[] = []
  const http: HttpRequester = {
    authedRequest: async (method, path, _query, body) => {
      calls.push({ method, path, body })
      if (path.endsWith('/createRoom')) {
        if (options.createRoom instanceof Error) throw options.createRoom
        return options.createRoom ?? JSON.stringify({ room_id: '!made:x' })
      }
      if (method === 'GET' && path.endsWith('/m.room.power_levels')) {
        return JSON.stringify({ users: { '@me:x': 100 } })
      }
      const member = path.match(/rooms\/([^/]+)\/state\/m\.room\.member\/(.+)$/)
      if (method === 'GET' && member !== null) {
        const scope = decodeURIComponent(member[1]!)
        const who = decodeURIComponent(member[2]!)
        if ((options.there?.[scope] ?? []).includes(who)) {
          return JSON.stringify({ membership: 'join' })
        }
        throw new Error('M_NOT_FOUND')
      }
      if (path.endsWith('/invite')) {
        if (options.refuseInvite === true) throw new Error('forbidden')
        return '{}'
      }
      return '{}'
    },
  }
  const sent: string[] = []
  const service: DeliveryService = {
    sendInvitation: async body => {
      sent.push(body)
      if (options.send instanceof Error) throw options.send
      return (
        options.send ?? {
          status: 200,
          body: JSON.stringify({ id: 'inv-1', expires_at: 1_790_604_800 }),
        }
      )
    },
    sentStatus: async id => {
      const answer = options.status?.[id] ?? {
        status: 200,
        body: '{"status":"pending"}',
      }
      if (answer instanceof Error) throw answer
      return answer
    },
    waitingInvitations: async () => {
      if (options.waiting instanceof Error) throw options.waiting
      return options.waiting ?? { status: 200, body: '{"invitations":[]}' }
    },
    joinInvitation: async id => {
      answered.push(`join ${id}`)
      if (options.answer instanceof Error) throw options.answer
      return (
        options.answer ?? {
          status: 200,
          body: JSON.stringify({ inviter_user_id: '@alice:x' }),
        }
      )
    },
    declineInvitation: async id => {
      answered.push(`decline ${id}`)
      if (options.answer instanceof Error) throw options.answer
      return options.answer ?? { status: 204, body: '' }
    },
    enteredInvitation: async id => {
      answered.push(`entered ${id}`)
      if (options.entered instanceof Error) throw options.entered
      return options.entered ?? { status: 204, body: '' }
    },
  }
  return { http, service, calls, sent, answered }
}

/** The page of the notebook, as a map; one that will not write, on request. */
function thePage(invitations: readonly SentInvitation[] = [], holds = true) {
  const page = new Map(invitations.map(i => [i.invitationId, i]))
  const sent: SentInvitations = {
    all: async () => [...page.values()],
    remember: async one => {
      if (!holds) return false
      page.set(one.invitationId, one)
      return true
    },
    forget: async id => page.delete(id),
  }
  return { sent, page }
}

const claimed = (entrant: string): Answer => ({
  status: 200,
  body: JSON.stringify({
    status: 'claimed',
    claimed_user_id: entrant,
    claimed_at: 1,
    entrant_user_id: entrant,
  }),
})

const NOW = 1_790_000_000_000
const SENT: SentInvitation = {
  invitationId: 'inv-1',
  scope: '!room:x',
  expiresAt: NOW + 7 * 86_400_000,
  given: 'Paul',
  expired: false,
}

describe('delivering an invitation to a match (#404)', () => {
  it('creates the conversation as for a link, sends the reference and nothing else, and keeps the invitation', async () => {
    const { http, service, calls, sent } = harness()
    const { sent: page, page: kept } = thePage()

    const delivered = await deliverInvitation(
      { http, service, sent: page },
      'ref-paul',
      'Paul',
    )

    expect(delivered).toEqual({
      delivered: true,
      scope: '!made:x',
      invitationId: 'inv-1',
      expiresAt: 1_790_604_800_000,
      kept: true,
    })
    expect(calls[0]?.path).toBe('/_matrix/client/v3/createRoom')
    // The rules of a link's conversation, among what is written before the
    // invitation leaves: encryption, for one.
    expect(
      calls.some(
        c => c.method === 'PUT' && c.path.endsWith('/m.room.encryption'),
      ),
    ).toBe(true)
    expect(sent).toEqual([JSON.stringify({ reference: 'ref-paul' })])
    expect([...kept.values()]).toEqual([
      {
        invitationId: 'inv-1',
        scope: '!made:x',
        expiresAt: 1_790_604_800_000,
        given: 'Paul',
        expired: false,
      },
    ])
  })

  it('sends nothing when the conversation could not be created', async () => {
    const { http, service, sent } = harness({ createRoom: new Error('down') })

    const delivered = await deliverInvitation(
      { http, service, sent: thePage().sent },
      'ref-paul',
      null,
    )

    expect(delivered.delivered).toBe(false)
    expect(sent).toEqual([])
  })

  it('names what the service refused, and leaves the conversation nobody can enter', async () => {
    for (const [errcode, refusal] of [
      ['MESSAGR_OWN_REFERENCE', 'own-reference'],
      ['MESSAGR_UNKNOWN_REFERENCE', 'unknown-reference'],
      ['MESSAGR_NOT_FINDABLE', 'not-findable'],
    ] as const) {
      const { http, service, calls } = harness({
        send: { status: 422, body: JSON.stringify({ errcode }) },
      })
      const { sent: page, page: kept } = thePage()

      expect(
        await deliverInvitation({ http, service, sent: page }, 'ref', null),
      ).toEqual({
        delivered: false,
        reason: `the invitation service refused it: ${errcode}`,
        refusal,
      })
      expect(calls.at(-1)?.path).toBe(
        '/_matrix/client/v3/rooms/!made%3Ax/leave',
      )
      expect(kept.size).toBe(0)
    }
  })

  it('says when the page did not keep it', async () => {
    const { http, service } = harness()

    const delivered = await deliverInvitation(
      { http, service, sent: thePage([], false).sent },
      'ref-paul',
      'Paul',
    )

    expect(delivered).toMatchObject({ delivered: true, kept: false })
  })
})

describe('letting in whoever joined an invitation sent (#404)', () => {
  function letting(
    invitations: readonly SentInvitation[],
    options: Parameters<typeof harness>[0] = {},
    now = NOW,
  ) {
    const { http, service, calls } = harness(options)
    const { sent, page } = thePage(invitations)
    const named: [string, string][] = []
    return {
      page,
      calls,
      named,
      run: () =>
        letInTheJoined({
          sent,
          service,
          http,
          giveName: async (who, name) => {
            named.push([who, name])
          },
          now: () => now,
        }),
    }
  }

  it('invites the account the service names once it joined, and gives it the name typed for it', async () => {
    const { run, calls, named, page } = letting([SENT], {
      status: { 'inv-1': claimed('@bob:x') },
    })

    expect(await run()).toEqual({ admitted: ['@bob:x'], failed: [] })

    const invite = calls.find(c => c.path.endsWith('/invite'))
    expect(invite?.path).toBe('/_matrix/client/v3/rooms/!room%3Ax/invite')
    expect(invite?.body).toBe(JSON.stringify({ user_id: '@bob:x' }))
    expect(named).toEqual([['@bob:x', 'Paul']])
    expect(page.size).toBe(0)
  })

  it('gives no name when none was typed', async () => {
    const { run, named } = letting([{ ...SENT, given: null }], {
      status: { 'inv-1': claimed('@bob:x') },
    })

    expect((await run()).admitted).toEqual(['@bob:x'])
    expect(named).toEqual([])
  })

  it('lets in an invitation joined in time, however late it is read', async () => {
    const { run } = letting(
      [SENT],
      { status: { 'inv-1': claimed('@bob:x') } },
      SENT.expiresAt + 20 * 86_400_000,
    )

    expect((await run()).admitted).toEqual(['@bob:x'])
  })

  it('asks again at the next tick while nobody has joined', async () => {
    const { run, calls, page } = letting([SENT])

    expect(await run()).toEqual({ admitted: [], failed: [] })

    expect(calls.some(c => c.path.endsWith('/invite'))).toBe(false)
    expect(page.size).toBe(1)
  })

  it('does not invite an account already in the conversation, and forgets the invitation all the same', async () => {
    const { run, calls, page } = letting([SENT], {
      status: { 'inv-1': claimed('@bob:x') },
      there: { '!room:x': ['@bob:x'] },
    })

    expect((await run()).admitted).toEqual(['@bob:x'])

    expect(calls.some(c => c.path.endsWith('/invite'))).toBe(false)
    expect(page.size).toBe(0)
  })

  it('keeps the invitation when the invite fails, and says why', async () => {
    const { run, page } = letting([SENT], {
      status: { 'inv-1': claimed('@bob:x') },
      refuseInvite: true,
    })

    expect(await run()).toEqual({
      admitted: [],
      failed: [{ invitationId: 'inv-1', reason: 'forbidden' }],
    })
    expect(page.size).toBe(1)
  })

  it('keeps an invitation run out as expired, for the list, and asks no more about it', async () => {
    const { run, page, calls } = letting([SENT], {
      status: { 'inv-1': { status: 200, body: '{"status":"expired"}' } },
    })

    await run()
    expect(page.get('inv-1')).toEqual({ ...SENT, expired: true })

    const asked = calls.length
    await run()
    expect(calls.length).toBe(asked)
  })

  it('forgets one the service no longer knows, and not for any other 404', async () => {
    const unknown = { ...SENT, invitationId: 'unknown' }
    const proxied = { ...SENT, invitationId: 'proxied' }
    const { run, page } = letting([unknown, proxied], {
      status: {
        unknown: { status: 404, body: '{"errcode":"M_NOT_FOUND"}' },
        proxied: { status: 404, body: '<html>Not Found</html>' },
      },
    })

    await run()
    expect([...page.keys()]).toEqual(['proxied'])
  })

  it('keeps an invitation the service could not answer about', async () => {
    const { run, page } = letting([SENT], {
      status: { 'inv-1': new Error('unreachable') },
    })

    expect((await run()).admitted).toEqual([])
    expect(page.size).toBe(1)
  })

  it('forgets it thirty days after the deadline, when the service has forgotten it too', async () => {
    const { run, calls, page } = letting(
      [SENT],
      {},
      SENT.expiresAt + KEPT_AFTER_DEADLINE_MS + 1,
    )

    expect((await run()).admitted).toEqual([])
    expect(page.size).toBe(0)
    expect(calls).toEqual([])
  })

  it('runs one round at a time', async () => {
    let answer = () => {}
    const { http, service } = harness()
    const slow: DeliveryService = {
      ...service,
      sentStatus: id =>
        new Promise<void>(done => {
          answer = done
        }).then(() => service.sentStatus(id)),
    }
    const asking = {
      sent: thePage([SENT]).sent,
      service: slow,
      http,
      giveName: async () => undefined,
      now: () => NOW,
    }

    const first = letInTheJoined(asking)
    await Promise.resolve()
    expect(await letInTheJoined(asking)).toEqual({ admitted: [], failed: [] })
    answer()
    await first
  })
})

describe('what this launch sent besides the page (#404)', () => {
  it('lets the recipient in on this launch when the page did not keep the invitation', async () => {
    const { sent: broken } = thePage([], false)
    const both = keptThisLaunchToo(() => broken)

    expect(await both.remember(SENT)).toBe(false)
    expect(await both.all()).toEqual([SENT])
    await both.forget('inv-1')
    expect(await both.all()).toEqual([])
  })

  it('reads the page as it is at each call, once the notebook has opened', async () => {
    let current = thePage().sent
    const both = keptThisLaunchToo(() => current)
    current = thePage([SENT]).sent

    expect(await both.all()).toEqual([SENT])
  })
})

describe('the invitations waiting for this account (#404)', () => {
  it('reads those to answer, and those joined with their inviter, skipping what it cannot read', async () => {
    const { service } = harness({
      waiting: {
        status: 200,
        body: JSON.stringify({
          invitations: [
            { id: 'a', expires_at: 1_790_604_800 },
            { id: 'b', expires_at: 1_790_604_900, inviter_user_id: '@alice:x' },
            null,
            { id: 42, expires_at: 1 },
            { id: 'c', expires_at: 1_790_605_000, inviter_user_id: '@bob:x' },
          ],
        }),
      },
    })

    expect(await readTheWaiting(service)).toEqual({
      unanswered: [{ id: 'a', expiresAt: 1_790_604_800_000 }],
      joined: [
        { id: 'b', inviter: '@alice:x' },
        { id: 'c', inviter: '@bob:x' },
      ],
    })
  })

  it('says nothing it could not read, so the list keeps what it showed', async () => {
    for (const waiting of [
      new Error('down'),
      { status: 502, body: 'Bad Gateway' },
    ]) {
      expect(await readTheWaiting(harness({ waiting }).service)).toBeNull()
    }
  })

  it('joins, and learns the inviter', async () => {
    const { service, answered } = harness()

    expect(await joinDelivered(service, 'a')).toEqual({ joined: '@alice:x' })
    expect(answered).toEqual(['join a'])
  })

  it('declines, and the service alone is told', async () => {
    const { service, answered } = harness()

    expect(await declineDelivered(service, 'a')).toBe('declined')
    expect(answered).toEqual(['decline a'])
  })

  it('says a conversation was entered, and hears whether the service took it', async () => {
    for (const [entered, heard] of [
      [{ status: 204, body: '' }, true],
      // Gone is heard as well: the invitation is off the list either way.
      [{ status: 404, body: JSON.stringify({ errcode: 'M_NOT_FOUND' }) }, true],
      [{ status: 502, body: 'Bad Gateway' }, false],
      [new Error('down'), false],
    ] as const) {
      const { service, answered } = harness({ entered })
      expect(await sayEntered(service, 'b')).toBe(heard)
      expect(answered).toEqual(['entered b'])
    }
  })

  it('says an invitation ran out, is gone, or could not be answered', async () => {
    for (const [answer, said] of [
      [
        {
          status: 410,
          body: JSON.stringify({ errcode: 'MESSAGR_INVITATION_EXPIRED' }),
        },
        'expired',
      ],
      [
        { status: 404, body: JSON.stringify({ errcode: 'M_NOT_FOUND' }) },
        'gone',
      ],
      [{ status: 502, body: 'Bad Gateway' }, 'unreachable'],
      [new Error('down'), 'unreachable'],
    ] as const) {
      const { service } = harness({ answer })
      expect(await joinDelivered(service, 'a')).toBe(said)
      expect(await declineDelivered(service, 'a')).toBe(said)
    }
  })
})
