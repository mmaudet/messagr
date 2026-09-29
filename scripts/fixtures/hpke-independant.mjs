// Une seconde construction de la RFC 9180, sur node:crypto seul (#465).
//
// Le mode de base, avec DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 et
// ChaCha20-Poly1305 : la suite du nom déclaré et d'un signalement. Écrite
// d'après le texte de la RFC et la description du format dans
// `packages/app/src/runtime/reportFormat.ts`, sans rien importer de
// l'application ni de @noble : X25519, HMAC-SHA256 et ChaCha20-Poly1305
// viennent d'OpenSSL, par node:crypto.
//
// # À quoi elle sert
//
// À vérifier le scellement des deux côtés sans que l'application soit juge de
// son propre travail (`sealedReport.spec.ts`). Elle reproduit d'abord le
// vecteur de l'annexe A.2.1, en scellant et en ouvrant. Puis elle scelle
// `signalement-de-test.json` à l'octet près, ouvre ce que l'application
// scelle, et scelle ce que l'outil de l'exploitant doit ouvrir. Le pont
// (#482) se vérifiera contre elle.
//
// Jamais les outils de l'exploitant, qui ouvrent avec le code de
// l'application : c'est ce qui fait qu'un écart entre les deux se voit.

import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

const hex = text => Buffer.from(text, 'hex')
const cat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)))
const ascii = text => Buffer.from(text, 'latin1')
const EMPTY = Buffer.alloc(0)

/** I2OSP(value, length) : `value` sur `length` octets, gros-boutiste. */
function i2osp(value, length) {
  const bytes = Buffer.alloc(length)
  bytes.writeUIntBE(value, 0, length)
  return bytes
}

const KEM_SUITE = cat(ascii('KEM'), i2osp(0x20, 2))
const HPKE_SUITE = cat(ascii('HPKE'), i2osp(0x20, 2), i2osp(1, 2), i2osp(3, 2))

const hmac = (key, data) =>
  crypto.createHmac('sha256', key).update(data).digest()
const extract = (salt, ikm) => hmac(salt, ikm)
function expand(prk, info, length) {
  let block = EMPTY
  let out = EMPTY
  for (let counter = 1; out.length < length; counter += 1) {
    block = hmac(prk, cat(block, info, Buffer.of(counter)))
    out = cat(out, block)
  }
  return out.subarray(0, length)
}
const labeledExtract = (suite, salt, label, ikm) =>
  extract(salt, cat(ascii('HPKE-v1'), suite, ascii(label), ikm))
const labeledExpand = (suite, prk, label, info, length) =>
  expand(
    prk,
    cat(i2osp(length, 2), ascii('HPKE-v1'), suite, ascii(label), info),
    length,
  )

// X25519 par OpenSSL : les 32 octets d'une clé, dans leur enveloppe DER.
const PKCS8 = hex('302e020100300506032b656e04220420')
const SPKI = hex('302a300506032b656e032100')
const privateKey = secret =>
  crypto.createPrivateKey({
    key: cat(PKCS8, secret),
    format: 'der',
    type: 'pkcs8',
  })
const publicKey = key =>
  crypto.createPublicKey({ key: cat(SPKI, key), format: 'der', type: 'spki' })
const dh = (secret, key) =>
  crypto.diffieHellman({
    privateKey: privateKey(secret),
    publicKey: publicKey(key),
  })

/**
 * La moitié publique de `secret`.
 *
 * @param {Uint8Array} secret
 * @returns {Buffer}
 */
export function publicKeyOf(secret) {
  return crypto
    .createPublicKey(privateKey(secret))
    .export({ format: 'der', type: 'spki' })
    .subarray(SPKI.length)
}

/**
 * La moitié privée que `ikm` détermine : DeriveKeyPair, §7.1.3.
 *
 * @param {Uint8Array} ikm
 * @returns {Buffer}
 */
export function deriveSecretKey(ikm) {
  const prk = labeledExtract(KEM_SUITE, EMPTY, 'dkp_prk', ikm)
  return labeledExpand(KEM_SUITE, prk, 'sk', EMPTY, 32)
}

