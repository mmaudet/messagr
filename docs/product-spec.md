# Messagr — Product Specification (v2, consolidated)

## Status

Normative draft. Canonical owner of: the overall product architecture, the product entity model, the permission and capability matrix, the trust and safety UX model, the product deployment topology, and the full canonical glossary of the project. This version absorbs the product-relevant portion of the missing-artifacts formalization document and consolidates the cross-cutting decisions on groups, anonymity, encryption, and inter-instance federation.

## 0. Product positioning

Messagr is a sovereign clone of a mainstream messenger that combines:

- the ergonomics of a familiar consumer messenger (WhatsApp);
- progressive identity and trust inspired by Threema/Olvid;
- Matrix as the protocol infrastructure (Synapse, Continuwuity);
- a React Native native architecture on mobile and Tauri on desktop (macOS first, then Windows and Debian/Ubuntu);
- native participation of AI agents as identifiable members of conversations (Buzz/Berd inspiration);
- inter-instance federation that is invisible by default but explicitly modeled.

The product must feel immediate for the mainstream user, while removing automatic discoverability by phone number and the implicit anonymity of automations.

## 1. Product principles

- The app must feel familiar and fast to a mainstream user.
- Account identity never depends on a phone number or email as its primary key.
- Discovery, trust, and verification are three distinct notions in both logic and UX.
- Security strengthens progressively without blocking the initial experience.
- 1:1 audio and video calls are part of the V1 story.
- Multi-platform E2E test automation is a prerequisite, not an afterthought.
- A participant is never implicitly human: an agent is visible as an agent.
- Federated instances are invisible in ordinary UX but explicitly handled internally.
- Groups rely on a pseudonymous application object with minimized server metadata.

## 2. Overall product architecture

This view is canonical. The bridge and crypto specs only keep the portions needed for their respective contracts.

```text
┌───────────────────────────────────────────────────────────────────┐
│                         Client surfaces                           │
│  - React Native mobile (iOS / Android)                            │
│  - Tauri desktop (macOS → Windows → Debian/Ubuntu)                │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│              Product-facing client abstraction                    │
│  Contacts / channels / linked devices / trust states              │
│  Agent directory / agent profiles / capability views              │
│  Recovery / onboarding / discovery UX                             │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                 Generic crypto bridge (RN)                        │
│  E2EE, devices, verification, secrets                             │
└───────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│    Messagr Product API       │    │    Agent runtime             │
│  - private discovery         │    │  - model orchestration       │
│  - channel abstraction       │    │  - memory / prompts          │
│  - capability grants         │    │  - tool calling              │
│  - recovery orchestration    │    │  - audit / policy hooks      │
└──────────────────────────────┘    └──────────────────────────────┘
              │                                   │
              ▼                                   ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│   Matrix homeservers         │    │    External tool gateway     │
│  - Synapse / Continuwuity    │    │  - MCP tools                 │
│  - client-server API         │    │  - enterprise systems        │
│  - server-server federation  │    │  - workflows / automations   │
│  - Application Service API   │    │  - search / APIs             │
└──────────────────────────────┘    └──────────────────────────────┘
```

Federation is a horizontal link between the homeservers of multiple Messagr instances, invisible to the user in normal use but materialized by the `FederatedIdentity` entity.

## 3. Product entity model

The product spec is the canonical source of this model. The other specs reference these entities without redefining them.

| Entity | Definition | Notes |
|---|---|---|
| `HumanUser` | A person with a Messagr account backed by a Matrix identity. | Product identity may differ from discoverability attributes. |
| `AgentParticipant` | Non-human participant with an explicit identity, an owner, a description, and declared capabilities. | May be personal, shared, or system-scoped. |
| `ConversationSpace` | Conversation container shown to the user. | Abstracts the notion of Matrix room. |
| `DirectConversation` | 1:1 conversation between two participants. | Human-human, human-agent, or agent-agent if allowed. |
| `Channel` | Multi-participant conversation of community/collaborative-room type. | Retained target for the Buzz/Berd inspiration. |
| `ParticipantMembership` | Relation between a participant and a `ConversationSpace`. | Includes role, status, join source, visibility. |
| `LinkedDevice` | Secondary device attached to a `HumanUser` or an operational agent identity. | Desktop sessions, second mobile installations. |
| `TrustState` | Product signal `unverified` / `recognized` / `verified`. | UX on top of verification mechanisms. |
| `CapabilityGrant` | Scoped permission granted to an agent or user in a given context. | Required for external actions and sensitive reads. |
| `ExternalAction` | Invocation of a tool or workflow outside Messagr. | Must be auditable. |
| `DiscoveryIdentity` | Discoverability attribute (hashed phone/email for instance). | Separated from canonical Matrix identity. |
| `FederatedIdentity` | Identity of a participant hosted on a remote homeserver. | Must remain largely invisible in UX. |
| `RecoveryBundle` | Product abstraction of a backup / restore. | Simplified vocabulary above the Matrix machinery. |

### Recommended agent subtypes

| Subtype | Description | Example |
|---|---|---|
| `PersonalAssistantAgent` | Serves a specific `HumanUser`. | Summarizer, scheduling helper. |
| `SharedWorkspaceAgent` | Added to a channel as a team member. | Research agent, project assistant. |
| `SystemServiceAgent` | Managed by an organization or a deployment. | Compliance bot, support triage agent. |

### Identity rules

- Every `HumanUser` and every `AgentParticipant` has a stable internal identity.
- The visible product identity may differ from the protocol identity, but the mapping is deterministic.
- An agent identity can never be presented as human.
- A `ConversationSpace` may transparently include local and federated participants.
- A `HumanUser` may carry a native `Account ID` derived from a root key generated on-device, without dependency on a phone number or email.

## 4. Core user journeys

### 4.1 Account creation

Pseudonymous account, minimal initial friction, locally generated device identity, immediate transition to a usable state. No trust ceremony imposed before first use. Neither phone nor email is required as a primary identifier.

### 4.2 Private contact discovery

The app offers to recognize contacts already present on Messagr, with explicit consent. The permission prompt is framed around concrete benefit: finding your relatives, making invitations easier.

- Discovery result listing existing users.
- Simple invitation flow for the other contacts.
- Clear fallback path if address book sync is refused.
- Recognizing a contact never automatically grants the right to write to them.

Complementary discovery modes when address book access is absent:

- QR code or invitation link.
- Explicit username with a strong suffix (`@name#code`).
- Signed contact cards.
- Introductions by an already approved contact.
- Manual import from the local address book.

### 4.3 First conversation

Low-friction new-conversation entry, fast room creation/opening, immediate send/receive feedback, clean empty-state handling.

### 4.4 Progressive trust

Three visible, unobtrusive levels with an explicit escalation path.

| Level | Meaning | Trigger |
|---|---|---|
| Unverified | Contact exists, identity not confirmed | service-level presence |
| Recognized | Contact matched through address book or a reliable local signal | contact discovery |
| Verified | Key confirmed via QR or SAS | explicit verification |

The trust state is visible but discreet, without an alarmist tone by default. The details screen clearly explains the state, its scope, and its escalation.

### 4.5 1:1 audio and video calls

Included in V1. Audio and video buttons in the conversation header. Incoming call screen. In-call controls: mute, speaker, camera on/off, switch camera, hang up. Visible state transitions: connecting, reconnecting, active, ended, failed. Seamless return to the conversation. Group calling, community live sessions, and MatrixRTC are not required in V1 but the architecture does not block them.

### 4.6 Recovery and device continuity

Recovery does not crush the first-use flow. Soft prompt after the first exchange, first call, or when adding a second device. Guided secret export/import flow. Device addition via QR. Continuity verified by receiving a real message after restore.

Options offered depending on the user profile:

- recovery via a device already connected;
- locally exportable encrypted vault protected by a strong passphrase or PIN;
- social or guardian-based recovery for advanced profiles.

The product does not promise universal invisible recovery: this choice follows from the enhanced-anonymity stance.

### 4.7 Agent participation

An agent appears in a `ConversationSpace` with a profile, a description, and a readable capability sheet. Its presence is visually distinct from that of a `HumanUser`. Its messages are attributable. The user or channel admin can view, restrict, or revoke its capabilities at any time.

## 5. Permission and capability matrix

Product is the canonical owner of this matrix.

### 5.1 Permission scopes

| Scope | Meaning |
|---|---|
| Global | Whole account or deployment. |
| Space | A direct conversation or a channel. |
| Participant | A specific user or agent. |
| Action | A specific external action or tool. |
| Resource | A content type (messages, attachments, metadata). |

### 5.2 Core permissions

| Permission | Human | Agent | Notes |
|---|---|---|---|
| Read messages | yes | conditional | Agent read access depends on channel policy and consent. |
| Send messages | yes | yes | Agent sends must be visibly attributable. |
| Read attachments | yes | conditional | High sensitivity; separate grant. |
| Mention participants | yes | conditional | Rate limits or policy may apply. |
| View profile metadata | yes | conditional | Includes trust summary. |
| Trigger external tool | no by default | conditional | Explicit capability grant required. |
| Act on behalf of a user | conditional | conditional | Strong consent and audit required. |
| Invite participants | yes | conditional | An agent may be barred from inviting. |
| Remove participants | conditional | usually no | Reserved to admins except for service agents. |
| Manage trust / verification | yes | no by default | Human-driven unless explicitly delegated. |

### 5.3 Grant sources

| Source | Example |
|---|---|
| User consent | Authorizing a personal agent to summarize a conversation. |
| Channel admin policy | Authorizing a workspace agent to post and search internal docs. |
| System policy | Compliance agent in a regulated support channel. |
| Time-bound approval | One-time approval of an external action. |

### 5.4 Capability UX

