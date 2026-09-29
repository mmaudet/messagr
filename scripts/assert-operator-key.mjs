#!/usr/bin/env node
//
// Quelle clé de l'exploitant une build peut porter, et pourquoi (#465). Les
// autres endroits de ce dépôt qui en parlent renvoient ici.
//
//	node scripts/assert-operator-key.mjs              # le module de l'application
//	node scripts/assert-operator-key.mjs <module.ts>  # un autre, pour les essais
//
// # Pourquoi la clé de test ne part pas
//
// L'application scelle chaque signalement pour la clé que porte
// `packages/app/src/runtime/operatorKey.ts`, et pour aucune autre. La moitié
// privée de la clé de test est dans ce dépôt public
// (`scripts/fixtures/cle-de-test-de-l-exploitant.json`) : ce qui est scellé
// pour elle, n'importe qui l'ouvre. C'est ce qu'il faut aux essais et au
// développement, et c'est ce qu'aucune personne ne doit recevoir.
//
// Dès que l'application envoie des signalements (#468), aucune build qui
// arrive dans les mains d'une personne ne doit donc porter la clé de test.
// Les builds des magasins s'arrêtent ici. Les APK que Firebase App
// Distribution envoie aux testeurs, qu'aucun script de ce dépôt ne fabrique,
// rien ne les arrête : c'est pourquoi #470, qui inscrit la clé de production,
// passe avant.
//
// # Où cette garde est appelée
//
// Avant chaque build qui part vers un magasin :
// - `scripts/publish-ios.sh`, pour TestFlight et l'App Store, et
//   `scripts/build.sh ios` avant de monter le numéro de build ;
// - le workflow Publish, pour Google Play ;
// - `scripts/setup-play-publishing.sh`, pour la première version sur Play.
// Les builds de la CI, des appareils et de `scripts/pixel.sh` ne l'appellent
// pas : elles portent la clé qu'a l'arbre, quelle qu'elle soit.
//
// # Ce qu'elle lit
//
// La valeur que l'application porte, en chargeant le module lui-même sous
// Node, et non un motif dans son texte, lue comme l'application la lit
// (`keyBytesOf`, `reportFormat.ts`). Une valeur qu'elle ne sait pas lire
// (absente, pas 32 octets de base64 standard, un module qui ne se charge pas)
// est refusée comme la clé de test : une garde qui laisse passer ce qu'elle ne
// comprend pas ne garde rien.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { quietAboutTypelessModules } from './lib/typescript.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE = join(HERE, '../packages/app/src/runtime/operatorKey.ts')
const TEST_KEY = join(HERE, 'fixtures/cle-de-test-de-l-exploitant.json')

const path = resolve(process.argv[2] ?? MODULE)

quietAboutTypelessModules()
const { keyBytesOf } =
  await import('../packages/app/src/runtime/reportFormat.ts')
let carried
try {
  carried = (await import(pathToFileURL(path).href)).OPERATOR_KEY
} catch (cause) {
  refuse(`${path} ne se charge pas (${cause.message}).`)
}

if (keyBytesOf(carried) === null) {
  refuse(
    `${path} ne porte pas de clé de l’exploitant lisible : OPERATOR_KEY doit ` +
      'être une clé publique X25519, 32 octets en base64 standard.',
  )
}

const testKey = JSON.parse(readFileSync(TEST_KEY, 'utf8')).public_key
if (carried === testKey) {
  refuse(
    [
      'L’application porte la clé de test de l’exploitant, et une build de',
      'magasin la refuse : sa moitié privée est dans ce dépôt, et n’importe qui',
      'ouvrirait les signalements scellés pour elle (scripts/assert-operator-key.mjs',
      'dit pourquoi, et où cette garde est appelée).',
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
