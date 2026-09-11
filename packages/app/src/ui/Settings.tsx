import React from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'

import { t } from '../copy'
import type { Language } from '../copy/languages'
import { color, floors, layout, space, stroke, type } from '../design/tokens'
import { LanguagePicker } from './LanguagePicker'

/**
 * Settings.
 *
 * The prototype specifies six sections at full desktop parity (screen 19,
 * `product-spec.md` §13.18). This lot builds the sections its own features
 * need, and **the rest are absent rather than present and inert** — which is
 * the ticket's own criterion and the harder discipline: a greyed row for a
 * setting nothing implements looks like a feature that is coming, and the
 * only honest version of "not built" is nothing at all plus a sentence saying
 * so.
 *
 * That sentence matters more than it looks. §13.19 invariant 9 says a
 * capability *locked by a room policy* stays visible and greyed with its
 * reason — and that is a different case from this one. Something switched off
 * by a policy exists; something not built does not, and dressing the second as
 * the first would be a lie the invariant never asked for.
 *
 * # Why the legal row is not one row among several
 *
 * It is the reason this screen exists at all. The conditions published at
 * messagr.eu say the article 14 information is carried by a screen reachable
 * *from Settings*, so Settings is load-bearing for a published legal claim
 * before it is load-bearing for any preference.
 */
