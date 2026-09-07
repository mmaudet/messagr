import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import {
  color,
  elevation,
  floors,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadFile } from '../timeline/imageEvent'
import { separatorsFor, type DayMark } from '../timeline/daySeparators'
import { platesIn, type Plate as Grouping } from '../timeline/plates'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { ReactionTally } from '../timeline/reactions'
import { Photograph } from './Photograph'
import { Plate } from './Plate'

/**
 * The 1:1 conversation, reduced to its bones.
 *
 * The reference screen of the product and the most frequent one, taken here
 * as a skeleton rather than at its full density: no reactions, no receipts,
 * no voice, no album. Those are what make it the reference screen, and they
 * come after something works.
 *
 * # The sender is announced, never established
 *
 * Decrypting an event proves which key wrote it and nothing about who holds
 * that key. So a message from somebody else is labelled "se présente comme",
 * and the word "vérifier" appears nowhere: verification is a real act in this
 * product, it has not happened, and borrowing its word here would be the
 * first place the interface starts lying about its own trust model.
 *
 * A message this account sent carries no such label. There is nothing claimed
 * about it -- this device encrypted it.
 *
 * # What could not be read stays visible
 *
 * A message whose room key never arrived is shown as unreadable rather than
 * dropped. A gap a person can see is one they can act on; a gap silently
 * closed is one they will never know cost them something.
 */
export interface ConversationProps {
  readonly entries: readonly TimelineEntry[]
  /** Used only to tell this account's own messages from everyone else's. */
  readonly selfUserId: string
  readonly sending: 'idle' | 'sending' | 'failed'
  /** Reactions, grouped by the message they point at. */
  readonly reactions?: ReadonlyMap<string, readonly ReactionTally[]>
  /** This account's own messages somebody else has read. */
  readonly read?: ReadonlySet<string>
  /**
   * Add or remove a reaction. `own` is the id of this account's own reaction
   * on that key, when it has one -- removing is a redaction and needs the
   * event, which is why it travels rather than being looked up again.
   */
  readonly onReact?: (target: string, key: string, own: string | null) => void
  /** Downloads and decrypts a photograph. Absent means none are drawn. */
  readonly onLoadImage?: (file: ReadFile) => Promise<ShownImage>
  /**
   * The clock, injectable, for the same reason `ConversationList` takes one:
   * a screen reading `Date.now()` inside itself is one nothing can screenshot
   * twice and get the same answer from.
   */
  readonly now?: number
  /**
   * Who this conversation is with, when there is one such person. Used only
   * to decide whether a message's claimed sender is worth naming -- see the
   * note where it is read.
   */
  readonly otherParty?: string
  /** Opens a plate full screen, at the photograph tapped. */
  readonly onOpenPlate?: (plate: Grouping, at: number) => void
}

