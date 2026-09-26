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
    // A raw space, line break, ampersand or question mark in the query would
    // end the body early or start a parameter nobody wrote.
    const query = deletionMail(accountId).split('?')[1] ?? ''
    expect(query).not.toMatch(/[\s?#]/)
    expect(query.split('&')).toHaveLength(2)
  })
})