- Each agent exposes a readable **capability sheet**: what it can read, write, invoke.
- Grants are visible in the channel details and in the agent's profile.
- Revocations are one-tap from the agent's card.
- A federated participant never automatically inherits elevated permissions simply because they are remote.
- Permission denials are visible in audit and operator tooling.

## 6. Groups, communities, and product-level anonymity

The product consolidates the retained decisions here.

### 6.1 "Community" application object

- A **community** is a pseudonymous application object exposed as a set of `Channel`s.
- Each `Channel` relies on group encryption. **V1 ships Megolm.** MLS (RFC 9420) is the
  target trajectory, not a target already chosen: no implementation is within reach today,
  and the migration is the one screen 30 already annotates. See ADR-0003 and the crypto spec.
- Invitations flow through **capability links** or limited-use invitation tokens, never a server-readable directory.
- Admin roles are **signed client-side** and not held in a server-readable registry.
- Server-side metadata (membership, roles, social graphs) is **radically minimized**: the crypto spec details the exact surface.

### 6.2 Anonymous groups

A `Channel` can be configured as `anonymous`:

- server-visible identifiers are reduced to channel pseudonyms;
- membership is never published outside the channel members;
- push, analytics, and log identifiers remain separated from the product identity.

This configuration weakens neither encryption nor moderation: it only constrains exposure on the server side and on the federation side.

### 6.3 Private discovery

- The `DiscoveryIdentity` is a technical attribute declared by the user (hashed phone/email, opt-in public username) and **never** conflated with the account identity.
- Discovery is purpose-bound: inputs and outputs are logged by the product with the same minimization requirement as federation.
- A no-address-book fallback must remain usable, otherwise the product would fall back to an external identifier.

## 7. Inter-instance federation (product view)

Federation is invisible in ordinary UX but explicitly handled internally.

### 7.1 UX principles

- A `FederatedIdentity` appears as a normal participant.
- The `:server` suffix is never imposed on screen; it is available on demand in the contact details.
- Degraded federation states (delay, uncertain delivery, remote revocation) are visibly reported in the conversation, without protocol jargon.

### 7.2 Product responsibilities

- remote identity resolution orchestrated by the Product API;
- inspection of federated trust (verification state, instance reputation);
- handling policy differences between instances (moderation, allowed agents, remote capabilities);
- explicit refusal of certain sensitive cross-instance operations (for example adding a local agent to a channel owned by another instance without an explicit grant).

### 7.3 Target federated topology

- Two or more Messagr instances, each backed by its homeserver (Synapse or Continuwuity).
- Agent runtimes are **per instance**: a local agent is never implicitly present on another instance.
- Tool gateways are **per instance**: no leakage of external action across instances without explicit grant.

### 7.4 Health

- Federation has operationalized health checks before any client-side diagnosis.
- The product distinguishes "faulty client", "degraded local homeserver", and "degraded remote instance".

## 8. Trust & safety UX model

### 8.1 Product-visible threat categories

| Threat | UX translation |
|---|---|
| Compromised linked device | Alert, possible freeze, remote removal. |
| Malicious authorized agent | Suspension, grant revocation, `degraded` marking. |
| Hallucinated external action | Escalation for human review, agent blocking. |
| Metadata leakage | Auditable discovery and federation views. |
| Federated abuse | Removal of remote participant, inter-instance escalation. |

### 8.2 Minimum moderation actions

- suspend an agent in a channel;
- revoke a `CapabilityGrant`;
- remove a federated participant;
- freeze a `LinkedDevice`;
- escalate an external action failure for human review;
- mark an agent as degraded or untrusted.

### 8.3 Consent and approval

- any sensitive action goes through a human approval gate;
- approvals, denials, failures, and suspensions are visible in the product audit;
- the audit does not silently become a second content store.

## 9. Product deployment topology

| Component | Typical runtime location |
|---|---|
| RN mobile app | user device |
| Tauri desktop app | user desktop, macOS first |
| Generic crypto bridge | embedded in client applications |
| Messagr Product API / backend | server environment controlled by the instance |
| Matrix homeserver | Synapse or Continuwuity |
| Application Service | next to the homeserver |
| Agent runtime | server or controlled workstation |
| External tool gateway | server-side integration tier |
| Discovery service | server-side trusted service |
| Recovery service / orchestrator | server-side service with strict boundaries |

### Typical topologies

| Scenario | Recommended arrangement |
|---|---|
| Single-instance test | 1 Messagr backend + 1 homeserver + 1 agent runtime |
| Federated test | Messagr A + Synapse, Messagr B + Continuwuity, shared or separate agent runtime sandboxes |
| Sovereign production | homeserver, product API, appservice, agent runtime, tool gateway, each with separate credentials and audit boundaries |

### Operational rules

- The agent runtime is not conceptually co-located with the crypto bridge.
- The Application Service is the main homeserver-side ingress for agents.
- Desktop rollout starts on macOS, then Windows and Debian/Ubuntu.
- Federation has health checks before attributing a failure to the client.

### 9.bis Desktop runtime choice — Tauri, not React Native Web, not PWA

The desktop client is a native **Tauri 2** application, never a web wrapper. This choice is structural and normative: any future reopening of the debate must proceed through an explicit amendment of this paragraph.

Rationale:

1. **Single-source cryptographic contract.** The crypto spec defines one Rust core `matrix-crypto-core` consumed by every client. Under Tauri, that same crate is **to be linked** into the desktop binary, invoked via `#[tauri::command]` — a binding that does not exist yet and whose feasibility a time-boxed spike establishes before any desktop screen is built, with native access to the OS keychain, disk, and system notifications. Under React Native Web or PWA, we would have to fall back to the parallel `matrix-sdk-crypto-wasm` binding — two crypto backends to audit, two encrypted storage formats to maintain, and the invariant “a desktop device is a `linked_device` like any other” does not translate the same way in WASM/IndexedDB as it does in native Rust/SQLite.
2. **System features required by the spec.** Screens 38–40 assume native macOS chrome, Dock badge, actionable notifications, local QR pairing, and the `messagr://` protocol handler. These primitives are official Tauri plugins; in a PWA they are either degraded or absent, and an address bar exposes the instance URL in contradiction with invariant §7.1 (“the origin instance is an infrastructure detail”).
3. **A single identity anchor.** The product cannot be “in the browser” without breaking §4.1 (identity generated on-device from a local root key): a multi-tab, multi-OS-user browser with easy data wipe is not an acceptable identity carrier.

Authorized reuse:

- The React components inside the Tauri window may use `react-native-web` inside the webview to share components with the mobile RN app, if the team finds it useful. This is an internal organization choice, not a deployment topology.
- Non-cryptographic business logic (stores, reducers, message shape, entity model) is shared mobile↔desktop in TypeScript.
- Design tokens (§13.17) are consumed by both targets with the materialization described at §13.17.

Out of scope in V1, not excluded later: a limited read-only web client (for example, to open a capability link from an unequipped machine). If it ever exists, it must be the object of a distinct written spec that states its cryptographic limits explicitly.

## 10. E2E testing strategy

### 10.1 Test topology

| Component | Role |
|---|---|
| Matrix test homeserver | backend and sync |
| Test discovery/recovery services | predictable flows |
| iOS simulator | user A |
| Android emulator | user B |
| Seeded identities | reproducible scenarios |
| CI orchestrator | build, launch, reset, run, report |

### 10.2 Pyramid

| Level | Content | Purpose |
|---|---|---|
| Rust / crypto tests | crypto machine, secrets, verification | correctness at the source |
| RN integration tests | JS API, native bridge, local integration | stable contracts |
| Detox E2E tests | real user journeys on real mobile | end-user confidence |

### 10.3 Canonical scenarios

Set A — messaging foundation:

1. Create user A on iOS.
2. Create user B on Android.
3. Discovery or invitation.
4. First chat.
5. Send A → B.
6. Assert reception on B.

Set B — trust and verification:

1. Open contact details.
2. Read initial trust state.
3. Perform QR or SAS verification.
4. Assert updated trust state in details and in the conversation.

Set C — 1:1 calls:

1. Start an audio call.
2. Answer on the second device.
3. State transitions.
4. Clean hang-up.
5. Repeat with video call.

Set D — recovery:

1. Export secrets.
2. Reinstall or restore on second device.
3. Import secrets.
4. Reconnect.
5. Receive a post-recovery message.

Set E — federation:

1. User A on Synapse instance, user B on Continuwuity instance.
2. Cross-instance discovery via invitation link.
3. Encrypted 1:1 cross-instance exchange.
4. Participation of an `AgentParticipant` from a single instance in a cross-instance channel, with explicit grants.

### 10.4 Audio/video strategy

- Daily CI focused on UI state, signaling, and transitions.
- Heavier nightly runs on real media validation and cross-platform robustness.

## 11. Delivery

| Phase | UX / test target | Outcome |
|---|---|---|
| Phase 1 | messaging + discovery + trust states | first automated flows |
| Phase 2 | QR/SAS verification + basic recovery | trust and continuity |
| Phase 3 | 1:1 audio/video calls | V1 communication loop complete |
| Phase 4 | hardened CI, nightly media validation, federated scenarios | maintainable mobile baseline |

**Agents are out of V1, deliberately.** No agent runtime, no agent creation or
configuration screens, despite the priority §13.1 assigns them. What V1 does carry is the
invariant: every participant declares its nature from the first conversation screen, so
that the timeline never has to be rewritten to admit a non-human. The screens of §13.4 and
the matrix of §5 describe the state after V1.

## 12. Immediate next steps