export function Conversation({
  entries,
  selfUserId,
  sending,
  reactions = new Map(),
  read = new Set(),
  onReact,
  onLoadImage,
  now = Date.now(),
  otherParty,
  onOpenPlate,
}: ConversationProps) {
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // This read `useColorScheme()` and switched to `color.dark`. Four
  // components did, and nothing else in the application does -- so on a
  // phone set to dark mode these four turned dark inside screens that stayed
  // pale: a black composer under a paper conversation, reported from an
  // iPhone on 7 September 2026 with the words "meme pb de fond".
  //
  // The application has a light palette and a dark one reserved for surfaces
  // that ASK for it -- the promise screen, a photograph full screen. Which
  // ground a component sits on is its parent's business, which is why
  // `LanguageStrip` takes `onDark` and does not guess. A component that reads
  // the system theme is guessing, and it guessed wrong here.
  const palette = color
  // Which entries open a new day. Computed once per render rather than per
  // message: a separator is a property of the sequence, not of an entry.
  const days = separatorsFor(entries, now)
  // Photographs sent together, read as one thing. A reading of the timeline
  // rather than something sent -- see `plates.ts`, and `imageEvent.ts` for
  // the same argument about not inventing a shape only this client can open.
  const plates = platesIn(entries)
  const plateAt = new Map(plates.map(plate => [plate.at, plate]))
  const swallowed = new Set(plates.flatMap(plate => [...plate.swallowed]))

  /**
   * Which message has its reaction row open, if any.
   *
   * HELD HERE BECAUSE A BUBBLE CANNOT CLOSE ITSELF FROM OUTSIDE. It was a
   * boolean inside each bubble, so tapping anywhere else left the row
   * standing -- a popover that only its own long press could take back.
   * Reported from a Pixel on 7 September 2026.
   *
   * One open at a time falls out of holding it here, which is also what a
   * person expects: two rows of emoji on one screen is a question about
   * which one is listening.
   */
  const [offering, setOffering] = useState<string | null>(null)

  return (
    <View
      testID="conversation"
      style={styles.screen}
      // ANY TOUCH CLOSES IT, AND THE TOUCH STILL LANDS.
      //
      // Capture runs from the root towards whatever was touched, so this sees
      // the tap first and closes the row; returning `false` declines the
      // gesture, so the emoji underneath still receives it. Choosing a
      // reaction therefore reacts AND closes, and tapping anywhere else just
      // closes -- one rule for both, instead of an invisible overlay that has
      // to be told what to let through.
      onStartShouldSetResponderCapture={() => {
        setOffering(held => (held === null ? held : null))
        return false
      }}>
      {entries.length === 0 ? (
        <Text
          testID="conversation-empty"
          style={[styles.empty, { color: palette.neutral['600'] }]}>
          {t('conversation_empty')}
        </Text>
      ) : (
        entries.map(entry => (
          <React.Fragment key={entry.eventId}>
            {/* Drawn inside the plate that gathered it, and so not here. A
                screen that drew both would show every photograph twice. */}
            {days.get(entry.eventId) !== undefined && (
              <View
                testID={`day-${entry.eventId}`}
                style={[
                  styles.separator,
                  { backgroundColor: palette.surface.sunk },
                ]}>
                <Text
                  style={[
                    styles.separatorLabel,
                    { color: palette.neutral['600'] },
                  ]}>
                  {dayLabel(days.get(entry.eventId)!)}
                </Text>
              </View>
            )}
            {!swallowed.has(entry.eventId) && (
              <Message
                entry={entry}
                plate={plateAt.get(entry.eventId)}
                onOpenPlate={onOpenPlate}
                offering={offering === entry.eventId}
                // Opens, and never toggles: the capture above has already
                // closed whatever was open by the time this runs, so a
                // toggle here would read the state it just cleared and
                // reopen on every long press. A long press means "offer me
                // reactions"; closing is any other touch's job now.
                onOffer={() => setOffering(entry.eventId)}
                mine={entry.claimedSender === selfUserId}
                palette={palette}
                tallies={reactions.get(entry.eventId) ?? []}
                read={read.has(entry.eventId)}
                onReact={(key, own) => onReact?.(entry.eventId, key, own)}
                onLoadImage={onLoadImage}
                unexpected={
                  otherParty === undefined || entry.claimedSender !== otherParty
                }
              />
            )}
          </React.Fragment>
        ))
      )}

      {sending !== 'idle' && (
        <Text
          testID="conversation-send-state"
          style={[styles.note, { color: palette.neutral['600'] }]}>
          {sending === 'sending'
            ? t('conversation_sending')
            : t('conversation_send_failed')}
        </Text>
      )}
    </View>
  )
}

/**
 * The clock on a bubble.
 *
 * Hours and minutes, padded, in the device's own 24-hour reading. Not
 * `whenShown.ts`, which answers a different question -- a list row asks *how
 * long ago*, and a bubble already sits under a date separator that answers
 * *which day*, so all it needs is the time.
 */
function clockOf(sentAt: number): string {
  const when = new Date(sentAt)
  return t(
    'when_time %1$d %2$d',
    when.getHours(),
    String(when.getMinutes()).padStart(2, '0'),
  )
}

