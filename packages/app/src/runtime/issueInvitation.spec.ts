import { describe, expect, it, vi } from 'vitest'

import {
  admitDrawnEntrant,
  issueInvitation,
  type InvitationService,
  type IssuingDeps,
} from './issueInvitation'
import type { HttpRequester } from './pump'

interface Call {
  method: string
  path: string
  body: string | undefined
}

/**
 * A homeserver that creates conversations and remembers what state was
 * written to them, and a service that mints invitations. Both refuse on
 * request, because most of what this module has to get right is what it does
 * when one of the two says no halfway through.
 */
function harness(
  options: {
    createRoom?: string | Error
    powerLevels?: Record<string, unknown>
    refuseState?: boolean
    refuseInvite?: boolean
    refuseInviteWhen?: (who: string) => boolean
    issue?: { status: number; body: string } | Error
    status?: readonly ({ status: number; body: string } | Error)[]
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
        return JSON.stringify(
          options.powerLevels ?? { users: { '@me:x': 100 } },
        )
      }
      if (method === 'PUT') {
        if (options.refuseState === true) throw new Error('forbidden')
        return '{}'
      }
      if (path.endsWith('/invite')) {
        if (options.refuseInvite === true) throw new Error('forbidden')
        const who = (JSON.parse(body ?? '{}') as { user_id?: string }).user_id
        if (options.refuseInviteWhen?.(who ?? '') === true) {
          throw new Error('Event is not authorized')
        }
        return '{}'
      }
      return '{}'
    },
  }

  let asked = 0
  const service: InvitationService = {
    issue: async () => {
      if (options.issue instanceof Error) throw options.issue
      return (
        options.issue ?? {
          status: 200,
          body: JSON.stringify({ token: 'a-token', invitation_id: 'inv-1' }),
        }
      )
    },
    status: async () => {
      const scripted = options.status?.[asked] ?? {
        status: 200,
        body: JSON.stringify({}),
      }
      asked += 1
      if (scripted instanceof Error) throw scripted
      return scripted
    },
  }

  const deps: IssuingDeps = {
    http,
    service,
    newIdempotencyKey: () => 'key-1',
    wait: async () => {},
  }
  return { deps, calls, service }
}