/** La clé et le nonce du premier message, §5.1 en mode de base. */
function context(dhResult, enc, recipient, info) {
  const eaePrk = labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dhResult)
  const shared = labeledExpand(
    KEM_SUITE,
    eaePrk,
    'shared_secret',
    cat(enc, recipient),
    32,
  )
  const pskIdHash = labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY)
  const infoHash = labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', info)
  const schedule = cat(Buffer.of(0), pskIdHash, infoHash)
  const secret = labeledExtract(HPKE_SUITE, shared, 'secret', EMPTY)
  return {
    key: labeledExpand(HPKE_SUITE, secret, 'key', schedule, 32),
    nonce: labeledExpand(HPKE_SUITE, secret, 'base_nonce', schedule, 12),
  }
}

/**
 * SealBase, pour le premier message, sous la clé éphémère `ephemeral`.
 *
 * @param {Uint8Array} ephemeral
 * @param {Uint8Array} recipient
 * @param {Uint8Array} info
 * @param {Uint8Array} aad
 * @param {Uint8Array} plaintext
 * @returns {{ enc: Buffer, ciphertext: Buffer }}
 */
export function seal(ephemeral, recipient, info, aad, plaintext) {
  const enc = publicKeyOf(ephemeral)
  const { key, nonce } = context(dh(ephemeral, recipient), enc, recipient, info)
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, {
    authTagLength: 16,
  })
  cipher.setAAD(aad, { plaintextLength: plaintext.length })
  const body = cat(cipher.update(plaintext), cipher.final())
  return { enc, ciphertext: cat(body, cipher.getAuthTag()) }
}

/**
 * OpenBase, pour le premier message, ou `null` quand l'étiquette ne passe pas.
 *
 * @param {Uint8Array} secret
 * @param {Uint8Array} enc
 * @param {Uint8Array} info
 * @param {Uint8Array} aad
 * @param {Uint8Array} ciphertext
 * @returns {Buffer | null}
 */
export function open(secret, enc, info, aad, ciphertext) {
  if (ciphertext.length < 16) return null
  const { key, nonce } = context(
    dh(secret, enc),
    enc,
    publicKeyOf(secret),
    info,
  )
  const body = ciphertext.subarray(0, ciphertext.length - 16)
  const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, {
    authTagLength: 16,
  })
  decipher.setAAD(aad, { plaintextLength: body.length })
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
  try {
    return cat(decipher.update(body), decipher.final())
  } catch {
    return null
  }
}

// Le format d'un signalement, relu dans sa description et récrit ici.

const INFO = ascii('messagr report v1')
const BLOCK = 4096

function aadOf(reason, reporter) {
  const r = ascii(reason)
  const a = ascii(reporter)
  return cat(i2osp(r.length, 2), r, i2osp(a.length, 2), a)
}

/**
 * Un pli, en base64 standard : `payload` complétée, scellée pour `recipient`
 * sous la clé éphémère `ephemeral`, liée au motif et au compte qui signale.
 *
 * @param {{ ephemeral: Uint8Array, recipient: Uint8Array, reason: string, reporter: string, payload: Uint8Array }} report
 * @returns {string}
 */
export function sealReport({
  ephemeral,
  recipient,
  reason,
  reporter,
  payload,
}) {
  const plaintext = Buffer.alloc(
    Math.ceil((payload.length + 1) / BLOCK) * BLOCK,
  )
  plaintext.set(payload)
  plaintext[payload.length] = 0x80
  const { enc, ciphertext } = seal(
    ephemeral,
    recipient,
    INFO,
    aadOf(reason, reporter),
    plaintext,
  )
  return cat(Buffer.of(1), enc, ciphertext).toString('base64')
}

/**
 * La charge d'un pli, ouvert avec `secret` pour ce motif et ce compte qui
 * signale, ou `null`.
 *
 * @param {{ secret: Uint8Array, reason: string, reporter: string, sealed: string }} report
 * @returns {Buffer | null}
 */
export function openReport({ secret, reason, reporter, sealed }) {
  const wire = Buffer.from(sealed, 'base64')
  if (wire.toString('base64') !== sealed || wire[0] !== 1) return null
  const padded = open(
    secret,
    wire.subarray(1, 33),
    INFO,
    aadOf(reason, reporter),
    wire.subarray(33),
  )
  if (padded === null || padded.length === 0 || padded.length % BLOCK !== 0) {
    return null
  }
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end -= 1
  return end >= 0 && padded[end] === 0x80 ? padded.subarray(0, end) : null
}
