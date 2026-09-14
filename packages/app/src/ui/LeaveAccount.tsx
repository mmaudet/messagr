import React from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, layout, space, type } from '../design/tokens'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Whether this device leaves its account for an invitation into another
 * server. #304.
 *
 * # THE SHAPE OF A GESTURE NOTHING TAKES BACK
 *
 * `Consequences.tsx`, as eviction and replacing a recovery key have it: what
 * leaves this device, what stays, and the word « Irréversible ». Of the three
 * this is the one whose loss belongs to the person pressing the button --
 * their conversations here, and the keys that open them.
 *
 * # TRUE WHICHEVER WAY THE CLAIM GOES
 *
 * Decided on 14 September 2026: the new account is claimed first, and the old
 * one is forgotten only once the new one is in place on this device. The facts
 * are read in that order -- first a new account, then this one leaves -- so
 * nothing on this screen is untrue for somebody whose link turns out to be
 * spent, or whose device could not keep the new account.
 *
 * # BOTH SERVERS ARE NAMED
 *
 * `product-spec.md` §7.1 keeps the `:server` suffix off a participant's name
 * and leaves it available on demand, and §13.3 describes an invitation fully
 * before any decision, origin instance included. Nothing forbids naming a
 * server where the question is which server, and here the two hosts are what
 * tells somebody what they are choosing between: an account on a server they
 * may have forgotten, and the server they have just been invited to.
 *
 * # THE WHOLE SCREEN
 *
 * `App.tsx` draws this instead of everything else, not as a panel over the
 * list: the launch is waiting for the answer, and nothing underneath may be
 * used meanwhile.
 */
export function LeaveAccount({
  account,
  link,
  working,
  onLeave,
  onStay,
}: {
  /** The server this device's account lives on, as a person reads it. */
  readonly account: string
  /** The server the invitation leads to. */
  readonly link: string
  /**
   * Whether the answer was yes and the link is still being claimed. That can
   * take half a minute, while the issuer's application lets the new account
   * in, and the screen stays the question meanwhile: what is underneath is
   * the account that may be about to go.
   */
  readonly working: boolean
  readonly onLeave: () => void
  /**
   * The refusal, and a button of the same rank as the gesture:
   * `Consequences` says why, and it holds with more force here, since staying
   * is the answer that changes nothing.
   */
  readonly onStay: () => void
}) {
  return (
    <SafeAreaView style={styles.ground} testID="leave-account">
      <ScrollView contentContainerStyle={styles.content}>
        <Consequences
          testID="leave-account-consequences"
          title={t('leave_title')}
          lead={t('leave_lead')}
          facts={[
            {
              tone: 'plain',
              said: t('leave_fact_link'),
              body: t('leave_link_body %@', link),
              testID: 'leave-account-link',
            },
            {
              // OCHRE: the loss to weigh, and it is theirs. Not red, which is
              // a measure taken against somebody.
              tone: 'weigh',
              said: t('leave_fact_gone'),
              body: t('leave_gone_body %@', account),
              testID: 'leave-account-gone',
            },
            {
              tone: 'plain',
              said: t('leave_fact_stays'),
              body: t('leave_stays_body'),
              testID: 'leave-account-stays',
            },
          ]}
          finally={t('leave_final')}>
          {working ? (
            <Text testID="leave-account-working" style={styles.working}>
              {t('leave_working')}
            </Text>
          ) : (
            <>
              {/* THE DEFAULT TONE, NOT THE MEASURE. Red is `deny`, « action de
                  mesure » in the token's own words, and leaving one's own
                  account is not a measure taken against anybody.
                  `BackupSettings.tsx` confirms replacing a recovery key the
                  same way. */}
              <NotchedButton
                testID="leave-account-confirm"
                label={t('leave_confirm')}
                onPress={onLeave}
                wide
              />
              <NotchedButton
                testID="leave-account-stay"
                label={t('leave_cancel')}
                tone="quiet"
                onPress={onStay}
                wide
              />
            </>
          )}
        </Consequences>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: color.surface.paper },
  content: {
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.xxl,
  },
  working: { ...type.bodySm, color: color.neutral['600'] },
})
