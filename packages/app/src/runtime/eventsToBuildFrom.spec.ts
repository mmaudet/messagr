import { describe, expect, it } from 'vitest'

import { eventsToBuildFrom, type RememberedEvents } from './eventsToBuildFrom'

const FRESH = [{ event_id: '$fresh' }]
const HELD = [{ event_id: '$held' }]

function remembering(held: readonly unknown[] = HELD) {
  const kept: { scope: string; chunk: readonly unknown[] }[] = []
  const remembered: RememberedEvents = {
    of: async () => held,
    keep: async (scope, chunk) => {
      kept.push({ scope, chunk })
      return true
    },
  }
  return { remembered, kept }
}

const offline = () => Promise.reject(new Error('Network request failed'))

describe('when the homeserver answers', () => {
  it('builds from what it sent, and keeps it', async () => {
    const { remembered, kept } = remembering()

    expect(
      await eventsToBuildFrom('!a:x', async () => FRESH, remembered),
    ).toEqual(FRESH)
    expect(kept).toEqual([{ scope: '!a:x', chunk: FRESH }])
  })

  it('prefers an empty answer over a remembered chunk', async () => {
    // THE ONE THAT WOULD BE EASY TO GET WRONG, and the reason `[]` is not
    // treated as "nothing came back". A conversation everything was removed
    // from answers `[]`. Falling back here would redraw messages that are
    // gone -- worse than an empty screen, because it is an empty screen the
    // person cannot tell from a full one.
    const { remembered, kept } = remembering()

    expect(await eventsToBuildFrom('!a:x', async () => [], remembered)).toEqual(
      [],
    )
    expect(kept).toEqual([{ scope: '!a:x', chunk: [] }])
  })

  it('does not wait on the keeping, nor fail because of it', async () => {
    // A notebook write is not something a person waits behind, and a page
    // that started throwing must not take a conversation down with it.
    const refusing: RememberedEvents = {
      of: async () => HELD,
      keep: () => Promise.reject(new Error('the notebook is read-only')),
    }

    expect(
      await eventsToBuildFrom('!a:x', async () => FRESH, refusing),
    ).toEqual(FRESH)
  })
})

describe('when it does not', () => {
  it('builds from what was kept', async () => {
    const { remembered } = remembering()

    expect(await eventsToBuildFrom('!a:x', offline, remembered)).toEqual(HELD)
  })

  it('raises the failure when nothing was kept', async () => {
    // NOT AN EMPTY LIST. A conversation never opened on this device has
    // nothing behind it, and a screen drawn from `[]` would say « rien n'a
    // encore été dit ici » about a conversation full of messages nobody
    // could fetch. The caller already knows how to say a conversation could
    // not be read.
    const { remembered } = remembering([])

    await expect(
      eventsToBuildFrom('!a:x', offline, remembered),
    ).rejects.toThrow(/Network request failed/)
  })

  it('raises it when there is no notebook at all', async () => {
    await expect(eventsToBuildFrom('!a:x', offline)).rejects.toThrow(
      /Network request failed/,
    )
  })
})

describe('without a notebook', () => {
  it('behaves exactly as it did before there was one', async () => {
    // The property that lets every existing caller keep working unchanged,
    // and the reason the parameter is optional rather than required.
    expect(await eventsToBuildFrom('!a:x', async () => FRESH)).toEqual(FRESH)
  })
})
