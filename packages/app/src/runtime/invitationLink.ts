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
 */
export interface InvitationLink {
  /** The bearer token. Spending it is what creates the account. */
  readonly token: string
  /** The homeserver this instance runs, derived from the link's own origin. */
  readonly homeserver: string
  /** Where the invitation service answers on that instance. */
  readonly service: string
}

const SCHEMES = ['https:', 'messagr:']

/**
 * The path the invitation service's own links use. A link into this instance
 * that is not shaped like this is not an invitation, and treating it as one
 * would spend a token nobody offered.
 */
const INVITATION_PATH = /^\/i\/([^/]+)\/?$/

export function parseInvitationLink(raw: string): InvitationLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (!SCHEMES.includes(url.protocol)) {
    return null
  }

  const match = INVITATION_PATH.exec(url.pathname)
  const token = match?.[1]
  if (token === undefined || token === '') {
    return null
  }

  // Always https for the instance, whichever scheme carried the link: the
  // application's own scheme names a host, not a transport, and every request
  // that follows is an ordinary web request to that host.
  const homeserver = `https://${url.host}`

  return {
    token,
    homeserver,
    // The path the deployment already serves the invitation service on, and
    // the same one the bench provisioning script assumes.
    service: `${homeserver}/_messagr`,
  }
}
