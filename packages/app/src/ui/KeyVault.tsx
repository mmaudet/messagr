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
 * The second route of ADR-0013: a file, for somebody with a reason to want
 * no key material on a server at all.
 *
 * # WHAT THE SCREEN OWES, IN THE ORDER IT IS READ
 *
 * **What it is** comes first, because « coffre de clés » is not a phrase
 * anybody arrives already knowing.
 *
 * **That any Matrix client opens it** comes second, and it is the sentence
 * the whole feature exists for. A draft ADR wanted to close this file with
 * the recovery key so there would be one secret instead of two; that would
 * make a vault only Messagr can open, which is the opposite of what this
 * product claims to be — and the exact reason the bridge's author refused to
 * write `exportSecrets`.
 *
 * **What it is worth** comes third and is not softened: this file opens
 * everything that was ever said, and it is worth what the place it is put is
 * worth. That is the whole of the bargain somebody is taking on.
 *
 * **That it is not a data export** comes last, and it is here because the
 * two are one screen apart in Réglages and the difference is a legal claim
 * rather than a nuance: a vault holds keys, an export holds messages.
 * Somebody handed a vault has not received their data, they have received
 * the means to read it. This repository has had to correct a published
 * statement that overreached twice; it is not going to make a third by
 * letting a screen imply this is a GDPR export.
 *
 * # THE PASSPHRASE IS NOT JUDGED
 *
 * No length, no class of character, no meter. The bridge derives a key over
 * half a million PBKDF2 iterations and has no opinion about the shape of
 * what it is given; neither has this. A rule invented here would be this
 * product telling somebody how to protect a file it will never see again —
 * and it would be enforced in exactly one of the clients that can open it.
 *
 * What is said instead is the thing a rule cannot say: keep it somewhere
 * other than the recovery key, because two secrets kept in one place are one
 * secret.
 *
 * # IT TAKES A NOTICEABLE MOMENT, BY DESIGN
 *
 * Half a million iterations is the point rather than an inefficiency: the
 * same work is what makes a guess expensive for whoever ends up with the
 * file. The bridge's own doc says « show that something is happening », and
 * `vault_working` is that.
 */
/** What opening a vault answered. `null` is a dismissed picker: say nothing. */
export type VaultOpening =
  | { readonly imported: number }
  | 'wrong-passphrase'
  | 'not-a-vault'
  | 'failed'
  | null

export function KeyVault({
  onCreate,
  onOpen,
  onCancel,
}: {
  /** Answers a reason when it did not go, or nothing when it did. */
  readonly onCreate: (passphrase: string) => Promise<string | null>
  /** Chooses a file and opens it with the passphrase given. */
  readonly onOpen: (passphrase: string) => Promise<VaultOpening>
  readonly onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)
  /**
   * What opening answered, once it has.
   *
   * ONE FIELD FOR BOTH GESTURES, and that is the screen's own argument: the
   * passphrase above belongs to whichever the person is doing. Two fields
   * would ask them to know, before they have done anything, which of the two
   * they came for — and the honest answer is that they came with a file or
   * without one.
   */
  const [opened, setOpened] = useState<VaultOpening>(null)

  const create = () => {
    const passphrase = draft
    if (passphrase === '' || working) return
    setWorking(true)
    setFailed(false)
    onCreate(passphrase)
      .then(reason => {
        setFailed(reason !== null)
        setWorking(false)
      })
      .catch(() => {
        setFailed(true)
        setWorking(false)
      })
  }

  const open = () => {
    const passphrase = draft
    if (passphrase === '' || working) return
    setWorking(true)
    setFailed(false)
    setOpened(null)
    onOpen(passphrase)
      .then(answer => {
        setOpened(answer)
        setWorking(false)
      })
      .catch(() => {
        setOpened('failed')
        setWorking(false)
      })
  }

  return (
    <View style={styles.screen} testID="key-vault">
      <Text style={styles.title}>{t('vault_title')}</Text>
      <Text style={styles.lead}>{t('vault_lead')}</Text>

      {/* THE SENTENCE THE FEATURE EXISTS FOR. Plain ground, because it is
          simply true and nothing is being weighed. */}
      <View style={[styles.card, styles.plain]} testID="vault-standard">
        <Text style={styles.body}>{t('vault_standard')}</Text>
      </View>

      {/* Ochre: something to hold before deciding, the same tone `Trust.tsx`
          and `BackupOffer.tsx` spend on exactly that. */}
      <View style={[styles.card, styles.weigh]} testID="vault-worth">
        <Text style={styles.body}>{t('vault_worth')}</Text>
      </View>

      <View style={[styles.card, styles.plain]} testID="vault-not-export">
        <Text style={styles.body}>{t('vault_not_export')}</Text>
      </View>

      <TextInput
        testID="vault-passphrase"
        value={draft}
        onChangeText={setDraft}
        placeholder={t('vault_passphrase_field')}
        placeholderTextColor={color.neutral['400']}
        style={styles.field}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onSubmitEditing={create}
        returnKeyType="done"
      />
      <Text style={styles.note}>{t('vault_passphrase_hint')}</Text>
      <Text style={styles.note}>{t('vault_open_lead')}</Text>

      {opened !== null && typeof opened === 'object' && (
        <View
          style={[
            styles.card,
            opened.imported > 0 ? styles.came : styles.plain,
          ]}
          testID="vault-opened">
          <Text style={styles.body}>
            {opened.imported > 0
              ? t('vault_opened %1$d', opened.imported)
              : t('vault_opened_none')}
          </Text>
        </View>
      )}

      {typeof opened === 'string' && (
        <View style={[styles.card, styles.weigh]} testID="vault-open-failed">
          <Text style={styles.body}>
            {opened === 'wrong-passphrase'
              ? t('vault_open_wrong')
              : opened === 'not-a-vault'
                ? t('vault_open_not_a_vault')
                : t('vault_open_failed')}
          </Text>
        </View>
      )}

      {failed && (
        <View style={[styles.card, styles.weigh]} testID="vault-failed">
          <Text style={styles.body}>{t('vault_failed')}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <NotchedButton
          testID="vault-create"
          label={working ? t('vault_working') : t('vault_create')}
          onPress={create}
          wide
        />
        {/* THE OTHER GESTURE, AND IT IS `quiet`. Making a vault is what
            somebody came to Réglages for; opening one is what somebody
            arriving with a file came for. Both are here because they are the
            same subject and the same passphrase field, and giving the second
            its own screen would mean a second place the format is
            explained. */}
        <NotchedButton
          testID="vault-open"
          label={working ? t('vault_open_working') : t('vault_open_choose')}
          onPress={open}
          tone="quiet"
          wide
        />
        <NotchedButton
          testID="vault-cancel"
          label={t('vault_cancel')}
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
  card: { padding: space.m, borderLeftWidth: stroke.accent },
  weigh: {
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  plain: {
    backgroundColor: color.surface.sunk,
    borderLeftColor: color.neutral['300'],
  },
  body: { ...type.bodySm, color: color.neutral['900'] },
  // The same field `GiveName.tsx` draws: the same gesture, typing something
  // the application will use once and not keep.
  field: {
    ...type.body,
    color: color.neutral['900'],
    backgroundColor: color.surface.raised,
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
    borderRadius: radius.bubble,
    minHeight: floors.touchTargetMin,
    paddingHorizontal: space.m,
  },
  note: { ...type.caption, color: color.neutral['600'] },
  // Green once, on the one outcome of this screen where keys came back.
  came: {
    backgroundColor: color.brand.green100,
    borderLeftColor: color.brand.green500,
  },
  actions: { marginTop: space.m, gap: space.s },
})
