#!/usr/bin/env node
//
// Faire entrer le relecteur d'Apple, qui n'a pas de compte et ne peut en
// avoir un que par une invitation (ADR-0004).
//
// # Pourquoi l'application ne suffit pas
//
// Elle émet pour une heure (`TTL_SECONDS`, `issueInvitation.ts`), et
// l'appareil émetteur ne fait entrer que pendant cette heure
// (`STOP_ASKING_AFTER_MS`, `admitAnyoneWaiting.ts`). Une revue bêta prend en
// général une journée.
//
// Une invitation plus longue ne suffit pas non plus, parce que la réclamation
// se fait en deux appels. Le premier tire un compte et reçoit
// `409 MESSAGR_NOT_YET_INVITED` ; tant que l'émetteur n'invite pas ce compte
// dans la conversation, les suivants reçoivent la même chose. Une invitation
// créée hors de l'application n'est donc admise par personne. `admettre` est
// cette moitié-là, tenue pendant toute la vie de l'invitation.
//
// # Les gestes
//
//	node scripts/testflight-reviewer.mjs emettre [--duree 7j] [--usages 2] [--dry-run]
//	caffeinate -i node scripts/testflight-reviewer.mjs admettre
//	node scripts/testflight-reviewer.mjs etat
//	node scripts/testflight-reviewer.mjs revoquer
//	node scripts/testflight-reviewer.mjs --self-test
//
// Chaque geste prend aussi `--compte <fichier d'identifiants>` (par défaut
// @exploitation) et `--objet <nom>` (par défaut `relecteur-apple`), ou
// `--etat <fichier>`. L'état d'une émission est propre au compte et à
// l'objet : le relecteur d'Apple sous @exploitation et un téléphone du
// porteur sous la racine ne s'écrasent pas.
//
//	node scripts/testflight-reviewer.mjs emettre \
//	  --compte ~/.messagr-exploitation/racine-mmaudet.json --objet pixel \
//	  --duree 1h --usages 1
//
// `docs/publishing-ios.md` dit quand lancer chacun, et ce que verra le
// relecteur.
//
// # Ce qui ne sort jamais d'ici
//
// Le jeton et le mot de passe du compte. Ils sont lus dans le fichier que
// nomme `--compte`, sinon `MESSAGR_EXPLOITATION_IDENTIFIANTS`, sinon
// `~/.messagr-exploitation/messagr-eu.json` ; ils ne partent que vers le
// serveur de ce fichier, et ne sont jamais écrits, affichés ni journalisés :
// ce dépôt est public, et un journal est un endroit où les secrets vont se
// faire trouver.
//
// Le lien fait entrer, il se garde donc comme un secret : dans l'état, en
// chmod 600, hors du dépôt. `emettre` et `etat` l'affichent parce que c'est
// ce qu'on colle dans App Store Connect ; `admettre`, qui tourne des jours et
// dont on redirige volontiers la sortie dans un fichier, ne l'écrit jamais.
//
// # Ce que le service ne dit pas
//
// Combien d'usages il reste. `GET /invitations/{id}` ne rend ni `used_count`
// ni `max_uses` (`handlers/status.rs`), et aucun chemin du service ne change
// le statut d'une invitation dont les usages sont épuisés : seuls `expired`
// et `revoked` s'écrivent. Une invitation à deux usages dont le premier est
// pris lit `claimed`, exactement comme celle dont les deux le sont.
//
// `admettre` ne devine donc pas l'épuisement. Il s'arrête sur `expired`, sur
// `revoked`, sur l'échéance, et sur `claimed` seulement quand l'invitation
// n'avait qu'un usage : c'est le seul cas où ce mot prouve qu'il n'en reste
// aucun, puisque la ligne `claimed` et l'usage consommé s'écrivent dans la
// même transaction (`handlers/claim.rs`). Une garde fondée sur un champ que
// le service n'envoie pas serait verte en test et muette en production.

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import {
  dirname,
  join,
  relative,
  isAbsolute,
  resolve,
  basename,
} from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPOSITORY = resolve(HERE, '..')

const CREDENTIALS_ENV = 'MESSAGR_EXPLOITATION_IDENTIFIANTS'
const PRIVATE_DIRECTORY = join(homedir(), '.messagr-exploitation')
const DEFAULT_CREDENTIALS = join(PRIVATE_DIRECTORY, 'messagr-eu.json')
const DEFAULT_PURPOSE = 'relecteur-apple'

/** Ce que `--dry-run` décrit quand le fichier d'identifiants ne se lit pas. */
const DEFAULT_SERVER = 'https://messagr.eu'
const DEFAULT_EMITTER = '@exploitation:messagr.eu'

// LA FORME D'UNE CONVERSATION DE CE PRODUIT, recopiée de `issueInvitation.ts`
// et relue dans ce fichier par `--self-test`. Une conversation qui ne
// ressemblerait qu'à peu près à celles de l'application montrerait au
// relecteur un produit que personne ne livre : `invite` absent vaut 0 et tout
// membre inviterait, `redact` absent vaut 50 et l'émetteur effacerait les
// mots de l'autre (#196), une version 12 rendrait ce créateur intouchable.
const ROOM_VERSION = '11'
const INVITE_COST = 50
const NOBODY_ELSE_REDACTS = 101
const MEGOLM = 'm.megolm.v1.aes-sha2'

// Les bornes du service (`handlers/create.rs`), relues elles aussi.
const MAX_USES = 10
const MAX_TTL_SECONDS = 30 * 86_400

/** Une journée de revue, et de quoi recommencer une fois. */
const DEFAULT_TTL_SECONDS = 7 * 86_400
const DEFAULT_USES = 2

// LA CADENCE. Vingt à trente secondes au repos : sur sept jours, environ
// vingt-quatre mille lectures, chacune un `whoami` pour le service.
//
// DEUX SECONDES PENDANT QUINZE SECONDES APRÈS UNE INVITATION, parce que la
// personne en face n'attend pas longtemps. `claimInvitation.ts` réclame
// quinze fois à deux secondes d'écart, puis l'application renonce sans
// réessayer ; elle dit alors « Vous n'êtes pas encore entré ». Et un lien
// ouvert par quelqu'un qui a déjà un compte demande DEUX invitations : le
// second compte n'est nommé qu'après la tentative suivante de l'application,
// quelques secondes après la première invitation (`admitDrawnEntrant`). Au
// rythme du repos, il serait presque toujours invité trop tard.
const REST_MIN_MS = 20_000
const REST_SPREAD_MS = 10_000
const FOLLOW_UP_MS = 2_000
const FOLLOW_UP_WINDOW_MS = 15_000

/**
 * Au-delà de l'échéance, avant de s'arrêter sans l'avis du service.
 *
 * L'échéance enregistrée est prise avant l'envoi de la demande, le service
 * prend la sienne à la réception : la nôtre tombe un peu plus tôt. Large de
 * cinq minutes plutôt qu'exacte, pour la raison que donne
 * `STOP_ASKING_AFTER_MS` : s'arrêter trop tôt, c'est quelqu'un qui ne peut
 * pas entrer avec un lien encore bon ; trop tard, quelques lectures de plus.
 */
const DEADLINE_GRACE_MS = 5 * 60_000

/**
 * Combien de réponses « invitation inconnue » d'affilée avant d'abandonner.
 * Une seule pourrait venir d'un déploiement en cours ; trois, c'est un
 * service qui ne connaît pas cette invitation pour ce compte.
 */
const UNKNOWN_ROUNDS_BEFORE_GIVING_UP = 3

/** Une connexion pendue ne doit pas arrêter la boucle pendant des heures. */
const REQUEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Ce qui décide, sans rien toucher. `--self-test` exerce tout ce qui suit.
// ---------------------------------------------------------------------------

