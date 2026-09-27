import React, { useState } from 'react'
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

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
import { cleanDeclaredName } from '../runtime/declaredName'
import { normaliseGivenName } from '../runtime/givenName'
import type {
  DeliveryRefusal,
  DeliveryWait,
} from '../runtime/deliveredInvitations'
import type { Drafted, LinkChannel } from '../runtime/inviteByLink'
import { NotchedButton } from './NotchedButton'
import { QrCode } from './QrCode'
import { dayOf, timeOf } from './whenLabel'

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
 * # There are two names on this screen, and only one of them travels
 *
 * #329. Until it, this screen asked for the invitee's name and offered the
 * inviter nowhere to say who *they* are — so the person opening the link met
 * `@rabr642vve6v` and a decision to make about it. The second field is what
 * `Invited.tsx` draws as « Se présente comme », and it is a claim rather than
 * an identity (§13.26).
 *
 * It goes in the link's fragment, which is never transmitted: the invitation
 * service is never sent it, has no column for it and could not read it if it
 * wanted to. `declaredName.ts` argues that at length, and it is what makes
 * the field cost nothing in what any server holds.
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

/** What each refusal of the service says, in a sentence of its own (#404). */
const REFUSED: Readonly<Record<DeliveryRefusal, CopyKey>> = {
  'own-reference': 'invite_refused_own',
  'unknown-reference': 'invite_refused_gone',
  'not-findable': 'invite_refused_not_findable',
  pending: 'invite_refused_pending',
}

/** And each refusal that says when another may leave (#406), with it. */
const WAITED: Readonly<Record<DeliveryWait['why'], CopyKey>> = {
  recently: 'invite_refused_recently %1$@ %2$@',
  quota: 'invite_refused_quota %1$@ %2$@',
}

/** The sentence of a refusal, or of a failure the service did not name. */
function refusedSaying(refusal?: DeliveryRefusal | DeliveryWait): string {
  if (refusal === undefined) return t('invite_failed')
  if (typeof refusal === 'string') return t(REFUSED[refusal])
  return t(WAITED[refusal.why], dayOf(refusal.retryAt), timeOf(refusal.retryAt))
}

/**
 * A match, found by looking for one's contacts (#404): the name of its card,
 * which « Qui invitez-vous ? » opens with, the reference the invitation is
 * delivered to inside the application, and the envelope key its proof
 * published (#405), which the name the inviter gives itself is sealed for.
 * `null` when it published none: then no name travels, and none is asked.
 */
export interface InvitedMatch {
  readonly name: string
  readonly reference: string
  readonly envelopeKey: string | null
}

/**
 * A contact absent from Messagr (#408): the name of its card, which « Qui
 * invitez-vous ? » opens with, and how its link of three days leaves: by SMS
 * to the card's number, or by the share sheet. The number goes to the
 * telephone's messaging application, and nowhere else (`inviteByLink.ts`).
 */
export interface InvitedAbsent {
  readonly name: string
  readonly channel: LinkChannel
}

/**
 * Whether the form invites a contact found, inside the application (#404),
 * rather than a contact absent from Messagr, by a link (#408).
 */
export function isFound(to: InvitedMatch | InvitedAbsent): to is InvitedMatch {
  return 'reference' in to
}

export type InviteStage =
  /** Nothing on screen. What a launch starts in, and what closing returns to. */
  | { readonly stage: 'shut' }
  /**
   * The form. `to`, for a contact found: the invitation is delivered inside
   * the application rather than carried by a link (#404); for a contact
   * absent from Messagr, a link of three days by SMS or by the share sheet
   * (#408).
   */
  | {
      readonly stage: 'resting'
      readonly to?: InvitedMatch | InvitedAbsent
    }
  | { readonly stage: 'working' }
  | {
      readonly stage: 'ready'
      readonly link: string
      /**
       * For a contact absent from Messagr, whose link is good for three days
       * (#408); `null` for any other link, good for an hour.
       */
      readonly drafted: Drafted | null
    }
  /**
   * An invitation delivered inside the application: nothing to share, and
   * the conversation waits in the list. `name` is the one typed, if any.
   */
  | {
      readonly stage: 'sent'
      readonly name: string | null
      /** Milliseconds since the epoch. */
      readonly expiresAt: number
    }
  | {
      readonly stage: 'failed'
      readonly reason: string
      /**
       * Why the service would not take an invitation delivered inside the
       * application, when it said so (#404): a sentence of its own, rather
       * than « L'invitation n'a pas pu être créée. ».
       */
      readonly refusal?: DeliveryRefusal | DeliveryWait
    }

