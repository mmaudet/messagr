/**
 * Which ciphertext a conversation is built from: what the homeserver just
 * sent, or what this device kept the last time it asked.
 *
 * # WHY THIS IS ITS OWN MODULE
 *
 * It is four lines, and they live here rather than inside
 * `loadConversation` because that file imports the bridge — and importing
 * `react-native-matrix-crypto` as a value installs a native JSI bootstrap
 * that crashes the test runner's parser. `syncLoop.ts`, `acceptBackup.ts`
 * and `outgoingPumpCycle.ts` all say the same and all took the same way out.
 *
 * So the decision is here, exercised, and that file is glue.
 *
 * # THE RULE, AND THE TWO THINGS IT REFUSES TO DO
 *
 * A fetch that answers is the truth. **Including when it answers with
 * nothing**: a conversation everything was removed from answers `[]`, and
 * preferring a remembered chunk there would redraw messages that are gone —
 * which is worse than an empty screen, because it is an empty screen the
 * person cannot tell from a full one.
 *
 * A fetch that FAILS is not an answer. Only then is what was kept used.
 *
 * And when nothing was kept, **the failure is raised rather than answered
 * with an empty list**. A conversation never opened on this device has
 * nothing behind it, and a screen drawn from `[]` would say « rien n'a
 * encore été dit ici » about a conversation full of messages nobody could
 * fetch. The caller already knows how to say a conversation could not be
 * read; this must not take that away from it.
 *
 * # KEEPING IS NOT AWAITED, AND CANNOT FAIL THE OPEN
 *
 * The conversation is about to be drawn and a notebook write is not
 * something a person waits behind. Every page of the notebook swallows its
 * own failures and answers `false`, so there is nothing to catch — but the
 * catch is here anyway, because a page that ever stopped doing that would
 * otherwise take a conversation down with it.
 */
export interface RememberedEvents {
  readonly of: (scope: string) => Promise<readonly unknown[]>
  readonly keep: (scope: string, chunk: readonly unknown[]) => Promise<boolean>
}

export async function eventsToBuildFrom(
  scope: string,
  fetch: () => Promise<readonly unknown[]>,
  remembered?: RememberedEvents,
): Promise<readonly unknown[]> {
  try {
    const fresh = await fetch()
    remembered?.keep(scope, fresh).catch(() => {})
    return fresh
  } catch (cause: unknown) {
    const held = (await remembered?.of(scope)) ?? []
    if (held.length === 0) throw cause
    return held
  }
}
