import { describe, expect, it } from 'vitest'

import { DELETION_ADDRESS, deletionMail } from './deletionMail'

describe('the mail that asks for a deletion (#384)', () => {
  const accountId = '@3ckdwoeqsguf:messagr.eu'

  it('goes to the one address, with a subject and a body and nothing else', () => {
    const mail = new URL(deletionMail(accountId))
    expect(mail.protocol).toBe('mailto:')
    expect(mail.pathname).toBe(DELETION_ADDRESS)
    expect([...mail.searchParams.keys()]).toEqual(['subject', 'body'])
  })

  it('carries the account identifier whole, so the operator finds the account without an inquiry', () => {
    const mail = new URL(deletionMail(accountId))
    expect(mail.searchParams.get('body')).toContain(accountId)
  })

  it('encodes everything a mail application would otherwise cut or misread', () => {
    // A raw space, line break, ampersand, question mark or hash would end the
    // body early or start a parameter nobody wrote. Read on the whole link:
    // splitting at the first question mark would hide a second one.
    const mail = deletionMail(accountId)
    expect(mail.split('?')).toHaveLength(2)
    expect(mail).not.toMatch(/[\s#]/)
    expect(mail.split('&')).toHaveLength(2)
  })

  it('breaks lines as the mailto standard wants them', () => {
    // RFC 6068: `%0D%0A`. A bare `%0A` would run the identifier into the
    // sentence before it in the applications that follow the letter.
    const mail = deletionMail(accountId)
    expect(mail).toContain('%0D%0A')
    expect(mail.replaceAll('%0D%0A', '')).not.toContain('%0A')
  })
})