/** Un objet JSON, ou `null` pour tout le reste (texte, tableau, rien). */
export function parsedObject(text) {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/** `https://hôte`, sans barre finale ; `null` pour tout ce qui n'est pas https. */
export function serverFrom(raw) {
  if (typeof raw !== 'string') return null
  const match = /^(https:\/\/[^/\s]+)\/*$/.exec(raw.trim())
  return match === null ? null : match[1]
}

/**
 * Le lien, construit comme l'application le construit : `https`, et l'hôte
 * du homeserver de l'émetteur (`issueInvitation.ts`, `inviteSomebody`).
 */
export function linkFor(server, token) {
  return `https://${server.slice('https://'.length)}/i/${token}`
}

/**
 * Les identifiants d'@exploitation, ou pourquoi ils ne se lisent pas.
 *
 * La raison nomme une clé, jamais une valeur : elle s'affiche.
 */
export function readCredentials(text) {
  const body = parsedObject(text)
  if (body === null) {
    return { ok: false, reason: "le fichier n'est pas un objet JSON" }
  }
  const server = serverFrom(body.serveur)
  if (server === null) {
    return { ok: false, reason: '`serveur` doit être une adresse https' }
  }
  if (typeof body.user_id !== 'string' || !/^@[^:]+:.+$/.test(body.user_id)) {
    return {
      ok: false,
      reason: '`user_id` doit être un identifiant Matrix complet',
    }
  }
  if (nonEmptyString(body.access_token) === null) {
    return { ok: false, reason: '`access_token` manque' }
  }
  return {
    ok: true,
    server,
    userId: body.user_id,
    accessToken: body.access_token,
  }
}

/** Ce que `--dry-run` peut dire du fichier sans en garder le jeton. */
export function readPublicPart(text) {
  const read = readCredentials(text)
  return read.ok ? { server: read.server, userId: read.userId } : null
}

/**
 * Le chemin tombe-t-il dans le dépôt ? L'état porte le lien, et ce dépôt est
 * public : un état écrit dans l'arbre de travail est à un `git add -A` d'être
 * publié.
 */
export function insideRepository(path, repository) {
  const rel = relative(resolve(repository), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Une durée en secondes : `7j`, `24h`, `90min`, `3600s`, ou `3600` tout court.
 * `null` pour ce qui ne se lit pas ou sort des bornes du service.
 */
export function readDuration(raw) {
  const match = /^(\d+)(j|h|min|s)?$/.exec(String(raw ?? '').trim())
  if (match === null) return null
  const unit = { j: 86_400, h: 3_600, min: 60, s: 1 }[match[2] ?? 's']
  const seconds = Number(match[1]) * unit
  return seconds >= 1 && seconds <= MAX_TTL_SECONDS ? seconds : null
}

/** `7 j`, `1 h`, `1 h 30 min`, `45 s`. */
export function readablePeriod(seconds) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const rest = seconds % 60
  const parts = [
    days > 0 ? `${days} j` : '',
    hours > 0 ? `${hours} h` : '',
    minutes > 0 ? `${minutes} min` : '',
    rest > 0 ? `${rest} s` : '',
  ]
  return parts.filter(part => part !== '').join(' ')
}

/** `@exploitation:messagr.eu` → `exploitation`, lisible dans un nom de fichier. */
export function localpartOf(userId) {
  const bare = String(userId).replace(/^@/, '').split(':')[0]
  return bare.replace(/[^a-z0-9._=-]/gi, '_')
}

/**
 * L'état d'une émission : propre au compte ET à l'objet, pour que deux
 * émissions ne s'écrasent pas, et hors du dépôt.
 */
export function statePathFor({ explicit, userId, purpose, directory }) {
  if (explicit !== null) return resolve(explicit)
  return join(directory, `${localpartOf(userId)}-${purpose}.json`)
}

const OPTIONS_OF = {
  emettre: [
    '--compte',
    '--objet',
    '--etat',
    '--duree',
    '--usages',
    '--dry-run',
  ],
  admettre: ['--compte', '--objet', '--etat'],
  etat: ['--compte', '--objet', '--etat'],
  revoquer: ['--compte', '--objet', '--etat'],
}

/**
 * Les options d'un geste. `environment` est la valeur de
 * `MESSAGR_EXPLOITATION_IDENTIFIANTS`, ou `undefined`.
 */
export function readOptions(gesture, args, environment) {
  const allowed = OPTIONS_OF[gesture]
  const options = {
    credentials: environment || DEFAULT_CREDENTIALS,
    purpose: DEFAULT_PURPOSE,
    statePath: null,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    uses: DEFAULT_USES,
    dryRun: false,
    given: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!allowed.includes(flag)) {
      return { ok: false, reason: `${gesture} ne connaît pas l'option ${flag}` }
    }
    options.given.push(flag)
    if (flag === '--dry-run') {
      options.dryRun = true
      continue
    }
    const raw = args[index + 1]
    index += 1
    if (raw === undefined || raw.startsWith('--')) {
      return { ok: false, reason: `${flag} attend une valeur` }
    }
    if (flag === '--compte') options.credentials = raw
    if (flag === '--etat') options.statePath = raw
    if (flag === '--objet') {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(raw)) {
        return {
          ok: false,
          reason: '--objet : des minuscules, des chiffres et des tirets',
        }
      }
      options.purpose = raw
    }
    if (flag === '--duree') {
      const seconds = readDuration(raw)
      if (seconds === null) {
        return {
          ok: false,
          reason: `--duree : 7j, 24h, 90min ou 3600s, jusqu'à ${MAX_TTL_SECONDS / 86_400} jours, la borne du service`,
        }
      }
      options.ttlSeconds = seconds
    }
    if (flag === '--usages') {
      const count = /^\d+$/.test(raw) ? Number(raw) : 0
      if (count < 1 || count > MAX_USES) {
        return {
          ok: false,
          reason: `--usages va de 1 à ${MAX_USES}, les bornes du service`,
        }
      }
      options.uses = count
    }
  }
  return { ok: true, ...options }
}

/**
 * Les règles d'une conversation de ce produit, posées sur ce que le
 * homeserver a écrit. Lire puis réécrire, comme `setTheRules` : un PUT
 * remplace l'événement entier, et en construire un de rien effacerait ce que
 * le serveur y avait mis, à commencer par le niveau du créateur.
 */
export function roomRules(held) {
  return {
    ...held,
    invite: INVITE_COST,
    users_default: 0,
    redact: NOBODY_ELSE_REDACTS,
  }
}

const CLIENT = '/_matrix/client/v3'
const inRoom = room => `${CLIENT}/rooms/${encodeURIComponent(room)}`

/**
 * Chaque requête, décrite une fois. Le vrai lancement les envoie, `--dry-run`
 * les affiche : ce que le second montre est donc ce que le premier fait.
 */
export const requests = {
  createRoom: () => ({
    method: 'POST',
    path: `${CLIENT}/createRoom`,
    body: { preset: 'private_chat', room_version: ROOM_VERSION },
  }),
  readLevels: room => ({
    method: 'GET',
    path: `${inRoom(room)}/state/m.room.power_levels`,
  }),
  writeLevels: (room, held) => ({
    method: 'PUT',
    path: `${inRoom(room)}/state/m.room.power_levels`,
    body: roomRules(held),
  }),
  encrypt: room => ({
    method: 'PUT',
    path: `${inRoom(room)}/state/m.room.encryption`,
    body: { algorithm: MEGOLM },
  }),
  mint: (room, uses, ttlSeconds, key) => ({
    method: 'POST',
    path: '/_messagr/invitations',
    // Obligatoire, et le service dit pourquoi : sans elle, chaque nouvel
    // essai créerait une nouvelle réserve de comptes définitifs.
    headers: { 'idempotency-key': key },
    body: { max_uses: uses, ttl_seconds: ttlSeconds, room_id: room },
  }),
  status: invitation => ({
    method: 'GET',
    path: `/_messagr/invitations/${encodeURIComponent(invitation)}`,
  }),
  invite: (room, userId) => ({
    method: 'POST',
    path: `${inRoom(room)}/invite`,
    body: { user_id: userId },
  }),
  revoke: invitation => ({
    method: 'DELETE',
    path: `/_messagr/invitations/${encodeURIComponent(invitation)}`,
  }),
  whoami: () => ({ method: 'GET', path: `${CLIENT}/account/whoami` }),
}

function refusalDetail(status, body) {
  const errcode = nonEmptyString(body?.errcode)
  const error = nonEmptyString(body?.error)
  return [
    String(status),
    errcode ?? '',
    error === null ? '' : `: ${error.slice(0, 160)}`,
  ]
    .filter(part => part !== '')
    .join(' ')
}

/**
 * Ce que dit `GET /invitations/{id}`, rangé en ce qu'on peut en faire.
 *
 * - `open` : `pending` ou `claimed`, avec le compte à inviter s'il y en a un.
 *   Un statut que ce code ne connaît pas reste ouvert : s'arrêter dessus
 *   laisserait peut-être quelqu'un derrière la porte, continuer coûte des
 *   lectures jusqu'à l'échéance.
 * - `closed` : `expired` ou `revoked`, les deux seuls que le service écrive.
 * - `unknown-invitation` : le 404 métier (`M_NOT_FOUND`). Pas le 404 d'une
 *   route inconnue (`M_UNRECOGNIZED`), ni une page d'erreur d'un proxy.
 * - `unauthenticated` : un 401. Le service le rend pour un jeton refusé, mais
 *   aussi quand le homeserver ne répond pas, parce qu'`authenticate` range
 *   toute panne de `whoami` sous ce code (`auth.rs`). La boucle demande donc
 *   au homeserver avant d'en conclure quoi que ce soit.
 * - `transient` : tout le reste, qui se réessaie.
 */
export function readInvitationStatus(httpStatus, text) {
  const body = parsedObject(text)
  if (httpStatus >= 200 && httpStatus < 300) {
    const status = nonEmptyString(body?.status)
    if (status === null) {
      return {
        kind: 'transient',
        detail: `${httpStatus} sans statut lisible`,
      }
    }
    if (status === 'expired' || status === 'revoked') {
      return { kind: 'closed', status }
    }
    return {
      kind: 'open',
      status,
      known: status === 'pending' || status === 'claimed',
      entrant: nonEmptyString(body.entrant_user_id),
      claimedUserId: nonEmptyString(body.claimed_user_id),
    }
  }
  if (httpStatus === 404 && body?.errcode === 'M_NOT_FOUND') {
    return { kind: 'unknown-invitation' }
  }
  if (httpStatus === 401) return { kind: 'unauthenticated' }
  return { kind: 'transient', detail: refusalDetail(httpStatus, body) }
}

/**
 * Ce que dit le homeserver d'une invitation dans la conversation.
 *
 * Un 403 n'est pas une panne. Le homeserver le rend, mot pour mot, pour
 * quelqu'un qui est déjà dans la conversation (`matrix.rs`, `invite`), et une
 * personne arrivée par son propre chemin y est parfois déjà : c'est ce que
 * `admitDrawnEntrant` a mesuré sur le banc. Il est noté et n'est pas refait.
 */
export function readInviteAnswer(httpStatus, text) {
  if (httpStatus >= 200 && httpStatus < 300) return { kind: 'invited' }
  const detail = refusalDetail(httpStatus, parsedObject(text))
  if (httpStatus === 403) return { kind: 'refused', detail }
  if (httpStatus === 401) return { kind: 'unauthenticated', detail }
  if (httpStatus === 429 || httpStatus >= 500) {
    return { kind: 'transient', detail }
  }
  return { kind: 'failed', detail }
}

/** Le jeton vit-il ? `whoami` est la seule question qui le dise. */
export function readWhoami(httpStatus) {
  if (httpStatus >= 200 && httpStatus < 300) return 'alive'
  if (httpStatus === 401 || httpStatus === 403) return 'dead'
  return 'transient'
}

/**
 * Un tour d'admission : qui inviter, et faut-il s'arrêter.
 *
 * # UNE FOIS PAR COMPTE NOUVELLEMENT NOMMÉ, et pas une fois pour toujours
 *
 * Le service continue de nommer un compte tant que la réclamation n'est pas
 * allée au bout, et réinviter quelqu'un de déjà invité ne change rien. Mais
 * un compte qui cesse d'être nommé puis l'est de nouveau (quelqu'un qui a
 * quitté la conversation et rouvre le lien) a besoin d'une nouvelle
 * invitation : « déjà invité un jour » le laisserait dehors jusqu'à
 * l'échéance.
 *
 * `named` est donc le compte que la dernière lecture nommait, et `traite` dit
 * si une invitation a reçu une réponse définitive pendant qu'il l'était. Une
 * lecture qui échoue ne dit rien de qui est nommé : elle ne change rien.
 *
 * Les invitations d'un tour sont faites avant l'arrêt qu'il décide : un
 * compte nommé au moment de l'échéance est invité, puis la boucle s'arrête.
 */
export function decideRound({
  reading,
  named,
  uses,
  now,
  deadline,
  unknownRounds,
}) {
  let invite = null
  let nextNamed = named
  if (reading.kind === 'open') {
    if (reading.entrant === null) {
      nextNamed = null
    } else if (named !== null && named.user_id === reading.entrant) {
      if (!named.traite) invite = reading.entrant
    } else {
      nextNamed = { user_id: reading.entrant, traite: false }
      invite = reading.entrant
    }
  }

  const failedToReach =
    reading.kind === 'transient' || reading.kind === 'unauthenticated'
  const nextUnknown =
    reading.kind === 'unknown-invitation'
      ? unknownRounds + 1
      : failedToReach
        ? unknownRounds
        : 0

  let stop = null
  if (reading.kind === 'closed') {
    stop = {
      reason:
        reading.status === 'revoked'
          ? "l'invitation est révoquée"
          : "l'invitation a expiré",
      failure: false,
    }
  } else if (
    reading.kind === 'open' &&
    reading.status === 'claimed' &&
    uses === 1
  ) {
    stop = { reason: "l'unique usage de l'invitation est pris", failure: false }
  } else if (nextUnknown >= UNKNOWN_ROUNDS_BEFORE_GIVING_UP) {
    stop = {
      reason: `le service ne connaît pas cette invitation pour ce compte (${nextUnknown} fois de suite)`,
      failure: true,
    }
  } else if (now > deadline + DEADLINE_GRACE_MS) {
    stop = { reason: "l'échéance est passée", failure: false }
  }

  return { invite, named: nextNamed, unknownRounds: nextUnknown, stop }
}

/**
 * Le temps jusqu'au tour suivant. `followUpUntil` est l'instant jusqu'où
 * suivre de près, posé à chaque invitation tentée ; `random` est dans [0, 1).
 */
export function nextDelay({ now, followUpUntil, random }) {
  if (now < followUpUntil) return FOLLOW_UP_MS
  return REST_MIN_MS + Math.floor(random * REST_SPREAD_MS)
}

/** Jusqu'où suivre de près après une invitation tentée à `now`. */
export function followUpAfter(now) {
  return now + FOLLOW_UP_WINDOW_MS
}

/**
 * Ce qu'un état déjà enregistré permet à `emettre`.
 *
 * - `fresh` : rien d'enregistré ;
 * - `resume` : une émission interrompue avant d'avoir reçu son invitation,
 *   qui reprend là où elle s'est arrêtée, avec la même clé d'idempotence ;
 * - `closed` : une invitation révoquée, close ou échue, rangée à côté ;
 * - `live` : une invitation qui peut encore faire entrer quelqu'un. Refusé :
 *   écraser l'état perdrait le seul endroit où son lien est écrit.
 */
export function standingOf(state, now) {
  if (state === null) return 'fresh'
  if (typeof state.invitation_id !== 'string') return 'resume'
  if (state.revoquee_le || state.close) return 'closed'
  const deadline = Date.parse(state.echeance)
  if (Number.isFinite(deadline) && now > deadline + DEADLINE_GRACE_MS) {
    return 'closed'
  }
  return 'live'
}

/**
 * La confirmation de `revoquer`. La fin de l'entrée standard est un refus,
 * comme dans `named_deactivation` : un tube ou une recette collée ne trouvent
 * aucun chemin jusqu'à un geste irréversible.
 */
export function isConfirmation(answer) {
  if (typeof answer !== 'string') return false
  const said = answer.trim().toLowerCase()
  return said === 'revoquer' || said === 'révoquer'
}

/** `2026-09-20 10:00 UTC` */
export function readableUtc(ms) {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** `6 j 23 h`, `4 h 12 min`, `passée`. */
export function timeLeft(ms) {
  if (ms <= 0) return 'passée'
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} j ${hours} h`
  return `${hours} h ${minutes % 60} min`
}

/** Le nom sous lequel un état clos est rangé, à côté du fichier courant. */
export function archivedPathFor(path, now) {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/:/g, '-')
  return path.replace(/\.json$/, '') + `.${stamp}Z.json`
}

/** Ce qu'un refus du service veut dire, pour celui qui le lit. */
export function explainRefusal(httpStatus, text) {
  const body = parsedObject(text)
  const known = {
    MESSAGR_INVITER_QUOTA:
      "le plafond du compte est atteint : des invitations encore ouvertes retiennent ses places. Révoquez-en une, ou demandez moins d'usages.",
    MESSAGR_NOT_PROMOTED:
      'le service juge que ce compte ne peut pas inviter dans cette conversation.',
    MESSAGR_ROOM_NOT_VISIBLE:
      'le service ne voit pas la conversation avec ce jeton.',
    MESSAGR_CREATION_IN_FLIGHT:
      'une création est encore en cours sous cette clé : relancez dans un instant.',
    M_UNAUTHORIZED:
      "le service n'a pas authentifié le compte : jeton refusé, ou homeserver injoignable depuis le service.",
  }
  return known[nonEmptyString(body?.errcode)] ?? refusalDetail(httpStatus, body)
}

/** La commande d'un geste, avec les options qui retrouvent le même état. */
export function commandFor(gesture, options) {
  const parts = ['node scripts/testflight-reviewer.mjs', gesture]
  if (options.given.includes('--compte')) {
    parts.push('--compte', options.credentials)
  }
  if (options.given.includes('--objet')) parts.push('--objet', options.purpose)
  if (options.given.includes('--etat')) parts.push('--etat', options.statePath)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Le disque et le réseau, derrière des ports que `--self-test` remplace.
// ---------------------------------------------------------------------------

/** L'état, ou `null` s'il n'existe pas. Un état illisible arrête tout. */
export function loadState(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    if (cause.code === 'ENOENT') return null
    throw cause
  }
  const state = parsedObject(text)
  if (state === null) {
    throw new Error(
      `${path} ne se lit pas comme un état ; rien n'a été touché.`,
    )
  }
  return state
}

