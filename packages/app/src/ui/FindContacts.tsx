import React from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { Absent, FindingStage, Waiting } from '../runtime/findContacts'
import type { InvitedAbsent, InvitedMatch } from './Invite'
import { NotchedButton } from './NotchedButton'
import { dayOf } from './whenLabel'

/**
 * « Retrouver mes contacts » (#400, #392): the reminder, then the contacts
 * found on Messagr and the others.
 *
 * Every stage is `findContacts.ts`'s, and every gesture is handed back to it,
 * but « Inviter quelqu'un », which leads to the invitation form (`App.tsx`):
 * this file draws and decides nothing.
 *
 * # THE REMINDER HAS ONE BUTTON
 *
 * It comes right before the system's own question about the address book,
 * and Apple wants a screen in that place to lead to the question and nowhere
 * else. The way back is the arrow above it, as on every screen.
 *
 * # ONE CONTACT AT A TIME
 *
 * The contacts on Messagr come first, under the name of their card, each
 * with « Inviter », which opens the invitation form for that one contact
 * (#404); then the others, each with « Inviter par SMS », when its card holds
 * a number, and « Autre moyen », which open the same form for a link of three
 * days (#408). Nothing here, now or later, takes the whole address book.
 *
 * # A LIST THAT DRAWS WHAT IS ON SCREEN
 *
 * The others are the address book but for a few, and each row now carries
 * two buttons, each drawn and measured for its notch: a thousand cards would
 * be two thousand of them drawn at once. The list draws the rows as they
 * come into view, and the rest of the page is its header and its footer.
 *
 * # SOME CARDS, OR NONE (#403)
 *
 * When the system shares some cards only, the results say so and offer the
 * system's choice to share more. When it shares none, the screen says how to
 * allow it later, and offers to invite somebody by a link in the meantime.
 */
export function FindContacts({
  stage,
  onContinue,
  onShareMore,
  onInvite,
  onClose,
}: {
  readonly stage: Exclude<FindingStage, { readonly stage: 'shut' }>
  /** « Continuer », on the reminder. */
  readonly onContinue: () => void
  /** « Partager d'autres contacts », on the results of a limited access. */
  readonly onShareMore: () => void
  /**
   * « Inviter », on a contact found (#404), with that contact; « Inviter par
   * SMS » and « Autre moyen », on a contact absent (#408), with that contact;
   * « Inviter quelqu'un », when the address book was refused, with none: a
   * link.
   */
  readonly onInvite: (to?: InvitedMatch | InvitedAbsent) => void
  /** The arrow, « Terminé », and every way back to the list. */
  readonly onClose: () => void
}) {
  return (
    <View style={styles.screen} testID="find-contacts">
      <Pressable
        testID="find-contacts-back"
        onPress={onClose}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('tab_discussions')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t('plus_find_contacts')}</Text>
      {stage.stage === 'reminder' && (
        <View style={styles.body} testID="find-contacts-reminder">
          <Text style={styles.text}>{t('find_reminder')}</Text>
          <View style={styles.actions}>
            <NotchedButton
              testID="find-contacts-continue"
              label={t('findable_continue')}
              onPress={onContinue}
              wide
            />
          </View>
        </View>
      )}
      {stage.stage === 'looking' && (
        <Text style={styles.hint} testID="find-contacts-looking">
          {t('find_looking')}
        </Text>
      )}
      {stage.stage === 'found' && (
        <Found
          matches={stage.matches.map(m => ({
            name: m.contact.name,
            reference: m.reference,
            holderChanged: m.holderChanged,
            envelopeKey: m.envelopeKey,
          }))}
          onInvite={onInvite}
          others={stage.others}
          waiting={stage.waiting}
          limited={stage.limited}
          onShareMore={onShareMore}
          onDone={onClose}
        />
      )}
      {stage.stage === 'refused' && (
        <View style={styles.body}>
          <View style={styles.notice} testID="find-contacts-refused">
            <Text style={styles.noticeText}>{t(REFUSED[stage.why])}</Text>
          </View>
          {stage.why === 'no-access' && (
            <NotchedButton
              testID="find-contacts-invite"
              label={t('plus_invite')}
              onPress={() => onInvite()}
              wide
            />
          )}
          <NotchedButton
            testID="find-contacts-done"
            label={t('findable_done')}
            onPress={onClose}
            tone={stage.why === 'no-access' ? 'quiet' : 'brand'}
            wide
          />
        </View>
      )}
    </View>
  )
}

/** Why nothing is shown, in a sentence each. */
const REFUSED: Readonly<
  Record<Extract<FindingStage, { stage: 'refused' }>['why'], CopyKey>
> = {
  'no-access': 'find_no_access',
  'not-findable': 'find_not_findable',
  'not-the-published-key': 'find_not_the_published_key',
  off: 'find_off',
  unreachable: 'find_unreachable',
}