1. Translate user journeys into screen-by-screen wireflows.
2. Add test IDs and automation hooks in the RN UI from day one.
3. Stand up a disposable Matrix-based test environment.
4. Set up a two-device Detox pipeline before feature completion.
5. Wire recovery and verification UX states directly to the capabilities exposed by the crypto bridge.
6. Prototype a minimal cross-instance scenario (Synapse ↔ Continuwuity) in the test environment.

## 13. UI screens and surfaces (V3)

This section is the normative mapping between the V3 interactive prototype screens and the user journeys (§4), capabilities (§5), groups/communities (§6), federation (§7), moderation (§8), and deployment topology (§9). The V3 prototype supersedes V2: 41 screens, a full token system, closed design arbitrations. This section fixes the visible surface and interface invariants; the product journeys remain the source of truth for the underlying rules.

### 13.1 V3 screen inventory

The V3 prototype is organised in four rail rows. The “priority” column reflects the implementation order recommended by the V3 briefing.

**Row 1 — screens added in V3 (covered the V2 briefing gaps):**

| # | Screen | Target | Product reference | Priority |
|---|---|---|---|---|
| 1 | Receiving an invitation | Mobile | §4.1, §4.2 | 1 |
| 2 | Spent or revoked link | Mobile | §4.2 | 1 |
| 3 | Create an agent | Mobile | §3, §4.7 | 2 |
| 4 | Configure an agent (edit mode) | Mobile | §5.4 | 2 |
| 5 | Add an agent to a room | Mobile | §4.7 | 2 |
| 6 | Create a room | Mobile | §6.1 | — |
| 7 | Create a community | Mobile | §6.2 | — |
| 8 | Administer an anonymous room | Mobile | §6.2, §8.1 | — |
| 9 | Notifications centre | Mobile | §4.3, §8.2 | — |
| 10 | Offline | Mobile | §4.3 | — |
| 11 | First message sent | Mobile | §4.4 | — |
| 12 | Erase a message | Mobile | §8.3 | — |
| 13 | Erase my account | Mobile | §8.3 | 5 |
| 14 | Export my data (GDPR) | Mobile | §8.3 | 5 |
| 15 | Report content | Mobile | §8.1 | — |
| 16 | Block a contact | Mobile | §8.1 | — |
| 17 | New device detected | Mobile | §4.6, §9.2 | — |
| 18 | Remove a device remotely | Mobile | §4.6 | — |
| 19 | Mobile settings (full parity) | Mobile | §9.3 | 3 |

**Row 2 — screens carried over from V2, aligned with the token system:**

| # | Screen | Target | Product reference |
|---|---|---|---|
| 20 | First launch (brand) | Mobile | §1 |
| 21 | 1:1 conversation (density reference) | Mobile | §4.1, §4.3 |
| 22 | Agent in drawer — retained direction | Mobile | §4.7 |
| 23 | Agent in thread — documented, per-room toggle | Mobile | §4.7 |
| 24 | Capability sheet (read) | Mobile | §5.1–§5.4 |
| 25 | Trust explained | Mobile | §4.4 |
| 26 | SAS / QR verification | Mobile | §4.4 |
| 27 | Show your code | Mobile | §4.2, §4.4 |
| 28 | Scan a code | Mobile | §4.2, §4.4 |
| 29 | Private discovery | Mobile | §4.2, §6.3 |
| 30 | Community and channels | Mobile | §6.1, §6.2 |
| 31 | Federated participant | Mobile | §7.1, §7.2 |
| 32 | 1:1 audio call | Mobile | §4.5 |
| 33 | 1:1 video call | Mobile | §4.5 |
| 34 | Devices and continuity | Mobile | §4.6 |
| 35 | Journal and measures | Mobile | §8.1–§8.3 |

**Row 3 — system:**

| # | Screen | Target | Product reference |
|---|---|---|---|
| 36 | Palette and design tokens | Documentation | §13.17 |

**Row 4 — Tauri desktop (macOS first):**

| # | Screen | Target | Product reference |
|---|---|---|---|
| 37 | Desktop home | Desktop | §9 |
| 38 | Desktop — first launch | Desktop | §9.1 |
| 39 | Desktop — device pairing | Desktop | §9.2, §4.6 |
| 40 | Desktop — settings | Desktop | §9.3 |

A forty-first rail screen exposes the tokens; it is not user-facing and is part of the engineering delivery contract.

### 13.2 Design arbitrations closed by V3

The V3 briefing identified seven ambiguities to resolve. All are closed and materialised on screen.

| Arbitration | Decision | Screen where visible |
|---|---|---|
| §2.1 — agent direction A / B | B (drawer) is the retained direction. A (thread) remains documented and becomes a per-room setting, never a global default, never silent. | Screens 22, 23, 19 (Agents section of settings) |
| §2.2 — palette | Full normative palette: four semantic families (green, agent, wait, deny) + neutrals + surfaces. 24 named values, carried by `tokens.json`. | Screen 36 |
| §2.3 — capability sheet read vs edit | Single sheet, two explicit modes. Read / Edit label at the top; locks look identical in both modes. | Screens 24 (read) and 4 (edit) |
| §2.4 — room-policy locks | Two locked settings materialised with the room name, the reason, and the conflict rule (most restrictive wins). Never hidden. | Screen 19, Agents section |
| §2.5 — call control bar | Five reserved slots, one documented for group-call controls (out of V1) — no future redesign. | Screen 33 |
| §2.6 — MLS and community | Two transition states annotated: “joining” on an anonymous room, “room migrating” from Megolm to MLS. Colours: ochre (wait), ink dotted (mechanism). | Screen 30 |
| §2.7 — strong suffix | 4 characters, alphabet A–Z + 2–9, exclusions 0, O, 1, I. No merging on prefix collision. Rule also carried by `tokens.json` (`identifier`). | Screen 29 |
| §2.8 — journal audience | Two switchable views: member (public room decisions + decisions concerning them) and administrator (superset with suspensions and device freezes). Explicit absence of a global cross-room view. | Screen 35 |

### 13.3 Entry and invitation handling (§4.1, §4.2)

**Screen 1 — Receiving an invitation.** The product's entry point. The link is fully described before decision: sender, scope (room or 1:1), validity, remaining uses, origin instance. Any agent present in the room is announced here, not discovered after; its sheet is consultable before accepting. Two symmetric actions: join, refuse. No “continue anyway”.

**Screen 2 — Spent or revoked link.** No error code, no “retry”. The text explains the rule (single use, limited duration) rather than the incident. Only useful action: ask the sender for a new link. The product never offers to bypass the limit.

### 13.4 Agent creation and configuration (§3, §4.7, §5.4)

**Screen 3 — Create an agent.** Four ordered decisions: what it does (subtype), what it's called, who answers for it (responsible owner — named at creation, imputed in the journal), where it exists (scope). Nothing is published at this stage: creation is not a social act, insertion into a room is.

**Screen 4 — Configure an agent (edit mode).** Same sheet as §13.14, but editable. The Read / Edit label at the top fixes the mode. Locked capabilities (invitation, or capability locked by a room policy) look exactly identical in both modes.

**Screen 5 — Add an agent to a room.** Insertion is announced to the room members with the name of the person who did it. Local capabilities chosen here are bounded by the agent's global caps — never above.

### 13.5 Room and community creation (§6.1, §6.2)

**Screen 6 — Create a room.** Four equal-rank variants (with agent, open via link, anonymous, restricted). The technical consequence of each is stated in clear. An anonymous room does not become nominative again: this is said before, not after.

**Screen 7 — Create a community.** A community groups rooms under a regenerable pseudonym, with no computable link to the primary identifier. It authorises nothing by itself: each room keeps its members.

**Screen 8 — Administer an anonymous room.** The administrator sees only room-scoped pseudonyms: anonymity holds against them too, and this is stated on screen. Roles are signed from devices, verifiable by members. Suspension is red, as every measure.

### 13.6 Waiting states and one-time pedagogy (§4.3, §4.4)

**Screen 9 — Notifications centre.** Four families only: agent proposals, received invitations, verifications to do, suspended external actions. Each card carries the colour of its nature (ink agent, green human, ochre wait). No red badge, no aggressive counter. Mobile mirror of the desktop notifications bar.

**Screen 10 — Offline.** The screen does not say “network error”: it says what will happen and that the user has nothing to redo. Queued messages carry ochre (waiting on an external factor), never red. Send button stays active.

**Screen 11 — First message sent.** The only moment where encryption is named in an ordinary conversation, right after the first send. Chains onto the one useful action — verify the person — without forcing it. The screen commits not to repeat itself: “This message will not come back.”

### 13.7 Erasure, export, GDPR (§8.3)

**Screen 12 — Erase a message.** Two scopes named without euphemism: for me, for everyone. Erasure-for-all leaves a line in the room journal — a removal is a social fact, not a silent disappearance.

