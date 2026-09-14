/**
 * Whether two URLs address the same origin: scheme, host and port, with the
 * host compared without regard to case and the port filled in from the scheme
 * when a URL leaves it implicit.
 *
 * # Why this exists
 *
 * An account's credentials may be sent only to the server that account lives
 * on. `entry.ts` is the one place a session kept on this device meets a host
 * named by a link somebody else wrote, and the access token that authenticates
 * the account must not travel to a host the account never chose. This is the
 * comparison that decides whether the link's instance is the account's own.
 *
 * # Why it parses the origin itself instead of using `URL`
 *
 * The same reason `invitationLink.ts` gives at length. React Native ships a
 * `URL` polyfill whose accessors hard-code the http schemes and report an
 * empty host for anything else, so a comparison that trusted it would answer
 * one thing under a test on Node and another on a device. This must give the
 * same answer in both places, because it is the answer that keeps a credential
 * from leaving the account's own server.
 *
 * A URL this cannot read as an origin is not the account's server: `null` is
 * never equal to anything, so a malformed side refuses rather than matches,
 * which is the safe direction for a guard.
 */
export function sameOrigin(a: string, b: string): boolean {
  const left = originOf(a)
  return left !== null && left === originOf(b)
}

/**
 * The host a person reads: lowered, without its scheme, and with its port only
 * when that port is not the scheme's own.
 *
 * For a screen, never for a comparison -- `sameOrigin` is the comparison. The
 * question put before a device leaves its account for an invitation into
 * another server names both servers, because which two they are is the one
 * thing somebody decides on there. Parsed here rather than again, so the host a
 * screen names is the host the guard compared.
 *
 * A URL this cannot read is shown as it was written rather than as nothing.
 */
export function hostShown(url: string): string {
  const parts = partsOf(url)
  if (parts === null) return url.trim()
  return parts.port === DEFAULT_PORT[parts.scheme]
    ? parts.host
    : `${parts.host}:${parts.port}`
}

// Scheme, then the authority up to the first path, query or fragment. Any
// userinfo before an `@` is dropped: it names who is asking, not which host
// answers, and leaving it in would let `someone@host-a` read as a different
// origin from `host-a` — or worse, `host-a@host-b` read as `host-a`.
const ORIGIN = /^(https?):\/\/(?:[^/?#@]*@)?([^/?#]+)/i

const DEFAULT_PORT: Readonly<Record<string, string>> = {
  http: '80',
  https: '443',
}

function originOf(url: string): string | null {
  const parts = partsOf(url)
  return parts === null ? null : `${parts.scheme}://${parts.host}:${parts.port}`
}

/** Scheme, host and port, read the one way both functions above rely on. */
function partsOf(url: string): {
  readonly scheme: string
  readonly host: string
  readonly port: string
} | null {
  const match = ORIGIN.exec(url.trim())
  if (match === null) return null
  const scheme = match[1]!.toLowerCase()
  const authority = match[2]!

  // The port is split off on the LAST colon, and only when it is outside any
  // bracketed IPv6 literal — so `[::1]:8448` keeps its host and `[::1]` keeps
  // its own colons rather than losing them to a phantom port.
  const lastColon = authority.lastIndexOf(':')
  const closingBracket = authority.lastIndexOf(']')
  const carriesPort = lastColon > closingBracket
  const host = (
    carriesPort ? authority.slice(0, lastColon) : authority
  ).toLowerCase()
  if (host === '') return null

  const written = carriesPort ? authority.slice(lastColon + 1) : ''
  // An explicit default port and an implicit one are one origin, so both
  // resolve to the scheme's default before they are compared.
  const port =
    written === '' || written === DEFAULT_PORT[scheme]
      ? (DEFAULT_PORT[scheme] ?? '')
      : written

  return { scheme, host, port }
}
