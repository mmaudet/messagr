import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

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
import type { PasteSaid } from '../runtime/pastedLink'
import { NotchedButton } from './NotchedButton'

/**
 * Where somebody pastes the invitation link that would not open by itself.
 * #367.
 *
 * # THE SECOND DOOR, AND WHY IT IS SECOND
 *
 * The link touched is the way in, and this is not offered beside it or
 * instead of it: it is drawn on the one screen that says the link is the only
 * door, for the person the door did not open for. That is #308 on an iPhone
 * -- an invitation read inside another messenger's built-in browser, whose
 * « Ouvrir dans Messagr » is a link to its own `https` origin, which iOS does
 * not hand over to the application claiming that domain.
 *
 * # THE APPLICATION NEVER READS THE CLIPBOARD, AND THIS IS WHY THERE IS A
 * # FIELD RATHER THAN A BUTTON
 *
 * An invitation token is a bearer credential -- ADR-0004 -- and a clipboard
 * is readable by every other application on the telephone. « Coller pour moi
 * » would be the product reaching into it on its own initiative, which is
 * exactly what #308's own reserve forbids: *sans ouvrir de chemin par lequel
 * une autre application pourrait lire le jeton*. So the gesture stays the
 * person's: they paste, with their own hand, into a field they can see.
 *
 * And what it costs is said here, where it is asked for, rather than left for
 * somebody to work out: a copied link can be read by the other applications
 * on the telephone, and it is good for an hour and a single use.
 *
 * # THIS SCREEN DECIDES NOTHING ABOUT THE LINK
 *
 * It hands the text over whole. What an invitation is, is `invitationLink.ts`
 * -- one reader -- and what becomes of one is `entry.ts`, reached through the
 * very channel a link handed over by the operating system goes through. The
 * three sentences below are the answers that come back, said in the place the
 * gesture was made.
 *
 * # THE FIELD LEAVES THE PLATFORM NONE OF ITS HELPFULNESS
 *
 * A token's case is significant and a keyboard that capitalises the first
 * letter of what is pasted produces a link that opens nothing, with nothing
 * on screen to say why. The same reasoning, and the same three flags, as
 * `RecoveryKeyEntry.tsx`.
 *
 * It does not focus itself either. The sentence above it explains the
 * ordinary way in, and a keyboard springing up over it would make the way out
 * look like the way.
 */

const SAID: Record<PasteSaid, CopyKey> = {
  'not-a-link': 'list_paste_not_a_link',
  working: 'list_paste_working',
  refused: 'list_paste_refused',
  retry: 'list_paste_retry',
}

export interface PasteLinkProps {
  /**
   * Hands over what is in the field, whole.
   *
   * Whether it is an invitation at all is read by whoever spends it
   * (`invitationPasted`), in the same step that hands it to entry: a field
   * that decided would be a second reader, and the answer would be decided
   * twice.
   */
  readonly onPaste: (raw: string) => void
  /**
   * What became of the link this field last handed over, when there is an
   * answer. `working` while it is being spent, which can take the better part
   * of a minute: a claim is two calls with the issuer's application in
   * between (`claimInvitation.ts`).
   */
  readonly said?: PasteSaid | null
}

export function PasteLink({ onPaste, said = null }: PasteLinkProps) {
  const [draft, setDraft] = useState('')

  const hand = () => {
    // A SINGLE-USE TOKEN IS HANDED OVER ONCE. A second press while the first
    // is being spent would claim the same token twice, and the second claim
    // is the one that gets refused.
    if (draft.trim() === '' || said === 'working') return
    onPaste(draft)
  }

  return (
    <View style={styles.block} testID="paste-link">
      <Text style={styles.lead}>{t('list_paste_lead')}</Text>
      {/* WHAT IT COSTS, WHERE IT IS ASKED FOR. Not a warning and not drawn as
          one: it is the price of the gesture, said plainly next to it. */}
      <Text style={styles.cost}>{t('list_paste_cost')}</Text>

      <TextInput
        testID="paste-link-field"
        value={draft}
        onChangeText={setDraft}
        placeholder={t('list_paste_field')}
        placeholderTextColor={color.neutral['400']}
        style={styles.field}
        // See the note above: every one of these is off on purpose.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="url"
        multiline
        onSubmitEditing={hand}
        returnKeyType="go"
      />

      {said !== null && said !== 'working' && (
        <View style={styles.refusal} testID={`paste-link-${said}`}>
          <Text style={styles.refusalText}>{t(SAID[said])}</Text>
        </View>
      )}

      <NotchedButton
        testID="paste-link-confirm"
        label={
          said === 'working' ? t('list_paste_working') : t('list_paste_confirm')
        }
        onPress={hand}
        disabled={said === 'working'}
        wide
      />
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    gap: space.s,
    marginTop: space.l,
    // La même gouttière que la phrase au-dessus, qui la porte elle-même : le
    // champ est la suite de cette phrase, pas un bloc posé à côté.
    paddingHorizontal: layout.screenGutter,
  },
  lead: { ...type.body, color: color.neutral['900'] },
  cost: { ...type.bodySm, color: color.neutral['600'] },
  field: {
    ...type.body,
    color: color.neutral['900'],
    // The same field `RecoveryKeyEntry.tsx` draws, because it is the same
    // gesture: carrying a secret from somewhere else into this application.
    backgroundColor: color.surface.raised,
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
    borderRadius: radius.bubble,
    padding: space.m,
    minHeight: floors.touchTargetMin,
  },
  // Ochre and not red, as every refusal in this application: a link that will
  // not open is not a fault, and the person holding it is the one the product
  // is trying to help.
  refusal: {
    padding: space.m,
    borderLeftWidth: stroke.accent,
    backgroundColor: color.wait['100'],
    borderLeftColor: color.wait['500'],
  },
  refusalText: { ...type.bodySm, color: color.neutral['900'] },
})
