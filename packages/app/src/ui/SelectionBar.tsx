import React, { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, radius, space, type } from '../design/tokens'
import { BAR_ORDER, placeActions, type BarAction } from './barActions'
import { BottomSheet } from './BottomSheet'
import { TabIcon, type TabGlyph } from './TabIcon'

/**
 * What replaces the conversation's header while messages are selected.
 *
 * # A MODE, AND IT HAS TO LOOK LIKE ONE
 *
 * Selecting changes what every tap in the conversation means, so the screen
 * has to say so from the top. Taking the whole top is how: the person's name
 * goes, the brand band goes with it, a count arrives, and there is exactly
 * one way out and it is on the left where a back arrow was.
 *
 * BOTH BANDS, not one. The first version replaced the conversation's header
 * and left the application's band above it -- two dark green bars stacked,
 * which read as two applications. Reported from the Pixel with a screenshot:
 * « le bandeau de sélection devrait se substituer au bandeau supérieur
 * Messagr ».
 *
 * # IT IS THE BAND'S CONTENTS, NOT A BAND OF ITS OWN
 *
 * The second version owned its own `SafeAreaView` and `StatusBar`, drawn
 * where `Header` had been unmounted -- so entering the mode tore down the top
 * of the screen and built another one, measuring the inset again and popping
 * the status-bar style back to the platform default for a frame. Reported as
 * « un flash vraiment pas agréable ». `Header` takes children now, and this
 * is what it takes.
 *
 * # ABSENT, NEVER GREYED
 *
 * An action that does not apply to everything selected is not drawn. #192:
 * *« une commande grisée est une commande qu'il faut expliquer »* -- and the
 * alternative, applying an action to the part of a selection it happens to
 * fit, would destroy three messages of five without saying so.
 *
 * # GLYPHS ON THE BAR, AND THEIR WORDS
 *
 * The actions were words while there were three; at five the row broke, and
 * they became glyphs, on the identity's rules (`TabIcon.tsx` tells it). The
 * words did not go: they are what a screen reader says, and what « Plus »
 * lists.
 *
 * # EVERY TARGET AT THE FLOOR, AND « PLUS » FOR WHAT DOES NOT FIT
 *
 * Each action is a target of `floors.touchTargetMin`, whatever its glyph
 * (`icon.$rule`: the glyph's size is never the button's), `space.s` apart,
 * and never less to make them fit. When they do not fit on one line, the
 * least frequent go into « Plus », « Signaler » and « Bloquer
 * l'expéditeur » first (#472), and « Plus » opens them, in words
 * (`barActions.ts` decides, from the room the bar measured).
 */
