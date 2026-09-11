import React from 'react'
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { t } from '../copy'
import { color, space, stroke, type } from '../design/tokens'

/**
 * What a gesture that cannot be undone does, said before it is done.
 *
 * # Where this shape comes from
 *
 * The prototype draws exactly one screen of this kind -- *« Effacer mon
 * identité »* -- and it is the product's own precedent for an irreversible
 * gesture. Its structure is the substance of it: a heading that states the
 * truth as a pair rather than as a warning (*« Ce qui disparaît, ce qui
 * reste »*), a lead that says what the list is for (*« Voici la vérité
 * complète, avant de décider »*), then the consequences one to a row, and
 * last a plate that says the word *« Irréversible »* and what exactly cannot
 * be undone.
 *
 * #87: vouching and eviction were built as a two-step panel with the copy
 * written beside it -- *« leur forme est inventée plutôt que dessinée »*.
 * This is the drawn form, and both gestures take it.
 *
 * # Why a card with a left stroke rather than the prototype's marker
 *
 * The prototype puts a nine-pixel clipped square beside each fact. React
 * Native has no `clip-path`, and a redrawn approximation would be this
 * repository's hand in an identity that has a voice. `Trust.tsx` -- screen
 * 25, drawn -- already carries the product's answer for "a fact with a
 * tone": a tinted ground with an accent stroke down its left edge. Two
 * idioms for one meaning would be the drift; this is the one that exists.
 *
 * # The colours, and the one that is missing
 *
 * `brand.green` is not here and cannot be. Invariant 3 reserves it for a
 * confirmed human and for the principal action of a screen, and the
 * prototype spends it exactly once per screen. A consequence is neither, so
 * the three tones are the ordinary neutral, the ochre of something weighed,
 * and the red of a measure -- `deny` in the token's own words is *« action
 * de mesure. Jamais un avertissement »*, which is what putting somebody out
 * of a conversation is.
 */

/** How a consequence reads, not how loud it is. */
export type ConsequenceTone =
  /** Simply true. Nothing is wrong and nothing is being weighed. */
  | 'plain'
  /** Something to weigh before deciding. */
  | 'weigh'
  /** A measure being taken against somebody. */
  | 'measure'

export interface Consequence {
  readonly tone: ConsequenceTone
  /** Four or five words. What the row is, scanned rather than read. */
  readonly said: string
  /** The sentence itself, which is the part that has to be true. */
  readonly body: string
  readonly testID?: string
}

export function Consequences({
  title,
  lead,
  facts,
  finally: finalWord,
  target,
  testID,
  children,
}: {
  readonly title: string
  readonly lead: string
  readonly facts: readonly Consequence[]
  /**
   * What exactly cannot be undone.
   *
   * Named `finally` at the call site because that is what it is: the last
   * sentence, and the one somebody has to have read before the button below
   * means anything. Renamed on the way in, since `finally` is a keyword.
   */
  readonly finally: string
  /**
   * Who the gesture is about, as an identifier.
   *
   * Optional, and that is a widening rather than a convenience. Both first
   * callers -- vouching and eviction -- are about a person, and this
   * component was shaped as though every irreversible gesture were. Then
   * came replacing a recovery key, which is about nobody: naming the account
   * or the device would answer a question the screen is not asking, and a
   * line that says the obvious is a line somebody learns to skip.
   */
  readonly target?: string
  readonly testID: string
  /** The actions. Passed in because only the caller knows what they say. */
  readonly children: React.ReactNode
}) {
  return (
    <View testID={testID} style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.lead}>{lead}</Text>

      <View style={styles.facts}>
        {facts.map(fact => (
          <View
            key={fact.said}
            testID={fact.testID}
            style={[styles.card, TONES[fact.tone]]}>
            <Text style={styles.said}>{fact.said}</Text>
            <Text style={styles.body}>{fact.body}</Text>
          </View>
        ))}
      </View>

      {/* THE WORD, THEN WHAT IT IS ABOUT. The prototype prints « Irréversible »
          as a label above the sentence rather than folding it into one -- a
          person scanning the screen has to be able to find it without
          reading, and a sentence that merely happens to contain the word is
          not findable. */}
      <View style={[styles.card, styles.measure]}>
        <Text style={styles.irreversible}>{t('consequence_irreversible')}</Text>
        <Text testID={`${testID}-final`} style={styles.finalBody}>
          {finalWord}
        </Text>
      </View>

      {target !== undefined && <Text style={styles.target}>{target}</Text>}

      {/* THE REFUSAL IS A BUTTON OF THE SAME RANK, which is the caller's to
          honour and is written here because this is where both callers can
          read it. The prototype states it on its verification screen and it
          applies with more force to a gesture nothing takes back: « Le refus
          est un bouton de même rang que l'acceptation. » */}
      <View style={styles.actions}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    gap: space.m,
    marginTop: space.m,
  },
  title: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  lead: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  // A hairline of ground between the cards rather than a gap, which is what
  // the prototype draws: the list reads as one object with divisions, not as
  // several plates that happen to be near each other.
  facts: {
    gap: stroke.base,
  },
  card: {
    padding: space.m,
    gap: space.xs,
    borderLeftWidth: stroke.accent,
  },
  plain: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  weigh: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  measure: {
    backgroundColor: color.deny['100'],
    borderLeftColor: color.deny['500'],
  },
  said: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  body: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  irreversible: {
    ...type.monoLabel,
    color: color.deny['500'],
  },
  finalBody: {
    ...type.bodySm,
    color: color.deny['700'],
  },
  target: {
    ...type.monoId,
    color: color.neutral['600'],
  },
  actions: {
    gap: space.s,
  },
})

const TONES: Record<ConsequenceTone, StyleProp<ViewStyle>> = {
  plain: styles.plain,
  weigh: styles.weigh,
  measure: styles.measure,
}
