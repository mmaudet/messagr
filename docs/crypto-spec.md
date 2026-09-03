# Messagr — Cryptographic and Matrix-Abstraction Specification (v2, consolidated)

## Status

Normative draft. Canonical owner of: the security architecture view, the cryptographic interpretation of product entities, the threat model, metadata boundaries, security-relevant deployment topology, the post-quantum trajectory, and the security glossary. This version absorbs the security-relevant portion of the missing-artifacts formalization document and consolidates the cross-cutting decisions on groups, anonymity, encryption, and inter-instance federation.

## 0. Scope

This document defines:

- Messagr's security principles;
- the abstraction of Matrix as protocol infrastructure;
- the security interpretation of the canonical product entities;
- the explicit threat model;
- metadata and visibility boundaries;
- AI-agent security as principals;
- group encryption and MLS-related decisions;
- anonymity and private discovery;
- inter-instance federation as a security surface;
- the post-quantum and crypto-agility roadmap.

Product entities are not redefined here: they are referenced and enriched with cryptographic meaning. The detailed permission matrix remains in the product spec; this document only keeps the security consequences.

## 1. Security principles

- Matrix remains the protocol substrate on the production baseline, with the modern Rust crypto stack (`matrix-sdk-crypto`).
- Content confidentiality is distinct from metadata exposure.
- Read access and action access are modeled separately.
- Agent security is a distinct domain from traditional E2EE security.
- Every trust boundary (bridge, backend, agent runtime, tool gateway, homeserver, federation) must be normative and tooled.
- The product is designed to be crypto-agile rather than tied to a fixed primitive.

## 2. Security architecture view

Narrow view, oriented toward confidentiality, trust, and attack surface. The full product view and the bridge view live in their respective specs.

```text
┌───────────────────────────────────────────────┐
│         Generic crypto bridge (client)        │
│  E2EE, devices, verification, secrets         │
└───────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────┐
│           Local Matrix homeserver             │
│  transport, encrypted history, appservice     │
└───────────────────────────────────────────────┘
                 │  server-server API
                 ▼
┌───────────────────────────────────────────────┐
│    Remote Matrix homeserver (federation)      │
│  another Messagr instance, another policy     │
└───────────────────────────────────────────────┘

Parallel trust perimeters on the product side:

  Product API / backend
  Application Service (Matrix-side)
  Agent runtime
  External tool gateway
  Discovery service
  Recovery orchestrator
```

These perimeters are **separated**: each has its own credentials, its own audit, and its own responsibility envelope. None must be conceptually co-located with another.

## 3. Cryptographic interpretation of the entities

The product spec owns the model. Below, the security consequences.

| Entity | Security interpretation |
|---|---|
| `HumanUser` | Backed by a Matrix identity. The product identity is isolated from discovery attributes. Compromise of a `HumanUser` does not imply compromise of their `AgentParticipant`s. |
| `AgentParticipant` | Principal potentially holding read access, write access, and external side-effect capability. The trust perimeter of an agent is distinct from that of a human. |
| `Channel` | Encrypted group session. The production target for communities is MLS (see §7). The Megolm stack remains the compatible baseline. |
| `LinkedDevice` | Each device has its own device key. Compromise of a device exposes local content and threatens session continuity. Removing a device must propagate a group key rotation. |
| `TrustState` | Semantically: `unverified` = product signal, no crypto commitment; `recognized` = local non-cryptographic trust; `verified` = crypto attestation (QR / SAS) carried by the bridge. Only the `verified` transition has cryptographic value. |
| `RecoveryBundle` | Sealed bundle protected by passphrase / PIN, containing the secrets needed for restoration. Its leakage compromises every past session it can decrypt and must be treated as an incident. |
| `DiscoveryIdentity` | Attribute to minimize radically. Represented as a salted hash when matching an address-book contact. Never conflated with the account identity. |
| `FederatedIdentity` | Remote identity whose trust is not inherited automatically. Any cross-instance elevation of permission requires an explicit grant. |
| `CapabilityGrant` | Cryptographic audit support: each grant is recorded with a verifiable identifier for traceability and revocation. |
| `ExternalAction` | Action triggered outside the E2EE perimeter. Its success or failure has no cryptographic value, but its authorization must be auditable. |

## 4. Abstraction of Matrix

