// Ouvrir un signalement sur la machine de l'exploitant (#465, ADR 0015).
// L'entrée en ligne de commande est `scripts/ouvrir-un-signalement.mjs` ; la
// clé se garde à côté, dans `cle-de-l-exploitant.mjs`.
//
// # Rien n'est recopié de l'application
//
// Le HPKE est celui de l'application (`hpke.ts`, vérifié sur les vecteurs de
// la RFC 9180), et le format d'un signalement aussi (`reportFormat.ts`) : ce
// que l'application scelle, cet outil l'ouvre par le même code. Qu'il ouvre
// aussi ce que scelle une seconde construction, indépendante
// (`scripts/fixtures/hpke-independant.mjs`), c'est `sealedReport.spec.ts` qui
// le vérifie.
//
// Ce qu'un signalement contient n'est écrit nulle part (ADR 0006) : il
// s'affiche, et c'est tout.

import { readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'

import { open } from '../../packages/app/src/runtime/hpke.ts'
import {
  base64Bytes,
  fromWire,
  REPORT_FORMAT,
  REPORT_INFO,
  reportAad,
  unpadded,
} from '../../packages/app/src/runtime/reportFormat.ts'

import { keyPathIn, readKeyFile } from './cle-de-l-exploitant.mjs'

const USAGE = [
  'usage : node scripts/ouvrir-un-signalement.mjs [--cle <fichier>] [<pli.json>]',
  '',
  'Le pli se lit dans le fichier nommé, sinon sur l’entrée standard :',
  '  { "reason": "<motif>", "reporter": "<compte qui signale>", "sealed": "<pli>" }',
  'La clé se lit dans ~/.messagr-exploitation/cle-de-l-exploitant.json,',
  'sauf --cle.',
].join('\n')

const DOES_NOT_OPEN = [
  'Ce pli ne s’ouvre pas avec cette clé. Il a été scellé pour une autre clé,',
  'ou bien son motif, son compte qui signale ou son contenu ne sont plus ceux',
  'que l’appareil a scellés. Rien n’est affiché.',
].join('\n')

/**
 * Ce que l'outil d'ouverture demande au monde, que les essais remplacent.
 *
 * @typedef {object} OpenPorts
 * @property {string} home le répertoire personnel de l'exploitant
 * @property {() => Promise<string | null>} stdin l'entrée standard, ou `null` quand c'est un terminal
 * @property {(line: string) => void} stderr ce qui s'explique, sur la sortie d'erreur
 * @property {(text: string) => void} stdout la charge, seule, sur la sortie standard
 */

/**
 * Ouvre un pli avec `secretKey`, pour le motif et le compte qui signale que
 * le service a gardés en clair. Refuse tout pli qu'un de ces deux-là, ou un
 * seul octet, sépare de ce que l'appareil a scellé.
 *
 * @param {Uint8Array} secretKey
 * @param {{ reason: string, reporter: string, sealed: string }} document
 * @returns {{ opened: true, payload: Uint8Array, reason: string, reporter: string } | { opened: false, why: string }}
 */
export function openSealedReport(secretKey, document) {
  const { reason, reporter, sealed } = document
  let aad
  try {
    aad = reportAad({ reason, reporter })
  } catch {
    return refused(
      'Le motif ou le compte qui signale n’a pas la forme que le format lie :\n' +
        'de 1 à 255 caractères ASCII imprimables, sans espace.',
    )
  }
  const wire = base64Bytes(sealed)
  if (wire === null) return refused('Le pli n’est pas en base64 standard.')
  const unwired = fromWire(wire)
  if (!unwired.ok) {
    return refused(
      unwired.refusal === 'format'
        ? `Ce pli n’est pas au format ${REPORT_FORMAT} des signalements.`
        : 'Ce pli n’a pas la taille d’un signalement.',
    )
  }
  const plaintext = open(secretKey, unwired.sealed, REPORT_INFO, aad)
  if (plaintext === null) return refused(DOES_NOT_OPEN)
  const payload = unpadded(plaintext)
  if (payload === null) {
    return refused(
      'Ce pli s’ouvre, mais il n’est pas complété comme le format le veut :\n' +
        'ce qui l’a scellé ne suit pas `reportFormat.ts`.',
    )
  }
  return { opened: true, payload, reason, reporter }
}

/**
 * L'outil d'ouverture : ouvre un pli avec la clé de l'exploitant, dit le
 * motif et le compte qui signale, vérifiés, puis affiche la charge. Rend le
 * code de sortie : 0 ouvert, 1 refusé, 2 rien à ouvrir (usage, fichier
 * illisible).
 *
 * @param {string[]} argv
 * @param {OpenPorts} ports
 * @returns {Promise<number>}
 */
export async function openTool(argv, { home, stdin, stderr, stdout }) {
  const args = [...argv]
  let keyPath = keyPathIn(home)
  const named = args.indexOf('--cle')
  if (named !== -1) {
    keyPath = args[named + 1] ?? ''
    args.splice(named, 2)
  }
  if (keyPath === '' || args.length > 1 || args.some(a => a.startsWith('-'))) {
    stderr(USAGE)
    return 2
  }

  const keyText = readText(keyPath)
  if (keyText === null) {
    stderr(`La clé de l’exploitant ne se lit pas : ${keyPath}`)
    return 2
  }
  const key = readKeyFile(keyText)
  if (!key.ok) {
    stderr(`${keyPath} : ${key.why}`)
    return 2
  }

  const documentText = args.length === 1 ? readText(args[0]) : await stdin()
  if (documentText === null) {
    stderr(
      args.length === 1
        ? `Le pli ne se lit pas : ${args[0]}`
        : `Aucun pli : nommez son fichier, ou passez-le sur l’entrée standard.\n\n${USAGE}`,
    )
    return 2
  }
  let document
  try {
    document = JSON.parse(documentText)
  } catch {
    stderr('Le pli n’est pas du JSON.')
    return 2
  }
  const missing = ['reason', 'reporter', 'sealed'].filter(
    field => typeof document?.[field] !== 'string',
  )
  if (missing.length > 0) {
    stderr(`Il manque au pli : ${missing.join(', ')}.\n\n${USAGE}`)
    return 2
  }

  const opened = openSealedReport(key.secretKey, document)
  if (!opened.opened) {
    stderr(opened.why)
    return 1
  }
  stderr(
    [
      'Signalement ouvert avec la clé de l’exploitant.',
      `  motif              : ${opened.reason}`,
      `  compte qui signale : ${opened.reporter}`,
      'Le service a gardé ces deux valeurs en clair, et le pli les lie :',
      'ce sont celles que l’appareil a scellées. Ce qu’il porte suit.',
    ].join('\n'),
  )
  stdout(displayable(opened.payload))
  return 0
}

/**
 * Le texte d'une charge, où chaque caractère de contrôle, sauf la tabulation
 * et le saut de ligne, s'écrit `\xNN` : ce qu'un signalement contient ne pilote
 * pas le terminal de l'exploitant.
 *
 * @param {Uint8Array} payload
 * @returns {string}
 */
function displayable(payload) {
  let shown = ''
  for (const character of new TextDecoder().decode(payload)) {
    const code = character.codePointAt(0) ?? 0
    const control =
      (code < 0x20 && character !== '\t' && character !== '\n') ||
      (code >= 0x7f && code <= 0x9f)
    shown += control ? `\\x${code.toString(16).padStart(2, '0')}` : character
  }
  return shown
}

/**
 * @param {string} why
 * @returns {{ opened: false, why: string }}
 */
function refused(why) {
  return { opened: false, why }
}

/**
 * @param {string} path
 * @returns {string | null}
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
