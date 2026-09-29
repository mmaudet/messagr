import type { CopyKey } from '../copy'
import type { BlockNotice, BlockSaid } from '../runtime/block'

/**
 * What a block says once made, wherever the person is next (#469, #472),
 * one test identifier per sentence, as #276 asks: a block whose service
 * record waits must not pass for one the service has.
 *
 * # TWO FAMILIES, EACH TRUE WHERE IT IS SAID
 *
 * A block that took the conversation it was made from off the list says so,
 * on the list it came back to: the panel of the person, and the selection
 * in a conversation of two. One made from a conversation of more than two,
 * which stays, says only that what the account wrote left the conversations:
 * in that conversation, then on the list, where that conversation still is.
 *
 * A module of its own, which both the list and the conversation read: the
 * list's spec walks the list without standing in for the sheet a block is
 * made in (`Block.tsx`).
 */
const SAYS: Readonly<
  Record<
    'left' | 'stays',
    Readonly<
      Record<BlockNotice, { readonly key: CopyKey; readonly testID: string }>
    >
  >
> = {
  left: {
    blocked: { key: 'list_blocked', testID: 'list-blocked' },
    waiting: { key: 'list_blocked_waiting', testID: 'list-blocked-waiting' },
    'not-kept': {
      key: 'list_blocked_not_kept',
      testID: 'list-blocked-not-kept',
    },
  },
  stays: {
    blocked: { key: 'blocked_several', testID: 'blocked-several' },
    waiting: {
      key: 'blocked_several_waiting',
      testID: 'blocked-several-waiting',
    },
    'not-kept': {
      key: 'blocked_several_not_kept',
      testID: 'blocked-several-not-kept',
    },
  },
}

/** The sentence for `said`, and its test identifier. */
export function blockSays(said: BlockSaid): {
  readonly key: CopyKey
  readonly testID: string
} {
  return SAYS[said.stayingIn === null ? 'left' : 'stays'][said.notice]
}
