import { describe, expect, it, vi } from 'vitest'

import { forgetNotebook, openNotebook } from './notebook'

/**
 * The notebook itself is native modules and nothing else, as `notebook.ts`
 * says, so this does not test SQLite. It checks the one thing a page's own
 * tests cannot: that the page lives in the file leaving the account erases.
 */

const native = vi.hoisted(() => ({
  opened: [] as { name: string; location: string }[],
  ran: [] as string[],
  removed: [] as string[],
}))

vi.mock('@op-engineering/op-sqlite', () => ({
  open: (options: { name: string; location: string }) => {
    native.opened.push({ name: options.name, location: options.location })
    return {
      execute: async (sql: string) => {
        native.ran.push(sql)
        return { rows: [] }
      },
      close: () => undefined,
    }
  },
}))

vi.mock('@dr.pogodin/react-native-fs', () => ({
  exists: async () => true,
  unlink: async (path: string) => {
    native.removed.push(path)
  },
}))

vi.mock('./deviceSecrets', () => ({ givenNamesSecrets: {} }))

vi.mock('./storePassphrase', () => ({
  openStorePassphrase: async () => ({
    held: true,
    passphrase: 'a passphrase',
    minted: false,
  }),
}))

describe('the page of what looking for contacts found (#402)', () => {
  it('lives in the notebook file that leaving the account erases', async () => {
    const book = await openNotebook('/store')

    expect(book.opened).toBe(true)
    // One file for every page: the tables of #402 are created through it.
    expect(native.opened).toEqual([
      { name: 'given-names.sqlite', location: '/store' },
    ])
    for (const table of ['discovery_results', 'discovery_fingerprint_key']) {
      expect(
        native.ran.some(sql =>
          sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table}`),
        ),
      ).toBe(true)
    }

    expect(await forgetNotebook('/store')).toBe(true)
    expect(native.removed).toContain('/store/given-names.sqlite')
  })
})
