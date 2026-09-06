import React, { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'

import { t, type CopyKey } from '../copy'
import {
  color,
  floors,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadImage } from '../timeline/imageEvent'
import { separatorsFor, type DayMark } from '../timeline/daySeparators'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { ReactionTally } from '../timeline/reactions'
import { NotchedButton } from './NotchedButton'
import { Photograph } from './Photograph'

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
  readonly onSend: (body: string) => void
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
  /**
   * Choosing a photograph and sending it. Absent on a build with no picker,
   * and the control is absent with it — a button that opens nothing is the
   * inert control §13.18 refuses.
   */
  readonly onAttach?: () => void
  /** Downloads and decrypts a photograph. Absent means none are drawn. */
  readonly onLoadImage?: (image: ReadImage) => Promise<ShownImage>
  /**
   * The clock, injectable, for the same reason `ConversationList` takes one:
   * a screen reading `Date.now()` inside itself is one nothing can screenshot
   * twice and get the same answer from.
   */
  readonly now?: number
}

export function Conversation({
  entries,
  selfUserId,
  onSend,
  sending,
  reactions = new Map(),
  read = new Set(),
  onReact,
  onAttach,
  onLoadImage,
  now = Date.now(),
}: ConversationProps) {
  const [draft, setDraft] = useState('')
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color
  // Which entries open a new day. Computed once per render rather than per
  // message: a separator is a property of the sequence, not of an entry.
  const days = separatorsFor(entries, now)

  function send() {
    const body = draft.trim()
    if (body === '') return
    setDraft('')
    onSend(body)
  }

  return (
    <View testID="conversation" style={styles.screen}>
      {entries.length === 0 ? (
        <Text
          testID="conversation-empty"
          style={[styles.empty, { color: palette.neutral['600'] }]}>
          {t('conversation_empty')}
        </Text>
      ) : (
        entries.map(entry => (
          <React.Fragment key={entry.eventId}>
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
            <Message
              entry={entry}
              mine={entry.claimedSender === selfUserId}
              palette={palette}
              tallies={reactions.get(entry.eventId) ?? []}
              read={read.has(entry.eventId)}
              onReact={(key, own) => onReact?.(entry.eventId, key, own)}
              onLoadImage={onLoadImage}
            />
          </React.Fragment>
        ))
      )}

      {/* ONE ROW, NOT A STACK. Screen 21 asks for a full input bar, and what
          was here was a field with two full-width buttons under it -- which
          reads as a form rather than as a place to type. The attachment sits
          before the field and sending after it, which is the order every
          messenger somebody has already used puts them in. */}
      <View style={styles.composer}>
        {onAttach !== undefined && (
          <Pressable
            testID="conversation-attach"
            onPress={onAttach}
            accessibilityRole="button"
            accessibilityLabel={t('conversation_attach')}
            style={styles.attach}>
            <Text
              style={[styles.attachSign, { color: palette.brand.green700 }]}>
              +
            </Text>
          </Pressable>
        )}
        <TextInput
          testID="conversation-input"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder={t('message_placeholder')}
          placeholderTextColor={palette.neutral['400']}
          style={[
            styles.input,
            {
              color: palette.neutral['900'],
              backgroundColor: palette.surface.raised,
              borderColor: palette.neutral['300'],
            },
          ]}
        />
        <NotchedButton
          label={t('conversation_send')}
          testID="conversation-send"
          onPress={send}
        />
      </View>

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
  onLoadImage,
}: {
  entry: TimelineEntry
  mine: boolean
  palette: typeof color | typeof color.dark
  tallies: readonly ReactionTally[]
  /** Whether somebody else has read this one. Only meaningful for `mine`. */
  read: boolean
  /** `mine` is the id of this account's own reaction, when it has one. */
  onReact: (key: string, mine: string | null) => void
  readonly onLoadImage?: (image: ReadImage) => Promise<ShownImage>
}) {
  const [offering, setOffering] = useState(false)

  return (
    <View style={mine ? styles.mine : styles.theirs}>
      {!mine && (
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
        onLongPress={() => setOffering(held => !held)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={t('reaction_offer')}
        testID={`bubble-${entry.eventId}`}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          {
            backgroundColor: mine
              ? palette.brand.green100
              : palette.surface.sunk,
          },
        ]}>
        {entry.image !== undefined && onLoadImage !== undefined ? (
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

      {offering && (
        <View style={styles.offered} testID={`offer-${entry.eventId}`}>
          {OFFERED.map(key => (
            <Pressable
              key={key}
              testID={`offer-${entry.eventId}-${key}`}
              onPress={() => {
                setOffering(false)
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

      {tallies.length > 0 && (
        <View style={styles.tallies} testID={`reactions-${entry.eventId}`}>
          {tallies.map(tally => (
            <Pressable
              key={tally.key}
              testID={`reaction-${entry.eventId}-${tally.key}`}
              onPress={() => onReact(tally.key, tally.mine)}
              accessibilityRole="button"
              accessibilityLabel={`${tally.key} ${tally.count}`}
              style={[
                styles.chip,
                {
                  // Green only where this account is among them: it is the
                  // one place on a chip where the brand colour carries
                  // information rather than decorating.
                  backgroundColor:
                    tally.mine !== null
                      ? palette.brand.green100
                      : palette.surface.sunk,
                },
              ]}>
              <Text
                style={styles.chipKey}>{`${tally.key} ${tally.count}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
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
    marginTop: space.xs,
  },
  chip: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: space.s,
    borderRadius: radius.pill,
  },
  chipKey: typeScale.bodySm,
  attach: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachSign: {
    ...typeScale.titleLg,
    // The same correction the floating action needs, and the same reason not
    // to make it by rewriting the ramp: see `FloatingAction.tsx`.
    includeFontPadding: false,
    textAlign: 'center',
  },
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
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    marginTop: space.m,
  },
  input: {
    flex: 1,
    ...typeScale.body,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
  },
})