Normative choice: Matrix is infrastructure, not UX. The user sees contacts, channels, direct conversations, linked devices, trust states, and agent participants — not room IDs, homeserver mechanics, or backup jargon.

### Required abstraction mechanisms

1. contact-first model rather than room-first;
2. linked-device model rather than raw device/session jargon;
3. trust ladder rather than cryptographic ceremony;
4. agent participants rather than invisible automations.

## 5. Threat model

This document is the canonical owner of the threat model. The product and bridge specs refer to it.

| Threat | Impact area | Main control |
|---|---|---|
| Compromised local homeserver | Metadata, availability, protocol manipulation attempts | E2EE, cross-signing verification, audit |
| Compromised client / primary device | Local cleartext, local secrets | Local storage encryption, device removal, exportable vault |
| Compromised desktop linked device | Cleartext, session continuity | Device freeze, rotation, weaker desktop permissions |
| Compromised appservice or agent runtime | Message visibility, external-action abuse | Runtime / bridge separation, isolated tool gateway, audit |
| Malicious authorized agent | Abuse of granted capabilities | Capability sheet, human approval, revocation |
| Discovery service leakage | Contact-graph exposure | Minimization, salted hashing, purpose-binding |
| Federated abuse between instances | Remote trust and routing | No automatic inheritance of permissions, health checks, removal of federated participant |
| Tool gateway compromise | Undesired external effects, corrupted audit | Strict separation, per-instance credentials, encrypted audit |
| Recovery orchestrator compromise | Bundle leakage, abusive restores | Strict boundaries, no cleartext retention |
| Agent runtime metadata leakage | Prompts, memory, user context | Explicit visibility, minimization, policy hooks |
| Deferred post-quantum attack | Harvest now, decrypt later | Hybrid PQ roadmap, crypto-agility, PQXDH-like |

Each threat elicits a product response in the product spec (§8 Trust & Safety UX) and an operational action in §10 of this document.

## 6. Metadata boundaries

The distinction is normative:

- **Cleartext content** — protected by end-to-end encryption. Never visible on the server side, never visible in clear on the remote federated side.
- **Metadata at the local homeserver** — membership events, timing, sizes, ratchets. Must be minimized but remain visible.
- **Metadata at the remote federated homeserver** — propagated subset. Must be explicitly defined by category.
- **Metadata at the discovery service** — inputs declared by the user; output limited to a `present / absent` signal on the service. Purpose-bound.
- **Metadata at the agent runtime** — profiles, prompts, memory, injected context. Must be visible to the user, must not transit to the tool gateway without a grant.
- **Metadata at the tool gateway** — strict inputs needed for the external action; never the whole conversation by default.

A visibility matrix must accompany the implementation:

| Metadata type | Local HS | Remote federated HS | Discovery service | Agent runtime | Tool gateway |
|---|---|---|---|---|---|
| Channel membership | Yes, minimized | Subset | No | Restricted | No |
| Admin roles | Client-signed, not published | No | No | No | No |
| Social graphs | Not kept readable | No | No | No | No |
| Encrypted payload | Yes (encrypted) | Yes (encrypted) | No | No | No |
| Cleartext content | No | No | No | On consent | On explicit grant |
| Discovery identity | No | No | Yes, hashed, purpose-bound | No | No |
| Push tokens | Separated | No | No | No | No |

The audit must **never** silently become a second cleartext content store.

## 7. Group encryption

### 7.1 Target and baseline

- **Production baseline** — group encryption compatible with the modern Matrix stack (Megolm) exposed by the generic crypto bridge.
- **Target for communities** — MLS for `Channel`s in community mode. This target is retained for structural anonymity (key rotation, clean adds/removes, post-compromise security), not for broad protocol compatibility.

### 7.2 Member addition and removal

- adding a member triggers a group-key rotation;
- removing a member triggers an immediate rotation and invalidation of past sessions the member is no longer entitled to;
- rotations propagated by the addition or removal of a `LinkedDevice` of an existing member are handled by the bridge.

### 7.3 Group anonymity

- membership in an `anonymous`-mode `Channel` must not be published outside the channel members;
- server-exposed identifiers are channel pseudonyms;
- admin roles are **client-signed** and not held in a server-readable registry;
- invitations flow through **capability links** or limited-use invitation tokens, never a directory.

### 7.4 Bridge contract

The bridge (see bridge spec §6) must expose its primitives in a crypto-agile form: the gradual move from Megolm to MLS for communities must be achievable without breaking its public facade. Any hybrid PQ layer plugs in at the same point.

