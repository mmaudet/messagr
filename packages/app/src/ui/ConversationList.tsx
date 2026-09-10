import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
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
 * - **Green means a human, and it is spent exactly once** (§13.19.3). Not as
 *   a list accent -- the rows, the separators and the timestamps are all
 *   neutral -- but on the unread badge, which marks somebody having spoken to
 *   you. That is the invariant's own claim made about an event rather than
 *   about a person, and it is the only green on the screen apart from the
 *   floating action, which the token calls *« action principale »* outright.
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
   * Whether this launch was opened with an invitation it did not spend,
   * because the device already had an account. See `entry.ts`.
   */
  readonly invitationIgnored?: boolean
  /**
   * Whether this device has no session at all.
   *
   * AN APPLICATION THAT CANNOT DO ANYTHING MUST NOT LOOK AS IF IT CAN. Entry
   * failing left the tab bar, the floating action and this list on screen,
   * all of them inert -- and the empty state said "invite somebody", which is
   * the one thing a person without an account cannot do. The first TestFlight
   * tester read that and reported he could do nothing, which was exactly
   * right.
   */
  readonly notInYet?: boolean
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
  invitationIgnored = false,
  notInYet = false,
  now = Date.now(),
}: ConversationListProps) {
  return (
    <View style={styles.screen} testID="conversation-list">
      {/* AN INVITATION THAT ARRIVED ON A PHONE THAT ALREADY HAS AN ACCOUNT.
          `entry.ts` refuses to spend it, and that refusal is right: an
          invitation must not be able to replace an account somebody already
          has, and leaving the token unspent keeps it working for whoever it
          was meant for.

          What was missing is this line. The application drew this list
          exactly as if the icon had been tapped, so somebody who scanned an
          invitation could not tell whether the code had even been read.
          Reported from a Pixel on 7 September 2026.

          It says the second half too -- that the invitation still works --
          because the first thing anybody fears here is having burnt somebody
          else's link. */}
      {invitationIgnored && (
        <Text style={styles.ignored} testID="list-invitation-ignored">
          {t('list_invitation_ignored')}
        </Text>
      )}
      {/* Plain rows rather than a `FlatList`, because this sits inside the
          screen's own scroll view. A list that scrolls inside something that
          scrolls is the defect that reports as "the list will not move", and
          the number of conversations a person has does not need
          virtualisation -- `conversationList.ts` says the same thing about
          its own round trips, and the day either is wrong they are wrong
          together. */}
      {summaries.length === 0 ? (
        notInYet ? (
          <Text style={styles.empty} testID="list-not-in-yet">
            {t('list_not_in_yet')}
          </Text>
        ) : (
          <Empty />
        )
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
              first={index === 0}
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
  first = false,
}: {
  readonly summary: ConversationSummary
  readonly name: string | undefined
  readonly onOpen: (scope: string) => void
  /** Whether this is the top row. See the identifier below. */
  readonly first?: boolean
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
  // AND NOBODY ELSE IS NOT THE SAME AS SEVERAL PEOPLE, though `other` says
  // `null` to both. A conversation this account is now alone in -- the only
  // other member removed, or gone -- has a true sentence, and printing a raw
  // `!room:server` instead is the diagnostic string on a product screen that
  // §13.27 refuses. Seen on the bench the moment an eviction landed.
  //
  // `others === null` is a third answer again: the membership could not be
  // read. That one keeps the identifier, because nothing truthful is known.
  const shown =
    summary.other !== null
      ? displayNameFor(summary.other, name)
      : summary.others === 0
        ? t('list_nobody_else')
        : summary.scope
  const named = summary.other !== null && name !== undefined
  return (
    <Pressable
      // TWO IDENTIFIERS, AND THE SECOND IS FOR THE SUITE.
      // A row is addressed by its scope, which is what any assertion about a
      // particular conversation needs. Nothing outside this device knows
      // those identifiers in advance, though -- they are minted per
      // invitation -- so the end-to-end suite, which has to open *a*
      // conversation the way a person does, has no name to reach for. The
      // first row gets a stable one.
      testID={
        first ? 'first-conversation' : `conversation-row-${summary.scope}`
      }
      onPress={() => onOpen(summary.scope)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={shown}>
      {/* An identifier is set in the mono role, a name is not. That is the
          one thing distinguishing "somebody I named" from "somebody I have
          not", and it is a typographic answer rather than a badge -- a badge
          would be a second thing on the row saying what the first already
          says. */}
      {/* THE AVATAR TAKES THE IDENTIFIER, NOT THE SENTENCE.
          `initialsOf` gives the first letter of each of the first two words,
          which is right for a name and meaningless for a phrase -- and
          « Personne d'autre ici » reduces to two letters that are a slur in
          French. Seen on the bench the moment the row learnt to say it.

          The scope is what the row is about when no person is, and its
          initial is a mark rather than a word. Both nameless cases go the
          same way: `shown` already is the scope for a conversation of
          three. */}
      <Avatar
        shown={summary.other === null ? summary.scope : shown}
        testID={`avatar-${summary.scope}`}
      />
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
      <View style={styles.tail}>
        {summary.lastAt > 0 && (
          <Text style={styles.when} testID={`when-${summary.scope}`}>
            {whenLabel(stampFor(summary.lastAt, now))}
          </Text>
        )}
        {/* THE ONE GREEN THING ON A ROW, AND IT IS NOT AN EXCEPTION.
            Invariant 3 reserves green for a verified human, and what this
            marks is a human having said something -- which is the same
            claim, made about an event rather than about a person. A grey
            badge would say "a number" where the product means "somebody
            spoke to you". */}
        {summary.unread > 0 && (
          <View
            style={styles.unread}
            testID={`unread-${summary.scope}`}
            accessibilityLabel={t('list_unread %1$d', summary.unread)}>
            <Text style={styles.unreadCount}>{summary.unread}</Text>
          </View>
        )}
      </View>
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
  if (summary.reason === 'the last message was removed') {
    return t('conversation_removed')
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
  // A note, not an alarm: nothing went wrong, and the invitation is intact.
  // `neutral.600` is the role for a line that explains rather than warns.
  ignored: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.s,
  },
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingTop: space.s,
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
  tail: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
  unread: {
    minWidth: space.l,
    height: space.l,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    backgroundColor: color.brand.green500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    ...type.monoLabel,
    color: color.brand.ink900,
  },
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