export function Settings({
  onBack,
  onLegal,
  onBackup,
  onFavourites,
  receipts,
  onReceipts,
  receiptsNotKept,
  language,
  onLanguage,
  onLanguageSettled,
  wake,
  onWake,
  wakeNotKept,
  onRingFullScreen,
  onRingWhileQuiet,
}: {
  readonly onBack: () => void
  readonly onLegal: () => void
  /**
   * The way to the state of the key backup.
   *
   * ADR-0013 puts it here and nowhere else: after the one soft prompt, *« une
   * ligne dans Réglages et rien d'autre »*. It is also the door a refusal
   * honoured for good owes somebody — a product that will not ask again has
   * to leave a way in that can be found.
   */
  readonly onBackup: () => void
  /**
   * The way to the messages somebody kept.
   *
   * Here rather than in a fifth tab, which `TabBar.tsx` forbids, and rather
   * than in a conversation's own menu, which would scope to one conversation
   * something that crosses them. See `Favourites.tsx`.
   */
  readonly onFavourites: () => void
  readonly receipts: boolean
  readonly onReceipts: (on: boolean) => void
  /** `true` when the last change could not be kept. */
  readonly receiptsNotKept: boolean
  /** Opens Android's own screen for the full-screen intent. Android only. */
  readonly onRingFullScreen: () => void
  /** Opens the system's Do Not Disturb access screen. */
  readonly onRingWhileQuiet: () => void
  /** Which language is spoken, and changing it. Same control as #103's. */
  readonly language: Language
  readonly onLanguage: (language: Language) => void
  /** Called when the strip stops. Only this one persists. */
  readonly onLanguageSettled: (language: Language) => void
  /** Whether this device asks to be woken. See `wakeSetting.ts`. */
  readonly wake: boolean
  readonly onWake: (on: boolean) => void
  readonly wakeNotKept: boolean
}) {
  return (
    <View style={styles.screen} testID="settings">
      <Pressable
        testID="settings-back"
        onPress={onBack}
        accessibilityRole="button"
        style={styles.back}>
        <Text style={styles.backLabel}>{`← ${t('list_title')}`}</Text>
      </Pressable>

      <Text style={styles.title}>{t('settings_title')}</Text>

      <Pressable
        testID="settings-favourites"
        onPress={onFavourites}
        accessibilityRole="button"
        accessibilityLabel={t('settings_favourites')}
        style={[styles.rowLayout, styles.divider]}>
        <Text style={styles.rowLabel}>{t('settings_favourites')}</Text>
      </Pressable>

      {/* Above the legal row: this one is about whether somebody keeps
          their messages, and the rows are in the order of what a person came
          looking for. */}
      <Pressable
        testID="settings-backup"
        onPress={onBackup}
        accessibilityRole="button"
        accessibilityLabel={t('settings_backup')}
        style={[styles.rowLayout, styles.divider]}>
        <Text style={styles.rowLabel}>{t('settings_backup')}</Text>
      </Pressable>

      <Pressable
        testID="settings-legal"
        onPress={onLegal}
        accessibilityRole="button"
        accessibilityLabel={t('settings_legal')}
        style={[styles.rowLayout, styles.divider]}>
        <Text style={styles.rowLabel}>{t('settings_legal')}</Text>
      </Pressable>

      {/* CHOOSING A LANGUAGE ONCE AND HAVING NO WAY TO CHANGE IT is a
          reinstall as a correction, so it is here as well as on the first
          screen -- and it is the same control in both places, because two
          shapes for one gesture would be two controls. */}
      <View style={[styles.setting, styles.divider]} testID="setting-language">
        <Text style={styles.rowLabel}>{t('settings_row_lang_label')}</Text>
        {/* THE SAME CONTROL AS THE FIRST SCREEN, and now one anybody can
            find: a row saying which language is on, and a list when it is
            tapped. `LanguagePicker.tsx` says why the scrolling strip that
            stood here was replaced. */}
        <LanguagePicker
          chosen={language}
          onChoose={onLanguage}
          onSettle={onLanguageSettled}
          testID="settings-language-picker"
        />
      </View>

      {/* The one setting this lot's own features need. Its hint says what
          turning it on costs rather than what it does: everybody knows what a
          read receipt does, and nobody is told who else finds out. */}
      <View style={[styles.setting, styles.divider]} testID="setting-receipts">
        <View style={styles.rowLayout}>
          <Text style={styles.rowLabel}>{t('settings_receipts')}</Text>
          <Switch
            testID="toggle-receipts"
            value={receipts}
            onValueChange={onReceipts}
            accessibilityLabel={t('settings_receipts')}
            trackColor={SWITCH_TRACK}
            thumbColor={color.surface.paper}
          />
        </View>
        <Text style={styles.hint}>{t('settings_receipts_hint')}</Text>
        {receiptsNotKept && (
          <Text style={styles.notKept}>{t('settings_receipts_not_kept')}</Text>
        )}
      </View>

      {/* THE OPPOSITE DEFAULT FROM THE ONE ABOVE, AND FOR THE OPPOSITE
          REASON. A read receipt publishes something about a person; a wake
          publishes nothing -- `wakeSetting.ts` sets out why one is off and
          the other on. The hint says what crosses and what does not, because
          "notifications" is the setting people most reasonably assume leaks
          their messages. */}
      <View style={[styles.setting, styles.divider]} testID="setting-wake">
        <View style={styles.rowLayout}>
          <Text style={styles.rowLabel}>{t('settings_wake')}</Text>
          <Switch
            testID="toggle-wake"
            value={wake}
            onValueChange={onWake}
            accessibilityLabel={t('settings_wake')}
            trackColor={SWITCH_TRACK}
            thumbColor={color.surface.paper}
          />
        </View>
        <Text style={styles.hint}>{t('settings_wake_hint')}</Text>
        {wakeNotKept && (
          <Text style={styles.notKept}>{t('settings_wake_not_kept')}</Text>
        )}
      </View>

      {/* ANDROID REFUSES TO LIGHT THE SCREEN, AND ONLY THE PERSON CAN LIFT
          THAT.
          A ringing call asks for a full-screen intent -- the thing that
          wakes the display and puts the call in front of somebody instead of
          adding a line to a lock screen. Android 14 grants that at
          installation only to applications registered as the telephone or
          the alarm clock, and refuses it to everybody else: measured on the
          demonstration Pixel, `USE_FULL_SCREEN_INTENT: default; rejectTime`
          at the exact second a call rang.

          THIS ROW DOES NOT KNOW WHETHER IT IS NEEDED, and says so by not
          claiming otherwise. Neither notifee nor React Native can read that
          permission back, so a row that appeared only when it was missing
          would be a row guessing. It is an offer, phrased as one, rather
          than a warning about a state nothing here can see.

          Android only. On iOS a call notification interrupts by category and
          there is nothing to ask for. */}
      {Platform.OS === 'android' && (
        <View
          style={[styles.setting, styles.divider]}
          testID="setting-full-screen">
          <Pressable
            testID="open-full-screen-settings"
            onPress={onRingFullScreen}
            accessibilityRole="button"
            accessibilityLabel={t('settings_full_screen')}
            style={styles.rowLayout}>
            <Text style={styles.rowLabel}>{t('settings_full_screen')}</Text>
            <Text style={styles.rowAction}>{t('settings_open')}</Text>
          </Pressable>
          <Text style={styles.hint}>{t('settings_full_screen_hint')}</Text>
        </View>
      )}

      {/* AND THE OTHER HALF OF THE SAME PROBLEM.
          A telephone that rings only when nothing is set to silence it is
          not a telephone. Measured on the demonstration Pixel during the
          first real call between two people: every notification the
          application posted was intercepted by Do Not Disturb, and so was
          Google's own dialer's. The category "call" does not get past that
          mode -- only a channel the person has allowed does, and allowing
          one is a switch on a system screen.

          An offer rather than a warning, exactly like the row above: nothing
          here can see whether the access was granted, so a row that appeared
          only when it was missing would be a row guessing.

          Android only. iOS has its own answer -- an interruption level on
          the notification -- and no screen to send anybody to. */}
      {Platform.OS === 'android' && (
        <View style={[styles.setting, styles.divider]} testID="setting-disturb">
          <Pressable
            testID="open-disturb-settings"
            onPress={onRingWhileQuiet}
            accessibilityRole="button"
            accessibilityLabel={t('settings_disturb')}
            style={styles.rowLayout}>
            <Text style={styles.rowLabel}>{t('settings_disturb')}</Text>
            <Text style={styles.rowAction}>{t('settings_open')}</Text>
          </Pressable>
          <Text style={styles.hint}>{t('settings_disturb_hint')}</Text>
        </View>
      )}

      <Text style={styles.nothingElse}>{t('settings_nothing_else')}</Text>
    </View>
  )
}