## 8. Anonymity and private discovery

### 8.1 Normative choice

Messagr adopts a positioning of **strong pseudonymity by default, enhanced anonymity in advanced mode**.

- Account identity is backed by a **root key generated on-device**;
- a **short public identifier** or a signed contact card may be shared voluntarily;
- neither phone number nor email is required as a primary identifier;
- address-book-based discoverability remains possible but **optional, local, and purpose-bound**; it never automatically grants the right to write to a contact.

### 8.2 Discovery modes

| Mode | Description |
|---|---|
| QR / invitation link | Signed link carrying a scoped invitation. |
| Explicit username | Opt-in public identifier with a strong suffix. |
| Signed contact cards | Signed file shared hand-to-hand. |
| Introduction via an already approved contact | Explicit social trust chain. |
| Manual import of the local address book | Controlled import, without permanent sync. |

### 8.3 Private discovery

A real private-contact-discovery protocol is required if address-book discovery is offered without letting the central service learn who is looking for whom. Absent that, only discovery via voluntarily shared identifier is acceptable. The product spec details the UX; this document only restates the requirement of no server-side graph leakage.

### 8.4 Network protection and sealed sender

- The sender envelope must move toward a **sealed-sender-like** form to limit sender/recipient correlation on the server;
- a transport-protection layer (proxy, relay, or onion/mixnet-style routing) is considered for advanced mode;
- asynchronous queues with padding and batching may be added to reduce traffic correlation.

Without these protections, the result is pseudonymity, not anonymity.

### 8.5 Recovery without external identifier

Three families, each an accepted trade-off:

- recovery via an already-connected device;
- locally exportable encrypted vault protected by passphrase / PIN;
- social or guardian-based recovery.

**The product does not promise universal invisible recovery.** This decision is consistent with the enhanced-anonymity stance.

## 9. Inter-instance federation (security surface)

### 9.1 Objectives

- keep federation invisible in ordinary UX;
- explicitly model its security and confidentiality effects;
- never let a remote instance inherit unconsented power.

### 9.2 Elements to model

- remote identity resolution (`FederatedIdentity`);
- inspection of federated trust: cross-signing verification state, instance reputation, seniority;
- handling of degraded federation states: delay, uncertain delivery, revocation;
- handling of policy differences between instances: moderation, allowed agents, admissible capabilities.

### 9.3 Normative rules

- room history is replicated across participating servers; consequently cleartext content must **never** transit through the federated history (E2EE is mandatory for every cross-instance conversation);
- a `FederatedIdentity` **never automatically inherits** elevated permissions merely because it is remote;
- adding an `AgentParticipant` from instance A to a `Channel` mostly hosted by instance B requires an explicit grant on the B side;
- tool gateways are **per instance**: no cross-instance external effect without an explicit capability grant;
- agent runtimes are **per instance**: prompts, memory, and injected context do not cross the boundary without consent;
- federation has operational health checks before attributing a fault to the client (rule inherited from the 4th document, restated here for its security implications).

### 9.4 Federation-specific threats

- a hostile remote instance publishes fake devices or fake attestations → mitigation: cross-signing and no automatic inheritance of permissions;
- a remote instance leaks metadata → mitigation: strict minimization of the propagated surface and local audit of outbound events;
- a remote instance produces moderation abuse → mitigation: removal of federated participant, inter-instance escalation, marking the instance as degraded.

## 10. AI-agent security

Introducing AI agents modifies the threat model. An agent is a principal.

### 10.1 Must be true

- agent orchestration remains **outside** the crypto bridge;
- mere channel membership never implies unlimited external-action authority;
- `CapabilityGrant`s are explicit, scoped, revocable;
- every sensitive action is journaled in the product audit;
- an agent is **visibly** an agent in the UI.

### 10.2 Must be defined here

Exact scope of agent access:

| Element | Default | Elevation |
|---|---|---|
| Full channel history | No | On explicit consent |
| Visible window only | Yes | — |
| Attachments | No | Separate grant |
| Profile metadata | Restricted | Explicit grant |
| Federated identity details | No | Explicit grant |

This table is a normative default. The product spec handles presentation.

### 10.3 Runtime / tool gateway boundaries

Four minimum boundaries:

