// L'outil d'ouverture lancé comme on le lance, pour les essais (#465, #473) :
// ce qu'il dit sur la sortie d'erreur, ce qu'il imprime sur la sortie
// standard, et comment il finit. `sealedReport.spec.ts` et
// `exportedReport.spec.ts` le lancent ainsi, avec les mêmes ports : un port
// que l'outil gagne s'ajoute ici, une fois.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTool } from '../lib/ouvrir-un-signalement.mjs'

import { noFileOpened } from './sans-fichier-ouvert.mjs'

/**
 * L'outil lancé avec `argv`, `input` sur son entrée standard (`null` : un
 * terminal, où personne ne tape un pli) et `home` pour répertoire personnel,
 * vide sauf mention contraire. Il n'ouvre aucune photo, aucune vignette ni
 * aucun document : ses ports d'ouverture d'un fichier lèvent s'ils sont
 * atteints (`sans-fichier-ouvert.mjs`).
 *
 * @param {readonly string[]} argv
 * @param {string | null} [input]
 * @param {string} [home]
 * @returns {Promise<{ status: number, said: string, printed: string[] }>}
 */
export async function runTheOpeningTool(
  argv,
  input = '',
  home = mkdtempSync(join(tmpdir(), 'exploitant-')),
) {
  /** @type {string[]} */
  const said = []
  /** @type {string[]} */
  const printed = []
  const status = await openTool([...argv], {
    home,
    stdin: async () => input,
    stderr: line => said.push(line),
    stdout: line => printed.push(line),
    ...noFileOpened(),
  })
  return { status, said: said.join('\n'), printed }
}
