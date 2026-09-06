import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'

import { t } from '../copy'
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
}: ConversationProps) {
  const [draft, setDraft] = useState('')
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

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
          <Message
            key={entry.eventId}
            entry={entry}
            mine={entry.claimedSender === selfUserId}
            palette={palette}
            tallies={reactions.get(entry.eventId) ?? []}
            read={read.has(entry.eventId)}
            onReact={(key, own) => onReact?.(entry.eventId, key, own)}
            onLoadImage={onLoadImage}
          />
        ))
      )}

      <View style={styles.composer}>
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
        {onAttach !== undefined && (
          // Beside the field rather than in a menu behind it. Sending a
          // photograph is one of the two things a person does in a
          // conversation, and the other one has a button.
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

      {/* SENT, OR READ. There is no third state, and inventing one would be
          a guess drawn as a fact -- Matrix reports the homeserver accepting
          an event and somebody's client saying it was read, and nothing in
          between. See receipts.ts.

          Only on this account's own messages: "read" on somebody else's says
          that you read it, which they can see for themselves. */}
      {mine && (
        <Text
          testID={`state-${entry.eventId}`}
          style={[styles.state, { color: palette.neutral['600'] }]}>
          {read ? t('message_read') : t('message_sent')}
        </Text>
      )}

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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
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
    borderRadius: radius.bubble,
    maxWidth: '80%',
  },
  // The author's own corner is squared off. It is in the token file as
  // `bubbleAuthorCorner`, and it is the one asymmetry that says which side
  // wrote a message without colour having to carry it alone.
  bubbleMine: { borderBottomRightRadius: radius.bubbleAuthorCorner },
  bubbleTheirs: { borderBottomLeftRadius: radius.bubbleAuthorCorner },
  body: typeScale.body,
  note: typeScale.caption,
  composer: { gap: space.s, marginTop: space.m },
  input: {
    ...typeScale.body,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
  },
})
