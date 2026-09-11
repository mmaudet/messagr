import type { EncryptedDatabase } from './givenNameStore'

/**
 * The ciphertext a conversation was last built from, so it can be built
 * again with no network.
 *
 * # THE HALF THE LIST CACHE DID NOT COVER
 *
 * `listCacheStore.ts` made the conversation LIST survive a launch with no
 * network: one line per conversation, drawn before anything is asked of
 * anybody. Opening one of those conversations still asked. Reported from the
 * demonstration Pixel on 11 September 2026: *« même en mode avion, je dois
 * pouvoir consulter les conversations »*.
 *
 * # WHAT IS KEPT IS THE CIPHERTEXT, AND THAT IS THE WHOLE POINT
 *
 * ADR-0006 refuses decrypted content on disk. It does not refuse encrypted
 * content, and it could not: the crypto store is on disk already, and the
 * decision named its own protection -- a 32-byte random passphrase in the
 * operating system's keystore -- as what makes that acceptable.
 *
 * So this holds `/messages` responses exactly as the homeserver sent them:
 * events whose `content` is `m.room.encrypted`, opaque to anything without
 * the room keys. Reading it back and decrypting it is the same act
 * `loadConversation` performs on a fresh response, with the same keys, in
 * the same process, and nothing decrypted is written anywhere.
 *
 * This is a different bargain from the list cache and a smaller one. That
 * page holds PLAINTEXT -- the opening of each last message -- and argued its
 * cost plainly: *« Un attaquant avec ce fichier apprend les ouvertures des
 * derniers messages, ce qui est un coût réel et borné, et pas l'historique.
 * »* This page holds no plaintext at all. An attacker with the file and
 * without the crypto store learns who wrote when, which the homeserver knows
 * anyway, and not a word of what was said.
 *
 * It is still inside the notebook rather than beside it, under the same
 * passphrase as the rest. Ciphertext needs no protection; the metadata
 * around it does.
 *
 * # WHOLE CHUNKS, NOT EVENTS
 *
 * One row per conversation holding one response, because that is the unit
 * that is fetched and the unit that is used. Storing events individually
 * would mean rebuilding an order this never has to reason about, and a
 * merge this never has to get right.
 *
 * It also bounds itself for free: a response is capped by the `limit` its
 * caller asked for, so a conversation's row is capped too, and replacing it
 * is what expires it. No policy to write, and none to get wrong.
 */
export interface EventCache {
  /**
   * The events this conversation was last built from. Empty for one never
   * opened, which is indistinguishable from a conversation with nothing in
   * it -- and rightly so: both are "nothing to show without a network".
   */
  readonly of: (scope: string) => Promise<readonly unknown[]>
  /**
   * Replaces what is kept for one conversation.
   *
   * An empty chunk is kept rather than refused: a conversation everything
   * was removed from answers `[]`, and that is a true answer this page must
   * be able to hold. What must never reach here is a FAILED fetch, which
   * throws rather than answering -- the caller's business, and the same
   * distinction `mergeSummaries.ts` had to draw for the list.
   */
  readonly keep: (scope: string, chunk: readonly unknown[]) => Promise<boolean>
}

/** One row per conversation, and the conversation is the key. */
const SCHEMA = `CREATE TABLE IF NOT EXISTS event_cache (
  scope TEXT PRIMARY KEY,
  chunk TEXT NOT NULL,
  kept_at INTEGER NOT NULL
)`

/** A notebook that would not open. Answers nothing and keeps nothing. */
export function forgetfulEventCache(): EventCache {
  return { of: async () => [], keep: async () => false }
}

export async function openEventCache(
  database: EncryptedDatabase,
  now: () => number = Date.now,
): Promise<EventCache> {
  await database.execute(SCHEMA)

  return {
    of: async scope => {
      try {
        const { rows } = await database.execute(
          'SELECT chunk FROM event_cache WHERE scope = ?',
          [scope],
        )
        const held = (rows[0] as Record<string, unknown> | undefined)?.chunk
        if (typeof held !== 'string') return []
        // Read defensively rather than cast, for the reason every page of
        // this notebook gives: it is a file on a device, and a row of the
        // wrong shape is a row to drop rather than a screen to crash.
        const parsed: unknown = JSON.parse(held)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    },
    keep: async (scope, chunk) => {
      try {
        await database.execute(
          'INSERT OR REPLACE INTO event_cache (scope, chunk, kept_at) ' +
            'VALUES (?, ?, ?)',
          [scope, JSON.stringify(chunk), now()],
        )
        return true
      } catch {
        return false
      }
    },
  }
}
