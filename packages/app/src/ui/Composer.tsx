import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '../copy'
import {
  color,
  floors,
  layout,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import { TabIcon } from './TabIcon'

/**
 * The input bar, above the tabs.
 *
 * # Its shape is the account holder's, from a screenshot
 *
 * A rounded field carrying the emoji control on its left and the camera on
 * its right, and a round green button outside it. That is the arrangement
 * asked for, and it is the arrangement most people already have their thumbs
 * trained on.
 *
 * # THE FIELD TAKES SEVERAL LINES, AND THAT IS WHY THERE IS A SEND BUTTON
 *
 * This said "there is no send button. The return key sends. Asked for
 * outright." Then a second thing was asked for outright -- « le champ doit
 * pouvoir accepter les retours à la ligne et donc on doit pouvoir naviguer
 * dans le champ de saisie » -- and the two cannot both be true of one key.
 * A return that sends is a return that cannot make a paragraph.
 *
 * So the round button carries the send now, and it does it **without the bar
 * moving**, which was the whole reason that place was reserved. Empty, it is
 * the microphone it always was: grey, V2, and it says so when tapped. With
 * something written in it, it is green and it sends. The place never changes,
 * only what stands in it -- which is what every messenger does and what
 * anybody's thumb already expects.
 *
 * `state.disabled` is normative and the microphone follows it exactly:
 * `neutral.200` plate, `neutral.300` glyph, **no opacity** -- the token
 * forbids it, because a global opacity greys the reason too and makes
 * contrast depend on the ground. And it keeps its reason, which a tap reveals
 * rather than a line of permanent noise above every conversation.
 *
 * # HOW TALL THE FIELD GETS
 *
 * It grows with what is typed and stops at `TALLEST_FIELD`, after which it
 * scrolls inside itself. A field that grew without a bound would push the
 * conversation off the top of its own screen, which is the failure mode of
 * every composer that forgets to stop.
 *
 * **The field measures itself and this component sets no height.** It used
 * to: a `grown` state fed from `onContentSizeChange` and written back as an
 * explicit `height`. That state caused a report from iOS on 10 September
 * 2026 -- *« le composeur ne grandit pas pendant la frappe et grandit après
 * l'envoi »* -- and both halves have one cause, which is in React Native's
 * source rather than in a guess.
 *
 * On the new architecture iOS emits `onContentSizeChange` **only from
 * `updateLayoutMetrics:`** (`RCTTextInputComponentView.mm`, the
 * `CGSizeEqualToSize` guard). An explicit height freezes the layout, so the
 * metrics stop changing, so the event that would have grown the field is
 * killed by what it itself produced. Sending removed the height, the layout
 * moved again, and the event fired at last -- carrying a measurement for
 * text that had just gone.
 *
 * Nothing is needed in its place. `BaseTextInputShadowNode::measureContent`
 * runs the attributed string through the text layout manager and clamps the
 * result to the layout constraints, so an unpinned field sizes itself and
 * `maxHeight` in `styles.input` is the only bound it needs.
 *
 * # WHY REMOVING IT DOES NOT BRING BACK THE PIXEL'S BUG
 *
 * The state was introduced because a Pixel *« gardait une barre de trois
 * lignes au-dessus d'un champ vide »*, and removing something that was put
 * there for a reason deserves more than an argument.
 *
 * Measured on an Android emulator on 11 September 2026, through
 * `uiautomator dump` so the numbers are the view's own rather than an
 * impression: with the height pinned the field reads 95 pixels empty and 210
 * with eighty characters in it; **with the pinning removed it reads 98 and
 * 210**. Android grows either way, so the pin was buying nothing there.
 *
 * The first attempt at that measurement said the opposite -- 98 and 98, no
 * growth at all -- and it was wrong: `adb shell input text` silently
 * truncates a long string, so the field being measured held nine characters
 * rather than eighty. It was caught by running the *unchanged* code through
 * the same apparatus and getting the same wrong answer. A control is what
 * turned a plausible finding into a broken measurement, and it is worth
 * recording that it was nearly believed.
 *
 * The half that hand-driving could not reach is what happens after the
 * message goes, because the send button stops responding once the
 * application is driven through a development bundle. `e2e/boot.test.ts`
 * asserts it instead, on a real build: four lines typed, sent, and the
 * height back within a point of where it started.
 *
 * # ONE CONTROL, AND THE MEASUREMENT THAT DECIDED IT
 *
 * This said « no paperclip » while photographs were all that could be sent.
 * #111 built the other half, and the first attempt put a second button in
 * the field beside the camera -- one icon per kind, each saying what it
 * opens.
 *
 * **It cost the field a line of text, and `boot.test.ts` caught it.** Each
 * control takes exactly the minimum touch target, so a second one narrows
 * the input from 603 to 488 pixels, and at that width « Je passe te prendre
 * à 18h » -- twenty-five characters -- wraps onto two lines while somebody
 * types it. Measured on an emulator through `uiautomator dump`: 98 pixels
 * empty, 154 with that sentence in it. The suite found it sideways, through
 * the baseline of the height test, which had been reading a one-line field
 * and started reading a two-line one.
 *
 * So there is one control again, and it opens a choice. The glyph is `plus`
 * rather than a camera, because a camera opening a document picker would be
 * the control lying about what it does -- and `plus` is what stood here
 * before the camera existed (#112). A paperclip would say « attach
 * something », which is now exactly true, and the identity has none; the
 * choice panel says which kind in words rather than in a second pictogram.
 *
 * # The emoji panel is a panel, not a keyboard
 *
 * A full picker is its own screen and its own search. This is the set people
 * reach for, inserted at the caret's end, and the keyboard's own emoji key
 * still does everything this does not. Written down so the next person knows
 * it is a floor rather than an attempt at a ceiling.
 */

/**
 * How tall the field is allowed to grow: five lines of `body`, plus the
 * padding above and below. Past that it scrolls inside itself.
 */
const TALLEST_FIELD = typeScale.body.lineHeight * 5 + space.s * 2

/** What a hand reaches for. Not a Unicode inventory. */
const OFFERED = [
  '😀',
  '😅',
  '😂',
  '🥰',
  '😍',
  '😊',
  '👍',
  '🙏',
  '❤️',
  '🎉',
  '🔥',
  '👀',
  '😮',
  '😢',
  '😡',
  '🤔',
  '✅',
  '❌',
  '☕',
  '🍽️',
  '🚗',
  '🏠',
  '⏰',
  '💬',
] as const

export function Composer({
  onSend,
  onAttach,
  onAttachDocument,
}: {
  readonly onSend: (body: string) => void
  /** Choosing a photograph. Absent on a build with no picker. */
  readonly onAttach?: () => void
  /** Choosing a document. Absent on a build with no picker. */
  readonly onAttachDocument?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [whyDisabled, setWhyDisabled] = useState(false)
  /**
   * LA BARRE DE NAVIGATION PASSAIT PAR-DESSUS CE COMPOSEUR, ET FERMAIT LA
   * CONVERSATION.
   *
   * `App.tsx` prend `edges={['left', 'right']}` : le bord bas n'est pas
   * réservé, **parce que la barre d'onglets est censée se poser contre le bas
   * de l'écran**. C'est juste pour la liste. Ça ne l'est pas ici, où il n'y a
   * pas de barre d'onglets et où c'est ce composeur qui occupe le bas.
   *
   * Et `MainActivity` ne compense rien : il décale la vue de
   * `WindowInsetsCompat.Type.ime()`, qui vaut zéro clavier baissé. Son propre
   * commentaire le dit — « tant que le clavier est levé la barre de navigation
   * est derrière lui, donc il n'y a rien à réserver ». Exact, et c'est
   * exactement pourquoi le défaut ne se voit que clavier **baissé**,
   * c'est-à-dire au moment où l'on tend la main vers l'emoji.
   *
   * Le résultat sur un Android à trois boutons : le rond de l'emoji et le
   * bouton appareil photo sont derrière les boutons du système. Viser l'emoji
   * presse Retour et ferme la conversation.
   *
   * PROUVÉ PAR DEUX CAPTURES, pas par un raisonnement : #255 encadre le geste,
   * et les images montrent la conversation avant et la liste après. Quatre
   * hypothèses s'étaient succédé avant elles, dont une que j'avais publiée.
   *
   * RÉSERVÉ ICI ET PAS DANS `MainActivity` : y toucher remonterait aussi la
   * barre d'onglets, ce que le commentaire cité plus haut dit être un choix.
   * Le composeur n'est pas la barre d'onglets, et c'est la distinction que le
   * trou a révélée.
   *
   * CE QUE ÇA COÛTE, DIT PLUTÔT QUE TU : clavier levé, la vue est déjà
   * décalée de toute la hauteur du clavier, barre de navigation comprise. Ce
   * rembourrage s'ajoute alors, et laisse une bande de la hauteur de la barre
   * entre les commandes et le clavier. C'est laid et c'est réparable ; un
   * bouton qu'on ne peut pas viser sans perdre sa conversation ne l'est pas.
   */
  const insets = useSafeAreaInsets()
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // This read `useColorScheme()` and switched to `color.dark`. Four
  // components did, and nothing else in the application does -- so on a
  // phone set to dark mode these four turned dark inside screens that stayed
  // pale: a black composer under a paper conversation, reported from an
  // iPhone on 7 September 2026 with the words "meme pb de fond".
  //
  // The application has a light palette and a dark one reserved for surfaces
  // that ASK for it -- the promise screen, a photograph full screen. Which
  // ground a component sits on is its parent's business, which is why
  // `LanguagePicker` takes `onDark` and does not guess. A component that reads
  // the system theme is guessing, and it guessed wrong here.
  const palette = color

  function send() {
    const body = draft.trim()
    if (body === '') return
    setDraft('')
    setEmojiOpen(false)
    onSend(body)
  }

  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: palette.surface.paper,
          borderTopColor: palette.neutral['200'],
          // Ajouté au rembourrage de `dock` plutôt que de le remplacer : la
          // barre de navigation dit de quoi s'écarter, pas à quoi ressembler.
          // Un appareil sans barre rend zéro et la mise en page ne bouge pas.
          paddingBottom: space.s + insets.bottom,
        },
      ]}
      testID="composer">
      {emojiOpen && (
        <View style={styles.panel} testID="emoji-panel">
          {OFFERED.map(emoji => (
            <Pressable
              key={emoji}
              testID={`emoji-${emoji}`}
              onPress={() => setDraft(held => held + emoji)}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              style={styles.emojiSlot}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {attachOpen && (
        <View style={styles.attachPanel} testID="attach-panel">
          {onAttach !== undefined && (
            <Pressable
              testID="attach-photo"
              onPress={() => {
                setAttachOpen(false)
                onAttach()
              }}
              accessibilityRole="button"
              accessibilityLabel={t('composer_photo')}
              style={styles.attachRow}>
              <TabIcon glyph="camera" tint={palette.neutral['600']} />
              <Text
                style={[styles.attachWord, { color: palette.neutral['900'] }]}>
                {t('composer_photo')}
              </Text>
            </Pressable>
          )}
          {onAttachDocument !== undefined && (
            <Pressable
              testID="attach-document"
              onPress={() => {
                setAttachOpen(false)
                onAttachDocument()
              }}
              accessibilityRole="button"
              accessibilityLabel={t('composer_document')}
              style={styles.attachRow}>
              <TabIcon glyph="document" tint={palette.neutral['600']} />
              <Text
                style={[styles.attachWord, { color: palette.neutral['900'] }]}>
                {t('composer_document')}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* The reason the round button is grey, shown when somebody asks by
          pressing it. `state.disabled` requires a reason and forbids opacity;
          a line above every conversation for ever would be the noise this
          avoids. */}
      {whyDisabled && (
        <Text
          testID="record-soon"
          style={[styles.reason, { color: palette.neutral['600'] }]}>
          {t('composer_record_soon')}
        </Text>
      )}

      <View style={styles.bar}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: palette.surface.raised,
              borderColor: palette.neutral['200'],
            },
          ]}>
          <Pressable
            testID="composer-emoji"
            onPress={() => setEmojiOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: emojiOpen }}
            accessibilityLabel={t('composer_emoji')}
            style={styles.inField}>
            <TabIcon glyph="emoji" tint={palette.neutral['600']} />
          </Pressable>

          <TextInput
            testID="conversation-input"
            value={draft}
            onChangeText={setDraft}
            // SEVERAL LINES, AND THE RETURN KEY MAKES THEM.
            //
            // With `multiline` the return key inserts a newline and the
            // caret can be put anywhere with a tap, which is the second half
            // of what was asked for: navigating inside what you have
            // written. Sending moved to the button beside the field -- see
            // the note at the top for why that costs the bar nothing.
            multiline
            // Grows to `TALLEST_FIELD` and scrolls after that. `top` so a
            // field that has grown fills from its first line rather than
            // centring one line in a tall box.
            textAlignVertical="top"
            placeholder={t('message_placeholder')}
            placeholderTextColor={palette.neutral['400']}
            // NO HEIGHT AND NO `onContentSizeChange`. The field measures
            // itself; `maxHeight` in `styles.input` is the only bound it is
            // given. See the note at the top of this file for what stood
            // here, what it cost on iOS, and the measurement that says
            // removing it is safe on Android.
            style={[styles.input, { color: palette.neutral['900'] }]}
          />

          {(onAttach !== undefined || onAttachDocument !== undefined) && (
            <Pressable
              testID="conversation-attach"
              onPress={() => setAttachOpen(open => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: attachOpen }}
              accessibilityLabel={t('composer_attach')}
              style={styles.inField}>
              {/* `plus`, WHICH IS WHAT STOOD HERE BEFORE THE CAMERA.
                  This control no longer opens one kind of thing, so an icon
                  naming one kind would be a control lying about what it
                  does. The panel above says the two kinds in words. */}
              <TabIcon glyph="plus" tint={palette.neutral['600']} />
            </Pressable>
          )}
        </View>

        {/* ONE PLACE, TWO CONTROLS, AND THE BAR NEVER MOVES.
            With something written, it sends; empty, it is the microphone it
            has always been -- grey, V2, and it says so when tapped. */}
        {draft.trim() === '' ? (
          <Pressable
            testID="composer-record"
            onPress={() => setWhyDisabled(shown => !shown)}
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={t('composer_record')}
            accessibilityHint={t('composer_record_soon')}
            style={[styles.round, { backgroundColor: palette.neutral['200'] }]}>
            {/* `neutral.300` is the only disabling grey the palette allows,
                and it is a tint on the glyph rather than an opacity on the
                button -- `state.disabled` forbids opacity outright, because
                it would grey the reason too. */}
            <TabIcon glyph="mic" tint={palette.neutral['300']} />
          </Pressable>
        ) : (
          <Pressable
            testID="composer-send"
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel={t('composer_send')}
            style={({ pressed }) => [
              styles.round,
              { backgroundColor: palette.brand.green500 },
              pressed && styles.pressed,
            ]}>
            {/* AN ARROW WRITTEN, NOT AN ICON DRAWN. The identity's set has
                no send glyph, and `TabIcon` says why one must not be
                invented in a component: "an icon invented in a component is
                one the identity never agreed to". A typographic arrow is
                the same idiom the chevron of `LanguagePicker` and the tick
                of `EmojiPicker` use, and it costs the set nothing. */}
            <Text style={[styles.sendMark, { color: palette.surface.paper }]}>
              {'↑'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: stroke.hairline.value,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.s,
    gap: space.s,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: stroke.base,
    paddingHorizontal: space.xs,
    minHeight: floors.touchTargetMin,
  },
  attachPanel: {
    paddingHorizontal: space.m,
    paddingBottom: space.s,
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: floors.touchTargetMin,
  },
  attachWord: {
    ...typeScale.body,
  },
  inField: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    ...typeScale.body,
    paddingVertical: space.s,
    // Five lines of `body`, then it scrolls. A composer that grows without
    // a bound pushes the conversation off the top of its own screen.
    maxHeight: TALLEST_FIELD,
  },
  pressed: { opacity: 0.8 },
  sendMark: {
    ...typeScale.titleMd,
    // The arrow is the whole content of a round button, so it is centred by
    // the button rather than by a line box that assumes a descender.
    lineHeight: typeScale.titleMd.fontSize,
  },
  round: {
    width: floors.touchTargetMin,
    height: floors.touchTargetMin,
    borderRadius: radius.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emojiSlot: {
    width: '12.5%',
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: typeScale.titleMd,
  reason: typeScale.caption,
})
