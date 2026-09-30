// Ouvrir à la demande une photo ou un document signalé, sur la machine de
// l'exploitant (#471, ADR 0015). L'outil d'ouverture
// (`ouvrir-un-signalement.mjs`) l'appelle pour `--ouvrir <n>`.
//
// # Ce qu'un signalement porte d'un fichier
//
// Pas le fichier : la description de son fichier chiffré, tel que
// l'événement la portait (`reportFormat.ts`). L'adresse de sa copie chiffrée
// sur le homeserver, la clé qui l'ouvre, le compteur de départ et
// l'empreinte SHA-256 de la copie chiffrée. Rien n'a été renvoyé depuis le
// téléphone : la copie est celle que le serveur garde depuis l'envoi. Ce qui
// rend une description ouvrable se dit une fois, pour l'application et pour
// cet outil (`openingOf`).
//
// Une photo porte de même la description de sa vignette quand elle en a une
// (#496), avec sa clé à elle : la conversation dessine une photo depuis sa
// vignette. `--ouvrir-vignette` l'ouvre comme `--ouvrir` ouvre la photo.
//
// # Une ouverture, dans cet ordre
//
// 1. Elle efface d'abord ce qu'une ouverture interrompue aurait laissé
//    (`PREFIX`), avant de lire le compte, de télécharger ou de vérifier
//    quoi que ce soit.
// 2. Elle lit le compte d'exploitation (`compte-d-exploitation.mjs`) et
//    télécharge la copie chiffrée sur le serveur de ce compte, jamais
//    ailleurs : l'hôte que l'adresse nomme n'est qu'un segment du chemin, et
//    le jeton ne part que vers le serveur des identifiants. Il ne s'affiche
//    jamais.
// 3. Elle vérifie l'empreinte de ce qu'elle a reçu, et refuse tout fichier
//    qui ne correspond pas : ce ne serait pas celui que l'appareil a signalé.
//    Rien n'est alors déchiffré ni écrit.
// 4. Elle déchiffre en mémoire, en AES-256-CTR, comme Matrix chiffre un
//    fichier.
// 5. Elle écoute les interruptions (Ctrl-C, fermeture du terminal, arrêt),
//    puis seulement écrit le fichier dans un répertoire privé (700, le
//    fichier en 600), sous le répertoire temporaire du système, que ni Time
//    Machine ni Spotlight ne parcourent sur un Mac. Elle le confie à Aperçu,
//    et attend Entrée sur le terminal.
// 6. Elle efface la copie dès qu'on appuie sur Entrée, qu'on interrompt
//    l'outil, ou que la visionneuse ou le terminal échoue, puis vérifie que
//    le répertoire a disparu. Elle lâche le terminal et rend la main
//    aussitôt, sans attendre une autre ligne (`terminalAt`, #496).
//
// # Ce que l'outil ne peut pas garantir
//
// Montrer un fichier, sur un Mac, demande qu'il existe le temps qu'Aperçu le
// lise : c'est la seule copie déchiffrée que l'outil écrit, et il l'efface.
// Ce qu'Aperçu, ou le système, garde d'un fichier qu'on lui a confié, l'outil
// ne peut pas en répondre : une vignette, une liste de documents récents, une
// reprise de fenêtre. Il ne confie un fichier à aucune autre application
// qu'Aperçu, qui n'enregistre pas ce qu'il ne fait que montrer. Un outil tué
// sans pouvoir réagir (`kill -9`, une panne de courant) laisse sa copie
// jusqu'à l'ouverture suivante, qui l'efface d'abord.

import { Buffer } from 'node:buffer'
import { createDecipheriv, createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ReadStream } from 'node:tty'

import { openingOf } from '../../packages/app/src/runtime/reportFormat.ts'

import {
  credentialsPathFor,
  readCredentials,
} from './compte-d-exploitation.mjs'

/**
 * Le début du nom du répertoire privé de chaque ouverture. Tout ce qui le
 * porte, sous le répertoire temporaire, est une copie qu'une ouverture
 * interrompue a laissée, et la suivante l'efface d'abord.
 */
export const PREFIX = 'messagr-signalement-'

/** Combien de temps le homeserver a pour rendre un fichier. */
const DOWNLOAD_DEADLINE_MS = 120_000

/** Ce qui interrompt l'outil pendant qu'un fichier est montré. */
const INTERRUPTIONS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** Codes de sortie : montré puis effacé, refusé, rien à ouvrir, interrompu. */
export const SEEN = 0
export const REFUSED = 1
export const NOTHING_TO_OPEN = 2
export const INTERRUPTED = 130

