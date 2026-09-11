import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppState,
  BackHandler,
  Linking,
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
  acceptKeyBackup,
  readKeyBackupState,
  resumeKeyBackup,
  startCryptoMachine,
  enterAnyInvitations,
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
import {
  startCallRuntime,
  type CallOnScreen,
  type CallRuntime,
} from './src/runtime/callPump'
import {
  forgetfulCallLog,
  type CallLog,
  type CallRecord,
} from './src/runtime/callLogStore'
import { CallsList } from './src/ui/CallsList'
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
  pushkeySecrets,
  backupAskedSecrets,
  backupReceivedSecrets,
  backupSecrets,
  wakeSecrets,
  promiseSecrets,
  receiptSecrets,
  recoverySecrets,
  sessionSecrets,
  signUpSecrets,
} from './src/runtime/deviceSecrets'
import {
  publishReceipts,
  RECEIPTS_DEFAULT,
  receiptsArePublished,
} from './src/runtime/receiptSetting'
import { markUpTo, readAtMark, type Receipt } from './src/runtime/receipts'
import { hasSeenPromise, rememberPromiseSeen } from './src/runtime/promiseSeen'
import { clearSignUp, isSignUpUnfinished } from './src/runtime/signUpMarker'
import {
  color,
  floors,
  layout,
  space,
  stroke,
  type as typeScale,
} from './src/design/tokens'
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
import Clipboard from '@react-native-clipboard/clipboard'
import { removeMessage } from './src/runtime/cryptoPump'
import { photographForForward } from './src/runtime/cryptoPump'
import { openNotebook } from './src/runtime/notebook'
import { forgetfulHidden, type Hidden } from './src/runtime/hiddenStore'
import {
  forgetfulFavourites,
  // Aliased: the page and the screen that draws it want the same word, and
  // the screen is the one a reader of this file meets first.
  type Favourites as FavouritesPage,
} from './src/runtime/favouriteStore'
import { forgetfulReadBy, type ReadBy } from './src/runtime/readByStore'
import {
  rememberBackupAsked,
  rememberReceived,
  shouldOfferBackup,
} from './src/runtime/backupPrompt'
import { readFavourites, type KeptMessage } from './src/runtime/readFavourites'
import { receivedFromSomebodyElse } from './src/runtime/receivedFromSomebodyElse'
import {
  canCopy,
  canFavourite,
  canForward,
  canRemoveForEveryone,
  copyText,
  onlyPhotograph,
  toggle,
} from './src/timeline/selection'
import {
  forgetfulListCache,
  type ListCache,
} from './src/runtime/listCacheStore'
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
import { keepLastPushkey, readLastPushkey } from './src/runtime/lastPushkey'
import { pushTokenForThisDevice } from './src/runtime/pushDevice'
import {
  stopRinging,
  whenNotificationPressed,
} from './src/runtime/showNotification'
import type { ShownImage } from './src/runtime/receiveImage'
import type { ReadFile } from './src/timeline/imageEvent'
import type { Plate as Grouping } from './src/timeline/plates'
import type { EvictOutcome } from './src/runtime/evict'
import type { HistoryClaim } from './src/runtime/claimHistory'
import { Conversation } from './src/ui/Conversation'
import { ConversationList } from './src/ui/ConversationList'
import { Invite, type InviteStage } from './src/ui/Invite'
import { BackupOffer } from './src/ui/BackupOffer'
import { BackupSettings } from './src/ui/BackupSettings'
import { Favourites } from './src/ui/Favourites'
import { RecoveryKeyShown } from './src/ui/RecoveryKeyShown'
import { FloatingAction } from './src/ui/FloatingAction'
import { Header } from './src/ui/Header'
import { Composer } from './src/ui/Composer'
import { FullScreenPlate } from './src/ui/FullScreenPlate'
import type { Wants } from './src/calls/media'
import { CallScreen } from './src/ui/CallScreen'
import { SelectionBar } from './src/ui/SelectionBar'
import { RemoveSheet } from './src/ui/RemoveSheet'
import { PickConversation } from './src/ui/PickConversation'
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
import { enterWithASession, type InvitationOutcome } from './src/runtime/entry'
import { initialLink, watchLinks } from './src/runtime/incomingLink'
import { useKeyboardInset } from './src/ui/keyboardInset'
import { sweepWhatThePickerLeft } from './src/runtime/imageLibrary'
import { afterReinstall } from './src/runtime/afterReinstall'
import {
  cryptoStoreExists,
  homeserverCalls,
} from './src/runtime/homeserverCalls'
import { keepPhotograph } from './src/runtime/keepPhotograph'
import {
  keepRecoverySecret,
  readRecoverySecret,
} from './src/runtime/recoverySecret'
import { saveSession } from './src/runtime/sessionStore'
import { reenterWithPassword, retireDevice } from './src/runtime/reenter'
import { photoLibrary } from './src/runtime/photoLibrary'
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
   * Whether the conversation is far enough up its history to offer a way back.
   *
   * State rather than a second ref, and that is the whole reason it exists
   * separately from `atBottom`: a ref changes nothing on screen, and this one
   * has to make a button appear. `atBottom` stays a ref because its job is to
   * be read inside a callback, and turning it into state would re-render the
   * conversation on every scroll event for no one's benefit.
   *
   * Two questions, two thresholds. `atBottom` asks "should an arriving
   * message scroll the frame?", and a line short of the end still means yes.
   * This asks "is this person somewhere else?", which only starts being true
   * further up -- see `A_WAY_BACK`.
   */
  const [awayFromNewest, setAwayFromNewest] = useState(false)
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
  // The list as it was last drawn. Read once at the top of the launch and
  // written by every derivation after it. `listCacheStore.ts` says why.
  const listCacheRef = useRef<ListCache>(forgetfulListCache())
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
  // MESSAGES, AND IT USED TO BE CONVERSATIONS.
  //
  // It read: "the tab's badge counts how many conversations have something
  // waiting; the rows carry how much is waiting in each. That is the
  // division a person reads without being told -- a tab saying `47` for one
  // chatty conversation would send somebody looking for forty-seven places
  // to go." The argument is kept rather than deleted, because whoever
  // revisits this should meet it before deciding again.
  //
  // It was overruled by the account holder, who reported the same thing
  // twice: a `6` on the row and a `1` on the tab, read as "une désynchro
  // entre les pastilles". Two numbers in one glance, in different units,
  // with nothing on either saying which unit it is. Every messenger this
  // product is compared to puts the message count on the tab, so the count
  // is not what somebody has to be told -- the DIVISION is, and a screen
  // cannot say it.
  //
  // The distinction the old argument was protecting is real and still there:
  // it is the ROWS that say where to go. The tab only says how much.
  const unreadCount = summaries.reduce(
    (total, summary) => total + summary.unread,
    0,
  )
  const [legalOpen, setLegalOpen] = useState(false)
  const [favouritesOpen, setFavouritesOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  /**
   * The offer, and then the key it produced.
   *
   * `'offering'` draws the soft prompt; a string is the restore key, shown
   * once. `null` is every other moment, which is almost all of them.
   *
   * One value rather than two flags because the three states are exclusive
   * and the middle one carries a secret: two booleans would make
   * "showing the key with no key" representable, and that is a screen with
   * an empty field where somebody's only copy should be.
   */
  const [backupPrompt, setBackupPrompt] = useState<
    'offering' | { readonly restoreKey: string } | null
  >(null)
  /**
   * Reads the backup's state whenever that screen is showing and nothing is
   * covering it.
   *
   * **An effect rather than a read at each place that opens the screen**, and
   * that is a correction rather than a preference. It was two reads -- one in
   * the row that opens, one when the key screen was dismissed -- and the
   * second depended on a value captured when its closure was created. A
   * device run caught it: after accepting, the screen behind still said « vos
   * messages ne sont pas sauvegardés » about a backup the homeserver had
   * already acknowledged, because the reading was the one taken before the
   * acceptance.
   *
   * Keyed on the prompt as well as the screen, so dismissing the key is
   * itself what asks again. Nothing has to remember to.
   */
  useEffect(() => {
    if (!backupOpen || backupPrompt !== null) return
    let stale = false
    readKeyBackupState()
      .then(state => {
        // SAID EVERY TIME, for the reason the offer's own line exists: a
        // screen showing the wrong branch and a screen showing the right one
        // are indistinguishable from outside, and this is the line that says
        // which the bridge actually answered.
        logEvent('info', 'MESSAGR_BACKUP_STATE', {
          enabled: state.enabled,
          total: state.total,
          backedUp: state.backedUp,
          stale,
        })
        if (!stale) setBackupState(state)
      })
      .catch(() => {
        // A bridge that cannot answer leaves the screen undrawn rather than
        // drawn wrong: every sentence on it turns on whether the backup is
        // on.
        if (!stale) setBackupState(null)
      })
    return () => {
      stale = true
    }
  }, [backupOpen, backupPrompt])
  /**
   * What the bridge says about the backup, while that screen is open.
   *
   * `null` means nobody has asked or the answer has not arrived. The screen
   * is not drawn until it has one, because every sentence on it turns on
   * whether the backup is on and a screen that guessed would say the wrong
   * one for a second.
   */
  const [backupState, setBackupState] = useState<{
    enabled: boolean
    total: number
    backedUp: number
  } | null>(null)
  /**
   * The kept messages, with their words, while that screen is open.
   *
   * `null` means nobody has asked or the answer has not arrived -- the
   * screen draws its empty line either way, which is honest for the second
   * or two a derivation takes and correct for good if nothing was kept.
   */
  const [keptMessages, setKeptMessages] = useState<
    readonly KeptMessage[] | null
  >(null)
  const readKeptRef = useRef<(() => Promise<readonly KeptMessage[]>) | null>(
    null,
  )
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
  // The switch starts where a device that has never been asked stands, so it
  // does not show `off` for the moment the keystore takes to answer and then
  // flip. `receiptSetting.ts` carries the argument for the default itself.
  const [receipts, setReceipts] = useState(RECEIPTS_DEFAULT)
  const [receiptsNotKept, setReceiptsNotKept] = useState(false)
  // Whether this device asks to be woken. On unless somebody says otherwise,
  // which is the opposite of the switch above -- `wakeSetting.ts` says why.
  const [wake, setWake] = useState(true)
  const [wakeNotKept, setWakeNotKept] = useState(false)
  const wakeRef = useRef(true)
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set())
  /**
   * The messages the selection mode holds, and whether the removal sheet is
   * up. Empty means there is no mode: `Conversation.tsx` derives the reaction
   * row from it too, so the two cannot disagree.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [removing, setRemoving] = useState(false)
  /**
   * What became of the last photograph somebody asked to keep.
   *
   * A sentence rather than a spinner: the gesture is one call and answers in
   * a moment, and what a person needs afterwards is to know their picture is
   * in the gallery -- or that it is not, which is the only case they can act
   * on. `null` when nobody has asked, which is nearly always.
   */
  const [photoKept, setPhotoKept] = useState<'kept' | 'failed' | null>(null)
  /**
   * Whether this launch found a session whose crypto store was gone.
   *
   * `'reentered'` came back as a new device and lost only the past;
   * `'stranded'` could not, and the person has to be told rather than shown
   * an application that looks like it is working. `null` on every ordinary
   * launch, which is almost all of them. See afterReinstall.ts.
   */
  const [reinstalled, setReinstalled] = useState<
    'reentered' | 'stranded' | null
  >(null)
  /**
   * The messages this device has been told to keep.
   *
   * State as well as a page, for the reason the read marks are both: the bar
   * has to say « Favori » or « Retirer des favoris » on the frame the finger
   * lands, and a notebook read is a round trip.
   */
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(new Set())
  const favouritesRef = useRef<FavouritesPage>(forgetfulFavourites())
  // AND IT GOES AWAY ON ITS OWN. A line that stayed would be a line still
  // there next time the conversation is opened, describing a photograph
  // saved yesterday. Long enough to read twice, short enough that nobody
  // has to dismiss it.
  useEffect(() => {
    if (photoKept === null) return
    const going = setTimeout(() => setPhotoKept(null), KEPT_SHOWN_MS)
    return () => clearTimeout(going)
  }, [photoKept])
  /**
   * The events waiting for a destination, while the picker is up.
   *
   * Taken from the selection at the moment the gesture starts rather than
   * read from it later: the sheet clears the selection so the bar can go,
   * and a forward that read `selected` afterwards would forward nothing.
   */
  const [forwarding, setForwarding] = useState<readonly string[] | null>(null)
  /**
   * Places a call, audio or video, from wherever the gesture came from.
   *
   * One function rather than three copies of the same six lines: the header
   * has two buttons now and the calls list a third, and a `place` that
   * differed between them would differ in the failure handling first.
   */
  const placeCall = (
    scope: string | null,
    peerUserId: string,
    wants?: Wants,
  ) => {
    const runtime = callRuntimeRef.current
    if (runtime === null || scope === null) return
    runtime.place(scope, peerUserId, wants).catch((cause: unknown) =>
      logEvent('warn', 'MESSAGR_CALL_NOT_PLACED', {
        reason: getErrorMessage(cause),
      }),
    )
  }
  /** What this device has been told not to draw. `hiddenStore.ts` says why. */
  const hiddenRef = useRef<Hidden>(forgetfulHidden())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  // The same starting value as the state above, so a receipt sent before the
  // keystore has answered follows the default rather than the opposite of it.
  const receiptsRef = useRef(RECEIPTS_DEFAULT)
  // The conversation as the loop's callbacks can see it: they are made once,
  // and a receipt arriving names an event that has to be found among the
  // entries held right now.
  const conversationRef = useRef<readonly TimelineEntry[]>([])
  /**
   * Every read receipt any poll has reported, by conversation.
   *
   * KEPT, BECAUSE A RECEIPT ARRIVES ONCE AND IS NEVER SENT AGAIN.
   *
   * They were read straight off the tick and applied only to the
   * conversation that happened to be open at that instant. Somebody who read
   * your message while you were on the list, or in another conversation, or
   * anywhere but that screen, produced a receipt that was looked at once and
   * dropped -- and opening the conversation afterwards showed a single tick
   * for ever, because nothing re-sends it and `/messages` does not carry it.
   *
   * Reported from both ends at once: "il a bien l'accusé de lecture activé
   * mais je ne vois rien et lui-même ne voit rien".
   *
   * A map rather than state: it is written from the sync loop's own callback
   * and read when a conversation opens, and a re-render per receipt for a
   * conversation nobody is looking at is a re-render for nothing.
   */
  const seenReceiptsRef = useRef<Map<string, readonly Receipt[]>>(new Map())
  /**
   * How far the other person has read, per conversation, as a timestamp.
   *
   * IT ONLY EVER GOES UP. A receipt naming an event this device has not
   * fetched resolves to nothing, and the screen used to take that nothing as
   * an answer -- `MESSAGR_READ_BY {"marked":2}` followed by
   * `{"marked":0}`, over and over, which is what "les chevrons s'affichent
   * quand Thibault m'écrit, et parfois l'état se perd" looks like from the
   * inside. `receipts.ts` says why the mark is held apart from what it marks.
   */
  const readMarksRef = useRef<Map<string, number>>(new Map())
  /**
   * The notebook page that makes those marks survive a relaunch.
   *
   * A Matrix receipt is ephemeral and sent once, so a mark held only in the
   * map above is a second tick that disappears every time the application
   * starts -- and comes back only if the correspondent reads something new,
   * which on a quiet conversation is never. Reported twice in the same
   * words. `readByStore.ts` argues the page.
   *
   * The map stays as the fast path the screen draws from; this is where it
   * is read from at launch and written to as it rises. The "never goes
   * backwards" rule is the store's, so the file cannot hold a lower mark
   * whatever a caller does.
   */
  const readByRef = useRef<ReadBy>(forgetfulReadBy())
  const [openScope, setOpenScope] = useState<string | null>(null)
  const openScopeRef = useRef<string | null>(null)
  /**
   * The call, when there is one. `null` is the ordinary state of a telephone.
   *
   * The runtime holds it; this is the projection a screen is drawn from, and
   * it arrives by callback because a call changes state for reasons that have
   * nothing to do with anybody touching the screen -- a peer answering, a
   * relay failing, ninety seconds passing.
   */
  const [call, setCall] = useState<CallOnScreen | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  /**
   * Whether the call is on the loudspeaker.
   *
   * Kept beside the mute rather than read back from the platform: the
   * routing has no observer, only a setter, so the screen's own record is
   * the only account of what was asked for. Reset with the call, because the
   * audio session ends with it and the next one starts at the earpiece.
   */
  const [callSpeaker, setCallSpeaker] = useState(false)
  /**
   * Recent calls, for the Appels tab.
   *
   * Read from the notebook rather than derived from the conversations:
   * `callLogStore.ts` says why, and the shortest of its reasons is that a
   * missed call is the row that matters most and the one nothing else can
   * reconstruct.
   */
  const [calls, setCalls] = useState<readonly CallRecord[]>([])
  const callLogRef = useRef<CallLog>(forgetfulCallLog())
  /**
   * Re-reads the call history. Cheap: one query against a page of the
   * notebook, with no round trip anywhere.
   */
  const refreshCalls = useCallback(async () => {
    setCalls(await callLogRef.current.recent())
  }, [])
  const callRuntimeRef = useRef<CallRuntime | null>(null)
  /**
   * A conversation somebody already answered a call in, from a notification.
   *
   * Held until the invitation arrives, because it has not yet: the press
   * happened on a locked screen and the sync that carries the call is the
   * next one. Cleared the moment it is spent, so a later call in the same
   * conversation is not answered by a press from ten minutes ago.
   */
  const answerWhenItRingsRef = useRef<string | null>(null)
  // Choosing and sending a photograph, and opening one that arrived. Held in
  // refs like every other gesture the launch effect binds.
  const attachRef = useRef<(() => void) | null>(null)
  /** Redacts messages for everyone. Bound with the session, like the rest. */
  const removeRef = useRef<((eventIds: readonly string[]) => void) | null>(null)
  /** Sends the chosen events on to another conversation. See `forwardImage.ts`. */
  const forwardRef = useRef<
    ((scope: string, eventIds: readonly string[]) => void) | null
  >(null)
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
  // What became of an invitation this launch was opened with. `null` when
  // there was none, which is almost every launch.
  const [linkOutcome, setLinkOutcome] = useState<InvitationOutcome | null>(null)
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
  // A MESSAGE SOMEBODY ELSE SENT, READ HERE FOR THE FIRST TIME.
  //
  // The trigger ADR-0013 settles on, and `offerBackup.ts` says why it is
  // received rather than sent: sending proves the account works, receiving
  // is the first time this device holds a key nobody else has.
  //
  // An effect over the built timeline rather than a hook in the sync loop,
  // because the loop hands back events still encrypted and cannot know what
  // is readable -- `receivedFromSomebodyElse.ts` carries that reasoning.
  //
  // It runs on every conversation that draws, which writes the same flag
  // again and costs a keystore write nobody notices. Reading first to avoid
  // it would be two operations where there is one.
  useEffect(() => {
    if (conversation === null || selfUserId === '') return
    const received = receivedFromSomebodyElse(conversation, selfUserId)
    // SAID WHETHER OR NOT IT IS TRUE, and that is the point: a prompt that
    // never appears looks identical whether the trigger has not fired or the
    // trigger is broken. This is the line that tells them apart, and it is
    // what a device proof reads.
    logEvent('info', 'MESSAGR_BACKUP_TRIGGER', {
      received,
      entries: conversation.length,
      // Neither identifier is carried: §13.27 and the rule that this log
      // never names a person. What matters is whether any sender differed
      // from this account, and `received` is that fact.
      readable: conversation.filter(entry => entry.body !== null).length,
    })
    if (!received) return
    // ONE EFFECT, NOT TWO, and that is not tidiness. Writing the flag and
    // asking whether to offer are the same moment, and two effects on the
    // same dependency would race: the one that asks could read the flag
    // before the one that writes has written it, and the offer would arrive
    // a conversation late for no reason anybody could find.
    const noteAndAsk = async () => {
      await rememberReceived(backupReceivedSecrets)
      const reading = await shouldOfferBackup({
        commitment: backupSecrets,
        asked: backupAskedSecrets,
        received: backupReceivedSecrets,
      })
      // SAID ONCE, IN A LINE A DEVICE PROOF CAN READ. A refusal here has
      // four causes and they look identical from outside -- three of them
      // are the feature working and one is the feature absent. The first
      // device run of this prompt showed nothing and there was no way to
      // tell which, which is why this line exists.
      logEvent('info', 'MESSAGR_BACKUP_OFFER', {
        offer: reading.decision.offer,
        backedUp: reading.backedUp,
        asked: reading.asked,
        received: reading.received,
        unreadable: reading.unreadable.join(',') || 'none',
      })
      if (!reading.decision.offer) return
      // RECORDED BEFORE THE ANSWER, which `backupPrompt.ts` argues at
      // length: an offer interrupted -- the application killed, the screen
      // turned, a call arriving -- is an offer that was made, and asking
      // again would be the nagging ADR-0013 refuses.
      await rememberBackupAsked(backupAskedSecrets)
      setBackupPrompt('offering')
    }
    noteAndAsk().catch(() => {
      // Every call inside answers rather than throwing. This is the belt on
      // the promise: a rejection nobody anticipated costs an offer made
      // later, from a conversation that draws again, and never a launch.
    })
  }, [conversation, selfUserId])
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
      else {
        pause()
        // AND THE CAMERA GOES WITH THE FOREGROUND. #202.
        //
        // Filming while the application is not on screen needs a foreground
        // service of type `camera` on Android, and Android revokes the
        // camera without one. We are not declaring it: an application able
        // to film when it is not on screen is a thing this product should
        // not know how to be, and the platform wants the same answer.
        //
        // Not merely letting the capture die, either -- a video track whose
        // camera stops does not go quiet, it sends the last frame for ever,
        // and the far end watches a face frozen mid-sentence. Turning it off
        // renegotiates the track away, so they see an avatar and a line
        // saying the camera is off.
        //
        // The audio is untouched. A call continues.
        callRuntimeRef.current?.setCameraOn(false).catch(() => {
          // A camera that would not go off is not a call to end. The
          // platform revokes it a moment later anyway.
        })
      }
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

  // WHAT EARLIER VERSIONS LEFT IN THE CACHE, cleared once per launch.
  //
  // #209: choosing one photograph and sending it left three readable JPEGs
  // there, and they outlived the photograph in the gallery. `imageLibrary`
  // removes them at source now; this clears the telephones that have been
  // accumulating them, and then finds nothing on every launch after.
  //
  // Not awaited and not on the startup path's critical line: it is a
  // directory listing, it blocks nothing, and a launch must not be slower
  // for housekeeping. Logged only when it found something.
  useEffect(() => {
    sweepWhatThePickerLeft()
      .then(swept => {
        if (swept > 0) logEvent('info', 'MESSAGR_SWEPT_PICKER_CACHE', { swept })
      })
      .catch(() => undefined)
  }, [])

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

  // A RECEIPT CAN ARRIVE BEFORE THE EVENT IT NAMES, and until now nothing
  // ever looked again.
  //
  // The live loop resolves a receipt against the timeline it has at that
  // instant. Two people writing at once means receipts that name a message
  // this device merges a moment later -- they resolved to nothing, and the
  // only thing that made them resolve was *another* receipt arriving after
  // the message. Which is exactly the report: « les chevrons s'affichent
  // quand Thibault m'écrit ».
  //
  // So the timeline moving is itself a reason to look again. The mark only
  // rises (`receipts.ts` says why), so this can run as often as it likes.
  useEffect(() => {
    const scope = openScope
    if (scope === null || selfUserId === '') return
    const entries = conversation ?? []
    const seen = seenReceiptsRef.current.get(scope)
    if (seen !== undefined && seen.length > 0) {
      const found = markUpTo(entries, seen, selfUserId)
      const held = readMarksRef.current.get(scope) ?? 0
      if (found !== null && found > held) {
        readMarksRef.current.set(scope, found)
        // AND INTO THE NOTEBOOK, so the tick survives the next launch. Not
        // awaited: the screen already has the mark, and a page that would
        // not take it costs a tick after a relaunch rather than now.
        readByRef.current.raise(scope, found).catch(() => {})
      }
    }
    setReadHere(
      readAtMark(entries, readMarksRef.current.get(scope) ?? 0, selfUserId),
    )
  }, [conversation, openScope, selfUserId])

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

      // THE NOTEBOOK FIRST, AND THE LIST OFF IT BEFORE ANY ROUND TRIP.
      //
      // This used to open two thirds of the way down the launch, after the
      // crypto machine, the initial sync, two key queries, an upload and two
      // `/joined_rooms` -- and the conversation list was derived after that
      // again, one round trip and one decryption per conversation. Measured
      // on the demonstration Pixel: seven seconds of empty screen, reported
      // as « l'écran de conversations s'affiche au bout de plusieurs
      // secondes ».
      //
      // None of that work is needed to draw what was drawn last time.
      // `listCacheStore.ts` is the fifth page of the notebook and argues why
      // keeping it is what ADR-0006 said to do when somebody finally asked.
      // Everything here is superseded by the derivation a few seconds later;
      // nothing waits on it, and a notebook that will not open leaves the
      // screen exactly as empty as it was before.
      const opening = await openNotebook(storeDir)
      namesRef.current = opening.names
      lastReadRef.current = opening.lastRead
      outstandingRef.current = opening.outstanding
      listCacheRef.current = opening.list
      hiddenRef.current = opening.hidden
      readByRef.current = opening.readBy
      // SEEDED BEFORE ANYTHING IS DRAWN, so a conversation opened on the
      // first frame already knows how far it was read.
      readMarksRef.current = new Map(await opening.readBy.all())
      setHidden(await opening.hidden.all())
      favouritesRef.current = opening.favourites
      setFavourites(await opening.favourites.marks())
      logEvent(opening.opened ? 'info' : 'warn', 'MESSAGR_GIVEN_NAMES', {
        opened: opening.opened,
        ...(opening.minted === undefined ? {} : { minted: opening.minted }),
        ...(opening.reason === undefined ? {} : { reason: opening.reason }),
      })
      // The names before the rows, so the list draws people rather than
      // identifiers on its first frame as well as its second.
      setNames(await opening.names.all())
      const lastDrawn = await opening.list.all()
      if (lastDrawn.length > 0) {
        setSummaries(lastDrawn)
        logEvent('info', 'MESSAGR_LIST_REMEMBERED', { rows: lastDrawn.length })
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
      // THE PASSWORD, KEPT AT THE ONE MOMENT IT IS EVER OFFERED.
      //
      // The service hands it back with the claim and nowhere else. A device
      // that misses it here has no way back from a reinstall, which is the
      // behaviour there was before, so its failure is logged rather than
      // fatal. See recoverySecret.ts for what it costs to keep.
      if (
        entered.entered &&
        entered.claimed &&
        entered.password !== undefined
      ) {
        const kept = await keepRecoverySecret(recoverySecrets, entered.password)
        if (!kept) logEvent('warn', 'MESSAGR_RECOVERY_SECRET_NOT_KEPT', {})
      }

      // A SESSION WHOSE CRYPTO STORE IS GONE, AND WHAT TO DO ABOUT IT.
      //
      // #190: an iOS reinstall takes the data directory and leaves the
      // keychain, so this launch would find an account, a session and a
      // device identifier intact and an empty store -- and publish fresh
      // identity keys under a device the homeserver already knows. To
      // everybody on the other side that is not a reinstall, it is an
      // existing device whose keys changed underneath them.
      //
      // BEFORE THE PUMP, and that is the whole reason this sits here rather
      // than anywhere more convenient: the pump is what publishes.
      let session = entered.entered ? entered.session : null
      let lostStore: 'reentered' | 'stranded' | null = null
      if (session !== null) {
        const what = afterReinstall({
          claimed: entered.entered && entered.claimed,
          storeExists: await cryptoStoreExists(storeDir, session.deviceId),
          password: await readRecoverySecret(recoverySecrets),
        })
        if (what.kind !== 'ordinary') {
          logEvent('warn', 'MESSAGR_REINSTALLED', { answer: what.kind })
        }
        if (what.kind === 'reenter') {
          const dead = session
          const asking = homeserverCalls(dead.baseUrl)
          const back = await reenterWithPassword(asking, {
            baseUrl: dead.baseUrl,
            userId: dead.userId,
            password: what.password,
          })
          if (back.reentered) {
            // Kept before anything is done with it: a launch interrupted
            // here would otherwise have made a device it can never find
            // again, and the next one would make another.
            await saveSession(sessionSecrets, back.session)
            session = back.session
            lostStore = 'reentered'
            // Untidy rather than dangerous if it fails: the dead device
            // holds keys nobody has, and its owner has already come back as
            // somebody else.
            const retired = await retireDevice(asking, {
              deviceId: dead.deviceId,
              userId: dead.userId,
              password: what.password,
              accessToken: back.session.accessToken,
            })
            logEvent('info', 'MESSAGR_REENTERED', {
              retired,
              was: dead.deviceId,
              now: back.session.deviceId,
            })
          } else {
            lostStore = 'stranded'
            logEvent('warn', 'MESSAGR_REENTRY_REFUSED', {
              reason: back.reason,
            })
          }
        } else if (what.kind === 'stranded') {
          lostStore = 'stranded'
        }
      }
      setReinstalled(lostStore)
      const credentials = lostStore === 'stranded' ? null : session
      // THE STATE THAT EXISTED AND WAS NEVER SET.
      //
      // `inYet` was declared, the list had its `notInYet` branch and the copy
      // for it was written in six languages -- and nothing ever answered the
      // question, so `inYet` stayed `null` and every device looked like a
      // device with an account. A tester who had installed the application
      // and not yet been invited was shown the floating action and an empty
      // state reading "invitez quelqu'un", which is the one thing he could
      // not do. Reported on 8 September 2026 in exactly those terms: "juste
      // apres l'install, il ne doit rien pouvoir faire que d'attendre la
      // reception d'une invitation".
      setInYet(credentials !== null)

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
            // TELL THE BRIDGE AGAIN WHICH VERSION THIS DEVICE WRITES TO.
            //
            // It persists neither the sealing key nor the version, so a
            // launch that skips this backs nothing up and says nothing about
            // it -- ADR-0013's own silent failure. `resumeKeyBackup` reads
            // the commitment from the keystore and hands it over.
            //
            // Not awaited into the launch's outcome and never thrown from: a
            // backup that could not be resumed is not a reason to stop an
            // application starting, and Réglages says so at any time.
            resumeKeyBackup().catch(() => {
              // `resumeKeyBackup` already answers false rather than
              // throwing; this is the belt on the promise itself, so a
              // rejection nobody anticipated cannot become an unhandled one
              // during a launch.
            })
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
            if (entered.entered && entered.invitation !== undefined) {
              setLinkOutcome(entered.invitation)
              // THE REASON GOES HERE AND NOT ON THE SCREEN. §13.27: no
              // diagnostic text on a screen a person reads, and the two
              // sentences the list draws are what it means for them. This
              // is the line somebody diagnosing a link that will not open
              // has to have -- the service distinguishes several refusals
              // and the screen deliberately does not.
              logEvent(
                entered.invitation.kind === 'used' ? 'info' : 'warn',
                'MESSAGR_INVITATION',
                { ...entered.invitation },
              )
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
            // THE DOOR SOMEBODY HELD OPEN, WALKED THROUGH BEFORE ANYTHING
            // IS READ.
            //
            // An invitation is not membership: until this joins, the room is
            // not in `/joined_rooms`, no message reaches this device, and the
            // conversation list is empty on an account whose sync reports a
            // room. `enterInvitations.ts` says how that came to be missing.
            //
            // Before the list rather than after: a conversation joined a
            // moment later would be derived a moment too late and only appear
            // at the next tick.
            await enterAnyInvitations(sessionClient, credentials.userId)

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

            // The notebook was opened at the very top of this launch, before
            // anything asked the network a question. See there for why.

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
              // A conversation opens at its newest message, so nothing is
              // away from it yet. `onContentSizeChange` says the same thing
              // when the frame lays out, but a frame away from the newest
              // renders once before that -- and the once is the flash of a
              // button pointing down at where the screen already is.
              setAwayFromNewest(false)
              // WHAT LANDS LATE MUST CHECK IT IS STILL WANTED.
              //
              // Every derivation below is a round trip, and the person can
              // open another conversation while one is in flight. Without
              // this, opening B while A was still loading drew A's messages
              // under B's name -- and `mergeTimeline` merges rather than
              // replaces, so B's own messages then arrived *on top of* A's
              // and the two stayed mixed until something reloaded. Reported
              // as « la précédente s'affiche pendant une seconde ».
              //
              // The reaction loop below already did this, under the name
              // `stillMine`. This is the same test, hoisted to where every
              // late arrival can use it.
              const stillOpen = () => openScopeRef.current === scope
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
                  if (!stillOpen()) return
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
                if (!stillOpen()) return
                setConversation(held =>
                  mergeTimeline(held ?? [], fresh.entries),
                )
                setReactions(fresh.reactions)
                // WHAT WAS READ BEFORE THIS SCREEN EXISTED.
                //
                // `/messages` carries no receipts -- they are ephemeral, and
                // a receipt is sent once. Whatever the polls have seen since
                // this launch is the only record of it, so the second tick
                // is drawn from there rather than waiting for somebody to
                // read the message a second time.
                const already = seenReceiptsRef.current.get(scope)
                if (already !== undefined) {
                  // Against the timeline that just arrived, which is the one
                  // that can resolve a receipt the live loop could not.
                  const found = markUpTo(
                    fresh.entries,
                    already,
                    credentials.userId,
                  )
                  const held = readMarksRef.current.get(scope) ?? 0
                  if (found !== null && found > held) {
                    readMarksRef.current.set(scope, found)
                    readByRef.current.raise(scope, found).catch(() => {})
                  }
                }
                // FROM THE MARK, AND ALWAYS -- including when it is zero,
                // which is what clears the ticks of the conversation that
                // was open before this one.
                setReadHere(
                  readAtMark(
                    fresh.entries,
                    readMarksRef.current.get(scope) ?? 0,
                    credentials.userId,
                  ),
                )
                const members = await fetchJoinedMembers(
                  makePumpHttp(sessionClient),
                  scope,
                )
                if (!stillOpen()) return
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

            // THE WORDS BEHIND THE MARKS, bound where the client is.
            // `readFavourites.ts` says why they are derived rather than
            // written down: the notebook keeps which messages were kept and
            // never what they said.
            readKeptRef.current = async () =>
              readFavourites(
                {
                  entries: async scope =>
                    (
                      await loadConversation(
                        sessionClient,
                        scope,
                        credentials.userId,
                      )
                    ).entries,
                },
                await favouritesRef.current.all(),
              )

            // REACTING, AND TAKING IT BACK. ADR-0011.
            //
            // A key this account already used is removed rather than added
            // again: tapping a chip one is in is how a person takes a
            // reaction back, and offering the same key twice would make a
            // count of two from one person.
            // REMOVING FOR EVERYONE, one event at a time.
            //
            // In order, and each failure said on its own: a redaction that
            // did not land is a message still in the conversation at both
            // ends, and a batch that reported one outcome for five would
            // hide exactly the case somebody needs to know about.
            //
            // The conversation is re-derived once at the end rather than
            // per event. `buildTimeline` now draws a line where a message
            // was removed -- see `redactionKind.ts` for how it can tell that
            // from a reaction being taken back.
            // FORWARDING, WHICH IS A COPY AND NEVER A HANDOVER.
            //
            // Words go as words: a forwarded message is a new message in the
            // destination, sent by this account, which is the truth about
            // who put it there.
            //
            // A photograph is downloaded, decrypted and sealed afresh --
            // `forwardImage.ts` argues why sending the `m.image` on would
            // hand the destination the original file's key rather than a
            // copy of the picture.
            //
            // In order and one at a time, like every other send in this
            // file: the destination reads what somebody meant to send in the
            // order they meant it, and one failure is one line rather than a
            // batch reporting a single outcome for five.
            forwardRef.current = (target, eventIds) => {
              const going = async () => {
                setSending('sending')
                const held = conversationRef.current
                for (const eventId of eventIds) {
                  const entry = held.find(one => one.eventId === eventId)
                  if (entry === undefined) continue
                  if (entry.image !== undefined) {
                    const ready = await photographForForward(
                      credentials,
                      entry.image,
                    )
                    if (!ready.ready) {
                      logEvent('warn', 'MESSAGR_NOT_FORWARDED', {
                        reason: ready.reason,
                      })
                      continue
                    }
                    const sent = await sendPhotograph(
                      sessionClient,
                      credentials,
                      target,
                      ready.image,
                    )
                    if (!sent.sent) {
                      logEvent('warn', 'MESSAGR_NOT_FORWARDED', {
                        reason: sent.reason,
                      })
                    }
                    continue
                  }
                  if (entry.body === null) continue
                  const sent = await sendTypedMessage(
                    sessionClient,
                    target,
                    entry.body,
                  )
                  if (!sent.sent) {
                    logEvent('warn', 'MESSAGR_NOT_FORWARDED', {
                      reason: sent.reason,
                    })
                  }
                }
                setSending('idle')
                // The list, because a conversation nobody is looking at just
                // gained its newest message and its row has to say so.
                await refreshList().catch(() => {})
              }
              going().catch((cause: unknown) => {
                setSending('failed')
                logEvent('warn', 'MESSAGR_NOT_FORWARDED', {
                  reason: getErrorMessage(cause),
                })
              })
            }

            removeRef.current = eventIds => {
              const scope = openScopeRef.current
              if (scope === null) return
              const erase = async () => {
                for (const eventId of eventIds) {
                  const gone = await removeMessage(
                    sessionClient,
                    scope,
                    eventId,
                  )
                  if (!gone.removed) {
                    logEvent('warn', 'MESSAGR_NOT_REMOVED', {
                      reason: gone.reason ?? 'unknown',
                    })
                    continue
                  }
                  // DRAWN THE MOMENT IT IS TRUE, not when the homeserver
                  // gets round to agreeing.
                  //
                  // The redaction has been accepted -- that is what the
                  // request resolving means -- so the message is gone, and
                  // this device is entitled to say so from what it did
                  // rather than from what it is told. Re-reading first is
                  // what shipped, and on a Pixel the message stayed on
                  // screen until the conversation was closed and reopened:
                  // `/messages` still served the copy from before the
                  // redaction, and the derivation dutifully brought it back.
                  //
                  // The re-read below still runs and still wins, so nothing
                  // here is a claim that outlives being wrong.
                  if (openScopeRef.current !== scope) continue
                  setConversation(held =>
                    (held ?? []).map(entry =>
                      entry.eventId === eventId
                        ? { ...entry, body: null, removed: true }
                        : entry,
                    ),
                  )
                }
                const fresh = await loadConversation(
                  sessionClient,
                  scope,
                  credentials.userId,
                )
                if (openScopeRef.current !== scope) return
                // MERGED, like every other derivation. Replacing was the
                // first shape of this, on the argument that `mergeTimeline`
                // keeps what it already holds -- true then, and fixed at the
                // source instead: a removal now wins the merge, whichever
                // order the two arrive in. Replacing would have thrown away
                // everything past `loadConversation`'s forty-event window,
                // so deleting one message in a long conversation would have
                // taken the top of it off the screen.
                setConversation(held =>
                  mergeTimeline(held ?? [], fresh.entries),
                )
                setReactions(fresh.reactions)
              }
              erase().catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_NOT_REMOVED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }

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
              // Its own, because this closure is built outside
              // `showConversation` and reads the scope for itself. Same
              // test, same reason: an upload outlives the screen it began on.
              const stillOpen = () => openScopeRef.current === scope
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
                if (!stillOpen()) return
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
                // THE GHOST THIS DEVICE LEFT BEHIND, taken away before the
                // new one goes up.
                //
                // A pusher is keyed by its token and nothing says which
                // device it belonged to, so a token that changes leaves its
                // pusher on the account for ever -- and the homeserver keeps
                // pushing to it. On the tester's telephone that was a
                // sandbox token from an old entitlement, rejected sixteen
                // times in two hours, months after the build that minted it
                // was gone.
                //
                // This device wrote its own key down, so it is the one thing
                // that can say "that was mine". Best effort: a ghost that
                // will not go is noise, while a new pusher that does not go
                // up is silence.
                const before = await readLastPushkey(pushkeySecrets)
                if (before !== null && before !== answer.token) {
                  await stopWakingThisDevice(sessionClient, before, answer.road)
                  logEvent('info', 'MESSAGR_PUSH_GHOST_REMOVED', {})
                }
                const done = await registerThisDeviceForWaking(
                  sessionClient,
                  credentials,
                  answer.token,
                  answer.road,
                )
                if (done.registered) {
                  await keepLastPushkey(pushkeySecrets, answer.token)
                }
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
            whenNotificationPressed(
              scope => {
                setTab('chat')
                if (scope !== null) showConversation(scope)
              },
              // SOMEBODY ALREADY SAID YES, ON A LOCKED SCREEN.
              //
              // The application starts with no call: the invitation is still
              // in a sync nobody has polled yet, and the runtime cannot
              // answer something it has not been told about. So the answer
              // is remembered and spent when the telephone starts ringing --
              // which is the poll after this, seconds away.
              //
              // Refusing is immediate and needs no call, because there is
              // nothing to refuse yet: the notification comes down and the
              // caller's own invitation runs out. Sending a refusal from a
              // process with no session open is the half this does not do,
              // and it costs the caller the ninety seconds.
              pressed => {
                if (pressed.answered) {
                  answerWhenItRingsRef.current = pressed.scope
                  setTab('chat')
                  return
                }
                answerWhenItRingsRef.current = null
                stopRinging(pressed.scope).catch(() => {
                  // A notification that will not come down is not worth
                  // losing the launch over.
                })
              },
            )

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
                // THE LAST ONE NAMED, not the first. On a link opened by
                // somebody who already has an account there are two: the
                // account the service drew, which cedes its place and
                // deactivates itself, and then the real person. Naming the
                // drawn one would put the given name on an account that no
                // longer exists.
                const who = admitted.entrants[admitted.entrants.length - 1]
                if (name !== null && who !== undefined) {
                  const kept = await namesRef.current.set(who, name)
                  setNames(held => new Map(held).set(who, name))
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
              const derived = await listConversations(
                sessionClient,
                credentials.userId,
                // Read fresh rather than held: `markRead` has just written
                // to it, and a held map would redraw the badge it cleared.
                await lastReadRef.current.all(),
                // Same argument, and the state is behind the ref by one
                // render after a hiding: a row that previewed a message
                // somebody had just hidden would break the promise in the
                // one place they look first.
                await hiddenRef.current.all(),
              )
              setSummaries(derived)
              // AND KEPT, so the next launch draws this instantly. Not
              // awaited by the screen: the list is already on it, and a
              // notebook write is not something a person should wait behind.
              // The page swallows its own failures, so there is nothing here
              // that could reject.
              listCacheRef.current.keep(derived).catch(() => {})
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
            // ONE RUNTIME FOR THE WHOLE SESSION, NOT ONE PER CALL.
            //
            // A callee's application has no call until it has been rung, and
            // the ring arrives inside an encrypted event in a poll -- so
            // something has to be listening before there is anything to
            // listen for. This is that something; it holds at most one call
            // and starts it when a poll turns out to be an invitation.
            callRuntimeRef.current = startCallRuntime(
              sessionClient,
              credentials,
              onScreen => {
                setCall(onScreen)
                // The press that already said yes, spent on the invitation
                // it was waiting for.
                if (
                  onScreen !== null &&
                  onScreen.state.call === 'incomingInvite' &&
                  answerWhenItRingsRef.current === onScreen.scope
                ) {
                  answerWhenItRingsRef.current = null
                  callRuntimeRef.current?.answer().catch((cause: unknown) =>
                    logEvent('warn', 'MESSAGR_CALL_NOT_ANSWERED', {
                      reason: getErrorMessage(cause),
                    }),
                  )
                }
                // A telephone that stopped ringing must stop saying so.
                if (
                  onScreen === null ||
                  onScreen.state.call !== 'incomingInvite'
                ) {
                  const where = onScreen?.scope
                  if (where !== undefined) {
                    stopRinging(where).catch(() => {})
                  }
                }
                // A call that ended took the microphone with it, and the next
                // one starts unmuted.
                if (onScreen === null) {
                  setCallMuted(false)
                  setCallSpeaker(false)
                }
                // A call that ended is a line the Appels tab does not have.
                if (onScreen === null || onScreen.state.call === 'ended') {
                  refreshCalls().catch(() => {})
                }
              },
              // The notebook's call page, opened a few lines above. A device
              // whose notebook did not open still places calls; it just has
              // no list of them afterwards, which is what `forgetfulCallLog`
              // answers and what ADR-0010 calls degrading.
              opening.calls,
            )
            callLogRef.current = opening.calls
            refreshCalls().catch(() => {
              // A list that did not load is an empty screen, not a failed
              // launch.
            })

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
                  // KEPT FOR EVERY CONVERSATION, drawn for the one on screen.
                  // A receipt is sent once; whoever reads it later has to
                  // find it somewhere.
                  for (const [scope, seen] of tick.receipts) {
                    if (seen.length > 0)
                      seenReceiptsRef.current.set(scope, seen)
                  }
                  // RAISED, NEVER REPLACED, and for every conversation
                  // rather than only the open one: a mark learnt while the
                  // list is on screen is a mark the conversation already has
                  // when it opens.
                  for (const [scope, seen] of tick.receipts) {
                    if (seen.length === 0) continue
                    const found = markUpTo(
                      conversationRef.current,
                      seen,
                      credentials.userId,
                    )
                    if (found === null) continue
                    const held = readMarksRef.current.get(scope) ?? 0
                    if (found > held) {
                      readMarksRef.current.set(scope, found)
                      readByRef.current.raise(scope, found).catch(() => {})
                    }
                  }
                  const openNow = openScopeRef.current
                  if (openNow !== null) {
                    const seen = tick.receipts.get(openNow)
                    if (seen !== undefined && seen.length > 0) {
                      const mark = readMarksRef.current.get(openNow) ?? 0
                      const read = readAtMark(
                        conversationRef.current,
                        mark,
                        credentials.userId,
                      )
                      // The one line anybody debugging a missing second tick
                      // has. A receipt that arrived and resolved to nothing
                      // is a different fault from one that never arrived,
                      // and they are indistinguishable on a screen. `mark` is
                      // in it now, because "the receipt did not resolve" and
                      // "nothing is read yet" print the same `marked: 0`.
                      logEvent('info', 'MESSAGR_READ_BY', {
                        scope: openNow,
                        receipts: seen.length,
                        mark,
                        marked: read.size,
                      })
                      setReadHere(read)
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

                  // AND ON EVERY TICK, BECAUSE ADMISSION IS NOT LAUNCH.
                  //
                  // The entrant claims a link, and the issuer admits them a
                  // poll later -- so the invitation arrives at a device that
                  // is already running and has finished launching. Entering
                  // only at launch would leave them on the threshold until
                  // they next restarted the application.
                  //
                  // Not awaited: nothing below depends on it, and the loop's
                  // tick must not wait on a join.
                  enterAnyInvitations(sessionClient, credentials.userId)
                    .then(walked => {
                      // A room joined is a row the list does not have yet.
                      // A room declined is one it may still be showing: the
                      // issuer's second conversation was refused, and the
                      // list has to stop offering it.
                      if (
                        walked.joined.length > 0 ||
                        walked.collapsed.length > 0
                      ) {
                        refreshList().catch(() => {})
                      }
                      // AND THE LINE ON THE LIST STOPS PROMISING A
                      // CONVERSATION THAT WAS DECLINED. Entry says « la
                      // conversation qu'elle ouvre va apparaître dans votre
                      // liste », which is true of every invitation except
                      // this one. Seen on the bench: the banner said it
                      // while the runtime was declining the conversation.
                      const first = walked.collapsed[0]
                      if (first !== undefined) {
                        setLinkOutcome({ kind: 'already', from: first.from })
                      }
                    })
                    .catch((cause: unknown) =>
                      logEvent('warn', 'MESSAGR_ENTER_FAILED', {
                        reason: getErrorMessage(cause),
                      }),
                    )

                  // BEFORE THE EARLY RETURN, like the admission round above
                  // and for a related reason: a call's events do move a
                  // scope, but nothing here should depend on that being the
                  // reason this tick exists. A telephone that rings only when
                  // the list also had work to do is a telephone with a
                  // condition on it.
                  //
                  // Not awaited: the loop's tick must not wait on a
                  // decryption pass, and nothing below depends on it.
                  callRuntimeRef.current
                    ?.deliver(tick)
                    .catch((cause: unknown) =>
                      logEvent('warn', 'MESSAGR_CALL_DELIVER_FAILED', {
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

              // AND THE LAUNCH DOES NOT OPEN IT. It used to, "through the
              // same path a row of the list takes", and that was right when
              // there was one screen and one conversation on it.
              //
              // With a list, opening a conversation nobody asked for is the
              // application deciding where somebody is. And it picked badly
              // by construction: the room is the one this launch's own probe
              // resolved, or else `firstJoinedRoom` -- whichever the
              // homeserver happens to list first, which on this account is
              // the bench room full of "encrypted by the bridge, sent by the
              // application". Reported from the Pixel: « au bout de quelques
              // secondes sans action de ma part, je me retrouve
              // systématiquement sur cette discussion ».
              //
              // What runs above still runs: the member list, the other
              // participant and the offered history are facts the launch
              // report carries, and `claimOfferedHistory` imports Megolm
              // sessions that every conversation then benefits from.
              // Deriving them was never the same thing as navigating.
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
      // THE SHEET, THEN THE MODE, BEFORE THE CONVERSATION UNDER THEM.
      // Without this, back closed the conversation and left the selection
      // alive: the next conversation opened showing "N selected" for event
      // ids belonging to the room just left, and "supprimer pour moi" would
      // have hidden those ids under the new scope.
      if (removing) {
        setRemoving(false)
        return true
      }
      if (selected.size > 0) {
        setSelected(new Set())
        return true
      }
      if (personOpen) {
        setPersonOpen(false)
        return true
      }
      if (openScope !== null) {
        setOpenScope(null)
        openScopeRef.current = null
        setSelected(new Set())
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
  }, [
    trust,
    openPlate,
    removing,
    selected,
    personOpen,
    openScope,
    legalOpen,
    invite.stage,
    tab,
  ])

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
        {call !== null && (
          <CallScreen
            state={call.state}
            failure={call.failure}
            shown={displayNameFor(call.peerUserId, names.get(call.peerUserId))}
            muted={callMuted}
            speaker={callSpeaker}
            // WHAT THIS SIDE SENDS BACK, decided on the ringing screen and
            // not implied by the offer: `undefined` lets the runtime mirror
            // what was offered, and the two buttons pass an explicit answer.
            onAnswer={wants =>
              callRuntimeRef.current?.answer(wants).catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_CALL_NOT_ANSWERED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }
            onReject={() => callRuntimeRef.current?.reject()}
            onHangup={() => callRuntimeRef.current?.hangup()}
            onMute={wanted => {
              // What the microphone actually holds afterwards, not what was
              // asked for: a track that refused is a mute that did not
              // happen, and a button drawn from the intent would lie about it.
              const held = callRuntimeRef.current?.setMuted(wanted) ?? wanted
              setCallMuted(held)
            }}
            onSpeaker={wanted => {
              callRuntimeRef.current?.setSpeaker(wanted)
              setCallSpeaker(wanted)
            }}
            pictures={call.pictures}
            sendingVideo={call.sendingVideo}
            // WHAT THE CALL CARRIES AFTERWARDS, not what was asked: the
            // runtime answers with the truth, and a camera that refused
            // leaves the control where it was rather than lit.
            onCamera={on => {
              callRuntimeRef.current?.setCameraOn(on).catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_CAMERA_NOT_SET', {
                  reason: getErrorMessage(cause),
                }),
              )
            }}
            onSwitchCamera={() => callRuntimeRef.current?.switchCamera()}
            onDismiss={() =>
              callRuntimeRef.current?.release().catch((cause: unknown) =>
                logEvent('warn', 'MESSAGR_CALL_NOT_RELEASED', {
                  reason: getErrorMessage(cause),
                }),
              )
            }
          />
        )}

        {forwarding !== null && (
          <PickConversation
            summaries={summaries}
            names={names}
            // Not the one it came from: forwarding a message into the
            // conversation it is already in is not a gesture.
            {...(openScope === null ? {} : { except: openScope })}
            onPick={scope => {
              const chosen = forwarding
              setForwarding(null)
              setSelected(new Set())
              if (scope === null) return
              forwardRef.current?.(scope, chosen)
            }}
          />
        )}

        {removing && openScope !== null && (
          <RemoveSheet
            count={selected.size}
            forEveryone={canRemoveForEveryone(
              selected,
              conversation ?? [],
              selfUserId,
            )}
            onCancel={() => setRemoving(false)}
            onForMe={() => {
              const scope = openScope
              const chosen = [...selected]
              setRemoving(false)
              setSelected(new Set())
              // SHOWN FIRST, KEPT SECOND, like every other gesture in this
              // application -- and the failure is said rather than swallowed,
              // because unlike the rest of the notebook a hiding that did not
              // hold is a message still on screen after somebody asked for it
              // to go.
              setHidden(held => new Set([...held, ...chosen]))
              hiddenRef.current
                .hide(scope, chosen)
                .then(kept => {
                  if (!kept) logEvent('warn', 'MESSAGR_HIDE_NOT_KEPT', {})
                })
                .catch(() => logEvent('warn', 'MESSAGR_HIDE_NOT_KEPT', {}))
            }}
            onForEveryone={() => {
              const chosen = [...selected]
              setRemoving(false)
              setSelected(new Set())
              // Bound where the session lives, like every other gesture in
              // this screen. A device drawn before the launch finished has
              // nothing to redact with anyway.
              removeRef.current?.(chosen)
            }}
          />
        )}

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
          // NOT `paddingBottom: keyboardInset`. It was here, and it moved
          // everything the keyboard was not covering while leaving the one
          // thing that mattered where it was -- see the dock below.
          style={styles.screen}
          edges={['left', 'right']}>
          {/* Outside the scroll view, like the tab bar and for the same reason:
            what the band says is true of the instance rather than of the
            screen under it, and a fact about the instance that scrolls away
            is one nobody reads twice.

            AND IT GOES WHILE SELECTING. Two dark green bands stacked, the
            brand's above the selection's, is what shipped first and it read
            as two applications -- reported from the Pixel with a screenshot:
            « le bandeau de sélection devrait se substituer au bandeau
            supérieur Messagr ». The selection bar takes the top of the
            screen outright, safe area included, and the band comes back when
            the mode ends. Nothing else in the product hides it, because
            nothing else in the product is a mode. */}
          {/* THE BAND IS MOUNTED ONCE AND ITS CONTENTS CHANGE.
            Selecting takes the top of the screen -- the ticket asks for the
            bar to replace the Messagr band, not to stack under it -- and the
            first version did that by unmounting one and mounting the other.
            That tore down the safe area and the status-bar declaration with
            them, for « un flash vraiment pas agréable ». `Header` takes
            children now; nothing at the top of the screen mounts or
            unmounts, whatever mode the screen is in. */}
          <Header>
            {selected.size > 0 ? (
              <SelectionBar
                count={selected.size}
                canCopy={canCopy(selected, conversation ?? [])}
                canForward={canForward(selected, conversation ?? [])}
                canKeep={
                  onlyPhotograph(selected, conversation ?? [])?.image !==
                  undefined
                }
                canFavourite={canFavourite(selected, conversation ?? [])}
                // EVERY one, not any: the control does one thing to the whole
                // selection, and a mixed one has to pick a direction. Keeping
                // is the safe half -- a mark added to something already kept
                // changes nothing, where a removal would silently drop marks
                // somebody did not ask about.
                alreadyFavourite={
                  selected.size > 0 &&
                  [...selected].every(id => favourites.has(id))
                }
                onClear={() => setSelected(new Set())}
                onFavourite={() => {
                  const chosen = [...selected]
                  const already = chosen.every(id => favourites.has(id))
                  setSelected(new Set())
                  // Drawn before the notebook answers: the mark is this
                  // device's own and the page is a formality. A failure is a
                  // line in the log rather than a screen -- the person is
                  // looking at a message, not at a database.
                  setFavourites(had => {
                    const next = new Set(had)
                    for (const id of chosen) {
                      if (already) next.delete(id)
                      else next.add(id)
                    }
                    return next
                  })
                  const page = favouritesRef.current
                  const written = already
                    ? page.drop(chosen)
                    : page.keep(openScope ?? '', chosen)
                  written
                    .then(held => {
                      if (!held) {
                        logEvent('warn', 'MESSAGR_FAVOURITE_NOT_KEPT', {
                          how: already ? 'drop' : 'keep',
                        })
                      }
                    })
                    .catch(() => {})
                }}
                onCopy={() => {
                  const held = conversation ?? []
                  const words = copyText(selected, held)
                  const alone = onlyPhotograph(selected, held)
                  setSelected(new Set())
                  // WORDS WIN WHEN THERE ARE BOTH. A clipboard holds one
                  // thing and `setImage` would replace `setString`, so
                  // `onlyPhotograph` answers `null` beside any text --
                  // choosing silently would put half of a selection
                  // somewhere nobody can see it.
                  if (words !== '') {
                    Clipboard.setString(words)
                    return
                  }
                  if (alone?.image === undefined) return
                  // The picture is already decrypted and base64 in the
                  // viewer's cache, so this is the same bytes `Photograph`
                  // is drawing. `setImage` wants them without the `data:`
                  // preamble that makes them a URI.
                  openImageRef
                    .current?.(alone.image)
                    .then(shown => {
                      if (!shown.shown) return
                      const at = shown.uri.indexOf('base64,')
                      if (at === -1) return
                      Clipboard.setImage(shown.uri.slice(at + 'base64,'.length))
                    })
                    .catch((cause: unknown) =>
                      logEvent('warn', 'MESSAGR_NOT_COPIED', {
                        reason: getErrorMessage(cause),
                      }),
                    )
                }}
                onKeep={() => {
                  const alone = onlyPhotograph(selected, conversation ?? [])
                  setSelected(new Set())
                  if (alone?.image === undefined) return
                  // THE SAME BYTES THE SCREEN IS DRAWING. `openImageRef`
                  // answers the viewer's own cache, so saving costs no round
                  // trip and cannot save something other than what the person
                  // is looking at.
                  openImageRef
                    .current?.(alone.image)
                    .then(async shown => {
                      if (!shown.shown) {
                        setPhotoKept('failed')
                        return
                      }
                      const done = await keepPhotograph(photoLibrary, shown.uri)
                      setPhotoKept(done.kept ? 'kept' : 'failed')
                      if (!done.kept) {
                        // §13.27: the reason is for whoever is diagnosing it,
                        // never for the person holding the telephone.
                        logEvent('warn', 'MESSAGR_KEEP_PHOTOGRAPH', {
                          reason: done.reason,
                        })
                      }
                    })
                    .catch((cause: unknown) => {
                      setPhotoKept('failed')
                      logEvent('warn', 'MESSAGR_KEEP_PHOTOGRAPH', {
                        reason: getErrorMessage(cause),
                      })
                    })
                }}
                onForward={() => setForwarding([...selected])}
                onRemove={() => setRemoving(true)}
              />
            ) : undefined}
          </Header>

          {/* THE CONVERSATION'S OWN BAR, and it is chrome rather than content.
            It was inside the scroll view, so it inherited that view's 24pt
            padding and sat inset from both edges while the messages slid
            under it. Here it spans the screen and stays put, like the band
            above it and the dock below. */}
          {openScope !== null &&
            trust === null &&
            !personOpen &&
            selected.size === 0 && (
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
                  setSelected(new Set())
                  setTrust(null)
                  // Otherwise the next conversation opens on the person screen of
                  // the one before it.
                  setPersonOpen(false)
                }}
                onOpenPerson={() => setPersonOpen(true)}
                // Only with somebody to call. `theOtherMember` answers null in
                // a conversation that is not two people, and a call button in
                // a room of three is a button with no peer to name -- #88 is
                // 1:1, and the control says so by being absent.
                onCall={
                  party === null || call !== null
                    ? undefined
                    : () => placeCall(openScope, party.other)
                }
                // THE SAME GUARD, because the same two things make either
                // call impossible: nobody to name, or one already up.
                onVideoCall={
                  party === null || call !== null
                    ? undefined
                    : () => placeCall(openScope, party.other, { video: true })
                }
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
                    const fromEnd =
                      contentSize.height -
                      (contentOffset.y + layoutMeasurement.height)
                    // A margin, because a scroll rarely stops on the exact
                    // pixel and "within a message's height of the end" is what
                    // a person means by being at the bottom.
                    atBottom.current = fromEnd <= NEAR_THE_END
                    // Set on every event and usually the same value: React
                    // stops at an identical one, and the alternative -- a ref
                    // holding the last answer so the setter is called less --
                    // is a second copy of the truth to keep in step, which is
                    // what `restedIn` already exists to apologise for.
                    setAwayFromNewest(
                      fromEnd > layoutMeasurement.height * A_WAY_BACK,
                    )
                  }
            }
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (openScope === null) return
              if (restedIn.current !== openScope) {
                restedIn.current = openScope
                atBottom.current = true
                setAwayFromNewest(false)
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
            //
            // AND THE KEYBOARD IS PART OF THE DOCK'S HEIGHT, once it is up.
            // The dock lifts itself by `keyboardInset`; this reserves the
            // space it lifted into, or the last messages sit behind the
            // composer that just rose over them. Reported from iOS the
            // moment the composer stopped being covered: "le contenu des
            // échanges ne se décale pas lorsque le clavier s'affiche".
            //
            // Two halves of one gesture, and fixing the first without the
            // second only moved which thing was hidden.
            contentContainerStyle={[
              styles.content,
              { paddingBottom: dockHeight + keyboardInset + space.l },
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
                {/* A row opens the CONVERSATION; the button beside it rings
                    the person back. `CallsList.tsx` says why this screen
                    carries a call button where the conversation list does
                    not, and why it is still not a directory. */}
                <CallsList
                  calls={calls}
                  now={Date.now()}
                  shownFor={who => displayNameFor(who, names.get(who))}
                  onOpen={scope => {
                    setTab('chat')
                    // The launch effect binds it; a screen drawn before the
                    // session exists has no conversation to open anyway.
                    openConversationRef.current?.(scope)
                  }}
                  onCall={(scope, peer) => {
                    // A call already up owns the microphone, and placing a
                    // second one over it is the header's rule too.
                    if (call !== null) return
                    placeCall(scope, peer)
                  }}
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

            {openScope === null &&
              tab === 'settings' &&
              !legalOpen &&
              !favouritesOpen &&
              !backupOpen && (
                <View style={styles.block}>
                  <Settings
                    onBack={() => setTab('chat')}
                    onLegal={() => setLegalOpen(true)}
                    onBackup={() => setBackupOpen(true)}
                    onFavourites={() => {
                      setFavouritesOpen(true)
                      // FETCHED ON OPENING AND DROPPED ON CLOSING, exactly as a
                      // conversation is. The notebook says which messages were
                      // kept and never what they said -- `readFavourites.ts`
                      // gives the reasoning at length -- so the words have to
                      // be derived, and this is the moment somebody asked for
                      // them.
                      setKeptMessages(null)
                      readKeptRef
                        .current?.()
                        .then(setKeptMessages, () => setKeptMessages([]))
                    }}
                    // ANDROID'S OWN SCREEN, NOT A DIALOG OF OURS. The
                    // permission that lets a call light the display is granted
                    // at installation only to applications registered as the
                    // telephone; everybody else has to be taken to Settings
                    // and shown the switch. `Settings.tsx` says what was
                    // measured on the demonstration Pixel.
                    //
                    // `sendIntent` rather than a native module: this is one
                    // intent with no answer to read back, and a module written
                    // to open a screen would be a module to maintain for a
                    // string.
                    onRingFullScreen={() => {
                      Linking.sendIntent(
                        'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
                        [
                          {
                            key: 'android.provider.extra.APP_PACKAGE',
                            value: 'eu.messagr',
                          },
                        ],
                      ).catch(() => {
                        // An older Android has no such screen. The
                        // application's own notification settings are where
                        // somebody would go looking anyway.
                        Linking.openSettings().catch(() => {})
                      })
                    }}
                    // THE SAME KIND OF DOOR, FOR THE MODE THAT SILENCED THE
                    // RINGING. `ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`
                    // is a list of every application, with no extra to
                    // preselect one -- unlike the full-screen screen above,
                    // which takes a package. So this lands on the list and
                    // the hint beside the row says what to look for.
                    onRingWhileQuiet={() => {
                      Linking.sendIntent(
                        'android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS',
                      ).catch(() => {
                        Linking.openSettings().catch(() => {})
                      })
                    }}
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

            {openScope === null &&
              tab === 'settings' &&
              backupOpen &&
              backupState !== null && (
                <View style={styles.block}>
                  <BackupSettings
                    enabled={backupState.enabled}
                    total={backupState.total}
                    backedUp={backupState.backedUp}
                    onBack={() => {
                      setBackupOpen(false)
                      // Dropped rather than kept: the next opening asks
                      // again, and a value held between them would be the
                      // screen describing a backup as it was.
                      setBackupState(null)
                    }}
                    onEnable={() => {
                      // THE DOOR A REFUSAL HONOURED FOR GOOD OWES SOMEBODY.
                      // ADR-0013 records a refusal for ever and leaves this
                      // row; without a way back in, that would be a decision
                      // taken once and never revisitable.
                      //
                      // The same sequence the offer runs, and the same place
                      // to show what it produced: this screen closes and the
                      // key takes the whole surface, because it is shown
                      // once and must not sit behind a settings row.
                      const session = sessionClientRef.current
                      if (session === null) return
                      // NOTHING IS UNMOUNTED UNDER THE FINGER, and that is
                      // not caution -- it is a defect this had.
                      //
                      // This closed the screen here, synchronously, inside
                      // the press handler. React then drew the Réglages list
                      // where the button had been, and the rest of the same
                      // gesture landed on the row now under it: tapping
                      // « Sauvegarder mes messages » also opened
                      // « Informations légales », which a person would find
                      // waiting behind the key screen. Reproduced twice on an
                      // emulator before it was believed.
                      //
                      // The key screen covers everything anyway, so there is
                      // nothing to close: `onDone` below does it, once the
                      // finger is long gone.
                      acceptKeyBackup(session)
                        .then(outcome => {
                          setBackupPrompt(
                            outcome.accepted
                              ? { restoreKey: outcome.restoreKey }
                              : null,
                          )
                        })
                        .catch(() => setBackupPrompt(null))
                    }}
                    onReplace={() => {
                      // #220's third criterion, and it is not built yet.
                      // Replacing makes a NEW version and retires the old
                      // key, which is one more homeserver request than
                      // accepting and a sentence this screen already carries
                      // but has nothing to act on yet. Left rather than
                      // wired to something that would half-do it.
                    }}
                  />
                </View>
              )}

            {openScope === null && tab === 'settings' && favouritesOpen && (
              <View style={styles.block}>
                <Favourites
                  kept={keptMessages ?? []}
                  shownFor={scope => {
                    const other = summaries.find(
                      one => one.scope === scope,
                    )?.other
                    return other === undefined || other === null
                      ? scope
                      : displayNameFor(other, names.get(other))
                  }}
                  onBack={() => {
                    setFavouritesOpen(false)
                    // Dropped rather than kept for the next opening: these
                    // are decrypted messages, and holding them in memory
                    // behind a screen nobody is looking at is the thing
                    // ADR-0006 is about.
                    setKeptMessages(null)
                  }}
                  onOpen={scope => {
                    setFavouritesOpen(false)
                    setKeptMessages(null)
                    setTab('chat')
                    openConversationRef.current?.(scope)
                  }}
                />
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
                    invitation={linkOutcome}
                    reinstalled={reinstalled}
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
                    // WITHOUT WHAT THIS DEVICE WAS TOLD NOT TO DRAW.
                    // Filtered here rather than in `buildTimeline`, which
                    // derives from the room and should keep saying what the
                    // room holds: hiding is this telephone's own decision,
                    // and mixing it into the derivation would make the
                    // timeline mean something different per device.
                    entries={
                      hidden.size === 0
                        ? conversation
                        : conversation.filter(
                            entry => !hidden.has(entry.eventId),
                          )
                    }
                    selected={selected}
                    // `null` is the background tap: it clears rather than
                    // toggling, which is the only way out that does not
                    // require aiming at the ✕.
                    onToggle={eventIds =>
                      setSelected(held =>
                        eventIds === null ? new Set() : toggle(held, eventIds),
                      )
                    }
                    selfUserId={selfUserId}
                    sending={sending}
                    kept={photoKept}
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
                  {/* A NOTICE, NOT A MESSAGE, and it has to look like
                    neither a bubble nor the running text of the screen.
                    It was `typeScale.body` on no ground at all, laid
                    straight into the block -- so it arrived wider than
                    every bubble above it and flush against the glass, in
                    the largest type on the screen. Seen on the emulator
                    the moment the vouching bench proved itself.

                    The ochre is `Trust.tsx`'s word for the same thing:
                    « une personne a jugé », waiting on something stronger.
                    Both sentences here are that -- one says a past
                    arrived because somebody answered for you, the other
                    that one was offered and not taken up. Neither is a
                    measure, so neither is red. */}
                  {claimed !== null && claimed.claimed === 'imported' && (
                    <View style={styles.historyNote}>
                      <Text testID="history-claim" style={styles.historyText}>
                        {t('vouch_history_arrived')}
                      </Text>
                    </View>
                  )}
                  {claimed !== null &&
                    claimed.claimed !== 'none' &&
                    claimed.claimed !== 'imported' &&
                    claimed.kind === 'untrusted' && (
                      <View style={styles.historyNote}>
                        <Text testID="history-claim" style={styles.historyText}>
                          {t('vouch_history_untrusted')}
                        </Text>
                      </View>
                    )}
                </View>
              )}

            {/* THE PERSON, which is where what is specific to this product
              lives: what is known about them, what you call them, and the two
              gestures that cannot be undone. One tap from the conversation
              and out of the way of reading it. */}
            {openScope !== null && trust === null && personOpen && (
              // AND THIS ONE CARRIES ITS OWN GUTTER, because it is the one
              // screen written here rather than in a component.
              //
              // `content` used to pad every screen by `space.xl`, on top of
              // the gutter each component already had -- so it was removed
              // when the conversation list came out too narrow. Every other
              // screen has `layout.screenGutter` of its own; this one had
              // been living on the padding that went, and its text was
              // flush against the edge of the telephone. Measured on the
              // emulator: every row of it began at x = 0.
              <View style={[styles.block, styles.person]}>
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
          {/* THE KEYBOARD LIFTS THE DOCK ITSELF, NOT THE VIEW AROUND IT.
            The note above the `SafeAreaView` says why, and then the padding
            was put there anyway: "an absolutely-positioned child is laid
            against the border box and not the padding box". So
            `paddingBottom` on the parent moved everything EXCEPT this, and
            this is the composer. Reported from iOS as the keyboard covering
            the field, twice -- the Android side never showed it because
            `MainActivity` pads the content view natively, below React
            Native, where an absolute child is inside what moves. */}
          <View
            style={[styles.dock, { bottom: keyboardInset }]}
            pointerEvents="box-none"
            onLayout={event => setDockHeight(event.nativeEvent.layout.height)}>
            {/* AND ONLY ON A DEVICE THAT IS IN.
              Inviting somebody needs an account to invite them from:
              `inviteRef` is bound inside the branch that has credentials, so
              on a device without one this button opened a panel whose action
              did nothing. `inYet === true` rather than `!== false` on
              purpose -- the answer is unknown for the fraction of a second
              the keystore takes, and a control that appears and then leaves
              is worse than one that arrives when it works. */}
            {openScope === null &&
              tab === 'chat' &&
              inYet === true &&
              invite.stage === 'shut' && (
                <FloatingAction
                  testID="invite-open"
                  label={t('invite_open')}
                  onPress={() => setInvite({ stage: 'resting' })}
                />
              )}

            {/* AND THE WAY BACK DOWN, in the same corner as the green one.
              Reported from the Pixel: « lorsqu'on remonte dans l'historique
              [...] un bouton qui permette de revenir au dernier message avec
              une flèche qui descend vers le bas ». Above the composer rather
              than beside it: the composer is where the thumb rests, and a
              control that scrolls the screen has no business sharing a row
              with the field that types into it.

              `trust` and `personOpen` are what tell the conversation apart
              from the two panels that open over it -- neither of them
              scrolls the timeline, so neither of them has a newest message
              to return to. Selection is not in the list: the bar takes the
              header, not the frame, and somebody selecting a message from
              last week still wants the way back. */}
            {openScope !== null &&
              trust === null &&
              !personOpen &&
              awayFromNewest && (
                <FloatingAction
                  testID="scroll-to-newest"
                  label={t('back_to_newest')}
                  mark="↓"
                  quiet
                  onPress={() => {
                    // SAID HERE AND NOT WAITED FOR. The circle used to go
                    // away only when the scroll events from the animation
                    // said the frame had arrived -- which is one throttled
                    // event away from never, and on a long conversation the
                    // animation can land short of an end that is still
                    // measuring itself. Reported from the Pixel: « cela
                    // fonctionne mais l'icône devrait disparaître
                    // automatiquement ».
                    //
                    // Pressing this button IS the statement that somebody
                    // wants to be at the newest message. Nothing the frame
                    // reports afterwards is better evidence of it, and if
                    // they scroll away again the next event says so.
                    setAwayFromNewest(false)
                    // And the frame follows the newest from now on, so an
                    // animation that lands short is carried the rest of the
                    // way by `onContentSizeChange` rather than leaving
                    // somebody just above the end.
                    atBottom.current = true
                    frame.current?.scrollToEnd({ animated: true })
                  }}
                />
              )}

            {/* THE INPUT BAR IS PART OF THE DOCK, above the tabs.
              It was the last thing in the conversation's own scroll view, so
              it scrolled away with the messages and somebody had to reach the
              bottom of the thread to type. Here it is where the thumb left
              it. */}
            {/* AND NOT WHILE SELECTING. #192: "la barre remplace l'en-tête ;
              le composeur disparaît -- ses taps se battraient avec un mode
              où chaque tap sélectionne." It also takes back the screen the
              bar needs to be read on. */}
            {openScope !== null &&
              trust === null &&
              !personOpen &&
              selected.size === 0 &&
              sendMessage !== null && (
                <Composer
                  onSend={sendMessage}
                  onAttach={() => attachRef.current?.()}
                />
              )}

            {/* AND THEY GO AGAIN INSIDE A CONVERSATION, WHICH IS THE THIRD
              TIME THIS HAS MOVED, so it is written down as a decision each
              time rather than left to look like drift.

              The mockup hid them there, which is what every other messenger
              does. They were made to stay on 7 September 2026 at the account
              holder's request -- "the bar never moves, so muscle memory holds
              everywhere". They go again on 9 September, at his request, for
              the reason a conversation is not a destination but a thing you
              are inside of: « quand nous sommes sur l'écran de discussion, il
              faut enlever la zone des 4 onglets en bas d'écran pour récupérer
              l'espace ».

              What paid for the first decision is still true and is now paid
              for elsewhere: the header's back arrow is the way out, and the
              hardware back button already walks the same layers. What the
              first decision cost is what a phone has least of -- a bar of
              screen under the keyboard, in the one place a person is reading
              and writing at the same time. */}
            {/* A TAB PRESS COMES BACK TO THAT TAB'S TOP, AND `setTab` ALONE
                DID NOT. From inside a conversation, pressing Discussions set
                the tab to the one it was already on and changed nothing
                visible: the conversation is drawn over the list, and nothing
                closed it. Reported from a Pixel on 7 September 2026, in the
                words anybody would use -- "rien ne se passe".

                That case cannot happen any more -- there is no tab bar
                inside a conversation to press. The clearing stays because
                the other layers it names can be open on the screens that do
                have one: a photograph, a person, the legal text, an
                invitation. A tab is not a step backwards, it is a
                destination; `back` walks the layers, this clears them. */}
            {openScope === null && (
              <TabBar
                current={tab}
                onSelect={next => {
                  setOpenPlate(null)
                  setPersonOpen(false)
                  setSelected(new Set())
                  setOpenScope(null)
                  openScopeRef.current = null
                  setLegalOpen(false)
                  setInvite({ stage: 'shut' })
                  setAdmission(null)
                  setTab(next)
                }}
                unread={unreadCount}
              />
            )}
          </View>
        </SafeAreaView>

        {/* THE ONE TIME THIS PRODUCT ASKS SOMEBODY TO KEEP A SECRET, AND
            THE LAST CHILD OF THE ROOT SO THAT NOTHING CAN PAINT OVER IT.
            These two sat inside the conversation screen, beside the
            full-screen photograph, and that was wrong in a way only a device
            found: accepting from Réglages with no conversation open created
            the backup and showed no key at all. A backup exists and nobody
            has ever seen what opens it -- the one state this feature must
            never reach.
            The offer looked fine because a conversation is open by
            construction when it fires. The acceptance from Réglages is not,
            and it is the path a refusal honoured for good depends on.
            **LAST, AND THAT IS THE WHOLE OF IT.** They were moved off the
            root and placed FIRST, which looked right and was worse than
            where they started: `StyleSheet.absoluteFill` takes a view out of
            the flow but not out of the paint order, so every later sibling
            -- the entire application -- drew on top of them. The key screen
            rendered underneath everything, a person saw the settings screen,
            and the tap meant for « J'ai rangé ma clé » went to whatever was
            above it. `backupPrompt` therefore never cleared.
            Three device runs were spent on it, and what hid it is that Detox
            matched the key anyway: Espresso's visibility asks whether a view
            has a rectangle on screen, never whether something is standing in
            front of it. A test can see what a person cannot.
            A call now paints under these rather than over. That is the right
            way round: an overlay something else can cover is not an overlay,
            and of the two the key is the one that cannot be shown again.

            **AND A `SafeAreaView`, WHICH THE MOVE HAD COST THEM.** Placed
            last they are outside the `SafeAreaView` above, which is the
            whole point -- but a bare `absoluteFill` is laid against the
            window and not against the safe area, so the title drew through
            the clock and the battery. The account holder photographed it on
            the demonstration telephone the day it shipped.
            Every edge here, and not the `['left', 'right']` the screen above
            takes: that view leaves top and bottom to a header and a dock
            that paint to them deliberately. These two have neither. They are
            a sheet with a title at the top and buttons at the bottom, and
            both want to sit inside the insets rather than under them. The
            ground is on the inset view rather than only inside, or the strip
            it reserves would show the application through it. */}
        {backupPrompt === 'offering' && (
          <SafeAreaView
            // Named so a device run can measure the inset it reserves: this
            // view stays the size of the window and pads, so the screen
            // inside it is shorter by exactly the insets. `boot.test.ts`
            // compares the two, which is the only way this is provable on
            // Android -- Detox reports an element's size there and never its
            // position.
            testID="backup-overlay"
            style={[StyleSheet.absoluteFill, styles.root]}
            edges={['top', 'bottom', 'left', 'right']}>
            <BackupOffer
              onAccept={() => {
                const session = sessionClientRef.current
                if (session === null) {
                  setBackupPrompt(null)
                  return
                }
                acceptKeyBackup(session)
                  .then(outcome => {
                    // The key exists for exactly as long as this state
                    // holds it: nothing else has a copy, here or on the
                    // homeserver. `acceptBackup.ts` hands it back precisely
                    // once and never on a failure.
                    setBackupPrompt(
                      outcome.accepted
                        ? { restoreKey: outcome.restoreKey }
                        : null,
                    )
                  })
                  .catch(() => setBackupPrompt(null))
              }}
              onRefuse={() => setBackupPrompt(null)}
            />
          </SafeAreaView>
        )}

        {backupPrompt !== null && backupPrompt !== 'offering' && (
          <SafeAreaView
            // Named so a device run can measure the inset it reserves: this
            // view stays the size of the window and pads, so the screen
            // inside it is shorter by exactly the insets. `boot.test.ts`
            // compares the two, which is the only way this is provable on
            // Android -- Detox reports an element's size there and never its
            // position.
            testID="backup-overlay"
            style={[StyleSheet.absoluteFill, styles.root]}
            edges={['top', 'bottom', 'left', 'right']}>
            <RecoveryKeyShown
              recoveryKey={backupPrompt.restoreKey}
              onCopy={() => Clipboard.setString(backupPrompt.restoreKey)}
              // DROPPED HERE AND NOWHERE ELSE. Leaving this screen is the
              // moment the only copy of the key stops existing in this
              // process, which is what « montrée une fois » means in code.
              //
              // And whatever is behind is put right here rather than when it
              // was left: a Réglages screen that said « vos messages ne sont
              // pas sauvegardés » before this key existed would be lying the
              // moment it came back into view.
              onDone={() => setBackupPrompt(null)}
            />
          </SafeAreaView>
        )}

        {/* ABOVE EVERYTHING, AND NOT INSIDE THE CONVERSATION.
          A call outlives the screen it started on: somebody who places one
          and then goes back to the list is still on that call, and a
          telephone that rings only while the right conversation is open is
          not a telephone. So it hangs off the root, drawn from the runtime's
          own state rather than from wherever the person happens to be. */}
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

/** How long the line about a saved photograph stays on the screen. */
const KEPT_SHOWN_MS = 4000

/**
 * How far up the history counts as being somewhere else, as a share of the
 * frame's own height.
 *
 * `NEAR_THE_END` is the wrong threshold for the button: it is 80 points, so
 * the way back would appear after one flick and sit there through a slow
 * read. Half a screen is what a person means by having gone looking for
 * something -- and being a share of the frame rather than a number of points
 * makes it the same gesture on a phone and on a tablet.
 */
const A_WAY_BACK = 0.5

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
  // NO HORIZONTAL PADDING, BECAUSE EVERY SCREEN ALREADY CARRIES ITS OWN.
  //
  // This was `padding: space.xl`, and each screen inside it adds
  // `layout.screenGutter` -- so a conversation row sat forty points from
  // each edge and the list looked narrow on a telephone that is not.
  // Reported from the Pixel: « toute la largeur de l'écran n'est pas
  // utilisée ». The same doubling pushed the first row thirty-two points
  // below the band.
  //
  // The gutter belongs to the screen, not to the thing that scrolls it: a
  // list wants its separators to run edge to edge and its text inset, and
  // only the list knows that.
  content: { paddingTop: space.s },
  // Anchored to the bottom, over whatever is scrolling behind it.
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  block: { marginBottom: space.xxl },
  person: { paddingHorizontal: layout.screenGutter },
  // Spread rather than picked apart: size, leading, weight and tracking
  // travel together, and separating them is how a line-height floor gets
  // broken without anyone deciding to break it.
  historyNote: {
    marginHorizontal: layout.screenGutter,
    marginTop: space.m,
    padding: space.m,
    backgroundColor: color.wait['100'],
    borderLeftWidth: stroke.accent,
    borderLeftColor: color.wait['500'],
  },
  historyText: {
    ...typeScale.bodySm,
    color: color.wait['700'],
  },
})
