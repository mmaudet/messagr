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
// # Une photo ou un document, à la demande (#471)
//
//	node scripts/ouvrir-un-signalement.mjs pli.json --ouvrir 2
//	node scripts/ouvrir-un-signalement.mjs pli.json --ouvrir 2 --compte <identifiants>
//
// Le signalement ne porte que la description du fichier chiffré. `--ouvrir`
// télécharge la copie chiffrée du message nommé avec le compte
// d'exploitation, dont les identifiants se lisent comme ceux de
// `testflight-reviewer.mjs` : le fichier que nomme `--compte`, sinon
// `MESSAGR_EXPLOITATION_IDENTIFIANTS`, sinon
// `~/.messagr-exploitation/messagr-eu.json`. Le jeton ne part que vers le
// serveur de ce fichier, et ne s'affiche jamais. L'outil vérifie l'empreinte,
// déchiffre en mémoire, écrit le fichier dans un répertoire privé et
// temporaire, l'ouvre dans Aperçu, et l'efface dès que l'exploitant appuie
// sur Entrée, ou l'interrompt : aucune copie ne reste. Aperçu montre les
// photos et les PDF ; l'outil ne confie un fichier à aucune autre
// application, qui pourrait en garder une copie à elle.
//
// Tout se passe dans `lib/ouvrir-un-signalement.mjs` et
// `lib/ouvrir-un-fichier-signale.mjs`, que les essais exercent.
//
// Pour essayer, avec la clé de test et un pli scellé pour elle :
//
//	node scripts/ouvrir-un-signalement.mjs \
//	  --cle scripts/fixtures/cle-de-test-de-l-exploitant.json \
//	  scripts/fixtures/signalement-de-test.json

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createReadStream, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

import { quietAboutTypelessModules } from './lib/typescript.mjs'

quietAboutTypelessModules()
const { openTool } = await import('./lib/ouvrir-un-signalement.mjs')
const { mediaDownloader } = await import('./lib/ouvrir-un-fichier-signale.mjs')

/** Si l'exploitant a interrompu l'outil pendant qu'un fichier était montré. */
let interrupted = false

process.exitCode = await openTool(process.argv.slice(2), {
  home: homedir(),
  stdin: readStandardInput,
  stderr: line => process.stderr.write(`${line}\n`),
  stdout: text => process.stdout.write(`${text}\n`),
  media: theOperatorAccount,
  show: inPreview,
  temporary: tmpdir(),
})
if (interrupted) process.exitCode = 130

/**
 * Le compte d'exploitation, lu comme `testflight-reviewer.mjs` le lit, prêt
 * à télécharger un média sur son propre serveur. La raison d'un refus nomme
 * le fichier et la clé qui manque, jamais une valeur.
 *
 * @param {string | null} named le fichier que `--compte` nomme
 */
async function theOperatorAccount(named) {
  const path =
    named ??
    (process.env.MESSAGR_EXPLOITATION_IDENTIFIANTS ||
      join(homedir(), '.messagr-exploitation', 'messagr-eu.json'))
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {
      ok: false,
      why: `Les identifiants du compte d’exploitation ne se lisent pas : ${path}`,
    }
  }
  const { readCredentials } = await import('./testflight-reviewer.mjs')
  const credentials = readCredentials(text)
  if (!credentials.ok)
    return { ok: false, why: `${path} : ${credentials.reason}` }
  return {
    ok: true,
    download: mediaDownloader(credentials.server, credentials.accessToken),
  }
}

/**
 * Ouvre le fichier dans Aperçu, et rend la main quand l'exploitant a appuyé
 * sur Entrée, ou interrompu l'outil : dans les deux cas, l'appelant efface
 * la copie aussitôt. Une interruption ne tue donc pas l'outil avant
 * l'effacement, elle le hâte.
 *
 * @param {string} path
 */
async function inPreview(path) {
  await promisify(execFile)('open', ['-a', 'Preview', path])
  const how = await seen(
    'Le fichier est ouvert dans Aperçu. Appuyez sur Entrée une fois vu :\n' +
      'il sera effacé de cette machine.\n',
  )
  if (how === 'interrupted') interrupted = true
  if (how === 'no-terminal') {
    throw new Error('aucun terminal où attendre qu’il soit vu')
  }
}

/**
 * Attend Entrée sur le terminal, même quand le pli est venu par l'entrée
 * standard, ou une interruption.
 *
 * @param {string} prompt
 * @returns {Promise<'seen' | 'interrupted' | 'no-terminal'>}
 */
function seen(prompt) {
  return new Promise(resolve => {
    const terminal = createReadStream('/dev/tty')
    const lines = createInterface({ input: terminal })
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
    const done = how => {
      for (const signal of signals) process.off(signal, onSignal)
      lines.close()
      terminal.destroy()
      resolve(how)
    }
    const onSignal = () => done('interrupted')
    for (const signal of signals) process.on(signal, onSignal)
    terminal.once('error', () => done('no-terminal'))
    lines.once('line', () => done('seen'))
    process.stderr.write(prompt)
  })
}

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
