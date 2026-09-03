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

1. **Single-source cryptographic contract.** The crypto spec defines one Rust core `matrix-crypto-core` consumed by every client. Under Tauri, that same crate is linked directly into the desktop binary, invoked via `#[tauri::command]`, with native access to the OS keychain, disk, and system notifications. Under React Native Web or PWA, we would have to fall back to the parallel `matrix-sdk-crypto-wasm` binding — two crypto backends to audit, two encrypted storage formats to maintain, and the invariant “a desktop device is a `linked_device` like any other” does not translate the same way in WASM/IndexedDB as it does in native Rust/SQLite.
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

**Screen 12 — Erase a message.** Two scopes named without euphemism: for me, for everyone. Retraction delay shown in seconds on the bubble. Erasure-for-all leaves a line in the room journal — a removal is a social fact, not a silent disappearance.

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
- Floors: 11.5 pt minimum body on screen, 44 pt minimum touch target, no monospace label under 9.5 pt, line-height never below 1.35.

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
3. Green is a signal, not a decoration: it is used only for verified humans.
4. No “continue anyway” button crosses a security boundary (failed SAS, refused-origin code, ungranted external action, unrecognised new device).
5. Recognising a contact ≠ being able to write to them. Discovery, trust, verification remain three distinct notions.
6. Degraded states are stated in natural language, never with an error code or the word “federation”.
7. Any capability or device change appears in the relevant room's journal, visible to its members.
8. The journal records decisions and refusals, never contents.
9. A capability locked by a room policy stays visible, greyed, with its reason — never hidden.
10. A stricter room setting overrides a more permissive account setting.
11. Any colour, size, radius, elevation, or duration absent from `tokens.json` is forbidden in the product.


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
