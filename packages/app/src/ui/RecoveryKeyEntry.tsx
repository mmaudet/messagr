import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { t } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * Where somebody types the key they were shown once.
 *
 * # THREE REFUSALS, NOT ONE
 *
 * `restoreFromKey` answers `not-a-key`, `wrong-key` or `failed`, and this
 * screen says three different things because they ask for three different
 * actions.
 *
 * `not-a-key` is a copying accident: half a line, a trailing space, the
 * wrong clipboard. The sentence sends somebody back to what they pasted.
 *
 * `wrong-key` is the right SHAPE and the wrong key — most often another
 * account's. Telling that person to check their paste would send them round
 * a loop they cannot leave, because the thing they pasted is exactly what
 * they meant to paste.
 *
 * `failed` is the network, and it is the only one where trying again
 * unchanged is the right move.
 *
 * Collapsing them into « Clé invalide » would be one line of code less and
 * would strand the second person entirely.
 *
 * # THE FIELD DOES NOT AUTOCORRECT, AUTOCAPITALISE, OR SPELL-CHECK
 *
 * A recovery key is base58 and a keyboard that helpfully capitalises its
 * first letter produces a key that does not open anything, with nothing on
 * screen to say why. This is the one field in the application where the
 * platform's helpfulness is the defect.
 *
 * # WHAT IS NOT HERE
 *
 * No "show characters" toggle. The key is already on screen as typed --
 * this is not a password field, because a password is a secret being checked
 * and this is a secret being carried. Masking it would only make a copying
 * mistake harder to see, which is the failure this screen exists to catch.
 */
type Refusal = 'not-a-key' | 'wrong-key' | 'failed'

const REFUSAL_COPY = {
  'not-a-key': 'restore_key_not_a_key',
  'wrong-key': 'restore_key_wrong',
  failed: 'restore_key_failed',
} as const

export function RecoveryKeyEntry({
  onSubmit,
  onCancel,
}: {
  /** Answers the refusal, or nothing when the past came back. */
  readonly onSubmit: (key: string) => Promise<Refusal | null>
  readonly onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const [refused, setRefused] = useState<Refusal | null>(null)

  const confirm = () => {
    const key = draft.trim()
    if (key === '' || working) return
    setWorking(true)
    setRefused(null)
    onSubmit(key)
      .then(refusal => {
        setRefused(refusal)
        setWorking(false)
      })
      .catch(() => {
        setRefused('failed')
        setWorking(false)
      })
  }

  return (
    <View style={styles.screen} testID="restore-key-entry">
      <Text style={styles.title}>{t('restore_key_title')}</Text>
      <Text style={styles.lead}>{t('restore_key_lead')}</Text>

      <TextInput
        testID="restore-key-field"
        value={draft}
        onChangeText={setDraft}
        placeholder={t('restore_key_field')}
        placeholderTextColor={color.neutral['400']}
        style={styles.field}
        autoFocus
        // See the note above: every one of these is off on purpose.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        multiline
        onSubmitEditing={confirm}
        returnKeyType="done"
      />

      {refused !== null && (
        <View style={styles.refusal} testID={`restore-key-${refused}`}>
          <Text style={styles.refusalText}>{t(REFUSAL_COPY[refused])}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <NotchedButton
          testID="restore-key-confirm"
          label={working ? t('restore_key_working') : t('restore_key_confirm')}
          onPress={confirm}
          wide
        />
        <NotchedButton
          testID="restore-key-cancel"
          label={t('restore_key_cancel')}
          onPress={onCancel}
          tone="quiet"
          wide
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
    gap: space.m,
  },
  title: { ...type.titleLg, color: color.neutral['900'] },
  lead: { ...type.body, color: color.neutral['600'] },
  field: {
    ...type.body,
    color: color.neutral['900'],
    // The same field `GiveName.tsx` draws, because it is the same gesture --
    // typing something the application will keep. `radius.field` does not
    // exist and inventing one is what invariant 11 refuses.
    backgroundColor: color.surface.raised,
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
    borderRadius: radius.bubble,
    padding: space.m,
    minHeight: floors.touchTargetMin * 2,
  },
  // Ochre and not red: a key that does not open is not a fault, and the
  // person holding it is the one this product is trying to help.
  refusal: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  refusalText: { ...type.bodySm, color: color.neutral['900'] },
  actions: { marginTop: space.m, gap: space.s },
})
