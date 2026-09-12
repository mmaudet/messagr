import { fileOf, type Uploaded } from './encryptedFile'

/**
 * A document, as an event another Matrix client would recognise.
 *
 * # `body` IS the filename here, and that is the opposite of a photograph
 *
 * `imageEvent.ts` deliberately refuses to put the filename in `body`: a name
 * off somebody's camera roll carries a date, sometimes a place, occasionally
 * a person, and nobody chose to disclose any of it by choosing a photograph.
 *
 * A document is the other way round. Its name is what somebody picked it by,
 * it is what the row shows, and it is what the person on the other end needs
 * to know before deciding whether to save forty megabytes. Hiding it would be
 * hiding the content, not protecting it.
 *
 * Matrix says the same thing in two fields: `body` is what a client shows
 * when it cannot render the file, `filename` is the original name. For a
 * document they are the same string, and both are sent -- a client that reads
 * only one of them is not a client this event should render badly in.
 *
 * # No dimensions, which is why `ImageContent` could not be reused
 *
 * `StatedInfo` requires `w` and `h`. A file has neither, and an `info` that
 * stated them would be an `info` that lied.
 */

/** What a file states about itself. Matrix's `FileInfo`, minus the parts
 * nothing here produces. */
interface StatedFileInfo {
  readonly mimetype: string
  readonly size: number
}

export interface FileContent {
  readonly msgtype: 'm.file'
  readonly body: string
  readonly filename: string
  readonly info: StatedFileInfo
  /** The address and the key material, which Matrix keeps in one object. */
  readonly file: Record<string, unknown>
}

/** A document as the picker handed it over: bytes, and what it is called. */
export interface PickedDocument {
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly name: string
}

/** A received document, once it has been read defensively. */
export interface ReadDocument {
  readonly url: string
  /** Handed back to `decryptAttachment` unchanged -- minus the address. */
  readonly secret: string
  /** What the row is headed by. Never empty: an unnamed file is refused. */
  readonly name: string
  readonly mimeType: string | null
  /** `null` when the sender stated none, which Matrix allows. */
  readonly size: number | null
}

export function describeFile(
  document: PickedDocument,
  /** Where the ciphertext went, and its key. */
  uploaded: Uploaded,
): FileContent {
  return {
    msgtype: 'm.file',
    body: document.name,
    filename: document.name,
    info: {
      mimetype: document.mimeType,
      size: document.bytes.length,
    },
    file: fileOf(uploaded),
  }
}

export function readFileEvent(
  content: Record<string, unknown>,
): ReadDocument | null {
  if (content.msgtype !== 'm.file') return null

  const file = content.file
  if (file === null || typeof file !== 'object') return null

  const { url, ...material } = file as Record<string, unknown>
  if (typeof url !== 'string' || url === '') return null

  // TWO FIELDS FOR ONE NAME, AND EITHER WILL DO. `body` is what a client
  // shows when it cannot render the file and `filename` is the original
  // name; senders fill one, the other, or both. A row headed by nothing
  // would be a file nobody can decide about, so the second is read when the
  // first is absent -- and a file named by neither is refused rather than
  // headed by a placeholder somebody would mistake for the name.
  const named = [content.body, content.filename].find(
    one => typeof one === 'string' && one !== '',
  )
  if (typeof named !== 'string') return null

  const info = asRecord(content.info)

  return {
    url,
    // The address comes off again: `decryptAttachment` is given what the
    // bridge produced, and `url` was not part of it.
    secret: JSON.stringify(material),
    name: named,
    mimeType: typeof info?.mimetype === 'string' ? info.mimetype : null,
    size: typeof info?.size === 'number' ? info.size : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}
