import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native-contacts', () => ({ default: {} }))

import { contactOf, type Card } from './addressBook'

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
