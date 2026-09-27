import { t } from '../copy'
import {
  ABSENT_LINK_TTL_SECONDS,
  LINK_TTL_SECONDS,
  type Issued,
} from './issueInvitation'
import type { Outstanding } from './outstandingStore'

/**
 * Inviting somebody by a link: from « Inviter quelqu'un », or a contact
 * absent from Messagr by SMS or by the share sheet (#408). Then writing down
 * what letting them in needs, however late they come.
 *
 * # THREE DAYS FOR A CONTACT ABSENT FROM MESSAGR, AN HOUR FOR ANY OTHER LINK
 *
 * A link handed over across a table is opened at once; one sent to somebody
 * who is not on Messagr is read when they get to it (#392, story 50). Both
 * still work once. « Autre moyen » is the same person invited by another
 * channel, and its link is the same: the owner's decision of 27 September
 * 2026.
 *
 * # THE NUMBER GOES TO THE MESSAGING APPLICATION, AND NOWHERE ELSE
 *
 * The request that mints the link carries `max_uses`, `ttl_seconds` and
 * `room_id` (`issueInvitation.ts`), and this file hands it nothing else. The
 * card's number is written into the address the telephone's messaging
 * application opens, with the drafted text, and the person sends it
 * themselves: the service never learns who was invited by SMS.
 *
 * # WRITTEN DOWN WITH HOW LONG IT LASTS, AND THE NAME TYPED
 *
 * The device that issued the link lets in whoever walks through it
 * (ADR-0004), and asks for as long as the link is good for
 * (`admitAnyoneWaiting.ts`). The name typed at invite time is written down
 * with it: it is given to whoever comes in, even days later, and stays on
 * this device (`outstandingStore.ts`).
 */

/** How a link to a contact absent from Messagr leaves (#408). */
export type AbsentChannel =
  /** « Inviter par SMS »: the telephone's messaging application. */
  | { readonly by: 'sms'; readonly number: string }
  /** « Autre moyen »: the share sheet. */
  | { readonly by: 'share' }

export interface LinkDeps {
  /**
   * `issueInvitation`, behind a port so this file names no transport: the
   * conversation, then a link for it good for `ttlSeconds`, with the
   * declared name in its fragment.
   */
  readonly issue: (
    declared: string | null,
    ttlSeconds: number,
  ) => Promise<Issued>
  readonly outstanding: Outstanding
  readonly now: () => number
  /** Opens an address outside the application; rejects when nothing can. */
  readonly openUrl: (url: string) => Promise<void>
  /** The share sheet, with a message. */
  readonly share: (message: string) => Promise<void>
  /** Where the messaging application reads the text differs: `smsAddress`. */
  readonly os: 'ios' | 'android'
}

export type ByLink =
  | {
      readonly issued: true
      readonly scope: string
      readonly link: string
      readonly invitationId: string
      /**
       * Whether the notebook kept it. Not a failure of the invitation: the
       * link is good, and what is lost is letting its person in after a
       * relaunch.
       */
      readonly kept: boolean
      /**
       * For a contact absent from Messagr: the drafted text, which the
       * screen's share button sends too, and whether the messaging
       * application refused to open with it. `null` for any other link.
       */
      readonly drafted: {
        readonly message: string
        readonly smsRefused: boolean
      } | null
    }
  | Extract<Issued, { readonly issued: false }>

export async function inviteByLink(
  deps: LinkDeps,
  names: {
    /** What the inviter calls the person invited: it stays here. */
    readonly given: string | null
    /** What the inviter calls themselves: it travels in the fragment. */
    readonly declared: string | null
  },
  /** For a contact absent from Messagr; nothing for any other link. */
  absent?: AbsentChannel,
): Promise<ByLink> {
  const ttlSeconds =
    absent === undefined ? LINK_TTL_SECONDS : ABSENT_LINK_TTL_SECONDS
  const issued = await deps.issue(names.declared, ttlSeconds)
  if (!issued.issued) return issued

  const kept = await deps.outstanding.remember({
    invitationId: issued.invitationId,
    scope: issued.scope,
    issuedAt: deps.now(),
    lifetime: ttlSeconds * 1000,
    name: names.given,
  })
  if (absent === undefined) return { ...issued, kept, drafted: null }

  // IN THE LANGUAGE OF THE APPLICATION, and the person sees it and may
  // change it before sending it (#392, story 48).
  const message = t('invite_absent_text %1$@', issued.link)
  let smsRefused = false
  if (absent.by === 'sms') {
    try {
      await deps.openUrl(smsAddress(deps.os, absent.number, message))
    } catch {
      // No messaging application, or one that would not open: the screen
      // says so, and the link is there to share another way.
      smsRefused = true
    }
  } else {
    // NOT WAITED FOR: the sheet stays open over the screen, which shows the
    // link meanwhile rather than « Création de la conversation… ». A sheet
    // dismissed is not a failure, and one that would not open leaves the
    // link on the screen, with its own button.
    deps.share(message).catch(() => undefined)
  }
  return { ...issued, kept, drafted: { message, smsRefused } }
}

/**
 * The address that opens the telephone's messaging application on `number`,
 * with `body` written and not sent.
 *
 * Android reads the body as the address's query; iOS reads it after `&`,
 * with no query at all. The body is encoded whole, so that the link's own
 * fragment stays inside the text rather than ending the address.
 */
export function smsAddress(
  os: 'ios' | 'android',
  number: string,
  body: string,
): string {
  return `sms:${number}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`
}
