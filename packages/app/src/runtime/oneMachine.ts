import type { DeviceIdentity } from './deviceIdentity'
import { getErrorMessage } from './errors'

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
 * # A CREATION THAT FAILED IS MADE ONCE MORE BY WHOEVER WAITED FOR IT
 *
 * Found in review on 14 September 2026. A wake on a locked screen begins the
 * machine and cannot make it, the person opens the application meanwhile, and
 * the launch that waited for the wake gave up there, with nothing to try
 * again. `open` makes the machine once itself, and reports a second failure.
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

/** What opening a machine came to. */
export type MachineOpened =
  | { readonly started: true }
  | { readonly started: false; readonly reason: string }

export interface OneMachine {
  /** Whether this context holds a machine, or is creating one, for any device. */
  readonly running: () => boolean
  /** Whether this context holds a created machine for `deviceId`. */
  readonly holds: (deviceId: string) => boolean
  /** Asks to start a machine for `account`'s device. See `MachineStart`. */
  readonly start: (account: DeviceIdentity) => MachineStart
  /**
   * Starts `account`'s machine, making it with `create` when this context has
   * to -- and once more when the creation it waited for failed.
   */
  readonly open: (
    account: DeviceIdentity,
    create: () => Promise<unknown>,
  ) => Promise<MachineOpened>
}

export function oneMachine(
  mayCreateMachineFor: (account: DeviceIdentity) => boolean,
): OneMachine {
  let device: DeviceIdentity | null = null
  let creating: {
    readonly created: Promise<boolean>
    readonly settle: (created: boolean) => void
  } | null = null

  const start = (account: DeviceIdentity): MachineStart => {
    if (
      device !== null &&
      (device.userId !== account.userId || device.deviceId !== account.deviceId)
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
  }

  /** What a start that does not wait comes to, making the machine when told to. */
  const carryOut = async (
    granted: Exclude<MachineStart, { readonly kind: 'wait' }>,
    create: () => Promise<unknown>,
  ): Promise<MachineOpened> => {
    if (granted.kind === 'reuse') return { started: true }
    if (granted.kind === 'refused') {
      return { started: false, reason: granted.reason }
    }
    try {
      await create()
    } catch (cause: unknown) {
      granted.settle(false)
      return { started: false, reason: getErrorMessage(cause) }
    }
    granted.settle(true)
    return { started: true }
  }

  return {
    running: () => device !== null,
    holds: deviceId => device?.deviceId === deviceId && creating === null,
    start,
    open: async (account, create) => {
      const first = start(account)
      if (first.kind !== 'wait') return carryOut(first, create)
      if (await first.created) return { started: true }
      // The creation it waited for failed, and that freed the context: once
      // more, made here.
      const again = start(account)
      if (again.kind !== 'wait') return carryOut(again, create)
      return (await again.created)
        ? { started: true }
        : {
            started: false,
            reason: 'the machine this context was creating did not start',
          }
    },
  }
}
