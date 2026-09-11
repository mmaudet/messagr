/**
 * How long a call lasted, as a list of recent calls says it.
 *
 * # WHY THIS IS NOT A TRANSLATED SENTENCE
 *
 * « 3 min 42 s » would need a sentence in every catalogue and four plural
 * forms, and it
 * would still be longer than the row has space for. A clock is what every
 * telephone in the world prints beside a call, it is read the same way in
 * every language this product speaks, and `CallScreen`'s own `Elapsed`
 * already prints the same shape while the call is happening -- so the number
 * a person watched during the call is the number they see afterwards.
 *
 * The words are in the accessibility label, where a screen reader needs them
 * and where there is room. See `calls_lasted %@`.
 *
 * # THE HOUR IS NOT PADDED AND THE MINUTE IS
 *
 * `9:05`, `1:09:05`. Padding the leading field would print `09:05`, which
 * reads as nine minutes five in a list and as nine hours five to anybody who
 * has ever seen a duration written `09:05:00`. Every field after the first
 * is padded, because that is what makes `1:9:5` impossible.
 */
export function spokenFor(seconds: number): string {
  // A duration that is not a number of seconds is a row that does not know,
  // and the caller is the one holding the `undefined`. Anything absurd that
  // reaches here is clamped rather than printed: `-1:-1` on a screen is
  // worse than a zero.
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  const padded = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${padded(minutes)}:${padded(rest)}`
    : `${minutes}:${padded(rest)}`
}
