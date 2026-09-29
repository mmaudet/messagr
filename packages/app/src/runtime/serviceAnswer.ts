/**
 * An answer of the invitation service, read the same way by every journey
 * that asks it something: discovery (#397), invitations delivered inside
 * Messagr (#404), looking for one's contacts (#400), reports (#468).
 *
 * A refusal is an answer too: its status and its body are handed back
 * rather than thrown, and what counts as done is each journey's to decide,
 * where it is tested.
 */

/** An answer of the service: its status and its body, read as text. */
export interface Answer {
  readonly status: number
  readonly body: string
}

/** A JSON object, or `null` for anything else a body may hold. */
export function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
