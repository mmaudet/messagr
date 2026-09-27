import { describe, expect, it } from 'vitest'

import {
  inviteByLink,
  smsAddress,
  type AbsentChannel,
  type LinkDeps,
} from './inviteByLink'
import {
  issueInvitation,
  type InvitationService,
  type Issued,
} from './issueInvitation'
import type { Outstanding, OutstandingInvitation } from './outstandingStore'
import type { HttpRequester } from './pump'

/**
 * Inviting by a link, and a contact absent from Messagr by SMS or by the
 * share sheet (#408). The minting is `issueInvitation`'s, tested there; what
 * is tested here is how long the link is good for, what is written down for
 * admitting whoever comes, and where the card's number goes: to the
 * telephone's messaging application, and nowhere else.
 */

const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000
const THREE_DAYS = 3 * 24 * HOUR

const LINK = 'https://messagr.eu/i/a-token'
/** The text the owner chose on 27 September 2026, in French. */
const DRAFTED = `Invitation à me rejoindre sur Messagr :\n${LINK}\nCe lien vaut trois jours et ne sert qu’une fois.`

const SMS: AbsentChannel = { by: 'sms', number: '+33612345678' }

/** Every request the minting makes, in the order it makes them. */
function aService() {
  const requests: string[] = []
  const http: HttpRequester = {
    authedRequest: async (method, path, _query, body) => {
      requests.push(`${method} ${path} ${body ?? ''}`)
      if (path.endsWith('/createRoom')) {
        return JSON.stringify({ room_id: '!made:x' })
      }
      if (method === 'GET') return JSON.stringify({ users: { '@me:x': 100 } })
      return '{}'
    },
  }
  const service: InvitationService = {
    issue: async (body, key) => {
      requests.push(`issue ${body} ${key}`)
      return {
        status: 200,
        body: JSON.stringify({ token: 'a-token', invitation_id: 'inv-1' }),
      }
    },
    status: async () => ({ status: 200, body: '{}' }),
  }
  const issue = (declared: string | null, ttlSeconds: number) =>
    issueInvitation(
      { http, service, newIdempotencyKey: () => 'key-1' },
      'messagr.eu',
      declared,
      ttlSeconds,
    )
  return { issue, requests }
}

function aPage(holds = true) {
  const kept: OutstandingInvitation[] = []
  const outstanding: Outstanding = {
    all: async () => kept,
    remember: async invitation => {
      if (!holds) return false
      kept.push(invitation)
      return true
    },
    forget: async () => true,
  }
  return { outstanding, kept }
}

function harness(
  overrides: Partial<LinkDeps> = {},
  options: { holds?: boolean } = {},
) {
  const { issue, requests } = aService()
  const { outstanding, kept } = aPage(options.holds)
  const opened: string[] = []
  const shared: string[] = []
  const deps: LinkDeps = {
    issue,
    outstanding,
    now: () => NOW,
    openUrl: async url => {
      opened.push(url)
    },
    share: async message => {
      shared.push(message)
    },
    os: 'android',
    ...overrides,
  }
  return { deps, requests, kept, opened, shared }
}

describe('inviting by a link', () => {
  it('mints any other link for an hour, and writes it down for an hour with the name typed', async () => {
    const { deps, requests, kept, opened, shared } = harness()

    const invited = await inviteByLink(deps, { given: 'Nadia', declared: null })

    expect(invited).toEqual({
      issued: true,
      scope: '!made:x',
      invitationId: 'inv-1',
      link: LINK,
      kept: true,
      drafted: null,
    })
    expect(requests.find(one => one.startsWith('issue'))).toContain(
      '"ttl_seconds":3600',
    )
    expect(kept).toEqual([
      {
        invitationId: 'inv-1',
        scope: '!made:x',
        issuedAt: NOW,
        lifetime: HOUR,
        name: 'Nadia',
      },
    ])
    // Nothing is opened for it: the screen shows the link to share.
    expect(opened).toEqual([])
    expect(shared).toEqual([])
  })
})