/**
 * THE STATE IS THE SWITCH NOW, NOT A WORD BESIDE IT.
 *
 * Both settings were a pressable row with « Activés » / « Désactivés »
 * written on the right -- readable, and nothing anybody recognises as a
 * control. The platform's own switch is what a person reaches for, it
 * announces itself to a screen reader without being told, and it makes the
 * first word of each hint redundant, which is half of why the hints could be
 * cut in two.
 *
 * `green500` is the brand's action colour, and the track is the only place
 * this screen carries one.
 */
const SWITCH_TRACK = {
  false: color.neutral['300'],
  true: color.brand.green500,
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface.paper,
    paddingHorizontal: layout.screenGutter,
    gap: space.l,
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
  },
  // A ROW, WHICH IT WAS NOT. It had `justifyContent: 'center'` and no
  // direction, so every child stacked: each switch sat under its own label
  // and each "Ouvrir" under its own title, right-aligned, looking like a
  // second setting. Reported from the Pixel with a screenshot -- « aligner
  // verticalement les textes et les toggles ».
  //
  // `space-between` is what puts the control at the far edge, and
  // `alignItems: 'center'` is what lines it up with the words it belongs to.
  //
  // THE LINE IS NOT PART OF IT ANY MORE, and that is the second correction
  // this style has needed. See `divider` below.
  rowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.m,
    minHeight: floors.touchTargetMin,
  },
  // ONE LINE BETWEEN TWO THINGS, AND IT LEADS THE SECOND.
  //
  // It was `borderTopWidth` AND `borderBottomWidth` on every row, which
  // draws TWO adjacent hairlines between any two consecutive rows. Three
  // rows in a column carried four lines, two of them double the weight of
  // the others -- on a screen whose entire rhythm is separators, and next to
  // a language block that carried none at all.
  //
  // A leading divider also settles what a line MEANS: everything below one
  // and above the next is one setting. The hint under a switch used to sit
  // beneath its own row's bottom border, equidistant from the setting it
  // explains and the one after it -- the same detachment the backup screen
  // had between a warning and the control it warns about, and the same fix.
  //
  // Composed rather than folded into the two styles that want it: a `row`
  // carrying its own line is exactly what could not be reused inside a
  // group, which is how the doubling got in.
  divider: {
    borderTopWidth: stroke.hairline.value,
    borderColor: color.neutral['200'],
  },
  // `flexShrink` so a long title gives way to the control rather than
  // pushing it off the edge.
  rowLabel: {
    flexShrink: 1,
    ...type.titleMd,
    color: color.neutral['900'],
  },
  // `paddingBottom` so a hint does not sit flush against the next line: the
  // gap under a setting is what tells it apart from the one below.
  setting: { gap: space.s, paddingBottom: space.s },
  rowValue: {
    ...type.bodySm,
    color: color.neutral['600'],
  },
  rowAction: {
    ...type.action,
    color: color.brand.green700,
  },
  hint: {
    ...type.caption,
    color: color.neutral['600'],
  },
  notKept: {
    ...type.caption,
    color: color.deny['700'],
  },
  nothingElse: {
    ...type.caption,
    color: color.neutral['600'],
  },
})
