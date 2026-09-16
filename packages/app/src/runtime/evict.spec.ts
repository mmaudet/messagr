import { describe, expect, it } from 'vitest'

import {
  evictFrom,
  evictOutcomeTestId,
  type EvictOutcome,
  type RotatingMachine,
} from './evict'
import type { HttpRequester } from './pump'

const SCOPE = '!scope:example.org'
const DEPARTING = '@departing:example.org'

/**
 * A world that records the order things happened in, because the order is
 * what most of these tests are about.
 */
function world(
  overrides: {
    readonly kickFails?: boolean
    readonly rotateFails?: boolean
    readonly rotated?: boolean
  } = {},
) {
  const log: string[] = []
  const kicked: unknown[] = []

  const http: HttpRequester = {
    authedRequest: async (_method, path, _query, body) => {
      if (path.includes('/kick')) {
        if (overrides.kickFails === true) throw new Error('403 forbidden')
        log.push('removed')
        kicked.push(JSON.parse(body ?? '{}'))
        return '{}'
      }
      log.push('sent')
      return '{}'
    },
  }

  const machine: RotatingMachine = {
    takeOutgoingRequests: async () => [],
    markRequestSent: async () => undefined,
    markRequestFailed: async () => undefined,
    discardScopeKey: async () => {
      if (overrides.rotateFails === true) throw new Error('store unavailable')
      log.push('rotated')
      return overrides.rotated ?? true
    },
  }

  return { http, machine, log, kicked }
}

describe('evicting somebody', () => {
  it('removes them and reports that the key was replaced', async () => {
    const w = world()
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toEqual({ evicted: true, rotated: true })
    expect(w.kicked).toEqual([{ user_id: DEPARTING }])
  })

  it('removes them before it rotates the key', async () => {
    // THE ORDER THIS GESTURE EXISTS FOR, and the mirror of vouching's. No new
    // key is made by the rotation: the replacement is created at the next
    // send, which shares it with whoever is a member THEN. Rotating first and
    // sending before the removal has landed hands the fresh key to the very
    // person it was rotated away from.
    const w = world()
    await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(w.log.indexOf('removed')).toBeLessThan(w.log.indexOf('rotated'))
  })

  it('passes a rotation that found nothing through as itself', async () => {
    // `false` means this device had not encrypted here, so no key out there
    // came from it. Not a failure -- but not the same fact as a rotation
    // either, and the ticket asks the test to assert the rotation rather than
    // the membership change, which is only possible if the two are told
    // apart.
    const w = world({ rotated: false })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toEqual({ evicted: true, rotated: false })
  })

  it('changes nothing at all when the removal is refused', async () => {
    // Nothing to undo: the rotation never ran, so the conversation is exactly
    // as it was. A rotation here would have cost the remaining members a key
    // change for an eviction that did not happen.
    const w = world({ kickFails: true })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'removing' })
    expect(w.log).not.toContain('rotated')
  })

  it('names the half-state where they are out and still hold a key', async () => {
    // The one failure that leaves something worth acting on: removed, not
    // rotated. A caller told only "eviction failed" would reasonably assume
    // nothing happened and stop, leaving a departed party reading everything
    // sent afterwards.
    const w = world({ rotateFails: true })
    const outcome = await evictFrom(w.http, w.machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'rotating' })
    if (outcome.evicted) return
    expect(outcome.rotated).toBe(false)
    expect(w.log).toContain('removed')
  })

  it('reports what the rotation did even when the drain fails afterwards', async () => {
    // The rotation is local and has already happened; a drain that failed
    // does not undo it. Reporting `rotated: false` here would send somebody
    // to redo something that is done.
    const w = world()
    const machine: RotatingMachine = {
      ...w.machine,
      takeOutgoingRequests: async () => {
        throw new Error('the queue could not be read')
      },
    }
    const outcome = await evictFrom(w.http, machine, SCOPE, DEPARTING)

    expect(outcome).toMatchObject({ evicted: false, stage: 'settling' })
    if (outcome.evicted) return
    expect(outcome.rotated).toBe(true)
  })
})