| Boundary | Reason |
|---|---|
| Crypto bridge vs product backend | prevent product logic from contaminating security primitives |
| Product backend vs agent runtime | limit the blast radius of the prompt/model layer |
| Agent runtime vs tool gateway | isolate external side effects |
| Tool gateway vs third-party APIs | allow policy, approval, and audit |

This separation is **normative**, not indicative.

## 11. Security-relevant deployment topology

Security-oriented view of the topology. The full product topology lives in the product spec.

- **Homeserver** — explicit trust assumptions. A malicious local homeserver stays in the threat model.
- **Application Service** — placed server-side, governed by a distinct identity and a dedicated audit.
- **Recovery service** — strict boundaries; no cleartext retention; access rotation.
- **Agent runtime** — never conceptually co-located with the crypto bridge; own credentials.
- **Tool gateway** — per-instance credentials, never shared between agents or channels without grant.
- **State separation** — crypto state does not live in the runtime / tool processes.
- **Operational sovereignty** — each Messagr instance controls its homeservers, product API, appservice, agent runtime, and tool gateway. Federation never introduces an implicit operational dependency.

## 12. Post-quantum roadmap

The approach is **incremental and crypto-agile**.

### 12.1 Short term

- keep the modern Matrix cryptographic baseline;
- design bridge and backend as **crypto-agile**: the ability to plug in a PQXDH-like hybrid without breaking the public facade;
- document where hybrid key-establishment hooks could fit;
- avoid prematurely introducing incompatible bespoke PQ mechanisms.

### 12.2 Exploratory medium term

- prototype a hybrid handshake inspired by PQXDH;
- evaluate how a future evolution of Matrix could accommodate stronger PQ session establishment;
- monitor ratchet-level work such as ML-KEM Braid.

## 13. Open questions

1. What minimum metadata may an agent runtime access by default, without a grant?
2. Which logs are mandatory for audit without creating a second leakage surface?
3. What is the exact approval model for an `ExternalAction` triggered from a `Channel`?
4. What portion of `DiscoveryIdentity` may leave the product backend, if any?
5. How to represent a federated `AgentParticipant`: local mirror, transparent remote participant, or refusal?
6. What canonical format for capability links (§7.3) and what rotation policy?

## 14. Immediate implementation amendments

- add the §6 visibility matrix to logs and audit from V0;
- expose a capability sheet per agent, aligned with the product permission matrix;
- add cross-federation tests (Synapse ↔ Continuwuity) to the test plan;
- freeze an explicit MLS rotation policy on member and `LinkedDevice` add/remove;
- anchor crypto-agility by a compatibility test verifying that a Megolm → MLS swap does not break the bridge facade;
- record a PQ posture note (baseline, hybrid, experimental) referenced by the product.

## 15. Security glossary

Strict subset, derived from the canonical glossary in the product spec.

| Term | Cryptographic meaning |
|---|---|
| Trust state | Product-visible trust signal; only the `verified` transition has cryptographic value. |
| Verification | Cryptographic process (SAS, QR) attesting device identity. |
| Recovery bundle | Sealed bundle of secrets; leakage is an incident. |
| Linked device | Secondary device with its own keys; removal requires rotation. |
| Metadata | Any information outside cleartext payload; distinguished by boundary (homeserver, discovery, agent, tool). |
| Federation | Matrix server-to-server communication; security surface and event propagation. |
| Discovery identity | Technical attribute, hashed and purpose-bound; never conflated with the account identity. |
| Agent runtime trust perimeter | Trust zone distinct from the bridge and the homeserver, dedicated to AI agent execution. |
| Capability link | Invitation or sharing link carrying a scoped, limited-use authorization, primary material for anonymous groups. |
| Sealed-sender-like | Sender envelope hiding the sender from the service, in the manner of Signal's sealed sender. |
| Crypto agility | Ability to change primitive (Megolm → MLS, addition of hybrid PQ) without breaking exposed facades. |

## Consolidation notes

This version integrates:

- the full threat model, enriched (new points on federation, agents, PQ);
- the cryptographic interpretation of the product entity model;
- metadata boundaries with a normative visibility matrix;
- rules on group encryption, MLS, and channel anonymity;
- rules on private discovery and pseudonymity;
- federation rules as a security surface, including for agents;
- the security-relevant deployment topology;
- the PQ trajectory anchored on crypto-agility.

The standalone formalization document is no longer the source of truth for this portion and remains only as a migration note.
