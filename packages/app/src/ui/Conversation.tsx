import { useState } from 'react'
import { StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { t } from '../copy'
import {
  color,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { NotchedButton } from './NotchedButton'

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
}

export function Conversation({
  entries,
  selfUserId,
  onSend,
  sending,
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
    <View style={styles.screen}>
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

function Message({
  entry,
  mine,
  palette,
}: {
  entry: TimelineEntry
  mine: boolean
  palette: typeof color | typeof color.dark
}) {
  return (
    <View style={mine ? styles.mine : styles.theirs}>
      {!mine && (
        <Text
          testID={`claimed-${entry.eventId}`}
          style={[styles.claimed, { color: palette.neutral['600'] }]}>
          {t('conversation_sender_claimed %@', entry.claimedSender)}
        </Text>
      )}
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          {
            backgroundColor: mine
              ? palette.brand.green100
              : palette.surface.sunk,
          },
        ]}>
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
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { gap: space.m },
  empty: typeScale.bodySm,
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  claimed: { ...typeScale.caption, marginBottom: space.xs },
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
