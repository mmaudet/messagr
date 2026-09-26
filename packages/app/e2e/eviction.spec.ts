import { describe, expect, it } from 'vitest'

import {
  demandTheRotation,
  OTHER_OUTCOMES,
  ROTATED_OUTCOME,
  type OutcomeScreen,
} from './eviction'

/**
 * La garde du banc d'éviction, vue rougir sur son propre incident.
 *
 * # POURQUOI CE FICHIER EXISTE
 *
 * #276 ne reproche pas au test de bout en bout d'être absent : il lui
 * reproche d'être vert sur une éviction ratée. Un correctif qui se contente
 * d'attendre un autre `testID` reproduit le même problème d'un cran plus
 * loin -- il faudrait un banc pour savoir s'il rougit, et un banc ne rougit
 * que sur incident.
 *
 * Alors l'écran est un paramètre, et les quatre écrans possibles sont
 * fabriqués ici. Le cas qui compte est `evict-outcome-no-key` : c'est un
 * SUCCÈS du geste, l'ancien test le prenait pour une preuve de rotation, et
 * la garde doit le refuser.
 *
 * # UN `.spec.ts` DANS `e2e/`
 *
 * Il ne demande aucun appareil : il n'importe pas Detox, et `eviction.ts` non
 * plus. Le harnais Detox ne ramasse que `e2e/**\/*.test.ts` ; vitest ramasse
 * celui-ci. La logique du banc est du code comme un autre, et du code non
 * éprouvé au milieu d'un banc est ce qui a fait #276.
 */

/** Un écran qui montre exactement ce qu'on lui dit, et retient les questions. */
function screenShowing(...visible: readonly string[]): {
  readonly screen: OutcomeScreen
  readonly asked: readonly {
    readonly testID: string
    readonly within: number
  }[]
} {
  const asked: { readonly testID: string; readonly within: number }[] = []
  return {
    asked,
    screen: {
      appeared: async (testID: string, within: number) => {
        asked.push({ testID, within })
        return visible.includes(testID)
      },
    },
  }
}

const IMPATIENT = { within: 30, probe: 3 }

const [NO_KEY, NOTHING_CHANGED, KEY_STILL_VALID] = OTHER_OUTCOMES.map(
  outcome => outcome.testID,
)

describe('la garde qui exige la rotation de la clé', () => {
  it('passe quand la clé du salon a tourné', async () => {
    const { screen } = screenShowing(ROTATED_OUTCOME)

    await expect(demandTheRotation(screen, IMPATIENT)).resolves.toBeUndefined()
  })

  it("rougit quand il n'y avait aucune clé à remplacer", async () => {
    // L'INCIDENT DE #276, EXACTEMENT. Le geste a réussi, la personne est
    // dehors, l'écran affiche une phrase de succès -- et rien n'a tourné.
    // L'ancien test attendait un identifiant partagé par les quatre issues :
    // il passait ici. Celui-ci rougit, et nomme ce qu'il a trouvé.
    const { screen } = screenShowing(NO_KEY)

    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow(NO_KEY)
    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow(
      /n'a pas tourné/,
    )
  })

  it('rougit quand le retrait a été refusé', async () => {
    const { screen } = screenShowing(NOTHING_CHANGED)

    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow(
      NOTHING_CHANGED,
    )
  })

  it('rougit sur le demi-état, et le nomme pour ce qu il est', async () => {
    // Retirée, et sa clé ouvre encore. C'est l'issue la plus dangereuse des
    // quatre, et celle qu'un échec muet ferait passer pour un défaut
    // d'affichage.
    const { screen } = screenShowing(KEY_STILL_VALID)

    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow(
      /demi-état dangereux/,
    )
  })

  it("rougit, et le dit autrement, quand l'écran ne montre rien du tout", async () => {
    // Une issue absente n'est pas une issue ratée, et les deux ne se
    // cherchent pas au même endroit : ici il n'y a pas d'éviction à juger,
    // il y a un écran à retrouver.
    const { screen } = screenShowing()

    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow(
      /n'a rien dit/,
    )
  })

  it('accorde la longue attente à la rotation, et pas aux autres', async () => {
    // L'ORDRE EST LA MOITIÉ DE LA GARDE. Interroger les autres d'abord, ou
    // leur accorder la même patience, ferait attendre deux minutes par issue
    // sur un banc qui a déjà répondu -- et un banc qui dépasse son budget
    // meurt sur le temps plutôt que sur ce qu'il mesure.
    const { screen, asked } = screenShowing(KEY_STILL_VALID)

    await expect(demandTheRotation(screen, IMPATIENT)).rejects.toThrow()

    expect(asked[0]).toEqual({ testID: ROTATED_OUTCOME, within: 30 })
    expect(asked.slice(1).map(question => question.within)).toEqual([3, 3, 3])
  })

  it('nomme toutes les issues présentes plutôt que la première', async () => {
    // Deux phrases à l'écran en même temps ne devraient pas arriver. Si cela
    // arrive, le dire est plus utile que d'en choisir une : c'est alors
    // l'écran qu'il faut regarder, pas l'éviction.
    const { screen } = screenShowing(NO_KEY, KEY_STILL_VALID)

    const refusal = await demandTheRotation(screen, IMPATIENT).catch(
      (cause: unknown) => (cause instanceof Error ? cause.message : ''),
    )

    expect(refusal).toContain(NO_KEY)
    expect(refusal).toContain(KEY_STILL_VALID)
  })

  it('ne cherche jamais l ancien identifiant partagé', async () => {
    // La cause première de #276 : un seul nom pour quatre issues. Si l'un des
    // noms cherchés ici redevenait `evict-outcome`, la garde repasserait sur
    // les quatre sans que rien ne le dise.
    const { screen } = screenShowing()
    await demandTheRotation(screen, IMPATIENT).catch(() => undefined)

    for (const name of [
      ROTATED_OUTCOME,
      ...OTHER_OUTCOMES.map(o => o.testID),
    ]) {
      expect(name).not.toBe('evict-outcome')
      expect(name.startsWith('evict-outcome-')).toBe(true)
    }
  })
})