/**
 * Le terminal où attendre Entrée, `path` (`/dev/tty`), lu comme un terminal
 * (#496).
 *
 * PAS `fs.createReadStream`, qui le lisait jusque-là : il lit dans un fil à
 * part une lecture que rien n'annule, et le détruire attend qu'elle finisse,
 * donc qu'une autre ligne arrive. Après Entrée ou Ctrl-C, l'outil effaçait
 * la copie, le disait, et ne rendait pas la main. Un `tty.ReadStream` lit
 * par la boucle d'événements, et le détruire lâche le terminal aussitôt.
 * Sans terminal (ENXIO), l'ouverture lève, et la copie est effacée.
 *
 * @param {string} path
 * @returns {import('node:tty').ReadStream}
 */
export function terminalAt(path) {
  const descriptor = openSync(path, 'r')
  try {
    return new ReadStream(descriptor)
  } catch (cause) {
    closeSync(descriptor)
    throw cause
  }
}

/**
 * `fetch`, dans la part dont une ouverture a besoin.
 *
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, signal: AbortSignal }) => Promise<{ ok: boolean, status: number, arrayBuffer: () => Promise<ArrayBuffer> }>} Fetching
 */

/**
 * Où arrivent les interruptions : `process`, ou ce qu'un essai émet.
 *
 * @typedef {{ on: (signal: string, listener: () => void) => unknown, off: (signal: string, listener: () => void) => unknown }} Signals
 */

/**
 * Ce qu'une ouverture demande à la machine de l'exploitant, que les essais
 * remplacent tout entier.
 *
 * @typedef {object} FilePorts
 * @property {string} home le répertoire personnel de l'exploitant
 * @property {Readonly<Record<string, string | undefined>>} environment l'environnement, qui peut nommer le fichier d'identifiants
 * @property {Fetching} fetch pour télécharger avec le compte d'exploitation
 * @property {(command: string, args: string[]) => Promise<unknown>} run pour confier le fichier à Aperçu
 * @property {() => import('node:stream').Readable} terminal le terminal où attendre Entrée, même quand le pli vient de l'entrée standard : un flux que détruire lâche aussitôt, comme celui de `terminalAt`
 * @property {Signals} signals où arrivent les interruptions
 * @property {string} temporary le répertoire sous lequel la copie privée est écrite
 * @property {(line: string) => void} stderr ce qui s'explique
 */

/**
 * Ouvre la photo ou le document du message `wanted.at` d'un signalement
 * ouvert (compté à partir de 1, comme l'outil l'affiche), ou la vignette de
 * sa photo quand `wanted.thumbnail`, dans l'ordre que dit l'en-tête. Rend le
 * code de sortie : `SEEN`, `REFUSED`, `NOTHING_TO_OPEN` ou `INTERRUPTED`.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportPayload} report
 * @param {{ at: number, thumbnail: boolean }} wanted
 * @param {string | null} account le fichier d'identifiants que `--compte` nomme
 * @param {FilePorts} ports
 * @returns {Promise<number>}
 */
export async function openOnDemand(report, wanted, account, ports) {
  const { stderr } = ports
  // D'ABORD, quoi qu'il arrive ensuite.
  sweep(ports)

  const message = report.messages[wanted.at - 1]
  if (message === undefined) {
    stderr(
      `Ce signalement n’a pas de message ${wanted.at} : il en a ${report.messages.length}.`,
    )
    return NOTHING_TO_OPEN
  }
  if (message.kind === 'text') {
    stderr(
      `Le message ${wanted.at} ne porte ni photo ni document : rien à ouvrir.`,
    )
    return NOTHING_TO_OPEN
  }
  const copy = wanted.thumbnail ? thumbnailOf(message) : fileOf(message)
  if (copy === null) {
    stderr(
      `Le message ${wanted.at} ne porte pas de vignette : rien à ouvrir.\n` +
        `--ouvrir ${wanted.at} ouvre ${message.kind === 'photograph' ? 'la photo elle-même' : 'le document lui-même'}.`,
    )
    return NOTHING_TO_OPEN
  }
  // Toujours là : le signalement ne se lit pas quand un de ses fichiers ne
  // s'ouvre pas (`payloadOf`).
  const opening = openingOf(copy.file)
  if (opening === null) {
    stderr('La description de ce fichier ne permet pas de l’ouvrir.')
    return REFUSED
  }

  const operator = operatorAccount(account, ports)
  if (!operator.ok) {
    stderr(operator.why)
    return NOTHING_TO_OPEN
  }
  let ciphertext
  try {
    ciphertext = await downloaded(opening, operator, ports.fetch)
  } catch (cause) {
    stderr(
      `Le fichier ne s’est pas téléchargé : ${cause instanceof Error ? cause.message : 'erreur'}.`,
    )
    return REFUSED
  }
  const hash = createHash('sha256').update(ciphertext).digest()
  if (!hash.equals(Buffer.from(opening.sha256))) {
    stderr(
      `L’empreinte ne correspond pas : ce n’est pas ${copy.reported}.\n` +
        'Rien n’a été déchiffré, écrit ni montré.',
    )
    return REFUSED
  }
  stderr(
    'Téléchargé avec le compte d’exploitation ; son empreinte est celle que\n' +
      `le signalement porte : c’est ${copy.reported}.`,
  )
  const decipher = createDecipheriv('aes-256-ctr', opening.key, opening.counter)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return showThenErase(plaintext, copy.name, ports)
}