export function SelectionBar({
  count,
  canCopy: copyable,
  canForward: forwardable,
  canKeep: keepable,
  canFavourite: favouritable,
  canReport: reportable,
  canBlock: blockable,
  alreadyFavourite,
  onClear,
  onCopy,
  onFavourite,
  onForward,
  onKeep,
  onReport,
  onBlock,
  onRemove,
}: {
  readonly count: number
  readonly canCopy: boolean
  readonly canForward: boolean
  /**
   * Whether the selection is one photograph, and so has somewhere to be
   * kept. Words have no gallery to go to.
   */
  readonly canKeep: boolean
  /** Whether the selection is something that could be found again. */
  readonly canFavourite: boolean
  /**
   * Whether the selection is words, photographs or documents of one other
   * participant, which is what a report carries (#468, #471, `reportable`).
   */
  readonly canReport: boolean
  /**
   * Whether every selected message is already kept.
   *
   * The same control does both, and it has to say which it will do: a button
   * reading « Favori » on something already kept is a button whose effect
   * nobody can predict.
   */
  readonly alreadyFavourite: boolean
  /**
   * Whether every message chosen comes from one and the same other
   * participant, whom « Bloquer l’expéditeur » would block (#472,
   * `blockable`).
   */
  readonly canBlock: boolean
  readonly onClear: () => void
  readonly onFavourite: () => void
  readonly onCopy: () => void
  readonly onForward: () => void
  readonly onKeep: () => void
  readonly onReport: () => void
  readonly onBlock: () => void
  readonly onRemove: () => void
}) {
  /** The room the actions have, once the bar has been laid out. */
  const [room, setRoom] = useState<number | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /** What was chosen in « Plus », waiting for its sheet to be gone. */
  const chosenRef = useRef<(() => void) | null>(null)

  const described: Readonly<Record<BarAction, Described>> = {
    copy: {
      testID: 'selection-copy',
      label: t('selection_copy'),
      glyph: 'copy',
      tint: color.surface.paper,
      onPress: onCopy,
    },
    forward: {
      testID: 'selection-forward',
      label: t('selection_forward'),
      glyph: 'forward',
      tint: color.surface.paper,
      onPress: onForward,
    },
    // ONE CONTROL, TWO DIRECTIONS, AND IT SAYS WHICH. A second press takes
    // the mark back, which is what every messenger does and what the ticket
    // asks for. The label follows the selection rather than the gesture:
    // « Favori » on something not kept, « Retirer des favoris » on something
    // that is. FULL AGAINST EMPTY, not one colour against another: §13
    // refuses a state carried by colour alone, and a filled shape is a shape.
    favourite: {
      testID: 'selection-favourite',
      label: alreadyFavourite
        ? t('selection_unfavourite')
        : t('selection_favourite'),
      glyph: alreadyFavourite ? 'star.on' : 'star',
      tint: color.surface.paper,
      onPress: onFavourite,
    },
    // THE ONLY ACTION HERE THAT LEAVES THE PRODUCT. Copy and Forward move a
    // photograph to another place this application still stands behind;
    // this one puts it in the gallery, where the camera's pictures live, and
    // stops standing behind it. `keepPhotograph.ts` says what that costs and
    // ADR-0006 carries the amendment. Offered only on a single photograph: a
    // gallery takes pictures, and a selection with a word in it has none.
    keep: {
      testID: 'selection-keep',
      label: t('selection_keep'),
      glyph: 'save',
      tint: color.surface.paper,
      onPress: onKeep,
    },
    // ONLY ON ONE OTHER PERSON'S MESSAGES (#468, #471): words, photographs
    // and documents, mixed as chosen. A report names one account and carries
    // its messages as read, so a selection mixing two people, holding one of
    // this account's own, or a video or a voice message has no « Signaler »
    // at all. What it opens says what leaves before anything does:
    // `ReportSheet.tsx`.
    report: {
      testID: 'selection-report',
      label: t('selection_report'),
      glyph: 'flag',
      tint: color.surface.paper,
      onPress: onReport,
    },
    // ONLY ON ONE OTHER PERSON'S MESSAGES (#472), whatever they hold: a
    // block names one account, so a selection mixing two people or holding
    // one of this account's own has no « Bloquer l'expéditeur ». In a
    // conversation of more than two it is the only way to block anybody.
    // What it opens is the screen of the panel of the person: `Block.tsx`.
    block: {
      testID: 'selection-block',
      label: t('selection_block'),
      glyph: 'block',
      tint: color.surface.paper,
      onPress: onBlock,
    },
    // ALWAYS THERE, unlike Copy, and always on the bar. Removing has two
    // scopes and the narrower one -- hiding on this telephone -- applies to
    // anything, including somebody else's message; which of the two is
    // offered is the sheet's question (`RemoveSheet.tsx`). The one that
    // keeps its colour: red on a dark green ground is unreadable as text,
    // and as a shape at 1.5 stroke the light red of the palette carries.
    remove: {
      testID: 'selection-remove',
      label: t('selection_remove'),
      glyph: 'bin',
      tint: color.deny['200'],
      onPress: onRemove,
    },
  }
  const offers: Readonly<Record<BarAction, boolean>> = {
    copy: copyable,
    forward: forwardable,
    favourite: favouritable,
    keep: keepable,
    report: reportable,
    block: blockable,
    remove: true,
  }
  const placed =
    room === null
      ? null
      : placeActions(
          BAR_ORDER.filter(action => offers[action]),
          room,
        )
  const more: Described = {
    testID: 'selection-more',
    label: t('selection_more'),
    glyph: 'more',
    tint: color.surface.paper,
    onPress: () => setMoreOpen(true),
  }

  /**
   * An action chosen in « Plus ». Its sheet goes first: a sheet opened while
   * another is still going away is one iOS may not show, so there what the
   * action opens waits for « Plus » to be gone (`BottomSheet`'s
   * `onDismiss`). Android opens it at once.
   */
  const choose = (run: () => void) => {
    setMoreOpen(false)
    if (Platform.OS === 'ios') chosenRef.current = run
    else run()
  }

  return (
    <View style={styles.row} testID="selection-bar">
      <Pressable
        testID="selection-clear"
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={t('selection_clear')}
        style={styles.leave}>
        <Text style={styles.leaveMark}>{'✕'}</Text>
      </Pressable>

      {/* IT WAS `flex: 1` AND IT BROKE. With three actions the count took
          the space left over; with five there is none left, so flex handed
          it a column one character wide and the words fell down the screen
          -- « 1 sé cti on né (s) », measured on a Pixel 10 Pro Fold.

          A bare number now: it is what a person reads anyway, it cannot
          wrap, and the sentence survives where it was doing the work, in
          what a screen reader says. */}
      <Text
        style={styles.count}
        numberOfLines={1}
        accessibilityLabel={t('selection_count %1$d', count)}
        testID="selection-count">
        {String(count)}
      </Text>

      {/* THE ROOM LEFT, MEASURED, and the actions drawn once it is known:
          what fits is decided from it, never guessed. */}
      <View
        style={styles.actions}
        onLayout={event => setRoom(event.nativeEvent.layout.width)}>
        {placed !== null && (
          <>
            {placed.onBar
              .filter(action => action !== 'remove')
              .map(action => (
                <Action key={action} {...described[action]} />
              ))}
            {placed.inMore.length > 0 && <Action {...more} />}
            <Action {...described.remove} />
          </>
        )}
      </View>

      {placed !== null && placed.inMore.length > 0 && (
        <BottomSheet
          testID="selection-more-sheet"
          scrimTestID="selection-more-scrim"
          closeLabel={t('selection_more_close')}
          onClose={() => setMoreOpen(false)}
          visible={moreOpen}
          onDismiss={() => {
            const run = chosenRef.current
            chosenRef.current = null
            run?.()
          }}>
          {placed.inMore.map(action => (
            <Pressable
              key={action}
              testID={described[action].testID}
              onPress={() => choose(described[action].onPress)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.choice,
                pressed && styles.chosen,
              ]}>
              <TabIcon
                glyph={described[action].glyph}
                tint={color.neutral['900']}
              />
              <Text style={styles.choiceLabel}>{described[action].label}</Text>
            </Pressable>
          ))}
        </BottomSheet>
      )}
    </View>
  )
}