> **Amended 9 September 2026, on implementation (#192).** This paragraph asked for a *"retraction delay shown in seconds on the bubble"*, and that clause is withdrawn rather than built. **Matrix does not bound a redaction in time**: it works indefinitely, and any other client on the same account ignores whatever limit this one draws. A countdown on the bubble would claim the protocol enforces a rule it does not — the same shape of defect as the code that believed `AndroidCategory.CALL` got past Do Not Disturb, which a telephone disproved the day before.
>
> Two clarifications the implementation forced, kept here because a reader of this screen needs them:
>
> **"For me" cannot mean erasing a local copy.** ADR-0006 keeps nothing decrypted on disk, so there is none. It means this device stops drawing the message — a row in the encrypted notebook (`hiddenStore.ts`). It does not travel: another device of the same account still draws it, and a reinstall brings it back. The screen says so, because somebody not told will find the message again and conclude the product lied.
>
> **"For everyone" is offered only on your own messages.** Redacting somebody else's is a moderation power, not a delete button. That the room defaults grant it to whoever created the conversation is unintended and tracked as #196.

**Screen 13 — Erase my account.** Ceremony assumed: what disappears, what stays at other people's, what is irreversible, before any button. Colour does the sorting. The GDPR export is offered before deletion; the seven-day retraction window is announced. Type-a-word confirmation is the only place in the product where typing something is required to continue.

**Screen 14 — Export my data (GDPR).** Archive produced on the device, never uploaded to a server. Explicit distinction from the recovery vault (screen 34): the export is readable elsewhere and restores nothing. Encryption via a six-word phrase — the same mnemonic mechanism as verification.

### 13.8 Individual moderation (§8.1)

**Screen 15 — Report content.** Three destinations, ordered from most local (default) to most exposing. Local report contacts no server. Escalating to administrators or the instance is explicit, with its consequence stated.

**Screen 16 — Block a contact.** Effects table that states what blocking does and, importantly, does not do. No notification to the blocked person. Current block list on the same screen: blocking is not a point of no return.

### 13.9 Companion device handling (§4.6, §9.2)

**Screen 17 — New device detected.** Dark screen (security boundary). Facts first (device, place, time, method), decision after. Two outcomes: it's me, cut it. Refusal is as accessible as acceptance. Reminder that verified contacts also see the device: a device never appears quietly.

**Screen 18 — Remove a device remotely.** Critical flow handled separately from the Devices screen: four steps stated before the action. The limit is stated honestly: cutting access does not erase what has already been downloaded. Red reserved for the measure itself.

### 13.10 Mobile settings — six-section parity (§9.3)

**Screen 19.** The six desktop sections, in the same order, with the same labels: General, Privacy, Agents, Devices, Network, Notifications. No “open on computer” redirect. Parity was the V2's most costly gap since mobile is the reference device.

Two normative mechanisms are materialised here:

- **Room-policy locks** — a locked setting appears greyed, with the room name, the reason, and the explicit rule: the most restrictive wins.
- **Direction A / B toggle** — in the Agents section, per room (“Allow an agent to speak in the thread”). Never a global default, never silent. Switching a room to direction A appears in the journal.

The six tabs scroll horizontally instead of collapsing into a menu.

### 13.11 Screen 20 — First launch (§1)

The only branded screen in the journey. Four points in natural language: E2E encryption without setup, no address-book aspiration and no ads, agents as declared participants (announced in the promise, not discovered later), invitation-based entry. Single `Start` action. The 45° notch is an accent on the button, never a background motif. The screen does not come back.

### 13.12 Screen 21 — 1:1 conversation (§4.1, §4.3)

Reference screen, most frequent. Fixes the application's density: date separators, timestamps, double read receipts, reactions, typing indicator, photo album, voice message with waveform, full input bar. Encryption is not restated here, it is a given. Wherever Messagr's specificity adds no value (agent, verification, degraded delivery), the application looks like an ordinary messenger.

### 13.13 Screens 22 and 23 — Agents (§4.7, §5.2)

**Screen 22 — Retained direction (drawer).** Agent in a drawer collapsed above the input. The thread only contains human messages. Output is private until explicit insertion. Each proposal shows: “41 messages read · nothing kept”, responsible owner, granted capabilities. Two actions: *Insert into thread* or *Keep for me*. The drawer must remain visible even when collapsed, and insertion must always credit the agent in the thread — otherwise the “a participant is never implicitly human” invariant would not hold.

**Screen 23 — Documented direction (thread).** Agent speaking directly in the thread, dotted agent border, monospace label, never green. Documented as a possible evolution, activable per room in Agents settings (§13.10). Defensible on desktop where space absorbs the noise.

### 13.14 Screen 24 — Capability sheet, read mode (§5.1–§5.4)

Seven canonical capabilities:

1. Read messages in the room — flagged separately because it widens the decryption circle.
2. Write in the room.
3. Open attachments — separate grant.
4. Mention members — default cap `≤ 3 per day`.
5. Trigger an external tool — denied by default.
6. Act on your behalf — denied by default, requires a dated, scoped agreement.
7. **Invite participants — locked, never grantable to an agent**, displayed greyed rather than hidden.

Read mode: inactive toggles, link to edit. Edit mode (screen 4): same rows, actionable. Locks look identical in both modes.

### 13.15 Screens 25 to 35 — V2 screens retained

Screens 25 (trust explained), 26 (SAS/QR verification), 27 (show your code), 28 (scan), 29 (private discovery), 30 (community and channels), 31 (federated participant), 32 (audio call), 33 (video call), 34 (devices and continuity), and 35 (journal and measures) are carried over without major functional change. They inherit the V3 tokens and the arbitrations of §13.2.

Two new annotations carried by V3:

- **Screen 30 (community)** — two explicit MLS transition states: “joining” on an anonymous room (anonymous session setup is not instantaneous), “room migrating” for a Megolm → MLS switch.
- **Screen 33 (video call)** — five command slots, with one slot reserved and documented for group-call controls (mute a participant, manage the stage). Out of V1, but the geometry is fixed.
- **Screen 35 (journal)** — two switchable audiences: member view, administrator view. The absence of a cross-room global view is stated in writing.

### 13.16 Screens 37 to 40 — Tauri desktop, macOS (§9)

The desktop is the second V1 target (macOS first, then Windows, then Debian/Ubuntu).

- **37. Desktop home** — three columns: conversations, thread, right pane that only exists on desktop (agent capability sheet consultable without leaving the thread). This is where direction A becomes viable again, without redesign.
- **38. Desktop first launch** — the desktop does not create an identity; it exists only as a device of an identity already carried by the phone. One action only: *Link this computer to my phone*.
- **39. Device pairing** — physical gesture with oneself. Word pair displayed on both sides, same mechanism as contact verification (§13.15). Verified contacts see the new device appear.
- **40. Desktop settings** — six sections. Agent capabilities are caps; a room can grant less, never more. A locked setting stays visible, greyed, with its reason.

Tauri framing: default window 900×600, native macOS chrome, title bar carrying context and nothing else. Agent column 280 pt in wide desktop (≥ 1180 pt), collapsed as a drawer in narrow desktop (≤ 780 pt).

### 13.17 Design token system (V3 — normative)

The V3 palette is carried by `tokens.json`, the single source consumable by React Native and Tauri. Any colour not listed there is a bug of the prototype, not of the product.

**Colour — four semantic families.**

| Family | Role |
|---|---|
| `brand` (green 500 / 700 / 100, ink 900) | Human + verified. Primary action, receipt, brand, security boundary (`ink900`). |
| `agent` (700 / 400 / 100 / border) | Agent ink, with `agent.400` legible on dark backgrounds (4.6:1 contrast on `ink900`, WCAG AA text). The `agent.border` dotted stroke is never a disabled state. |
| `wait` (700 / 500 / 200 / 100) | Waiting on a human gesture or the network: agent draft, deferred send, recognized-but-not-verified contact. |
| `deny` (700 / 500 / 200 / 100) | Measure or refusal: suspension, revocation, blocking. Never a warning. |

A **neutral** scale (900 / 600 / 400 / 300 / 200): `neutral.300` is the only allowed disabled grey — it never means “agent” any more, closing the V2 briefing ambiguity.

Three **surfaces**: `paper` (light background), `sunk` (conversation background), `raised` (incoming bubble, input field).

**Typography.**

- System per platform: SF Pro Text (iOS/macOS), Roboto (Android), Segoe UI Variable (Windows).
- Brand: Schibsted Grotesk — brand screen and logotype only.
- Mono: JetBrains Mono — identifiers, fingerprints, technical labels.
- Eight type roles: `display 30/36`, `titleLg 22/27`, `titleMd 17/22`, `body 14.5/21`, `bodySm 13/19`, `caption 11.5/17`, `monoLabel 9.5/14 (uppercase +0.14em)`, `monoId 11/16`.
- Floors are carried by `tokens.json` under `floors`, which is the source: 11.5 pt
  minimum body, 9.5 pt minimum mono, 44 pt minimum touch target, and two line-height
  ratios rather than one — 1.35 for running text (`body`, `bodySm`, `caption`, and the
  `mono` roles), 1.2 for `title` roles, where tight leading is correct typography rather
  than a defect. **Scope, not the scale, was the correction:** a single ratio applied to
  every `type` entry rejected four of the eight roles at V3's first export; each floor now
  names the classes it governs, and `tokens.json` records which role verifies which value.

**Shapes.** Radii: bubble 16 pt (author corner 4 pt), pill 26 pt, avatar 50%. 45° notch: accent reserved for buttons (16 pt, top-right), framing cards (22 pt, top-right), agent marker (32% of side, bottom-right). Never a background motif.

**Elevations.** Three levels: `1` (light separation), `2` (cards), `modal`.

**Motion.** Three canonical animations: `enter 450 ms ease-out`, `toggle 180 ms ease`, `scan 1900 ms ease-in-out alternate`.

**Responsive.** Mobile ≤ 430 pt. Desktop base 900×600 pt. Wide desktop ≥ 1180 pt (agent column 280 pt, thread capped at 720 pt). Narrow desktop ≤ 780 pt (agent column collapsed as drawer). Tablet: not addressed in V1, to be scoped after V3 — a documented absence is better than an invented value.

**Identifiers** (carried by tokens.json, §2.7 arbitration closed): format `@prefix#SUFFIX`, 4-character suffix, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, exclusions `0 O 1 I`. No merging on prefix collision: two accounts sharing a prefix remain two distinct lines, suffix in mono and bold.

**Token consumption mechanics.** `tokens.json` is the single source. Two derived consumptions are normative:

- **Mobile React Native.** The file is imported as-is in TypeScript (`import tokens from "@messagr/design-tokens"`) and exposed as a style object. Numeric values (`size`, `lineHeight`, `radius`, `notch.button.size`, layout points) are points, never pixels nor `rem`. Colors are handed to components through a single `ThemeProvider`, never hardcoded inside a `StyleSheet`.
- **Desktop Tauri.** The same `tokens.json` is transformed at build time into a CSS variables file (`--messagr-color-brand-green500`, `--messagr-radius-bubble`, etc.) loaded before the first webview render. Window CSS uses only those variables, never a hardcoded value. The transform is a CI-verifiable build script, not a manual job.

A third, documentation-side consumption is the standalone HTML file delivered by the designer; it is not on the product build path.

Conformance rule: a CI lint (mobile + desktop) rejects any color, radius, elevation, or duration value that is not referenced from tokens. A divergence between `tokens.json`, the mobile style, and the desktop CSS is a blocker bug, not a preference.

### 13.18 Default application settings (mobile and desktop)

Default-on settings. Some are locked by a room policy when the room policy is stricter.

| Section | Default-on setting | Scope |
|---|---|---|
| General | Launch at startup, Dock badge | Account |
| Privacy | Typing indicator, read receipts, online presence (verified contacts only) | Account |
| Agents | Proposed draft allowed, agent logging (not disableable in a shared room) | Account + room |
| Devices | Peer-to-peer history sync, 15-minute auto-lock, remote revocation | Device |
| Network | Discreet flagging of remotely-hosted participants, relay allowed when direct fails | Account |
| Notifications | Message preview (after first unlock), agent proposal notification, quiet hours 22:00–07:30 | Device |

### 13.19 Interface invariants (V3 normative)

These rules take precedence over aesthetic choices and are normative for any UI evolution.

1. A participant is never implicitly human. An agent says so visually every place it appears.
2. Encryption is restated only where it adds information (first send, verification, call), not on every conversation screen.
3. Green is a signal, not a decoration. **`brand.green500`'s own token states what it means, and that list is the whole list**: *« Humain et vérifié. Action principale, accusé de lecture, marque. »* Nothing else may be green — not a list accent, not a heading, not a divider, not a state that merely happens to be positive. Wherever green appears, a reader must be able to name which of the four it is.

   *This invariant used to read “it is used only for verified humans”, which was narrower than the token file it governs and which the product had never obeyed: the brand screen's action, its bullets and the mark were already green when it was written. Narrowed rules that the product contradicts are worse than no rule, because the next person resolves the contradiction by ignoring the rule. Reconciled with `tokens.json`, which is normative (invariant 11).*
4. No “continue anyway” button crosses a security boundary (failed SAS, refused-origin code, ungranted external action, unrecognised new device).
5. Recognising a contact ≠ being able to write to them. Discovery, trust, verification remain three distinct notions.
6. Degraded states are stated in natural language, never with an error code or the word “federation”.
7. Any capability or device change appears in the relevant room's journal, visible to its members.
8. The journal records decisions and refusals, never contents.
9. A capability locked by a room policy stays visible, greyed, with its reason — never hidden.
10. A stricter room setting overrides a more permissive account setting.
11. Any colour, size, radius, elevation, or duration absent from `tokens.json` is forbidden in the product.


### 13.20 The conversation list (designed here, not in the prototype)

The prototype draws a conversation list only in the desktop window; every
mobile screen it draws is standalone, with its own header and a back chevron.
So this screen was designed against `design/tokens.json` and the invariants
above, and is recorded here for the designer's next export rather than being
drawn twice.

**A row is an avatar, two lines, and a tail.** The avatar is a circle
carrying initials — of the given name when there is one and of the identifier
when there is not, which is the same rule the first line follows, so the two
can never disagree. **No photographs**, and not because they are hard: a
profile picture is a piece of content the homeserver would hold unencrypted
and serve to anybody who knows the identifier, which is the shape of thing
this product spends its design avoiding.

The first line names the other participant, the second carries the opening of
the last message. The tail carries when the conversation last moved and, when
there is something waiting, how much.

**The timestamp takes four forms**, because a row has room for about five
characters and a person is asking a different question at each distance:
`09:38` today, `hier`, a weekday within the week, a date beyond it. The
comparison is on **local calendar days, not elapsed hours** — "yesterday" at
one in the morning means the day before, and a rule written in milliseconds
gets that exactly backwards.

**The first line distinguishes a name from an identifier typographically, not
with a badge.** A given name is set in `titleMd`; an identifier is set in
`monoId`. A badge saying "not named yet" would be a second thing on the row
repeating what the first already says.

**Three silences are told apart on the second line**, because they mean
opposite things to the person reading them: nothing has been said yet,
something was said that this device cannot read, and the conversation could
not be reached at all. Invariant 6 governs the wording — a sentence, never an
error code; the technical reason goes to the log.

**Ordering is most-recently-active first, ties broken by identifier.** A
stable tie-break matters more than it looks: two conversations swapping places
between launches reads as movement nobody caused.

**A conversation with no single other participant shows its own identifier.**
More than two participants is a channel, which this lot does not build; until
it does, the row must still be distinguishable rather than blank. This was
found on a device, not in review: a bench room of three rendered a row whose
first line was empty.

**No padlock** (invariant 2). Every conversation here is encrypted, so saying
so on each row says nothing and trains a person to ignore the badge where it
would matter.

**Green is spent once, on the unread badge** (invariant 3). Not as a list
accent — the rows, the separators and the timestamps are neutral. Green is the
signal reserved for a verified human, and what the badge marks is a human
having spoken to you: the same claim, made about an event rather than about a
person.

**The unread count is a local mark, and that is the design rather than a
shortcut.** Matrix computes an unread count of its own, from the read receipts
a client publishes. This product will not lean on it: receipts are public
metadata, they are off by default (§13.18), and a badge that only worked for
people who had agreed to be observed would be a privacy setting that quietly
costs a feature. So the mark is kept on the device, in the application's own
encrypted notebook (ADR-0010, second table), and it means what a person means
by it: *the newest thing that was on screen the last time you looked at this
conversation, here.*

Reading a conversation writes **two** marks, and they are not redundant. The
local one is what the list draws. A **private read receipt** (`m.read.private`)
is sent always — it says to the homeserver and to nobody else that the message
has been read, which is what stops the server pushing a notification for
something already read. The **public receipt** (`m.read`) is the courtesy, and
goes only when the setting says so.

The count is bounded by the window the list fetches. A conversation left alone
for a hundred messages reports the window's size, and that is honest about a
list built from a window; extrapolating past it would not be.

**Naming is offered from inside the conversation, not from a row.** The list
is where a name is read; the conversation is where you know whose it is. The
hint sits above the field rather than below it, because somebody typing a real
name into a pseudonymous messenger is entitled to know where it goes before
they type it: *« Ce nom reste sur cet appareil. Ni le serveur ni votre
correspondant ne le voient. »* (ADR-0010.)


### 13.22 Photographs (designed here)

**Two encryptions, not one.** The bytes are sealed with a key of their own and
uploaded to the media repository; that key travels inside the conversation's
own encryption, in the event pointing at the upload. The homeserver ends up
holding two things it cannot join — a file it has no key for, and a key it
cannot decrypt. This is Matrix's design and not an invention here, and it is
what lets the media repository be a store that never learns who may read what.

**The upload declares `application/octet-stream`, and the photograph's type is
not sent.** What goes to the repository is ciphertext. Declaring `image/jpeg`
would be a claim about bytes nobody there can read, and it would tell the
server what kind of thing was sent — which is precisely the metadata the
encryption is for. The real type travels inside the event.

**The event is an ordinary encrypted `m.image`**, with the address and the key
material in one `file` object, which is the shape the specification already
has. This costs reading a value the crypto bridge documents as opaque, and the
reason is recorded where it is done: not reading it would produce an event only
this application could open, in a protocol whose point is that it is not only
this application.

**Nothing touches a disk, in either direction.** The picker hands over bytes
rather than a path — a path is a promise about a file in a cache the system may
clear. Coming back, the plaintext reaches the view as a `data:` URI, because
the obvious alternative is a path to a decrypted file and ADR-0006 forbids
exactly that. The cost is stated where it is paid: a data URI is the image
base64'd, so it lives as a string for as long as the view holds it, and that
bounds how large a photograph can be shown. The same bound applies to sending,
because the encryptor holds the plaintext and the ciphertext at once.

**`body` is not the filename.** A name off somebody's camera roll carries a
date, sometimes a place, occasionally a person's name — and while it does not
reach the server, it reaches everybody in the conversation, who did not choose
to receive it by being sent a photograph. `body` is the fallback a client shows
when it cannot draw the picture, and `image.jpg` does that job.

**Each photograph fetches itself when it is drawn**, not when the conversation
is derived, and it fails on its own: a picture that will not download is a
sentence in that message and not a conversation that failed. While it loads,
the frame is drawn at the picture's own proportions rather than as a spinner,
so the timeline does not reflow as photographs arrive. What it fetches is the
smallest copy the surface can use, which is §13.29.


### 13.24 Several photographs, read as one plate (designed here)

**Matrix has no album event, and this does not invent one.** Each photograph
is its own `m.image`, which is what every other client reads. What makes
several read as one thing is a **reading of the timeline**: consecutive
images, from one sender, within five minutes. An album event would be a shape
only this application could open, in a protocol whose point is that it is not
only this application — the same argument §13.22 makes about the attachment
secret.

**All three conditions, and each earns its place.** One sender, because two
people posting at once is two plates and merging them attributes one person's
photographs to the other. Nothing said in between, because a sentence between
two pictures means they were not one gesture. Within five minutes, because
consecutive in a timeline is not the same as sent together.

**A plate of one is still a plate**, so a screen has one shape to draw rather
than two.

**Four tiles, square, and a count on the fourth.** The pictures are not square
and the tiles are: a grid of differently-shaped tiles is a grid nobody can
scan, so a tile crops, which is what a thumbnail is for. Beyond four the last
tile carries `+ N` and opens at the **fifth** — the first photograph it stands
for, not one already on screen.

**Full screen pages through the whole plate**, not the four that were drawn.
Somebody who taps the count is asking to see what the count stands for.

**Sent one at a time, never at once.** `encryptAttachment` holds the plaintext
and the ciphertext together, so thirty concurrent is sixty copies in memory
and a phone killed by the operating system rather than slowed. Fifty at most,
and that cap is enforced twice — in the picker and in the send path — because
a limit enforced in one place is a limit until somebody edits that place.

**A failure stops the run and names the boundary.** Carrying on would send the
fourth after the third failed, leaving a hole a person cannot see; stopping
says how many went and how many are still there to send.

**No view-once, and no disappearing media.** The reference for this screen has
it; this product does not support it and will not pretend to. A control
promising a photograph would vanish, on a protocol with no such guarantee,
would be the worst kind of lie this product can tell.


### 13.23 The first launch: a language, then an acceptance (designed here)

Two gates, in that order, before anything else happens.

**The language is chosen by dragging a thumb across flags.** Not a dropdown: a
horizontally snapping strip, and whichever language is centred is the one the
screen is speaking **while the drag is happening**. Trying a language costs a
thumb movement rather than a decision, and somebody who cannot read the screen
does not have to guess which menu holds the languages — the flags are visible
at rest and the screen answers as they pass.

**A flag and the language’s own name for itself**, never the flag alone. A flag
names a country and not a language; the endonym settles that without giving up
the recognisability that made the flag worth having, which matters when the
strip has to be readable by somebody who cannot read the screen behind it.

**Six languages: FR, EN, DE, ES, IT, NL**, each a complete catalogue. Complete
is enforced by the compiler — a catalogue is `Record<CopyKey, string>`, which
has no optional keys — and **there is no fallback to French**, because a
fallback is how a half-translated language ships and nobody notices: the screen
reads fine to whoever wrote it. Tests assert that every catalogue carries
exactly French’s keys, has no empty string, and keeps every placeholder French
has.

**What an unset choice falls back to is the device’s own language**, when this
application speaks it, and French otherwise. Not French unconditionally: a
phone set to Dutch meeting a French screen for no reason its owner could act on
is the failure this prevents.

**Nothing starts until the terms are accepted.** A checkbox, unticked at first
launch, with the conditions one tap away at the published address — so the
acceptance is of a text somebody can read rather than of a sentence about a
text. *« En continuant vous acceptez… »* is an acceptance nobody made; a tick
is something a person did.

**The action is not greyed out.** It is pressable, does nothing, and says what
is missing. A disabled button gives no reason, and somebody who missed the box
has no way to learn what is wrong with the screen — which is invariant 6’s rule
about errors, applied to a gate.


### 13.21 The bottom bar, the header and the floating action (designed here)

**Four tabs: Discussions, Communautés, Appels, Réglages.** Icon above label.
The active one carries a pale green pill behind its icon (`brand.green100`)
and a green label (`brand.green700`); the others are neutral. The glyph is 20
and the target is 44 — the size of the glyph is never the size of the button.

**Two of the four are reserved before the thing they hold exists, and each
says so on its own screen.** *« L'onglet est réservé dès la V1 pour ne pas
déplacer la barre plus tard. »* Appels names what is coming and when — vocaux
en V2, appels individuels puis de groupe en V3.

**This is not the same rule as §13.18's "sections not built are absent rather
than present and inert", and the two must not be confused.** A settings switch
that toggles nothing is a lie about a capability somebody might rely on. A
reserved tab carrying a screen that explains it is reserved is a promise with
a date on it, and it buys something real: a navigation bar that does not move
under people's thumbs the day calls arrive. The difference is whether the
empty thing pretends.

**The bar is hidden while a conversation is open.** A conversation is a place
you leave, not a fifth tab.

**Badges.** Discussions carries a count of **unread messages**, which is the
same unit the rows carry, so that the two numbers on one screen add up.

This said the opposite until 8 September 2026: *« a count of conversations
with something waiting, not of messages — a tab saying `47` for one chatty
conversation would send somebody looking for forty-seven places to go »*. The
argument is kept rather than deleted, because whoever revisits this should
meet it before deciding again.

It was overruled by the account holder, who reported the same thing twice: a
`6` on a row and a `1` on the tab, read as a desynchronisation between the
badges. Two numbers in one glance, in different units, with nothing on either
saying which unit it is — and every messenger this product is compared to
puts the message count on the tab. The count is not what somebody has to be
told; the DIVISION is, and a screen cannot say it.

What the old argument was protecting is real and still there: it is the
**rows** that say where to go. The tab only says how much.

**Communautés carries nothing.** The mockup draws a dot there and this section
used to describe one; the component carried a prop, a style and a test
identifier for it, and nothing anywhere set them, so it could not render on
any screen. Communities do not exist yet, so nothing can be waiting under that
tab. A badge behind a flag nobody raises is the "number invented to fill a
shape" this same paragraph refuses two sentences earlier. It comes back with
communities.

**The header is a dark band, and it is a security boundary rather than a title
bar.** `brand.ink900` is *« fond des frontières de sécurité »* in the token's
own words. It carries the mark and the wordmark, and on the right, in the mono
role, the one fact about this instance nobody would guess: *« aucun annuaire
»*. No screen title — the screen below already says which screen it is. The
mockup suffixes the state with a phase marker; that marker is a reference to
this specification for whoever reads the mockup, and does not belong on the
screen of somebody reading their own messages.

**A green circular + floats above the bar, and it is the only way to invite
somebody.** The inline button under the list is gone. With four tabs, a
control living inside one tab's content scrolls away with it, and inviting is
the one thing a person opens this application to do that is not reading. Two
entrances to the same gesture would also be two things to keep in step, and
the second would be the one nobody updated. It is green because `green500` is
*« action principale »* in the token's own words: if the floating action is
not the principal action, nothing is. Its sign is ink, not paper — white on
`green500` is about two to one, which fails AA.

**The list or the invitation, never both** — the same rule the list and the
conversation already follow, for the same reason.


## 14. Canonical glossary

This section is the project's canonical glossary. The bridge and crypto specs only carry the subset strictly relevant to their perimeter.

| Term | Canonical meaning |
|---|---|
| Matrix room | Low-level container used by the protocol. |
| Conversation space | Product abstraction on top of a room or a set of rooms. |
| Direct conversation | 1:1 conversation between two participants. |
| Channel | Multi-participant collaborative conversation. |
| Community | Pseudonymous application object grouping `Channel`s. |
| Participant | Human or agent member of a conversation space. |
| Human user | A real person using Messagr. |
| Agent participant | Non-human participant with explicit identity and capabilities. |
| Linked device | Secondary device attached to an account, including desktop companions. |
| Trust state | Product-visible trust signal `unverified` / `recognized` / `verified`. |
| Verification | Cryptographic process that modifies trust state. |
| Discovery | Mechanism for finding contacts or approved agents. |
| Discovery identity | Discoverability attribute declared by the user (hashed phone, email, username). |
| Federation | Matrix server-to-server communication between homeservers. |
| Federated identity | Identity of a remote participant on another homeserver. |
| Product API / backend | Messagr-specific service layer above Matrix. |
| Generic crypto bridge | Native RN library exposing modern Matrix E2EE. |
| Agent runtime | Model/memory/orchestration layer for AI participants. |
| Tool gateway | Controlled execution layer for external APIs and actions. |
| Capability grant | Explicit permission for an action or an access scope. |
| External action | Invocation of a tool or workflow outside Messagr. |
| Recovery bundle | Product-facing artifact used to restore encrypted account continuity. |
| Audit log | Structured record of security- or action-relevant events. |
| Anonymous channel | `Channel` configured to minimize server exposure of membership and roles. |
| Capability link | Invitation or sharing link carrying a scoped, limited-use authorization. |

## Consolidation notes

This version integrates:

- the overall architecture view (portion "logical architecture" of the 4th document);
- the canonical entity model and its agent subtypes;
- the full permission and capability matrix;
- the trust & safety UX model;
- the product deployment topology and its scenarios;
- the full canonical glossary;
- the cross-cutting decisions on groups (pseudonymous community, capability links, client-signed roles, anonymous channel), anonymity (identity/discovery split, metadata minimization, explicit recovery choice), encryption (product positioning, MLS target for communities), and inter-instance federation (UX invisibility + explicit Product API handling, multi-instance topology, health, cross-instance tests).

The standalone formalization document is no longer the source of truth for this portion and remains only as a migration note.

### 13.25 An invitation is a picture as well as a link (designed here)

**Beside the link, never instead of it.** The invitation screen draws the
link as a QR code under the link itself. The two people an invitation
matters most for are the ones standing next to each other — which, in a
product entered only by invitation, is the ordinary case rather than an
edge one — and a camera is the gesture for that. But the link stays
readable and selectable: reading it aloud is the path that has to work when
a camera does not, and it is the only path for somebody with one phone.

**The symbol is the same one the website draws.** `messagr.eu/i/<token>`
has drawn a QR since before the application could, for the desktop case
— *« Ouvrez ce lien depuis votre téléphone… Scannez ce code »*. Its
encoder exists because that page's content security policy forbids an
external script. The application's encoder is a port of it rather than a
package: one encoder rather than two is what the page's own note asks for,
since a symbol written at one error-correction level and read at another
is not the same symbol.

**Level M, byte mode, versions 1 to 20.** The level is a constant shared
with the page and not a setting. Twenty versions cover an invitation link
with room to spare and stop short of the versions whose modules are finer
than a phone screen draws honestly.

**The encoder is verified by decoding, not by looking.** The website's copy
is checked by eye, which catches a symbol that is obviously wrong and
passes one that is subtly wrong — and a subtly wrong QR is one that simply
does not scan, with nothing on screen to say so. In the application, the
tests paint the symbol into pixels and read it back the way a camera would,
including the SVG path a screen is actually given, so an off-by-one in the
drawing fails a test rather than a person.

**The quiet zone is part of the symbol.** Four modules of light on every
side, inside the drawing rather than around the component, so no layout can
take it away. A symbol flush against a coloured screen does not scan, and
nothing on screen says why.

**A symbol that cannot be drawn draws nothing.** Not an empty frame, which
reads as a broken code. The link is still there, which is the path that has
to keep working.

**Scanning is the other half and is not settled here.** An application
entered only by invitation has nowhere obvious to put a camera before
entry: there is no account yet, and the only screen before one is the
promise — whose own rule (§13.23) is that it asks for nothing. A camera
permission is asking for something. That is a decision about the promise
screen's meaning, not a placement detail, and it is recorded as open rather
than defaulted.

### 13.26 Naming the sender, and when silence is honest (designed here)

**A message names who it claims to be from, unless the answer is
obvious.** Decrypting an event proves which key wrote it and nothing
about who holds that key, so the word is always *claims* — « Se présente
comme » — and never an established identity.

It is obvious in exactly one case: a conversation with two people, where
a message that is not this account's own is the other person's, and the
header already names them. Spelling out a full Matrix identifier above
every message there teaches nobody anything and breaks the density
screen 21 is the reference for.

**It stops being obvious at three.** The first version of this rule
named the sender only when they were *not* the expected other party —
which, in a room without exactly two people, is never: every message
unattributed, and no way to tell who wrote what. The rule is the other
way round. The sender is named unless the conversation has exactly one
other person and the message is theirs.

That case is what `theOtherMember` answers: exactly one other member, or
nothing. A conversation with three people is not a conversation with
somebody, and the product should not pretend it knows which of them is
speaking.

### 13.27 The frame, and where the instrument went (designed here)

**One scroll container per screen, and a new one each time.** Nothing in
the product scrolls inside something that scrolls: no screen carries a
scroll of its own, so the frame carries it for whichever is showing. A
single shared container keeps its offset across whatever is rendered into
it — leaving a long conversation for Réglages arrived scrolled into the
middle of a short screen, and returning to the conversation arrived
wherever Réglages had been. The container is keyed on what it shows, so
each screen gets its own.

**A conversation rests at its newest message.** It opened at its oldest
and never moved, so a message somebody sent landed below the fold and the
answer to "did it send?" was a scroll. Every messenger opens at the
newest.

The second half of that rule is the whole of it: following the newest on
every content change would be a different defect, since a message
arriving while somebody reads history would pull them back down. The
frame follows only for somebody already resting within a message's height
of the end.

**The diagnostic readout is gone, and the log is not.** The application's
screen carried a readout — New Architecture, Runtime gaps, Matrix
transport, Entry, Session sync, Crypto bridge, Crypto pump, Encrypted
send, Received, Brand geometry, Live sync, Given names, Keystore form —
with the product's screens rendered into it as they were built. It *was*
the application before there were screens. Nobody installing Messagr
should ever have seen it.

Every `logEvent` call stays. The readout was the dashboard; the log is
the instrument, and it is the half that found the defects — an emulator
with no network once reported thirteen crypto assertions failing for no
stated reason, and the only account of what was really wrong was the
application's own. Removing the log to remove the readout would have been
removing the instrument to remove the dashboard.

**No diagnostic text appears on any screen a person can reach**, and that
includes fallbacks. A history claim that failed for a reason with no copy
used to render `kind: reason` under the conversation — a diagnostic
string, in French text, on a screen a person reads. The two cases
somebody can act on say so; the rest are silent and are in the launch
report.

**The end-to-end suite reads that log rather than the screen.** Thirty-one
assertions matched rendered sentences, so each was really an assertion
about scroll position, and five continuous-integration failures were paid
for it — every one of them correct behaviour reported as a product
failure. A line of structured JSON cannot be scrolled off, cannot be
truncated by a layout, and says the same thing whatever the screens
become.

Three assertions stay on the screen, and they are the right three: typing
a message and seeing it arrive, a conversation being open and writable,
and « Se présente comme » — the claim the product makes to a person about
a sender it cannot authenticate. Nothing in a log can stand in for those.

### 13.28 The brain of a call, before there is any sound (designed here)

**The protocol half of a call is separable from the sound, and separating
it is what makes it testable.** A 1:1 call is two problems wearing one
name: a signalling exchange over the conversation's own room — who is
calling, who picked up, which of their devices, who hung up and why — and
a media path that carries audio. The second needs a device, a microphone
and a network. The first needs none of them, and it is where every defect
a person notices actually lives: the call that rang under the wrong name,
the one that said "no answer" when it never left the telephone, the one
that stayed on "connecting" until the application was killed.

So the signalling is a state machine that takes its clock as a parameter,
is handed the call and party identifiers rather than drawing them, and
performs no input or output at all. Its whole output is a list of
instructions: put this event in the room, hand this SDP to the media
layer, the state is now this. Ninety scenarios replay against it in two
hundredths of a second, including the ones nobody can produce on demand —
two people ringing each other in the same instant, a second device
answering first, an invite that expires between being displayed and being
accepted, a connection lost for nineteen seconds and recovered.

**Version 1 of the Matrix VoIP protocol, on everything sent.** It is the
version that adds a party identifier to every event, and with it
`m.call.select_answer` and `m.call.reject` — which is to say the version
that can tell an account's devices apart. An account here has several by
design, so a call that could not say *which* device answered would end the
ringing on all of them or on none. Events arriving in the older version
are still accepted, leniently, and answered in the version they speak; a
version this build has never heard of is read as version 1, which is what
the specification instructs.

**Ninety seconds of ringing.** The specification recommends a floor rather
than a default, and says why in the only terms that matter: "this should
give the user enough time to actually pick up the call". Nothing shorter
survives a telephone in another room.

**Two people ringing each other at once resolve it without a round trip.**
Both sides compare the two call identifiers, keep the lesser, and abandon
the greater; whoever kept the incoming one becomes the callee. Because
both run the same comparison on the same two values, they converge with
nothing further sent. The specification then asks that the surviving call
be accepted "on behalf of the user" — silently, with no ringing — and that
obligation is deliberately *not* the machine's: accepting needs an answer,
an answer needs a media layer, and the machine has none. It raises a flag
and stops. Whoever holds the media layer discharges it, and if that fails
the call should go on ringing as an ordinary incoming call rather than
being ended.

**The caller's offer is carried in the ringing state, and that is a
correction rather than a detail.** A callee builds its answer from the
caller's description; without it there is nothing to answer. An earlier
version of this machine dropped it from what it published, and the result
was not a degraded call but no answerable call at all.

**Two deadlines, armed by different things, ending with opposite reasons.**
A call that is agreed and never comes up is ended after thirty seconds
with `ice_failed` — a backstop for a media layer that reports nothing at
all, which is the failure mode that leaves a screen lying to somebody. A
call that *was* up and loses its connection is not ended: it opens a
twenty-second window with a visible countdown, during which reconnection
is attempted, and ends with `ice_timeout` only if the window runs out. The
split between the two reasons is whether media ever flowed, never whether
the ending was a timeout, because the two render as different sentences —
"the connection could not be established" and "the connection was
interrupted" — and the wrong one puts on the screen something that never
happened. The countdown is counted down in the machine and handed out as a
number, so no screen owns a clock for it and two of them cannot disagree
about what second it is.

**A call that could not be sent is not a call nobody answered.** When the
room refuses an invite, the call ends immediately and says so, rather than
waiting out ninety seconds indistinguishable from the peer ignoring it.
"We could not reach them" and "they did not pick up" are two different
sentences, and a screen that cannot tell them apart shows the second while
the first is what happened.

**Somebody leaving the conversation ends the call, and the machine cannot
see it.** A departure is a membership event, not a call event, so it never
reaches a machine whose entire input is the seven call event types.
Whoever wires this to a room must watch the peer's membership and feed the
machine a hangup for the active call. The debt is written where it was
incurred, and the alternative reading the specification permits — treating
a departure as a *rejection* — was refused, because a synthesised
rejection would have to invent a party identifier for a device that never
answered.

**What is not in this increment, and is not missing.** No media: SDP is
carried and never inspected, and nothing here knows what a microphone is.
No transport: nothing touches a room. No screen. The relay-only ICE
policy §4.5 depends on — media relayed by the instance's own TURN server
so that a peer never learns the other's address — is a separate decision
with a separate home, and stating it here would be claiming something is
wired that is not.

### 13.29 A tile is not a photograph, so it does not cost one (designed here)

**A grid tile is about 130 points and a photograph is up to twelve
megabytes.** Timed on a Pixel, one 2.8 MB photograph cost about 840 ms to
download, 40 ms to decrypt and a further 250 ms to base64 — and that last
quarter second runs on the thread that draws. The data URI it leaves behind is
a ~3.7 MB JavaScript string, per picture, benefiting from neither the
platform's image cache nor its downscaling. None of that buys anything a
130-point square can show.

**So the sender makes the small copy, because nobody else can.** A media
repository holding ciphertext cannot thumbnail it — that is the point of
sealing it — so the thumbnail is produced on the sending device, sealed and
uploaded like the photograph, and pointed at from `info.thumbnail_file`, with
`info.thumbnail_info` stating its own width, height, type and size. Matrix
has had that slot for exactly this reason; this fills it rather than inventing
anything.

**The thumbnail carries a key of its own, and the specification asks for
that.** `encryptAttachment` mints a key per call, so two sealings are two
keys; a test pins that the event's two `file` objects do not share one.
Reusing the photograph's key would mean that handing somebody the small
picture hands them the large one, which is a disclosure nobody chose by
sending a photograph.

**It is uploaded before the photograph is.** The send path's argument has
always been that a failure at any step leaves nothing behind that a person
must clean up. A thumbnail is twenty kilobytes against several megabytes, so
trying it first costs almost nothing and keeps that argument true: a
repository that refuses it refuses it before the photograph is in there. The
alternative would have to choose between failing a photograph already
uploaded and quietly sending one whose missing thumbnail nobody would ever
see.

**Everything but the full-screen viewer draws the smallest copy offered.** A
plate tile and a conversation bubble ask for the thumbnail; the photograph is
fetched when somebody opens it full screen — one at a time, which is also when
its quarter second of base64 stops mattering, because nothing else is
competing for the thread. The exception is opted into rather than defaulted:
a surface that forgets to ask for the photograph shows a soft picture, which
somebody can see, where the opposite default would give it a full download,
which nobody can.

**An `m.image` with no thumbnail draws from the full file, exactly as
before.** Every photograph sent before this, and every one from a client that
makes none, has no `thumbnail_file`; the reader answers the photograph and the
screen is the screen it always was. That is the common case today, not a
degraded path.

**Not a plaintext cache on disk, and the measurement is why.** Caching
decrypted photographs would remove the same costs and more, and it would put a
decrypted photograph on a disk, which ADR-0006 forbids. What costs here is the
*size*, and a thumbnail addresses the size without touching the property. That
decision stays open on its own merits; this did not need it.

**The downscaling took two dependencies, and each candidate that could have
avoided them was checked rather than assumed.** React Native cannot resize an
image in JavaScript, and nothing already in this tree could do it on Android:
the picker's `maxWidth`/`maxHeight` resize the asset a call returns, and a
call returns one asset, so two sizes would mean presenting the library twice
and asking somebody to choose the same photographs again; React Native's own
`ImageEditingManager` survives on iOS and is gone from Android;
`react-native-svg` rasterises only to PNG, which is three or four times
smaller than the file it replaces where this wants an order of magnitude.
So `@bam.tech/react-native-image-resizer` does the resize.

**The second dependency is there because the first answers a path.** `fetch`
resolves `file:` URLs on iOS through `RCTFileRequestHandler` and on Android
through nothing at all — `NetworkingModule` reads a file URI only to *send* it
as a request body, never to hand its contents back. So
`@dr.pogodin/react-native-fs` reads the one resized file, and `readFile(path,
'base64')` is the whole of what this application asks of it.

**A filesystem module here does not bend ADR-0006, and the distinction is
worth stating.** The file read is one the *picker already wrote*, from a
photograph its owner chose out of their own gallery, which the system had on
that disk before this application existed. Nothing this application decrypted
is written anywhere, and the resized copy is read once and dropped. What
ADR-0006 forbids is caching a *received* photograph after decrypting it, and
that remains forbidden.

**A thumbnail that fails is not a photograph that fails.** A codec that
refuses a format, a cache the system cleared between the pick and the read:
none of them may cost somebody their picture. The thumbnail is dropped, the
photograph is sent whole, and a reader draws it from the full file — which is
the same fallback old events already take, so it is a path with two users
rather than a branch nobody exercises.

### 13.30 A call relays, and the type is what says so (designed here)

**The media of a call is relayed by the server's own TURN, always.** Not
by default, and not preferably: `IceTransportPolicy` is a union with one
member, so any other policy is inexpressible. The day a second is wanted
it is added there, in the type, where every place that reads it stops
compiling until somebody has thought about it — never as a boolean at a
call site.

The reason is RFC 8827 §6.4, and it is about exactly this product's
case: *"A side effect of the default ICE behavior is that the peer learns
one's IP address"*, and the API *"MUST provide a mechanism for the
calling application JS to indicate that only TURN candidates are to be
used."* A call here is between two people who know each other; the peer
is somebody the user chose, and the user's address is still none of their
business.

**The credentials come from the homeserver**, at
`GET /_matrix/client/v3/voip/turnServer`, and are short-lived on purpose.
Their lifetime is passed through untouched: refreshing is the caller's
business, and a module that started a timer would be deciding something
it does not know.

**Every failure fails closed.** There is no fallback to STUN and none to
host candidates. A call that cannot be relayed is a call that is not
placed, because the alternative is putting the device's address on the
wire under an interface that promised the opposite — and the operator
learns it from an error rather than the user learning it from a leak they
cannot see.

Two refusals rather than one, and they are different conversations. A
homeserver that offers nothing has no relay configured — the endpoint's
own error table says it SHOULD answer 404. A homeserver that offers URIs
none of which relay has an operator who meant to configure one and
configured STUN instead; STUN discovers an address, it does not carry
media, so it buys nothing here.

**The rules are pure, so they are tested without a homeserver.** Every one
of them is a way an address could reach a peer, and none should need a
network to catch. Checked by breaking each: letting `stun:` through fails
two tests, turning the refusal into a fallback fails two, and dropping
the scheme's case normalisation fails one — the last being a refusal
nobody could have diagnosed from its message, since the homeserver would
have been correctly configured.

### 13.31 The room boundary of a call, and the two debts it settles (designed here)

**The brain of a call decides nothing about a room, and that separation is
what §13.28 bought.** The signalling machine takes its clock as a parameter,
draws no identifiers and touches nothing. Something still has to put its
decisions in the conversation, bring the peer's back, and tell it the time.
That is the transport, and it is a layer of its own for the reason the
machine's purity is worth having in the first place: the moment a room is
reachable from inside the machine, the hundred scenarios that replay in
milliseconds stop replaying at all.

**A call's events go through the same door messages do.** They are put in the
conversation's own room, encrypted like everything else in it — not beside the
encrypted path, and not in the clear. That is not tidiness either: the party
identifier every event carries is this device's identifier, which the
specification permits and then hedges, because in an *unencrypted* room it
would tell anybody watching which of somebody's devices were used and when. In
an encrypted room it tells only the two people on the call. The hedge is the
argument for the door, so the door is not optional.

**Events from this account's own other devices are carried in, not filtered
out.** It reads like a bug and it is the opposite: a call answered on a tablet
is learned by the telephone from the tablet's own answer, and a client that
ignored everything its own account sent would leave every other device ringing
after somebody picked up. Which event is this device's own echo is a question
about the party identifier, and the machine already answers it.

**An age can arrive negative, and a negative age is read as zero.** How long
an invite has left is its lifetime minus how old the server says it is,
counted forward on the receiving device's own clock — which is the whole
reason the protocol carries an age rather than a timestamp. When the two
clocks disagree the age can come back below zero, and letting that through
would silently lend an invite more life than the person who sent it granted
it.

**Somebody leaving the conversation ends the call, and a ban counts as
leaving.** This is the first of the two debts §13.28 recorded: a departure is
a membership change, not a call event, so the machine cannot see it and the
transport watches for it and hands the machine a hangup. The predecessor
watched only for a leave; a banned person is out of the room by every measure
a call cares about — they can receive nothing further — so both are read the
same way. A departure while nothing is ringing is an ordinary membership
change and does nothing at all.

**When this account is the one that left, the specification says nothing, so
the reading is stated rather than assumed.** A call without a room cannot
continue, so leaving ends it here as a deliberate act: a hangup where a hangup
is the gesture that state has, a refusal while the telephone is still ringing.
The event that goes with it will very likely be refused by a room this account
is no longer in, and that is fine — what a person needs is the call ending on
their screen, honestly.

**Two people ringing each other at once are answered without ringing, and a
media layer that cannot do it leaves the telephone ringing.** The second debt.
The machine picks the surviving call and raises a flag; the transport draws an
answer and accepts, with nothing shown to anybody, because the tie-break has
already decided on their behalf. If no answer can be produced, the call is
*not* ended: it degrades to an ordinary incoming call somebody can still pick
up. And because producing an answer takes real time, what is ringing when the
answer arrives is checked again — in that interval the caller can have hung up
and a different call can have started ringing, and answering *that* one with
an answer built for the first is a call that can never connect.

**Order is a product property, not an implementation detail.** Events leave in
one queue, in the order the machine decided them. The case that forces it is
the one above: abandoning one call and accepting another happens in a single
instant, and if the abandonment overtook the invite it abandons, the person at
the other end sees a call ended before it was placed.

**A call that could not be sent ends immediately — for the two events that
matter, and only those.** Losing the invite means the peer never learns there
is a call; losing the answer means the caller waits out the full ninety
seconds while this side believes it is connecting. Both end the call at once
and say so, rather than looking like somebody not picking up. The other five
survive being lost: more candidates are gathered, a renegotiation has its own
short life and a call that loses one goes on working, and a hangup or a
refusal is sent by a side that has already ended.

**Nothing here can break the sync loop.** Call events arrive on the same poll
as everything else, and the loop's only answer to an exception is to declare
the connection lost and back off — so an event that threw would be an event
that arrives in every poll and stops the application receiving anything, for
ever. Every event is read on its own, anything unreadable is skipped, and the
one after it is still read.

**What is not wired, and is not missing.** Nothing in this increment is
connected to a screen or to the running application: this is the layer, with
its own tests and no device. Neither is the replay of a call that was already
ringing before the application looked — that belongs with waking a device for
an incoming call, and inventing it here would be building the answer to a
question nothing yet asks.
