import { describe, expect, it, vi } from 'vitest'

import {
  admitAnyoneWaiting,
  STOP_ASKING_AFTER_MS,
  type Admitted,
  type NotAdmitted,
} from './admitAnyoneWaiting'
import type { OutstandingInvitation } from './outstandingStore'

/**
 * Asking again, which is the whole of #118.
 *
 * The inviter used to ask for one minute and then never again, so an
 * invitation opened later than that could never be walked through. These
 * tests are about the asking, not about the admitting: `admitDrawnEntrant`
 * already does the second and is tested where it lives.
 */

const NOW = 1_700_000_000_000
const ONE: OutstandingInvitation = {
  invitationId: 'inv-1',
  scope: '!room:example.org',
  issuedAt: NOW - 60_000,
}

function held(...invitations: OutstandingInvitation[]) {
  const rows = new Map(invitations.map(one => [one.invitationId, one]))
  return {
    all: async () => [...rows.values()],
    remember: async () => true,
    forget: async (id: string) => {
      rows.delete(id)
      return true
    },
    rows,
  }
}

describe('admitAnyoneWaiting', () => {
  it('admits somebody who claimed long after the invitation was issued', async () => {
    // The case that never worked. An hour is inside the token's own life,
    // which is what `invite_ready` promises the inviter.
    const store = held({ ...ONE, issuedAt: NOW - 60 * 60_000 + 1 })
    const admit = vi.fn(async (): Promise<Admitted> => ({
      admitted: true,
      entrant: '@her:x',
    }))

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
    })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(report.admitted).toEqual(['@her:x'])
  })

  it('forgets an invitation once somebody has walked through it', async () => {
    // Otherwise every launch would invite the same person into the same room
    // for as long as the row survived.
    const store = held(ONE)
    await admitAnyoneWaiting({
      outstanding: store,
      admit: async (): Promise<Admitted> => ({
        admitted: true,
        entrant: '@her:x',
      }),
      now: () => NOW,
    })
    expect(store.rows.size).toBe(0)
  })

  it('keeps an invitation nobody has claimed yet', async () => {
    // The ordinary case between issuing and opening, and the reason the row
    // exists at all: it has to survive to be asked about again.
    const store = held(ONE)
    await admitAnyoneWaiting({
      outstanding: store,
      admit: async (): Promise<NotAdmitted> => ({
        admitted: false,
        reason: 'nobody has opened it',
      }),
      now: () => NOW,
    })
    expect(store.rows.size).toBe(1)
  })

  it('stops asking about an invitation older than the token can be', async () => {
    // A row nobody can ask about usefully is a row that would be asked about
    // on every tick forever. The service is the authority on expiry, but this
    // side must be able to answer without it.
    const store = held({ ...ONE, issuedAt: NOW - STOP_ASKING_AFTER_MS - 1 })
    const admit = vi.fn(async (): Promise<Admitted> => ({
      admitted: true,
      entrant: '@her:x',
    }))

    await admitAnyoneWaiting({ outstanding: store, admit, now: () => NOW })

    expect(admit).not.toHaveBeenCalled()
    expect(store.rows.size).toBe(0)
  })

  it('keeps an invitation that is exactly at the edge', async () => {
    // Off-by-one on an expiry is a link that dies a tick early, which is
    // indistinguishable from the defect this replaces.
    const store = held({ ...ONE, issuedAt: NOW - STOP_ASKING_AFTER_MS })
    const admit = vi.fn(async (): Promise<NotAdmitted> => ({
      admitted: false,
      reason: 'not yet',
    }))
    await admitAnyoneWaiting({ outstanding: store, admit, now: () => NOW })
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('asks about every outstanding invitation, not only the first', async () => {
    const store = held(ONE, { ...ONE, invitationId: 'inv-2' })
    const admit = vi.fn(async (): Promise<NotAdmitted> => ({
      admitted: false,
      reason: 'not yet',
    }))
    await admitAnyoneWaiting({ outstanding: store, admit, now: () => NOW })
    expect(admit).toHaveBeenCalledTimes(2)
  })

  it('one that fails does not stop the others', async () => {
    // A network that dropped one request is not a reason to leave somebody
    // else waiting, and a throw here would be a tick that did nothing.
    const store = held(ONE, { ...ONE, invitationId: 'inv-2' })
    const admit = vi
      .fn()
      .mockRejectedValueOnce(new Error('the service could not be reached'))
      .mockResolvedValueOnce({ admitted: true, entrant: '@him:x' } as Admitted)

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
    })

    expect(report.admitted).toEqual(['@him:x'])
    // And the one that threw is still held: a failed ask is not an answer.
    expect(store.rows.has('inv-1')).toBe(true)
  })

  it('does nothing, quietly, when there is nothing outstanding', async () => {
    const admit = vi.fn()
    const report = await admitAnyoneWaiting({
      outstanding: held(),
      admit,
      now: () => NOW,
    })
    expect(admit).not.toHaveBeenCalled()
    expect(report.admitted).toEqual([])
  })
})
