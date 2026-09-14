/**
 * The rule that keeps one crypto machine per JavaScript context, and none
 * created while this device decides whether to leave its account.
 *
 * # ONE MACHINE PER CONTEXT
 *
 * `computeCryptoMachineConfig` says why: the first launch to open a second
 * store loses every room key the first one held. The launch and the headless
 * wake share a context when the application is warm, so a second caller is
 * told what the first one did -- reuse its machine, wait for it, or nothing.
 *
 * # TAKEN FROM THE MOMENT A CREATION BEGINS (#304)
 *
 * The library creates a machine asynchronously. A guard that only recorded a
 * machine once it existed let a second start slip in while the first was
 * still being created, and let a launch looking for a running machine miss
 * one a wake had just begun. The context is taken as soon as a start is
 * granted, in the same turn as the check that granted it.
 *
 * # NOTHING CREATED WHILE THE ACCOUNT IS IN QUESTION (#304)
 *
 * Read at that same moment rather than once beforehand, since a wake that
 * began before the question was put reaches this line after it. A machine
 * that already exists for the device is still reused: that is not a second
 * one.
 *
 * The library offers no way to release a machine, so nothing here ends one.
 * A creation that fails is the only thing that frees the context.
 */
export type MachineStart =
  /** This context already holds that device's machine. */
  | { readonly kind: 'reuse' }
  /** Create it, and say through `settle` whether that worked. */
  | { readonly kind: 'create'; readonly settle: (created: boolean) => void }
  /** Another start is creating that device's machine: wait for it. */
  | { readonly kind: 'wait'; readonly created: Promise<boolean> }
  | { readonly kind: 'refused'; readonly reason: string }

export interface OneMachine {
  /** Whether this context holds a machine, or is creating one, for any device. */
  readonly running: () => boolean
  /** Whether this context holds a created machine for `deviceId`. */
  readonly holds: (deviceId: string) => boolean
  /** Asks to start a machine for `deviceId`. See `MachineStart`. */
  readonly start: (deviceId: string) => MachineStart
}

export function oneMachine(accountInQuestion: () => boolean): OneMachine {
  let device: string | null = null
  let creating: {
    readonly created: Promise<boolean>
    readonly settle: (created: boolean) => void
  } | null = null

  return {
    running: () => device !== null,
    holds: deviceId => device === deviceId && creating === null,
    start: deviceId => {
      if (device !== null && device !== deviceId) {
        return {
          kind: 'refused',
          reason: `this context already holds a machine for ${device}`,
        }
      }
      if (device === deviceId) {
        return creating === null
          ? { kind: 'reuse' }
          : { kind: 'wait', created: creating.created }
      }
      if (accountInQuestion()) {
        return {
          kind: 'refused',
          reason: 'this device is deciding whether to leave its account',
        }
      }

      let answer!: (created: boolean) => void
      const current = {
        created: new Promise<boolean>(resolve => {
          answer = resolve
        }),
        settle: (created: boolean) => answer(created),
      }
      device = deviceId
      creating = current
      return {
        kind: 'create',
        settle: created => {
          if (creating !== current) return
          creating = null
          if (!created) device = null
          current.settle(created)
        },
      }
    },
  }
}
