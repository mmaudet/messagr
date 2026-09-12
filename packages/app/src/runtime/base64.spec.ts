import { describe, expect, it } from 'vitest'

import { bytesOf } from './base64'
import { base64Of } from './receiveImage'

describe('bytesOf', () => {
  it('reads every byte value, including the ones above 127', () => {
    // LE SEUL ENDROIT OÙ CE DÉCODAGE PEUT SE TROMPER, et le pendant exact du
    // cas que `receiveImage.spec.ts` pose sur l'encodeur. Un octet au-dessus
    // de 127 mal lu donne un fichier que personne n'ouvrira, et rien ne le
    // signalerait : ni la taille, ni le nom, ni le type.
    const every = new Uint8Array(256)
    for (let value = 0; value < 256; value += 1) every[value] = value

    expect([...bytesOf(base64Of(every))]).toEqual([...every])
  })

  it('reads nothing from nothing', () => {
    expect([...bytesOf('')]).toEqual([])
  })

  it('reads a length the padding has to carry', () => {
    // Un octet et deux octets sont les deux longueurs où le rembourrage
    // décide, et où une boucle écrite de travers rend un octet de trop.
    expect([...bytesOf(base64Of(new Uint8Array([7])))]).toEqual([7])
    expect([...bytesOf(base64Of(new Uint8Array([7, 250])))]).toEqual([7, 250])
  })
})
