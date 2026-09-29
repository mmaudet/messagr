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
// téléphone : la copie est celle que le serveur garde depuis l'envoi.
//
// # Ce que fait l'ouverture, et seulement à la demande
//
// 1. Elle télécharge la copie chiffrée avec le compte d'exploitation, sur le
//    serveur de ce compte, jamais ailleurs : l'hôte que l'adresse nomme n'est
//    qu'un segment du chemin, et le jeton ne part que vers le serveur des
//    identifiants (`mediaDownloader`).
// 2. Elle vérifie l'empreinte de ce qu'elle a reçu, et refuse tout fichier
//    qui ne correspond pas : ce ne serait pas celui que l'appareil a signalé.
//    Rien n'est alors déchiffré ni écrit.
// 3. Elle déchiffre en mémoire, en AES-256-CTR, comme Matrix chiffre un
//    fichier.
// 4. Elle l'écrit dans un répertoire privé (700, le fichier en 600), sous le
//    répertoire temporaire du système, que ni Time Machine ni Spotlight ne
//    parcourent sur un Mac, le montre, puis l'efface, quoi qu'il arrive, y
//    compris quand la visionneuse échoue. Le répertoire doit avoir disparu
//    ensuite, ce qui est vérifié ; et chaque ouverture efface d'abord ce
//    qu'une ouverture interrompue aurait laissé (`PREFIX`).
//
// Montrer un fichier, sur un Mac, demande qu'il existe le temps qu'Aperçu le
// lise : c'est la seule copie déchiffrée qui existe, et elle ne dure que le
// temps de la regarder. La clé de l'exploitant et le jeton du compte ne
// s'affichent jamais.

import { Buffer } from 'node:buffer'
import { createDecipheriv, createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/**
 * Le début du nom du répertoire privé de chaque ouverture. Tout ce qui le
 * porte, sous le répertoire temporaire, est une copie qu'une ouverture
 * interrompue a laissée, et la suivante l'efface.
 */
export const PREFIX = 'messagr-signalement-'

/** Combien de temps le homeserver a pour rendre un fichier. */
const DOWNLOAD_DEADLINE_MS = 120_000

/**
 * Une adresse de média Matrix : le nom d'un serveur, puis l'identifiant du
 * média, dans l'alphabet que la spécification lui donne.
 */
const MXC = /^mxc:\/\/([A-Za-z0-9.:[\]-]+)\/([A-Za-z0-9_-]+)$/
/** Une clé AES-256 en base64url sans remplissage, comme la JWK l'écrit. */
const KEY = /^[A-Za-z0-9_-]{43}$/
/** Seize octets en base64, avec ou sans remplissage. */
const COUNTER = /^[A-Za-z0-9+/]{22}(?:==)?$/
/** Trente-deux octets en base64, avec ou sans remplissage. */
const HASH = /^[A-Za-z0-9+/]{43}=?$/

/**
 * L'extension qui fait reconnaître le fichier à Aperçu, par type. Un type
 * absent d'ici prend l'extension de son nom, si elle est simple.
 */
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
}

/**
 * Ce qu'une ouverture demande au monde, que les essais remplacent.
 *
 * @typedef {object} FilePorts
 * @property {(url: string) => Promise<Uint8Array>} download la copie chiffrée, avec le compte d'exploitation
 * @property {(path: string) => Promise<void>} show montre le fichier écrit là, et rend la main une fois vu
 * @property {string} temporary le répertoire sous lequel la copie privée est écrite
 * @property {(line: string) => void} stderr ce qui s'explique
 */

/**
 * Télécharge, vérifie, déchiffre, montre puis efface le fichier que
 * `reported` décrit (voir l'en-tête).
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportedFile} reported
 * @param {FilePorts} ports
 * @returns {Promise<{ shown: true } | { shown: false, why: string }>}
 */
