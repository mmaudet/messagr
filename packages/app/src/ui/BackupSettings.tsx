import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import type { BackupGesture } from '../runtime/acceptanceGate'
import type { BackupStanding } from '../runtime/backupStanding'
import {
  failedReplacementSentence,
  type ReplaceFailure,
} from '../runtime/replaceBackup'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Whether the backup is on, and the two things somebody can do about it.
 *
 * # ONE LINE IN RÉGLAGES, AND NOTHING ELSE
 *
 * ADR-0013, after the soft prompt: *« une ligne dans Réglages et rien
 * d'autre »*. No recurring banner, no reminder — *« un produit qui harcèle
 * sur la sécurité apprend surtout à ignorer ses propres avertissements »*.
 * This screen is where the state is legible at any time, beside «&nbsp;Messages
 * favoris&nbsp;» and «&nbsp;Informations légales&nbsp;», and it is the only
 * place the subject appears once the offer has been answered.
 *
 * # IT SAYS WHAT EXISTS ON THE SERVER, WHICH IS A CORRECTION (#323)
 *
 * This took the bridge's reading and nothing else, and printed « vos messages
 * sont sauvegardés sur le serveur » from it. In that reading `enabled` means
 * *« `enableKeyBackup` a été appelé dans ce processus »*: it stays true of a
 * device whose version the homeserver retired, and of one another telephone
 * replaced this morning. The count beside it said « c'est ce que Messagr voit
 * sur le serveur » while showing a local counter.
 *
 * So the screen now draws a `BackupStanding`, which is that reading put beside
 * `GET /room_keys/version` and the keystore commitment. Five states, each with
 * a sentence and an action the account holder validated on 15 September 2026,
 * and the two that know nothing kept apart from each other and from the three
 * that do. `backupStanding.ts` argues the whole of it.
 *
 * # THE COUNT IS SHOWN WITH ITS PROVENANCE OR NOT AT ALL
 *
 * `backedUp` below `total` is the ordinary state of a device that has just
 * accepted, and of one that has just replaced its key — the bridge counts
 * against the *enabled* version, so replacing reads zero out of everything
 * while nothing whatever has been lost. A screen that printed «&nbsp;0 sur
 * 1&nbsp;240&nbsp;» and stopped would frighten somebody about a number that
 * means the opposite of what it looks like.
 *
 * So the sentence that says the rest is on its way is not optional
 * decoration: it is shown whenever the two numbers differ, and the numbers
 * are not shown at all when they agree, because «&nbsp;1 240 sur
 * 1 240&nbsp;» is a fact nobody needs and «&nbsp;vos messages sont
 * sauvegardés&nbsp;» is the same fact in words.
 *
 * # REPLACING, AND WHY THE SCREEN SAYS WHAT IT COSTS BEFORE OFFERING IT
 *
 * Replacing is the answer to *« elle est montrée une fois et jamais plus »*:
 * whoever wrote their key down badly finds out at the worst possible moment,
 * and the only honest remedy is a new one. It makes a new backup version and
 * retires the old key — so the old key stops opening anything, which is
 * exactly what should happen to a key on a piece of paper nobody can find,
 * and exactly the wrong surprise for somebody who still had theirs.
 *
 * The sentence therefore comes before the control, not after it. And
 * «&nbsp;Créer une nouvelle sauvegarde&nbsp;», which the two middle states
 * offer, is that same gesture under the name those states call for: it goes
 * through the same panel, because it costs the same thing.
 *
 * # THREE READINGS, BECAUSE A SCREEN THAT DRAWS NOTHING IS A BLANK PAGE
 *
 * This took `enabled`, `total` and `backedUp` and was rendered only once its
 * caller had them. The caller hides the Réglages list to show this, so a
 * reading that never arrived left **a blank white page with no way back** --
 * found by a tester on iOS, where the reading fails.
 *
 * It now takes the reading itself and draws every state of it. `waiting`
 * asserts nothing, which was the true half of the old reasoning. `unreadable`
 * says so and offers to ask again, because a reading that failed once is
 * usually a reading that succeeds twice, and leaving and re-entering the
 * screen to discover that is a thing nobody should have to guess.
 *
 * Neither claims the backup is on or off. That distinction -- between not
 * knowing and knowing the answer is no -- is the whole reason this is five
 * states and two absences of one, rather than a boolean with a spinner.
 *
 * # THE CURRENT KEY IS NOT HERE, AND THAT IS THE POINT
 *
 * No screen in this product can show it again, including this one. Saying so
 * here is what stops somebody hunting for it in Réglages and concluding the
 * product lost it — the key was theirs from the moment it was shown, and the
 * only thing this screen can offer is a different one.
 */
