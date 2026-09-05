# Messagr

A sovereign consumer messenger built on Matrix, where identity is pseudonymous,
trust is earned progressively, and a participant is never implicitly human.

The vocabulary below is canonical. Where a term has a Matrix meaning and a
product meaning, both are listed and the product one wins in product-facing
work.

## Language

### Participants and identity

**Participant**:
A member of a conversation space, human or agent. Never assume the former.
_Avoid_: User, member, contact when the human/agent distinction matters

**Human user**:
A real person with a Messagr account.
_Avoid_: User, account, customer

**Agent participant**:
A non-human participant with an explicit identity, a responsible owner, and
declared capabilities.
_Avoid_: Bot, assistant, AI

**Nature discriminant**:
The `human | agent` value every participant carries. It exists from the first
screen, before any agent does, because a timeline written as though every
participant were human has to be rewritten rather than patched.

**Pseudonymous account**:
An account whose identity depends on neither a phone number nor an email as its
primary key. This is an invariant, not a default.

**Account ID**:
A Messagr user's stable internal identity.
_Avoid_: Matrix ID, MXID, username when speaking about the product

**Strong suffix**:
The four characters after `#` in `@prefix#SUFFIX`, drawn from an alphabet that
excludes `0`, `O`, `1` and `I`. Two accounts sharing a prefix stay two distinct
lines; they are never merged.

### Conversations

**Conversation space**:
The conversation container a user sees. Sits above one or more Matrix rooms.
_Avoid_: Room, chat, thread when speaking about the product

**Matrix room**:
The protocol-level container. A transport detail, never a product noun.

**Direct conversation**:
A conversation between exactly two participants, in any combination of human
and agent.
_Avoid_: DM, private chat, one-to-one

**Channel**:
A multi-participant conversation of the community or collaborative kind.
_Avoid_: Group, room, space

**Community**:
A pseudonymous object grouping channels under a regenerable pseudonym with no
computable link to the primary identifier. It authorises nothing by itself.

**Anonymous channel**:
A channel configured so that membership and roles are never published outside
its members. Anonymity holds against its administrators too.

**Participant membership**:
The relation between a participant and a conversation space, carrying role,
status, join source and visibility.

**Entrant**:
A participant who entered a conversation space through an invitation and has
not been vouched for yet. A membership status, never a trust state: an entrant
may be perfectly verified and still be an entrant.
_Avoid_: Guest, pending member, unverified user, newcomer

**Promotion**:
The passage from entrant to full member, granted by vouching. It confers the
conversation's history and the right to invite. Nothing about it changes a
trust state.
_Avoid_: Validation, activation, upgrade, approval

**Given name**:
The name one participant gives another, held only on the device that gave it
and never published. It is what makes a list of conversations readable when
identifiers are pseudonymous by design. It says who somebody is _to you_, and
it says nothing to anybody else.

It is not a display name: nothing about it reaches the homeserver or the other
participant, who may be known under a different given name on every device
that knows them.
_Avoid_: Nickname, alias, contact name, display name. **Contact** in
particular belongs to discovery and means something else here.

### Trust, discovery and verification

These are three distinct notions. Conflating them is the most common error in
this domain, and the product keeps them apart in both logic and interface.

**Discovery**:
Finding that a contact or an agent exists on Messagr. It grants no right to
write to them.
_Avoid_: Search, lookup, contact sync

**Discovery identity**:
A discoverability attribute the user declares, such as a hashed phone number or
an opt-in username. Never conflated with the account identity.

**Trust state**:
The product-visible signal `unverified`, `recognized` or `verified`. It
describes what is known about a contact, not what may be done with them.

**Verification**:
The cryptographic act that changes a trust state, by comparing a short string
or scanning a code.
_Avoid_: Authentication, validation, confirmation

**Signing identity**:
The account's own cross-signing identity: the key pair an account uses to
vouch, cryptographically, for its own devices. One per account, for its whole
life. It is what verification signs with, and what lets a device be trusted
without being verified again on every other device.

Replacing it resets every trust anyone ever placed in the account, cannot be
undone, and cannot be detected afterwards — which is why creating one is
gated on an entitlement rather than on a server's answer.
_Avoid_: Master key, identity key, device key, account key

**Entitlement**:
The product's own answer to a question cryptography cannot settle: whether
this launch is allowed to make an irreversible identity decision. Today the
only one that grants it is a launch that created the account itself, by
spending an invitation.
_Avoid_: Permission, authorization, right

**Recognition**:
Reaching `recognized` through address book matching or another reliable local
signal. Weaker than verification and never a substitute for it.
_Avoid_: Using this word for the inviter's judgement, which is vouching

**Vouching**:
The inviter's own act of saying that the person who entered is the one they
meant to invite. A human judgement about a person, made after a few exchanges.
It proves nothing cryptographically and is not a trust state.

It answers what verification cannot. Verification proves which account and
which device; vouching proves which person holds them — an inviter's stolen
telephone produces an invitation that verifies perfectly.
_Avoid_: Recognition, validation, approval, confirmation

### Agents and capabilities

**Capability grant**:
A scoped, revocable permission held by an agent or a user in a given context.
Required before any external action or sensitive read.
_Avoid_: Permission, right, scope, role

**Capability sheet**:
The readable statement of what an agent can read, write and invoke. One sheet,
two modes, read and edit; a locked row looks identical in both.

**Capability link**:
An invitation or sharing link carrying a scoped, limited-use authorisation.
Single use, time-bounded, never bypassable.

**External action**:
An invocation of a tool or workflow outside Messagr. Always auditable.

**Agent runtime**:
The model, memory and orchestration layer behind agent participants. One per
instance; a local agent is never implicitly present on another instance.

**Tool gateway**:
The controlled execution layer for external APIs and actions. One per instance.

**Audit log**:
The record of decisions, refusals, suspensions and device changes. It records
what was decided, never what was said.
_Avoid_: Journal in English prose, history, log

### Federation

**Federation**:
Server-to-server communication between the homeservers of separate Messagr
instances. Invisible in ordinary interface, explicit internally.

**Federated identity**:
A participant hosted on a remote homeserver. Appears as an ordinary
participant; the `:server` suffix is never imposed on screen.

### Devices and recovery

**Linked device**:
A secondary device attached to an account, desktop companions included. A
device never appears quietly: verified contacts see it arrive.

**Recovery bundle**:
The product-facing artifact that restores encrypted account continuity.
_Avoid_: Backup, export, vault

**Data export**:
The GDPR archive, produced on the device and readable elsewhere. It restores
nothing, and is not a recovery bundle.

### Design

**Design token**:
A named value in `design/tokens.json`. Any colour, size, radius, elevation or
duration absent from it is forbidden in the product.

**Floor**:
A contractual minimum a token must not fall below, such as the smallest legible
body size or touch target. Stated so a lint can enforce it.
