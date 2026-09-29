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
//
// # Ce qui s'affiche (#468)
//
// Un signalement que l'application a fait porte une charge au format que
// `reportFormat.ts` décrit, et que `payloadOf` lit : l'outil montre le compte
// qui signale, l'auteur, la conversation, le motif et l'instant, puis chaque
// message avec son heure et son identifiant d'événement, celui qu'un retrait
// vise. Chaque ligne d'un message commence par « │ », pour qu'aucun texte ne
// se fasse passer pour une ligne de l'outil. Une charge d'une autre forme
// s'affiche telle quelle, et l'outil le dit.
//
// # Une photo ou un document (#471)
//
// Le signalement n'en porte que la description de son fichier chiffré :
// l'outil montre son nom, son type, sa taille et l'adresse de sa copie
// chiffrée, et ne l'ouvre qu'à la demande, pour le message que `--ouvrir`
// nomme. L'ouverture télécharge la copie avec le compte d'exploitation,
// vérifie son empreinte, la montre, puis l'efface
// (`ouvrir-un-fichier-signale.mjs`).

import { readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'

import { open } from '../../packages/app/src/runtime/hpke.ts'
import {
  base64Bytes,
  fromWire,
  payloadOf,
  REPORT_FORMAT,
  REPORT_INFO,
  reportAad,
  unpadded,
} from '../../packages/app/src/runtime/reportFormat.ts'

import { keyPathIn, readKeyFile } from './cle-de-l-exploitant.mjs'
import { openReportedFile } from './ouvrir-un-fichier-signale.mjs'

const USAGE = [
  'usage : node scripts/ouvrir-un-signalement.mjs [--cle <fichier>] [<pli.json>]',
  '          [--ouvrir <n> [--compte <fichier>]]',
  '',
  'Le pli se lit dans le fichier nommé, sinon sur l’entrée standard :',
  '  { "reason": "<motif>", "reporter": "<compte qui signale>", "sealed": "<pli>" }',
  'La clé se lit dans ~/.messagr-exploitation/cle-de-l-exploitant.json,',
  'sauf --cle.',
  '',
  '--ouvrir <n> ouvre, à la demande, la photo ou le document du message n :',
  'téléchargé avec le compte d’exploitation, son empreinte vérifiée, montré',
  'puis effacé. Les identifiants du compte se lisent dans le fichier que',
  'nomme --compte, sinon MESSAGR_EXPLOITATION_IDENTIFIANTS, sinon',
  '~/.messagr-exploitation/messagr-eu.json.',
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
 * @property {(named: string | null) => Promise<MediaAccess>} [media] le compte d'exploitation, lu seulement pour `--ouvrir`, depuis le fichier que `--compte` nomme s'il en nomme un
 * @property {(path: string) => Promise<void>} [show] montre le fichier écrit là, et rend la main une fois vu
 * @property {string} [temporary] le répertoire sous lequel un fichier ouvert est écrit le temps d'être vu
 */

/**
 * Le compte d'exploitation, prêt à télécharger un média, ou pourquoi ses
 * identifiants ne se lisent pas. La raison ne dit jamais le jeton.
 *
 * @typedef {{ ok: true, download: (url: string) => Promise<Uint8Array> } | { ok: false, why: string }} MediaAccess
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
 * motif et le compte qui signale, vérifiés, puis affiche la charge ; avec
 * `--ouvrir <n>`, ouvre ensuite la photo ou le document du message n. Rend le
 * code de sortie : 0 ouvert, 1 refusé, 2 rien à ouvrir (usage, fichier
 * illisible, message sans fichier, compte illisible).
 *
 * @param {string[]} argv
 * @param {OpenPorts} ports
 * @returns {Promise<number>}
 */
export async function openTool(argv, ports) {
  const { home, stdin, stderr, stdout } = ports
  const args = [...argv]
  const keyPath = taken(args, '--cle') ?? keyPathIn(home)
  const asked = taken(args, '--ouvrir')
  const account = taken(args, '--compte')
  if (
    keyPath === '' ||
    asked === '' ||
    account === '' ||
    (account !== null && asked === null) ||
    args.length > 1 ||
    args.some(a => a.startsWith('-'))
  ) {
    stderr(USAGE)
    return 2
  }
  if (asked !== null && !/^[1-9][0-9]{0,5}$/.test(asked)) {
    stderr(
      `--ouvrir attend le numéro d’un message, tel que l’outil l’affiche.\n\n${USAGE}`,
    )
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
  const report = payloadOf(opened.payload)
  if (report === null) {
    stderr(
      'Ce qu’il porte n’est pas un signalement au format 1 : le voici tel quel.',
    )
    stdout(displayable(new TextDecoder().decode(opened.payload), true))
    if (asked === null) return 0
    stderr(
      'Rien à ouvrir : ce qu’il porte n’a pas de message que l’outil lise.',
    )
    return 2
  }
  if (
    report.reason !== opened.reason ||
    report.reportingAccount !== opened.reporter
  ) {
    stderr(
      'Attention : ce qu’il porte nomme un autre motif ou un autre compte qui\n' +
        'signale que ceux que le pli lie. Ce sont ceux du pli qui font foi.',
    )
  }
  stdout(readable(report).join('\n'))
  return asked === null
    ? 0
    : await openOnDemand(report, Number(asked), account, ports)
}

/**
 * Ouvre la photo ou le document du message `wanted` (compté à partir de 1,
 * comme l'outil l'affiche), avec le compte d'exploitation. Rend le code de
 * sortie : 0 montré puis effacé, 1 refusé, 2 rien à ouvrir.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportPayload} report
 * @param {number} wanted
 * @param {string | null} account le fichier d'identifiants que `--compte` nomme
 * @param {OpenPorts} ports
 * @returns {Promise<number>}
 */
async function openOnDemand(
  report,
  wanted,
  account,
  { media, show, temporary, stderr },
) {
  const message = report.messages[wanted - 1]
  if (message === undefined) {
    stderr(
      `Ce signalement n’a pas de message ${wanted} : il en a ${report.messages.length}.`,
    )
    return 2
  }
  if (message.kind === 'text') {
    stderr(
      `Le message ${wanted} ne porte ni photo ni document : rien à ouvrir.`,
    )
    return 2
  }
  if (media === undefined || show === undefined || temporary === undefined) {
    stderr('Cet outil n’a pas de quoi ouvrir un fichier ici.')
    return 2
  }
  const access = await media(account)
  if (!access.ok) {
    stderr(access.why)
    return 2
  }
  const opened = await openReportedFile(message, {
    download: access.download,
    show,
    temporary,
    stderr,
  })
  if (!opened.shown) {
    stderr(opened.why)
    return 1
  }
  return 0
}

/**
 * La valeur de l'option `flag`, retirée de `args` avec elle : `null` quand
 * l'option est absente, `''` quand elle n'a pas de valeur.
 *
 * @param {string[]} args
 * @param {string} flag
 * @returns {string | null}
 */
function taken(args, flag) {
  const at = args.indexOf(flag)
  if (at === -1) return null
  const value = args[at + 1]
  if (value === undefined || value.startsWith('-')) {
    args.splice(at, 1)
    return ''
  }
  args.splice(at, 2)
  return value
}

/**
 * Un signalement ouvert, ligne à ligne, dans l'ordre où l'exploitant le lit.
 * Un message dont l'expéditeur n'est pas l'auteur le dit : l'application
 * n'en écrit pas, et un retrait vise l'auteur. Une photo ou un document se
 * montre par sa description, et par l'option qui l'ouvre : rien n'est
 * téléchargé sans qu'on le demande.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportPayload} report
 * @returns {string[]}
 */
function readable(report) {
  const lines = [
    `compte qui signale : ${displayable(report.reportingAccount, false)}`,
    `auteur             : ${displayable(report.reportedAccount, false)}`,
    `conversation       : ${displayable(report.roomId, false)}`,
    `motif              : ${displayable(report.reason, false)}`,
    `signalé le         : ${instant(report.reportedAt)}`,
  ]
  report.messages.forEach((message, at) => {
    lines.push(
      '',
      `message ${at + 1} sur ${report.messages.length}, écrit le ${instant(message.sentAt)}`,
      `  événement : ${displayable(message.eventId, false)}`,
    )
    if (message.sender !== report.reportedAccount) {
      lines.push(
        `  expéditeur : ${displayable(message.sender, false)}, qui n’est pas l’auteur`,
      )
    }
    if (message.kind === 'text') {
      for (const line of displayable(message.text, true).split('\n')) {
        lines.push(`  │ ${line}`)
      }
      return
    }
    lines.push(
      `  ${message.kind === 'photograph' ? 'photo' : 'document'} : ${statedFile(message)}`,
      `  copie chiffrée : ${displayable(message.file.url, false)}`,
      `  pour l’ouvrir, à la demande : --ouvrir ${at + 1}`,
    )
  })
  return lines
}

/**
 * Le nom, le type et la taille d'un fichier signalé, tels que l'événement
 * les dit.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportedFile} file
 * @returns {string}
 */
function statedFile(file) {
  const name = displayable(file.name ?? 'sans nom', false)
  const type = displayable(file.mimetype ?? 'type non dit', false)
  const size = file.size === null ? 'taille non dite' : `${file.size} octets`
  return `${name} (${type}, ${size})`
}

/**
 * Un instant en millisecondes depuis l'époque, en UTC à la seconde, ou le
 * nombre tel quel s'il ne date rien.
 *
 * @param {number} milliseconds
 * @returns {string}
 */
function instant(milliseconds) {
  const moment = new Date(milliseconds)
  return Number.isNaN(moment.getTime())
    ? String(milliseconds)
    : `${moment.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

/**
 * `text` où chaque caractère de contrôle s'écrit `\xNN`, sauf la tabulation,
 * et le saut de ligne quand `lines` le garde : ce qu'un signalement contient
 * ne pilote pas le terminal de l'exploitant, et un champ d'une ligne n'en
 * fait pas deux.
 *
 * @param {string} text
 * @param {boolean} lines
 * @returns {string}
 */
function displayable(text, lines) {
  let shown = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const control =
      (code < 0x20 && character !== '\t' && (character !== '\n' || !lines)) ||
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