/**
 * Ce qu'une ouverture montre d'un message qui porte un fichier : sa
 * description, le nom de sa copie privée, et ce qu'elle est.
 *
 * @typedef {{ file: import('../../packages/app/src/timeline/encryptedFile.ts').EncryptedFile, name: string, reported: string }} Copy
 */

/**
 * Le fichier du message, que `--ouvrir` ouvre.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportedFile} message
 * @returns {Copy}
 */
function fileOf(message) {
  return {
    file: message.file,
    name: `signalement${extensionOf(message)}`,
    reported: 'le fichier que l’appareil a signalé',
  }
}

/**
 * La vignette de la photo du message, que `--ouvrir-vignette` ouvre, ou
 * `null` quand il n'en porte pas : un document, ou une photo sans vignette.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportedFile} message
 * @returns {Copy | null}
 */
function thumbnailOf(message) {
  if (message.kind !== 'photograph' || message.thumbnail === null) return null
  return {
    file: message.thumbnail.file,
    // Une vignette n'a pas de nom : son type seul dit ce qu'elle est.
    name: `signalement-vignette${extensionOf({ mimetype: message.thumbnail.mimetype, name: null })}`,
    reported: 'la vignette que l’appareil a signalée',
  }
}

/**
 * Écrit `plaintext` dans un répertoire privé sous le nom `name`, le confie à
 * Aperçu, attend Entrée, puis l'efface, les interruptions écoutées depuis
 * avant l'écriture.
 *
 * @param {Buffer} plaintext
 * @param {string} name
 * @param {FilePorts} ports
 * @returns {Promise<number>}
 */
async function showThenErase(
  plaintext,
  name,
  { run, terminal, signals, temporary, stderr },
) {
  // AVANT D'ÉCRIRE : une interruption pendant qu'Aperçu s'ouvre, ou pendant
  // l'attente, doit effacer la copie, et non tuer l'outil qui l'a écrite.
  const interruption = interruptionsOn(signals)
  const directory = mkdtempSync(join(temporary, PREFIX))
  let outcome = SEEN
  try {
    chmodSync(directory, 0o700)
    const path = join(directory, name)
    writeFileSync(path, plaintext, { mode: 0o600, flag: 'wx' })
    await Promise.race([
      run('open', ['-a', 'Preview', path]),
      interruption.arrived,
    ])
    if (!interruption.happened()) {
      stderr(
        'Le fichier est ouvert dans Aperçu. Appuyez sur Entrée une fois vu :\n' +
          'il sera effacé de cette machine.',
      )
      await entered(terminal, interruption.arrived)
    }
    if (interruption.happened()) outcome = INTERRUPTED
  } catch (cause) {
    stderr(
      `Le fichier n’a pas pu être montré, ou vu jusqu’au bout : ${cause instanceof Error ? cause.message : 'erreur'}.`,
    )
    outcome = REFUSED
  } finally {
    plaintext.fill(0)
    rmSync(directory, { recursive: true, force: true })
    interruption.stop()
  }
  if (existsSync(directory)) {
    stderr(
      `La copie déchiffrée n’a pas pu être effacée : ${directory}\n` +
        'Effacez ce répertoire vous-même avant toute autre chose.',
    )
    return REFUSED
  }
  stderr(
    outcome === INTERRUPTED
      ? 'Interrompu : la copie est effacée, il n’en reste rien sur cette machine.'
      : 'Effacé : il ne reste aucune copie de ce fichier sur cette machine.',
  )
  return outcome
}

/**
 * Écoute les interruptions sur `signals` jusqu'à `stop` : tant qu'elle
 * écoute, une interruption n'arrête pas l'outil, elle résout `arrived`.
 *
 * @param {Signals} signals
 */