export async function openReportedFile(
  reported,
  { download, show, temporary, stderr },
) {
  const opening = openingOf(reported.file)
  if (opening === null) {
    return refused(
      'La description de ce fichier ne permet pas de l’ouvrir : il y manque\n' +
        'une adresse de média, une clé de 32 octets, un compteur de 16 octets\n' +
        'ou une empreinte SHA-256. Rien n’a été téléchargé.',
    )
  }

  let ciphertext
  try {
    ciphertext = await download(reported.file.url)
  } catch (cause) {
    return refused(
      `Le fichier ne s’est pas téléchargé : ${cause instanceof Error ? cause.message : 'erreur'}.`,
    )
  }
  const hash = createHash('sha256').update(ciphertext).digest('base64')
  if (unpadded(hash) !== unpadded(opening.hash)) {
    return refused(
      'L’empreinte ne correspond pas : ce n’est pas le fichier que l’appareil a\n' +
        'signalé. Rien n’a été déchiffré, écrit ni montré.',
    )
  }
  stderr(
    'Téléchargé avec le compte d’exploitation ; son empreinte est celle que\n' +
      'le signalement porte : c’est le fichier que l’appareil a signalé.',
  )

  const decipher = createDecipheriv('aes-256-ctr', opening.key, opening.counter)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  for (const left of leftBehind(temporary)) {
    rmSync(join(temporary, left), { recursive: true, force: true })
    stderr(
      `Une copie qu’une ouverture interrompue avait laissée est effacée : ${left}`,
    )
  }
  const directory = mkdtempSync(join(temporary, PREFIX))
  let outcome =
    /** @type {{ shown: true } | { shown: false, why: string }} */ ({
      shown: true,
    })
  try {
    chmodSync(directory, 0o700)
    const path = join(directory, `signalement${extensionOf(reported)}`)
    writeFileSync(path, plaintext, { mode: 0o600, flag: 'wx' })
    await show(path)
  } catch (cause) {
    outcome = refused(
      `Le fichier n’a pas pu être montré : ${cause instanceof Error ? cause.message : 'erreur'}.`,
    )
  } finally {
    plaintext.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
  if (existsSync(directory)) {
    return refused(
      `La copie déchiffrée n’a pas pu être effacée : ${directory}\n` +
        'Effacez ce répertoire vous-même avant toute autre chose.',
    )
  }
  stderr('Effacé : il ne reste aucune copie de ce fichier sur cette machine.')
  return outcome
}

/**
 * Le téléchargement d'un média avec le compte d'exploitation : le point de
 * téléchargement authentifié de Matrix (1.11) du serveur `server`, avec le
 * jeton du compte. L'adresse `mxc://` choisit le média, jamais le serveur à
 * qui le jeton part. Une réponse qui n'est pas un succès lève une erreur qui
 * dit son statut, et rien du jeton.
 *
 * @param {string} server `https://hôte`, celui des identifiants du compte
 * @param {string} accessToken
 * @param {(url: string, init: { method: string, headers: Record<string, string>, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, arrayBuffer: () => Promise<ArrayBuffer> }>} [fetchWith]
 * @returns {(url: string) => Promise<Uint8Array>}
 */
export function mediaDownloader(
  server,
  accessToken,
  fetchWith = globalThis.fetch,
) {
  return async url => {
    const media = MXC.exec(url)
    if (media === null) {
      throw new Error('cette adresse n’est pas celle d’un média du homeserver')
    }
    const response = await fetchWith(
      `${server}/_matrix/client/v1/media/download/` +
        `${encodeURIComponent(media[1])}/${encodeURIComponent(media[2])}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: globalThis.AbortSignal.timeout(DOWNLOAD_DEADLINE_MS),
      },
    )
    if (!response.ok) {
      throw new Error(`le homeserver répond ${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * La clé, le compteur et l'empreinte que `file` décrit, ou `null` quand il
 * en manque un, ou que l'adresse n'est pas celle d'un média.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').EncryptedFile} file
 * @returns {{ key: Buffer, counter: Buffer, hash: string } | null}
 */
function openingOf(file) {
  const { k } = file.key
  if (
    !MXC.test(file.url) ||
    typeof k !== 'string' ||
    !KEY.test(k) ||
    !COUNTER.test(file.iv) ||
    !HASH.test(file.hashes.sha256)
  ) {
    return null
  }
  return {
    key: Buffer.from(k, 'base64url'),
    counter: Buffer.from(file.iv, 'base64'),
    hash: file.hashes.sha256,
  }
}

/**
 * `.jpg`, `.pdf` : ce qui fait reconnaître le fichier à Aperçu. Le nom que
 * l'expéditeur a donné n'est pas repris, seulement une extension simple.
 *
 * @param {import('../../packages/app/src/runtime/reportFormat.ts').ReportedFile} reported
 * @returns {string}
 */
function extensionOf(reported) {
  const byType =
    reported.mimetype === null ? undefined : EXTENSIONS[reported.mimetype]
  if (byType !== undefined) return `.${byType}`
  const byName = /\.([A-Za-z0-9]{1,8})$/.exec(reported.name ?? '')
  return byName === null ? '' : `.${byName[1].toLowerCase()}`
}

/**
 * Ce qu'une ouverture interrompue a laissé sous `temporary`.
 *
 * @param {string} temporary
 * @returns {string[]}
 */
function leftBehind(temporary) {
  return readdirSync(temporary).filter(name => name.startsWith(PREFIX))
}

/**
 * @param {string} base64
 * @returns {string}
 */
function unpadded(base64) {
  return base64.replace(/[=]+$/, '')
}

/**
 * @param {string} why
 * @returns {{ shown: false, why: string }}
 */
function refused(why) {
  return { shown: false, why }
}
