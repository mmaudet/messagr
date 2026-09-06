/**
 * The notification permission, granted before the suite ever sees it.
 *
 * # Why this exists
 *
 * Android 13 and later require `POST_NOTIFICATIONS`, and #90 asks for it as
 * soon as a session exists — which in this suite is inside the launch every
 * test starts from. A system dialog would appear over the application, and
 * every assertion after it would fail against a screen it cannot see, for a
 * reason none of them is about.
 *
 * # Granting rather than dismissing
 *
 * Detox can also tap the dialog away. Granting is the better answer: what the
 * tests are about is what the application does once it may be woken, and a
 * suite that ran with notifications refused would be exercising the branch
 * nobody ships rather than the one everybody gets.
 *
 * The refused branch is covered where it can be tested without a device --
 * `pusher.ts` treats an absent token as "nothing to register" and says so, and
 * that is a unit test.
 */
export const NOTIFICATIONS_GRANTED = { notifications: 'YES' } as const