export function BackupSettings({
  standing,
  onBack,
  onRetry,
  onEnable,
  onReplace,
  confirming,
  onConfirming,
  onRestore,
  failed,
  working,
  replaceFailure,
}: {
  /**
   * What this device could learn about its backup, from the bridge, the
   * account and the keystore together (#323). `backupStanding.ts` owns the
   * decision; this draws it.
   */
  readonly standing: BackupStanding
  /**
   * The key replacement asked for here, when it did not go through (#284), or
   * `null`. It decides the sentence: « rien n'a changé » holds when the
   * gesture left nothing behind, which since #327 is a thing a failure past
   * the publish can also be. `failedReplacementSentence` says it.
   *
   * Above everything on this screen, because the reading taken after it can
   * land in any state, or be waiting, and the sentence has to be seen
   * whichever one the screen then draws.
   */
  readonly replaceFailure: ReplaceFailure | null
  /**
   * Which gesture on the backup is running, if any (#284): an acceptance,
   * from this screen or from the offer, or a replacement of the key. One runs
   * at a time, so every button that would start one, or cover this screen,
   * waits inert while either does, and the button of the one running says so.
   */
  readonly working: BackupGesture | null
  readonly onBack: () => void
  /** Takes the reading again. Offered only when it could not be taken. */
  readonly onRetry: () => void
  /** Offered only when the account has no backup: accepting after a refusal. */
  readonly onEnable: () => void
  /**
   * A new key, and the old backup retired.
   *
   * Called only after the confirmation below, never from the row itself. It
   * is the same gesture under two names: « Remplacer ma clé de récupération »
   * where the backup is running, and « Créer une nouvelle sauvegarde » where
   * the account holds one this device is not writing to.
   */
  readonly onReplace: () => void
  /**
   * Whether the confirmation is standing between the row and the gesture.
   *
   * **Owned by the caller, and that is a correction a device run made.** It
   * was local state here, and nothing put it back: the replacement
   * succeeded, the key screen covered everything, and dismissing it revealed
   * this screen still showing the confirmation panel -- two buttons offering
   * to replace the key that had just been replaced. The E2E test caught it
   * on the last line, waiting for a row that never came back.
   *
   * The caller is the one that learns the gesture finished, because it is
   * the one that ran it. So it is the one that can close this, and it does
   * so when the promise settles, long after the finger has gone.
   */
  readonly confirming: boolean
  readonly onConfirming: (confirming: boolean) => void
  /**
   * Opens the key entry, for a backup on the account this device is not
   * reading.
   *
   * The door `restore_offer_later` promises: *« Vous pourrez le faire depuis
   * Réglages. »* A refusal of the restore offer is honoured for good, like
   * the backup's, and ADR-0013 is explicit that a product which will not ask
   * again owes a way back somebody can find.
   *
   * Offered from the two states that have something behind it, and from
   * neither of the others: the account either holds a backup this device is
   * not feeding or it does not, and that is now a thing this screen knows
   * rather than a flag the caller computes (#323).
   */
  readonly onRestore: () => void
  /**
   * Whether accepting from this screen did not go through (#284).
   *
   * Said under the button that was pressed, and only there. The state above
   * already says the messages are not backed up; what it cannot say is that
   * asking just now failed, which is what the tap left somebody waiting for.
   */
  readonly failed: boolean
}) {
  const behind =
    standing.standing === 'sending' && standing.backedUp < standing.total
  /**
   * Le rattrapage est fini, et il y a quelque chose à montrer.
   *
   * `total > 0` parce qu'un appareil neuf n'a encore ouvert aucune
   * conversation : « vos 0 clés sont sauvegardées » serait une preuve de
   * rien, sur un écran dont toute la valeur est d'être cru.
   */
  const allBackedUp =
    standing.standing === 'sending' &&
    standing.total > 0 &&
    standing.backedUp >= standing.total
  /**
   * Whether making a new backup is on offer, and therefore whether the
   * confirmation panel may stand.
   *
   * The three states the gesture can be started from. Read here rather than
   * at each use so the panel and the buttons cannot disagree about it -- a
   * panel drawn over a state that no longer offers it would be the screen
   * confirming a gesture nothing on it proposed.
   */
  const replaceable =
    standing.standing === 'sending' ||
    standing.standing === 'superseded' ||
    standing.standing === 'dormant'

  return (
    <View style={styles.screen} testID="backup-settings">
      <Pressable
        testID="backup-settings-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('settings_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('settings_backup')}</Text>

      {/* THE REPLACEMENT THAT DID NOT GO THROUGH (#284). Its confirmation has
          closed by the time this draws, so nothing moves under a finger. The
          ochre is the state's own, as for an acceptance that failed. The
          sentence is the one what it left allows: « rien n'a changé » when
          the publication went back, which since #327 a failure past the
          publish can manage. */}
      {replaceFailure !== null && (
        <View
          style={[styles.card, styles.off]}
          testID="backup-settings-replace-failed">
          <Text style={styles.body}>
            {t(failedReplacementSentence(replaceFailure))}
          </Text>
        </View>
      )}

      {standing.standing === 'waiting' && (
        <View
          style={[styles.card, styles.unknown]}
          testID="backup-settings-waiting">
          <Text style={styles.body}>{t('backup_settings_reading')}</Text>
        </View>
      )}

      {standing.standing === 'unreadable' && (
        <View style={styles.section} testID="backup-settings-unreadable">
          <View style={[styles.card, styles.unknown]}>
            <Text style={styles.body}>{t('backup_settings_unreadable')}</Text>
          </View>
          {/* WHAT IT DOES NOT MEAN, which is the sentence that matters. A
              reading that failed says nothing about the backup, and somebody
              reading « impossible de lire l'état » will otherwise conclude
              their messages stopped being kept. */}
          <Text style={styles.note}>{t('backup_settings_unreadable_why')}</Text>
          <NotchedButton
            testID="backup-settings-retry"
            label={t('backup_settings_retry')}
            onPress={onRetry}
            wide
          />
        </View>
      )}

      {/* THE SERVER'S SILENCE, AND NOT THIS TELEPHONE'S (#323). Two failures
          that leave the backup exactly as it was, and send somebody looking
          in two different places. Neither may be rounded to the other, and
          neither may be rounded to « pas de sauvegarde ». */}
      {standing.standing === 'unchecked' && (
        <View style={styles.section} testID="backup-settings-unchecked">
          <View style={[styles.card, styles.unknown]}>
            <Text style={styles.body}>{t('backup_settings_unchecked')}</Text>
          </View>
          <Text style={styles.note}>{t('backup_settings_unchecked_why')}</Text>
          <NotchedButton
            testID="backup-settings-retry"
            label={t('backup_settings_retry')}
            onPress={onRetry}
            wide
          />
        </View>
      )}

      {standing.standing === 'sending' && (
        <View style={[styles.card, styles.on]} testID="backup-settings-state">
          <Text style={styles.body}>{t('backup_settings_on')}</Text>
          {/* LA PREUVE, DANS LA CARTE. « Vos messages sont sauvegardés » est
              une affirmation qu'il faut croire sur parole ; « 13 clés
              envoyées depuis cet appareil » est un nombre que la personne
              peut rapprocher de ce qu'elle a vécu. C'est le reste de la même
              phrase, donc c'est ici et pas dans un bloc à soi -- un troisième
              bloc flottant était précisément le défaut que #226 reproche à
              cet écran.

              Un seul nombre et pas deux. « 13 sur 13 » est une barre de
              progression finie, et le paragraphe plus bas a raison de dire
              que deux nombres qui s'accordent n'ajoutent rien. Un seul,
              avec sa provenance, est une vérification -- et sa provenance
              est cet appareil, ce que #323 corrige : la phrase disait le
              serveur en montrant le compteur local. */}
          {allBackedUp && (
            <Text style={styles.stateNote} testID="backup-settings-count">
              {t('backup_settings_count %1$d', standing.backedUp)}
            </Text>
          )}
          {/* WITH THE STATE AND NOT WITH THE CONTROL, which is a correction.
              It sat in the replace section, at the same weight as the
              sentence warning what replacing costs -- a fact about the key
              that exists and an instruction about an action, indistinguishable
              from each other. It belongs to the state: it is the rest of
              « vos messages sont sauvegardés ». */}
          <Text style={styles.stateNote} testID="backup-settings-never-shown">
            {t('backup_settings_never_shown')}
          </Text>
        </View>
      )}

      {standing.standing === 'superseded' && (
        <View
          style={[styles.card, styles.off]}
          testID="backup-settings-superseded">
          <Text style={styles.body}>{t('backup_settings_superseded')}</Text>
        </View>
      )}

      {standing.standing === 'dormant' && (
        <View
          style={[styles.card, styles.off]}
          testID="backup-settings-dormant">
          <Text style={styles.body}>{t('backup_settings_dormant')}</Text>
        </View>
      )}

      {standing.standing === 'none' && (
        <View style={[styles.card, styles.off]} testID="backup-settings-state">
          <Text style={styles.body}>{t('backup_settings_off')}</Text>
        </View>
      )}

      {/* Only while they differ. Two numbers that agree say nothing the
          sentence above has not already said, and a progress line that never
          goes away is a progress line nobody reads. */}
      {behind && standing.standing === 'sending' && (
        <View style={styles.section} testID="backup-settings-progress">
          <Text style={styles.count}>
            {t(
              'backup_settings_progress %1$d %2$d',
              standing.backedUp,
              standing.total,
            )}
          </Text>
          <Text style={styles.note}>{t('backup_settings_catching_up')}</Text>
        </View>
      )}

      {confirming && replaceable ? (
        /* THE GESTURE NOTHING TAKES BACK, IN THE FORM THIS PRODUCT ALREADY
           HAS FOR ONE. Unlike accepting -- which `BackupOffer` deliberately
           does NOT draw this way, because it is refusable and about nobody --
           replacing destroys a backup and ends a key somebody may be holding
           on paper. « Créer une nouvelle sauvegarde » comes through here for
           that reason and no other: the name is gentler and the gesture is
           the same one.
           No `target`: it is about nobody, and `Consequences` was widened for
           exactly this. */
        <Consequences
          testID="backup-replace-consequences"
          title={t('backup_replace_title')}
          lead={t('backup_replace_lead')}
          facts={[
            {
              testID: 'backup-replace-old',
              tone: 'weigh',
              said: t('backup_replace_fact_old'),
              body: t('backup_replace_old_body'),
            },
            {
              testID: 'backup-replace-new',
              tone: 'weigh',
              said: t('backup_replace_fact_new'),
              body: t('backup_replace_new_body'),
            },
          ]}
          finally={t('backup_replace_final')}>
          <NotchedButton
            testID="backup-replace-confirm"
            label={
              working === 'replace'
                ? t('backup_replace_working')
                : t('backup_replace_confirm')
            }
            onPress={() => {
              // NOT CLOSED HERE. The key screen covers everything the
              // moment it arrives, and unmounting under the finger is
              // the defect `App.tsx` records at length: the rest of the
              // gesture lands on whatever React drew underneath.
              onReplace()
            }}
            // INERT WHILE A GESTURE ON THE BACKUP RUNS (#284). A second
            // tap started a second replacement: two versions published,
            // and the keystore ending on either. The store refuses it as
            // well; this is what shows it.
            disabled={working !== null}
            wide
          />
          <NotchedButton
            testID="backup-replace-cancel"
            label={t('backup_replace_cancel')}
            onPress={() => onConfirming(false)}
            tone="quiet"
            wide
          />
        </Consequences>
      ) : (
        <>
          {standing.standing === 'sending' && (
            <View style={styles.section}>
              {/* SOUS LE CONTRÔLE, ET C'EST UN RETOURNEMENT ASSUMÉ.
                Ce qui était écrit ici disait : « BEFORE THE CONTROL. Somebody
                who reads this after tapping has been told what it costs when
                it has already cost it. » C'était juste quand ce bouton ÉTAIT
                la porte.

                Depuis #228 il ne l'est plus : taper ouvre un écran de
                conséquences qui nomme les deux pertes, marque IRRÉVERSIBLE et
                demande confirmation. **L'appui ne coûte plus rien**, donc
                l'argument qui plaçait la phrase au-dessus est tombé avec le
                défaut qu'il protégeait.

                Et la phrase a maigri d'autant. Elle disait aussi « une
                nouvelle clé sera affichée une seule fois, et l'ancienne
                cessera d'ouvrir quoi que ce soit » -- exactement les deux
                faits de l'écran de conséquences, en plus court et en moins
                clair. Il reste le QUAND, qui est ce que cet écran-ci est seul
                à pouvoir dire. #226. */}
              <NotchedButton
                testID="backup-settings-replace"
                label={t('backup_settings_replace')}
                onPress={() => onConfirming(true)}
                // Inert while an acceptance runs (#284), or a replacement
                // whose confirmation was cancelled: the store would refuse
                // the gesture this row leads to.
                disabled={working !== null}
                tone="quiet"
                wide
              />
              <Text style={styles.note} testID="backup-settings-replace-why">
                {t('backup_settings_replace_why')}
              </Text>
            </View>
          )}

          {/* THE TWO STATES WHERE A BACKUP EXISTS THAT THIS DEVICE IS NOT
              WRITING TO (#323). Both offer the same pair, and the order is
              the argument: the key opens what is already there, which is what
              somebody came for; making a new one throws that away and is the
              second answer, not the first. So the key entry carries the green
              and the other is `quiet`.

              `backup_settings_enter_current` and `backup_settings_enter_key`
              are two sentences for one door, because the two states are
              asking two different questions -- « celle qui est en cours » and
              « la mienne ». Both were validated with their state. */}
          {(standing.standing === 'superseded' ||
            standing.standing === 'dormant') && (
            <View style={styles.section}>
              <NotchedButton
                testID="backup-settings-enter-key"
                label={
                  standing.standing === 'superseded'
                    ? t('backup_settings_enter_current')
                    : t('backup_settings_enter_key')
                }
                onPress={onRestore}
                // Inert while a gesture on the backup runs (#284): the key
                // entry would cover this screen, and a failure said then
                // would land behind it, card and announcement both.
                disabled={working !== null}
                wide
              />
              <NotchedButton
                testID="backup-settings-new"
                label={t('backup_settings_new')}
                onPress={() => onConfirming(true)}
                disabled={working !== null}
                tone="quiet"
                wide
              />
            </View>
          )}

          {standing.standing === 'none' && (
            <View style={styles.section}>
              {/* The way back in after a refusal, which ADR-0013 requires to
                  exist precisely because the refusal is honoured for good: a
                  product that will not ask again owes a door somebody can
                  find. */}
              <NotchedButton
                testID="backup-settings-enable"
                label={
                  working === 'accept'
                    ? t('backup_accept_working')
                    : t('backup_settings_enable')
                }
                onPress={onEnable}
                disabled={working !== null}
                wide
              />
              {/* UNDER THE BUTTON, SO NOTHING MOVES UNDER THE FINGER (#284). A
                  second tap lands on the button again, which is what the
                  sentence asks for. The ochre is the state's own: an
                  acceptance that failed leaves this device with no backup. */}
              {failed && (
                <View
                  style={[styles.card, styles.off]}
                  testID="backup-settings-failed">
                  <Text style={styles.body}>{t('backup_accept_failed')}</Text>
                </View>
              )}
            </View>
          )}
        </>
      )}
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
  back: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
  },
  backLabel: {
    ...type.titleMd,
    color: color.brand.green700,
  },
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  card: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
  },
  // Green once, on the state that is working: invariant 3 spends it on the
  // strongest state and nowhere else on a screen.
  on: {
    backgroundColor: color.brand.green100,
    borderLeftColor: color.brand.green500,
  },
  // Ochre, not red. Nothing is wrong with a device that has no backup — it
  // is the state every device starts in, and a warning colour here would be
  // the product frightening somebody into a decision.
  off: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  // Neither green nor ochre: this is the colour of not knowing, and the two
  // states it must not be mistaken for are the ones that do know.
  unknown: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  body: {
    ...type.body,
    color: color.neutral['900'],
  },
  // Inside the state card, under the sentence it belongs to. Lighter than
  // the sentence above it and on the same ground, so it reads as the rest of
  // that fact rather than as a second one.
  stateNote: {
    ...type.caption,
    color: color.neutral['600'],
    marginTop: space.s,
  },
  section: {
    gap: space.s,
  },
  count: {
    ...type.bodySm,
    color: color.neutral['900'],
  },
  note: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
