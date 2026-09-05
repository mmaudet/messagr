import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { t } from '../copy'
import { color, floors, radius, space, stroke, type } from '../design/tokens'
import { displayNameFor, normaliseGivenName } from '../runtime/givenName'

/**
 * Naming the person you are talking to.
 *
 * Offered from inside the conversation rather than from the list, and that is
 * the ticket's own ordering: the list is where you read a name, the
 * conversation is where you know whose it is. A rename reachable only by
 * long-pressing a row is a rename nobody finds.
 *
 * # What the hint says, and why it is not decoration
 *
 * "Ce nom reste sur cet appareil" is the whole of ADR-0010 in one line. A
 * person typing a real name into a pseudonymous messenger is entitled to know
 * where it goes before they type it, not after — so the sentence sits above
 * the field rather than under it.
 */
export interface GiveNameProps {
  /** Who is being named. `null` when this conversation has no single other. */
  readonly participant: string | null
  /** The name already held, if any. */
  readonly given: string | undefined
  /** `false` when the name could not be kept. */
  readonly onName: (participant: string, name: string) => Promise<boolean>
}

export function GiveName({ participant, given, onName }: GiveNameProps) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState(false)

  // Nobody to name. A conversation of more than two has no single other
  // participant, and naming "the conversation" is a different idea that
  // belongs to channels rather than here.
  if (participant === null) return null

  if (!typing) {
    return (
      <View style={styles.resting}>
        <Text style={given === undefined ? styles.identifier : styles.name}>
          {displayNameFor(participant, given)}
        </Text>
        <Pressable
          testID="give-name"
          onPress={() => {
            setDraft(given ?? '')
            setFailed(false)
            setTyping(true)
          }}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t('list_name_action')}>
          <Text style={styles.actionLabel}>{t('list_name_action')}</Text>
        </Pressable>
        {failed && <Text style={styles.failed}>{t('list_name_not_kept')}</Text>}
      </View>
    )
  }

  const confirm = () => {
    const name = normaliseGivenName(draft)
    // Nothing typed is not a failure and not a name: it closes.
    if (name === null) {
      setTyping(false)
      return
    }
    onName(participant, name)
      .then(kept => {
        setFailed(!kept)
        setTyping(false)
      })
      .catch(() => {
        setFailed(true)
        setTyping(false)
      })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.title}>{t('list_name_title')}</Text>
      <Text style={styles.hint}>{t('list_name_hint')}</Text>
      <TextInput
        testID="give-name-field"
        value={draft}
        onChangeText={setDraft}
        placeholder={t('list_name_placeholder')}
        placeholderTextColor={color.neutral['400']}
        style={styles.field}
        autoFocus
        onSubmitEditing={confirm}
        returnKeyType="done"
      />
      <View style={styles.buttons}>
        <Pressable
          testID="give-name-cancel"
          onPress={() => setTyping(false)}
          style={styles.action}
          accessibilityRole="button">
          <Text style={styles.actionLabel}>{t('list_name_cancel')}</Text>
        </Pressable>
        <Pressable
          testID="give-name-confirm"
          onPress={confirm}
          style={styles.action}
          accessibilityRole="button">
          <Text style={styles.actionLabel}>{t('list_name_confirm')}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  resting: {
    gap: space.s,
    paddingVertical: space.s,
  },
  form: {
    gap: space.s,
    paddingVertical: space.s,
  },
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  identifier: {
    ...type.monoId,
    color: color.neutral['900'],
  },
  title: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  hint: {
    ...type.caption,
    color: color.neutral['600'],
  },
  field: {
    ...type.body,
    color: color.neutral['900'],
    backgroundColor: color.surface.raised,
    borderColor: color.neutral['200'],
    borderWidth: stroke.base,
    borderRadius: radius.bubble,
    minHeight: floors.touchTargetMin,
    paddingHorizontal: space.m,
  },
  buttons: {
    flexDirection: 'row',
    gap: space.l,
  },
  action: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  actionLabel: {
    ...type.bodySm,
    color: color.brand.green700,
  },
  failed: {
    ...type.caption,
    color: color.deny['700'],
  },
})
