import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import {
  forgetfulRecognizedAccounts,
  openRecognizedAccounts,
} from './recognizedStore'

/**
 * The accounts known through the address book (#407), against a database
 * that answers what SQLite would for the statements this page runs, as
 * `favouriteStore.spec.ts` does.
 */
function fake(refuse = false) {
  const rows = new Map<string, string>()
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      if (sql.startsWith('CREATE')) return { rows: [] }
      if (sql.startsWith('SELECT user_id, card_name')) {
        return {
          rows: [...rows].map(([user_id, card_name]) => ({
            user_id,
            card_name,
          })),
        }
      }
      if (sql.startsWith('INSERT OR REPLACE INTO recognized_accounts')) {
        if (refuse) throw new Error('the notebook is read-only')
        rows.set(String(params[0]), String(params[1]))
        return { rows: [] }
      }
      throw new Error(`a statement this fake does not know: ${sql}`)
    },
  }
  return { database, rows }
}

describe('the accounts known through the address book (#407)', () => {
  it('keeps the card each account came from, and the latest one', async () => {
    const page = await openRecognizedAccounts(fake().database)

    expect(await page.recognize('@paul:x', 'Paul')).toBe(true)
    expect(await page.recognize('@anne:x', 'Anne')).toBe(true)
    expect(await page.recognize('@paul:x', 'Paul Martin')).toBe(true)

    expect(await page.all()).toEqual(
      new Map([
        ['@paul:x', 'Paul Martin'],
        ['@anne:x', 'Anne'],
      ]),
    )
  })

  it('says when it did not hold, and a device without a notebook keeps nothing', async () => {
    const page = await openRecognizedAccounts(fake(true).database)

    expect(await page.recognize('@paul:x', 'Paul')).toBe(false)
    expect(await forgetfulRecognizedAccounts().recognize('@paul:x', 'P')).toBe(
      false,
    )
    expect((await forgetfulRecognizedAccounts().all()).size).toBe(0)
  })
})
