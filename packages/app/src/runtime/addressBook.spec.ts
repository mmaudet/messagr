import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The platform and the native module, as each test sets them. */
const native = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android',
  module: null as { shareMore: () => Promise<unknown> } | null,
}))

vi.mock('react-native-contacts', () => ({ default: {} }))
vi.mock('react-native', () => ({
  PermissionsAndroid: {},
  Platform: {
    get OS() {
      return native.os
    },
  },
  TurboModuleRegistry: { get: () => native.module },
}))

import { contactOf, shareMoreCards, type Card } from './addressBook'

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

describe('the system choice of the cards shared (#403)', () => {
  beforeEach(() => {
    native.os = 'ios'
    native.module = null
  })

  it('opens Apple’s picker, and answers once it has closed', async () => {
    const opened = vi.fn(async () => undefined)
    native.module = { shareMore: opened }

    await shareMoreCards()

    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('opens nothing on Android, which shares all cards or none', async () => {
    const opened = vi.fn(async () => undefined)
    native.module = { shareMore: opened }
    native.os = 'android'

    await shareMoreCards()

    expect(opened).not.toHaveBeenCalled()
  })

  it('answers all the same in a build without the native half', async () => {
    await expect(shareMoreCards()).resolves.toBeUndefined()
  })
})