/**
 * Écrit l'état entier, en chmod 600, par un fichier voisin qu'on renomme : un
 * arrêt au milieu laisse l'ancien état ou le nouveau, jamais la moitié d'un
 * lien.
 */
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const next = `${path}.${process.pid}.tmp`
  writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}

/** Range un état clos à côté du fichier courant, sous un nom daté. */
export function archiveState(path, now) {
  const archived = archivedPathFor(path, now)
  renameSync(path, archived)
  return archived
}

/**
 * Le port vers le homeserver et le service, qui vivent sous la même adresse.
 *
 * Une réponse est rendue, jamais levée : un refus est une réponse, et c'est
 * ce qui permet de le distinguer d'une panne. Seul le transport lève.
 */
export function portTo(server, accessToken, fetchWith = globalThis.fetch) {
  return async request => {
    const response = await fetchWith(`${server}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(request.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(request.headers ?? {}),
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return { status: response.status, body: await response.text() }
  }
}

/**
 * Une panne de transport, dite sans secret. Le message de `fetch` nomme au
 * plus l'adresse, et le jeton voyage dans un en-tête : il n'y paraît pas.
 */
export function transportDetail(cause) {
  return `réseau (${cause?.cause?.code ?? cause?.name ?? 'erreur'})`
}

function isSuccess(answer) {
  return answer.status >= 200 && answer.status < 300
}

function plural(count, word) {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

/**
 * Ce que ferait `emettre`, décrit par les constructeurs de requêtes mêmes
 * que le vrai lancement envoie. Rien n'est appelé, et aucun jeton n'est lu :
 * `publicPart` ne garde du fichier d'identifiants que le serveur et le compte.
 */
export function describeEmission({ publicPart, options, statePath }) {
  const server = publicPart?.server ?? DEFAULT_SERVER
  const emitter = publicPart?.userId ?? DEFAULT_EMITTER
  const room = '<room_id>'
  const shown = request => {
    const lines = [
      `${request.method} ${server}${decodeURIComponent(request.path)}`,
      '     Authorization: Bearer <jeton du compte, non montré>',
    ]
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      lines.push(`     ${name}: ${value}`)
    }
    if (request.body !== undefined) {
      lines.push(`     ${JSON.stringify(request.body)}`)
    }
    return lines.join('\n')
  }
  const fallback = publicPart === null ? ' (le fichier ne se lit pas)' : ''
  return [
    'Ce que ferait `emettre`, sans rien appeler, et sans montrer ni envoyer aucun jeton :',
    '',
    `compte    ${emitter}${fallback}`,
    `serveur   ${server}`,
    `état      ${statePath} (chmod 600)`,
    '',
    `1. ${shown(requests.createRoom())}`,
    `2. ${shown(requests.readLevels(room))}`,
    `3. ${shown(requests.writeLevels(room, { '…': 'ce que 2 a rendu' }))}`,
    `4. ${shown(requests.encrypt(room))}`,
    `5. ${shown(
      requests.mint(
        room,
        options.uses,
        options.ttlSeconds,
        '<tirée et enregistrée avant l’appel>',
      ),
    )}`,
    '',
    `lien      ${linkFor(server, '<jeton d’invitation>')}`,
    `validité  ${readablePeriod(options.ttlSeconds)}, ${plural(options.uses, 'usage')}`,
  ].join('\n')
}

/**
 * `emettre` : une conversation de la forme de celles de l'application, puis
 * UNE invitation dedans.
 *
 * # CHAQUE ÉTAPE EST ÉCRITE AVANT LA SUIVANTE, ET LA CLÉ AVANT L'APPEL
 *
 * Relancé après une coupure, `emettre` reprend où il s'était arrêté : il ne
 * recrée pas la conversation, et il redemande l'invitation avec la MÊME clé
 * d'idempotence. Le service rend alors l'invitation déjà posée (`replay`,
 * `handlers/create.rs`) au lieu d'en poser une seconde, dont le jeton serait
 * perdu et les places retenues sur le plafond du compte.
 *
 * Un trou reste, et il est dit : une coupure entre la création de la
 * conversation et son écriture laisse une conversation vide, Matrix n'offrant
 * pas de création idempotente. `issueInvitation.ts` fait le même choix pour
 * la même raison : signaler un reste plutôt que supprimer une conversation.
 */
export async function emit(deps) {
  const { send, now, newKey, print, statePath, server, userId, options } = deps
  let state = deps.loadState(statePath)
  const standing = standingOf(state, now())
  if (standing === 'live') {
    return {
      ok: false,
      reason:
        `une invitation vivante est déjà enregistrée dans ${statePath} ` +
        `(échéance ${readableUtc(Date.parse(state.echeance))}). ` +
        '`etat` la montre, `revoquer` la clôt ; pour une autre émission, ' +
        'prenez un autre --objet.',
    }
  }
  if (standing === 'closed') {
    const archived = deps.archiveState(statePath, now())
    print(`état précédent, clos, rangé sous ${archived}`)
    state = null
  }
  if (state === null) {
    state = {
      serveur: server,
      emetteur: userId,
      objet: options.purpose,
      usages: options.uses,
      duree_secondes: options.ttlSeconds,
    }
  } else if (state.serveur !== server || state.emetteur !== userId) {
    return {
      ok: false,
      reason: `${statePath} a été commencé par ${state.emetteur} sur ${state.serveur}, pas par ce compte.`,
    }
  } else {
    print(
      `reprise d'une émission interrompue : ${readablePeriod(state.duree_secondes)}, ` +
        `${plural(state.usages, 'usage')}, comme au premier lancement`,
    )
  }
  const keep = next => {
    state = next
    deps.saveState(statePath, state)
  }

  if (typeof state.room_id !== 'string') {
    const created = await send(requests.createRoom())
    const room = isSuccess(created)
      ? nonEmptyString(parsedObject(created.body)?.room_id)
      : null
    if (room === null) {
      return {
        ok: false,
        reason: `la conversation n'a pas été créée : ${explainRefusal(created.status, created.body)}`,
      }
    }
    keep({ ...state, room_id: room, cree_le: new Date(now()).toISOString() })
    print(`conversation créée : ${room}`)
  }

  if (state.regles_posees !== true) {
    const read = await send(requests.readLevels(state.room_id))
    const held = isSuccess(read) ? parsedObject(read.body) : null
    if (held === null) {
      return {
        ok: false,
        reason: `les niveaux de pouvoir ne se lisent pas : ${explainRefusal(read.status, read.body)}. Relancez \`emettre\`, il reprendra ici.`,
      }
    }
    for (const request of [
      requests.writeLevels(state.room_id, held),
      requests.encrypt(state.room_id),
    ]) {
      const written = await send(request)
      if (!isSuccess(written)) {
        return {
          ok: false,
          reason: `les règles de la conversation ont été refusées : ${explainRefusal(written.status, written.body)}. Relancez \`emettre\`, il reprendra ici.`,
        }
      }
    }
    keep({ ...state, regles_posees: true })
    print(
      'règles posées : inviter coûte 50, membres à 0, caviardage à 101, chiffrement megolm',
    )
  }

  if (typeof state.cle_idempotence !== 'string') {
    keep({
      ...state,
      cle_idempotence: newKey(),
      demande_le: new Date(now()).toISOString(),
    })
  }
  const minted = await send(
    requests.mint(
      state.room_id,
      state.usages,
      state.duree_secondes,
      state.cle_idempotence,
    ),
  )
  if (!isSuccess(minted)) {
    return {
      ok: false,
      reason: `l'invitation n'a pas été émise : ${explainRefusal(minted.status, minted.body)}. Relancez \`emettre\` : la même clé rejouera la même demande.`,
    }
  }
  const answer = parsedObject(minted.body)
  const token = nonEmptyString(answer?.token)
  const invitation = nonEmptyString(answer?.invitation_id)
  if (token === null || invitation === null) {
    return {
      ok: false,
      reason:
        "le service a répondu sans jeton ou sans identifiant d'invitation.",
    }
  }
  // Depuis la DEMANDE, pas depuis la réponse : une reprise rend l'invitation
  // posée au premier lancement, dont l'échéance court depuis ce moment-là.
  const deadline = Date.parse(state.demande_le) + state.duree_secondes * 1000
  keep({
    ...state,
    invitation_id: invitation,
    lien: linkFor(server, token),
    echeance: new Date(deadline).toISOString(),
  })
  print(
    [
      `invitation émise : ${invitation}`,
      '',
      `lien      ${state.lien}`,
      `échéance  ${readableUtc(deadline)} (dans ${timeLeft(deadline - now())}), ${plural(state.usages, 'usage')}`,
      `état      ${statePath} (chmod 600 : le lien fait entrer, il se garde comme un secret)`,
      '',
      "Personne n'entre tant qu'`admettre` ne tourne pas. Lancez-le maintenant :",
      `  caffeinate -i ${commandFor('admettre', options)}`,
    ].join('\n'),
  )
  return { ok: true, state }
}

