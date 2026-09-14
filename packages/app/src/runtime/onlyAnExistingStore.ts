/**
 * A crypto store opened by a process with no screen -- a wake, or a call
 * refused from its notification -- and only one that exists. #304.
 *
 * # THE FIRST CREATION BELONGS TO THE LAUNCH
 *
 * Opening a store for the first time mints its passphrase, and
 * `storePassphrase.ts` reads the keystore, then writes it, with nothing in
 * between to keep a second opener out. Found in review on 14 September 2026:
 * right after a departure the new account has no store yet, and the old
 * server, whose pusher is not removed yet, can wake this context while the
 * launch creates one. Each minted a passphrase; the store was made with one,
 * the keystore kept the other, and the next launch could not open the new
 * account's store.
 *
 * So a process with no screen opens a store that exists, and stays blind when
 * there is none. It gives up nothing by that: a store it made would hold no
 * keys -- this device's keys are published by the launch -- and could decrypt
 * nothing that arrived.
 */
export async function onlyAnExistingStore<
  Started extends { readonly started: boolean },
>(
  exists: () => Promise<boolean>,
  open: () => Promise<Started>,
): Promise<Started | { readonly started: false; readonly reason: string }> {
  if (!(await exists())) {
    return {
      started: false,
      reason:
        'this device has no crypto store yet, and only a launch makes one',
    }
  }
  return open()
}
