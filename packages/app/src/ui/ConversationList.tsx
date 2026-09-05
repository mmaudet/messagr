import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { ConversationSummary } from '../runtime/conversationList'
import { displayNameFor } from '../runtime/givenName'

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
}

export function ConversationList({
  summaries,
  names,
  onOpen,
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
            />
          </View>
        ))
      )}
    </View>
  )
}

function Row({
  summary,
  name,
  onOpen,
}: {
  readonly summary: ConversationSummary
  readonly name: string | undefined
  readonly onOpen: (scope: string) => void
}) {
  const shown = displayNameFor(summary.other, name)
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
      <Text
        numberOfLines={1}
        style={name === undefined ? styles.identifier : styles.name}>
        {shown}
      </Text>
      <Text numberOfLines={1} style={styles.preview}>
        {previewOf(summary)}
      </Text>
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
    // The floor is geometry rather than a token, which is why it is asserted
    // here: no provenance rule can reach a touch target's height.
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.m,
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
  empty: {
    ...type.body,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.l,
  },
})