function Found({
  matches,
  others,
  waiting,
  limited,
  onShareMore,
  onInvite,
  onDone,
}: {
  readonly matches: readonly {
    readonly name: string
    readonly reference: string
    /** The number led to another account before (#402). */
    readonly holderChanged: boolean
    /** What the inviter's name is sealed for (#405), if anything. */
    readonly envelopeKey: string | null
  }[]
  readonly others: readonly Absent[]
  /** What the limit on masking left for later (#401). */
  readonly waiting: Waiting | null
  /** The system shares some cards only (#403). */
  readonly limited: boolean
  readonly onShareMore: () => void
  readonly onInvite: (to: InvitedMatch | InvitedAbsent) => void
  readonly onDone: () => void
}) {
  const header = (
    <View style={styles.body}>
      {limited && (
        <View style={styles.notice} testID="find-contacts-limited">
          <Text style={styles.noticeText}>{t('find_limited')}</Text>
          <NotchedButton
            testID="find-contacts-share-more"
            label={t('find_share_more')}
            onPress={onShareMore}
            tone="quiet"
            wide
          />
        </View>
      )}
      {waiting !== null && (
        <View style={styles.notice} testID="find-contacts-waiting">
          <Text style={styles.noticeText}>
            {t(
              'find_waiting %1$@ %2$@',
              String(waiting.count),
              dayOf(waiting.freesAt),
            )}
          </Text>
        </View>
      )}
      {/* Nobody found is said only when every number was compared: with
          some left for later, the line above says how many. */}
      {(matches.length > 0 || waiting === null) && (
        <Text style={styles.heading}>{t('find_on_messagr')}</Text>
      )}
      {matches.length === 0
        ? waiting === null && (
            <Text style={styles.hint} testID="find-contacts-nobody">
              {t('find_nobody')}
            </Text>
          )
        : matches.map(({ name, reference, holderChanged, envelopeKey }, i) => (
            <View key={`m${i}`} style={styles.match}>
              <View style={styles.matchName}>
                <Text style={styles.row} testID="find-contacts-match">
                  {name}
                </Text>
                {holderChanged && (
                  <Text
                    style={styles.hint}
                    testID="find-contacts-holder-changed">
                    {t('find_holder_changed')}
                  </Text>
                )}
              </View>
              <NotchedButton
                testID="find-contacts-invite-contact"
                label={t('find_invite')}
                // A NUMBER THAT CHANGED HANDS OFFERS NO NAME: the account it
                // leads to now inherits nothing of the card's (#392), not
                // even as the name the form opens with.
                onPress={() =>
                  onInvite({
                    name: holderChanged ? '' : name,
                    reference,
                    envelopeKey,
                  })
                }
                tone="quiet"
              />
            </View>
          ))}
      {others.length > 0 && (
        <Text style={styles.heading}>{t('find_others')}</Text>
      )}
    </View>
  )
  return (
    <FlatList
      testID="find-contacts-found"
      data={others}
      keyExtractor={(_, i) => `o${i}`}
      contentContainerStyle={styles.list}
      ListHeaderComponent={header}
      renderItem={({ item }) => <AbsentRow absent={item} onInvite={onInvite} />}
      ListFooterComponent={
        <View style={styles.actions}>
          <NotchedButton
            testID="find-contacts-done"
            label={t('findable_done')}
            onPress={onDone}
            wide
          />
        </View>
      }
    />
  )
}

/** A contact absent from Messagr, and the two ways to invite it (#408). */
function AbsentRow({
  absent: { contact, number },
  onInvite,
}: {
  readonly absent: Absent
  readonly onInvite: (to: InvitedAbsent) => void
}) {
  return (
    <View style={styles.absent}>
      <Text style={styles.row} testID="find-contacts-other">
        {contact.name}
      </Text>
      <View style={styles.absentActions}>
        {number !== null && (
          <NotchedButton
            testID="find-contacts-invite-sms"
            label={t('find_invite_sms')}
            onPress={() =>
              onInvite({ name: contact.name, absent: { by: 'sms', number } })
            }
            tone="quiet"
          />
        )}
        <NotchedButton
          testID="find-contacts-invite-other"
          label={t('find_invite_other')}
          onPress={() =>
            onInvite({ name: contact.name, absent: { by: 'share' } })
          }
          tone="quiet"
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
  },
  back: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  backLabel: {
    ...type.bodySm,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
    marginBottom: space.m,
  },
  body: { gap: space.m },
  list: { gap: space.m },
  text: { ...type.body, color: color.neutral['900'] },
  hint: { ...type.bodySm, color: color.neutral['600'] },
  heading: { ...type.titleMd, color: color.neutral['900'] },
  row: { ...type.body, color: color.neutral['900'] },
  match: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  matchName: { flex: 1 },
  absent: { gap: space.s },
  absentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  actions: { gap: space.s, marginTop: space.m },
  notice: {
    gap: space.s,
    padding: space.m,
    borderLeftWidth: stroke.accent,
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  noticeText: { ...type.bodySm, color: color.neutral['900'] },
})
