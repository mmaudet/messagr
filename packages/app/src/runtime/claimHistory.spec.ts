import { describe, expect, it } from 'vitest'

import {
  claimHistory,
  type HistoryReceiver,
  type MediaDownloader,
} from './claimHistory'

const SCOPE = '!scope:example.org'
const VOUCHER = '@voucher:example.org'

/** A `CryptoError` as the crypto library produces it: an Error with a kind. */
function cryptoError(kind: string, message: string): Error {
  const error = new Error(message) as Error & { kind: string }
  error.kind = kind
  return error
}

function receiver(overrides: Partial<HistoryReceiver> = {}): HistoryReceiver {
  return {
    offeredHistoryBundle: async () => ({ url: 'mxc://example.org/abc' }),
    receiveHistoryBundle: async () => ({ offered: 4, imported: 4 }),
    ...overrides,
  }
}

function downloader(bytes = new Uint8Array([1, 2, 3])): MediaDownloader & {
  readonly asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    download: async url => {
      asked.push(url)
      return bytes
    },
  }
}

describe('claiming history somebody vouched for you with', () => {
  it('says nothing has been offered, without treating it as a failure', async () => {
    // The ordinary answer for a device whose sync has not carried an
    // announcement yet, and for one nobody has vouched for. Reporting it as
    // an error would put a warning in front of somebody for whom nothing has
    // gone wrong.
    const claim = await claimHistory(
      receiver({ offeredHistoryBundle: async () => null }),
      downloader(),
      SCOPE,
      VOUCHER,
    )
    expect(claim).toEqual({ claimed: 'none' })
  })

  it('downloads what the announcement named, and imports it', async () => {
    const media = downloader()
    const claim = await claimHistory(receiver(), media, SCOPE, VOUCHER)

    expect(media.asked).toEqual(['mxc://example.org/abc'])
    expect(claim).toEqual({ claimed: 'imported', offered: 4, imported: 4 })
  })

  it('reports what actually landed, not what was offered', async () => {
    // Keys for another conversation are discarded. A caller shown only the
    // offered count would report a history that did not arrive.
    const claim = await claimHistory(
      receiver({
        receiveHistoryBundle: async () => ({ offered: 9, imported: 3 }),
      }),
      downloader(),
      SCOPE,
      VOUCHER,
    )
    expect(claim).toEqual({ claimed: 'imported', offered: 9, imported: 3 })
  })

  it('singles out a sender this device cannot vouch for', async () => {
    // The one refusal worth telling somebody about: what fixes it is
    // verifying the sender, not trying again.
    const claim = await claimHistory(
      receiver({
        receiveHistoryBundle: async () => {
          throw cryptoError('sender_not_trusted', 'not trusted enough')
        },
      }),
      downloader(),
      SCOPE,
      VOUCHER,
    )
    expect(claim).toEqual({
      claimed: 'refused',
      kind: 'untrusted',
      reason: 'not trusted enough',
    })
  })

  it('tells a file that came back wrong apart from one that did not come back', async () => {
    // Two different things to do about them: bytes that arrived and failed
    // the announcement's hash will fail again, and a download that never
    // happened can succeed later.
    const wrongBytes = await claimHistory(
      receiver({
        receiveHistoryBundle: async () => {
          throw cryptoError('bundle_unreadable', 'not the announced bundle')
        },
      }),
      downloader(),
      SCOPE,
      VOUCHER,
    )
    expect(wrongBytes).toMatchObject({ claimed: 'refused', kind: 'unreadable' })

    const noBytes = await claimHistory(
      receiver(),
      {
        download: async () => {
          throw new Error('the repository answered 502')
        },
      },
      SCOPE,
      VOUCHER,
    )
    expect(noBytes).toMatchObject({ claimed: 'refused', kind: 'unavailable' })
  })

  it('never throws into the launch that called it', async () => {
    // ADR-0006 already says a device shows a gap it cannot decrypt. A
    // history that did not arrive is a smaller thing than an application
    // that did not start.
    for (const broken of [
      receiver({
        offeredHistoryBundle: async () => {
          throw new Error('the store is unavailable')
        },
      }),
      receiver({
        receiveHistoryBundle: async () => {
          throw new Error('something nobody classified')
        },
      }),
    ]) {
      const claim = await claimHistory(broken, downloader(), SCOPE, VOUCHER)
      expect(claim.claimed).toBe('refused')
    }
  })

  it('classifies an error carrying no kind as merely unavailable', async () => {
    // A failure this application cannot name must not be reported as the one
    // refusal it would tell somebody to act on. Guessing "untrusted" here
    // would send a person to verify somebody over a broken store.
    const claim = await claimHistory(
      receiver({
        receiveHistoryBundle: async () => {
          throw new Error('no kind at all')
        },
      }),
      downloader(),
      SCOPE,
      VOUCHER,
    )
    expect(claim).toMatchObject({ claimed: 'refused', kind: 'unavailable' })
  })
})
