import {
  encryptedFileOf,
  type ReportedFile,
  type ReportedMessage,
} from '../runtime/reportFormat'
import { fileOf, type EncryptedFile } from './encryptedFile'
import type { TimelineEntry } from './mergeTimeline'

/**
 * What is selected, and which actions that selection allows.
 *
 * # A SELECTION IS A SET OF IDENTIFIERS AND NOTHING ELSE
 *
 * Everything else is derived from the timeline, on demand. Holding entries
 * in the selection would be holding a second copy of the conversation, which
 * goes stale the moment a message is decrypted late or redacted -- the same
 * argument ADR-0005 makes about the timeline itself.
 *
 * # ABSENT, NEVER GREYED
 *
 * An action that does not apply to everything selected is not offered. A
 * greyed control is a control that has to be explained, and applying an
 * action to the part of a selection it happens to fit -- destroying three
 * messages of five, silently -- is worse than both.
 *
 * Copying is the one deliberate exception, and it has moved once. #192 said
 * a photograph contributes nothing to a clipboard and a selection of nothing
 * but photographs had no Copy at all -- true then, because there was no way
 * to put a picture on a clipboard. The dependency added for text
 * (`@react-native-clipboard/clipboard`) turned out to carry `setImage`, so
 * the constraint that justified the rule was gone and nobody had gone back
 * to it. Asked for from the Pixel: « je ne sais plus pourquoi on ne peut pas
 * copier une image ».
 *
 * A photograph is skipped when it sits beside words, and copied on its own.
 * `onlyPhotograph` says why a clipboard cannot hold both.
 */

/**
 * Adds what is not there, removes what is. One gesture, both directions.
 *
 * SEVERAL AT ONCE, and all in the same direction, because a plate is one
 * thing on screen and several events underneath: it goes in and out as a
 * whole, which is what its single outline promises. The direction is the
 * first one's -- a plate half in and half out is a state nothing can draw.
 */
export function toggle(
  selected: ReadonlySet<string>,
  eventIds: readonly string[],
): ReadonlySet<string> {
  const first = eventIds[0]
  if (first === undefined) return selected
  const adding = !selected.has(first)
  const next = new Set(selected)
  for (const eventId of eventIds) {
    if (adding) next.add(eventId)
    else next.delete(eventId)
  }
  return next
}

/** The selected entries, in the order the conversation reads. */
function chosen(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return entries.filter(entry => selected.has(entry.eventId))
}

/**
 * Whether "remove for everyone" is offered.
 *
 * Only on this account's own events. Redacting somebody else's message is a
 * moderation power, not a delete button -- and in a one-to-one it existed
 * only by an accident of room defaults that nobody chose (#196).
 *
 * THE PROTOCOL AGREES NOW, and this rule stops being the only thing holding
 * it. A conversation is created with `redact` above every level anybody
 * holds, so the homeserver refuses a redaction of somebody else's event from
 * either side -- measured, `403 M_FORBIDDEN` both ways. This screen was the
 * whole of the answer while the asymmetry was live in the room; it is now
 * the screen agreeing with the room rather than covering for it, which is
 * what makes it safe against another Matrix client on the same account.
 *
 * A selected event the timeline does not carry blocks it too: nothing can
 * say whose it is, so nothing offers to destroy it.
 */
export function canRemoveForEveryone(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
  selfUserId: string,
): boolean {
  if (selected.size === 0) return false
  const found = chosen(selected, entries)
  if (found.length !== selected.size) return false
  return found.every(entry => entry.claimedSender === selfUserId)
}

/**
 * The kinds of message a report carries as words (#468), as a person writes
 * them. A photograph (`m.image`) or a document (`m.file`) goes as the
 * description of its encrypted file (#471); a video, a voice message, a
 * place or a sticker is not carried at all.
 */
const WORDS: ReadonlySet<string> = new Set(['m.text', 'm.notice', 'm.emote'])

/** What a report of a selection carries: one author, and their messages. */
export interface Reportable {
  /** The account the homeserver attributes every message to. */
  readonly author: string
  /** In the order the conversation reads them. */
  readonly messages: readonly ReportedMessage[]
}

/**
 * What a report of the selection would carry (#468, #471), or `null` when
 * the selection cannot be reported, and « Signaler » is then absent.
 *
 * THE ONE DEFINITION, which the bar reads to offer « Signaler », the sheet
 * to show what leaves, and `reportMessages` to seal it: so nothing leaves
 * that was not shown.
 *
 * ONE AUTHOR, BECAUSE A REPORT NAMES ONE. What the operator decides, it
 * decides about an account (#462): a selection mixing two people would ask
 * it to take down a message somebody else wrote. And never this account's
 * own messages, which nobody reports to have them removed.
 *
 * WORDS, PHOTOGRAPHS AND DOCUMENTS, mixed as the person chose them. Words
 * go as the device shows them. A photograph or a document goes as the
 * description of its encrypted file, the one its event carried
 * (`reportFormat.ts`): the address of the encrypted copy already on the
 * server, and what opens and checks it. Never its bytes, which this reading
 * does not even have: nothing is downloaded, decrypted or uploaded to make
 * a report (ADR 0006, ADR 0015). Nor its thumbnail's key, which the operator
 * does not need.
 *
 * A selection holding anything else is not a report at all, rather than a
 * report quietly missing it: a video, a voice message, a place, a sticker, a
 * message this device could not open, one removed, or a file the operator
 * could not open, by the one rule the operator's tool reads too
 * (`openingOf`).
 *
 * A selected event the conversation no longer carries makes it `null` too,
 * as for removing: nothing can say what would be sent.
 */
