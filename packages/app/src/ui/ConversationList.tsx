import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { ConversationSummary } from '../runtime/conversationList'
import { displayNameFor } from '../runtime/givenName'
import { stampFor, type Stamp } from '../timeline/whenShown'
import { Avatar } from './Avatar'

/**
 * The list of conversations.
 *
 * Neither the prototype nor this application had this screen: the prototype
 * draws a conversation list only in the desktop window, and every mobile
 * screen it draws is standalone with its own header. So this is designed
 * against `design/tokens.json` and the eleven interface invariants of
 * `product-spec.md` §13.19, and what is built here goes to the designer for
 * the next export rather than being drawn twice.
 *
 * Three invariants shaped it, and it is worth saying which so that a later
 * reader does not "improve" it back:
 *
 * - **No padlock on a row** (§13.19.2). Encryption is restated only where it
 *   adds information. Every conversation here is encrypted, so a badge saying
 *   so on each row says nothing and trains a person to ignore it where it
 *   would matter.
 * - **No green** (§13.19.3). Green is the signal for a verified human. Using
 *   it as a list accent would spend the one colour the product reserves for
 *   an answer nobody asked here.
 * - **Natural language for what went wrong** (§13.19.6). A row that could not
 *   be read says so in a sentence. The technical reason goes to the log,
 *   which is where somebody debugging looks and where nobody else does.
 */

export interface ConversationListProps {
  readonly summaries: readonly ConversationSummary[]
  /** Given names, keyed by participant. Absent means not named yet. */
  readonly names: ReadonlyMap<string, string>
  readonly onOpen: (scope: string) => void
  /**
   * The clock, injectable. A list reading `Date.now()` inside itself is one
   * nothing can screenshot twice and get the same answer from.
   */
  readonly now?: number
}

export function ConversationList({
  summaries,
  names,
  onOpen,
  now = Date.now(),
}: ConversationListProps) {
  return (
    <View style={styles.screen} testID="conversation-list">
      <Text style={styles.title}>{t('list_title')}</Text>
      {/* Plain rows rather than a `FlatList`, because this sits inside the
          screen's own scroll view. A list that scrolls inside something that
          scrolls is the defect that reports as "the list will not move", and
          the number of conversations a person has does not need
          virtualisation -- `conversationList.ts` says the same thing about
          its own round trips, and the day either is wrong they are wrong
          together. */}
      {summaries.length === 0 ? (
        <Empty />
      ) : (
        summaries.map((summary, index) => (
          <View key={summary.scope}>
            {index > 0 && <Separator />}
            <Row
              summary={summary}
              name={
                summary.other === null ? undefined : names.get(summary.other)
              }
              onOpen={onOpen}
              now={now}
            />
          </View>
        ))
      )}

      {/* What the product is, in one sentence, under the list. The mockup
          suffixes it with a specification reference; that reference is for a
          reviewer and not for somebody reading their own screen. */}
      <Text style={styles.noDirectory}>{t('list_no_directory')}</Text>
    </View>
  )
}

/**
 * The four forms a timestamp takes, put into words.
 *
 * Which form is `whenShown.ts` and is tested there; this is only the wording,
 * which stays with every other string. Minutes are padded here rather than in
 * a copy template, because two digits is not a question of language while the
 * separator between them is.
 */
function whenLabel(stamp: Stamp): string {
  switch (stamp.kind) {
    case 'time':
      return t(
        'when_time %1$d %2$d',
        stamp.hours,
        String(stamp.minutes).padStart(2, '0'),
      )
    case 'yesterday':
      return t('yesterday')
    case 'weekday':
      return t(`day_short_${stamp.day}` as CopyKey)
    case 'date':
      return t('when_date %1$d %2$d', stamp.day, stamp.month)
  }
}

function Row({
  summary,
  name,
  onOpen,
  now,
}: {
  readonly summary: ConversationSummary
  readonly name: string | undefined
  readonly onOpen: (scope: string) => void
  /** Passed in rather than read here, so a row is a pure function of it. */
  readonly now: number
}) {
  // A CONVERSATION WITH NO SINGLE OTHER PARTICIPANT STILL NEEDS A LINE.
  //
  // `displayNameFor` names a participant, and there is no one participant to
  // name here: a conversation of more than two is a channel, which this lot
  // does not build. Watched on a device before it was caught -- a bench room
  // of three rendered a row whose first line was empty, which is not "legible
  // anyway", it is invisible. So the row falls back to the conversation's own
  // identifier, in the same mono role an unnamed participant gets, because
  // that is what it is: an identifier standing in for a name nobody has
  // given yet.
  const shown =
    summary.other === null ? summary.scope : displayNameFor(summary.other, name)
  const named = summary.other !== null && name !== undefined
  return (
    <Pressable
      testID={`conversation-row-${summary.scope}`}
      onPress={() => onOpen(summary.scope)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={shown}>
      {/* An identifier is set in the mono role, a name is not. That is the
          one thing distinguishing "somebody I named" from "somebody I have
          not", and it is a typographic answer rather than a badge -- a badge
          would be a second thing on the row saying what the first already
          says. */}
      <Avatar shown={shown} testID={`avatar-${summary.scope}`} />
      <View style={styles.said}>
        <Text numberOfLines={1} style={named ? styles.name : styles.identifier}>
          {shown}
        </Text>
        <Text numberOfLines={1} style={styles.preview}>
          {previewOf(summary)}
        </Text>
      </View>
      {/* Nothing at all for a conversation that has never moved: `0` is not a
          time, and drawing one would put 01/01/1970 on the row of somebody
          who has just been invited. */}
      {summary.lastAt > 0 && (
        <Text style={styles.when} testID={`when-${summary.scope}`}>
          {whenLabel(stampFor(summary.lastAt, now))}
        </Text>
      )}
    </Pressable>
  )
}

/**
 * What the second line says.
 *
 * Three different silences, and they are not the same: nothing was ever said,
 * something was said this device cannot read, and the conversation could not
 * be reached at all. A single "…" for all three would hide the only one worth
 * acting on.
 */
function previewOf(summary: ConversationSummary): string {
  if (summary.preview !== null) return summary.preview
  if (summary.reason === 'nothing has been said yet') {
    return t('list_nothing_said')
  }
  return summary.lastAt === 0 ? t('list_unreachable') : t('list_unreadable')
}

function Separator() {
  return <View style={styles.separator} />
}

function Empty() {
  return <Text style={styles.empty}>{t('list_empty')}</Text>
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.xl,
    paddingBottom: space.l,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    // The floor is geometry rather than a token, which is why it is asserted
    // here: no provenance rule can reach a touch target's height.
    minHeight: floors.touchTargetMin,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.m,
  },
  said: { flex: 1, gap: space.xs },
  when: {
    ...type.caption,
    color: color.neutral['600'],
  },
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  identifier: {
    ...type.monoId,
    color: color.neutral['900'],
  },
  preview: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  separator: {
    height: stroke.hairline.value,
    marginHorizontal: layout.screenGutter,
    backgroundColor: color.neutral['200'],
  },
  noDirectory: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.xl,
  },
  empty: {
    ...type.body,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.l,
  },
})
