/**
 * Whether this JavaScript context is asking the person whether to leave the
 * account this device holds, or carrying out a yes. #304.
 *
 * # WHY THE WAKE HAS TO KNOW
 *
 * The question is put at a cold launch, before any crypto machine exists, and
 * a yes starts the next account's machine in this same process. The wake runs
 * in this context too when the application is not in front, and a push can
 * arrive while the question waits -- somebody switched to another application
 * to think it over. That wake would start a machine for the session it finds,
 * which is the account in question, and the next account's machine would then
 * be refused as a second one until Messagr was reopened.
 *
 * So the wake reads this and looks at nothing while it holds. It draws the
 * notification that names nobody, which is what it already does for every
 * other reason it cannot look.
 *
 * Module state, like the machine guard in `cryptoPump.ts`, and for the same
 * reason: a launch and a wake share a context and nothing else.
 */
const open = new Set<symbol>()

/**
 * Marks the account as in question, and answers what lifts that mark. The
 * release lifts this question only, however many times it is called.
 */
export function putTheAccountInQuestion(): () => void {
  const question = Symbol('the account in question')
  open.add(question)
  return () => {
    open.delete(question)
  }
}

export function accountInQuestion(): boolean {
  return open.size > 0
}
