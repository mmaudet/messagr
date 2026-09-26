/**
 * The address book, read through the system when the person looks for their
 * contacts (#400): the system's permission, then each card's name and
 * numbers, and nothing else of it.
 *
 * `react-native-contacts` reads the cards. Its Android manifest declares no
 * permission, so this application's manifest is the only place
 * `READ_CONTACTS` can come from, and it does not yet: the owner holds that
 * line for the declarations of the version that carries discovery (#414).
 * Until then the system refuses on Android, and the screen says so.
 *
 * What leaves this module is a name and numbers as written in each card.
 * `findContacts.ts` says what leaves the telephone: masks, and never a name.
 */
import Contacts from 'react-native-contacts'

import type { Contact } from './findContacts'

/**
 * What the system allows: the whole address book, the cards the person chose
 * (iOS's limited access, #403), or nothing.
 */
export type AddressBookAccess = 'all' | 'some' | 'none'

/** Asks the system, which asks the person the first time only. */
export async function askForTheAddressBook(): Promise<AddressBookAccess> {
  const answer = await Contacts.requestPermission()
  return answer === 'authorized'
    ? 'all'
    : answer === 'limited'
      ? 'some'
      : 'none'
}

/** The cards the system shares, each as a name and its numbers. */
export async function readAddressBook(): Promise<Contact[]> {
  const cards = await Contacts.getAllWithoutPhotos()
  return cards.map(contactOf)
}

/** The part of a card this application reads: see the module's comment. */
export interface Card {
  readonly displayName: string | null
  readonly givenName: string | null
  readonly middleName: string
  readonly familyName: string
  readonly company: string | null
  readonly phoneNumbers: readonly { readonly number: string }[]
}

/**
 * A card as a contact: the name the system shows for it, or its parts, or
 * its company, and every number it holds as written.
 */
export function contactOf(card: Card): Contact {
  const parts = [card.givenName, card.middleName, card.familyName]
    .map(part => part?.trim() ?? '')
    .filter(part => part !== '')
    .join(' ')
  const name = card.displayName?.trim() || parts || card.company?.trim() || ''
  return { name, numbers: card.phoneNumbers.map(phone => phone.number) }
}
