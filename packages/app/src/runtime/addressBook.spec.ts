import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The platform, the system's answers and the native module, as each test sets them. */
const native = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android',
  contacts: 'authorized' as string,
  android: 'granted' as string,
  modules: new Map<string, { shareMore: () => Promise<unknown> }>(),
  traced: [] as { event: string; fields: unknown }[],
}))

vi.mock('react-native-contacts', () => ({
  default: { requestPermission: async () => native.contacts },
}))
vi.mock('react-native', () => ({
  PermissionsAndroid: {
    PERMISSIONS: { READ_CONTACTS: 'android.permission.READ_CONTACTS' },
    RESULTS: { GRANTED: 'granted' },
    request: async () => native.android,
  },
  Platform: {
    get OS() {
      return native.os
    },
  },
  TurboModuleRegistry: {
    get: (name: string) => native.modules.get(name) ?? null,
  },
}))
vi.mock('./log', () => ({
  logEvent: (_level: string, event: string, fields: unknown) =>
    native.traced.push({ event, fields }),
}))

import {
  askForTheAddressBook,
  contactOf,
  shareMoreCards,
  type Card,
} from './addressBook'

beforeEach(() => {
  native.os = 'ios'
  native.modules.clear()
  native.traced.length = 0
})

const card = (over: Partial<Card>): Card => ({
  displayName: null,
  givenName: null,
  middleName: '',
  familyName: '',
  company: null,
  phoneNumbers: [],
  ...over,
})

describe('a card read as a contact', () => {
  it('takes the name the system shows for it', () => {
    expect(
      contactOf(
        card({
          displayName: 'Paul Martin',
          givenName: 'Paul',
          familyName: 'Martin',
          phoneNumbers: [
            { number: '06 12 34 56 78' },
            { number: '+33 1 23 45 67 89' },
          ],
        }),
      ),
    ).toEqual({
      name: 'Paul Martin',
      numbers: ['06 12 34 56 78', '+33 1 23 45 67 89'],
    })
  })

  it('puts the name together when the system shows none, then falls back to the company', () => {
    expect(
      contactOf(
        card({ givenName: 'Anne', middleName: ' ', familyName: 'Durand' }),
      ).name,
    ).toBe('Anne Durand')
    expect(contactOf(card({ company: 'Boulangerie' })).name).toBe('Boulangerie')
    expect(contactOf(card({})).name).toBe('')
  })
})

describe('what the system allows (#400, #403)', () => {
  it('reads iOS’s answers as all the cards, some of them, or none', async () => {
    for (const [answer, access] of [
      ['authorized', 'all'],
      ['limited', 'some'],
      ['denied', 'none'],
      ['undefined', 'none'],
    ] as const) {
      native.contacts = answer
      expect(await askForTheAddressBook()).toBe(access)
    }
  })

  it('reads Android’s answers as all the cards or none', async () => {
    native.os = 'android'
    for (const [answer, access] of [
      ['granted', 'all'],
      ['denied', 'none'],
      ['never_ask_again', 'none'],
    ] as const) {
      native.android = answer
      expect(await askForTheAddressBook()).toBe(access)
    }
  })
})

describe('the system choice of the cards shared (#403)', () => {
  it('opens Apple’s picker, and answers how many cards were added once it has closed', async () => {
    let close = (_added: number) => {}
    native.modules.set('MessagrContactAccess', {
      shareMore: () =>
        new Promise(done => {
          close = done
        }),
    })

    let answered: number | null = null
    const sharing = shareMoreCards().then(added => {
      answered = added
    })
    await Promise.resolve()
    expect(answered).toBeNull()
    close(2)
    await sharing

    expect(answered).toBe(2)
  })

  it('opens nothing on Android, which shares all cards or none', async () => {
    const opened = vi.fn(async () => 1)
    native.modules.set('MessagrContactAccess', { shareMore: opened })
    native.os = 'android'

    expect(await shareMoreCards()).toBe(0)
    expect(opened).not.toHaveBeenCalled()
  })

  it('says in the trace why the choice could not open, and answers 0', async () => {
    expect(await shareMoreCards()).toBe(0)
    native.modules.set('MessagrContactAccess', {
      shareMore: async () => {
        throw new Error('no key window')
      },
    })
    expect(await shareMoreCards()).toBe(0)

    expect(native.traced).toEqual([
      {
        event: 'MESSAGR_CONTACT_ACCESS_UNREAD',
        fields: { unread: 'noModule' },
      },
      { event: 'MESSAGR_CONTACT_ACCESS_UNREAD', fields: { unread: 'threw' } },
    ])
  })
})
