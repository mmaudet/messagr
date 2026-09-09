/**
 * The one thing a Matrix call event does not say, read from the one place
 * that does.
 *
 * # THERE IS NO "THIS IS A VIDEO CALL" FLAG
 *
 * Matrix VoIP version 1 carries `offer.sdp` and nothing beside it. Whether a
 * call is video is in the session description, as an `m=video` media line —
 * so a client that wants to know before it answers has to read it.
 *
 * The alternative was a field of our own on `m.call.invite`. Refused: it
 * would be true only between two Messagr installations, and this reads
 * correctly for a call from any Matrix client.
 *
 * # DIRECTION IS PART OF THE QUESTION
 *
 * An `m=video` line with `a=recvonly` says *"I can receive a picture, I am
 * not sending one"*. That is not a video call, and a screen that announced
 * one would be promising a face that never arrives. `a=inactive` says even
 * less. Only a line that is sending — `sendrecv`, `sendonly`, or a line with
 * no direction attribute, which the specification defines as `sendrecv` —
 * counts.
 *
 * # WHY A PARSER AND NOT A REGULAR EXPRESSION
 *
 * Direction attributes are per-media-section and fall back to the session's
 * own, so `a=recvonly` before the first `m=` line applies to every section
 * that does not override it. A search for `m=video` alone gets that wrong in
 * the exact case this exists to catch.
 */

/** Whether the far end is offering to SEND a picture. */
export function offersVideo(sdp: string): boolean {
  let sessionDirection: Direction = 'sendrecv'
  let inVideo = false
  let videoDirection: Direction | null = null
  let seenMedia = false

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('m=')) {
      // A section that ended without saying otherwise inherits the session's.
      if (inVideo && sending(videoDirection ?? sessionDirection)) return true
      seenMedia = true
      inVideo = line.startsWith('m=video')
      videoDirection = null
      // A media line whose port is zero is a section being turned off. The
      // specification uses it for exactly that, and treating it as an offer
      // would announce a picture the far end has just withdrawn.
      if (inVideo && portOf(line) === 0) inVideo = false
      continue
    }
    const direction = directionOf(line)
    if (direction === null) continue
    if (!seenMedia) sessionDirection = direction
    else if (inVideo) videoDirection = direction
  }

  return inVideo && sending(videoDirection ?? sessionDirection)
}

type Direction = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive'

const DIRECTIONS = new Set<string>([
  'sendrecv',
  'sendonly',
  'recvonly',
  'inactive',
])

function directionOf(line: string): Direction | null {
  if (!line.startsWith('a=')) return null
  const value = line.slice(2)
  return DIRECTIONS.has(value) ? (value as Direction) : null
}

function sending(direction: Direction): boolean {
  return direction === 'sendrecv' || direction === 'sendonly'
}

/** `m=video 9 UDP/TLS/RTP/SAVPF 96` — the port is the second field. */
function portOf(line: string): number | null {
  const port = line.split(/\s+/)[1]
  if (port === undefined) return null
  const parsed = Number.parseInt(port, 10)
  return Number.isNaN(parsed) ? null : parsed
}
