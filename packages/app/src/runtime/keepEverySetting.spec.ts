import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import {
  KEEP_EVERY_DEFAULT,
  everyPhotographIsKept,
  keepEveryPhotograph,
} from './keepEverySetting'

function storeHolding(value: string | null): SecretStore {
  return { read: async () => value, write: async () => undefined }
}

const BROKEN: SecretStore = {
  read: async () => {
    throw new Error('the keystore is locked')
  },
  write: async () => {
    throw new Error('the keystore is locked')
  },
}

describe('everyPhotographIsKept', () => {
  it('is off for a device nobody has asked', async () => {
    // OFF PAR DÉFAUT, ET C'EST PORTEUR PLUTÔT QUE POLI. L'amendement du
    // 12 septembre à l'ADR-0006 le dit : un défaut qui enregistre prendrait
    // la décision pour tous ceux qui n'ouvrent jamais Réglages, c'est-à-dire
    // presque tout le monde -- et ce sont exactement les personnes que le
    // refus du 10 septembre protégeait.
    expect(KEEP_EVERY_DEFAULT).toBe(false)
    expect(await everyPhotographIsKept(storeHolding(null))).toBe(false)
    expect(await everyPhotographIsKept(storeHolding(''))).toBe(false)
  })

  it('is on only for a device that said so', async () => {
    expect(await everyPhotographIsKept(storeHolding('on'))).toBe(true)
    expect(await everyPhotographIsKept(storeHolding('off'))).toBe(false)
  })

  it('is off for a value this build does not recognise', async () => {
    // Un magasin écrit par une autre version, ou abîmé. Répondre « garde
    // tout » à quelque chose d'illisible écrirait en clair dans la galerie
    // des images que personne n'a demandé de garder -- et l'ADR est
    // explicite : ce qui a été enregistré reste enregistré.
    expect(await everyPhotographIsKept(storeHolding('yes'))).toBe(false)
  })

  it('is off when the store cannot be read', async () => {
    // MÊME SENS QUE receiptSetting.ts, ET POUR LA MÊME RAISON. Être
    // silencieusement discret est un état dégradé que quelqu'un peut
    // corriger ; être silencieusement bavard en est un qu'il ne peut pas
    // défaire. Ici le bavardage est un fichier en clair dans la
    // photothèque, que le correspondant ne peut plus retirer.
    expect(await everyPhotographIsKept(BROKEN)).toBe(false)
  })
})

describe('keepEveryPhotograph', () => {
  it('says so when the choice could not be kept', async () => {
    // L'écran a besoin de dire que l'interrupteur sera revenu où il était au
    // prochain lancement, plutôt que d'afficher un réglage qui se renie en
    // silence.
    expect(await keepEveryPhotograph(BROKEN, true)).toBe(false)
  })

  it('writes both positions rather than deleting one', async () => {
    // « off » choisi et « off » jamais demandé se lisent pareil aujourd'hui.
    // Le jour où quelque chose veut savoir si la question a été posée, non.
    const written: string[] = []
    const store: SecretStore = {
      read: async () => null,
      write: async value => {
        written.push(value)
      },
    }
    expect(await keepEveryPhotograph(store, true)).toBe(true)
    expect(await keepEveryPhotograph(store, false)).toBe(true)
    expect(written).toEqual(['on', 'off'])
  })
})
