import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import {
  color,
  floors,
  icon,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import { statedSize } from './documentSize'
import { TabIcon } from './TabIcon'

/**
 * A document in a conversation: what it is called, what it weighs, and one
 * gesture.
 *
 * # A row, not a tile
 *
 * A photograph IS its content, so `Photograph.tsx` draws it and drops the
 * `body` a sender put there for clients that cannot. A document is the other
 * way round: nothing about a PDF can be shown in a bubble, and the only
 * things that let somebody decide what to do with it are its name and its
 * size. So the row states both, and the name is the sender's own -- see
 * `fileEvent.ts` for why that is the opposite of what a photograph does.
 *
 * # Tapping saves rather than opens
 *
 * ADR-0006 and `keepDocument.ts` carry the whole of that decision. What
 * belongs here is only its consequence for the person: the gesture is the
 * system's own « save as », so nothing lands anywhere they did not choose.
 */
export function Document({
  name,
  size,
  onSave,
  testID,
}: {
  readonly name: string
  /** `null` when the sender stated none, which Matrix allows. */
  readonly size: number | null
  /**
   * Enregistrer, quand l'écran sait le faire.
   *
   * ABSENT NE VEUT PAS DIRE « PAS DE LIGNE ». Une version précédente ne
   * dessinait la rangée que si ce geste existait, et retombait sinon sur le
   * texte : le `body` d'un `m.file` ÉTANT le nom du fichier, un document
   * arrivé sur un écran sans sélecteur s'affichait comme une phrase disant
   * « facture-2026.pdf ». C'est exactement ce que le commentaire d'à côté
   * disait éviter.
   */
  readonly onSave?: () => void
  readonly testID?: string
}) {
  const stated = statedSize(size)

  const inside = (
    <>
      <TabIcon
        glyph="document"
        tint={color.neutral['600']}
        size={icon.size.lg}
      />
      <View style={styles.said}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {name}
        </Text>
        {stated !== null && (
          <Text style={styles.size}>{t(stated.key, stated.amount)}</Text>
        )}
      </View>
    </>
  )

  if (onSave === undefined) {
    return (
      <View testID={testID} style={styles.row}>
        {inside}
      </View>
    )
  }

  return (
    <Pressable
      testID={testID}
      onPress={onSave}
      accessibilityRole="button"
      // The name first, because that is what somebody is deciding about, and
      // the action after it. A label reading « Save » alone would be five
      // identical buttons on a screen with five documents on it.
      accessibilityLabel={`${name}, ${t('selection_keep')}`}
      style={styles.row}>
      {inside}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    minHeight: floors.touchTargetMin,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
  },
  said: {
    flex: 1,
  },
  name: {
    ...type.body,
    color: color.neutral['900'],
  },
  size: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
