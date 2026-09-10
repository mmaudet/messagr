import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { CallOutcome, CallRecord } from '../runtime/callLogStore'
import { t, type CopyKey } from '../copy'
import { color, floors, space, stroke, type } from '../design/tokens'
import { stampFor, type Stamp } from '../timeline/whenShown'
import { Avatar } from './Avatar'
import { TabIcon } from './TabIcon'

/**
 * Recent calls.
 *
 * # WHAT THIS SCREEN IS FOR, AND WHAT IT REFUSES TO BE
 *
 * Asked for in the shape of WhatsApp's: a list of who called, which way, and
 * when. That is what it is. What it is not is a directory -- there is no
 * "Appeler", no keypad and no favourites beside it, because §7.6 has no
 * address book to draw them from and a keypad in a product with no telephone
 * numbers would be a control that cannot work.
 *
 * A row is therefore a fact about a conversation somebody already has, and
 * pressing it opens that conversation rather than placing a call. Ringing
 * that person again is the button beside it -- see `onCall`, which says why
 * this screen, unlike the conversation list, carries one at all.
 *
 * # THE ARROW CARRIES THE MEANING, AND THE COLOUR ONLY REPEATS IT
 *
 * A missed call is the row somebody is looking for, and it is red in every
 * telephone ever made. It is also the one that must not depend on colour:
 * the direction glyph and the words underneath say it without it, which is
 * the rule §13 states for every state in this product.
 */

/** What a row says under the name. */
function outcomeLabel(record: CallRecord): CopyKey {
  switch (record.outcome) {
    case 'answered':
      return record.direction === 'in' ? 'calls_taken' : 'calls_placed'
    case 'missed':
      return record.direction === 'in' ? 'calls_missed' : 'calls_no_answer'
    case 'declined':
      return record.direction === 'in' ? 'calls_you_declined' : 'calls_declined'
    case 'unplaced':
      return 'calls_unplaced'
  }
}

/** The one outcome a person scans the list for. */
function isMissed(outcome: CallOutcome, direction: string): boolean {
  return outcome === 'missed' && direction === 'in'
}

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

export function CallsList({
  calls,
  shownFor,
  now,
  onOpen,
  onCall,
}: {
  readonly calls: readonly CallRecord[]
  /** The name or the identifier, exactly as every other screen shows them. */
  readonly shownFor: (peerUserId: string) => string
  readonly now: number
  /** Opens the conversation. The row itself is not a call. */
  readonly onOpen: (scope: string) => void
  /**
   * Rings that person back.
   *
   * ADDED AFTER THE FIRST REAL CALLS. This screen said a row opens the
   * conversation and that calling belongs to its header, one tap further,
   * "where the person can see who they are about to ring". That reasoning
   * holds for a list of conversations and not for a list of CALLS: somebody
   * on this screen is already looking at who they called and when, so the
   * second tap adds nothing except the chance to give up.
   *
   * It is its own target rather than the row's, because the two gestures
   * mean different things: reading what happened, and starting it again.
   */
  readonly onCall: (scope: string, peerUserId: string) => void
}) {
  if (calls.length === 0) {
    return (
      <View style={styles.empty} testID="calls-empty">
        <Text style={styles.emptyText}>{t('calls_empty')}</Text>
      </View>
    )
  }

  return (
    <View testID="calls-list">
      {calls.map(call => {
        const shown = shownFor(call.peerUserId)
        const missed = isMissed(call.outcome, call.direction)
        return (
          <View key={`${call.scope}-${call.at}`} style={styles.line}>
            <Pressable
              testID={`call-${call.at}`}
              onPress={() => onOpen(call.scope)}
              accessibilityRole="button"
              // The whole row said aloud, in the order it reads: who, what
              // became of the call, when. A screen reader must not have to
              // piece three labels together.
              accessibilityLabel={`${shown}. ${t(outcomeLabel(call))}. ${whenLabel(
                stampFor(call.at, now),
              )}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Avatar shown={shown} />
              <View style={styles.said}>
                <Text
                  numberOfLines={1}
                  style={[styles.name, missed && styles.missedName]}>
                  {shown}
                </Text>
                <View style={styles.what}>
                  {/* THE GLYPH SAYS WHICH KIND and the words say what became
                      of it. A camera rather than a handset when a picture
                      went through -- §13 wants no state carried by colour
                      alone, and a different shape is not a colour. */}
                  <TabIcon
                    glyph={call.video === true ? 'cam' : 'calls'}
                    tint={missed ? color.deny['500'] : color.neutral['400']}
                    size={14}
                  />
                  <Text style={styles.outcome}>
                    {call.video === true
                      ? `${t('calls_video')} · ${t(outcomeLabel(call))}`
                      : t(outcomeLabel(call))}
                  </Text>
                </View>
              </View>
              <Text style={styles.when}>
                {whenLabel(stampFor(call.at, now))}
              </Text>
            </Pressable>
            <Pressable
              testID={`call-back-${call.at}`}
              onPress={() => onCall(call.scope, call.peerUserId)}
              accessibilityRole="button"
              accessibilityLabel={t('calls_ring_back %@', shown)}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
              <TabIcon glyph="calls" tint={color.brand.green700} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  // The row and the call button sit side by side and are two targets: one
  // reads what happened, the other starts it again.
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: stroke.hairline.value,
    borderBottomColor: color.neutral['200'],
  },
  back: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    minHeight: floors.touchTargetMin,
  },
  pressed: { backgroundColor: color.neutral['200'] },
  // The name and what became of the call are one thing said in two lines,
  // so they sit at the smallest gap the scale has rather than at a value
  // invented here.
  said: { flex: 1, gap: space.xs },
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  // Colour REPEATS the words, it never carries them: the label underneath
  // says "appel manqué" whether or not anybody can see the red.
  missedName: { color: color.deny['700'] },
  what: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  outcome: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  when: {
    ...type.caption,
    color: color.neutral['400'],
  },
  empty: { paddingVertical: space.xl },
  emptyText: {
    ...type.body,
    color: color.neutral['600'],
  },
})