/** One action, as the bar draws it and as « Plus » lists it. */
interface Described {
  readonly testID: string
  /** What a screen reader says, and what « Plus » writes. */
  readonly label: string
  readonly glyph: TabGlyph
  /** On the bar's dark ground; « Plus » draws on paper, in the ink. */
  readonly tint: string
  readonly onPress: () => void
}

/** An action on the bar: its glyph, in a target at the touch floor. */
function Action({ testID, label, glyph, tint, onPress }: Described) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <TabIcon glyph={glyph} tint={tint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // No ground and no inset: the band around it has both. See the note above
  // for what happened when this had its own.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: layout.screenGutter,
  },
  leave: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveMark: { ...type.titleMd, color: color.surface.paper },
  // `flexShrink: 0`: the count is the one thing on this row that must never
  // be squeezed, because squeezing text is how it becomes a column.
  count: { ...type.titleMd, color: color.surface.paper, flexShrink: 0 },
  // What is left of the row, which the actions stand in from its right.
  actions: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.s,
  },
  action: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s,
  },
  pressed: { opacity: 0.7 },
  choice: {
    minHeight: floors.touchTargetMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.s,
    borderRadius: radius.bubble,
  },
  chosen: { backgroundColor: color.neutral['200'] },
  choiceLabel: { ...type.body, color: color.neutral['900'] },
})
