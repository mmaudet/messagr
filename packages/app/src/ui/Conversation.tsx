import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import {
  color,
  elevation,
  floors,
  layout,
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
import { EmojiPicker } from './EmojiPicker'
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
  /**
   * What became of the last photograph somebody asked to keep, or `null`.
   *
   * Beside `sending` because it is the same kind of thing -- a line under
   * the conversation saying what just happened to a picture -- and in a
   * different field because the two can be true at once: a photograph can
   * be saved while another is still being sent.
   */
  readonly kept: 'kept' | 'failed' | null
  /** Reactions, grouped by the message they point at. */
  readonly reactions?: ReadonlyMap<string, readonly ReactionTally[]>
  /** This account's own messages somebody else has read. */
  readonly read?: ReadonlySet<string>
  /** Which messages the selection mode holds. Empty means no mode at all. */
  readonly selected?: ReadonlySet<string>
  /**
   * Adds or removes events, together. `null` clears the whole selection,
   * which is what a tap on the background means.
   *
   * SEVERAL AT ONCE because a plate is one thing on screen and several
   * events underneath: it goes in and out as a whole, which is what its
   * single outline promises.
   */
  readonly onToggle?: (eventIds: readonly string[] | null) => void
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
  kept,
  reactions = new Map(),
  selected = EMPTY,
  onToggle = () => {},
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
  // `LanguagePicker` takes `onDark` and does not guess. A component that reads
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
   * Which message has the whole catalogue open, if any.
   *
   * Separate from `offering`: the row closes on the touch that opened this,
   * and the picker is a modal that outlives it.
   */
  const [picking, setPicking] = useState<string | null>(null)

  return (
    // THE ROW AND THE SELECTION ARE ONE STATE NOW.
    //
    // This screen used to hold `offering` and close it on any touch, through
    // a capture-phase handler and a `justOpened` ref -- a whole mechanism
    // built to answer "is the row still wanted?", and a subtle one: closing
    // at touch-down unmounted the emoji under the finger before the press
    // landed, which took a Pixel to find.
    //
    // A selection answers the same question by existing. The row is shown
    // when exactly one message is selected (#192: a reaction targets one
    // message, so it goes at the second), and leaving the selection closes
    // it. There is nothing left to synchronise, and nothing left to race.
    <Pressable
      testID="conversation"
      style={styles.screen}
      // A TAP ANYWHERE ELSE LEAVES THE MODE, and this is a `Pressable`
      // rather than the capture-phase handler that used to live here. An
      // inner `Pressable` -- a bubble, an emoji, a plate -- wins the gesture
      // and this never fires, which is precisely the rule wanted and the one
      // the old handler had to hand-build with a ref.
      //
      // `undefined` when nothing is selected, so a conversation nobody is
      // selecting in has no press target over it at all.
      onPress={selected.size > 0 ? () => onToggle(null) : undefined}
      accessibilityRole={selected.size > 0 ? 'button' : undefined}
      accessibilityLabel={selected.size > 0 ? t('selection_clear') : undefined}>
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
                // ONE MESSAGE SELECTED IS ONE MESSAGE OFFERED REACTIONS.
                // At two the row goes, because a reaction targets one
                // message and no interface should have to explain that.
                offering={selected.size === 1 && selected.has(entry.eventId)}
                selected={selected.has(entry.eventId)}
                // A long press starts the selection; once there is one, a
                // plain tap adds and removes. One gesture in, one gesture
                // to grow it, which is what a thumb already knows.
                // A PLATE IS ONE THING ON SCREEN AND SEVERAL EVENTS
                // UNDERNEATH. Selecting it took only the event it is drawn
                // at, so the outline covered three photographs and
                // "supprimer pour tout le monde" removed one of them. The
                // plate's own events go in and out together, which is what
                // the single outline promises.
                onOffer={() => onToggle(idsOf(entry, plateAt))}
                onToggle={
                  selected.size > 0
                    ? () => onToggle(idsOf(entry, plateAt))
                    : undefined
                }
                // The `+`. Held on the screen rather than in the bubble
                // because the picker is a modal over everything, and a
                // bubble that owns one would own it per bubble.
                onMore={() => setPicking(entry.eventId)}
                mine={entry.claimedSender === selfUserId}
                palette={palette}
                tallies={reactions.get(entry.eventId) ?? []}
                read={read.has(entry.eventId)}
                // AND REACTING LEAVES THE MODE. A reaction is a decision;
                // the bar and the row have done what they were opened for,
                // and a screen still in selection afterwards is one the
                // person has to dismiss for no reason.
                onReact={(key, own) => {
                  onReact?.(entry.eventId, key, own)
                  onToggle(null)
                }}
                onLoadImage={onLoadImage}
                unexpected={
                  otherParty === undefined || entry.claimedSender !== otherParty
                }
              />
            )}
          </React.Fragment>
        ))
      )}

      {/* SAID, AND NOT ONLY DONE. A photograph that leaves for the gallery
          leaves silently otherwise: nothing on this screen changes, and the
          person has to open another application to find out whether the
          gesture worked. The failing half is the one they can act on. */}
      {kept !== null && (
        <Text
          testID="conversation-kept"
          style={[styles.note, { color: palette.neutral['600'] }]}>
          {kept === 'kept' ? t('selection_kept') : t('selection_keep_failed')}
        </Text>
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

      {picking !== null && (
        <EmojiPicker
          onClose={() => setPicking(null)}
          onChoose={key => {
            // Whether this account already reacted with THAT key, which is
            // what makes a second press of the same one take it back --
            // exactly as the six on the row behave.
            const already = reactions
              .get(picking)
              ?.find(tally => tally.key === key)?.mine
            onReact?.(picking, key, already ?? null)
            setPicking(null)
            onToggle(null)
          }}
        />
      )}
    </Pressable>
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
 * Six, and then a `+`. This used to say "six, and no picker" -- that a full
 * emoji keyboard was a different screen and a different ticket, and that
 * somebody who wanted a seventh could say it in words. Right about the row,
 * wrong about the ceiling: the account holder asked for what WhatsApp does,
 * which is the quick six and a way to reach the rest.
 *
 * The six do not move. `EmojiPicker.tsx` is what the `+` opens, and
 * `emojiCatalogue.ts` says why that list is written down rather than taken
 * from Unicode.
 */
const OFFERED = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

/** Shared, so a screen with no selection does not build a set per render. */
const EMPTY: ReadonlySet<string> = new Set()

/**
 * Every event a bubble stands for: one for a message, all of them for a
 * plate. A plate is drawn as one thing, so it goes in and out of a selection
 * as one thing -- otherwise the outline covers three photographs and the
 * removal takes one.
 */
function idsOf(
  entry: TimelineEntry,
  plates: ReadonlyMap<string, Grouping>,
): readonly string[] {
  const plate = plates.get(entry.eventId)
  return plate === undefined
    ? [entry.eventId]
    : plate.entries.map(one => one.eventId)
}

function Message({
  entry,
  mine,
  palette,
  tallies,
  onReact,
  read,
  offering,
  selected,
  onOffer,
  onToggle,
  onMore,
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
  /** Whether this bubble is in the selection. */
  selected: boolean
  /** Asks for it to open. Closing is the screen's business: any touch does it. */
  onOffer: () => void
  /**
   * A plain tap, while the screen is selecting. `undefined` otherwise, which
   * is what keeps a tap from stealing the gesture people scroll with.
   */
  onToggle?: () => void
  /** Opens the whole catalogue. See `EmojiPicker.tsx`. */
  onMore: () => void
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
      {/* A LONG PRESS SELECTS; A TAP ONLY DOES SO ONCE SOMETHING IS.
          A tap on a message is what a person does to read it, and stealing
          that gesture outright is how a conversation stops being scrollable
          -- so the plain tap does nothing until a long press has said this
          screen is selecting, and then it adds and removes. */}
      <Pressable
        onLongPress={onOffer}
        onPress={onToggle}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t('reaction_offer')}
        testID={`bubble-${entry.eventId}`}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          selected && styles.bubbleSelected,
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
            // SELECTING WINS OVER OPENING. `Plate`'s own tiles are
            // pressable and take the gesture before the bubble does, so
            // without this a tap on a photograph opened the viewer while
            // the screen was selecting -- the one gesture the mode redefines.
            onOpen={at =>
              onToggle === undefined ? onOpenPlate(plate, at) : onToggle()
            }
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
              // ITALIC, so a removal does not read as words somebody wrote.
              // It is already the muted grey every unreadable line takes,
              // and grey alone would say "this device could not read it" --
              // two different facts sharing one appearance. A slant is a
              // shape rather than a colour, which is what §13 asks of any
              // state that has to be legible without it.
              entry.removed === true && styles.removedBody,
              {
                color:
                  entry.body === null
                    ? palette.neutral['600']
                    : palette.neutral['900'],
              },
            ]}>
            {entry.removed
              ? t('conversation_removed')
              : (entry.body ?? t('conversation_unreadable'))}
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
          {/* THE SEVENTH CHIP IS NOT AN EMOJI. It opens the rest, and it is
              last because the six before it are the ones a thumb reaches
              without looking. */}
          <Pressable
            testID={`offer-${entry.eventId}-more`}
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={t('emoji_more')}
            style={styles.chip}>
            <Text style={styles.chipKey}>{'＋'}</Text>
          </Pressable>
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
  // THE GUTTER IS THE SCREEN'S OWN, like every other screen's.
  //
  // `App.tsx` used to pad every screen by `space.xl`, and this one was
  // living on it -- so when that went (the conversation list came out too
  // narrow with both) the bubbles ended up flush against the glass on both
  // sides. Reported from the emulator with a screenshot: *« les espaces en
  // largeur sont à revoir »*.
  //
  // `bubble`'s own `paddingHorizontal` is the space inside a bubble and
  // never was this: it is why the text did not touch the edge while the
  // bubble did.
  screen: { gap: space.m, paddingHorizontal: layout.screenGutter },
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
  // SELECTED, AND SAID BY MORE THAN A COLOUR. A border rather than a tint:
  // the two bubble grounds are already two colours, so a third would mean
  // one thing on an outgoing message and another on an incoming one. §13
  // wants no state carried by colour alone, and an outline is a shape.
  removedBody: { fontStyle: 'italic' },
  bubbleSelected: {
    borderWidth: stroke.accent,
    borderColor: color.brand.green700,
  },
  bubbleMine: { borderBottomRightRadius: radius.bubbleAuthorCorner },
  bubbleTheirs: { borderBottomLeftRadius: radius.bubbleAuthorCorner },
  body: typeScale.body,
  note: typeScale.caption,
})
