/**
 * Matrix's `EncryptedFile`, built from what the bridge hands back.
 *
 * # Why this is its own module
 *
 * A photograph and a document are different events -- one states dimensions
 * and draws a picture, the other states a filename and draws a row -- but the
 * object that says WHERE the ciphertext went and WHICH key opens it is the
 * same object in both, and it is the one place where a mistake is silent: an
 * event carrying `url` beside `file` is one a client may try to fetch in the
 * clear, and there is nothing at that address to fetch.
 *
 * So it lives here rather than inside `imageEvent.ts`, where `fileEvent.ts`
 * would have had to import it from a module about pictures, or copy it.
 */

/**
 * Matrix's `EncryptedFile`, as an event carries it: where the ciphertext
 * is, and what opens and checks it. Whatever else the event gave is kept as
 * it gave it. What a report needs of it to be opened by the operator is
 * `openingOf`'s to say (`reportFormat.ts`).
 */
export interface EncryptedFile {
  /** The address of the ciphertext on the homeserver, `mxc://…`. */
  readonly url: string
  /** The JSON Web Key that opens it: AES-256-CTR, its `k` in base64url. */
  readonly key: { readonly k: string; readonly [field: string]: unknown }
  /** The counter the decryption starts from, in base64. */
  readonly iv: string
  /** Its `sha256` is the hash of the ciphertext, in base64. */
  readonly hashes: {
    readonly sha256: string
    readonly [field: string]: unknown
  }
  readonly [field: string]: unknown
}

/** Where one sealed file went, and the key that opens it. */
export interface Uploaded {
  readonly url: string
  /** `SealedAttachment.secret`, verbatim. */
  readonly secret: string
}

/** The `EncryptedFile` object: the bridge's key material, plus the address. */
export function fileOf(uploaded: Uploaded): Record<string, unknown> {
  let material: unknown
  try {
    material = JSON.parse(uploaded.secret)
  } catch {
    throw new Error('the attachment secret is not readable')
  }
  if (material === null || typeof material !== 'object') {
    throw new Error('the attachment secret is not an object')
  }
  // The address last, so a secret that somehow carried one cannot overwrite
  // where the bytes actually went.
  return { ...(material as Record<string, unknown>), url: uploaded.url }
}