function interruptionsOn(signals) {
  let happened = false
  /** @type {() => void} */
  let resolve = () => {}
  /** @type {Promise<void>} */
  const arrived = new Promise(settle => {
    resolve = settle
  })
  const onInterruption = () => {
    happened = true
    resolve()
  }
  for (const signal of INTERRUPTIONS) signals.on(signal, onInterruption)
  return {
    arrived,
    happened: () => happened,
    stop: () => {
      for (const signal of INTERRUPTIONS) signals.off(signal, onInterruption)
    },
  }
}

/**
 * Rend la main quand une ligne arrive sur le terminal, ou qu'une
 * interruption arrive ; lève si le terminal ne s'ouvre pas ou ne se lit pas.
 *
 * @param {() => import('node:stream').Readable} terminal
 * @param {Promise<void>} interrupted
 * @returns {Promise<void>}
 */
async function entered(terminal, interrupted) {
  const input = terminal()
  const lines = createInterface({ input })
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        lines.once('line', () => resolve(undefined))
        // ON THE INTERFACE, NOT THE STREAM: readline hands the terminal's
        // error on to its interface, where nothing listening would throw it
        // out of the tool before the copy is erased.
        lines.once('error', reject)
      }),
      interrupted,
    ])
  } finally {
    // DÉTRUIT, ET PAS SEULEMENT LAISSÉ : une lecture reste en cours sur le
    // terminal, et tant qu'elle y est, l'outil ne rend pas la main (#496).
    // Détruire un terminal ouvert par `terminalAt` la fait cesser aussitôt.
    lines.close()
    input.destroy()
  }
}

/**
 * Le compte d'exploitation, lu du fichier que `account` nomme, ou comme
 * `compte-d-exploitation.mjs` le dit ; ou pourquoi il ne se lit pas, sans
 * rien de ce qu'il porte.
 *
 * @param {string | null} account
 * @param {Pick<FilePorts, 'environment' | 'home'>} ports
 * @returns {{ ok: true, server: string, accessToken: string } | { ok: false, why: string }}
 */
function operatorAccount(account, { environment, home }) {
  const path = credentialsPathFor(account, environment, home)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {
      ok: false,
      why: `Les identifiants du compte d’exploitation ne se lisent pas : ${path}`,
    }
  }
  const credentials = readCredentials(text)
  return credentials.ok
    ? {
        ok: true,
        server: credentials.server,
        accessToken: credentials.accessToken,
      }
    : { ok: false, why: `${path} : ${credentials.reason}` }
}

/**
 * La copie chiffrée du média que `opening` nomme, par le point de
 * téléchargement authentifié de Matrix (1.11) du serveur du compte, avec
 * son jeton. Le serveur que l'adresse nomme n'est qu'un segment du chemin.
 * Une réponse qui n'est pas un succès lève une erreur qui dit son statut,
 * et rien du jeton.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').Opening} opening
 * @param {{ server: string, accessToken: string }} operator
 * @param {Fetching} fetch
 * @returns {Promise<Uint8Array>}
 */
async function downloaded(opening, operator, fetch) {
  const response = await fetch(
    `${operator.server}/_matrix/client/v1/media/download/` +
      `${encodeURIComponent(opening.server)}/${encodeURIComponent(opening.mediaId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${operator.accessToken}` },
      signal: globalThis.AbortSignal.timeout(DOWNLOAD_DEADLINE_MS),
    },
  )
  if (!response.ok) {
    throw new Error(`le homeserver répond ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * `.jpeg`, `.pdf` : ce qui fait reconnaître le fichier à Aperçu. Le sous-type
 * du type qu'il déclare quand il est simple, sinon l'extension de son nom
 * quand elle l'est ; le nom lui-même n'est pas repris.
 *
 * @param {{ mimetype: string | null, name: string | null }} file
 * @returns {string}
 */
function extensionOf(file) {
  const byType = /^[a-z]+\/([a-z0-9]{1,8})$/.exec(file.mimetype ?? '')?.[1]
  const byName = /\.([A-Za-z0-9]{1,8})$/
    .exec(file.name ?? '')?.[1]
    ?.toLowerCase()
  const extension = byType ?? byName
  return extension === undefined ? '' : `.${extension}`
}

/**
 * Efface ce qu'une ouverture interrompue a laissé sous `temporary`, et le
 * dit ; rien d'autre.
 *
 * @param {Pick<FilePorts, 'temporary' | 'stderr'>} ports
 */
function sweep({ temporary, stderr }) {
  for (const left of readdirSync(temporary)) {
    if (!left.startsWith(PREFIX)) continue
    rmSync(join(temporary, left), { recursive: true, force: true })
    stderr(
      `Une copie qu’une ouverture interrompue avait laissée est effacée : ${left}`,
    )
  }
}