describe('inviting a contact absent from Messagr (#408)', () => {
  it('mints a link good for three days, and opens the messaging application with the card’s number and the drafted text', async () => {
    const { deps, requests, opened } = harness()

    const invited = await inviteByLink(
      deps,
      { given: 'Marie', declared: null },
      SMS,
    )

    expect(requests.find(one => one.startsWith('issue'))).toContain(
      '"max_uses":1,"ttl_seconds":259200',
    )
    expect(opened).toEqual([
      `sms:+33612345678?body=${encodeURIComponent(DRAFTED)}`,
    ])
    expect(invited).toMatchObject({
      issued: true,
      link: LINK,
      drafted: { message: DRAFTED, smsRefused: false },
    })
  })

  it('writes it down for three days, with the name typed, so whoever comes is let in and named however late', async () => {
    const { deps, kept } = harness()

    await inviteByLink(deps, { given: 'Marie', declared: null }, SMS)

    expect(kept).toEqual([
      {
        invitationId: 'inv-1',
        scope: '!made:x',
        issuedAt: NOW,
        lifetime: THREE_DAYS,
        name: 'Marie',
      },
    ])
  })

  it('sends the number to the messaging application only: no request to the service or the homeserver carries it, nor the name typed', async () => {
    const { deps, requests, opened } = harness()

    await inviteByLink(deps, { given: 'Marie', declared: 'Michel' }, SMS)

    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request).not.toContain('612345678')
      expect(request).not.toContain('Marie')
    }
    expect(opened[0]).toContain('sms:+33612345678')
  })

  it('carries the declared name in the link’s fragment, as any link does (#372)', async () => {
    const { deps } = harness()

    const invited = await inviteByLink(
      deps,
      { given: null, declared: 'Michel' },
      SMS,
    )

    expect(invited.issued && invited.link).toBe(`${LINK}#n=Michel`)
  })

  it('opens the share sheet with the same text for « Autre moyen », and the same three days', async () => {
    const { deps, requests, kept, opened, shared } = harness()

    const invited = await inviteByLink(
      deps,
      { given: 'Marie', declared: null },
      { by: 'share' },
    )

    expect(shared).toEqual([DRAFTED])
    expect(opened).toEqual([])
    expect(requests.find(one => one.startsWith('issue'))).toContain(
      '"ttl_seconds":259200',
    )
    expect(kept[0]?.lifetime).toBe(THREE_DAYS)
    expect(invited).toMatchObject({
      drafted: { message: DRAFTED, smsRefused: false },
    })
  })

  it('says when the messaging application does not open, and the link stands', async () => {
    const { deps, kept } = harness({
      openUrl: async () => {
        throw new Error('no application handles sms:')
      },
    })

    const invited = await inviteByLink(
      deps,
      { given: 'Marie', declared: null },
      SMS,
    )

    expect(invited).toMatchObject({
      issued: true,
      link: LINK,
      drafted: { message: DRAFTED, smsRefused: true },
    })
    expect(kept).toHaveLength(1)
  })

  it('reads a share sheet dismissed or refused as nothing to say: the link is on the screen', async () => {
    const { deps } = harness({
      share: async () => {
        throw new Error('dismissed')
      },
    })

    const invited = await inviteByLink(
      deps,
      { given: null, declared: null },
      { by: 'share' },
    )

    expect(invited).toMatchObject({
      drafted: { message: DRAFTED, smsRefused: false },
    })
  })

  it('opens nothing when no link could be minted', async () => {
    const refused: Issued = {
      issued: false,
      reason: 'the invitation service refused to mint an invitation',
      scope: '!made:x',
    }
    const { deps, kept, opened, shared } = harness({
      issue: async () => refused,
    })

    const invited = await inviteByLink(
      deps,
      { given: 'Marie', declared: null },
      SMS,
    )

    expect(invited).toEqual(refused)
    expect(kept).toEqual([])
    expect(opened).toEqual([])
    expect(shared).toEqual([])
  })

  it('opens the messaging application all the same when the notebook does not keep the link, and says it was not kept', async () => {
    const { deps, opened } = harness({}, { holds: false })

    const invited = await inviteByLink(
      deps,
      { given: 'Marie', declared: null },
      SMS,
    )

    expect(invited).toMatchObject({ issued: true, kept: false })
    expect(opened).toHaveLength(1)
  })
})

describe('the address of the messaging application (#408)', () => {
  it('writes the text where Android reads it', () => {
    expect(smsAddress('android', '+33612345678', 'à bientôt & merci')).toBe(
      'sms:+33612345678?body=%C3%A0%20bient%C3%B4t%20%26%20merci',
    )
  })

  it('writes the text where iOS reads it', () => {
    expect(smsAddress('ios', '+33612345678', 'à bientôt & merci')).toBe(
      'sms:+33612345678&body=%C3%A0%20bient%C3%B4t%20%26%20merci',
    )
  })

  it('keeps the fragment of the link inside the text, rather than ending the address', () => {
    expect(smsAddress('android', '+33612345678', `${LINK}#n=Michel`)).toBe(
      'sms:+33612345678?body=https%3A%2F%2Fmessagr.eu%2Fi%2Fa-token%23n%3DMichel',
    )
  })
})
