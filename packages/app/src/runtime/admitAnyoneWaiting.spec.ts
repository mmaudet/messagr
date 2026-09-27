import { describe, expect, it, vi } from 'vitest'

import {
  admitAnyoneWaiting,
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
const HOUR = 60 * 60_000
const THREE_DAYS = 3 * 24 * HOUR
const ONE: OutstandingInvitation = {
  invitationId: 'inv-1',
  scope: '!room:example.org',
  issuedAt: NOW - 60_000,
  lifetime: HOUR,
  given: null,
}

/** Nobody is named in most of these, and naming is not what they test. */
const nameNobody = async () => {}

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
    const store = held({ ...ONE, issuedAt: NOW - HOUR + 1 })
    const admit = vi.fn(async (): Promise<Admitted> => ({
      admitted: true,
      entrants: ['@her:x'],
    }))

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(report.admitted).toEqual(['@her:x'])
  })

  it('admits somebody two days into a three-day link (#408)', async () => {
    // A link to a contact absent from Messagr is good for three days, and
    // this side used to stop asking after an hour whatever the link said.
    const store = held({
      ...ONE,
      issuedAt: NOW - 2 * 24 * HOUR,
      lifetime: THREE_DAYS,
    })
    const admit = vi.fn(async (): Promise<Admitted> => ({
      admitted: true,
      entrants: ['@her:x'],
    }))

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(report.admitted).toEqual(['@her:x'])
  })

  it('stops asking once a three-day link has run out (#408)', async () => {
    const store = held({
      ...ONE,
      issuedAt: NOW - THREE_DAYS - 1,
      lifetime: THREE_DAYS,
    })
    const admit = vi.fn()

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })

    expect(admit).not.toHaveBeenCalled()
    expect(report.expired).toBe(1)
    expect(store.rows.size).toBe(0)
  })

  it('gives the name typed for them to the last one let in, however late (#408)', async () => {
    // The last and not the first, as on the minute after issuing: somebody
    // who already had an account comes in after the one the service drew,
    // which cedes its place.
    const store = held({ ...ONE, given: 'Marie' })
    const giveName = vi.fn(async (_who: string, _name: string) => {})

    await admitAnyoneWaiting({
      outstanding: store,
      admit: async (): Promise<Admitted> => ({
        admitted: true,
        entrants: ['@drawn:x', '@marie:x'],
      }),
      now: () => NOW,
      giveName,
    })

    expect(giveName.mock.calls).toEqual([['@marie:x', 'Marie']])
  })

  it('names nobody when no name was typed, or nobody came in', async () => {
    const giveName = vi.fn(async (_who: string, _name: string) => {})

    await admitAnyoneWaiting({
      outstanding: held(ONE),
      admit: async (): Promise<Admitted> => ({
        admitted: true,
        entrants: ['@her:x'],
      }),
      now: () => NOW,
      giveName,
    })
    await admitAnyoneWaiting({
      outstanding: held({ ...ONE, given: 'Marie' }),
      admit: async (): Promise<NotAdmitted> => ({
        admitted: false,
        reason: 'not yet',
      }),
      now: () => NOW,
      giveName,
    })

    expect(giveName).not.toHaveBeenCalled()
  })

  it('a name that does not hold leaves the admission done', async () => {
    // Somebody is in: asking again would invite them a second time.
    const store = held({ ...ONE, given: 'Marie' })

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit: async (): Promise<Admitted> => ({
        admitted: true,
        entrants: ['@marie:x'],
      }),
      now: () => NOW,
      giveName: async () => {
        throw new Error('the notebook is read-only')
      },
    })

    expect(report.admitted).toEqual(['@marie:x'])
    expect(store.rows.size).toBe(0)
  })

  it('forgets an invitation once somebody has walked through it', async () => {
    // Otherwise every launch would invite the same person into the same room
    // for as long as the row survived.
    const store = held(ONE)
    await admitAnyoneWaiting({
      outstanding: store,
      admit: async (): Promise<Admitted> => ({
        admitted: true,
        entrants: ['@her:x'],
      }),
      now: () => NOW,
      giveName: nameNobody,
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
      giveName: nameNobody,
    })
    expect(store.rows.size).toBe(1)
  })

  it('stops asking about an invitation older than the token can be', async () => {
    // A row nobody can ask about usefully is a row that would be asked about
    // on every tick forever. The service is the authority on expiry, but this
    // side must be able to answer without it.
    const store = held({ ...ONE, issuedAt: NOW - HOUR - 1 })
    const admit = vi.fn(async (): Promise<Admitted> => ({
      admitted: true,
      entrants: ['@her:x'],
    }))

    await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })

    expect(admit).not.toHaveBeenCalled()
    expect(store.rows.size).toBe(0)
  })

  it('keeps an invitation that is exactly at the edge', async () => {
    // Off-by-one on an expiry is a link that dies a tick early, which is
    // indistinguishable from the defect this replaces.
    const store = held({ ...ONE, issuedAt: NOW - HOUR })
    const admit = vi.fn(async (): Promise<NotAdmitted> => ({
      admitted: false,
      reason: 'not yet',
    }))
    await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('asks about every outstanding invitation, not only the first', async () => {
    const store = held(ONE, { ...ONE, invitationId: 'inv-2' })
    const admit = vi.fn(async (): Promise<NotAdmitted> => ({
      admitted: false,
      reason: 'not yet',
    }))
    await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
    })
    expect(admit).toHaveBeenCalledTimes(2)
  })

  it('one that fails does not stop the others', async () => {
    // A network that dropped one request is not a reason to leave somebody
    // else waiting, and a throw here would be a tick that did nothing.
    const store = held(ONE, { ...ONE, invitationId: 'inv-2' })
    const admit = vi
      .fn()
      .mockRejectedValueOnce(new Error('the service could not be reached'))
      .mockResolvedValueOnce({
        admitted: true,
        entrants: ['@him:x'],
      } as Admitted)

    const report = await admitAnyoneWaiting({
      outstanding: store,
      admit,
      now: () => NOW,
      giveName: nameNobody,
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
      giveName: nameNobody,
    })
    expect(admit).not.toHaveBeenCalled()
    expect(report.admitted).toEqual([])
  })
})
