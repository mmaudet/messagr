import type { DeviceIdentity } from './deviceIdentity'

/**
 * The rule that keeps one crypto machine per JavaScript context, and none
 * made for a device this context may not give one.
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
 * # NONE FOR A DEVICE IN QUESTION, OR ONE THAT DEPARTED (#304)
 *
 * `accountInQuestion.ts` says which devices those are, and it is one account's
 * device at a time: every other creation goes on. Asked at that same moment
 * rather than once beforehand, since a wake that began before a question was
 * put reaches this line after it. A machine that already exists for the device
 * is still reused: that is not a second one.
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
  /** Asks to start a machine for `account`'s device. See `MachineStart`. */
  readonly start: (account: DeviceIdentity) => MachineStart
}

export function oneMachine(
  mayCreateMachineFor: (account: DeviceIdentity) => boolean,
): OneMachine {
  let device: DeviceIdentity | null = null
  let creating: {
    readonly created: Promise<boolean>
    readonly settle: (created: boolean) => void
  } | null = null

  return {
    running: () => device !== null,
    holds: deviceId => device?.deviceId === deviceId && creating === null,
    start: account => {
      if (
        device !== null &&
        (device.userId !== account.userId ||
          device.deviceId !== account.deviceId)
      ) {
        return {
          kind: 'refused',
          reason: `this context already holds a machine for ${device.deviceId}`,
        }
      }
      if (device !== null) {
        return creating === null
          ? { kind: 'reuse' }
          : { kind: 'wait', created: creating.created }
      }
      if (!mayCreateMachineFor(account)) {
        return {
          kind: 'refused',
          reason: 'this account is in question on this device, or has left it',
        }
      }

      let answer!: (created: boolean) => void
      const current = {
        created: new Promise<boolean>(resolve => {
          answer = resolve
        }),
        settle: (created: boolean) => answer(created),
      }
      device = { userId: account.userId, deviceId: account.deviceId }
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