/** L'état appartient-il au compte qui agit ? Le service ne montre une invitation qu'à son émetteur. */
function ownedBy(state, server, userId) {
  return state.serveur === server && state.emetteur === userId
}

const iso = ms => new Date(ms).toISOString()

/**
 * `admettre` : la moitié de l'émetteur, tenue jusqu'à ce que l'invitation se
 * ferme ou que son échéance passe.
 *
 * # CE QUI NE L'ARRÊTE PAS
 *
 * Une coupure du réseau, un 5xx, un 429, un service qui redémarre : le tour
 * suivant redemande. Un 401 du service non plus, tant que le homeserver
 * reconnaît le jeton (voir `readInvitationStatus`).
 *
 * # CE QUI L'ARRÊTE
 *
 * `expired`, `revoked`, l'échéance, l'unique usage pris (`decideRound`). Et,
 * en échec, un jeton que le homeserver refuse, ou trois réponses
 * « invitation inconnue » d'affilée.
 *
 * # RELANÇABLE
 *
 * Ce qui décide du tour suivant est dans l'état, écrit à chaque changement :
 * qui est nommé, et s'il a été invité. Relancé après un redémarrage du Mac,
 * `admettre` reprend sans réinviter personne.
 */
export async function admit(deps) {
  const { send, now, sleep, random, log, statePath, server, userId } = deps
  let state = deps.loadState(statePath)
  if (state === null || typeof state.invitation_id !== 'string') {
    return {
      ok: false,
      reason: `aucune invitation émise dans ${statePath} : lancez d'abord \`emettre\`.`,
    }
  }
  if (!ownedBy(state, server, userId)) {
    return {
      ok: false,
      reason: `l'invitation de ${statePath} appartient à ${state.emetteur} sur ${state.serveur} ; le service ne la montre qu'à lui.`,
    }
  }
  if (state.revoquee_le || state.close) {
    return {
      ok: true,
      reason: `l'invitation est close (${state.close?.raison ?? 'révoquée'}) : il n'y a plus personne à faire entrer.`,
    }
  }

  const keep = next => {
    state = next
    deps.saveState(statePath, state)
  }
  const deadline = Date.parse(state.echeance)
  let unknownRounds = 0
  let failing = null
  let followUpUntil = 0
  let unexpected = null

  log(
    `admission de l'invitation ${state.invitation_id} jusqu'au ${readableUtc(deadline)} ; ctrl-c l'interrompt sans rien défaire`,
  )

  for (;;) {
    let reading
    try {
      const answer = await send(requests.status(state.invitation_id))
      reading = readInvitationStatus(answer.status, answer.body)
    } catch (cause) {
      reading = { kind: 'transient', detail: transportDetail(cause) }
    }

    if (reading.kind === 'unauthenticated') {
      let token
      try {
        token = readWhoami((await send(requests.whoami())).status)
      } catch {
        token = 'transient'
      }
      if (token === 'dead') {
        log(
          "le homeserver refuse le jeton du compte : plus personne ne peut être invité. Mettez le fichier d'identifiants à jour, puis relancez `admettre`.",
        )
        return { ok: false, reason: 'jeton refusé par le homeserver' }
      }
      reading = {
        kind: 'transient',
        detail: '401 du service, et le homeserver ne dit pas le jeton mort',
      }
    }

    // UNE LIGNE PAR ÉVÉNEMENT : le début d'une panne et son retour, pas une
    // ligne par tour, qui enterrerait celle qui compte.
    if (reading.kind === 'transient') {
      if (failing === null) {
        log(
          `réponse inattendue du service : ${reading.detail} ; il est redemandé à chaque tour`,
        )
      }
      failing = reading.detail
    } else if (failing !== null) {
      log('le service répond de nouveau')
      failing = null
    }

    if (
      reading.kind === 'open' &&
      !reading.known &&
      unexpected !== reading.status
    ) {
      unexpected = reading.status
      log(
        `statut que ce script ne connaît pas : « ${reading.status} » ; l'admission continue`,
      )
    }

    if (
      reading.kind === 'open' &&
      reading.claimedUserId !== null &&
      state.entree_constatee?.user_id !== reading.claimedUserId
    ) {
      keep({
        ...state,
        entree_constatee: { user_id: reading.claimedUserId, le: iso(now()) },
      })
      log(`entrée constatée : ${reading.claimedUserId} a réclamé l'invitation`)
    }

    const decision = decideRound({
      reading,
      named: state.nomme ?? null,
      uses: state.usages,
      now: now(),
      deadline,
      unknownRounds,
    })
    unknownRounds = decision.unknownRounds
    if (
      JSON.stringify(decision.named) !== JSON.stringify(state.nomme ?? null)
    ) {
      keep({ ...state, nomme: decision.named })
    }

    if (decision.invite !== null) {
      const entrant = decision.invite
      followUpUntil = followUpAfter(now())
      let outcome
      try {
        const answer = await send(requests.invite(state.room_id, entrant))
        outcome = readInviteAnswer(answer.status, answer.body)
      } catch (cause) {
        outcome = { kind: 'transient', detail: transportDetail(cause) }
      }
      if (outcome.kind === 'unauthenticated') {
        log(
          `le homeserver refuse le jeton du compte (${outcome.detail}) : ${entrant} n'a pas pu être invité. Mettez le fichier d'identifiants à jour, puis relancez \`admettre\`.`,
        )
        return { ok: false, reason: 'jeton refusé par le homeserver' }
      }
      if (outcome.kind === 'transient') {
        log(
          `${entrant} est nommé et son invitation a échoué : ${outcome.detail} ; nouvel essai au tour suivant`,
        )
      } else {
        keep({
          ...state,
          nomme: { user_id: entrant, traite: true },
          invites: [
            ...(state.invites ?? []),
            { user_id: entrant, le: iso(now()), resultat: outcome.kind },
          ],
        })
        const said = {
          invited: 'invité dans la conversation',
          refused: `refusé (${outcome.detail}) : sans doute déjà dans la conversation`,
          failed: `refusé (${outcome.detail})`,
        }[outcome.kind]
        log(`${entrant} est nommé : ${said}`)
      }
    }

    if (decision.stop !== null) {
      if (!decision.stop.failure) {
        keep({
          ...state,
          close: { raison: decision.stop.reason, le: iso(now()) },
        })
      }
      log(`fin de l'admission : ${decision.stop.reason}`)
      return { ok: !decision.stop.failure, reason: decision.stop.reason }
    }

    await sleep(nextDelay({ now: now(), followUpUntil, random: random() }))
  }
}

/**
 * `etat` : ce qui est enregistré, puis ce qu'en dit le service. N'écrit rien.
 *
 * `send` vaut `null` quand le compte ne se lit pas : l'état local s'affiche
 * quand même, et la ligne du service dit pourquoi elle manque.
 */
