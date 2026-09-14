import { describe, expect, it } from 'vitest'

import { spentLinks } from './spentLinks'

const LINK = 'https://messagr.eu/i/abc123'

/** A promise held open until the test lets it go. */
function held() {
  let release!: () => void
  const promise = new Promise<void>(settle => {
    release = settle
  })
  return { promise, release }
}

/** An entry that takes its link and answers at once. */
const takeAndAnswer = async (link: () => Promise<string | null>) => link()

describe('spentLinks', () => {
  it('turns the same link away while the entry that took it is still claiming', async () => {
    // The duplicate one opening can produce -- the launch address and then a
    // url event, or two events close together -- arriving while the first
    // claim is still waiting on the service. It is handed no link, so it
    // starts no second claim.
    const links = spentLinks()
    const took = held()
    const claiming = held()
    const first = links.enter(
      async () => LINK,
      async link => {
        const handed = await link()
        took.release()
        await claiming.promise
        return handed
      },
    )
    await took.promise

    expect(await links.enter(async () => LINK, takeAndAnswer)).toBeNull()

    claiming.release()
    expect(await first).toBe(LINK)
  })

  it('hands the same link over again once the entry that took it has answered', async () => {
    // Entered, refused, or given up because nobody had let the account in
    // yet: however the entry answered, the same link opened again without
    // closing the application is claimed again. The last of the three is the
    // one that would otherwise stop somebody with nobody beside them.
    for (const answer of [
      { entered: true },
      { entered: false, reason: 'this invitation cannot be used' },
      { entered: false, reason: 'nobody has let this account in yet' },
    ]) {
      const links = spentLinks()
      const first = await links.enter(
        async () => LINK,
        async link => {
          await link()
          return answer
        },
      )
      expect(first).toBe(answer)

      expect(await links.enter(async () => LINK, takeAndAnswer)).toBe(LINK)
    }
  })

  it('lifts the mark even when the entry fails outright', async () => {
    // A launch that threw must not leave its link turned away for the rest of
    // the run: that would be the too-broad hold again, by another road.
    const links = spentLinks()
    await expect(
      links.enter(
        async () => LINK,
        async link => {
          await link()
          throw new Error('the keystore did not answer')
        },
      ),
    ).rejects.toThrow('the keystore did not answer')

    expect(await links.enter(async () => LINK, takeAndAnswer)).toBe(LINK)
  })

  it('answers at once when no entry holds a link, and says it did not wait', async () => {
    // Almost every launch: one run, whose own mark was lifted when its entry
    // answered. Nothing to wait for, and nothing for the caller to re-read.
    expect(await spentLinks().settled()).toBe(false)
  })

  it('makes a run that was handed no link wait for the entry that took it', async () => {
    // #304. The run that was handed nothing restored the session it found,
    // while the run that took the link may be asking the person whether to
    // leave that very account. Carrying on would re-enter it or publish under
    // it before they answer. So it waits, and is told it waited, which is its
    // cue to look again at which account this device now holds.
    const links = spentLinks()
    const took = held()
    const asking = held()
    const first = links.enter(
      async () => LINK,
      async link => {
        await link()
        took.release()
        await asking.promise
      },
    )
    await took.promise

    let waited: boolean | null = null
    links.settled().then(answer => {
      waited = answer
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(waited).toBeNull()

    asking.release()
    await first
    await new Promise(resolve => setImmediate(resolve))
    expect(waited).toBe(true)
  })

  it('lets two different invitations be claimed side by side', async () => {
    // Two real invitations differ in their token and so in their address, and
    // neither is the other's duplicate.
    const links = spentLinks()
    const took = held()
    const claiming = held()
    const first = links.enter(
      async () => 'https://messagr.eu/i/abc123',
      async link => {
        const handed = await link()
        took.release()
        await claiming.promise
        return handed
      },
    )
    await took.promise

    expect(
      await links.enter(
        async () => 'https://messagr.eu/i/def456',
        takeAndAnswer,
      ),
    ).toBe('https://messagr.eu/i/def456')

    claiming.release()
    expect(await first).toBe('https://messagr.eu/i/abc123')
  })
})
