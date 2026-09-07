import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { createClient } from 'matrix-js-sdk'

import { runProbe } from 'react-native-matrix-crypto'

import { fetchBridgeStatus } from './src/runtime/cryptoBridge'
import {
  claimOfferedHistory,
  evictMember,
  firstJoinedRoom,
  receiveOneEncryptedMessage,
  runPanicProbe,
  loadConversation,
  runOutgoingPump,
  sendOneEncryptedMessage,
  sendTypedMessage,
  admitEntrant,
  inviteSomebody,
  listConversations,
  openPhotograph,
  reactToMessage,
  registerThisDeviceForWaking,
  stopWakingThisDevice,
  sendPhotograph,
  sendReadReceipt,
  readTrust,
  removeReaction,
  startCryptoMachine,
  startLiveSync,
  vouchForEntrant,
  type CryptoPumpReport,
  type FormMigration,
  type ReactionTally,
  type ReceiveReport,
  type RunningSyncLoop,
  type TrustReading,
  type SendReport,
} from './src/runtime/cryptoPump'
import { getErrorMessage } from './src/runtime/errors'
import { computeHermesReport } from './src/runtime/hermes'
import { logEvent } from './src/runtime/log'
import { polyfillReport } from './src/runtime/bootstrap'
import { computeRuntimeGapReport } from './src/runtime/runtimeGaps'
import { computeNewArchitectureReport } from './src/runtime/newArchitecture'
import {
  languageSecrets,
  storeDirectorySecrets,
  termsSecrets,
  wakeSecrets,
  promiseSecrets,
  receiptSecrets,
  sessionSecrets,
  signUpSecrets,
} from './src/runtime/deviceSecrets'
import {
  publishReceipts,
  receiptsArePublished,
} from './src/runtime/receiptSetting'
import { readUpTo } from './src/runtime/receipts'
import { hasSeenPromise, rememberPromiseSeen } from './src/runtime/promiseSeen'
import { clearSignUp, isSignUpUnfinished } from './src/runtime/signUpMarker'
import { color, floors, space, type as typeScale } from './src/design/tokens'
import { mergeTimeline, type TimelineEntry } from './src/timeline/mergeTimeline'
import { makePumpHttp } from './src/runtime/pump'
import { fetchJoinedMembers } from './src/runtime/encryptedSend'
import { theOtherMember, type VouchOutcome } from './src/runtime/vouch'
import type { ConversationSummary } from './src/runtime/conversationList'
import type { GivenNames } from './src/runtime/givenName'
import { forgetfulGivenNames } from './src/runtime/givenNameStore'
import { forgetfulLastRead, type LastRead } from './src/runtime/lastReadStore'
import {
  forgetfulOutstanding,
  type Outstanding,
} from './src/runtime/outstandingStore'
import { admitAnyoneWaiting } from './src/runtime/admitAnyoneWaiting'
import { displayNameFor } from './src/runtime/givenName'
import { openNotebook } from './src/runtime/notebook'
import {
  readChosenLanguage,
  rememberLanguage,
} from './src/runtime/chosenLanguage'
import { rememberStoreDirectory } from './src/runtime/storeDirectory'
import { rememberTermsAccepted } from './src/runtime/termsAccepted'
import { allowWake, wakeIsAllowed } from './src/runtime/wakeSetting'
import { deviceLocale } from './src/runtime/deviceLocale'
import { pickFromLibrary } from './src/runtime/imageLibrary'
import { sendImages } from './src/runtime/sendImages'
import { pushTokenForThisDevice } from './src/runtime/pushDevice'
import { whenNotificationPressed } from './src/runtime/showNotification'
import type { ShownImage } from './src/runtime/receiveImage'
import type { ReadFile } from './src/timeline/imageEvent'
import type { Plate as Grouping } from './src/timeline/plates'
import type { EvictOutcome } from './src/runtime/evict'
import type { HistoryClaim } from './src/runtime/claimHistory'
import { Conversation } from './src/ui/Conversation'
import { ConversationList } from './src/ui/ConversationList'
import { Invite, type InviteStage } from './src/ui/Invite'
import { FloatingAction } from './src/ui/FloatingAction'
import { Header } from './src/ui/Header'
import { Composer } from './src/ui/Composer'
import { FullScreenPlate } from './src/ui/FullScreenPlate'
import { ConversationHeader } from './src/ui/ConversationHeader'
import { Legal } from './src/ui/Legal'
import { Reserved } from './src/ui/Reserved'
import { TabBar, type Tab } from './src/ui/TabBar'
import { Settings } from './src/ui/Settings'
import { Trust } from './src/ui/Trust'
import { GiveName } from './src/ui/GiveName'
import { FirstLaunch } from './src/ui/FirstLaunch'
import { Evict } from './src/ui/Evict'
import { Vouch } from './src/ui/Vouch'
import { setCatalogue, t } from './src/copy'
import type { Language } from './src/copy/languages'
import { enterWithASession } from './src/runtime/entry'
import { initialLink, watchLinks } from './src/runtime/incomingLink'
import { useKeyboardInset } from './src/ui/keyboardInset'
import { servicePoster } from './src/runtime/servicePoster'
import {
  fetchSessionSyncStatus,
  makeSyncClient,
  type SessionSyncStatus,
} from './src/runtime/sessionSync'
import { computeTransportStatus } from './src/runtime/transportStatus'

/**
 * The pump's outcome, folded in at screen level exactly as `session` already
 * folds in `credentials === null` alongside `sessionSync.ts`'s own
 * `SessionSyncStatus` — `cryptoPump.ts` reports its two phases separately
 * (see its own documentation for why), so this is where they become one
 * thing this screen shows.
 */
type PumpStatus =
  | 'not-configured'
  | { readonly outcome: 'not-started'; readonly reason: string }
  | { readonly outcome: 'sync-required'; readonly reason: string }
  | { readonly outcome: 'ran'; readonly report: CryptoPumpReport }

/**
 * The application: a frame, four tabs, and whatever one of them is showing.
 *
 * # What used to be here
 *
 * A diagnostic readout -- New Architecture, Runtime gaps, Matrix transport,
 * Entry, Session sync, Crypto bridge, Crypto pump, Encrypted send, Given
 * names, Keystore form -- with the screens rendered into it as they were
 * built. That readout *was* the application before there were screens, and it
 * is gone with #105: nobody installing Messagr should ever have seen it.
 *
 * # The instrument stayed, and the distinction is the whole point
 *
 * Every `logEvent` call is still here. The readout was the dashboard; the log
 * is the instrument, and it is the half that actually found the defects -- an
 * emulator with no network once reported thirteen crypto assertions failing
 * for no stated reason, and the only account of what was really wrong was the
 * application's own. Removing the log to remove the readout would have been
 * removing the instrument to remove the dashboard.
 *
 * The end-to-end suite reads that log now (`e2e/reported.ts`), which is what
 * it should have read all along: a line of JSON cannot be scrolled off, and
 * it says the same thing whatever the screens become.
 */
