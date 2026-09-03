# Pseudonymous identity, and a partial alignment with Twake

Messagr is meant to join the Twake ecosystem, and its architecture and
technology choices follow `linagora/twake-guidelines`. Identity does not.
Accounts stay pseudonymous, and Twake Workplace is not the identity provider.

The two cannot both hold. The product specification states that account identity
never depends on a phone number or an email as its primary key, and the Twake
mobile login guideline prescribes three welcome entries that all authenticate
against an SSO, whose registration begins at the email step. Asked to choose,
the project keeps pseudonymity: it is the reason the product exists, whereas the
identity provider is an integration detail that can be revisited.

## Consequences

The three-entry welcome screen of `twake-mobile-login` does not apply, and
neither does its `sign-up.twake.app` flow with `app=chat`. Accounts come from
the invitation service instead, which mints a Matrix identity with no email and
no phone number. The invitation link stays the entry point, as the first two
screens of the specification already assume.

The rest of the guidelines binds normally: TypeScript and JavaScript
conventions, naming, git conventions, frontend testing, and the React component
rules. One carve-out beyond identity: the `twake-mui` first, `cozy-ui` fallback
mandate does not apply, because the product's design tokens are normative and a
component library that ships its own palette cannot coexist with an invariant
forbidding any value absent from those tokens.

Should the ecosystem later require Twake Workplace as the identity provider,
this is the decision to revisit first, and the cost will be real: authentication
touches identity, session storage, verification and recovery at once.