/**
 * L'identifiant sous lequel chaque issue se montre, épinglé sur des chaînes
 * écrites en toutes lettres.
 *
 * # POURQUOI CES QUATRE CHAÎNES SONT ÉCRITES ICI
 *
 * Elles sont le contrat entre l'écran et le banc : `Evict.tsx` les pose,
 * `e2e/eviction.ts` les attend. Un test qui les dériverait de la fonction
 * qu'il éprouve ne dirait rien -- une fonction qui rendrait « x » partout le
 * passerait. Alors elles sont recopiées, et c'est cette recopie qui fait la
 * garde.
 *
 * #276 : l'écran portait un seul identifiant pour les quatre, le test
 * l'attendait, et il passait donc aussi sur une éviction échouée.
 */
describe("le nom sous lequel une issue d'éviction se montre", () => {
  const RETIREE_CLE_TOURNEE: EvictOutcome = { evicted: true, rotated: true }
  const RETIREE_SANS_CLE: EvictOutcome = { evicted: true, rotated: false }
  const RIEN_CHANGE: EvictOutcome = {
    evicted: false,
    stage: 'removing',
    reason: '403 forbidden',
    rotated: false,
  }
  const CLE_TOUJOURS_VALIDE: EvictOutcome = {
    evicted: false,
    stage: 'rotating',
    reason: 'store unavailable',
    rotated: false,
  }
  const DRAINAGE_MANQUE: EvictOutcome = {
    evicted: false,
    stage: 'settling',
    reason: 'the queue could not be read',
    rotated: true,
  }

  it('nomme la rotation, et elle seule', () => {
    expect(evictOutcomeTestId(RETIREE_CLE_TOURNEE)).toBe(
      'evict-outcome-rotated',
    )
  })

  it("donne un autre nom au succès où il n'y avait aucune clé", () => {
    // LE CAS QUI FAISAIT PASSER LE TEST POUR RIEN. C'est un succès, et ce
    // n'est pas une rotation : un banc qui assert « la clé a tourné » ne doit
    // pas pouvoir être satisfait par lui.
    expect(evictOutcomeTestId(RETIREE_SANS_CLE)).toBe('evict-outcome-no-key')
  })

  it('donne un nom à chacun des deux échecs', () => {
    expect(evictOutcomeTestId(RIEN_CHANGE)).toBe(
      'evict-outcome-nothing-changed',
    )
    expect(evictOutcomeTestId(CLE_TOUJOURS_VALIDE)).toBe(
      'evict-outcome-key-still-valid',
    )
    // Une phrase, un nom : `settling` et `rotating` disent la même chose à
    // l'écran -- la personne est dehors et une clé ouvre encore -- donc ils
    // se montrent sous le même nom.
    expect(evictOutcomeTestId(DRAINAGE_MANQUE)).toBe(
      'evict-outcome-key-still-valid',
    )
  })

  it('ne montre jamais deux issues distinctes sous le même nom', () => {
    // La propriété qui compte, prise d'un coup : si deux issues que l'écran
    // distingue partageaient un identifiant, le banc ne pourrait plus les
    // distinguer non plus, et c'est exactement le défaut de #276.
    const noms = [
      RETIREE_CLE_TOURNEE,
      RETIREE_SANS_CLE,
      RIEN_CHANGE,
      CLE_TOUJOURS_VALIDE,
    ].map(evictOutcomeTestId)

    expect(new Set(noms).size).toBe(noms.length)
    // Et aucun ne s'appelle comme l'ancien identifiant partagé : un banc qui
    // l'attendrait encore ne trouverait rien, au lieu de passer.
    expect(noms).not.toContain('evict-outcome')
  })
})
