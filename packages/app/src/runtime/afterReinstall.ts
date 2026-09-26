/**
 * What a launch should do when it finds a session whose crypto store is gone.
 *
 * # HOW THAT IS TOLD APART FROM EVERY OTHER LAUNCH
 *
 * The store lives at `<storeDir>/crypto/<deviceId>` — `cryptoMachineConfig.ts`
 * derives it from the session's own device identifier. So the question is
 * local, cheap and certain: this launch restored a session, and the directory
 * that session's device would keep its keys in is not there.
 *
 * A first launch after claiming has no store either, and is not this: it
 * claimed, so it is creating an account rather than returning to one. The
 * two are distinguished by `claimed` and not by guesswork.
 *
 * # WHY THE ANSWER MATTERS MORE THAN THE DETECTION
 *
 * #190: an iOS reinstall takes the data directory and leaves the keychain.
 * A launch that carries on publishes fresh identity keys under a device
 * identifier the homeserver already knows — and for everybody on the other
 * side, that is not somebody reinstalling, it is an existing device whose
 * keys changed underneath them. The product teaches people to treat that as
 * an alarm; it must not manufacture it.
 */

export type AfterReinstall =
  /** An ordinary launch. Nothing to do, which is almost always. */
  | { readonly kind: 'ordinary' }
  /**
   * The store is gone and this device can come back as a new one.
   *
   * `reenter.ts` does it: log in with the password kept at claim time, take
   * the new device the homeserver hands back, and retire the dead one.
   */
  | { readonly kind: 'reenter'; readonly password: string }
  /**
   * The store is gone and there is no way back.
   *
   * An account claimed before the password was kept, or a keystore that
   * would not give it up. The person has to be told, in plain words, that
   * this device lost its keys and that what came before is unreadable — and
   * nothing may be published under the old device identifier meanwhile.
   */
  | { readonly kind: 'stranded' }
  /**
   * The device « Revenir sur ce compte » came back as, on its first launch
   * (#391): its store is not there yet because it is new, the way a claim's
   * is not. Nothing to do, and told as a reinstall that came back is told:
   * what came before stays unreadable here.
   */
  | { readonly kind: 'came-back' }
  /**
   * The store is gone and the homeserver no longer knows the session (#391):
   * deleted, revoked, or this telephone taken off the account. Coming back
   * would be the device undoing on its own what somebody did on purpose, so
   * the launch asks the person instead, as `lostAccess.ts` does.
   */
  | { readonly kind: 'lost' }

export function afterReinstall(launch: {
  /** Whether this launch spent an invitation, rather than restoring. */
  readonly claimed: boolean
  /** Whether the store directory this session's device would use exists. */
  readonly storeExists: boolean
  /** The password kept at claim time, when there is one. */
  readonly password: string | null
  /**
   * Whether this session is the new device a lost access came back as
   * (#391, `lostAccess.ts`'s `cameBackAs`): its store does not exist yet
   * either, and like a claim it is a device beginning rather than one
   * returning.
   */
  readonly newDevice?: boolean
  /**
   * Whether the homeserver said it does not know this session's token.
   * Asked only of a launch whose store is gone (#391): an ordinary launch
   * hears it from its first sync.
   */
  readonly refused?: boolean
}): AfterReinstall {
  if (launch.claimed || launch.storeExists) return { kind: 'ordinary' }
  if (launch.newDevice === true) return { kind: 'came-back' }
  if (launch.refused === true) return { kind: 'lost' }
  return launch.password === null
    ? { kind: 'stranded' }
    : { kind: 'reenter', password: launch.password }
}
