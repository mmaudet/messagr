/**
 * Reading an invitation link.
 *
 * The link is the product's entry point, and it carries more than a token: it
 * names the instance. That is what lets a person enter without ever being
 * asked which server they are joining — the specification's own position that
 * the origin instance is an infrastructure detail, not a question to put to
 * someone who was handed a link by a friend.
 *
 * Two schemes are accepted. `https` is what travels through a message or a
 * QR code; the application's own scheme is what the operating system hands
 * over when the link is opened on a device where Messagr is installed. Both
 * open the same door, because they are the same link.
 *
 * `http` is refused. The token is a bearer credential — whoever reads it is
 * the invited person — and a link that carried one in clear text would be an
 * invitation to whoever is between.
 *
 * ## Why this parses the link itself instead of using `URL`
 *
 * It used to use `URL`, and that worked in every test and failed on a device.
 * React Native does not have the platform's `URL`; it ships a polyfill whose
 * accessors hard-code the http schemes:
 *
 * ```js
 * get pathname() { return this._url.match(/https?:\/\/[^/]+(\/[^?#]*)?/) ... }
 * get host()     { return this._url.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/) ... }
 * ```
 *
 * So for `messagr://host/i/<token>` it answers `protocol` correctly and then
 * reports the path as `/` and the host as empty. Exactly the application's
 * own scheme — the one the operating system hands over, and the only one that
 * matters on a device — is the one it cannot read. The `https` form worked,
 * which is why nothing caught it until an emulator opened the real link.
 *
 * The tests could not have caught it either: they run on Node, so they were
 * exercising Node's `URL` rather than the one this code meets at runtime. A
 * pattern applied here behaves the same in both places, which is the point.
 */
export interface InvitationLink {
  /** The bearer token. Spending it is what creates the account. */
  readonly token: string
  /** The homeserver this instance runs, derived from the link's own origin. */
  readonly homeserver: string
  /** Where the invitation service answers on that instance. */
  readonly service: string
}

/**
 * Scheme, host, and the one path the invitation service's own links use. A
 * link into this instance shaped any other way is not an invitation, and
 * treating it as one would spend a token nobody offered.
 *
 * Anything after the token — a query or a fragment — is accepted and ignored,
 * because a link that travelled through a messenger may well come back with
 * tracking parameters attached to it.
 */
const INVITATION_LINK =
  /^(https|messagr):\/\/([^/?#]+)\/i\/([^/?#]+?)\/?(?:[?#].*)?$/i

export function parseInvitationLink(raw: string): InvitationLink | null {
  const match = INVITATION_LINK.exec(raw.trim())
  if (match === null) {
    return null
  }

  const [, , host, token] = match
  if (host === undefined || token === undefined) {
    return null
  }

  // Always https for the instance, whichever scheme carried the link: the
  // application's own scheme names a host, not a transport, and every request
  // that follows is an ordinary web request to that host. The host is lowered
  // because host names are case-insensitive and this one becomes a base URL
  // that later comparisons rely on; the token is left exactly as it arrived,
  // because it is a credential and its case is significant.
  const homeserver = `https://${host.toLowerCase()}`

  return {
    token,
    homeserver,
    // The path the deployment already serves the invitation service on, and
    // the same one the bench provisioning script assumes.
    service: `${homeserver}/_messagr`,
  }
}
