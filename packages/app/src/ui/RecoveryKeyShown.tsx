import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, layout, space, stroke, type } from '../design/tokens'
import { NotchedButton } from './NotchedButton'

/**
 * The recovery key, once.
 *
 * # WHY ONCE, AND WHY IT CAN STILL BE REPLACED
 *
 * ADR-0013: *« Elle est montrée une fois et jamais plus, et elle peut être
 * remplacée. »* Showing it again means anybody holding an unlocked telephone
 * can read it. Never being able to replace it condemns whoever wrote it down
 * badly, and they find out at the worst moment — so #220 puts a replacement
 * in Réglages, which makes a new version and retires the old key.
 *
 * This screen therefore says the key will not be shown again **before** the
 * button that leaves it, and not after.
 *
 * # COPY, NOT WRITE DOWN
 *
 * The key is 256 bits in base58 — some forty characters. ADR-0013 settled
 * that against a six-word phrase with arithmetic rather than taste: six words
 * from a list of 7,776 carry 77 bits, and carrying 256 would need a list of
 * four thousand billion words. What that costs is that the screen says
 * *« copiez ceci »* rather than *« notez ces six mots »*, which is less
 * handsome and truer to where a secret like this survives: a password
 * manager, not a piece of paper.
 *
 * # THE GROUPS OF FOUR ARE THE BRIDGE'S, NOT THIS SCREEN'S
 *
 * `createKeyBackup` hands the key back already grouped, which is the form the
 * specification shows. This component neither adds nor removes the spaces:
 * regrouping here would be a second place that decides what the value looks
 * like, and the two would drift. What it does is let the text wrap on them,
 * so a forty-character secret is readable on a telephone.
 *
 * # WHY THE COPY IS THE CALLER'S
 *
 * `onCopy` rather than a clipboard call in here. This component is drawn in
 * tests with no native module, and the one place the application talks to the
 * clipboard should stay one place — the same split every other screen here
 * keeps for anything native.
 *
 * The confirmation is local state, because it is about this render and
 * nothing outside it needs to know a person tapped Copy.
 *
 * # WHAT THIS SCREEN DOES NOT HAVE
 *
 * A way back. There is nothing to go back to: the backup exists on the
 * homeserver by the time this is drawn, and leaving without the key would
 * leave somebody with a backup they cannot open and no way to see the key
 * again. The one action is forward, and it says what it means — *« J'ai rangé
 * ma clé »* rather than *« Continuer »*, which is a claim the person makes
 * rather than a step the product takes.
 */
export function RecoveryKeyShown({
  recoveryKey,
  oldStillOpens = false,
  onCopy,
  onDone,
}: {
  /** As `createKeyBackup` handed it back: base58, in groups of four. */
  readonly recoveryKey: string
  /**
   * Puts it on the clipboard.
   *
   * Returns nothing, and the confirmation below is shown whether or not the
   * clipboard took it. That is a real limitation rather than an oversight:
   * `@react-native-clipboard/clipboard` reports no failure, so a screen that
   * claimed to know would be inventing the answer. What covers the gap is
   * the value staying on screen and selectable, so somebody can check what
   * they pasted and take it by hand if it is not there.
   */
  readonly onCopy: () => void
  /**
   * Whether a replacement left the old key opening the old backup.
   *
   * Only a replacement can set it, and only when the retirement failed --
   * see `replaceBackup.ts`. It is carried all the way to this screen rather
   * than logged, because the person standing here is the only one who can
   * act on it and the sentence they would otherwise read is « c'est fait ».
   */
  readonly oldStillOpens?: boolean
  readonly onDone: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <View style={styles.screen} testID="recovery-key">
      <Text style={styles.title}>{t('backup_key_title')}</Text>
      <Text style={styles.lead}>{t('backup_key_lead')}</Text>

      {/* `selectable`, so somebody whose clipboard button fails — or who
          simply does not trust it — can still take the value by hand. The
          one screen in this product where being unable to get the value out
          is a permanent loss. */}
      <Text style={styles.key} testID="recovery-key-value" selectable>
        {recoveryKey}
      </Text>

      {/* BEFORE THE BUTTON THAT LEAVES, not after. A person who reads this
          after tapping has been told something they can no longer act on. */}
      <View style={[styles.card, styles.weigh]} testID="recovery-key-once">
        <Text style={styles.body}>{t('backup_key_once')}</Text>
      </View>

      {/* THE HALF THAT DID NOT WORK, SAID ON THE SCREEN THAT CELEBRATES THE
          HALF THAT DID. A replacement whose retirement failed hands back a
          working new key AND leaves the old one opening the old backup.
          Somebody replaces a key precisely because they have lost track of
          it, so this is the sentence the whole gesture was about. */}
      {oldStillOpens && (
        <View
          style={[styles.card, styles.weigh]}
          testID="recovery-key-old-still-opens">
          <Text style={styles.body}>{t('backup_key_old_still_opens')}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <NotchedButton
          testID="recovery-key-copy"
          label={t('backup_key_copy')}
          onPress={() => {
            onCopy()
            setCopied(true)
          }}
          wide
        />
        {copied && (
          <Text style={styles.copied} testID="recovery-key-copied">
            {t('backup_key_copied')}
          </Text>
        )}
        {/* `quiet` and not `brand`: the green is already spent on Copy, which
            is the principal action of this screen. Leaving is what happens
            once the person has done the thing the screen exists for. */}
        <NotchedButton
          testID="recovery-key-done"
          label={t('backup_key_done')}
          onPress={onDone}
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
  title: {
    ...type.titleLg,
    color: color.neutral['900'],
  },
  lead: {
    ...type.body,
    color: color.neutral['600'],
  },
  // The value itself, on the sunk ground so it reads as a thing rather than
  // as prose, at the size of a heading because it is what the screen is for.
  //
  // No letter-spacing of its own. It had one, hand-picked, to help whoever
  // copies the value by eye -- and invariant 11 refuses a type value written
  // in place, correctly: `titleMd` already carries a tracking chosen for this
  // family, and a number invented here would be this file disagreeing with
  // the type scale about one string. What makes a base58 secret readable is
  // already done twice over -- the alphabet excludes the glyphs that confuse
  // (`0`, `O`, `I`, `l`), and the bridge hands the value back in groups of
  // four.
  key: {
    ...type.titleMd,
    color: color.neutral['900'],
    backgroundColor: color.surface.sunk,
    padding: space.m,
  },
  card: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
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
  copied: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