export function App({
  // Absent on any host that has not been updated to supply it (iOS has not
  // been, this ticket is Android-only): `computeCryptoMachineConfig` treats
  // an empty string as "no writable directory", which is exactly true here.
  storeDir = '',
}: {
  readonly storeDir?: string
}): React.JSX.Element {
  // Memoised because it is the effect's dependency. Recomputed each render it
  // would be a new object every time, the effect would re-run, its setState
  // would render again, and the bridge would be probed without end.
  const architecture = useMemo(() => computeNewArchitectureReport(), [])
  const gaps = useMemo(() => computeRuntimeGapReport(), [])
  const hermes = useMemo(() => computeHermesReport(), [])
  // No request is made: constructing a client is local. The address is a
  // reserved-TLD placeholder until account provisioning lands, so that a
  // real deployment's address is not carried in a public repository.
  const client = useMemo(
    () => computeTransportStatus(createClient, 'https://homeserver.invalid'),
    [],
  )
  // THE PROMISE GATES EVERYTHING BELOW IT, and that is the screen's whole
  // claim rather than an ordering preference. Its own words are "l'application
  // ne réclame rien avant d'avoir montré ce qu'elle promet" — so nothing may
  // reach the network, claim an invitation or ask a permission until somebody
  // has read it and tapped through.
  //
  // `null` means the keystore has not answered yet. It is a third state and
  // not a synonym for `false`: rendering the promise while the answer is
  // unknown would flash it at every relaunch of a device that has long since
  // seen it.
  const [promiseSeen, setPromiseSeen] = useState<boolean | null>(null)
  // WHICH LANGUAGE IS SPOKEN, AND WHY IT IS HELD HERE.
  //
  // `t()` reads a module variable, so switching the catalogue does not
  // re-render anything on its own -- see `copy/index.ts`. This state is what
  // does: the setter switches the catalogue and then changes the state, in
  // that order, so the re-render this causes already reads the new one.
  const [language, setLanguage] = useState<Language>('fr')
  const chooseLanguage = (next: Language) => {
    setCatalogue(next)
    setLanguage(next)
  }
  /**
   * What settling on a language writes down, as opposed to what passing over
   * one shows. Separated after a review: one callback doing both wrote a
   * keystore entry per language crossed mid-drag.
   *
   * Failure is silent on purpose: a language that did not persist is a screen
   * in the right language now and the wrong one next launch, which is a
   * smaller thing than a warning on a first screen.
   */
  const keepLanguage = (next: Language) => {
    rememberLanguage(languageSecrets, next).catch(() => {})
  }
  // The conversation this application holds, derived from the room on every
  // launch rather than read from a copy on disk. See ADR-0006.
  const [conversation, setConversation] = useState<TimelineEntry[] | null>(null)
  // The conversations this account is in, and the names this device gives
  // their other participants. ADR-0010: the names are held here and nowhere
  // else -- not on the homeserver, not with the other participant.
  const [summaries, setSummaries] = useState<readonly ConversationSummary[]>([])
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  // Inviting somebody, which is the same gesture as starting a conversation
  // with them. See issueInvitation.ts.
  /**
   * The frame, and whether it is resting at the newest message.
   *
   * A conversation opened at the top, on its oldest message, and a message
   * somebody sent landed below the fold -- so the answer to "did it send?"
   * was a scroll. Every messenger opens at the newest, and this one did not.
   *
   * `atBottom` is what stops the fix from becoming a second defect: scrolling
   * to the end on every content change would yank somebody reading history
   * back down the moment a message arrived. It starts true, so opening a
   * conversation lands at the newest; it goes false the moment somebody
   * scrolls up, and comes back when they return.
   */
  const frame = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const atBottom = useRef(true)
  /**
   * Which screen `atBottom` is an answer about.
   *
   * The flag is a ref, so it outlives the container `key` rebuilds: scrolling
   * up in one conversation and then opening another would open the second
   * wherever the first was left -- the same defect, moved one conversation
   * along. Resolved where it is read rather than on arrival: an `onLayout`
   * reset looked right and fires again whenever the keyboard resizes the
   * frame, which would yank a person reading history back down.
   */
  const restedIn = useRef<string | null>(null)

  const [invite, setInvite] = useState<InviteStage>({ stage: 'shut' })
  const [admission, setAdmission] = useState<'waiting' | 'admitted' | null>(
    null,
  )
  const inviteRef = useRef<((name: string | null) => void) | null>(null)
  const namesRef = useRef<GivenNames>(forgetfulGivenNames())
  // How far each conversation has been read here. Forgetful until the
  // notebook opens, and forgetful for good if it does not -- which shows
  // every conversation as unread rather than as read, since a badge that
  // should be there is a smaller lie than one that should not.
  const lastReadRef = useRef<LastRead>(forgetfulLastRead())
  /**
   * The invitations this device has issued and nobody has come through yet.
   *
   * A ref rather than state for the reason the other two pages are: it is
   * read from a sync tick, and a re-render for its own sake would be a
   * re-render per poll.
   */
  const outstandingRef = useRef<Outstanding>(forgetfulOutstanding())
  // Which conversation is open, held in a ref as well as in state: the live
  // sync loop's callbacks are created once and would otherwise keep deriving
  // whichever conversation was open when the loop started.
  // Which panel the list side is showing. A conversation, when one is open,
  // wins over all three: `openScope` is the deeper state and this is what sits
  // behind it.
  // Which tab is showing, and whether Settings has pushed the legal screen
  // over itself. Four tabs, and two of them are reserved before the thing
  // they hold exists -- see `Reserved`: a bar that gains an item later moves
  // every other item under people's thumbs.
  const [tab, setTab] = useState<Tab>('chat')
  // CONVERSATIONS, NOT MESSAGES.
  //
  // The tab's badge counts how many conversations have something waiting; the
  // rows carry how much is waiting in each. That is the division a person
  // reads without being told -- a tab saying `47` for one chatty conversation
  // would send somebody looking for forty-seven places to go.
  const unreadCount = summaries.filter(summary => summary.unread > 0).length
  const [legalOpen, setLegalOpen] = useState(false)
  // Whether the screen about the person is showing over the conversation.
  // The rare gestures live there rather than in the message flow -- see the
  // conversation's own comment for why.
  const [personOpen, setPersonOpen] = useState(false)
  // Which plate is open full screen, and at which photograph. `null` when
  // none is -- the viewer is a modal, so it is either there or it is not.
  const [openPlate, setOpenPlate] = useState<{
    readonly plate: Grouping
    readonly at: number
  } | null>(null)
  // How tall the bar and the action came out together. Not for positioning
  // them -- they are laid out, not offset -- but so the scroll view can end
  // above them rather than under them.
  const [dockHeight, setDockHeight] = useState(0)
  // What is known about the person on the other side. `null` until the screen
  // is asked for: it costs a device-status call and a state fetch, and a
  // conversation nobody opened that screen from should not pay for them.
  const [trust, setTrust] = useState<TrustReading | null>(null)
  const readTrustRef = useRef<((scope: string, other: string) => void) | null>(
    null,
  )
  // Reactions, grouped by the message they point at. ADR-0011: this
  // application aggregates its own, because a server cannot aggregate what it
  // cannot read.
  const [reactions, setReactions] = useState<
    ReadonlyMap<string, readonly ReactionTally[]>
  >(new Map())
  // Whether this device publishes read receipts, and which of this account's
  // own messages somebody else has read. Off unless somebody turned it on:
  // see receiptSetting.ts.
  const [receipts, setReceipts] = useState(false)
  const [receiptsNotKept, setReceiptsNotKept] = useState(false)
  // Whether this device asks to be woken. On unless somebody says otherwise,
  // which is the opposite of the switch above -- `wakeSetting.ts` says why.
  const [wake, setWake] = useState(true)
  const [wakeNotKept, setWakeNotKept] = useState(false)
  const wakeRef = useRef(true)
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set())
  const receiptsRef = useRef(false)
  // The conversation as the loop's callbacks can see it: they are made once,
  // and a receipt arriving names an event that has to be found among the
  // entries held right now.
  const conversationRef = useRef<readonly TimelineEntry[]>([])
  const [openScope, setOpenScope] = useState<string | null>(null)
  const openScopeRef = useRef<string | null>(null)
  // Choosing and sending a photograph, and opening one that arrived. Held in
  // refs like every other gesture the launch effect binds.
  const attachRef = useRef<(() => void) | null>(null)
  // Registering or removing this device's pusher. Held in a ref because the
  // settings switch is rendered outside the launch effect that binds it.
  const wakeThisDeviceRef = useRef<((on: boolean) => void) | null>(null)
  const openImageRef = useRef<((file: ReadFile) => Promise<ShownImage>) | null>(
    null,
  )
  const reactRef = useRef<
    ((target: string, key: string, own: string | null) => void) | null
  >(null)
  const openConversationRef = useRef<((scope: string) => void) | null>(null)
  const runningSyncRef = useRef<RunningSyncLoop | null>(null)
  // Set once by the launch effect, which is the only place that holds
  // everything a loop needs. Read by the foreground handler below, which
  // runs long after that effect has finished.
  const resumeSyncRef = useRef<(() => void) | null>(null)
  // Which loop the screen is currently listening to. See `beginLiveSync`.
  const liveGenerationRef = useRef(0)
  // The other person in this conversation, and the two halves of #34's
  // gesture. `party` is `null` for anything that is not a conversation of
  // two: vouching names one person, so it has nothing to offer a group.
  const [party, setParty] = useState<{
    readonly scope: string
    readonly other: string
  } | null>(null)
  const [vouch, setVouch] = useState<'idle' | 'working' | VouchOutcome>('idle')
  // Refs rather than state, and for one reason: the gesture's button lives
  // outside the effect that built the session, and re-rendering when a
  // client is stored would be a render nothing on screen depends on.
  const sessionClientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const credentialsRef = useRef<{
    readonly baseUrl: string
    readonly accessToken: string
  } | null>(null)
  const [claimed, setClaimed] = useState<HistoryClaim | null>(null)
  // Set once, at entry, and never cleared: the launch either was opened with
  // an unspent invitation or it was not, and a note that disappeared while
  // somebody read it would be worse than none.
  const [invitationIgnored, setInvitationIgnored] = useState(false)
  // `null` until the launch has answered. Distinguishing "not in" from "not
  // yet known" keeps the list from telling somebody they are locked out for
  // the second the keystore takes to answer.
  const [inYet, setInYet] = useState<boolean | null>(null)
  // What the keyboard is covering. See `keyboardInset.ts`: the manifest's
  // `adjustResize` stopped resizing anything under Android's enforced
  // edge-to-edge display, so the composer sat under the keyboard.
  const keyboardInset = useKeyboardInset()
  /**
   * A link handed over while this application was already running, and the
   * count of them.
   *
   * THE CASE THAT LOOKED HANDLED AND WAS NOT. `getInitialURL` answers only
   * when the operating system started the application to open a link.
   * Somebody who installs first and is sent the link afterwards is in the
   * other case entirely: the application comes to the front and nothing has
   * read anything. Reported by the first TestFlight tester on 7 September
   * 2026, who watched an empty conversation list and could do nothing.
   *
   * The count is what makes the launch below run again. Two invitations in a
   * row are two different links, and a value alone would not re-trigger for
   * the second if it happened to be the same string.
   */
  const [warmLink, setWarmLink] = useState<{
    readonly url: string
    readonly count: number
  } | null>(null)
  const [evicted, setEvicted] = useState<'idle' | 'working' | EvictOutcome>(
    'idle',
  )
  const [selfUserId, setSelfUserId] = useState('')
  const [sending, setSending] = useState<'idle' | 'sending' | 'failed'>('idle')
  // Held rather than rebuilt: it closes over the session and the room, which
  // only the probe below knows. `useState` with a function needs the extra
  // wrapper, since a bare function would be read as an updater.
  const [sendMessage, setSendMessage] = useState<
    ((body: string) => void) | null
  >(null)
  // #27's diagnostic, off in every ordinary build. A static read, because
  // that is the only shape babel's inliner replaces (sessionCredentials.ts
  // says the same about its four).
  const panicProbeRequested = useMemo(
    () => process.env.MESSAGR_PANIC_PROBE === '1',
    [],
  )
  /**
   * Whether this build proves its cryptography by sending a message at
   * launch.
   *
   * OFF IN AN ORDINARY BUILD, AND A TESTER IS WHY. The probe below encrypts
   * "encrypted by the bridge, sent by the application", puts it in a room and
   * reads it back -- which is the end-to-end proof #34 was built around, and
   * which for months landed in a bench account's own room where nobody was
   * looking.
   *
   * On 7 September 2026 somebody joined by invitation and that room became a
   * conversation with a person in it. He watched a sentence in English appear
   * in his chat on every launch, and reported it as a message that had not
   * been decrypted. It was decrypted; it was simply not for him.
   *
   * A diagnostic that writes into a conversation somebody reads is not a
   * diagnostic, it is a message. So it runs where it belongs -- the device
   * suite sets the flag -- and the report says `not-run` everywhere else,
   * which is the truth rather than a gap.
   */
  const sendProbeRequested = useMemo(
    () => process.env.MESSAGR_SEND_PROBE === '1',
    [],
  )

  // BACKGROUNDING, AND WHY IT IS NOT LEFT TO CHANCE.
  //
  // A held-open poll does not survive the process being suspended: the
  // operating system takes the socket with it, and a loop left running comes
  // back waiting on a connection that will never answer -- alive by every
  // measure this code has, and receiving nothing. Ending the poll on the way
  // out and starting a fresh one on the way back turns that into one extra
  // round trip.
  //
  // The cleanup is also the unmount path, so a loop cannot outlive the screen
  // that shows its state.
  useEffect(() => {
    const pause = () => {
      runningSyncRef.current?.stop()
      runningSyncRef.current = null
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') resumeSyncRef.current?.()
      else pause()
    })
    return () => {
      subscription.remove()
      pause()
    }
  }, [])

  // EVERY LINK HANDED OVER WHILE RUNNING, and the promise still gates it:
  // the launch below refuses to do anything until `promiseSeen` is true, so
  // an invitation arriving early is remembered rather than acted on.
  useEffect(
    () =>
      watchLinks(url => {
        setWarmLink(held => ({ url, count: (held?.count ?? 0) + 1 }))
      }),
    [],
  )

  // Asked once, before anything else. A keystore read and nothing more: no
  // network, which is what lets it run under the promise rather than after it.
  useEffect(() => {
    hasSeenPromise(promiseSecrets)
      .then(setPromiseSeen)
      .catch(() => setPromiseSeen(false))
    // THE LANGUAGE, BEFORE THE FIRST SCREEN IS DRAWN.
    //
    // Read in the same pass as the promise flag and for the same reason: a
    // keystore read and nothing more, so it can run under the promise rather
    // than after it. Which locale the device is set to is what an unset
    // choice falls back to -- see `chosenLanguage.ts`.
    readChosenLanguage(languageSecrets, deviceLocale())
      .then(chooseLanguage)
      .catch(() => undefined)
    receiptsArePublished(receiptSecrets)
      .then(on => {
        setReceipts(on)
        receiptsRef.current = on
      })
      .catch(() => undefined)
    wakeIsAllowed(wakeSecrets)
      .then(on => {
        setWake(on)
        wakeRef.current = on
      })
      .catch(() => undefined)
  }, [])

  // Held in a ref as well as in state: the live loop's callbacks are made
  // once, and whether receipts are published can change while it runs.
  useEffect(() => {
    receiptsRef.current = receipts
  }, [receipts])

  useEffect(() => {
    conversationRef.current = conversation ?? []
  }, [conversation])

  useEffect(() => {
    // Not started until the promise has been accepted. The effect re-runs when
    // it is, because `promiseSeen` is one of its dependencies — which is the
    // whole mechanism, and why it is listed there rather than read from a ref.
    if (promiseSeen !== true) return

    const probeAndReport = async (): Promise<void> => {
      const status = await fetchBridgeStatus(runProbe)

      // Answers one question and does nothing else. The machine it creates
      // carries a made-up identity and its own store, so letting the normal
      // flow run afterwards would be driving a bridge configured for
      // somebody who does not exist.
      if (panicProbeRequested) {
        const report = await runPanicProbe(
          { userId: '@probe:example.invalid', deviceId: 'PROBEDEVICE' },
          storeDir,
        )
        logEvent('info', 'MESSAGR_PANIC_PROBE', { ...report })
        return
      }

      // No provisioned account: report it rather than attempt a sync that has
      // nothing to restore. This keeps the screen runnable for a developer
      // who has not run scripts/provision-bench-accounts.sh.
      // How this application comes to have a session: one kept from a
      // previous launch, or one obtained by spending the invitation it was
      // opened with. Nothing arrives from the build any more.
      let historyClaim: HistoryClaim | null = null
      const entered = await enterWithASession({
        secrets: sessionSecrets,
        poster: servicePoster,
        // The warm link wins when there is one: it is the more recent
        // answer to the same question, and `getInitialURL` keeps handing
        // back the address this process was started with for as long as it
        // lives.
        link: warmLink === null ? initialLink : async () => warmLink.url,
        signUp: signUpSecrets,
        // A claim is two calls with the issuer's application in between. See
        // claimInvitation.ts: without a wait this tries once, is told 409,
        // and reports a link that cannot be used -- which is what it does on
        // a device with nothing else changed.
        wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      })
      const credentials = entered.entered ? entered.session : null

      let sessionStatus: SessionSyncStatus | 'not-configured'
      let pumpStatus: PumpStatus
      let sendStatus: SendReport | 'not-run' = 'not-run'
      let receiveStatus: ReceiveReport | 'not-run' = 'not-run'
      // THREE FACTS THAT ONLY THE READOUT USED TO CARRY.
      //
      // They were held in state and rendered, and #105 takes the rendering
      // away. Held as locals here as well so the launch report says them:
      // `passphrase` is the store's own continuity -- a relaunch reporting
      // `minted` means the passphrase did not survive and this device opened
      // a new, empty store, losing every room key the old one held -- and
      // there is nothing else anywhere that would say so.
      let passphrase: 'minted' | 'reused' | null = null
      let signUp: 'unfinished' | 'complete' | null = null
      let form: FormMigration | null = null
      // WHO ELSE THE LAUNCH FOUND IN THE ROOM.
      //
      // Three answers, not two, which is the whole point: `null` means the
      // member list never arrived, `derived: false` means it arrived and
      // named nobody but this account, `derived: true` means the other
      // person was found. `history` collapses all three into one null.
      //
      // Shape, not identity. A Matrix identifier written into logcat would
      // answer the question by putting a correspondent's name in the system
      // log; #107 refuses that of a notification, and a diagnostic has no
      // better claim.
      let whoElse: {
        readonly joined: number
        readonly derived: boolean
      } | null = null
      if (credentials === null) {
        sessionStatus = 'not-configured'
        pumpStatus = 'not-configured'
      } else {
        const sessionClient = createClient(credentials)
        sessionClientRef.current = sessionClient
        credentialsRef.current = credentials
        // Started before the sync below, not after: see startCryptoMachine's
        // own documentation for why the ordering is load-bearing.
        const start = await startCryptoMachine(
          sessionClient,
          credentials,
          storeDir,
          cause =>
            logEvent('error', 'MESSAGR_TO_DEVICE_FEED_FAILED', {
              reason: getErrorMessage(cause),
            }),
        )

        // Outside the `started` test below, deliberately: the migration runs
        // before the store is opened, so it has an answer even on a launch
        // that then fails to start a machine at all.
        form = start.passphraseForm

        try {
          sessionStatus = await fetchSessionSyncStatus(
            makeSyncClient(sessionClient),
          )

          if (start.started) {
            passphrase = start.passphraseMinted ? 'minted' : 'reused'
          }

          if (!start.started) {
            pumpStatus = { outcome: 'not-started', reason: start.reason }
          } else if (!sessionStatus.synced) {
            pumpStatus = {
              outcome: 'sync-required',
              reason: sessionStatus.reason,
            }
          } else {
            // The entitlement to create this account's first cross-signing
            // identity, and the only launch that ever carries it. A claim
            // created the account seconds ago by spending a single-use
            // token, so no other device can have published an identity --
            // which is the fact the library cannot have and refuses to
            // guess. See crossSigningIdentity.ts.
            // THE ENTITLEMENT TO CREATE THIS ACCOUNT'S FIRST IDENTITY.
            //
            // A claim carries it outright: the account is seconds old, so
            // nothing can be overwritten. A restore carries it only when the
            // device still holds the sign-up marker, which says a previous
            // launch began a sign-up it may not have finished.
            //
            // Everything uncertain resolves to `restored-session`, which
            // creates nothing. See signUpMarker.ts.
            setInYet(entered.entered)
            if (entered.entered && entered.invitationIgnored === true) {
              setInvitationIgnored(true)
            }

            const entitlement =
              entered.entered && entered.claimed
                ? ('account-just-created' as const)
                : (await isSignUpUnfinished(signUpSecrets))
                  ? ('finishing-sign-up' as const)
                  : ('restored-session' as const)

            const report = await runOutgoingPump(
              sessionClient,
              credentials,
              entitlement,
            )
            pumpStatus = { outcome: 'ran', report }

            // Cleared only once a homeserver has acknowledged the identity,
            // which is exactly what `established` means here: the machine
            // reports holding one and reports no publication pending. Clearing
            // any earlier would strand a device that still needed to finish.
            if (report.identity.established) {
              await clearSignUp(signUpSecrets)
            }
            signUp = (await isSignUpUnfinished(signUpSecrets))
              ? 'unfinished'
              : 'complete'
            // Only once the keys are published: a message encrypted before
            // this device's own keys are on the server is one nobody can
            // ask about, let alone decrypt.
            if (sendProbeRequested) {
              sendStatus = await sendOneEncryptedMessage(
                sessionClient,
                credentials,
              )
            }
            // Attempted whether or not this run's own send worked: what is
            // being read was written by somebody else, and one direction
            // failing should not hide the other. The room is the one the
            // send resolved, or the first joined room when there was no
            // send to resolve it.
            const roomId =
              sendStatus !== 'not-run' && sendStatus.sent
                ? sendStatus.roomId
                : await firstJoinedRoom(sessionClient)

            // THE NOTEBOOK. ADR-0010: the application's own encrypted store,
            // with a passphrase of its own. It degrades rather than failing --
            // a launch that cannot open it shows conversations as identifiers,
            // which is what an unnamed conversation looks like anyway.
            // WHERE THE STORES ARE, WRITTEN DOWN FOR THE WAKE.
            //
            // This path arrives as an initial property from MainActivity, and
            // a headless context is handed no properties -- so without this
            // the wake cannot open anything and is blind for ever.
            // `storeDirectory.ts` says why the keystore is where it goes and
            // why that is a workaround rather than a design.
            rememberStoreDirectory(storeDirectorySecrets, storeDir).catch(
              () => {
                // A wake that stays blind is a smaller thing than a launch
                // that failed over it.
              },
            )

            const opening = await openNotebook(storeDir)
            namesRef.current = opening.names
            lastReadRef.current = opening.lastRead
            outstandingRef.current = opening.outstanding
            logEvent(opening.opened ? 'info' : 'warn', 'MESSAGR_GIVEN_NAMES', {
              opened: opening.opened,
              ...(opening.minted === undefined
                ? {}
                : { minted: opening.minted }),
              ...(opening.reason === undefined
                ? {}
                : { reason: opening.reason }),
            })
            setNames(await opening.names.all())

            // READING IS WHAT CLEARS A BADGE.
            //
            // Two marks for one act, and they are not redundant. The local
            // one (`unread.ts`) is what the list draws, and it works whether
            // or not this account has agreed to be observed. The private
            // receipt is what stops the homeserver counting the message as
            // unread, which is what stops it pushing a notification for
            // something already read -- and it says that to the server and to
            // nobody else. The public receipt is the courtesy, and only if
            // somebody turned it on: see receiptSetting.ts.
            const markRead = async (
              scope: string,
              entries: readonly TimelineEntry[],
            ) => {
              const newest = entries[entries.length - 1]
              if (newest === undefined) return
              await lastReadRef.current.set(scope, newest.sentAt)
              await sendReadReceipt(
                sessionClient,
                scope,
                newest.eventId,
                'm.read.private',
              )
              if (receiptsRef.current) {
                await sendReadReceipt(
                  sessionClient,
                  scope,
                  newest.eventId,
                  'm.read',
                )
              }
            }

            // OPENING A CONVERSATION, from the list or from the launch.
            //
            // Everything a conversation needs and nothing a launch needs:
            // the timeline, who the other participant is, and the sender the
            // composer calls. The launch path below does more for the first
            // one -- the receive probe, the history claim -- because those
            // are diagnostics of a launch rather than of a conversation.
            const showConversation = (scope: string) => {
              setOpenScope(scope)
              openScopeRef.current = scope
              setConversation(null)
              setSendMessage(() => (body: string) => {
                setSending('sending')
                const deliver = async () => {
                  // THE ROOM, WHICH THIS DID NOT PASS. It called
                  // `sendOneEncryptedMessage`, a launch probe that picks
                  // `fetchJoinedRooms()[0]` -- so every message typed in
                  // any conversation went to whichever room the homeserver
                  // listed first. Two people watched their replies never
                  // arrive on 7 September 2026, and nothing was wrong with
                  // the encryption.
                  const sent = await sendTypedMessage(
                    sessionClient,
                    scope,
                    body,
                  )
                  if (!sent.sent) {
                    setSending('failed')
                    return
                  }
                  setSending('idle')
                  const fresh = await loadConversation(
                    sessionClient,
                    scope,
                    credentials.userId,
                  )
                  setConversation(held =>
                    mergeTimeline(held ?? [], fresh.entries),
                  )
                  setReactions(fresh.reactions)
                }
                // A send that failed for a reason nothing here anticipated
                // still has to leave the composer usable. Reported on the
                // screen rather than swallowed.
                deliver().catch(() => setSending('failed'))
              })

              const derive = async () => {
                const fresh = await loadConversation(
                  sessionClient,
                  scope,
                  credentials.userId,
                )
                setConversation(held =>
                  mergeTimeline(held ?? [], fresh.entries),
                )
                setReactions(fresh.reactions)
                const members = await fetchJoinedMembers(
                  makePumpHttp(sessionClient),
                  scope,
                )
                const other = theOtherMember(members, credentials.userId)
                setParty(other === null ? null : { scope, other })

                await markRead(scope, fresh.entries)
              }
              derive().catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_OPEN_CONVERSATION_FAILED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }
            openConversationRef.current = showConversation

            // REACTING, AND TAKING IT BACK. ADR-0011.
            //
            // A key this account already used is removed rather than added
            // again: tapping a chip one is in is how a person takes a
            // reaction back, and offering the same key twice would make a
            // count of two from one person.
            reactRef.current = (target, key, own) => {
              const scope = openScopeRef.current
              if (scope === null) return
              const gesture = async () => {
                const done =
                  own === null
                    ? await reactToMessage(sessionClient, scope, target, key)
                    : await removeReaction(sessionClient, scope, own)
                if ('reacted' in done && !done.reacted) {
                  logEvent('warn', 'MESSAGR_REACT_FAILED', {
                    reason: done.reason,
                  })
                } else if ('removed' in done && !done.removed) {
                  logEvent('warn', 'MESSAGR_UNREACT_FAILED', {
                    reason: done.reason ?? 'no reason given',
                  })
                }
                // RE-DERIVED, AND RE-DERIVED AGAIN UNTIL IT IS THERE.
                //
                // The tally is built from what the homeserver holds rather
                // than from a local guess, and that stays: a chip drawn from
                // a guess disagrees with the room the moment anything else
                // changes. But one read straight after the send is a read
                // the event has not always reached yet, and nothing ran
                // afterwards -- `derive` runs only when a conversation is
                // opened. So the person who pressed the emoji watched
                // nothing happen while the person they pressed it at saw the
                // chip appear. Reported from an iPhone on 7 September 2026.
                //
                // A few short attempts rather than one, and a wait between
                // them. Bounded because a reaction the server never accepted
                // must stop being asked about, and short because this is a
                // chip under somebody's thumb.
                const stillMine = () => openScopeRef.current === scope
                for (let look = 0; look < 4 && stillMine(); look += 1) {
                  const fresh = await loadConversation(
                    sessionClient,
                    scope,
                    credentials.userId,
                  )
                  setConversation(held =>
                    mergeTimeline(held ?? [], fresh.entries),
                  )
                  setReactions(fresh.reactions)
                  // The tallies for the message that was pressed. Adding a
                  // reaction has landed when one of them is this key and is
                  // mine; removing one has landed when none of them is.
                  const here = fresh.reactions.get(target) ?? []
                  const landed =
                    own === null
                      ? here.some(
                          tally => tally.key === key && tally.mine !== null,
                        )
                      : here.every(tally => tally.mine !== own)
                  if (landed) break
                  await new Promise(resolve => setTimeout(resolve, 700))
                }
              }
              gesture().catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_REACT_FAILED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }

            // SENDING A PHOTOGRAPH.
            //
            // The picker is opened here rather than inside the screen, for
            // the reason every native seam in this application is bound in
            // one place: a screen that imported the picker could not be
            // rendered by anything without it.
            //
            // The whole thing is one gesture from a person's point of view --
            // choose, and it is on its way -- so the screen shows one state
            // for the choosing, the sealing, the upload and the send. They
            // are four steps and none of them is separately actionable.
            attachRef.current = () => {
              const scope = openScopeRef.current
              if (scope === null) return
              const gesture = async () => {
                const chosen = await pickFromLibrary()
                // Nothing chosen. Not a failure, and it must not read as one.
                if (chosen.length === 0) return

                setSending('sending')
                // ONE AT A TIME. `sendImages` says why a `Promise.all` here
                // is a crash on somebody else's phone: the encryptor holds
                // the plaintext and the ciphertext together, so thirty at
                // once is sixty copies in memory.
                const done = await sendImages(
                  image =>
                    sendPhotograph(sessionClient, credentials, scope, image),
                  chosen,
                  progress =>
                    logEvent('info', 'MESSAGR_IMAGES_SENDING', { ...progress }),
                )
                if ('reason' in done) {
                  setSending('failed')
                  logEvent('warn', 'MESSAGR_IMAGE_SEND_FAILED', {
                    reason: done.reason,
                    sent: done.sent,
                    remaining: done.remaining,
                  })
                  return
                }
                setSending('idle')
                logEvent('info', 'MESSAGR_IMAGES_SENT', { sent: done.sent })
                const fresh = await loadConversation(
                  sessionClient,
                  scope,
                  credentials.userId,
                )
                setConversation(held =>
                  mergeTimeline(held ?? [], fresh.entries),
                )
                setReactions(fresh.reactions)
              }
              gesture().catch((cause: unknown) => {
                setSending('failed')
                logEvent('warn', 'MESSAGR_IMAGE_SEND_FAILED', {
                  reason: getErrorMessage(cause),
                })
              })
            }

            // Drawing one that arrived. Bound here for the same reason, and
            // held in a ref because `Photograph` keeps it in an effect's
            // dependency list -- a function rebuilt on every render would
            // make it re-download the picture on every render.
            openImageRef.current = image => openPhotograph(credentials, image)

            // TELLING THE HOMESERVER WHERE TO WAKE THIS DEVICE.
            //
            // After the session exists and not before: a pusher is registered
            // against an account. Failure is reported and nothing else --
            // a device that could not register one still works while it is
            // open, and a launch that failed over a notification would be a
            // launch nobody can read their messages from.
            //
            // Every launch rather than once. Firebase rotates tokens, and a
            // pusher keyed by a token nobody holds any more is a device that
            // silently stopped being notified. Re-registering the same token
            // is what the endpoint is for.
            const wakeThisDevice = (on: boolean) => {
              const settle = async () => {
                // The token is asked for either way. Removing a pusher needs
                // the key it was registered under, and this device's token is
                // the only thing that is -- so "off" needs it as much as "on".
                const answer = await pushTokenForThisDevice()
                if (answer.token === null) {
                  logEvent('info', 'MESSAGR_PUSH_NOT_REGISTERED', {
                    reason: answer.reason,
                  })
                  return
                }
                if (!on) {
                  // WHAT MAKES OFF MEAN OFF. Caught in review: stopping the
                  // next launch registering is not turning notifications off,
                  // because the pusher already on the homeserver keeps firing.
                  await stopWakingThisDevice(
                    sessionClient,
                    answer.token,
                    answer.road,
                  )
                  logEvent('info', 'MESSAGR_PUSH_REMOVED', {})
                  return
                }
                const done = await registerThisDeviceForWaking(
                  sessionClient,
                  credentials,
                  answer.token,
                  answer.road,
                )
                logEvent(
                  done.registered ? 'info' : 'warn',
                  done.registered
                    ? 'MESSAGR_PUSH_REGISTERED'
                    : 'MESSAGR_PUSH_NOT_REGISTERED',
                  done.registered ? {} : { reason: done.reason },
                )
              }
              settle().catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_PUSH_NOT_REGISTERED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }
            wakeThisDeviceRef.current = wakeThisDevice
            wakeThisDevice(wakeRef.current)

            // TAPPING A NOTIFICATION LANDS IN THE CONVERSATION.
            //
            // #90's other half, and it was missing until a review said so:
            // the notification was drawn and the tap resumed the application
            // on whichever tab it had been left on. The identifier a
            // notification is keyed by *is* the conversation, so there is no
            // payload to carry and nothing to keep in step.
            //
            // The blind notification routes nowhere, because nothing that
            // woke this device said which conversation. It lands on the list,
            // which then shows what is waiting.
            whenNotificationPressed(scope => {
              setTab('chat')
              if (scope !== null) showConversation(scope)
            })

            // Asked for rather than computed on every launch: it costs a
            // device-status call and a state fetch per conversation.
            readTrustRef.current = (scope: string, other: string) => {
              readTrust(sessionClient, scope, other)
                .then(setTrust)
                .catch((cause: unknown) =>
                  logEvent('warn', 'MESSAGR_TRUST_FAILED', {
                    reason: getErrorMessage(cause),
                  }),
                )
            }

            // INVITING, AND THE HALF NOBODY TAPS FOR.
            //
            // The service draws an account when somebody opens the link, so
            // the name typed at invite time has nobody to belong to yet. It
            // is held here and written when the account is drawn -- the only
            // ordering the protocol allows, and the right one: the inviter
            // knows who they are inviting now and will not come back later
            // to say.
            inviteRef.current = (name: string | null) => {
              setInvite({ stage: 'working' })
              setAdmission(null)
              const gesture = async () => {
                const issued = await inviteSomebody(sessionClient, credentials)
                if (!issued.issued) {
                  setInvite({ stage: 'failed', reason: issued.reason })
                  return
                }
                setInvite({ stage: 'ready', link: issued.link })
                setAdmission('waiting')
                // WRITTEN DOWN BEFORE ANYBODY IS ASKED ABOUT IT.
                //
                // The poll below runs for a minute and then stops, which is
                // what makes two phones on a table instant and what made
                // every other case impossible: an invitation opened later
                // than that could never be walked through, on this launch or
                // any other, while the screen said the link was good for an
                // hour (#118). Remembering it here is what lets the question
                // be asked again -- on the next tick, and on every launch
                // after this one.
                const remembered = await outstandingRef.current.remember({
                  invitationId: issued.invitationId,
                  scope: issued.scope,
                  issuedAt: Date.now(),
                })
                if (!remembered) {
                  // Not a failure of the invitation: the link is valid and
                  // the minute below still runs. What is lost is the retry
                  // after a relaunch, which is worth saying rather than
                  // discovering.
                  logEvent('warn', 'MESSAGR_OUTSTANDING_NOT_KEPT', {
                    invitationId: issued.invitationId,
                  })
                }
                // The conversation exists now, so it belongs on the list
                // before anybody has claimed anything.
                await refreshList().catch(() => {})

                const admitted = await admitEntrant(
                  sessionClient,
                  credentials,
                  issued.invitationId,
                  issued.scope,
                )
                if (!admitted.admitted) return
                setAdmission('admitted')
                // Somebody came through inside the minute, so there is
                // nothing left to ask about.
                await outstandingRef.current.forget(issued.invitationId)
                if (name !== null) {
                  const kept = await namesRef.current.set(
                    admitted.entrant,
                    name,
                  )
                  setNames(held => new Map(held).set(admitted.entrant, name))
                  if (!kept) {
                    logEvent('warn', 'MESSAGR_GIVEN_NAME_NOT_KEPT', {})
                  }
                }
                await refreshList().catch(() => {})
              }
              gesture().catch((cause: unknown) =>
                setInvite({
                  stage: 'failed',
                  reason: getErrorMessage(cause),
                }),
              )
            }

            // THE LIST. Derived rather than stored, like the conversation
            // itself: see conversationList.ts for why it is not built out of
            // the sync loop's own response.
            const refreshList = async () => {
              setSummaries(
                await listConversations(
                  sessionClient,
                  credentials.userId,
                  // Read fresh rather than held: `markRead` has just written
                  // to it, and a held map would redraw the badge it cleared.
                  await lastReadRef.current.all(),
                ),
              )
            }
            await refreshList().catch((cause: unknown) =>
              logEvent('warn', 'MESSAGR_LIST_FAILED', {
                reason: getErrorMessage(cause),
              }),
            )
            // THE LOOP THAT MAKES THIS A MESSENGER. ADR-0007.
            //
            // Started here, at the end of the launch path, for two reasons
            // that are one reason: everything above had to happen first.
            // matrix-js-sdk's own loop is stopped by now
            // (`fetchSessionSyncStatus`), so nothing else is consuming the
            // to-device messages that carry room keys; and this device's
            // keys are published, so a key sent in answer to what arrives
            // here can actually be claimed.
            //
            // The conversation is re-derived rather than merged out of the
            // sync response. The timeline stays the application's own state
            // (ADR-0005) and `loadConversation` is the one thing that knows
            // how to build it: the loop's job is to say *when*, not *what*.
            //
            // ONE SCREEN, AND FOR A FEW SECONDS SOMETIMES TWO LOOPS. `stop`
            // does not cancel the poll in flight -- nothing here can, see
            // `RunningSyncLoop.stop` -- so a loop stopped on the way to the
            // background may still hold a socket open when the application
            // comes back and starts its replacement. Its last word is
            // `stopped`, and it would land *after* the new loop had already
            // said `starting`: a screen reading `stopped` over a loop that is
            // running, which is the lie ADR-0007 names told the other way
            // round. So each loop is handed the generation it was started in,
            // and anything it says once superseded is dropped. A loop merely
            // paused has not been superseded, and its `stopped` still reaches
            // the screen, which is correct: it did stop.
            const beginLiveSync = () => {
              if (runningSyncRef.current !== null) return
              const generation = liveGenerationRef.current + 1
              liveGenerationRef.current = generation
              runningSyncRef.current = startLiveSync(
                sessionClient,
                tick => {
                  if (generation !== liveGenerationRef.current) return
                  if (!tick.cursorPersisted) {
                    // Survivable -- this launch stays live off the token it
                    // holds in memory -- but the next launch replays from
                    // wherever the keystore last accepted one, and that is
                    // not something to discover as a slow start.
                    logEvent('warn', 'MESSAGR_LIVE_CURSOR_LOST', {})
                  }
                  // Before the early return below: a poll can carry a
                  // receipt for a conversation whose timeline did not move --
                  // somebody reading is not somebody writing.
                  const openNow = openScopeRef.current
                  if (openNow !== null) {
                    const seen = tick.receipts.get(openNow)
                    if (seen !== undefined && seen.length > 0) {
                      setReadHere(
                        readUpTo(
                          conversationRef.current,
                          seen,
                          credentials.userId,
                        ),
                      )
                    }
                  }

                  // ASKED ON EVERY TICK, AND BEFORE THE EARLY RETURN.
                  //
                  // Nothing about somebody claiming an invitation changes a
                  // scope this device is already in, so a tick that admits
                  // the person waiting is exactly a tick with no changed
                  // scopes. Putting this below the return would have made
                  // admission depend on unrelated traffic -- which is the
                  // shape of the defect it exists to fix.
                  //
                  // Not awaited: the loop's tick must not wait on a poll of
                  // the invitation service, and nothing below depends on the
                  // answer. The `.catch` at the end is what makes that safe
                  // -- a floating promise with no rejection handler is an
                  // unhandled rejection, which on Hermes is a warning nobody
                  // reads and on some hosts is a crash.
                  admitAnyoneWaiting({
                    outstanding: outstandingRef.current,
                    admit: invitation =>
                      admitEntrant(
                        sessionClient,
                        credentials,
                        invitation.invitationId,
                        invitation.scope,
                      ),
                    now: () => Date.now(),
                  })
                    .then(round => {
                      if (round.admitted.length === 0 && round.expired === 0) {
                        return
                      }
                      // Only when something happened: a line per tick saying
                      // "nobody yet" would bury the one that matters.
                      logEvent('info', 'MESSAGR_ADMITTED_LATE', { ...round })
                      // Somebody joined a room this device is in, so the list
                      // has a row to redraw.
                      if (round.admitted.length > 0) {
                        refreshList().catch(() => {})
                      }
                    })
                    .catch((cause: unknown) =>
                      logEvent('warn', 'MESSAGR_ADMIT_ROUND_FAILED', {
                        reason: getErrorMessage(cause),
                      }),
                    )

                  if (tick.changedScopes.length === 0) return

                  // The list first, because a row moving is what a person
                  // sees from wherever they are. Every summary is re-derived
                  // rather than only the changed ones -- one round trip per
                  // conversation, the limit `conversationList.ts` names, and
                  // the day somebody has two hundred this is one of the two
                  // places that has to change.
                  refreshList().catch((cause: unknown) =>
                    logEvent('warn', 'MESSAGR_LIST_FAILED', {
                      reason: getErrorMessage(cause),
                    }),
                  )

                  // Then the conversation on screen, if it is one that moved.
                  // Read from the ref rather than the closure: this callback
                  // was made once, and the conversation open now is not
                  // necessarily the one that was open when the loop started.
                  const open = openScopeRef.current
                  if (open === null || !tick.changedScopes.includes(open)) {
                    return
                  }
                  loadConversation(sessionClient, open, credentials.userId)
                    .then(async fresh => {
                      setConversation(held =>
                        mergeTimeline(held ?? [], fresh.entries),
                      )
                      setReactions(fresh.reactions)
                      // Somebody watching a conversation has read what lands
                      // in it. A badge that appeared on the screen the person
                      // is already looking at would be the clearest possible
                      // way of saying the count means nothing.
                      await markRead(open, fresh.entries)
                    })
                    .catch((cause: unknown) => {
                      // The cursor has already advanced past this, but the
                      // next poll that touches this conversation derives it
                      // whole again, so nothing is lost for good. Reported
                      // rather than swallowed: a screen that stopped
                      // updating under a loop still saying `running` is
                      // exactly the lie ADR-0007 names.
                      logEvent('warn', 'MESSAGR_LIVE_DERIVE_FAILED', {
                        reason: getErrorMessage(cause),
                      })
                    })
                },
                state => {
                  if (generation !== liveGenerationRef.current) return
                  // The only place this is said. It used to be rendered as
                  // well, on a readout #105 removed -- and the log was
                  // already the half that mattered, because the emulator's
                  // screencap returns a blank frame whatever is on screen.
                  // This is the evidence that the loop lived, reconnected,
                  // or stopped.
                  logEvent(
                    state === 'reconnecting' ? 'warn' : 'info',
                    'MESSAGR_LIVE_STATE',
                    { state },
                  )
                },
              )
            }
            if (roomId !== null) {
              receiveStatus = await receiveOneEncryptedMessage(
                sessionClient,
                credentials,
                roomId,
              )

              // THE CONVERSATION, DERIVED RATHER THAN STORED.
              //
              // ADR-0006: nothing decrypted reaches the disk, so this is
              // fetched and decrypted on every launch instead of read from a
              // second copy. It costs a round trip and it is why a device
              // holds no cleartext history.
              setSelfUserId(credentials.userId)

              // Who this conversation's gesture is for, and the passive half
              // of it. Both run before the timeline is built, so history
              // that arrives on this launch is history this launch can read:
              // `claimOfferedHistory` imports Megolm sessions, and
              // `loadConversation` below decrypts with whatever the store
              // then holds. The other order would show the gap and import
              // the key that closed it a moment later, with nothing on
              // screen changing until the next launch.
              const members = await fetchJoinedMembers(
                makePumpHttp(sessionClient),
                roomId,
              )
              const other = theOtherMember(members, credentials.userId)
              // Reported in the launch log below. A gap that closed and a
              // gap that never opened look identical on screen -- both show
              // a readable conversation -- so the only way to tell "history
              // arrived" from "the key came by some other route" is to say
              // which one happened, and the log is where that is said.
              // SAID HERE, BECAUSE `history` DOES NOT PROVE IT.
              //
              // #123 turns on a contradiction: the report says
              // `history: null`, from which I concluded seven times that
              // `other` was null -- hence `otherParty` undefined, hence every
              // incoming message named (§13.26) -- and it is not.
              //
              // The implication is false. `historyClaim` also stays null when
              // `fetchJoinedMembers` throws, and there are *two* places that
              // derive the other person: this launch, and the live loop's
              // re-derivation. The second can succeed where the first failed,
              // which sets `party` without `history` ever moving.
              whoElse = { joined: members.length, derived: other !== null }
              if (other !== null) {
                setParty({ scope: roomId, other })
                // Never throws: see claimHistory.ts for why a history that
                // did not arrive must not be a launch that did not finish.
                historyClaim = await claimOfferedHistory(
                  credentials,
                  roomId,
                  other,
                )
                setClaimed(historyClaim)
              }

              // And the conversation itself, through the same path a row of
              // the list takes. One way to open a conversation, so a launch
              // and a tap cannot drift into two.
              showConversation(roomId)
            }

            // Started last, after the `Received` probe above has had its
            // rounds. That probe syncs with no cursor at all, so it cannot
            // take anything from the loop -- but the loop advances a cursor,
            // and a cursor moving past a to-device message is what tells the
            // homeserver to stop offering it. Reading the diagnostic first
            // keeps it a diagnostic. Outside the branch above, because an
            // account in no room still has device lists and to-device
            // messages to take, and a loop that only existed where there was
            // already something to read would leave a device invited a minute
            // later showing `not started` until somebody relaunched it.
            //
            // The delay costs nothing a person sees: the conversation on
            // screen was just derived whole, and the loop only matters for
            // what arrives after that.
            resumeSyncRef.current = beginLiveSync
            beginLiveSync()
          }
        } finally {
          // Nothing left to feed once this run is done: the sync above
          // already stopped matrix-js-sdk's own loop, and to-device messages
          // only ever arrive through it.
          if (start.started) start.unsubscribeToDevice()
        }
      }

      // WHAT THE LAUNCH SAYS ABOUT ITSELF, AND THE ONLY PLACE IT SAYS IT.
      //
      // This was logged *and* rendered, on a readout #105 removed. The log
      // was always the half that mattered: the Android emulator's screencap
      // returns a blank frame regardless of what is on screen, so this is
      // the only machine-readable evidence there is -- and it is what the
      // Detox suite reads, rather than pixels or the words in a layout.
      logEvent('info', 'MESSAGR_RUNTIME', {
        architecture,
        hermes,
        bridge: status,
        gaps,
        polyfills: polyfillReport,
        client,
        // NOT `entered` itself. `EntryResult.session` is a
        // `RestoreCredentials`, which carries the account's access token --
        // "whoever reads it is the account", as sessionStore.ts puts it. This
        // line used to log the whole thing, and the only reason no token ever
        // reached logcat is that the object also happened to be cyclical, so
        // the stringify threw and took the launch down with it. The accident
        // was doing the work of the rule; the rule is here now.
        entry: entered.entered
          ? { entered: true, claimed: entered.claimed, kept: entered.kept }
          : { entered: false, reason: entered.reason },
        session: sessionStatus,
        pump: pumpStatus,
        send: sendStatus,
        received: receiveStatus,
        history: historyClaim,
        whoElse,
        // The three the readout used to be the only witness for. `form` is
        // the keystore migration, which answers even on a launch that then
        // fails to start a machine at all -- so it is reported outside every
        // branch above, the way it is computed.
        passphrase,
        signUp,
        keystoreForm: form,
      })
    }

    probeAndReport().catch((cause: unknown) => {
      // The stack, not only the message. A launch failure reported as
      // "TypeError: cyclical structure in JSON object" names a symptom and
      // no location, and the first real device run of #34 spent its
      // diagnosis on exactly that. Reported through a second call so a
      // stack that is itself unserialisable cannot swallow the first.
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
      if (cause instanceof Error && typeof cause.stack === 'string') {
        logEvent('error', 'MESSAGR_RUNTIME_FAILED_WHERE', {
          stack: cause.stack.split('\n').slice(0, 8).join(' | '),
        })
      }
    })
    // THE DEPENDENCY LIST IS DELIBERATE, AND `warmLink` IS NOT IN IT.
    //
    // The object is rebuilt on every arrival, so watching it would re-run the
    // whole launch -- keystore, pump, sync -- for a link this effect has
    // already spent. `warmLink?.count` is the thing that actually changed,
    // and it is a new number exactly once per link handed over, including
    // when two invitations carry the same address. The url is read inside
    // rather than watched: it is whatever the newest count refers to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    architecture,
    hermes,
    gaps,
    client,
    storeDir,
    panicProbeRequested,
    promiseSeen,
    warmLink?.count,
  ])

  // THE HARDWARE BACK BUTTON, WHICH WAS CLOSING THE APPLICATION.
  //
  // Found on a device: from inside a conversation, Android's back gesture
  // left Messagr entirely rather than returning to the list. Every screen
  // here already has its own way back; none of them was wired to the one
  // gesture an Android user makes without thinking.
  //
  // The order is the order things were opened in, innermost first, and the
  // last case is the important one: when there is nothing left to close this
  // answers `false` and the system does what it always did. A handler that
  // answered `true` unconditionally would trap somebody in the application,
  // which is a worse bug than the one it fixes.
  useEffect(() => {
    const back = () => {
      if (trust !== null) {
        setTrust(null)
        return true
      }
      // The viewer is a modal over everything, so it closes first.
      if (openPlate !== null) {
        setOpenPlate(null)
        return true
      }
      if (personOpen) {
        setPersonOpen(false)
        return true
      }
      if (openScope !== null) {
        setOpenScope(null)
        openScopeRef.current = null
        return true
      }
      if (legalOpen) {
        setLegalOpen(false)
        return true
      }
      if (invite.stage !== 'shut') {
        setInvite({ stage: 'shut' })
        setAdmission(null)
        return true
      }
      if (tab !== 'chat') {
        setTab('chat')
        return true
      }
      return false
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', back)
    return () => subscription.remove()
  }, [trust, openPlate, personOpen, openScope, legalOpen, invite.stage, tab])

  // STABLE ACROSS RENDERS, AND THAT IS THE WHOLE POINT.
  //
  // `Photograph` fetches inside an effect that depends on this function. An
  // arrow built in the JSX would be a new value every render, so every render
  // would download and decrypt the picture again.
  const loadImage = useMemo(
    () => (file: ReadFile) =>
      openImageRef.current === null
        ? Promise.resolve<ShownImage>({
            shown: false,
            reason: 'the application is not ready to fetch media yet',
          })
        : openImageRef.current(file),
    [],
  )

  // BEFORE ANYTHING ELSE, AND WITHOUT A FLASH BETWEEN.
  //
  // While the keystore has not answered, the same ground the launch frame
  // paints, and nothing on it. The alternative — rendering the application
  // for the handful of frames it takes to read one keystore entry — is
  // precisely the flash the launch frame exists to prevent, and before #105
  // it was worse than a flash: it showed the diagnostic readout to somebody
  // who had not yet been told what this is.
  if (promiseSeen === null) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <View style={styles.promiseGround} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }

  if (!promiseSeen) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <FirstLaunch
            language={language}
            onLanguage={chooseLanguage}
            onLanguageSettled={keepLanguage}
            // ITS OWN LINE, NOT PART OF THE LAUNCH REPORT.
            //
            // The launch report is written once, when the launch effect
            // finishes; a layout has not happened yet, so the geometry would
            // always be null in it. This says the fact when the fact exists.
            onGeometry={shape =>
              logEvent('info', 'MESSAGR_GEOMETRY', {
                height: shape.height,
                leg: shape.leg,
                // The floor is geometry, which no provenance rule can reach --
                // so it is asserted against the height the device actually
                // gave the button rather than the height the style asked for.
                touchTargetMet: shape.height >= floors.touchTargetMin,
                floor: floors.touchTargetMin,
              })
            }
            onBegin={() => {
              // Set first, kept second. A keystore that refuses must not leave
              // somebody stuck on a screen whose only action does nothing —
              // being shown the promise twice is the cost, and `promiseSeen.ts`
              // says why that is the right way round.
              setPromiseSeen(true)
              rememberPromiseSeen(promiseSecrets)
                .then(kept => {
                  if (!kept) logEvent('warn', 'MESSAGR_PROMISE_NOT_KEPT', {})
                })
                .catch(() => logEvent('warn', 'MESSAGR_PROMISE_NOT_KEPT', {}))
              // AND THE ACCEPTANCE ITSELF, WHICH WAS NOT BEING RECORDED.
              //
              // Reaching this callback means the box was ticked -- the screen's
              // action does nothing otherwise. Until a review said so, that was
              // the only trace: a `useState` that died with the screen, while
              // the comment beside it claimed a tick "can be shown to have
              // happened". What is written is *which* conditions were accepted,
              // so a revision re-asks rather than being assumed.
              rememberTermsAccepted(termsSecrets)
                .then(kept => {
                  if (!kept) logEvent('warn', 'MESSAGR_TERMS_NOT_KEPT', {})
                })
                .catch(() => logEvent('warn', 'MESSAGR_TERMS_NOT_KEPT', {}))
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {openPlate !== null && (
          <FullScreenPlate
            plate={openPlate.plate}
            at={openPlate.at}
            fetch={loadImage}
            onClose={() => setOpenPlate(null)}
          />
        )}

        {/* NEITHER EDGE IS THIS VIEW'S. Both the header and the dock claim
          their own inset, ground and all -- see each of them for why. An
          absolutely-positioned child is laid against the border box and not
          the padding box, so a dock at `bottom: 0` ignored the inset this
          view reserved; and a reserved top inset left a pale strip above the
          dark band, into which the system drew the clock and the battery in
          white. Whatever sits on an edge paints to it. */}
        <SafeAreaView
          style={[styles.screen, { paddingBottom: keyboardInset }]}
          edges={['left', 'right']}>
          {/* Outside the scroll view, like the tab bar and for the same reason:
            what the band says is true of the instance rather than of the
            screen under it, and a fact about the instance that scrolls away
            is one nobody reads twice. */}
          <Header />

          {/* THE CONVERSATION'S OWN BAR, and it is chrome rather than content.
            It was inside the scroll view, so it inherited that view's 24pt
            padding and sat inset from both edges while the messages slid
            under it. Here it spans the screen and stays put, like the band
            above it and the dock below. */}
          {openScope !== null && trust === null && !personOpen && (
            <ConversationHeader
              shown={
                party === null
                  ? openScope
                  : displayNameFor(party.other, names.get(party.other))
              }
              named={party !== null && names.get(party.other) !== undefined}
              onBack={() => {
                setOpenScope(null)
                openScopeRef.current = null
                setTrust(null)
                // Otherwise the next conversation opens on the person screen of
                // the one before it.
                setPersonOpen(false)
              }}
              onOpenPerson={() => setPersonOpen(true)}
            />
          )}

          {/* ONE FRAME, AND A NEW ONE PER SCREEN.
            It was `diagnostic-scroll` and it was honestly named: the readout
            was the thing that scrolled and the screens were rendered into it.
            With the readout gone (#105) it is the product's frame, and its
            name said otherwise.

            `key` is the substance of the rename. A single container keeps its
            offset across whatever is rendered into it, so leaving a long
            conversation for Réglages arrived scrolled into the middle of a
            short screen -- and returning to the conversation arrived wherever
            Réglages had been. Keying it on what it shows makes React build a
            new one per screen, which is what "each screen owns its own
            scrolling" means when no screen scrolls on its own. */}
          <ScrollView
            ref={frame}
            key={openScope ?? tab}
            testID="screen-scroll"
            // A conversation rests at its newest message; a list rests where it
            // was left. Nothing else in the product has a bottom worth being at.
            onScroll={
              openScope === null
                ? undefined
                : event => {
                    const { contentOffset, layoutMeasurement, contentSize } =
                      event.nativeEvent
                    // A margin, because a scroll rarely stops on the exact
                    // pixel and "within a message's height of the end" is what
                    // a person means by being at the bottom.
                    atBottom.current =
                      contentOffset.y + layoutMeasurement.height >=
                      contentSize.height - NEAR_THE_END
                  }
            }
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (openScope === null) return
              if (restedIn.current !== openScope) {
                restedIn.current = openScope
                atBottom.current = true
              }
              if (!atBottom.current) return
              // Not animated: on the first layout there is nothing to animate
              // from, and a conversation that visibly scrolls itself on opening
              // reads as a screen doing something rather than a screen arriving.
              frame.current?.scrollToEnd({ animated: false })
            }}
            // Ends above the dock rather than under it. The dock is absolute,
            // so without this the last row of whatever is on screen sits behind
            // the tab bar -- which reads as content that will not scroll far
            // enough, and is the reason a bottom bar usually costs a padding.
            contentContainerStyle={[
              styles.content,
              { paddingBottom: dockHeight + space.l },
            ]}>
            {/* THE LIST **OR** THE CONVERSATION, never both.
              Stacking them was the first shape this took, and it was wrong
              twice over. On a phone nobody shows a list above the
              conversation it opens; and the end-to-end suite found the same
              thing from the other side, matching one sentence in two places
              -- the list carries the opening of the last message and the
              conversation carries that message. An assertion that has to say
              *where* is an assertion about a screen nobody would ship.

*/}
            {openScope === null && tab === 'calls' && (
              <View style={styles.block}>
                <Reserved
                  testID="calls-reserved"
                  glyph="calls"
                  title="calls_soon_title"
                  why="calls_soon_why"
                  stages={['calls_soon_v2', 'calls_soon_v3']}
                />
              </View>
            )}

            {openScope === null && tab === 'community' && (
              <View style={styles.block}>
                <Reserved
                  testID="community-reserved"
                  glyph="community"
                  title="community_soon_title"
                  why="community_soon_why"
                />
              </View>
            )}

            {openScope === null && tab === 'settings' && !legalOpen && (
              <View style={styles.block}>
                <Settings
                  onBack={() => setTab('chat')}
                  onLegal={() => setLegalOpen(true)}
                  receipts={receipts}
                  receiptsNotKept={receiptsNotKept}
                  language={language}
                  onLanguage={chooseLanguage}
                  onLanguageSettled={keepLanguage}
                  wake={wake}
                  wakeNotKept={wakeNotKept}
                  onWake={on => {
                    // Shown first, kept second, like the switch above.
                    setWake(on)
                    wakeRef.current = on
                    allowWake(wakeSecrets, on)
                      .then(kept => setWakeNotKept(!kept))
                      .catch(() => setWakeNotKept(true))
                    // AND THE PUSHER ITSELF, WHICH IS WHAT MAKES OFF MEAN OFF.
                    //
                    // Stopping the next launch registering one is not turning
                    // notifications off: the pusher already on the homeserver
                    // keeps firing, and the switch reads as off while it is on.
                    // Caught in review, and the ticket says how -- the same
                    // route with `kind: null`.
                    wakeThisDeviceRef.current?.(on)
                  }}
                  onReceipts={on => {
                    // Shown first, kept second. A switch that waited on a
                    // keystore would feel broken; one that reverts silently at
                    // the next launch would be worse, which is what the
                    // sentence under it is for.
                    setReceipts(on)
                    publishReceipts(receiptSecrets, on)
                      .then(kept => setReceiptsNotKept(!kept))
                      .catch(() => setReceiptsNotKept(true))
                  }}
                />
              </View>
            )}

            {openScope === null && tab === 'settings' && legalOpen && (
              <View style={styles.block}>
                <Legal onBack={() => setLegalOpen(false)} />
              </View>
            )}

            {/* THE LIST **OR** THE INVITATION, for the same reason as the
              conversation above: inviting is a place you go, not a form that
              lives under the list. */}
            {openScope === null &&
              tab === 'chat' &&
              invite.stage === 'shut' && (
                <View style={styles.block}>
                  <ConversationList
                    summaries={summaries}
                    names={names}
                    invitationIgnored={invitationIgnored}
                    notInYet={inYet === false}
                    onOpen={scope => openConversationRef.current?.(scope)}
                  />
                </View>
              )}

            {openScope === null &&
              tab === 'chat' &&
              invite.stage !== 'shut' && (
                <View style={styles.block}>
                  <Invite
                    stage={invite}
                    admission={admission}
                    onInvite={name => inviteRef.current?.(name)}
                    onClose={() => {
                      setInvite({ stage: 'shut' })
                      setAdmission(null)
                    }}
                  />
                </View>
              )}

            {openScope !== null && trust !== null && party !== null && (
              <View style={styles.block}>
                <Trust
                  participant={party.other}
                  given={names.get(party.other)}
                  reading={trust}
                  onBack={() => setTrust(null)}
                />
              </View>
            )}

            {/* THE CONVERSATION, AND ONLY THE CONVERSATION.
              Screen 21 is the reference screen, and its own note is the
              argument: "la spécificité de Messagr ne doit se voir que là où
              elle apporte quelque chose. Partout ailleurs, l'application
              ressemble à ce que les gens connaissent déjà."

              What was here was a back link, a trust link, a naming form, the
              messages, the composer, and two irreversible gestures as
              full-width buttons -- a conversation with its own machinery
              stacked around it. The rare gestures are one tap away now, on a
              screen about the person, which is where every messenger somebody
              has already used keeps them. */}
            {openScope !== null &&
              trust === null &&
              !personOpen &&
              conversation !== null &&
              sendMessage !== null && (
                <View style={styles.block}>
                  <Conversation
                    reactions={reactions}
                    read={readHere}
                    onReact={(target, key, own) =>
                      reactRef.current?.(target, key, own)
                    }
                    entries={conversation}
                    selfUserId={selfUserId}
                    sending={sending}
                    onLoadImage={loadImage}
                    otherParty={party?.other}
                    onOpenPlate={(plate, at) => setOpenPlate({ plate, at })}
                  />
                  {/* What the passive half found, when it found anything. A
                  refusal for an untrusted sender is the one worth saying:
                  what fixes it is verifying them, and this screen is where
                  somebody would otherwise just see a gap. */}
                  {/* TWO CASES, AND SILENCE FOR THE REST.
                    It used to fall through to `${kind}: ${reason}` -- a
                    diagnostic string, in French copy, on a screen a person
                    reads. The two cases here are the two somebody can act
                    on: history arrived, or it was refused because the sender
                    is not verified, which is fixed by verifying them.

                    Every other kind is a failure nobody on this screen can
                    do anything about, and it is in the launch report under
                    `history`, which is where somebody diagnosing it looks. */}
                  {claimed !== null && claimed.claimed === 'imported' && (
                    <Text testID="history-claim" style={styles.historyNote}>
                      {t('vouch_history_arrived')}
                    </Text>
                  )}
                  {claimed !== null &&
                    claimed.claimed !== 'none' &&
                    claimed.claimed !== 'imported' &&
                    claimed.kind === 'untrusted' && (
                      <Text testID="history-claim" style={styles.historyNote}>
                        {t('vouch_history_untrusted')}
                      </Text>
                    )}
                </View>
              )}

            {/* THE PERSON, which is where what is specific to this product
              lives: what is known about them, what you call them, and the two
              gestures that cannot be undone. One tap from the conversation
              and out of the way of reading it. */}
            {openScope !== null && trust === null && personOpen && (
              <View style={styles.block}>
                <Pressable
                  testID="person-back"
                  onPress={() => setPersonOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('person_back')}>
                  <Text
                    style={styles.back}>{`\u2190 ${t('person_back')}`}</Text>
                </Pressable>

                {/* The way into the trust screen. "Who is this?" and "what do
                  we know of them?" are the same question asked twice, so they
                  are on the same screen. */}
                {party !== null && (
                  <Pressable
                    testID="open-trust"
                    onPress={() =>
                      readTrustRef.current?.(party.scope, party.other)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t('trust_action')}>
                    <Text style={styles.back}>{t('trust_action')}</Text>
                  </Pressable>
                )}
                <GiveName
                  participant={party?.other ?? null}
                  given={party === null ? undefined : names.get(party.other)}
                  onName={async (participant, name) => {
                    const kept = await namesRef.current.set(participant, name)
                    // Shown either way. A name held only in memory is still the
                    // name on this screen, and `kept` is what says whether it
                    // will survive the next launch.
                    setNames(held => new Map(held).set(participant, name))
                    if (!kept) {
                      logEvent('warn', 'MESSAGR_GIVEN_NAME_NOT_KEPT', {})
                    }
                    return kept
                  }}
                />

                {/* #34's gesture, and only where it means something: a
                conversation of two, where "the other person" names
                somebody rather than being chosen by this application. */}
                {party !== null && sessionClientRef.current !== null && (
                  <Vouch
                    entrantId={party.other}
                    // `?? []` because this screen is reachable while the
                    // conversation is still deriving. "No history to hand over"
                    // is the safe reading of not knowing yet: `Vouch` says a
                    // different sentence for each, and the wrong one would
                    // promise a past that had not been counted.
                    hasHistory={(conversation ?? []).length > 0}
                    state={vouch}
                    onVouch={() => {
                      const vouching = sessionClientRef.current
                      const held = credentialsRef.current
                      if (vouching === null || held === null) return
                      setVouch('working')
                      // The outcome is a value rather than a throw --
                      // `vouchFor` reports which step stopped -- so there is
                      // nothing here to catch, and the promise is deliberately
                      // left to settle into state.
                      vouchForEntrant(
                        vouching,
                        held,
                        party.scope,
                        party.other,
                      ).then(setVouch, () => {
                        setVouch({
                          vouched: false,
                          stage: 'assembling',
                          reason: 'the gesture could not be started',
                          promoted: false,
                        })
                      })
                    }}
                  />
                )}

                {/* The mirror gesture, offered beside the one it undoes the
                effect of. Same two-step shape, because removing somebody
                cannot be undone either -- and the sentence it owes a
                person is a different one. */}
                {party !== null && (
                  <Evict
                    memberId={party.other}
                    state={evicted}
                    onEvict={() => {
                      const evicting = sessionClientRef.current
                      if (evicting === null) return
                      setEvicted('working')
                      evictMember(evicting, party.scope, party.other).then(
                        setEvicted,
                        () => {
                          setEvicted({
                            evicted: false,
                            stage: 'removing',
                            reason: 'the gesture could not be started',
                            rotated: false,
                          })
                        },
                      )
                    }}
                  />
                )}
              </View>
            )}
          </ScrollView>

          {/* Outside the scroll view on purpose: a bar that scrolled away is a
            bar nobody can reach without scrolling back, and muscle memory is
            the whole point of a bottom bar. Hidden while a conversation is
            open, which is what the mockup draws -- a conversation is a place
            you leave rather than a fifth tab. */}
          {/* THE DOCK: the action above the bar, in that order, anchored to the
            bottom and outside the scroll view so both are where the thumb
            left them. `box-none` so the gap between them is not a surface
            that swallows taps meant for the list underneath.

            The action shows only on the list, and only when the invitation
            panel is not already open: a control that opens what is on screen
            is a control that does nothing. */}
          <View
            style={styles.dock}
            pointerEvents="box-none"
            onLayout={event => setDockHeight(event.nativeEvent.layout.height)}>
            {openScope === null &&
              tab === 'chat' &&
              invite.stage === 'shut' && (
                <FloatingAction
                  testID="invite-open"
                  label={t('invite_open')}
                  onPress={() => setInvite({ stage: 'resting' })}
                />
              )}

            {/* THE INPUT BAR IS PART OF THE DOCK, above the tabs.
              It was the last thing in the conversation's own scroll view, so
              it scrolled away with the messages and somebody had to reach the
              bottom of the thread to type. Here it is where the thumb left
              it. */}
            {openScope !== null &&
              trust === null &&
              !personOpen &&
              sendMessage !== null && (
                <Composer
                  onSend={sendMessage}
                  onAttach={() => attachRef.current?.()}
                />
              )}

            {/* THE TABS STAY, EVEN INSIDE A CONVERSATION.
              The mockup hides them there, which is what every other messenger
              does, and this used to. Changed at the account holder's request:
              the bar never moves, so muscle memory holds everywhere. Recorded
              as a decision rather than a drift. */}
            {/* A TAB PRESS COMES BACK TO THAT TAB'S TOP, AND `setTab` ALONE
                DID NOT. From inside a conversation, pressing Discussions set
                the tab to the one it was already on and changed nothing
                visible: the conversation is drawn over the list, and nothing
                closed it. Reported from a Pixel on 7 September 2026, in the
                words anybody would use -- "rien ne se passe".

                The same layers the hardware back button already enumerates,
                closed in one go rather than one press at a time: a tab is
                not a step backwards, it is a destination. `back` walks them;
                this clears them. */}
            <TabBar
              current={tab}
              onSelect={next => {
                setOpenPlate(null)
                setPersonOpen(false)
                setOpenScope(null)
                openScopeRef.current = null
                setLegalOpen(false)
                setInvite({ stage: 'shut' })
                setAdmission(null)
                setTab(next)
              }}
              unread={unreadCount}
            />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

