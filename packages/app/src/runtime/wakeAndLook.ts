// The headless composition root.
//
// `App.tsx` is the one the application has; this is the one a wake has. It
// exists for the same reason and does the same job: it names the native
// pieces, makes the client, and hands everything else ports. Nothing below it
// knows there is more than one.
//
// It is separate from `cryptoPump.ts` on purpose. That module binds phases to
// a client it is *given* and never makes one -- `createClient` is imported
// there as a type, deliberately. A wake has nobody to be given a client by, so
// it makes one here, where the boundary allows it.
import { createClient } from 'matrix-js-sdk'

import { loadConversation, startCryptoMachine } from './cryptoPump'
import {
  sessionSecrets,
  storeDirectorySecrets,
  syncCursorSecrets,
} from './deviceSecrets'
import { getErrorMessage } from './errors'
import { logEvent } from './log'
import { lookForWhatArrived } from './lookForWhatArrived'
import { openNotebook } from './notebook'
import { makePumpHttp } from './pump'
import { loadSession } from './sessionStore'
import { readStoreDirectory } from './storeDirectory'
import { readSyncCursor } from './syncCursor'
import type { Arrival } from './wake'

/**
 * What a woken device finds, or `null` when it cannot look.
 *
 * # `null` for every obstacle, and no message about any of them
 *
 * `wake.ts` treats `null` as "this device could not open its store" and draws
 * the notification that names nobody. Everything that can go wrong here is an
 * obstacle of that kind: no recorded directory, no session, a keystore that
 * will not answer because the screen has not been unlocked since the phone
 * was switched on — which is precisely the case ADR-0008's accessibility
 * setting bounds, and precisely the case the blind notification exists for.
 *
 * None of them deserves a different notification. A person does not want to
 * be told which internal step failed; they want to know something arrived,
 * which is what they are told.
 *
 * # It reports each obstacle to the log, which is where it belongs
 *
 * There is no screen here. `MESSAGR_WAKE_BLIND` with the reason is the only
 * account anybody debugging a silent phone will ever get.
 */
export async function lookForWhatArrivedHere(): Promise<
  readonly Arrival[] | null
> {
  const blind = (reason: string) => {
    logEvent('info', 'MESSAGR_WAKE_BLIND', { reason })
    return null
  }

  const where = await readStoreDirectory(storeDirectorySecrets)
  if (where.dir === null) return blind(where.reason)

  const session = await loadSession(sessionSecrets)
  if (session === null) {
    return blind('this device holds no session')
  }

  try {
    const sessionClient = createClient(session)
    const started = await startCryptoMachine(
      sessionClient,
      session,
      where.dir,
      () => {
        // A to-device failure during a wake is not worth a second
        // notification, and there is nothing here to report it to.
      },
    )
    if (!started.started) return blind(started.reason)

    const notebook = await openNotebook(where.dir)
    return await lookForWhatArrived({
      http: makePumpHttp(sessionClient),
      since: await readSyncCursor(syncCursorSecrets),
      readConversation: async scope =>
        (await loadConversation(sessionClient, scope, session.userId)).entries,
      names: notebook.names,
      selfUserId: session.userId,
      lastRead: await notebook.lastRead.all(),
    })
  } catch (cause: unknown) {
    return blind(getErrorMessage(cause))
  }
}
