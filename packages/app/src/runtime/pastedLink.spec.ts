import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REFUSED } from './claimInvitation'
import type { EntryResult } from './entry'
import { parseInvitationLink } from './invitationLink'
import { invitationPasted, whatThePasteBecame } from './pastedLink'
import type { RestoreCredentials } from './sessionCredentials'

const SESSION: RestoreCredentials = {
  baseUrl: 'https://messagr.eu',
  userId: '@someone:messagr.eu',
  deviceId: 'DEVICE',
  accessToken: 'token',
}

describe('the link somebody pasted', () => {
  it('hands over an ordinary invitation exactly as it was pasted', () => {
    expect(invitationPasted('https://messagr.eu/i/abc123')).toBe(
      'https://messagr.eu/i/abc123',
    )
  })

  it('hands over the application scheme too, which is the same link', () => {
    expect(invitationPasted('messagr://messagr.eu/i/abc123')).toBe(
      'messagr://messagr.eu/i/abc123',
    )
  })

  it('hands over a link a messenger gave tracking parameters back to', () => {
    // The shape a pasted link actually has, and the reason `invitationLink.ts`
    // ignores anything after the token. Handed over whole rather than tidied:
    // one reader decides what a link is, and it is the one entry uses.
    const pasted = 'https://messagr.eu/i/abc123?utm_source=whatsapp'

    expect(invitationPasted(pasted)).toBe(pasted)
  })

  it('takes the spaces a paste brings with it', () => {
    expect(invitationPasted('  https://messagr.eu/i/abc123\n')).toBe(
      'https://messagr.eu/i/abc123',
    )
  })

  it('hands nothing over for an address that is not an invitation', () => {
    // Nothing leaves the screen, so no token is spent: the whole point of
    // reading before handing over rather than after.
    expect(invitationPasted('https://messagr.eu/')).toBeNull()
    expect(invitationPasted('http://messagr.eu/i/abc123')).toBeNull()
    expect(invitationPasted('bonjour')).toBeNull()
    expect(invitationPasted('')).toBeNull()
  })

  it('names no instance of its own, because the link names one', () => {
    // A link into any instance is a link: which server it leads to is the
    // link s to say, and `entry.ts` is where that has consequences.
    expect(invitationPasted('https://bench.example.org:8448/i/xyz')).toBe(
      'https://bench.example.org:8448/i/xyz',
    )
  })

  it('accepts exactly what the reader the system s link goes through accepts', () => {
    // The ticket s own requirement: the same reader and the same refusals. A
    // second reader here would be a second definition of what an invitation
    // is, and the two would drift.
    const pastes = [
      'https://messagr.eu/i/abc123',
      'messagr://messagr.eu/i/abc123',
      'https://messagr.eu/i/abc123#x',
      'https://messagr.eu/i/',
      'http://messagr.eu/i/abc123',
      'messagr:///i/abc123',
      'https://messagr.eu/about/i/abc',
      'pas un lien',
    ]

    for (const pasted of pastes) {
      expect(`${pasted}: ${String(invitationPasted(pasted) !== null)}`).toBe(
        `${pasted}: ${String(parseInvitationLink(pasted) !== null)}`,
      )
    }
  })
})

describe('what became of a link that was handed over', () => {
  it('says the person is in when entry entered', () => {
    const result: EntryResult = {
      entered: true,
      session: SESSION,
      claimed: true,
    }

    expect(whatThePasteBecame(result)).toBe('in')
  })

  it('says refused when the service refused the link', () => {
    // The one discriminant `entry.ts` itself uses, and the reason it exists:
    // the service answers unknown, spent, revoked and expired identically.
    expect(whatThePasteBecame({ entered: false, reason: REFUSED })).toBe(
      'refused',
    )
  })

  it('says try again for a claim that may go through next time', () => {
    expect(
      whatThePasteBecame({
        entered: false,
        reason: 'the invitation service could not be reached',
      }),
    ).toBe('retry')
    expect(
      whatThePasteBecame({
        entered: false,
        reason: 'the invitation service did not answer in time',
      }),
    ).toBe('retry')
  })
})

describe('the clipboard, which this application only ever writes to', () => {
  /**
   * #367 s reserve, kept as a test rather than as something somebody
   * re-reads.
   *
   * An invitation token is a bearer credential -- ADR-0004: whoever holds it
   * is the invited person -- and a clipboard is readable by every other
   * application on the telephone. Today this application writes to it and
   * never reads it, and that asymmetry is what keeps a token from being
   * picked up by something the person did not choose. Breaking it must be a
   * gesture somebody makes in a field, never an initiative the product takes
   * at launch, in the background, or to offer to paste for them.
   *
   * So the members are listed rather than the reads forbidden by name: a
   * reader added under any other name fails this too.
   */
  const ALLOWED = new Set(['setString', 'setImage'])

  const sources = [
    ...readdirSync(join(__dirname, '..'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter(
        entry =>
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')),
      )
      .map(entry => join(entry.parentPath, entry.name)),
    join(__dirname, '..', '..', 'App.tsx'),
  ]

  it('is never read, anywhere in the application', () => {
    const read = sources.flatMap(path =>
      [...readFileSync(path, 'utf8').matchAll(/Clipboard\.(\w+)/g)]
        .map(([, member]) => member)
        .filter(member => !ALLOWED.has(member))
        .map(member => `${path}: ${member}`),
    )

    expect(read).toEqual([])
  })

  it('is looking at the sources it thinks it is', () => {
    // A walk that found nothing would pass the assertion above for ever. The
    // two writes this application does have are what proves it is reading
    // real files.
    const written = sources.flatMap(path =>
      [...readFileSync(path, 'utf8').matchAll(/Clipboard\.(\w+)/g)].map(
        ([, member]) => member,
      ),
    )

    expect(written).toContain('setString')
    expect(written).toContain('setImage')
  })
})