/**
 * What a date separator says.
 *
 * Which separator and where is `daySeparators.ts` and is tested there; this
 * is the wording, which stays with every other string.
 */
function dayLabel(mark: DayMark): string {
  switch (mark.kind) {
    case 'today':
      return t('today')
    case 'yesterday':
      return t('yesterday')
    case 'date':
      // The key is `date_separator`, and its placeholders live in the value
      // rather than in the name -- unlike most of this catalogue, which
      // carries them in the key. Inherited from the previous product, kept
      // rather than renamed: the shape is what makes the other catalogues
      // drop in unmodified.
      return t(
        'date_separator',
        mark.day,
        t(`month_${mark.month}` as CopyKey),
        mark.year,
      )
  }
}

/**
 * The keys offered on a long press.
 *
 * Six, and no picker. A full emoji keyboard is a different screen and a
 * different ticket; six covers what a reaction is for -- agreeing, laughing,
 * saying "seen" without saying anything -- and a person who wants a seventh
 * can say it in words, which this application is rather good at.
 */
const OFFERED = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

function Message({
  entry,
  mine,
  palette,
  tallies,
  onReact,
  read,
  offering,
  onOffer,
  onLoadImage,
  unexpected,
  plate,
  onOpenPlate,
}: {
  entry: TimelineEntry
  /** The plate this entry opens, when it opens one. */
  plate?: Grouping
  readonly onOpenPlate?: (plate: Grouping, at: number) => void
  mine: boolean
  /** Whether this came from somebody other than the conversation's party. */
  unexpected: boolean
  palette: typeof color | typeof color.dark
  tallies: readonly ReactionTally[]
  /** Whether somebody else has read this one. Only meaningful for `mine`. */
  read: boolean
  /** `mine` is the id of this account's own reaction, when it has one. */
  onReact: (key: string, mine: string | null) => void
  /** Whether this bubble's reaction row is the open one. Held by the screen. */
  offering: boolean
  /** Asks for it to open. Closing is the screen's business: any touch does it. */
  onOffer: () => void
  readonly onLoadImage?: (file: ReadFile) => Promise<ShownImage>
}) {
  return (
    <View style={mine ? styles.mine : styles.theirs}>
      {/* WHO IT CLAIMS TO BE FROM, AND ONLY WHEN THAT IS NEWS.
          `claimedSender` is unauthenticated by construction: decrypting an
          event proves which key wrote it and nothing about who holds that
          key. That is worth saying -- and it was said above every incoming
          message, spelling out a full identifier with its homeserver, in a
          conversation whose header already names the person.

          Repeating it there taught nobody anything and broke the density
          screen 21 is the reference for. It appears when the sender is *not*
          the person this conversation is with, which is exactly when the
          distinction between "the account says" and "the person is" has
          something to tell. The trust screen carries the argument in full.

          AND WHEN THERE IS NO SUCH PERSON, IT ALWAYS APPEARS. `otherParty` is
          undefined when the room does not have exactly two people in it --
          `theOtherMember` answers null for three, which is right, because a
          conversation with three people is not one with somebody. The first
          version of this rule read `otherParty !== undefined && ...`, so a
          three-person room named nobody at all: every message unattributed,
          and no way to tell who wrote what. Silence is only honest where the
          answer is obvious, and it stops being obvious at three. */}
      {!mine && unexpected && (
        <Text
          testID={`claimed-${entry.eventId}`}
          style={[styles.claimed, { color: palette.neutral['600'] }]}>
          {t('conversation_sender_claimed %@', entry.claimedSender)}
        </Text>
      )}
      {/* The bubble is pressable only to offer a reaction. A long press
          rather than a tap: a tap on a message is what a person does to read
          it, and stealing that gesture for a menu is how a conversation stops
          being scrollable. */}
      <Pressable
        onLongPress={onOffer}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={t('reaction_offer')}
        testID={`bubble-${entry.eventId}`}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          {
            // `green200` rather than `green100`: the pale one is a label
            // tint, and a message is not a label -- below that saturation it
            // stops reading as green at all. Reported from a device.
            backgroundColor: mine
              ? palette.brand.green200
              : palette.surface.sunk,
          },
        ]}>
        {plate !== undefined &&
        onLoadImage !== undefined &&
        onOpenPlate !== undefined ? (
          <Plate
            plate={plate}
            fetch={onLoadImage}
            onOpen={at => onOpenPlate(plate, at)}
            // The same gesture the bubble above it answers. A plate's
            // reactions annotate its first event, which is the event this
            // `Message` is: one plate, one place they attach.
            onLongPress={onOffer}
          />
        ) : entry.image !== undefined && onLoadImage !== undefined ? (
          // The photograph instead of the text, not beside it. An `m.image`
          // carries a fallback name in `body` for clients that cannot draw
          // the picture; this one can, and drawing both would put
          // "image.jpg" under every photograph.
          <Photograph
            image={entry.image}
            fetch={onLoadImage}
            testID={`image-${entry.eventId}`}
          />
        ) : (
          <Text
            testID={`body-${entry.eventId}`}
            style={[
              styles.body,
              {
                color:
                  entry.body === null
                    ? palette.neutral['600']
                    : palette.neutral['900'],
              },
            ]}>
            {entry.body ?? t('conversation_unreadable')}
          </Text>
        )}
      </Pressable>

      {/* ON THE MESSAGE, NOT UNDER IT.
          These sat below the timestamp, a full `space.m` from whatever came
          next, which read as a small message of its own rather than as an
          annotation on the one above -- reported from a device, on a plate of
          photographs where the effect is worst: the chips looked like a reply
          to the pictures.

          So they hang on the bottom edge of the bubble, overlapping it, the
          way every messenger draws this. Overlap by negative margin rather
          than absolute position: the row still takes its own height in the
          flow minus the overlap, so the next message is spaced from the chips
          and not from the bubble behind them. Absolute would have lifted them
          out of the flow and let the next message run underneath.

          `surface.raised` and a hairline, because a chip on a photograph has
          nothing behind it to sit against. */}
      {tallies.length > 0 && (
        <View style={styles.tallies} testID={`reactions-${entry.eventId}`}>
          {tallies.map(tally => (
            <Pressable
              key={tally.key}
              testID={`reaction-${entry.eventId}-${tally.key}`}
              onPress={() => onReact(tally.key, tally.mine)}
              accessibilityRole="button"
              accessibilityLabel={`${tally.key} ${tally.count}`}
              hitSlop={CHIP_REACH}
              style={[
                styles.chip,
                styles.tally,
                {
                  // Green only where this account is among them: it is the
                  // one place on a chip where the brand colour carries
                  // information rather than decorating.
                  backgroundColor:
                    tally.mine !== null
                      ? palette.brand.green100
                      : palette.surface.raised,
                  borderColor: palette.neutral['200'],
                },
              ]}>
              <Text
                style={styles.chipKey}>{`${tally.key} ${tally.count}`}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {offering && (
        <View style={styles.offered} testID={`offer-${entry.eventId}`}>
          {OFFERED.map(key => (
            <Pressable
              key={key}
              testID={`offer-${entry.eventId}-${key}`}
              onPress={() => {
                onReact(
                  key,
                  tallies.find(tally => tally.key === key)?.mine ?? null,
                )
              }}
              accessibilityRole="button"
              accessibilityLabel={key}
              style={styles.chip}>
              <Text style={styles.chipKey}>{key}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* THE TIME, AND ON THIS ACCOUNT'S OWN MESSAGES THE TICKS.
          Screen 21 asks for timestamps and double read receipts, and both are
          things people read without noticing -- which is the whole argument
          of that screen: look like what they already know.

          ONE TICK OR TWO, AND NEVER THREE. Matrix reports the homeserver
          accepting an event, and somebody's client saying it was read.
          Nothing between them. The familiar third state -- "delivered to the
          device" -- does not exist in this protocol, and drawing it would be
          a guess presented as a fact. See receipts.ts.

          Only on this account's own messages: a tick on somebody else's would
          say that *you* read it, which they can see for themselves. */}
      <View style={styles.stamp}>
        <Text
          testID={`when-${entry.eventId}`}
          style={[styles.state, { color: palette.neutral['600'] }]}>
          {clockOf(entry.sentAt)}
        </Text>
        {mine && (
          <Text
            testID={`state-${entry.eventId}`}
            accessibilityLabel={
              read ? t('message_read_hint') : t('message_delivered_hint')
            }
            style={[
              styles.ticks,
              { color: read ? palette.brand.green700 : palette.neutral['600'] },
            ]}>
            {read ? '✓✓' : '✓'}
          </Text>
        )}
      </View>
    </View>
  )
}

/**
 * A tally chip's drawn height, and the reach that makes up the difference.
 *
 * `floors.touchTargetMin` is 44 and not negotiable, but a 44pt slab hanging
 * off the corner of every message is not what the floor is for -- it is for
 * what a thumb can hit. `hitSlop` grows the target without growing the pill,
 * so the chip is 28 to the eye and 44 to a finger. The slop is computed from
 * the two rather than written out, so the floor stays satisfied if either
 * moves.
 */
const CHIP_HEIGHT = 28
const CHIP_REACH = {
  top: (floors.touchTargetMin - CHIP_HEIGHT) / 2,
  bottom: (floors.touchTargetMin - CHIP_HEIGHT) / 2,
  left: space.xs,
  right: space.xs,
}

const styles = StyleSheet.create({
  screen: { gap: space.m },
  empty: typeScale.bodySm,
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  claimed: { ...typeScale.caption, marginBottom: space.xs },
  offered: { flexDirection: 'row', gap: space.xs, marginTop: space.xs },
  tallies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    // UP, ONTO THE BUBBLE. Half the chip's own height, so it straddles the
    // edge rather than touching it. The rest of the height still counts in
    // the flow, which is what keeps the next message clear of the chips.
    marginTop: -(CHIP_HEIGHT / 2),
    // Inset from the corner, so the squared-off author corner stays legible:
    // it is the one mark that says which side wrote a message without colour.
    paddingHorizontal: space.m,
  },
  chip: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: space.s,
    borderRadius: radius.pill,
  },
  // A tally is the one chip that does not get the 44pt floor as its own
  // height -- it would be a slab hanging off every message. `CHIP_REACH`
  // gives back what the height gives up.
  tally: {
    minHeight: CHIP_HEIGHT,
    height: CHIP_HEIGHT,
    paddingHorizontal: space.s,
    borderWidth: stroke.base,
    ...elevation['1'],
  },
  chipKey: typeScale.bodySm,
  state: { ...typeScale.caption, marginTop: space.xs },
  bubble: {
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    // ROUNDED THROUGHOUT. The 45-degree notch is the identity's accent, and
    // screen 21 says where it belongs: "L'entaille à 45° de l'identité
    // redevient un accent -- marqueur d'agent et boutons -- au lieu d'être
    // portée par chaque bulle." A mark on everything marks nothing.
    borderRadius: radius.bubble,
    maxWidth: '80%',
  },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
  ticks: {
    ...typeScale.caption,
  },
  separator: {
    alignSelf: 'center',
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
    marginVertical: space.m,
    borderRadius: radius.pill,
  },
  separatorLabel: typeScale.caption,
  // The author's own corner is squared off. It is in the token file as
  // `bubbleAuthorCorner`, and it is the one asymmetry that says which side
  // wrote a message without colour having to carry it alone.
  bubbleMine: { borderBottomRightRadius: radius.bubbleAuthorCorner },
  bubbleTheirs: { borderBottomLeftRadius: radius.bubbleAuthorCorner },
  body: typeScale.body,
  note: typeScale.caption,
})
