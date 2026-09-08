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

import { openCallEvents } from '../calls/inbox'
import { rejectEvent } from '../calls/wire'

import {
  encryptingDeps,
  loadConversation,
  startCryptoMachine,
} from './cryptoPump'
import { encryptionSlice, receiveSyncChanges } from 'react-native-matrix-crypto'
import {
  sessionSecrets,
  storeDirectorySecrets,
  syncCursorSecrets,
} from './deviceSecrets'
import { getErrorMessage } from './errors'
import { logEvent } from './log'
import { lookForWhatArrived } from './lookForWhatArrived'
import { openNotebook } from './notebook'
import { sendIntoScope } from './encryptAndSend'
import { makePumpHttp } from './pump'
import { loadSession } from './sessionStore'
import { readStoreDirectory } from './storeDirectory'
import { readSyncCursor } from './syncCursor'
import { fetchRoomMessages } from '../timeline/buildTimeline'
import type { WhatWoke } from './wake'

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
export async function lookForWhatArrivedHere(): Promise<WhatWoke | null> {
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
    const woke = await lookForWhatArrived({
      http: makePumpHttp(sessionClient),
      since: await readSyncCursor(syncCursorSecrets),
      readConversation: async scope =>
        (await loadConversation(sessionClient, scope, session.userId)).entries,
      // The same reader the running application uses, bound to the machine
      // this wake just started. `buildTimeline` draws no bubble for
      // `m.call.*`, so the conversation above cannot answer this question --
      // the raw events have to be opened again, for the one event type the
      // timeline deliberately drops.
      openCalls: (scope, events) =>
        openCallEvents(encryptingDeps(sessionClient), scope, events),
      // The room key for what just arrived is in this same response. The
      // running application's loop does this on every poll; a wake did not,
      // and reported `missing_key` for events whose key was sitting beside
      // them.
      takeTheKeys: sync => receiveSyncChanges(encryptionSlice(sync)),
      now: () => Date.now(),
      names: notebook.names,
      selfUserId: session.userId,
      lastRead: await notebook.lastRead.all(),
    })

    // THE ONLY WITNESS TO A CALL NOBODY WAS AWAKE FOR.
    //
    // A call that arrives while the application is asleep is seen by this
    // process and by nothing else: the runtime that records calls does not
    // exist here. Without this line the Appels tab would list the calls
    // somebody was present for and silently omit every one they missed --
    // which is the row a person opens that screen to find.
    //
    // `callLogStore.ts` folds this row together with the runtime's, when the
    // application starts afterwards and records the same call.
    for (const calling of woke.ringing) {
      await notebook.calls.add({
        scope: calling.scope,
        peerUserId: calling.from,
        at: calling.missedAt ?? Date.now(),
        direction: 'in',
        outcome: 'missed',
      })
    }
    return woke
  } catch (cause: unknown) {
    return blind(getErrorMessage(cause))
  }
}

/**
 * Refusing a call from a notification, in a process with no screen.
 *
 * # WHY THIS OPENS EVERYTHING AGAIN
 *
 * A press on "refuse" happens on a locked screen, and the handler that
 * receives it runs headless: no application, no session, no crypto machine.
 * The refusal has to be an encrypted event in the conversation like every
 * other, so all three are opened for the one send -- the same preamble
 * `lookForWhatArrivedHere` runs, for the same reason.
 *
 * # AND WHY IT IS WORTH IT
 *
 * Without it, refusing takes the notification down here and leaves the
 * caller listening to a telephone that rings for the full ninety seconds of
 * the invitation's lifetime. `m.call.reject` is the difference between
 * "they said no" and "they never answered", and the specification is
 * explicit that a rejection carries no reason: "the rejection of a call is
 * always implicitly because the user chose not to answer it".
 *
 * Answers what happened rather than throwing. There is nobody to tell.
 */
export async function refuseTheCallHere(
  scope: string,
): Promise<{ readonly refused: boolean; readonly reason?: string }> {
  const no = (reason: string) => {
    logEvent('info', 'MESSAGR_CALL_NOT_REFUSED', { scope, reason })
    return { refused: false, reason }
  }

  const where = await readStoreDirectory(storeDirectorySecrets)
  if (where.dir === null) return no(where.reason)

  const session = await loadSession(sessionSecrets)
  if (session === null) return no('this device holds no session')

  try {
    const sessionClient = createClient(session)
    const started = await startCryptoMachine(
      sessionClient,
      session,
      where.dir,
      () => {
        // As above: nothing here to report a to-device failure to.
      },
    )
    if (!started.started) return no(started.reason)

    const deps = encryptingDeps(sessionClient)
    // THE ROOM'S OWN RECENT EVENTS, NOT A SYNC.
    //
    // A sync would answer what changed since a cursor this must not
    // advance, and the invitation may well be behind it -- it is what woke
    // the device, which happened before this press. `/messages` asks the
    // question actually being asked: what is the call in this conversation
    // right now.
    const events = await fetchRoomMessages(deps.http, scope, 20)
    const calls = await openCallEvents(deps, scope, events)
    const invite = [...calls]
      .reverse()
      .find(
        event =>
          (event as { type?: unknown }).type === 'm.call.invite' &&
          (event as { sender?: unknown }).sender !== session.userId,
      )
    if (invite === undefined) return no('no invitation to refuse')

    const content = (invite as { content?: { call_id?: unknown } }).content
    const callId = content?.call_id
    if (typeof callId !== 'string') return no('the invitation named no call')

    // The device id as the party id, which is what the specification
    // suggests and what the running application uses -- so a refusal from
    // here and a refusal from the screen name the same device.
    const refusal = rejectEvent(callId, session.deviceId)
    const sent = await sendIntoScope(deps, scope, refusal.type, {
      ...refusal.content,
    })
    if (!sent.sent) return no(sent.reason)
    logEvent('info', 'MESSAGR_CALL_REFUSED', { scope })
    return { refused: true }
  } catch (cause: unknown) {
    return no(getErrorMessage(cause))
  }
}