describe('issueInvitation', () => {
  it('creates a conversation and hands back a link for it', async () => {
    const { deps } = harness()
    const issued = await issueInvitation(deps, 'messagr.eu')
    expect(issued).toEqual({
      issued: true,
      scope: '!made:x',
      invitationId: 'inv-1',
      link: 'https://messagr.eu/i/a-token',
    })
  })

  it('mints an https link, because a camera cannot read the other scheme', async () => {
    // THE ONE THAT WOULD HAVE CAUGHT IT. This minted `messagr://` for
    // months, and the QR code on the invitation screen encoded it: iOS's
    // camera and most Android scanners ignore an unknown scheme, so nothing
    // could read that picture -- not a camera, and not Messagr, which has no
    // scanner. Every test passed, because none of them looked at the scheme.
    //
    // `invitationLink.ts` accepts both and always said which was which. The
    // assertion belongs on the side that *writes* the link.
    const { deps } = harness()
    const issued = await issueInvitation(deps, 'messagr.eu')
    if (!issued.issued) throw new Error('expected an invitation')
    expect(issued.link.startsWith('https://')).toBe(true)
  })

  it('names the instance in the link, so nobody is asked which server', async () => {
    // The host is the account's own homeserver, and the https change did not
    // touch it: a link that named a fixed instance would be a link nobody on
    // any other one could claim.
    const { deps } = harness()
    const issued = await issueInvitation(deps, 'messagr-fork.example.org')
    if (!issued.issued) throw new Error('expected an invitation')
    expect(issued.link).toBe('https://messagr-fork.example.org/i/a-token')
  })

  it('costs 50 to invite into and admits members at 0', async () => {
    // The rule the invitation service reads rather than taking this
    // application's word for. `createRoom` leaves no `invite` key at all, and
    // the specification's default for a missing one is 0.
    const { deps, calls } = harness()
    await issueInvitation(deps, 'messagr.eu')
    const put = calls.find(
      call =>
        call.method === 'PUT' && call.path.endsWith('m.room.power_levels'),
    )
    expect(JSON.parse(put?.body ?? '{}')).toMatchObject({
      invite: 50,
      users_default: 0,
    })
  })

  it('keeps whatever else the homeserver put in the power levels', async () => {
    // A PUT replaces the whole event. Building one from scratch would drop
    // the creator's own level, and the account would lose its own room.
    const { deps, calls } = harness({
      powerLevels: { users: { '@me:x': 100 }, kick: 50, events: { a: 1 } },
    })
    await issueInvitation(deps, 'messagr.eu')
    const put = calls.find(
      call =>
        call.method === 'PUT' && call.path.endsWith('m.room.power_levels'),
    )
    expect(JSON.parse(put?.body ?? '{}')).toMatchObject({
      users: { '@me:x': 100 },
      kick: 50,
      events: { a: 1 },
    })
  })

  it('turns encryption on, which the presets do not', async () => {
    const { deps, calls } = harness()
    await issueInvitation(deps, 'messagr.eu')
    const put = calls.find(
      call => call.method === 'PUT' && call.path.endsWith('m.room.encryption'),
    )
    expect(JSON.parse(put?.body ?? '{}')).toEqual({
      algorithm: 'm.megolm.v1.aes-sha2',
    })
  })

  it('mints one single-use invitation, for the conversation it just made', async () => {
    const issue = vi.fn(async (_body: string, _key: string) => ({
      status: 200,
      body: JSON.stringify({ token: 'a-token', invitation_id: 'inv-1' }),
    }))
    const { deps } = harness()
    await issueInvitation({ ...deps, service: { ...deps.service, issue } }, 'x')
    expect(JSON.parse(issue.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      max_uses: 1,
      room_id: '!made:x',
    })
  })

  it('carries an idempotency key, so a retry does not draw a second pool', async () => {
    const issue = vi.fn(async (_body: string, _key: string) => ({
      status: 200,
      body: JSON.stringify({ token: 't', invitation_id: 'i' }),
    }))
    const { deps } = harness()
    await issueInvitation({ ...deps, service: { ...deps.service, issue } }, 'x')
    expect(issue.mock.calls[0]?.[1]).toBe('key-1')
  })

  it('says the conversation was not created, and names no conversation', async () => {
    const { deps } = harness({ createRoom: new Error('quota reached') })
    const issued = await issueInvitation(deps, 'messagr.eu')
    expect(issued.issued).toBe(false)
    if (!issued.issued) {
      expect(issued.reason).toContain('quota reached')
      expect(issued.scope).toBeUndefined()
    }
  })

  it('names the conversation it left behind when the rules were refused', async () => {
    // It exists on the homeserver whether or not this call finished. A person
    // seeing it appear with no explanation is worse than being told.
    const { deps } = harness({ refuseState: true })
    const issued = await issueInvitation(deps, 'messagr.eu')
    expect(issued.issued).toBe(false)
    if (!issued.issued) expect(issued.scope).toBe('!made:x')
  })

  it('names it too when the service refuses to mint', async () => {
    const { deps } = harness({ issue: { status: 403, body: '{}' } })
    const issued = await issueInvitation(deps, 'messagr.eu')
    expect(issued.issued).toBe(false)
    if (!issued.issued) expect(issued.scope).toBe('!made:x')
  })

  it('refuses an answer that is not the shape a minted invitation has', async () => {
    const { deps } = harness({
      issue: { status: 200, body: JSON.stringify({ token: 'only-a-token' }) },
    })
    const issued = await issueInvitation(deps, 'messagr.eu')
    expect(issued.issued).toBe(false)
  })
})

describe('what a conversation is created with', () => {
  it('asks for a room version whose creator is an ordinary member', async () => {
    // MEASURED. In version 12 the creator's power is implicit and infinite,
    // so no `redact` value can be put above it: set to 101 and accepted, the
    // creator still redacted the other person's message with a 200. In
    // version 11 the same experiment answers 403 in both directions, which
    // is the symmetry #196 asks for.
    const { deps, calls } = harness()
    await issueInvitation(deps, 'messagr.eu')
    const made = calls.find(call => call.path.endsWith('/createRoom'))
    expect(JSON.parse(made?.body ?? '{}')).toEqual({
      preset: 'private_chat',
      room_version: '11',
    })
  })

  it("puts redacting somebody else out of everybody's reach", async () => {
    const { deps, calls } = harness()
    await issueInvitation(deps, 'messagr.eu')
    const rules = calls.find(
      call =>
        call.method === 'PUT' && call.path.endsWith('/m.room.power_levels'),
    )
    const written = JSON.parse(rules?.body ?? '{}')
    // Above the 100 `createRoom` gives the creator, so nobody clears it.
    // What survives is Matrix's own rule: anybody may redact their own.
    expect(written.redact).toBe(101)
    expect(written.invite).toBe(50)
    expect(written.users_default).toBe(0)
  })

  it('keeps whatever else the homeserver put in the power levels', async () => {
    // A PUT replaces the whole event, so building one from scratch would
    // drop the server's own entries. The two the fork writes are here.
    const { deps, calls } = harness({
      powerLevels: {
        users: { '@me:x': 100 },
        events: { 'm.room.tombstone': 150 },
      },
    })
    await issueInvitation(deps, 'messagr.eu')
    const rules = calls.find(
      call =>
        call.method === 'PUT' && call.path.endsWith('/m.room.power_levels'),
    )
    expect(JSON.parse(rules?.body ?? '{}').events).toEqual({
      'm.room.tombstone': 150,
    })
  })
})

