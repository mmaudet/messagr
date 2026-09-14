import type { DeviceIdentity } from './deviceIdentity'

/**
 * Which accounts this JavaScript context is asking the person whether to
 * leave, and which it has left. #304.
 *
 * # WHY A MACHINE HAS TO KNOW
 *
 * The question is put at a cold launch, before any crypto machine exists, and
 * a yes starts the next account's machine in this same process. The wake runs
 * in this context too when the application is not in front, and a push can
 * arrive while the question waits -- somebody switched to another application
 * to think it over. That wake would start a machine for the session it finds,
 * which is the account in question, and the next account's machine would then
 * be refused as a second one until Messagr was reopened.
 *
 * So `oneMachine.ts` asks this at the moment a machine would be created, and a
 * wake it refuses draws the notification that names nobody, which is what it
 * already does for every other reason it cannot look.
 *
 * # THAT ACCOUNT'S DEVICE, AND NO OTHER
 *
 * Found in review on 14 September 2026: the first version held every
 * creation, whichever account it was for, until entry answered, and a
 * question nobody answered held it for the life of the process. What is held
 * now is one account's device -- its user and its device id, together -- and
 * the question always ends: `questionOnScreen.ts` says how.
 *
 * # A DEVICE THAT DEPARTED STAYS CLOSED
 *
 * A wake that read the old session before the account departed can reach the
 * machine long after the question was lifted. That device is gone from this
 * telephone -- its session replaced, its store erased -- and a machine made
 * for it would take the context from the next account's. So a departed device
 * is refused for the rest of the process.
 *
 * # AND A RUN THAT RESTORED IT WAITS
 *
 * One opening of a link can start two runs of a launch, and the one handed no
 * link restores the session the other may be asking about. `waitFor` is what
 * that run waits on, and nothing else makes a run wait: before, every run that
 * restored a session waited for any claim still under way, and the same link
 * into the same server, delivered twice, waited half a minute for nothing.
 *
 * Module state, like the machine guard in `cryptoPump.ts`, and for the same
 * reason: a launch and a wake share a context and nothing else.
 */
export interface AccountsInQuestion {
  /**
   * Puts `account`'s device in question. However many questions hold one
   * device, it is free again only once each of them has been lifted.
   */
  readonly hold: (account: DeviceIdentity) => InQuestion
  /** Whether a crypto machine may be made for `account`'s device now. */
  readonly mayCreateMachineFor: (account: DeviceIdentity) => boolean
  /**
   * Resolves once no question holds `account`'s device: `true` when one did,
   * or when the account has departed -- when which account this device holds
   * is worth reading again -- and `false` at once otherwise.
   */
  readonly waitFor: (account: DeviceIdentity) => Promise<boolean>
}

/** One question about one device. */
export interface InQuestion {
  /** Lifts this question. Called again, it lifts nothing, not even one put since. */
  readonly lift: () => void
  /** The account has left this device: no machine for it again in this process. */
  readonly departed: () => void
}

export function accountsInQuestion(): AccountsInQuestion {
  const held = new Map<string, Set<symbol>>()
  const departed = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()
  const deviceOf = (account: DeviceIdentity) =>
    JSON.stringify([account.userId, account.deviceId])

  return {
    hold: account => {
      const device = deviceOf(account)
      const question = Symbol('a question about this device')
      held.set(device, new Set(held.get(device)).add(question))
      return {
        lift: () => {
          const questions = held.get(device)
          if (questions === undefined || !questions.delete(question)) return
          if (questions.size > 0) return
          held.delete(device)
          const waiters = waiting.get(device) ?? []
          waiting.delete(device)
          for (const answer of waiters) answer()
        },
        departed: () => {
          departed.add(device)
        },
      }
    },
    mayCreateMachineFor: account => {
      const device = deviceOf(account)
      return !held.has(device) && !departed.has(device)
    },
    waitFor: account => {
      const device = deviceOf(account)
      if (!held.has(device)) return Promise.resolve(departed.has(device))
      return new Promise(resolve => {
        waiting.set(device, [
          ...(waiting.get(device) ?? []),
          () => resolve(true),
        ])
      })
    },
  }
}

/** This context's: read by the launch, the wake and the machine guard. */
export const theAccountsInQuestion = accountsInQuestion()
