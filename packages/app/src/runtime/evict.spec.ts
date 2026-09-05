import { describe, expect, it } from 'vitest'

import { evictFrom, type RotatingMachine } from './evict'
import type { HttpRequester } from './pump'

const SCOPE = '!scope:example.org'
const DEPARTING = '@departing:example.org'

/**
 * A world that records the order things happened in, because the order is
 * what most of these tests are about.
 */
function world(
  overrides: {
    readonly kickFails?: boolean
    readonly rotateFails?: boolean
    readonly rotated?: boolean
  } = {},
) {
  const log: string[] = []
  const kicked: unknown[] = []

  const http: HttpRequester = {
    authedRequest: async (_method, path, _query, body) => {
      if (path.includes('/kick')) {
        if (overrides.kickFails === true) throw new Error('403 forbidden')
        log.push('removed')
        kicked.push(JSON.parse(body ?? '{}'))
        return '{}'
      }
      log.push('sent')
      return '{}'
    },
  }

  const machine: RotatingMachine = {
    takeOutgoingRequests: async () => [],
    markRequestSent: async () => undefined,
    markRequestFailed: async () => undefined,
    discardScopeKey: async () => {
      if (overrides.rotateFails === true) throw new Error('store unavailable')
      log.push('rotated')
      return overrides.rotated ?? true
    },
  }

  return { http, machine, log, kicked }
}

describe('evicting somebody', () => {
  it('removes them and reports that the key was replaced', async () => {
    const w = world()
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toEqual({ evicted: true, rotated: true })
    expect(w.kicked).toEqual([{ user_id: DEPARTING }])
  })

  it('removes them before it rotates the key', async () => {
    // THE ORDER THIS GESTURE EXISTS FOR, and the mirror of vouching's. No new
    // key is made by the rotation: the replacement is created at the next
    // send, which shares it with whoever is a member THEN. Rotating first and
    // sending before the removal has landed hands the fresh key to the very
    // person it was rotated away from.
    const w = world()
    await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(w.log.indexOf('removed')).toBeLessThan(w.log.indexOf('rotated'))
  })

  it('passes a rotation that found nothing through as itself', async () => {
    // `false` means this device had not encrypted here, so no key out there
    // came from it. Not a failure -- but not the same fact as a rotation
    // either, and the ticket asks the test to assert the rotation rather than
    // the membership change, which is only possible if the two are told
    // apart.
    const w = world({ rotated: false })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toEqual({ evicted: true, rotated: false })
  })

  it('changes nothing at all when the removal is refused', async () => {
    // Nothing to undo: the rotation never ran, so the conversation is exactly
    // as it was. A rotation here would have cost the remaining members a key
    // change for an eviction that did not happen.
    const w = world({ kickFails: true })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'removing' })
    expect(w.log).not.toContain('rotated')
  })

  it('names the half-state where they are out and still hold a key', async () => {
    // The one failure that leaves something worth acting on: removed, not
    // rotated. A caller told only "eviction failed" would reasonably assume
    // nothing happened and stop, leaving a departed party reading everything
    // sent afterwards.
    const w = world({ rotateFails: true })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'rotating' })
    if (outcome.evicted) return
    expect(outcome.rotated).toBe(false)
    expect(w.log).toContain('removed')
  })

  it('reports what the rotation did even when the drain fails afterwards', async () => {
    // The rotation is local and has already happened; a drain that failed
    // does not undo it. Reporting `rotated: false` here would send somebody
    // to redo something that is done.
    const w = world()
    const machine: RotatingMachine = {
      ...w.machine,
      takeOutgoingRequests: async () => {
        throw new Error('the queue could not be read')
      },
    }
    const outcome = await evictFrom(w.http, machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'settling' })
    if (outcome.evicted) return
    expect(outcome.rotated).toBe(true)
  })
})
