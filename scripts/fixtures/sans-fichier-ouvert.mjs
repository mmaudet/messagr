// Pour les essais de l'outil d'ouverture qui n'ouvrent aucune photo ni aucun
// document : ce qu'ouvrir un fichier demande à la machine de l'exploitant
// (`FilePorts`, `scripts/lib/ouvrir-un-fichier-signale.mjs`), et qu'aucun de
// ces essais ne doit atteindre. Chaque port lève s'il l'est, et l'essai
// échoue ; `reportedFile.spec.ts` ouvre des fichiers, avec ses doublures.

import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** @returns {never} */
function unreached() {
  throw new Error('aucun fichier ne s’ouvre dans cet essai')
}

/**
 * Les ports d'ouverture d'un fichier, inertes, sauf ce que l'outil
 * appellerait de toute façon.
 */
export function noFileOpened() {
  return {
    environment: {},
    fetch: unreached,
    run: unreached,
    terminal: unreached,
    signals: new EventEmitter(),
    temporary: mkdtempSync(join(tmpdir(), 'ouverture-')),
  }
}