export function reportable(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
  selfUserId: string,
): Reportable | null {
  const found = chosen(selected, entries)
  const author = found[0]?.claimedSender
  if (author === undefined || author === selfUserId) return null
  if (found.length !== selected.size) return null
  const messages: ReportedMessage[] = []
  for (const entry of found) {
    const message =
      entry.claimedSender === author && entry.removed !== true
        ? reportedMessageOf(entry)
        : null
    if (message === null) return null
    messages.push(message)
  }
  return { author, messages }
}

/**
 * The message a report carries for `entry`: its words, or the description
 * of the photograph or the document it is. `null` for anything else.
 */
function reportedMessageOf(entry: TimelineEntry): ReportedMessage | null {
  const sent = {
    eventId: entry.eventId,
    sentAt: entry.sentAt,
    sender: entry.claimedSender,
  }
  const { image, document } = entry
  if (entry.msgtype === 'm.image' && image !== undefined) {
    // A photograph's `body` is the name its sender gave for clients that
    // cannot draw it (`imageEvent.ts`).
    return fileMessageOf(sent, 'photograph', image, entry.body, image.size)
  }
  if (entry.msgtype === 'm.file' && document !== undefined) {
    return fileMessageOf(
      sent,
      'document',
      document,
      document.name,
      document.size,
    )
  }
  if (
    entry.msgtype !== undefined &&
    WORDS.has(entry.msgtype) &&
    entry.body !== null
  ) {
    return { ...sent, kind: 'text', text: entry.body }
  }
  return null
}

/**
 * The message a report carries for a photograph or a document: the encrypted
 * file its event carried, rebuilt from what the conversation kept of it
 * (`fileOf`), its type, `name` and `size`. `null` when that file could not be
 * opened (`encryptedFileOf`, whose rule the operator's tool reads too).
 */
function fileMessageOf(
  sent: Pick<ReportedFile, 'eventId' | 'sentAt' | 'sender'>,
  kind: ReportedFile['kind'],
  read: {
    readonly url: string
    readonly secret: string
    readonly mimeType: string | null
  },
  name: string | null,
  size: number | null,
): ReportedFile | null {
  let file: EncryptedFile | null
  try {
    file = encryptedFileOf(fileOf(read))
  } catch {
    // A secret that is not an object: nothing could open this file.
    return null
  }
  return file === null
    ? null
    : { ...sent, kind, file, mimetype: read.mimeType, name, size }
}

/**
 * Whether the selection can be forwarded.
 *
 * Everything readable can: a message this device could not open has nothing
 * to send on, and a removed one has nothing left at all. Unlike Copy, a
 * photograph counts -- forwarding a picture is most of why anybody forwards.
 */
/**
 * Whether the selection can be kept as a favourite.
 *
 * The same reading as forwarding, and for a related reason: a favourite is a
 * promise that this can be found again, and a message this device could not
 * open has nothing to find. A removed one has nothing at all -- keeping a
 * tombstone would fill the screen with lines saying something used to be
 * here.
 *
 * Unlike forwarding, nothing leaves the device, so there is no second
 * question about what it would cost to send.
 */
export function canFavourite(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): boolean {
  const found = chosen(selected, entries)
  if (found.length === 0) return false
  return found.every(
    entry =>
      entry.removed !== true &&
      (entry.image !== undefined || entry.body !== null),
  )
}

export function canForward(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): boolean {
  const found = chosen(selected, entries)
  if (found.length === 0) return false
  return found.every(
    entry =>
      entry.removed !== true &&
      (entry.image !== undefined || entry.body !== null),
  )
}

/**
 * The one photograph a copy would put on the clipboard, if there is exactly
 * one and nothing else.
 *
 * # WHY EXACTLY ONE, AND WHY NOT BESIDE TEXT
 *
 * A clipboard holds one thing. `setString` and `setImage` are two calls to
 * the same clipboard, and the second replaces the first -- so a selection of
 * words *and* a picture cannot be copied as both, and choosing silently
 * would put half of what somebody selected somewhere they cannot see. Words
 * win in that case, because they are what "copy" means to most people, and
 * the picture is what forwarding is for.
 *
 * Two photographs cannot be copied at all for the same reason: the second
 * would overwrite the first.
 */
export function onlyPhotograph(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): TimelineEntry | null {
  const found = chosen(selected, entries)
  const one = found[0]
  if (found.length !== 1 || one === undefined) return null
  return one.image !== undefined && one.removed !== true ? one : null
}

/** Whether anything selected has words in it, or is a single photograph. */
export function canCopy(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): boolean {
  return (
    copyText(selected, entries) !== '' ||
    onlyPhotograph(selected, entries) !== null
  )
}

/**
 * What goes into the clipboard: the bodies, in order, one per line.
 *
 * NO NAME AND NO TIME, and that is not a simplification. WhatsApp copies
 * `[10:32] Marie : …`, which cannot be done here: the names in this product
 * are local (ADR-0010 -- *"a given name says who somebody is to you, on the
 * device where you said it"*), and the clipboard is the least controlled
 * destination that exists. A format carrying the name would paste into any
 * application a name neither the homeserver nor the correspondent knows.
 *
 * A photograph contributes nothing -- pasting its file name would be pasting
 * something nobody wrote -- and neither does a message this device could not
 * read.
 */
export function copyText(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): string {
  return chosen(selected, entries)
    .filter(entry => entry.image === undefined && entry.body !== null)
    .map(entry => entry.body)
    .join('\n')
}
