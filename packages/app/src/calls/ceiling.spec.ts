import { describe, expect, it } from 'vitest'

import {
  VIDEO_CEILING_BPS,
  capTheFirstEncoding,
  type SendParametersLike,
} from './ceiling'

describe('capTheFirstEncoding', () => {
  it('poses the ceiling on the first encoding and says which', () => {
    // LE RETOUR EST CE QUI REND LA MESURE POSSIBLE. #199 demande deux
    // relevés de débit sur un appel réel ; sans cette valeur au journal,
    // personne ne sait depuis l'extérieur si le plafond a été posé — et un
    // plafond qui n'a pas été posé mesurerait autre chose que ce qu'on croit.
    const parameters: SendParametersLike = { encodings: [{}] }
    expect(capTheFirstEncoding(parameters)).toBe(VIDEO_CEILING_BPS)
    expect(parameters.encodings?.[0]?.maxBitrate).toBe(VIDEO_CEILING_BPS)
  })

  it('mutates what it was given, because the platform demands it', () => {
    // `setParameters` exige qu'on lui redonne l'objet rendu par
    // `getParameters`, modifié en place. Reconstruire un objet neuf fait
    // échouer l'appel sur certaines implémentations, et c'est le genre de
    // contrat qu'on ne redécouvre qu'en production.
    const encoding = {}
    const parameters: SendParametersLike = { encodings: [encoding] }
    capTheFirstEncoding(parameters)
    expect(parameters.encodings?.[0]).toBe(encoding)
  })

  it('leaves the other encodings alone', () => {
    // UNE SIMULCAST FUTURE EN AURAIT PLUSIEURS, et plafonner toutes les
    // couches à la même valeur reviendrait à n'en avoir qu'une — ce qui est
    // le contraire de ce qu'on ferait de la simulcast.
    const parameters: SendParametersLike = {
      encodings: [{}, { maxBitrate: 300_000 }, {}],
    }
    capTheFirstEncoding(parameters)
    expect(parameters.encodings?.[1]?.maxBitrate).toBe(300_000)
    expect(parameters.encodings?.[2]?.maxBitrate).toBeUndefined()
  })

  it('says it did nothing when there is no encoding to cap', () => {
    // Avant que la négociation ait produit une couche, il n'y a rien à
    // plafonner. Ce n'est pas une panne : l'appel marche, à un débit que
    // coturn policera moins gentiment. Le dire vaut mieux que le taire.
    expect(capTheFirstEncoding({})).toBeNull()
    expect(capTheFirstEncoding({ encodings: [] })).toBeNull()
  })

  it('replaces a ceiling that was already there', () => {
    // Une renégociation redonne des paramètres qui portent déjà le nôtre.
    // Le reposer est juste ; le lire comme « déjà fait, ne touche à rien »
    // laisserait un plafond périmé le jour où la constante bouge.
    const parameters: SendParametersLike = {
      encodings: [{ maxBitrate: 99 }],
    }
    expect(capTheFirstEncoding(parameters)).toBe(VIDEO_CEILING_BPS)
    expect(parameters.encodings?.[0]?.maxBitrate).toBe(VIDEO_CEILING_BPS)
  })

  it('is half of what the relay allows, and that is the whole reasoning', () => {
    // coturn : `max-bps=400000`, soit 3 200 000 bit/s par sens. La moitié
    // laisse la place à l'audio, aux retransmissions et à l'encadrement du
    // relais. Ce test n'est pas décoratif : il rougit le jour où quelqu'un
    // remonte le plafond sans toucher à la configuration du relais, qui est
    // exactement le changement dont personne ne verrait la conséquence
    // avant qu'un appel réel se mette à hacher.
    const RELAY_BPS = 400_000 * 8
    expect(VIDEO_CEILING_BPS).toBeLessThanOrEqual(RELAY_BPS / 2)
  })
})