export async function showState(deps) {
  const { statePath, print, now } = deps
  const state = deps.loadState(statePath)
  if (state === null) {
    return {
      ok: false,
      reason: `aucune émission enregistrée dans ${statePath}.`,
    }
  }
  const lines = [
    `état          ${statePath}`,
    `compte        ${state.emetteur} sur ${state.serveur}`,
    `objet         ${state.objet ?? '(non noté)'}`,
    `conversation  ${state.room_id ?? '(pas encore créée)'}`,
  ]
  if (typeof state.invitation_id !== 'string') {
    lines.push(
      'invitation    pas encore émise : relancez `emettre`, il reprendra',
    )
    print(lines.join('\n'))
    return { ok: true }
  }
  const deadline = Date.parse(state.echeance)
  lines.push(
    `invitation    ${state.invitation_id}, ${plural(state.usages, 'usage')}`,
    `échéance      ${readableUtc(deadline)} (${deadline > now() ? `dans ${timeLeft(deadline - now())}` : 'passée'})`,
    `lien          ${state.lien}`,
  )
  for (const one of state.invites ?? []) {
    lines.push(
      `invité        ${one.user_id}, ${readableUtc(Date.parse(one.le))}, ${one.resultat}`,
    )
  }
  if (state.entree_constatee) {
    lines.push(
      `entrée        ${state.entree_constatee.user_id}, ${readableUtc(Date.parse(state.entree_constatee.le))}`,
    )
  }
  if (state.close) {
    lines.push(
      `close         ${state.close.raison}, ${readableUtc(Date.parse(state.close.le))}`,
    )
  }
  if (state.revoquee_le) {
    lines.push(
      `révoquée      ${readableUtc(Date.parse(state.revoquee_le))}, comptes désactivés : ${state.comptes_desactives ?? 'non dit'}`,
    )
  }
  print(lines.join('\n'))

  if (deps.send === null) {
    print(`service       non interrogé : ${deps.offline}`)
    return { ok: true }
  }
  let said
  try {
    const answer = await deps.send(requests.status(state.invitation_id))
    const reading = readInvitationStatus(answer.status, answer.body)
    if (reading.kind === 'open') {
      const invited =
        state.nomme?.user_id === reading.entrant && state.nomme?.traite === true
      said = [
        reading.status,
        reading.entrant === null
          ? 'personne à inviter'
          : `nomme ${reading.entrant}, ${invited ? 'déjà invité' : 'pas encore invité : `admettre` tourne-t-il ?'}`,
        reading.claimedUserId === null
          ? null
          : `première entrée : ${reading.claimedUserId}`,
      ]
        .filter(part => part !== null)
        .join(' ; ')
    } else {
      said = {
        closed: reading.status,
        'unknown-invitation':
          'le service ne connaît pas cette invitation pour ce compte',
        unauthenticated: "le service n'authentifie pas le compte",
        transient: `pas de réponse lisible (${reading.detail})`,
      }[reading.kind]
    }
  } catch (cause) {
    said = `injoignable (${transportDetail(cause)})`
  }
  print(`service       ${said}`)
  return { ok: true }
}

/**
 * `revoquer` : clore l'invitation, le jour où elle n'a plus lieu d'être.
 *
 * # CE QUE LE SERVICE EN FAIT, ET QUI NE SE DÉFAIT PAS
 *
 * La révocation est DESTRUCTIVE pour les comptes que l'invitation a créés
 * (`handlers/revoke.rs`) : ceux qui attendaient, et ceux qui sont entrés, le
 * relecteur compris. Le service les désactive, et un homeserver ne rend
 * jamais un nom. Ce pouvoir ne dure que la vie de l'invitation : dans l'heure
 * qui suit l'échéance, le service détruit ce qui le permettait
 * (`purge_claimed_secrets_of_expired`), et une révocation plus tardive ne
 * désactive plus les comptes entrés.
 *
 * D'où la confirmation tapée, qu'aucun tube ne fournit.
 */
export async function revoke(deps) {
  const { send, now, print, ask, statePath, server, userId } = deps
  const state = deps.loadState(statePath)
  if (state === null || typeof state.invitation_id !== 'string') {
    return { ok: false, reason: `aucune invitation émise dans ${statePath}.` }
  }
  if (!ownedBy(state, server, userId)) {
    return {
      ok: false,
      reason: `l'invitation de ${statePath} appartient à ${state.emetteur} ; seul ce compte peut la révoquer.`,
    }
  }
  if (state.revoquee_le) {
    return {
      ok: true,
      reason: `déjà révoquée, le ${readableUtc(Date.parse(state.revoquee_le))}.`,
    }
  }
  const lapsed = now() > Date.parse(state.echeance)
  print(
    [
      `Révoquer l'invitation ${state.invitation_id} de ${state.emetteur} ?`,
      '',
      'Le lien cessera de fonctionner.',
      lapsed
        ? "L'échéance est passée : une heure plus tard au plus, le service ne peut plus désactiver les comptes entrés, qui resteront. Ceux qui n'ont jamais servi sont désactivés de toute façon."
        : "Le service désactivera aussi les comptes que cette invitation a créés, celui de la personne entrée compris. C'est irréversible.",
      '',
      'Tapez « revoquer » pour confirmer :',
    ].join('\n'),
  )
  if (!isConfirmation(await ask())) {
    return { ok: false, reason: "rien n'a été révoqué." }
  }
  const answer = await send(requests.revoke(state.invitation_id))
  if (!isSuccess(answer)) {
    const unknown =
      readInvitationStatus(answer.status, answer.body).kind ===
      'unknown-invitation'
    return {
      ok: false,
      reason: unknown
        ? "le service ne connaît pas cette invitation pour ce compte ; rien n'a été révoqué."
        : `révocation refusée : ${explainRefusal(answer.status, answer.body)}`,
    }
  }
  const body = parsedObject(answer.body)
  const deactivated = Number.isInteger(body?.deactivated_accounts)
    ? body.deactivated_accounts
    : null
  deps.saveState(statePath, {
    ...state,
    revoquee_le: iso(now()),
    comptes_desactives: deactivated,
  })
  print(
    `invitation révoquée ; comptes désactivés : ${deactivated ?? 'non dit'}`,
  )
  return { ok: true }
}

// ---------------------------------------------------------------------------
// `--self-test`. Aucun cas n'appelle le réseau, et c'est vérifié : `fetch` est
// remplacé par un piège avant le premier cas, et le dernier compte ses prises.
//
// Les réponses du service sont celles que `handlers/status.rs` et
// `handlers/revoke.rs` épinglent dans leurs propres tests, octet pour octet,
// et la forme de la conversation est relue dans `issueInvitation.ts` : un
// essai qui fabriquerait lui-même ce qu'il vérifie ne prouverait que sa
// propre cohérence.
// ---------------------------------------------------------------------------

