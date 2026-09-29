#!/usr/bin/env node
//
// Ouvrir un signalement sur la machine de l'exploitant (#465, ADR 0015).
//
// Le service garde un pli qu'il ne peut pas ouvrir, avec en clair le motif et
// le compte qui signale. Cet outil l'ouvre avec la moitié privée de la clé de
// l'exploitant, et refuse un pli dont le motif ou le compte qui signale a
// changé depuis l'appareil : le scellement les lie.
//
// # Le geste
//
//	node scripts/ouvrir-un-signalement.mjs pli.json
//	node scripts/ouvrir-un-signalement.mjs < pli.json
//	node scripts/ouvrir-un-signalement.mjs --cle <fichier de clé> pli.json
//
// Le pli est un document JSON : `{ "reason": "<motif>", "reporter": "<compte
// qui signale>", "sealed": "<pli en base64>" }`, les autres champs étant
// ignorés. L'export d'un pli par le service, qui reste à écrire (#473), doit
// avoir cette forme.
// La clé se lit dans `~/.messagr-exploitation/cle-de-l-exploitant.json`,
// qu'écrit `scripts/cle-de-l-exploitant.mjs`, sauf `--cle`.
//
// Le motif et le compte qui signale, vérifiés, s'affichent sur la sortie
// d'erreur ; la charge, seule, sur la sortie standard, les caractères de
// contrôle écrits `\xNN`. Rien de ce qui est ouvert n'est écrit sur le disque
// (ADR 0006). Codes de sortie : 0 ouvert, 1 refusé, 2 rien à ouvrir.
//
// Tout se passe dans `lib/exploitant.mjs`, que les essais exercent.
//
// Pour essayer, avec la clé de test et un pli scellé pour elle :
//
//	node scripts/ouvrir-un-signalement.mjs \
//	  --cle scripts/fixtures/cle-de-test-de-l-exploitant.json \
//	  scripts/fixtures/signalement-de-test.json

import { Buffer } from 'node:buffer'
import { homedir } from 'node:os'

import { quietAboutTypelessModules } from './lib/typescript.mjs'

quietAboutTypelessModules()
const { openTool } = await import('./lib/exploitant.mjs')

process.exitCode = await openTool(process.argv.slice(2), {
  home: homedir(),
  stdin: readStandardInput,
  say: line => process.stderr.write(`${line}\n`),
  print: text => process.stdout.write(`${text}\n`),
})

/**
 * Tout ce que porte l'entrée standard, ou `null` quand c'est un terminal :
 * personne ne tape un pli à la main, et l'attendre figerait l'outil.
 *
 * @returns {Promise<string | null>}
 */
async function readStandardInput() {
  if (process.stdin.isTTY) return null
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
