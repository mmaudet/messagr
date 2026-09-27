import { describe, expect, it } from 'vitest'

import type { Answer } from './discovery'
import {
  deliverInvitation,
  letInTheJoined,
  STOP_ASKING_AFTER_DEADLINE_MS,
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
  } = {},
) {
  const calls: Call[] = []
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
    send: async body => {
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
  }
  return { http, service, calls, sent }
}

/** The page of the notebook, as a map. */
function thePage(invitations: readonly SentInvitation[]) {
  const page = new Map(invitations.map(i => [i.invitationId, i]))
  const sent: SentInvitations = {
    all: async () => [...page.values()],
    remember: async one => {
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
}

describe('delivering an invitation to a contact found (#404)', () => {
  it('creates the conversation as for a link, then sends the reference and nothing else', async () => {
    const { http, service, calls, sent } = harness()

    const delivered = await deliverInvitation({ http, service }, 'ref-paul')

    expect(delivered).toEqual({
      delivered: true,
      scope: '!made:x',
      invitationId: 'inv-1',
      expiresAt: 1_790_604_800_000,
    })
    expect(calls[0]?.path).toBe('/_matrix/client/v3/createRoom')
    // The rules of a link's conversation: the cost of inviting, and
    // encryption, among what is written before the invitation leaves.
    expect(
      calls.some(
        c => c.method === 'PUT' && c.path.endsWith('/m.room.encryption'),
      ),
    ).toBe(true)
    expect(sent).toEqual([JSON.stringify({ reference: 'ref-paul' })])
    expect(sent.join()).not.toContain('!made:x')
  })

  it('sends nothing when the conversation could not be created', async () => {
    const { http, service, sent } = harness({ createRoom: new Error('down') })

    const delivered = await deliverInvitation({ http, service }, 'ref-paul')

    expect(delivered.delivered).toBe(false)
    expect(sent).toEqual([])
  })

  it('says what the service refused, and which conversation it leaves', async () => {
    const { http, service } = harness({
      send: {
        status: 422,
        body: JSON.stringify({ errcode: 'MESSAGR_OWN_REFERENCE' }),
      },
    })

    expect(await deliverInvitation({ http, service }, 'ref-me')).toEqual({
      delivered: false,
      scope: '!made:x',
      reason: 'the invitation service refused it: MESSAGR_OWN_REFERENCE',
    })
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
          name: async (who, name) => {
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

    expect(await run()).toEqual(['@bob:x'])

    const invite = calls.find(c => c.path.endsWith('/invite'))
    expect(invite?.path).toBe('/_matrix/client/v3/rooms/!room%3Ax/invite')
    expect(invite?.body).toBe(JSON.stringify({ user_id: '@bob:x' }))
    expect(named).toEqual([['@bob:x', 'Paul']])
    expect(page.size).toBe(0)
  })

  it('asks again at the next tick while nobody has joined', async () => {
    const { run, calls, page } = letting([SENT])

    expect(await run()).toEqual([])

    expect(calls.some(c => c.path.endsWith('/invite'))).toBe(false)
    expect(page.size).toBe(1)
  })

  it('does not invite an account already in the conversation, and forgets the invitation all the same', async () => {
    const { run, calls, page } = letting([SENT], {
      status: { 'inv-1': claimed('@bob:x') },
      there: { '!room:x': ['@bob:x'] },
    })

    expect(await run()).toEqual(['@bob:x'])

    expect(calls.some(c => c.path.endsWith('/invite'))).toBe(false)
    expect(page.size).toBe(0)
  })

  it('keeps the invitation when the invite fails, for the next tick', async () => {
    const { run, page } = letting([SENT], {
      status: { 'inv-1': claimed('@bob:x') },
      refuseInvite: true,
    })

    expect(await run()).toEqual([])
    expect(page.size).toBe(1)
  })

  it('forgets an invitation run out, or one the service no longer knows', async () => {
    const ranOut = { ...SENT, invitationId: 'ran-out' }
    const unknown = { ...SENT, invitationId: 'unknown' }
    const { run, page } = letting([ranOut, unknown], {
      status: {
        'ran-out': { status: 200, body: '{"status":"expired"}' },
        unknown: { status: 404, body: '{"errcode":"M_NOT_FOUND"}' },
      },
    })

    expect(await run()).toEqual([])
    expect(page.size).toBe(0)
  })

  it('keeps an invitation the service could not answer about', async () => {
    const { run, page } = letting([SENT], {
      status: { 'inv-1': new Error('unreachable') },
    })

    expect(await run()).toEqual([])
    expect(page.size).toBe(1)
  })

  it('stops asking thirty days after the deadline, when the service has forgotten it too', async () => {
    const { run, calls, page } = letting(
      [SENT],
      {},
      SENT.expiresAt + STOP_ASKING_AFTER_DEADLINE_MS + 1,
    )

    expect(await run()).toEqual([])
    expect(page.size).toBe(0)
    expect(calls).toEqual([])
  })
})
