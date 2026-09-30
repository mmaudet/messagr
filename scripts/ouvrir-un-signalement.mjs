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
// ignorés. La clé se lit dans `~/.messagr-exploitation/cle-de-l-exploitant.json`,
// qu'écrit `scripts/cle-de-l-exploitant.mjs`, sauf `--cle`.
//
// Le motif et le compte qui signale, vérifiés, s'affichent sur la sortie
// d'erreur ; la charge, seule, sur la sortie standard, les caractères de
// contrôle écrits `\xNN`. Rien de ce qu'elle porte n'est écrit sur le disque.
//
// # Une photo ou un document, à la demande (#471)
//
//	node scripts/ouvrir-un-signalement.mjs pli.json --ouvrir 2
//	node scripts/ouvrir-un-signalement.mjs pli.json --ouvrir 2 --compte <identifiants>
//
// Le signalement ne porte que la description du fichier chiffré. `--ouvrir`
// efface d'abord ce qu'une ouverture interrompue aurait laissé, puis
// télécharge la copie chiffrée du message nommé avec le compte
// d'exploitation : le fichier que nomme `--compte`, sinon
// `MESSAGR_EXPLOITATION_IDENTIFIANTS`, sinon
// `~/.messagr-exploitation/messagr-eu.json`. Le jeton ne part que vers le
// serveur de ce fichier, et ne s'affiche jamais. L'outil vérifie l'empreinte,
// déchiffre en mémoire, et écrit UNE COPIE DÉCHIFFRÉE TEMPORAIRE : dans un
// répertoire privé (700), un fichier que seul l'exploitant lit (600), sous le
// répertoire temporaire du système. Il l'ouvre dans Aperçu, et l'efface dès
// qu'on appuie sur Entrée ou qu'on finit l'entrée (Ctrl-D), qu'on
// l'interrompt (Ctrl-C, fermeture du terminal), ou qu'Aperçu ou le terminal
// échoue ; toute ouverture commence par effacer une copie qu'une ouverture
// interrompue aurait laissée.
//
// Ce que l'outil ne peut pas garantir : ce qu'Aperçu ou le système gardent
// d'un fichier qu'on leur a confié (une vignette, les documents récents, la
// reprise d'une fenêtre). Il ne le confie à aucune autre application
// qu'Aperçu, qui montre les photos et les PDF.
//
//	node scripts/ouvrir-un-signalement.mjs pli.json --ouvrir-vignette 2
//
// Une photo porte aussi la description de sa vignette quand elle en a une
// (#496) : la conversation dessine une photo depuis sa vignette, et c'est ce
// que la personne qui signale a vu. `--ouvrir-vignette` l'ouvre comme
// `--ouvrir` ouvre la photo, avec le même compte et le même effacement.
//
// # Codes de sortie
//
// 0 ouvert (et, avec `--ouvrir` ou `--ouvrir-vignette`, montré puis
// effacé) ; 1 refusé (le pli ne s'ouvre pas, ou le fichier ne correspond pas
// à son empreinte, ne s'est pas téléchargé, n'a pas pu être montré, ou sa
// copie n'a pas pu être effacée, ce que l'outil dit en la nommant) ; 2 rien
// à ouvrir (l'usage, un fichier illisible, un message sans fichier ou sans
// vignette, un compte illisible) ; 130 interrompu pendant qu'un fichier
// était montré, sa copie effacée.
//
// # Tout se passe dans `lib/`, que les essais exercent
//
// `lib/ouvrir-un-signalement.mjs` ouvre et affiche, et
// `lib/ouvrir-un-fichier-signale.mjs` ouvre un fichier à la demande : le
// compte, le téléchargement, l'empreinte, la copie, Aperçu, l'attente et les
// interruptions. Ce fichier-ci ne fait que leur passer la machine :
// l'environnement, le réseau, `open`, le terminal, les signaux du processus.
//
// Pour essayer, avec la clé de test et un pli scellé pour elle :
//
//	node scripts/ouvrir-un-signalement.mjs \
//	  --cle scripts/fixtures/cle-de-test-de-l-exploitant.json \
//	  scripts/fixtures/signalement-de-test.json

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { quietAboutTypelessModules } from './lib/typescript.mjs'

quietAboutTypelessModules()
const { openTool } = await import('./lib/ouvrir-un-signalement.mjs')
const { terminalAt } = await import('./lib/ouvrir-un-fichier-signale.mjs')

process.exitCode = await openTool(process.argv.slice(2), {
  home: homedir(),
  environment: process.env,
  stdin: readStandardInput,
  stderr: line => process.stderr.write(`${line}\n`),
  stdout: text => process.stdout.write(`${text}\n`),
  fetch: globalThis.fetch,
  run: promisify(execFile),
  terminal: () => terminalAt('/dev/tty'),
  signals: process,
  temporary: tmpdir(),
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
