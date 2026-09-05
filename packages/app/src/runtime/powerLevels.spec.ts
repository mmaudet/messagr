import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import { fetchPowerContent, grantPower, readPower } from './powerLevels'

/**
 * A homeserver that holds one power levels event, answers reads from it, and
 * replaces it wholesale on a write -- which is what the real endpoint does,
 * and the only reason this module is careful.
 */
function room(initial: Record<string, unknown>) {
  const state = { content: initial }
  const writes: Record<string, unknown>[] = []
  const http: HttpRequester = {
    authedRequest: async (method, _path, _query, body) => {
      if (method === 'GET') return JSON.stringify(state.content)
      const written = JSON.parse(body ?? '{}') as Record<string, unknown>
      writes.push(written)
      state.content = written
      return JSON.stringify({ event_id: '$written' })
    },
  }
  return { http, writes, current: () => state.content }
}

/** What a conversation this product created actually looks like. */
function asCreatedByThisProduct() {
  return {
    users: { '@inviter:example.org': 100 },
    users_default: 0,
    invite: 50,
    kick: 50,
    ban: 50,
    redact: 50,
    state_default: 50,
    events_default: 0,
    events: { 'm.room.power_levels': 100, 'm.room.name': 50 },
    notifications: { room: 50 },
  }
}

describe('reading what a member may do', () => {
  it('reads a level named in users', () => {
    const reading = readPower(asCreatedByThisProduct(), '@inviter:example.org')
    expect(reading.held).toBe(100)
    expect(reading.mayInvite).toBe(true)
  })

  it('falls back to users_default for somebody not named', () => {
    const reading = readPower(asCreatedByThisProduct(), '@entrant:example.org')
    expect(reading.held).toBe(0)
    expect(reading.toInvite).toBe(50)
    expect(reading.mayInvite).toBe(false)
  })

  it('uses the specification defaults when the room says nothing', () => {
    // A room born before this product set any rules carries no `invite` key,
    // and the specification's default for it is 0 -- so everybody may invite.
    // Reading that as 50 would report a restriction the room does not have.
    const reading = readPower({}, '@anyone:example.org')
    expect(reading.held).toBe(0)
    expect(reading.toInvite).toBe(0)
    expect(reading.mayInvite).toBe(true)
  })

  it('refuses a value it cannot read rather than defaulting it', () => {
    // A key that is absent is a default; a key that is present and
    // unreadable is not. Collapsing the two turns `"invite": "fifty"` into
    // a permission granted because a value could not be parsed.
    expect(() => readPower({ invite: 'fifty' }, '@a:example.org')).toThrow()
    expect(() =>
      readPower({ users: { '@a:example.org': 'lots' } }, '@a:example.org'),
    ).toThrow()
    expect(() =>
      readPower({ users: ['@a:example.org'] }, '@a:example.org'),
    ).toThrow()
  })
})

describe('promoting a member', () => {
  it('grants the level asked for, read back from the room', async () => {
    const r = room(asCreatedByThisProduct())
    const after = await grantPower(
      r.http,
      '!scope:example.org',
      '@entrant:example.org',
      50,
    )
    expect(after.held).toBe(50)
    expect(after.mayInvite).toBe(true)
  })

  it('keeps every rule it did not come to change', async () => {
    // THE TEST THIS MODULE EXISTS FOR. A PUT replaces the whole content, so
    // a promotion built from a parsed subset deletes every key the parse did
    // not model. The worst of those is `invite`: absent, its specification
    // default is 0, so a promotion meant to grant one person the right to
    // invite would grant it to everybody, silently.
    const before = asCreatedByThisProduct()
    const r = room(before)
    await grantPower(r.http, '!scope:example.org', '@entrant:example.org', 50)

    const written = r.writes.at(-1)!
    for (const key of Object.keys(before)) {
      if (key === 'users') continue
      expect(written[key]).toEqual(before[key as keyof typeof before])
    }
    expect(written.invite).toBe(50)
    expect(written.events).toEqual(before.events)
  })

  it("leaves everybody else's level alone", async () => {
    const r = room(asCreatedByThisProduct())
    await grantPower(r.http, '!scope:example.org', '@entrant:example.org', 50)

    const users = r.writes.at(-1)!.users as Record<string, number>
    expect(users['@inviter:example.org']).toBe(100)
    expect(users['@entrant:example.org']).toBe(50)
  })

  it('carries across a key this application does not understand', async () => {
    // Not hypothetical: room versions add keys, and a product that drops
    // what it cannot name is a product that silently downgrades rooms it did
    // not create.
    const r = room({ ...asCreatedByThisProduct(), 'org.example.future': 42 })
    await grantPower(r.http, '!scope:example.org', '@entrant:example.org', 50)
    expect(r.writes.at(-1)!['org.example.future']).toBe(42)
  })

  it('writes nothing at all when the member already holds enough', async () => {
    const r = room(asCreatedByThisProduct())
    const after = await grantPower(
      r.http,
      '!scope:example.org',
      '@inviter:example.org',
      50,
    )
    // Promotion is the only thing this module does. Sending a lower number
    // for somebody who holds more would be a demotion, and demotion has a
    // consequence -- a key rotation -- that this call does not perform.
    expect(r.writes).toHaveLength(0)
    expect(after.held).toBe(100)
  })

  it('reports what the room says, not what was sent', async () => {
    // A PUT that returns an event id says the homeserver accepted the event,
    // not that the room grants what was asked. A server that rewrote the
    // value must not be reported as having honoured it.
    const state = {
      content: asCreatedByThisProduct() as Record<string, unknown>,
    }
    const http: HttpRequester = {
      authedRequest: async method => {
        if (method === 'GET') return JSON.stringify(state.content)
        state.content = {
          ...state.content,
          users: { '@inviter:example.org': 100, '@entrant:example.org': 25 },
        }
        return JSON.stringify({ event_id: '$written' })
      },
    }

    const after = await grantPower(
      http,
      '!scope:example.org',
      '@entrant:example.org',
      50,
    )
    expect(after.held).toBe(25)
    expect(after.mayInvite).toBe(false)
  })
})

describe('fetching the rules', () => {
  it('refuses an answer that is not an object', async () => {
    const http: HttpRequester = { authedRequest: async () => '"nonsense"' }
    await expect(
      fetchPowerContent(http, '!scope:example.org'),
    ).rejects.toThrow()
  })
})