async function selfTest() {
  let reached = 0
  globalThis.fetch = async () => {
    reached += 1
    throw new Error('le self-test ne touche pas le réseau')
  }
  const failures = []
  let cases = 0
  const copied = value => JSON.parse(JSON.stringify(value))
  const check = (what, actual, expected) => {
    cases += 1
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${what}\n  attendu ${JSON.stringify(expected)}\n  obtenu  ${JSON.stringify(actual)}`,
      )
    }
  }
  const scenario = async (what, body) => {
    try {
      await body()
    } catch (cause) {
      failures.push(`${what} : ${cause.message}`)
    }
  }

  // LA FORME, RELUE LÀ OÙ ELLE EST DÉCIDÉE.
  const app = readFileSync(
    join(REPOSITORY, 'packages/app/src/runtime/issueInvitation.ts'),
    'utf8',
  )
  const create = readFileSync(
    join(REPOSITORY, 'services/invitations/src/handlers/create.rs'),
    'utf8',
  )
  check(
    "la version de salon est celle de l'application",
    /const ROOM_VERSION = '(\d+)'/.exec(app)?.[1],
    ROOM_VERSION,
  )
  check(
    "inviter coûte ce qu'il coûte dans l'application",
    Number(/const INVITE_COST = (\d+)/.exec(app)?.[1]),
    INVITE_COST,
  )
  check(
    "le caviardage est hors d'atteinte comme dans l'application",
    Number(/const NOBODY_ELSE_REDACTS = (\d+)/.exec(app)?.[1]),
    NOBODY_ELSE_REDACTS,
  )
  check(
    'la conversation est créée comme dans l’application',
    /JSON\.stringify\(\{ preset: 'private_chat', room_version: ROOM_VERSION \}\)/.test(
      app,
    ),
    true,
  )
  check(
    'le chiffrement est le même',
    app.includes(`algorithm: '${MEGOLM}'`),
    true,
  )
  const posed = /\.\.\.held,([^}]*)\}/.exec(app)?.[1] ?? ''
  check(
    "l'application pose ces clés sur les niveaux lus, et aucune autre",
    posed
      .split(',')
      .map(one => one.trim())
      .filter(one => one !== ''),
    ['invite: INVITE_COST', 'users_default: 0', 'redact: NOBODY_ELSE_REDACTS'],
  )
  check('roomRules pose les mêmes', Object.keys(roomRules({})), [
    'invite',
    'users_default',
    'redact',
  ])
  check(
    "la demande d'invitation a les champs de l'application",
    /max_uses: 1,\s*ttl_seconds: TTL_SECONDS,\s*room_id: scope,/.test(app) &&
      JSON.stringify(Object.keys(requests.mint('!r', 1, 1, 'k').body)),
    '["max_uses","ttl_seconds","room_id"]',
  )
  check(
    "le lien est celui que l'application fabrique",
    app.includes('`https://${linkHost}/i/${minted.token}`') &&
      linkFor('https://messagr.eu', 'ABC'),
    'https://messagr.eu/i/ABC',
  )
  check(
    "et le relecteur ne se donne aucun nom, donc rien n'est écrit après",
    // #329 : l'application peut écrire le nom que l'inviteur se donne dans le
    // fragment du lien, `#n=<nom>`. Elle rend le lien intact quand il n'y en a
    // pas, et ce script n'en donne aucun -- il émet pour Apple, qui n'est
    // invité par personne. Les deux moitiés sont relues ici parce que c'est
    // cette absence qui fait que `linkFor` dit encore la vérité.
    [
      app.includes('linkWithDeclaredName('),
      /if \(declared === null\) return link/.test(
        readFileSync(
          join(REPOSITORY, 'packages/app/src/runtime/declaredName.ts'),
          'utf8',
        ),
      ),
      linkFor('https://messagr.eu', 'ABC').includes('#'),
    ],
    [true, true, false],
  )
  check(
    'les bornes sont celles du service',
    [
      Number(/pub const MAX_USES: u32 = (\d+);/.exec(create)?.[1]),
      /pub const MAX_TTL_SECONDS: i64 = 30 \* 86_400;/.test(create),
    ],
    [MAX_USES, MAX_TTL_SECONDS === 30 * 86_400],
  )

  // LES OPTIONS, et les deux usages qu'on leur connaît.
  const opts = args => readOptions('emettre', args, undefined)
  const basics = one => [
    one.ok,
    one.ttlSeconds,
    one.uses,
    one.purpose,
    one.credentials,
  ]
  check(
    'par défaut : le relecteur, sept jours, deux usages, @exploitation',
    basics(opts([])),
    [true, 604_800, 2, 'relecteur-apple', DEFAULT_CREDENTIALS],
  )
  check(
    'un téléphone : une heure, un usage, la racine',
    basics(
      opts([
        '--duree',
        '3600',
        '--usages',
        '1',
        '--objet',
        'pixel',
        '--compte',
        '/r.json',
      ]),
    ),
    [true, 3600, 1, 'pixel', '/r.json'],
  )
  check(
    'la variable choisit le compte, l’option la surclasse',
    [
      readOptions('etat', [], '/a.json').credentials,
      readOptions('etat', ['--compte', '/b.json'], '/a.json').credentials,
    ],
    ['/a.json', '/b.json'],
  )
  check(
    'ce que les options refusent',
    [
      ['--duree', '31j'],
      ['--duree', '1.5j'],
      ['--usages', '11'],
      ['--usages', '0'],
      ['--compte'],
      ['--objet', '../x'],
      ['--jours', '7'],
    ].map(args => opts(args).ok),
    [false, false, false, false, false, false, false],
  )
  check(
    'une option d’un autre geste est refusée',
    readOptions('admettre', ['--duree', '1h']).ok,
    false,
  )
  check(
    'les durées',
    ['7j', '24h', '90min', '3600s', '30j', '0', '-1'].map(readDuration),
    [604_800, 86_400, 5400, 3600, 2_592_000, null, null],
  )
  check('les périodes', [604_800, 3600, 5400].map(readablePeriod), [
    '7 j',
    '1 h',
    '1 h 30 min',
  ])

  // L'ÉTAT : un par compte et par objet, et jamais dans le dépôt.
  check(
    "le relecteur et le téléphone ne s'écrasent pas",
    [
      statePathFor({
        explicit: null,
        userId: '@exploitation:messagr.eu',
        purpose: 'relecteur-apple',
        directory: '/p',
      }),
      statePathFor({
        explicit: null,
        userId: '@mmaudet:messagr.eu',
        purpose: 'pixel',
        directory: '/p',
      }),
      statePathFor({
        explicit: '/q/e.json',
        userId: '@x:h',
        purpose: 'p',
        directory: '/p',
      }),
    ],
    [
      '/p/exploitation-relecteur-apple.json',
      '/p/mmaudet-pixel.json',
      '/q/e.json',
    ],
  )
  check(
    'un état dans le dépôt se voit',
    [
      insideRepository(join(REPOSITORY, 'x.json'), REPOSITORY),
      insideRepository(REPOSITORY, REPOSITORY),
      insideRepository(join(PRIVATE_DIRECTORY, 'a.json'), REPOSITORY),
      insideRepository(`${REPOSITORY}-voisin/a.json`, REPOSITORY),
    ],
    [true, true, false, false],
  )

  // LES IDENTIFIANTS : lus, jamais cités.
  const secret = 'syt_ceci_ne_doit_jamais_paraitre'
  const good = JSON.stringify({
    serveur: 'https://messagr.eu/',
    user_id: '@exploitation:messagr.eu',
    access_token: secret,
    device_id: 'APPAREIL',
    mot_de_passe: 'mdp_secret',
    role: 'exploitation',
    room_id: '!demo:messagr.eu',
  })
  check('les identifiants se lisent', readCredentials(good), {
    ok: true,
    server: 'https://messagr.eu',
    userId: '@exploitation:messagr.eu',
    accessToken: secret,
  })
  const refusals = [
    { serveur: 'http://messagr.eu', user_id: '@a:h', access_token: secret },
    {
      serveur: 'https://messagr.eu',
      user_id: 'exploitation',
      access_token: secret,
    },
    {
      serveur: 'https://messagr.eu',
      user_id: '@a:h',
      mot_de_passe: 'mdp_secret',
    },
  ]
    .map(one => JSON.stringify(one))
    .concat('pas du json')
    .map(readCredentials)
  check(
    'un fichier incomplet est refusé',
    refusals.map(one => one.ok),
    [false, false, false, false],
  )
  check(
    'aucun refus ne cite un secret',
    refusals.some(
      one => one.reason.includes(secret) || one.reason.includes('mdp_secret'),
    ),
    false,
  )
  check(
    'la partie publique laisse le jeton',
    JSON.stringify(readPublicPart(good)).includes(secret),
    false,
  )
  check(
    'le serveur est https et rien d’autre',
    [
      'https://messagr.eu/',
      'http://messagr.eu',
      'messagr.eu',
      'https://messagr.eu/x',
    ].map(serverFrom),
    ['https://messagr.eu', null, null, null],
  )

  // CE QUE DIT LE SERVICE, avec les corps que ses propres tests épinglent.
  const reads = readInvitationStatus
  check('pending, personne à inviter', reads(200, '{"status":"pending"}'), {
    kind: 'open',
    status: 'pending',
    known: true,
    entrant: null,
    claimedUserId: null,
  })
  check(
    'pending, un compte tiré',
    reads(200, '{"status":"pending","entrant_user_id":"@lea:h"}').entrant,
    '@lea:h',
  )
  check(
    'claimed, avec qui et quand',
    reads(
      200,
      '{"status":"claimed","claimed_user_id":"@lea:h","claimed_at":1754772000}',
    ),
    {
      kind: 'open',
      status: 'claimed',
      known: true,
      entrant: null,
      claimedUserId: '@lea:h',
    },
  )
  check(
    'les lectures qui ferment, et les autres',
    [
      reads(200, '{"status":"expired"}').kind,
      reads(200, '{"status":"revoked"}').kind,
      reads(404, '{"errcode":"M_NOT_FOUND","error":"invitation unknown"}').kind,
      reads(404, '{"errcode":"M_UNRECOGNIZED","error":"unknown route"}').kind,
      reads(404, '<html>').kind,
      reads(401, '{"errcode":"M_UNAUTHORIZED","error":"x"}').kind,
      reads(503, '{"errcode":"MESSAGR_UPSTREAM","error":"x"}').kind,
      reads(200, '{}').kind,
      reads(200, '{"status":"exhausted"}').kind,
    ],
    [
      'closed',
      'closed',
      'unknown-invitation',
      'transient',
      'transient',
      'unauthenticated',
      'transient',
      'transient',
      'open',
    ],
  )
  check(
    'le homeserver, pour une invitation',
    [200, 403, 401, 429, 502, 404].map(
      status =>
        readInviteAnswer(
          status,
          '{"errcode":"M_FORBIDDEN","error":"Event is not authorized."}',
        ).kind,
    ),
    [
      'invited',
      'refused',
      'unauthenticated',
      'transient',
      'transient',
      'failed',
    ],
  )
  check('le homeserver, pour whoami', [200, 401, 403, 503].map(readWhoami), [
    'alive',
    'dead',
    'dead',
    'transient',
  ])

  // LES DÉCISIONS.
  const open = (entrant, status = 'pending', claimedUserId = null) => ({
    kind: 'open',
    status,
    known: true,
    entrant,
    claimedUserId,
  })
  const round = (reading, named, extra = {}) =>
    decideRound({
      reading,
      named,
      uses: 2,
      now: 0,
      deadline: 1e12,
      unknownRounds: 0,
      ...extra,
    })
  const handled = user => ({ user_id: user, traite: true })
  check(
    'nommé pour la première fois : invité',
    round(open('@d:h'), null).invite,
    '@d:h',
  )
  check(
    'toujours nommé et traité : rien',
    round(open('@d:h'), handled('@d:h')).invite,
    null,
  )
  check(
    'toujours nommé, non traité : on réessaie',
    round(open('@d:h'), { user_id: '@d:h', traite: false }).invite,
    '@d:h',
  )
  check(
    'plus personne de nommé : l’épisode se termine',
    round(open(null), handled('@d:h')).named,
    null,
  )
  check(
    'le second compte d’un compte existant est invité',
    round(open('@t:h'), handled('@d:h')).invite,
    '@t:h',
  )
  check(
    'une lecture ratée ne change rien',
    round({ kind: 'transient', detail: 'x' }, handled('@d:h')),
    {
      invite: null,
      named: handled('@d:h'),
      unknownRounds: 0,
      stop: null,
    },
  )
  check(
    'expired arrête, sans échec',
    round({ kind: 'closed', status: 'expired' }, null).stop,
    {
      reason: "l'invitation a expiré",
      failure: false,
    },
  )
  check(
    'claimed arrête une invitation à un usage, pas à deux',
    [
      round(open(null, 'claimed', '@l:h'), null, { uses: 1 }).stop?.failure,
      round(open(null, 'claimed', '@l:h'), null).stop,
    ],
    [false, null],
  )
  check(
    'trois « inconnue » d’affilée arrêtent, en échec ; une panne ne remet pas à zéro',
    [
      round({ kind: 'unknown-invitation' }, null, { unknownRounds: 1 }).stop,
      round({ kind: 'unknown-invitation' }, null, { unknownRounds: 2 }).stop
        ?.failure,
      round({ kind: 'transient', detail: 'x' }, null, { unknownRounds: 2 })
        .unknownRounds,
    ],
    [null, true, 2],
  )
  check(
    "l'échéance arrête avec cinq minutes de marge, même sans service, après l'invitation du tour",
    [
      round(open(null), null, { now: 1000 + DEADLINE_GRACE_MS, deadline: 1000 })
        .stop,
      round({ kind: 'transient', detail: 'x' }, null, {
        now: 1001 + DEADLINE_GRACE_MS,
        deadline: 1000,
      }).stop?.reason,
      round(open('@d:h'), null, { now: 1e9, deadline: 0 }).invite,
    ],
    [null, "l'échéance est passée", '@d:h'],
  )
  check(
    'la cadence',
    [
      nextDelay({ now: 0, followUpUntil: followUpAfter(0), random: 0.5 }),
      nextDelay({
        now: FOLLOW_UP_WINDOW_MS,
        followUpUntil: followUpAfter(0),
        random: 0,
      }),
      nextDelay({ now: 0, followUpUntil: 0, random: 0.999999 }) <
        REST_MIN_MS + REST_SPREAD_MS,
    ],
    [FOLLOW_UP_MS, REST_MIN_MS, true],
  )
  const liveState = {
    invitation_id: 'inv-1',
    echeance: new Date(1e12).toISOString(),
  }
  check(
    'ce qu’un état permet à emettre',
    [
      standingOf(null, 0),
      standingOf({ room_id: '!r' }, 0),
      standingOf(liveState, 0),
      standingOf({ ...liveState, revoquee_le: 'x' }, 0),
      standingOf({ ...liveState, close: { raison: 'x' } }, 0),
      standingOf(liveState, 1e12 + DEADLINE_GRACE_MS + 1),
    ],
    ['fresh', 'resume', 'live', 'closed', 'closed', 'closed'],
  )
  check(
    'la confirmation',
    ['revoquer\n', ' Révoquer ', 'oui', '', null].map(isConfirmation),
    [true, true, false, false, false],
  )
  check('le temps restant', [0, 90_000_000, 3_720_000].map(timeLeft), [
    'passée',
    '1 j 1 h',
    '1 h 2 min',
  ])
  check(
    'un état clos est rangé sous un nom daté',
    archivedPathFor(
      '/p/exploitation-relecteur-apple.json',
      Date.UTC(2026, 8, 13, 10),
    ),
    '/p/exploitation-relecteur-apple.2026-09-13T10-00-00Z.json',
  )
  check(
    'la commande qui retrouve le même état',
    commandFor(
      'admettre',
      opts(['--compte', '/r.json', '--objet', 'pixel', '--duree', '1h']),
    ),
    'node scripts/testflight-reviewer.mjs admettre --compte /r.json --objet pixel',
  )

  // LE PORT : l'adresse, le jeton, la clé.
  await scenario('le port', async () => {
    const seen = []
    const port = portTo('https://messagr.eu', secret, async (url, init) => {
      seen.push({ url, init })
      return { status: 200, text: async () => '{"ok":true}' }
    })
    const answered = await port(
      requests.mint('!r:h', 2, 604_800, 'messagr-cle-0001'),
    )
    await port(requests.status('inv/1'))
    check('le port rend la réponse', answered, {
      status: 200,
      body: '{"ok":true}',
    })
    check(
      'une demande porte le jeton, le type, la clé et le corps',
      [
        seen[0].url,
        seen[0].init.method,
        seen[0].init.headers.Authorization === `Bearer ${secret}`,
        seen[0].init.headers['Content-Type'],
        seen[0].init.headers['idempotency-key'],
        JSON.parse(seen[0].init.body),
      ],
      [
        'https://messagr.eu/_messagr/invitations',
        'POST',
        true,
        'application/json',
        'messagr-cle-0001',
        { max_uses: 2, ttl_seconds: 604_800, room_id: '!r:h' },
      ],
    )
    check(
      'une lecture ne porte ni corps ni type',
      [seen[1].url, seen[1].init.body, 'Content-Type' in seen[1].init.headers],
      ['https://messagr.eu/_messagr/invitations/inv%2F1', undefined, false],
    )
  })

  const described = describeEmission({
    publicPart: null,
    options: opts(['--duree', '1h', '--usages', '1']),
    statePath: '/p/e.json',
  })
  check(
    '--dry-run décrit sans jeton',
    [
      described.includes('Bearer <jeton du compte, non montré>'),
      described.includes('"max_uses":1,"ttl_seconds":3600'),
      described.includes(secret),
    ],
    [true, true, false],
  )

  // LES GESTES, dans un monde en mémoire.
  const start = Date.UTC(2026, 8, 13, 10)
  const world = ({ state = null, answers = [], typed = null }) => {
    const w = {
      sent: [],
      saved: [],
      printed: [],
      slept: [],
      events: [],
      keys: 0,
      clock: start,
    }
    let held = state === null ? null : copied(state)
    w.deps = {
      send: async request => {
        w.sent.push(request)
        w.events.push(`${request.method} ${request.path}`)
        const next = answers.shift()
        if (next === undefined)
          throw new Error(
            `requête imprévue : ${request.method} ${request.path}`,
          )
        if (next instanceof Error) throw next
        return next
      },
      now: () => w.clock,
      sleep: async ms => {
        w.slept.push(ms)
        w.clock += ms
        if (w.slept.length > 100) throw new Error('la boucle ne s’arrête pas')
      },
      random: () => 0.5,
      newKey: () => `messagr-cle-${String((w.keys += 1)).padStart(4, '0')}`,
      loadState: () => (held === null ? null : copied(held)),
      saveState: (path, next) => {
        held = copied(next)
        w.saved.push(held)
        w.events.push(`écrit ${w.saved.length - 1}`)
      },
      archiveState: (path, at) => {
        held = null
        return archivedPathFor(path, at)
      },
      print: text => w.printed.push(text),
      log: text => w.printed.push(text),
      ask: async () => typed,
      statePath: '/p/exploitation-relecteur-apple.json',
      server: 'https://messagr.eu',
      userId: '@exploitation:messagr.eu',
      options: opts([]),
    }
    w.last = () => w.saved.at(-1)
    return w
  }
  const ok = body => ({ status: 200, body })
  const emitted = {
    serveur: 'https://messagr.eu',
    emetteur: '@exploitation:messagr.eu',
    objet: 'relecteur-apple',
    usages: 2,
    duree_secondes: 604_800,
    room_id: '!c:messagr.eu',
    regles_posees: true,
    cle_idempotence: 'messagr-cle-0001',
    demande_le: new Date(start).toISOString(),
    invitation_id: 'inv-1',
    lien: 'https://messagr.eu/i/JETON',
    echeance: new Date(start + 604_800_000).toISOString(),
  }

  await scenario('emettre', async () => {
    const w = world({
      answers: [
        ok('{"room_id":"!conversation:messagr.eu"}'),
        ok(
          '{"users":{"@exploitation:messagr.eu":100},"events":{"m.room.name":50},"users_default":0}',
        ),
        ok('{"event_id":"$1"}'),
        ok('{"event_id":"$2"}'),
        ok('{"invitation_id":"inv-1","token":"JETONDINVITATION"}'),
      ],
    })
    const result = await emit(w.deps)
    check('emettre réussit', result.ok, true)
    check(
      'emettre envoie, dans l’ordre, ce que fait l’application',
      w.sent.map(one => `${one.method} ${one.path}`),
      [
        'POST /_matrix/client/v3/createRoom',
        'GET /_matrix/client/v3/rooms/!conversation%3Amessagr.eu/state/m.room.power_levels',
        'PUT /_matrix/client/v3/rooms/!conversation%3Amessagr.eu/state/m.room.power_levels',
        'PUT /_matrix/client/v3/rooms/!conversation%3Amessagr.eu/state/m.room.encryption',
        'POST /_messagr/invitations',
      ],
    )
    check(
      'les niveaux lus sont gardés, les trois règles posées',
      w.sent[2].body,
      {
        users: { '@exploitation:messagr.eu': 100 },
        events: { 'm.room.name': 50 },
        users_default: 0,
        invite: 50,
        redact: 101,
      },
    )
    check('la demande porte deux usages et sept jours', w.sent[4].body, {
      max_uses: 2,
      ttl_seconds: 604_800,
      room_id: '!conversation:messagr.eu',
    })
    // LA DERNIÈRE ÉCRITURE AVANT LA DEMANDE doit porter la clé que la demande
    // envoie : une clé écrite après, ou une autre clé envoyée, échouent ici.
    const writtenBefore = w.events
      .slice(0, w.events.indexOf('POST /_messagr/invitations'))
      .filter(event => event.startsWith('écrit '))
      .at(-1)
    check(
      'la clé envoyée est celle écrite juste avant',
      writtenBefore === undefined
        ? null
        : w.saved[Number(writtenBefore.slice('écrit '.length))].cle_idempotence,
      w.sent[4].headers['idempotency-key'],
    )
    const last = w.last()
    check(
      "l'état porte l'invitation, la conversation, l'échéance et le lien",
      [last.invitation_id, last.room_id, last.echeance, last.lien],
      [
        'inv-1',
        '!conversation:messagr.eu',
        '2026-09-20T10:00:00.000Z',
        'https://messagr.eu/i/JETONDINVITATION',
      ],
    )
  })

  await scenario('emettre, reprise', async () => {
    const { invitation_id, lien, echeance, ...interrupted } = emitted
    const w = world({
      state: {
        ...interrupted,
        cle_idempotence: 'messagr-cle-premiere',
        demande_le: new Date(start - 60_000).toISOString(),
      },
      answers: [ok('{"invitation_id":"inv-1","token":"JETON"}')],
    })
    const result = await emit(w.deps)
    check(
      'une reprise ne recrée rien et rejoue la même clé',
      [result.ok, w.sent.length, w.sent[0].headers['idempotency-key']],
      [true, 1, 'messagr-cle-premiere'],
    )
    check(
      "l'échéance d'une reprise court depuis la première demande",
      w.last().echeance,
      new Date(start - 60_000 + 604_800_000).toISOString(),
    )
  })

  await scenario('emettre, refus', async () => {
    const w = world({ state: emitted })
    const result = await emit(w.deps)
    check(
      'une invitation vivante n’est pas écrasée',
      [result.ok, w.sent.length, w.saved.length],
      [false, 0, 0],
    )
  })

  await scenario('admettre', async () => {
    const w = world({
      state: emitted,
      answers: [
        ok('{"status":"pending"}'),
        ok('{"status":"pending","entrant_user_id":"@d:messagr.eu"}'),
        ok('{}'),
        ok('{"status":"pending","entrant_user_id":"@d:messagr.eu"}'),
        ok('{"status":"pending","entrant_user_id":"@t:messagr.eu"}'),
        {
          status: 403,
          body: '{"errcode":"M_FORBIDDEN","error":"Event is not authorized."}',
        },
        new TypeError('fetch failed'),
        { status: 503, body: '{"errcode":"MESSAGR_UPSTREAM","error":"x"}' },
        ok(
          '{"status":"claimed","claimed_user_id":"@t:messagr.eu","claimed_at":1754772000}',
        ),
        ok('{"status":"revoked"}'),
      ],
    })
    const result = await admit(w.deps)
    check("admettre s'arrête sur revoked, sans échec", result, {
      ok: true,
      reason: "l'invitation est révoquée",
    })
    check(
      'chaque compte nouvellement nommé est invité une fois',
      w.sent
        .filter(one => one.path.endsWith('/invite'))
        .map(one => one.body.user_id),
      ['@d:messagr.eu', '@t:messagr.eu'],
    )
    check(
      'les invitations sont notées avec leur réponse',
      w.last().invites.map(one => [one.user_id, one.resultat]),
      [
        ['@d:messagr.eu', 'invited'],
        ['@t:messagr.eu', 'refused'],
      ],
    )
    check(
      'une panne tient en deux lignes, son début et son retour',
      w.printed.filter(
        line =>
          line.startsWith('réponse inattendue') ||
          line === 'le service répond de nouveau',
      ).length,
      2,
    )
    check(
      "l'entrée est constatée, la clôture écrite",
      [w.last().entree_constatee.user_id, w.last().close.raison],
      ['@t:messagr.eu', "l'invitation est révoquée"],
    )
    check(
      'deux secondes après une invitation, le repos avant',
      w.slept,
      [25_000, 2000, 2000, 2000, 2000, 2000, 2000],
    )
    check(
      'aucune ligne de journal ne porte le lien',
      w.printed.some(line => line.includes('JETON')),
      false,
    )
  })

  await scenario('admettre, reprise', async () => {
    const w = world({
      state: { ...emitted, nomme: handled('@d:messagr.eu') },
      answers: [
        ok('{"status":"pending","entrant_user_id":"@d:messagr.eu"}'),
        ok('{"status":"expired"}'),
      ],
    })
    await admit(w.deps)
    check(
      'un compte invité avant la relance ne l’est pas deux fois',
      w.sent.filter(one => one.path.endsWith('/invite')).length,
      0,
    )
  })

  await scenario('admettre, jetons', async () => {
    const dead = world({
      state: emitted,
      answers: [
        { status: 401, body: '{}' },
        { status: 401, body: '{}' },
      ],
    })
    const alive = world({
      state: emitted,
      answers: [
        { status: 401, body: '{}' },
        ok('{"user_id":"@exploitation:messagr.eu"}'),
        ok('{"status":"revoked"}'),
      ],
    })
    check('un jeton mort arrête, en échec', (await admit(dead.deps)).ok, false)
    check(
      'un 401 du service seul ne l’arrête pas',
      (await admit(alive.deps)).ok,
      true,
    )
  })

  await scenario('admettre, un usage', async () => {
    const w = world({
      state: { ...emitted, usages: 1 },
      answers: [
        ok('{"status":"claimed","claimed_user_id":"@l:h","claimed_at":1}'),
      ],
    })
    check(
      'un usage pris arrête une invitation à un usage',
      await admit(w.deps),
      { ok: true, reason: "l'unique usage de l'invitation est pris" },
    )
  })

  await scenario('admettre, autre compte', async () => {
    const w = world({ state: { ...emitted, emetteur: '@mmaudet:messagr.eu' } })
    check(
      'l’invitation d’un autre compte est refusée sans rien envoyer',
      [(await admit(w.deps)).ok, w.sent.length],
      [false, 0],
    )
  })

  await scenario('etat', async () => {
    const w = world({
      state: { ...emitted, nomme: handled('@d:messagr.eu') },
      answers: [ok('{"status":"pending","entrant_user_id":"@d:messagr.eu"}')],
    })
    await showState(w.deps)
    const said = w.printed.join('\n')
    check(
      'etat montre le lien et ce que dit le service, sans rien écrire',
      [
        said.includes('https://messagr.eu/i/JETON'),
        said.includes('nomme @d:messagr.eu, déjà invité'),
        w.saved.length,
      ],
      [true, true, 0],
    )
  })

  await scenario('revoquer', async () => {
    const declined = world({ state: emitted, typed: 'non' })
    check(
      'sans confirmation, rien n’est envoyé',
      [(await revoke(declined.deps)).ok, declined.sent.length],
      [false, 0],
    )
    const confirmed = world({
      state: emitted,
      typed: 'revoquer',
      answers: [ok('{"revoked":true,"deactivated_accounts":1}')],
    })
    await revoke(confirmed.deps)
    check(
      'confirmé, revoquer supprime l’invitation et note ce que le service a désactivé',
      [
        `${confirmed.sent[0].method} ${confirmed.sent[0].path}`,
        confirmed.last().comptes_desactives,
        typeof confirmed.last().revoquee_le,
      ],
      ['DELETE /_messagr/invitations/inv-1', 1, 'string'],
    )
    const unknown = world({
      state: emitted,
      typed: 'revoquer',
      answers: [{ status: 404, body: '{"errcode":"M_NOT_FOUND","error":"x"}' }],
    })
    const refused = await revoke(unknown.deps)
    check(
      'une invitation inconnue n’est pas notée révoquée',
      [refused.ok, unknown.saved.length],
      [false, 0],
    )
  })

  // LE DISQUE : chmod 600, rien à moitié écrit.
  const scratch = mkdtempSync(join(tmpdir(), 'relecteur-'))
  try {
    const path = join(scratch, 'prive', 'etat.json')
    saveState(path, { lien: 'x' })
    check(
      "l'état est écrit en 600, relu tel quel, sans fichier temporaire",
      [
        statSync(path).mode.toString(8).slice(-3),
        loadState(path),
        existsSync(`${path}.${process.pid}.tmp`),
        loadState(join(scratch, 'absent.json')),
      ],
      ['600', { lien: 'x' }, false, null],
    )
    const archived = archiveState(path, Date.UTC(2026, 8, 13))
    check(
      'un état rangé quitte sa place',
      [existsSync(path), basename(archived)],
      [false, 'etat.2026-09-13T00-00-00Z.json'],
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  check("aucun cas n'a touché le réseau", reached, 0)

  if (failures.length > 0) {
    console.error(
      `testflight-reviewer self-test : ${failures.length} en échec sur ${cases}\n`,
    )
    for (const one of failures) console.error(`${one}\n`)
    process.exit(1)
  }
  console.log(`testflight-reviewer self-test : les ${cases} cas passent`)
}

// ---------------------------------------------------------------------------
// L'entrée.
// ---------------------------------------------------------------------------

const USAGE = [
  'usage : node scripts/testflight-reviewer.mjs <geste> [options]',
  '',
  '  emettre    [--duree 7j] [--usages 2] [--dry-run]',
  '  admettre   à lancer sous caffeinate -i',
  '  etat',
  '  revoquer',
  '',
  'et pour chacun : --compte <fichier> (défaut ~/.messagr-exploitation/messagr-eu.json),',
  '                 --objet <nom> (défaut relecteur-apple), ou --etat <fichier>',
  '',
  '  node scripts/testflight-reviewer.mjs --self-test',
].join('\n')

/**
 * Une ligne tapée sur le terminal, ou `null` à la fin de l'entrée standard :
 * un refus, pour que rien d'irréversible ne passe par un tube.
 */
function askOnTheTerminal() {
  return new Promise(answer => {
    const terminal = createInterface({ input: process.stdin })
    let said = null
    terminal.once('line', line => {
      said = line
      terminal.close()
    })
    terminal.once('close', () => answer(said))
  })
}

/** Une ligne de journal : l'heure en UTC, puis l'événement. */
function logLine(text) {
  console.log(`${new Date().toISOString().slice(0, 19)}Z  ${text}`)
}

function isTransport(cause) {
  return (
    cause?.message === 'fetch failed' ||
    cause?.name === 'TimeoutError' ||
    cause?.name === 'AbortError'
  )
}

async function main(argv) {
  const [gesture, ...args] = argv
  if (gesture === '--self-test') return selfTest()
  if (!Object.hasOwn(OPTIONS_OF, gesture ?? '')) {
    console.error(USAGE)
    process.exit(2)
  }
  const options = readOptions(gesture, args, process.env[CREDENTIALS_ENV])
  if (!options.ok) {
    console.error(`${options.reason}\n\n${USAGE}`)
    process.exit(2)
  }

  let credentials
  try {
    credentials = readCredentials(readFileSync(options.credentials, 'utf8'))
  } catch (cause) {
    credentials = {
      ok: false,
      reason:
        cause.code === 'ENOENT'
          ? "le fichier n'existe pas"
          : `illisible (${cause.code ?? cause.name})`,
    }
  }

  if (gesture === 'emettre' && options.dryRun) {
    const publicPart = credentials.ok
      ? { server: credentials.server, userId: credentials.userId }
      : null
    const statePath = statePathFor({
      explicit: options.statePath,
      userId: publicPart?.userId ?? DEFAULT_EMITTER,
      purpose: options.purpose,
      directory: PRIVATE_DIRECTORY,
    })
    console.log(describeEmission({ publicPart, options, statePath }))
    return
  }

  // `etat` se passe du compte quand on lui nomme l'état : il montre alors ce
  // qui est écrit, et dit pourquoi il n'interroge pas le service.
  const offline = gesture === 'etat' && options.statePath !== null
  if (!credentials.ok && !offline) {
    console.error(`${options.credentials} : ${credentials.reason}`)
    process.exit(1)
  }
  const statePath = statePathFor({
    explicit: options.statePath,
    userId: credentials.ok ? credentials.userId : DEFAULT_EMITTER,
    purpose: options.purpose,
    directory: PRIVATE_DIRECTORY,
  })
  if (insideRepository(statePath, REPOSITORY)) {
    console.error(
      `${statePath} est dans le dépôt, qui est public : l'état porte le lien, il vit hors du dépôt.`,
    )
    process.exit(1)
  }

  const deps = {
    send: credentials.ok
      ? portTo(credentials.server, credentials.accessToken)
      : null,
    offline: credentials.ok
      ? null
      : `${options.credentials} : ${credentials.reason}`,
    now: () => Date.now(),
    sleep: ms => new Promise(wake => setTimeout(wake, ms)),
    random: Math.random,
    newKey: () => `messagr-${localpartOf(credentials.userId)}-${randomUUID()}`,
    loadState,
    saveState,
    archiveState,
    print: text => console.log(text),
    log: logLine,
    ask: askOnTheTerminal,
    statePath,
    server: credentials.server,
    userId: credentials.userId,
    options,
  }

  if (gesture === 'admettre') {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        logLine(
          "admission interrompue ; l'état est écrit, la même commande la reprend",
        )
        process.exit(signal === 'SIGINT' ? 130 : 143)
      })
    }
  }

  const gestures = {
    emettre: emit,
    admettre: admit,
    etat: showState,
    revoquer: revoke,
  }
  let result
  try {
    result = await gestures[gesture](deps)
  } catch (cause) {
    // Rien de ce qui a été écrit n'est défait : `emettre` reprend où il
    // s'était arrêté, `admettre` aussi.
    const why = isTransport(cause) ? transportDetail(cause) : cause.message
    console.error(`${gesture} interrompu : ${why} ; la même commande reprend`)
    process.exit(1)
  }
  if (result.reason !== undefined) {
    ;(result.ok ? console.log : console.error)(result.reason)
  }
  process.exit(result.ok ? 0 : 1)
}

// Appelé comme script, et pas quand on l'importe pour le lire.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
}
