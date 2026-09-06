import React, { useState } from 'react'
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { t } from '../copy'
import { color, floors, radius, space, stroke, type } from '../design/tokens'
import { normaliseGivenName } from '../runtime/givenName'
import { NotchedButton } from './NotchedButton'

/**
 * Inviting somebody, which is the same gesture as starting a conversation
 * with them — so there is one button, not two.
 *
 * # The name is typed before there is anybody to give it to
 *
 * The invitation service draws an account at the moment somebody opens the
 * link, so at the moment of inviting there is no participant to name. What is
 * typed here is held and written when the account is drawn, which is the only
 * ordering the protocol allows and also the right one: the inviter knows who
 * they are inviting *now*, and will not come back later to say.
 *
 * # What this screen does not promise
 *
 * It does not say the person has arrived. Handing over a link is where the
 * inviter's part ends; the rest happens without them, and telling them
 * otherwise would be inventing a confirmation nothing waits for.
 */

export type InviteStage =
  | { readonly stage: 'resting' }
  | { readonly stage: 'working' }
  | { readonly stage: 'ready'; readonly link: string }
  | { readonly stage: 'failed'; readonly reason: string }

export interface InviteProps {
  readonly stage: InviteStage
  /** Called with the name to hold for whoever claims the link, or `null`. */
  readonly onInvite: (name: string | null) => void
  readonly onClose: () => void
  /** What became of the far half, once it is known. */
  readonly admission: 'waiting' | 'admitted' | null
}

export function Invite({ stage, onInvite, onClose, admission }: InviteProps) {
  const [draft, setDraft] = useState('')

  if (stage.stage === 'resting') {
    return (
      <View style={styles.resting}>
        <NotchedButton
          label={t('invite_action')}
          testID="invite"
          onPress={() => onInvite(normaliseGivenName(draft))}
        />
        <Text style={styles.who}>{t('invite_who')}</Text>
        <TextInput
          testID="invite-name"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('list_name_placeholder')}
          placeholderTextColor={color.neutral['400']}
          style={styles.field}
        />
        <Text style={styles.hint}>{t('list_name_hint')}</Text>
      </View>
    )
  }

  if (stage.stage === 'working') {
    return (
      <Text testID="invite-working" style={styles.hint}>
        {t('invite_working')}
      </Text>
    )
  }

  if (stage.stage === 'failed') {
    return (
      <View style={styles.resting}>
        <Text testID="invite-failed" style={styles.failed}>
          {t('invite_failed')}
        </Text>
        {/* The reason verbatim, under the sentence rather than instead of it.
            Invariant 6 governs what a person is told; it does not require
            hiding what somebody diagnosing it would need. */}
        <Text style={styles.reason}>{stage.reason}</Text>
        <Pressable
          onPress={onClose}
          style={styles.action}
          testID="invite-close">
          <Text style={styles.actionLabel}>{t('invite_close')}</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.resting}>
      <Text style={styles.hint}>{t('invite_ready')}</Text>
      {/* The link itself, in the mono role and selectable: sharing is the
          ordinary path, and reading it out loud is the one that has to work
          when sharing does not. */}
      <Text testID="invite-link" selectable style={styles.link}>
        {stage.link}
      </Text>
      <NotchedButton
        label={t('invite_share')}
        testID="invite-share"
        onPress={() => {
          // Failure is ordinary here: somebody dismissed the sheet. There is
          // nothing to report and nothing to retry -- the link is on screen.
          Share.share({ message: stage.link }).catch(() => {})
        }}
      />
      {admission !== null && (
        <Text testID="invite-admission" style={styles.hint}>
          {admission === 'admitted'
            ? t('invite_admitted')
            : t('invite_waiting')}
        </Text>
      )}
      <Pressable onPress={onClose} style={styles.action} testID="invite-close">
        <Text style={styles.actionLabel}>{t('invite_close')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  resting: {
    gap: space.m,
    paddingVertical: space.m,
  },
  who: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  hint: {
    ...type.caption,
    color: color.neutral['600'],
  },
  link: {
    ...type.monoId,
    color: color.neutral['900'],
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
  action: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  actionLabel: {
    ...type.bodySm,
    color: color.brand.green700,
  },
  failed: {
    ...type.body,
    color: color.deny['700'],
  },
  reason: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
