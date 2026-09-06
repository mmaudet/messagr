import { describe, expect, it, vi } from 'vitest'

import type { PickedImage } from './pickImage'
import { sendImages, type SendingEach } from './sendImages'

const picture = (n: number): PickedImage => ({
  bytes: new Uint8Array([n]),
  mimeType: 'image/jpeg',
  width: 10,
  height: 10,
})

describe('sendImages', () => {
  it('sends them in order', async () => {
    // The order they were chosen in is the order they arrive in, which is
    // the only order a person can predict.
    const sent: number[] = []
    const each: SendingEach = async image => {
      sent.push(image.bytes[0]!)
      return { sent: true, eventId: `$${image.bytes[0]}` }
    }
    await sendImages(each, [picture(1), picture(2), picture(3)])
    expect(sent).toEqual([1, 2, 3])
  })

  it('sends them one at a time, never at once', async () => {
    // `encryptAttachment` holds the plaintext and the ciphertext together,
    // so a phone asked to hold thirty of each is killed rather than slowed.
    // This is the assertion that keeps a `Promise.all` from creeping in.
    let inFlight = 0
    let most = 0
    const each: SendingEach = async () => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight -= 1
      return { sent: true, eventId: '$x' }
    }
    await sendImages(each, [picture(1), picture(2), picture(3)])
    expect(most).toBe(1)
  })

  it('reports how many went and how many are left', async () => {
    const seen: { done: number; total: number }[] = []
    await sendImages(
      async () => ({ sent: true, eventId: '$x' }),
      [picture(1), picture(2)],
      progress => seen.push({ ...progress }),
    )
    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  it('stops at the first failure and says which ones went', async () => {
    // Carrying on would send the fourth after the third failed, leaving a
    // gap somebody cannot see. Stopping and naming the boundary is what
    // makes the rest re-sendable.
    const each = vi
      .fn<SendingEach>()
      .mockResolvedValueOnce({ sent: true, eventId: '$1' })
      .mockResolvedValueOnce({ sent: false, reason: 'the upload refused' })
    const outcome = await sendImages(each, [picture(1), picture(2), picture(3)])
    expect(outcome).toEqual({
      sent: 1,
      reason: 'the upload refused',
      remaining: 2,
    })
    expect(each).toHaveBeenCalledTimes(2)
  })

  it('reports plainly when everything went', async () => {
    expect(
      await sendImages(
        async () => ({ sent: true, eventId: '$x' }),
        [picture(1), picture(2)],
      ),
    ).toEqual({ sent: 2 })
  })

  it('refuses more than it will carry', async () => {
    // A picker can be asked for fifty and hand back five hundred if
    // something upstream changes. The cap is here as well as in the picker,
    // because a limit enforced in one place is a limit until somebody edits
    // that place.
    const many = Array.from({ length: 60 }, (_, n) => picture(n))
    const each = vi.fn<SendingEach>()
    expect(await sendImages(each, many)).toEqual({
      sent: 0,
      reason: 'too-many',
      remaining: 60,
    })
    expect(each).not.toHaveBeenCalled()
  })

  it('does nothing for nothing', async () => {
    const each = vi.fn<SendingEach>()
    expect(await sendImages(each, [])).toEqual({ sent: 0 })
    expect(each).not.toHaveBeenCalled()
  })
})
