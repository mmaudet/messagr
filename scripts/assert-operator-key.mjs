#!/usr/bin/env node
//
// Une build de magasin refuse la clé de test de l'exploitant (#465).
//
// L'application scelle chaque signalement pour la clé que porte
// `packages/app/src/runtime/operatorKey.ts`. Tant que c'est la clé de test,
// dont la moitié privée est dans ce dépôt public
// (`scripts/fixtures/cle-de-test-de-l-exploitant.json`), n'importe qui ouvre
// ce qu'elle scelle : c'est voulu pour les essais et le développement, et
// c'est ce qu'aucune build envoyée à un magasin ne doit porter. #470 y met la
// clé de production, que `scripts/cle-de-l-exploitant.mjs tirer` imprime.
//
//	node scripts/assert-operator-key.mjs              # le module de l'application
//	node scripts/assert-operator-key.mjs <module.ts>  # un autre, pour les essais
//
// # Où il est appelé, et où il ne l'est pas
//
// Avant toute build qui part vers un magasin : `scripts/publish-ios.sh` (et
// donc `scripts/build.sh ios`, qui le vérifie avant de monter le numéro de
// build) pour TestFlight et l'App Store, et le workflow Publish pour Google
// Play. Jamais dans les builds de la CI ni dans `scripts/pixel.sh`, qui
// portent la clé de test comme tout le développement.
//
// # Ce qu'il lit
//
// La valeur que l'application porte, en chargeant le module lui-même sous
// Node, et non un motif dans son texte. Une valeur qu'il ne sait pas lire
// (absente, pas du base64, pas 32 octets) est refusée comme la clé de test :
// une garde qui laisse passer ce qu'elle ne comprend pas ne garde rien.

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { quietAboutTypelessModules } from './lib/typescript.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE = join(HERE, '../packages/app/src/runtime/operatorKey.ts')
const TEST_KEY = join(HERE, 'fixtures/cle-de-test-de-l-exploitant.json')

const path = resolve(process.argv[2] ?? MODULE)

quietAboutTypelessModules()
let carried
try {
  carried = (await import(pathToFileURL(path).href)).OPERATOR_KEY
} catch (cause) {
  refuse(`${path} ne se charge pas (${cause.message}).`)
}

const bytes =
  typeof carried === 'string' ? Buffer.from(carried, 'base64') : null
if (
  bytes === null ||
  bytes.length !== 32 ||
  bytes.toString('base64') !== carried
) {
  refuse(
    `${path} ne porte pas de clé de l’exploitant lisible : OPERATOR_KEY doit ` +
      'être une clé publique X25519 de 32 octets, en base64 standard.',
  )
}

const testKey = JSON.parse(readFileSync(TEST_KEY, 'utf8')).public_key
if (carried === testKey) {
  refuse(
    [
      'L’application porte encore la clé de test de l’exploitant.',
      'Sa moitié privée est dans ce dépôt : n’importe qui ouvrirait les',
      'signalements scellés pour elle. Une build de magasin la refuse.',
      '',
      'La clé de production se tire sur la machine de l’exploitant (#470) :',
      '  node scripts/cle-de-l-exploitant.mjs tirer <copie hors ligne>',
      `et la ligne qu’il imprime remplace celle de ${path}.`,
    ].join('\n'),
  )
}

console.log(`La clé de l’exploitant n’est pas la clé de test : ${carried}`)

/** @param {string} why */
function refuse(why) {
  console.error(why)
  process.exit(1)
}