describe('admitDrawnEntrant', () => {
  const drawn = (who: string) => ({
    status: 200,
    body: JSON.stringify({ entrant_user_id: who }),
  })
  const nobody = { status: 200, body: JSON.stringify({}) }
  /** The invitation is spent: there is nobody left to let in. */
  const claimed = { status: 200, body: JSON.stringify({ status: 'claimed' }) }

  it('invites the account the service drew', async () => {
    const { deps, calls } = harness({ status: [drawn('@her:x')] })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission).toEqual({ admitted: true, entrants: ['@her:x'] })
    const invite = calls.find(call => call.path.endsWith('/invite'))
    expect(JSON.parse(invite?.body ?? '{}')).toEqual({ user_id: '@her:x' })
  })

  it('waits for somebody to open the link before there is anybody to invite', async () => {
    const { deps, calls } = harness({
      status: [nobody, nobody, drawn('@her:x')],
    })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission).toEqual({ admitted: true, entrants: ['@her:x'] })
    expect(calls.filter(call => call.path.endsWith('/invite'))).toHaveLength(1)
  })

  it('keeps asking after a poll that failed, because the link is unaffected', async () => {
    const { deps } = harness({
      status: [new Error('offline'), drawn('@her:x')],
    })
    expect(await admitDrawnEntrant(deps, 'inv-1', '!made:x')).toEqual({
      admitted: true,
      entrants: ['@her:x'],
    })
  })

  it('lets in the second person the service names, not only the first', async () => {
    // A LINK OPENED BY SOMEBODY WHO ALREADY HAS AN ACCOUNT NEEDS TWO
    // INVITES. The drawn account goes in first and tries to hand its place
    // over; the conversation costs 50 to invite into and it holds 0, so it
    // is refused -- « which is the designed state », in the service's own
    // words -- and names the real person instead. Only the issuer can let
    // that one in, and this used to have stopped asking by then.
    const { deps, calls } = harness({
      status: [drawn('@drawn:x'), drawn('@her:x'), claimed],
    })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission).toEqual({
      admitted: true,
      entrants: ['@drawn:x', '@her:x'],
    })
    expect(calls.filter(call => call.path.endsWith('/invite'))).toHaveLength(2)
  })

  it('does not invite the same person twice while the service keeps naming them', async () => {
    const { deps, calls } = harness({
      status: [drawn('@her:x'), drawn('@her:x'), drawn('@her:x')],
    })
    await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(calls.filter(call => call.path.endsWith('/invite'))).toHaveLength(1)
  })

  it('stops asking once the invitation is no longer pending', async () => {
    // Claimed, revoked or expired: the wait is over, and everything after it
    // would answer the same thing. Asserted by what does NOT happen -- the
    // third answer is never reached, so nobody is let in on it.
    const { deps, calls } = harness({
      status: [drawn('@her:x'), claimed, drawn('@late:x')],
    })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission).toEqual({ admitted: true, entrants: ['@her:x'] })
    const invited = calls
      .filter(call => call.path.endsWith('/invite'))
      .map(call => JSON.parse(call.body ?? '{}').user_id)
    expect(invited).toEqual(['@her:x'])
  })

  it('keeps waiting on an answer that does not say, rather than giving up', async () => {
    // A body with no `status` is a shape this code did not expect, not a
    // settled invitation. Stopping on it would strand whoever is on the
    // other side of the link.
    const { deps } = harness({ status: [nobody, nobody, drawn('@her:x')] })
    expect(await admitDrawnEntrant(deps, 'inv-1', '!made:x')).toEqual({
      admitted: true,
      entrants: ['@her:x'],
    })
  })

  it('gives up on a link nobody opened, which is the ordinary case', async () => {
    const { deps } = harness()
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission).toEqual({
      admitted: false,
      reason: 'nobody has opened the link yet',
    })
  })

  it('lets the second person in when the first invite was refused', async () => {
    // The homeserver answers `403 Event is not authorized` for inviting
    // somebody already in the room, and on the two-invite path that happens:
    // by the time the second poll names the real person, their device may
    // already have walked through. Returning on the first refusal reported a
    // failure about a person who was in the conversation.
    let refusals = 0
    const { deps } = harness({
      status: [drawn('@drawn:x'), drawn('@her:x'), claimed],
      refuseInviteWhen: who => {
        if (who !== '@drawn:x') return false
        refusals += 1
        return true
      },
    })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(refusals).toBe(1)
    expect(admission).toEqual({ admitted: true, entrants: ['@her:x'] })
  })

  it('names who was drawn when inviting them failed', async () => {
    // The distinction that matters: somebody is waiting on the other side of
    // a link that will not work, and this is the only place that knows.
    const { deps } = harness({
      status: [drawn('@her:x')],
      refuseInvite: true,
    })
    const admission = await admitDrawnEntrant(deps, 'inv-1', '!made:x')
    expect(admission.admitted).toBe(false)
    if (!admission.admitted) expect(admission.reason).toContain('@her:x')
  })
})