export interface InviteProps {
  readonly stage: InviteStage
  /**
   * Called with the two names, either of which may be `null`.
   *
   * `name` is what to hold for whoever claims the link, on this device.
   * `declared` is what the person issuing it calls themselves, and it is the
   * one that travels — in the link's fragment, and nowhere else.
   */
  readonly onInvite: (name: string | null, declared: string | null) => void
  readonly onClose: () => void
  /** What became of the far half, once it is known. */
  readonly admission: 'waiting' | 'admitted' | null
}

export function Invite({ stage, onInvite, onClose, admission }: InviteProps) {
  // A CONTACT FOUND OPENS WITH THE NAME OF ITS CARD (#404), to keep or to
  // change. The form is drawn anew each time it opens: `App.tsx` shows it
  // only while it is not shut.
  const [draft, setDraft] = useState(
    stage.stage === 'resting' ? (stage.to?.name ?? '') : '',
  )
  const [presented, setPresented] = useState('')

  if (stage.stage === 'shut') return null

  if (stage.stage === 'resting') {
    // A contact found (#404), a contact absent (#408), or `undefined` for a
    // link. Only a contact found is invited without a link.
    const { to } = stage
    const found = to !== undefined && isFound(to) ? to : undefined
    const channel = to !== undefined && !isFound(to) ? to.channel : undefined
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

        {/* FOR A CONTACT FOUND, THE DECLARED NAME TRAVELS SEALED (#405).
            Delivered inside the application, an invitation has no link, and
            so no fragment to carry the name in: it is sealed for the key the
            recipient's device published with its proof. A device that
            published none has nothing to seal it for, and asking would be
            asking for a name that goes nowhere. */}
        {(found === undefined || found.envelopeKey !== null) && (
          <>
            {/* TWO NAMES, AND THE TWO HINTS ARE THE TEACHING. #329.
            The first is what you call THEM, and it stays on this telephone.
            The second is what you call YOURSELF, and it is the only name in
            this product that travels -- because the person opening the link
            has never seen this account and `@rabr642vve6v` tells them
            nothing about who is inviting them.

            Optional, and empty every time. It is not remembered between two
            invitations, on purpose: a declared name is a sentence in ONE
            invitation rather than a property of an account, and a name
            remembered and re-sent by default would be a name declared to
            people who never watched it being typed. `declaredName.ts`. */}
            <Text style={styles.who}>{t('invite_declared')}</Text>
            <TextInput
              testID="invite-declared"
              value={presented}
              onChangeText={setPresented}
              placeholder={t('list_name_placeholder')}
              placeholderTextColor={color.neutral['400']}
              style={styles.field}
            />
            <Text style={styles.hint} testID="invite-declared-hint">
              {found === undefined
                ? t('invite_declared_hint')
                : t('invite_declared_sealed_hint')}
            </Text>
          </>
        )}

        <NotchedButton
          label={
            channel?.by === 'sms' ? t('find_invite_sms') : t('invite_action')
          }
          testID="invite"
          onPress={() =>
            onInvite(normaliseGivenName(draft), cleanDeclaredName(presented))
          }
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

  if (stage.stage === 'sent') {
    return (
      <View style={styles.resting}>
        <Text testID="invite-sent" style={styles.who}>
          {stage.name === null
            ? t('invite_sent_unnamed %1$@', dayOf(stage.expiresAt))
            : t('invite_sent %1$@ %2$@', stage.name, dayOf(stage.expiresAt))}
        </Text>
        <Text style={styles.hint}>{t('invite_sent_waits')}</Text>
        <Pressable
          onPress={onClose}
          style={styles.action}
          testID="invite-close">
          <Text style={styles.actionLabel}>{t('invite_close')}</Text>
        </Pressable>
      </View>
    )
  }

  if (stage.stage === 'failed') {
    return (
      <View style={styles.resting}>
        <Text testID="invite-failed" style={styles.failed}>
          {refusedSaying(stage.refusal)}
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

      {/* Three days for a contact absent from Messagr (#408), an hour for
          any other link: the screen says what the link was minted for. */}
      <Text style={styles.hint} testID="invite-ready">
        {stage.drafted === null ? t('invite_ready') : t('invite_ready_days')}
      </Text>
      {stage.drafted?.smsRefused === true && (
        <Text style={styles.failed} testID="invite-sms-failed">
          {t('invite_sms_failed')}
        </Text>
      )}

      {/* The link in the mono role and selectable, then the button that
          sends it. The sentence above promises how long it is valid for and
          that it works once, and that promise belongs to the link rather than
          to the picture. */}
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
            // screen. For a contact absent from Messagr, the text drafted
            // around it (#408).
            Share.share({
              message: stage.drafted?.message ?? stage.link,
            }).catch(() => {})
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
