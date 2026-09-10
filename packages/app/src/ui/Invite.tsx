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
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'
import { normaliseGivenName } from '../runtime/givenName'
import { NotchedButton } from './NotchedButton'
import { QrCode } from './QrCode'

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
 *
 * # `shut` is a state and not the absence of one
 *
 * Inviting is reached from the floating action now, not from a button under
 * the list (`FloatingAction.tsx` says why). So the resting form is something
 * a gesture opens rather than something the screen always carries, and the
 * closed case is written into the stage rather than into a boolean beside it
 * -- two ways of saying the same thing is how they come to disagree.
 */

/**
 * How wide the symbol is drawn.
 *
 * Not a token: it is neither a space nor a size on the type scale, it is how
 * much of a screen a picture takes -- and the constraint behind it is a
 * camera's, which no palette knows about. A version-4 symbol is 33 modules
 * across, so this leaves each one a little over six points: comfortably above
 * what a phone resolves at arm's length.
 */
const QR_SIZE = 220

export type InviteStage =
  /** Nothing on screen. What a launch starts in, and what closing returns to. */
  | { readonly stage: 'shut' }
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

  if (stage.stage === 'shut') return null

  if (stage.stage === 'resting') {
    return (
      <View style={styles.resting} testID="invite-panel">
        {/* The question before the field, and the action after both. The
            first shape had the button above the question it answers, which
            reads as a control with a stray form under it. */}
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
        <NotchedButton
          label={t('invite_action')}
          testID="invite"
          onPress={() => onInvite(normaliseGivenName(draft))}
        />
        <Pressable
          onPress={onClose}
          style={styles.action}
          testID="invite-cancel">
          <Text style={styles.actionLabel}>{t('invite_close')}</Text>
        </Pressable>
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
      {/* THE PICTURE FIRST, AND THE ORDER IS THE ARGUMENT.
          The two people an invitation matters most for are the ones standing
          next to each other -- which, in a product entered only by
          invitation, is the ordinary case. A camera is the gesture for that,
          so the thing a camera reads is what the screen opens with.

          It reads it now: the link was minted `messagr://` until 7 September
          2026, a scheme no camera opens, so this picture had never been
          scannable by anything. `issueInvitation.ts` says what changed.

          The link is still here, below, because reading it out loud is the
          path that has to work when a camera does not -- and it now sits
          against the button that shares it, which is the other way it
          travels. Two ways of moving one link, together, instead of one at
          each end of the screen. */}
      <View style={styles.symbol}>
        <QrCode
          text={stage.link}
          size={QR_SIZE}
          testID="invite-qr"
          accessibilityLabel={t('invite_qr_label')}
        />
        <Text style={styles.hint}>{t('invite_qr')}</Text>
      </View>

      <Text style={styles.hint}>{t('invite_ready')}</Text>

      {/* The link in the mono role and selectable, then the button that
          sends it. `invite_ready` above promises it is valid for an hour and
          works once, and that promise belongs to the link rather than to the
          picture. */}
      <Text testID="invite-link" selectable style={styles.link}>
        {stage.link}
      </Text>
      {/* CENTRED, LIKE THE PICTURE ABOVE IT. A full-width button under a
          centred symbol reads as two screens stacked; the same axis makes it
          one. Asked for on a Pixel Fold, where the width makes the mismatch
          plain. */}
      <View style={styles.centred}>
        <NotchedButton
          label={t('invite_share')}
          testID="invite-share"
          onPress={() => {
            // Failure is ordinary here: somebody dismissed the sheet. There
            // is nothing to report and nothing to retry -- the link is on
            // screen.
            Share.share({ message: stage.link }).catch(() => {})
          }}
        />
      </View>
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
  symbol: {
    alignItems: 'center',
    gap: space.s,
  },
  centred: { alignItems: 'center' },
  // AND ITS OWN GUTTER, for the reason `Conversation.tsx` gives at length:
  // this screen was living on the `space.xl` that `App.tsx` used to put
  // around everything, and its field and its link ran edge to edge once
  // that went. `field`'s `paddingHorizontal` is the space inside the input.
  resting: {
    gap: space.m,
    paddingVertical: space.m,
    paddingHorizontal: layout.screenGutter,
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
