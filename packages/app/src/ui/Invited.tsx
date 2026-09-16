import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, layout, space, stroke, type } from '../design/tokens'
import type { WhatIsKnown } from '../runtime/invitationOnScreen'
import { NotchedButton } from './NotchedButton'

/**
 * Screen 1 of §13.3 — receiving an invitation.
 *
 * # WHAT REACHES THIS SCREEN, AND WHAT NEVER DOES
 *
 * Only an invitation nobody spent a link for on this telephone. Spending a
 * link **is** the decision — it was taken a moment earlier by the person
 * holding the device — so `enterInvitations.ts` walks through one door per
 * link spent without asking again, and leaves every other invitation exactly
 * as it arrived, neither joined nor declined. Those are the ones this screen
 * decides, and until it existed they simply stood there with nothing drawing
 * them.
 *
 * That includes the case the first half of #329 left open and said so: a
 * link claimed, the application killed in the few seconds before the sync
 * tick that crosses the door, and a relaunch whose register is empty —
 * `awaitedInvitations.ts` lives for the life of the process. The invitation
 * arrives owed to nobody and stands. It now stands **here**, named, with two
 * actions under it.
 *
 * # THE LINK DESCRIBED BEFORE ANY DECISION, AS FAR AS THIS DEVICE CAN
 *
 * §13.3 asks for sender, scope, validity, remaining uses, origin instance,
 * and any agent in the room. `invitationOnScreen.ts` argues at length which
 * of those this device holds and why the rest are not withheld but absent:
 * validity and remaining uses belong to the link, and this telephone never
 * held it. The screen states that rather than leaving a gap — an invitation
 * described without limits reads as an invitation without limits.
 *
 * # TWO ACTIONS, AND THE ORDER THEY COME IN
 *
 * *« Deux actions symétriques : rejoindre, refuser. Pas de "continuer quand
 * même". »* The refusal is a `quiet` button of the same rank rather than a
 * line of text, which is the prototype's own rule for its verification
 * screen: *« Le refus est un bouton de même rang que l'acceptation. »* Both
 * come last, under every fact, because a fact under a button is a fact read
 * after the decision.
 *
 * # WHERE THIS DEPARTS FROM THE PROTOTYPE, AND WHY
 *
 * The mockup (`design/prototype/messagr-prototype-v3.html:412-450`) draws
 * three things this product does not have.
 *
 * **« Vous invite à rejoindre un salon »**, over a named room with a member
 * count. Nothing in an invitation's stripped state distinguishes a room from
 * a 1:1 here, and every conversation this product makes is `private_chat`
 * with one invitee and no name. So the sentence says *une conversation*,
 * which is the word the glossary has and the only one that is true either
 * way.
 *
 * **An agent block** — *« Un agent nommé Compte-rendu est déjà membre »* —
 * and a third button opening its sheet. Nothing in this application creates,
 * inserts or reads an agent yet; there is no member of that kind for a
 * stripped state to carry. Drawing the block with nothing in it, or a line
 * saying no agent is present, would be this screen guaranteeing something
 * nothing measures.
 *
 * **The identifier in green.** The mockup prints `@nadia#7K2Q` in
 * `brand.green700`. Invariant 3 reserves green for a confirmed human and for
 * the principal action, and the prototype spends it once per screen — here
 * that is *« Rejoindre la conversation »*. `ConversationList.tsx` and
 * `GiveName.tsx` already draw an identifier as neutral `monoId`, and a third
 * idiom for one meaning would be the drift.
 *
 * # IT SCROLLS, LIKE `BackupOffer`
 *
 * #324's lesson, and it binds harder here: this screen is the only way to
 * answer an invitation at all, so an action a longer label could push off a
 * short telephone would be an invitation nobody could refuse. The whole page
 * scrolls, buttons included, and `flexGrow: 1` keeps it full where it fits.
 */
export function Invited({
  known,
  behind,
  working,
  failed,
  onJoin,
  onRefuse,
}: {
  readonly known: WhatIsKnown
  /**
   * How many more invitations stand behind this one.
   *
   * One is decided at a time — two decisions on one screen is one decision
   * taken carelessly — and this is what keeps the person from believing they
   * have finished when the next one appears.
   */
  readonly behind: number
  /**
   * Which action is under way, if either. A tap that shows nothing invites
   * another, and the second would send a refusal over a join.
   */
  readonly working: 'join' | 'refuse' | null
  /**
   * Whether the answer given here did not go through. The screen stays and
   * says so: the invitation is exactly where it was, and a screen that
   * closed would leave somebody believing they had answered.
   */
  readonly failed: boolean
  readonly onJoin: () => void
  readonly onRefuse: () => void
}) {
  const nobody = known.identifier === ''
  return (
    <ScrollView
      testID="invited"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('invited_title')}</Text>

      {nobody ? (
        <View style={[styles.card, styles.plain]} testID="invited-who-unknown">
          <Text style={styles.body}>{t('invited_who_unknown')}</Text>
        </View>
      ) : (
        <View style={styles.who} testID="invited-who">
          <Text style={styles.name}>{known.who}</Text>
          {/* The identifier under the name, as the prototype draws it and as
              `GiveName.tsx` already does: a name given here is this device's
              own label, and the account it labels has to stay visible. */}
          <Text style={styles.identifier}>{known.identifier}</Text>
          <Text style={styles.lead}>{t('invited_lead')}</Text>
        </View>
      )}

      {known.instance !== null && (
        <View
          style={[
            styles.card,
            // Ochre only when the invitation crosses instances, which is
            // something to weigh rather than something wrong. Its own server
            // is simply true, and a warning colour on it would be the product
            // frightening somebody about the ordinary case.
            known.elsewhere ? styles.weigh : styles.plain,
          ]}
          testID="invited-instance">
          <Text style={styles.body}>
            {known.elsewhere
              ? t('invited_instance_elsewhere %@', known.instance)
              : t('invited_instance %@', known.instance)}
          </Text>
        </View>
      )}

      <View style={[styles.card, styles.plain]} testID="invited-terms">
        <Text style={styles.body}>{t('invited_terms_unknown')}</Text>
      </View>

      <View style={[styles.card, styles.plain]} testID="invited-nothing-sent">
        <Text style={styles.body}>{t('invited_nothing_sent')}</Text>
      </View>

      <View style={styles.actions}>
        <NotchedButton
          testID="invited-join"
          label={working === 'join' ? t('invited_working') : t('invited_join')}
          onPress={onJoin}
          disabled={working !== null}
          wide
        />
        <NotchedButton
          testID="invited-refuse"
          label={
            working === 'refuse' ? t('invited_working') : t('invited_refuse')
          }
          onPress={onRefuse}
          tone="quiet"
          disabled={working !== null}
          wide
        />
        {/* Under the buttons rather than over them, for #284's reason: above,
            a card appearing would move the button just pressed out from under
            the finger. */}
        {failed && (
          <View style={[styles.card, styles.weigh]} testID="invited-failed">
            <Text style={styles.body}>{t('invited_failed')}</Text>
          </View>
        )}
        {behind > 0 && (
          <Text testID="invited-behind" style={styles.behind}>
            {t('invited_behind %1$d', behind)}
          </Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
    gap: space.m,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  who: {
    gap: space.xs,
  },
  name: {
    ...type.titleMd,
    color: color.neutral['900'],
  },
  identifier: {
    ...type.monoId,
    color: color.neutral['900'],
  },
  lead: {
    ...type.body,
    color: color.neutral['600'],
  },
  card: {
    padding: space.m,
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
  body: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  actions: {
    marginTop: space.m,
    gap: space.s,
  },
  behind: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