// One small label function per probe, named `compute…` to match this
// module's own idiom (computeTransportStatus, computeSessionCredentials):
// each is a pure derivation from a status already held in state, not a
// generic formatter forcing three differently-shaped probes through one
// abstraction.

// Values are literal rather than tokenised on purpose: this screen is
// scaffolding, not product surface. Anything that survives into a real screen
// must come from design/tokens.json, per interface invariant 11.
/**
 * How far from the end still counts as being at it.
 *
 * A scroll rarely stops on the exact pixel, and a person who is one line
 * short of the bottom means the same thing by it as one who is exactly there.
 * Roughly a message's height.
 */
const NEAR_THE_END = 80

const styles = StyleSheet.create({
  // GESTURE HANDLER WANTS A ROOT, AND IT WANTS ONE THAT FILLS THE SCREEN.
  // Its native handlers attach to this view; without `flex: 1` it lays out at
  // zero height and every gesture below it is delivered to nothing -- which
  // looks exactly like the library not working.
  // LE FOND, POSÉ, ET LE MODE SOMBRE D'iOS EST POURQUOI.
  //
  // Cette racine n'avait pas de couleur. Sur un appareil en thème clair rien
  // ne se voyait : la vue parente était déjà pâle. En thème sombre, iOS peint
  // une racine sans fond en NOIR, et seule la liste des conversations, qui
  // pose son propre `surface.paper`, restait claire -- une carte pâle
  // flottant sur du noir, avec du noir partout ailleurs. Rapporté depuis
  // l'iPhone d'un testeur le 7 septembre 2026, sur la première build qui ait
  // jamais démarré là-bas.
  //
  // `surface.paper` plutôt qu'une réaction au thème du système : cette
  // application a une palette claire, et une palette sombre réservée aux
  // surfaces qui la demandent (l'écran de promesse, le plein écran d'une
  // photographie). Suivre le thème du système serait un second jeu de
  // couleurs pour tout l'écran, ce que le lot n'a pas.
  root: { flex: 1, backgroundColor: color.surface.paper },
  back: {
    ...typeScale.bodySm,
    color: color.brand.green700,
    paddingVertical: space.s,
  },
  // The launch frame's own colour, so the handover between them shows nothing.
  promiseGround: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  // Scrolls, and no longer centres. This readout has grown one block per
  // ticket -- architecture, engine, gaps, transport, session, pump, send,
  // received -- and its last lines had reached past the bottom of a phone.
  // Detox reads rendered text, so a line pushed off-screen is a line the
  // suite reports as absent: the round trip's sender assertion failed for
  // that reason and for no other, which is a false negative about the trust
  // model, the one place this project can least afford one.
  screen: { flex: 1 },
  // The bottom padding was 48, which is not on the scale and never could be:
  // the file forbids its own intermediate values outright. `xxl` is the
  // answer the scale gives, and a screen that needed more would be a
  // composition error rather than a missing token.
  content: { padding: space.xl },
  // Anchored to the bottom, over whatever is scrolling behind it.
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  block: { marginBottom: space.xxl },
  // Spread rather than picked apart: size, leading, weight and tracking
  // travel together, and separating them is how a line-height floor gets
  // broken without anyone deciding to break it.
  historyNote: typeScale.body,
})
