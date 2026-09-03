# Messagr — Bridge Layer Specification (v2, consolidated)

## Status

Normative draft. This version absorbs the bridge-relevant portion of the missing-artifacts formalization document, together with the cross-cutting decisions on groups, anonymity, encryption, and inter-instance federation. The standalone formalization document is no longer the source of truth for this portion.

## 0. Scope and role of the bridge

The bridge is a generic React Native native library, independent of Messagr, whose sole responsibility is to expose modern Matrix cryptographic capabilities to a product application. Messagr is its first consumer, not its exclusive purpose.

The bridge is never responsible for:

- product logic (contacts, channels, invitations, discovery);
- application policies and permissions;
- AI agent execution or moderation;
- inter-instance federation (owned by the homeserver and the product spec).

This delineation is the red line of the contract: it prevents any drift toward a "full Matrix SDK" and preserves the bridge's reusability in other React Native projects.

## 1. Architecture boundaries

The bridge sits between the client-side product abstraction and the Rust bindings `matrix-sdk-crypto` / `matrix_sdk_crypto_ffi` exposed through UniFFI.

```text
┌────────────────────────────────────────────────┐
│  Client surfaces (React Native mobile, Tauri)  │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│      Product-facing client abstraction         │
│  (contacts, channels, linked devices, trust)   │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│         Generic crypto bridge (this)           │
│  - local crypto machine                        │
│  - device/session state                        │
│  - encrypt/decrypt                             │
│  - SAS/QR verification                         │
│  - secret import/export                        │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│  Outside the bridge: Product API, homeservers, │
│  Application Service, agent runtime, tools     │
└────────────────────────────────────────────────┘
```

The global architecture view (mobile + desktop + backend + agent runtime + federation) belongs to the product specification. The bridge only includes the portion needed to anchor its own contract.

### Responsibility rules

| Layer | Must own | Must never own |
|---|---|---|
| Bridge | E2EE, device/session state, verification, secret import/export | discovery, agent policy, external actions, federation, product semantics |
| Product abstraction (client-side) | trust rendering, linked-device UX, orchestration of bridge calls | crypto primitives |
| Product API / backend | discovery, capabilities, onboarding, recovery orchestration | crypto engine internals |
| Matrix homeserver | transport, federation, appservice | product UX |

## 2. Entities owned by the bridge

The bridge only exposes a strict subset of the canonical data model. The remaining entities (`HumanUser`, `AgentParticipant`, `Channel`, `CapabilityGrant`, `ExternalAction`, `DiscoveryIdentity`) are visible through opaque identifiers but remain owned by the product spec.

| Entity | Role in the bridge |
|---|---|
| `LinkedDevice` | Representation of a secondary device attached to an account, exposed as an identifier plus a registration state and a trust state. The bridge only provides the technical contract (session/device handling). Its UX belongs to product; its recovery semantics belong to crypto. |
| `TrustState` | Product-friendly signal (`unverified`, `recognized`, `verified`) carried on top of Matrix verification mechanisms. The bridge is the sole source of material transitions; presentation is product; security semantics are crypto. |
| `RecoveryBundle` | Product-facing abstraction of an exportable secret bundle. The bridge provides the `exportSecrets` / `importSecrets` primitives. Content, format, and detailed lifecycle belong to crypto. |
| `SessionIdentifier` | Identifier of a local or remote cryptographic session. Bridge contract only. |
| `EventEnvelope` | Input/output structure for an encrypted or decrypted Matrix event, without business logic. |

The bridge does not define `Channel`, MLS `Community`, or `FederatedIdentity`: it traverses them but does not own them.

## 3. Out of scope for the bridge

The V0.1 bridge explicitly excludes:

- full network sync;
- rich timeline, pagination, search;
- non-crypto application storage;
- any conversation UI;
- audio/video calls, including VoIP signaling and MatrixRTC;
- push notifications (Sygnal remains outside the bridge and is wired by the product layer);
- product-level community and group logic;
- contact discovery, public or private;
- application permission policy and capability grants;
- any AI agent or tool gateway policy;
- inter-instance federation at the application level: the bridge encrypts and decrypts regardless of the recipient's domain but has no notion of a remote Messagr instance.

This list is normative: these subjects may give rise to upper layers or complementary packages, but must not pollute the first abstraction.

## 4. Recommended technical architecture

| Layer | Role | Technology |
|---|---|---|
| Core crypto | E2EE machine, devices, verification, secrets | Rust + `matrix-sdk-crypto` / `matrix_sdk_crypto_ffi` |
| FFI interface | multi-language contract | UniFFI |
| RN integration | TypeScript generation + Turbo Module/JSI | `uniffi-bindgen-react-native` |
| iOS distribution | consumption in RN apps | CocoaPods / XCFramework |
| Android distribution | consumption in RN apps | AAR / Maven-compatible artifact |
| JS distribution | consumption by RN apps and monorepos | npm package |

Recommended repository layout: monorepo.

```text
repo/
  packages/
    react-native-matrix-crypto/
    example-app/
  apps/
    messagr/
  rust/
    matrix-crypto-core/
```

Messagr is treated as the reference client, without collapsing the boundary between product and bridge.

## 4bis. Codegen pipeline and binding chain

This section normalizes how Rust is exposed to React Native. It complements the technology table and takes precedence in case of conflict.

### 4bis.1 Binding chain

Rust is not consumed through a hand-written C++ binding. The canonical chain is:

1. **Rust source** — `matrix-crypto-core` crate, pure logic, depends only on `matrix-sdk-crypto` (and eventually on MLS/PQ primitives). Knows neither UniFFI nor JSI.
2. **Thin FFI crate** — `matrix-crypto-ffi`, exposes the public API via `#[uniffi::export]` (or the equivalent UDL). Contains only type translation, never business logic.
3. **UniFFI scaffolding** — `uniffi-bindgen` generates a stable C ABI (`extern "C"`) baked into the Rust static/dynamic library.
4. **Generated React Native bindings** — `uniffi-bindgen-react-native` (Filament) produces, from the same FFI crate:
   - a JSI Turbo Module as **generated C++** (`.cpp` + `.h`) implementing a HostObject compliant with React Native's New Architecture;
   - a **TypeScript** file exposing the idiomatic, typed API to JS;
   - packaging manifests (`.podspec` for iOS, `build.gradle` for Android).
5. **Native packaging** — Xcode/Gradle compile the generated C++ and link it against the Rust static library. RN loads the module like any other Turbo Module.

C++ exists but is **entirely generated**. It must not be written or maintained by hand. Manual inspection is reserved for low-level debugging.

### 4bis.2 Mandatory automation

Regeneration of bindings and binary artifacts **must** be automated. The nominal pipeline is:

- trigger: bump of the `matrix-crypto-core` or `matrix-crypto-ffi` crate, or an aligned SemVer tag;
- step 1, Rust cross-compilation: iOS targets (arm64 device, arm64 simulator, x86_64 simulator), Android (arm64-v8a, armeabi-v7a, x86_64), and native desktop when consumed by Tauri;
- step 2, codegen: `ubrn generate all --config ubrn.config.yaml` produces C++, TS and manifests;
- step 3, packaging: `ubrn build ios` yields an `.xcframework`, `ubrn build android` yields an `.aar`;
- step 4, interop tests: the shared JS suite (see §11) is executed against the freshly produced artifact;
- step 5, publishing: npm package `react-native-matrix-crypto` with prebundled binaries and committed generated files, versioned in lockstep with the Rust crates.

The RN consumer installs **no** Rust toolchain. A single `yarn add` is enough.

### 4bis.3 Strict core / FFI boundary

Normative rule: **all logic lives in `matrix-crypto-core`**. The FFI crate contains only signature and type adaptations. This separation guarantees that:

- an upgrade of `matrix-sdk-crypto` affects the core only, and binding regeneration becomes mechanical;
- a second binding (for example `matrix-crypto-wasm` for a future web frontend or a Tauri webview shell) can be added without touching the core or the existing FFI;
- non-regression tests can target the core in isolation, without running any Turbo Module.

Any logic drift between bindings is a blocking defect. CI must detect and reject such drift via the shared interop suite.

### 4bis.4 API changes and versioning

A breaking change to the TypeScript API exposed by the bridge:

- triggers a major SemVer bump of the npm package;
- must be caught by the consumer's TS typecheck (the generated TS changes, callers fail to compile);
- must be documented in the package `CHANGELOG.md`, with explicit old → new API equivalence.

Additive changes (new functions, new non-exhaustive enum variants) remain minor bumps.

## 5. Target TypeScript API

The public API must remain small and capability-oriented. Target shape:

```ts
createCryptoMachine(config)
openCryptoStore(config)
restoreCryptoMachine(bundle)
receiveSyncChanges(syncDelta)
encryptEvent(roomId, eventType, payload)
decryptEvent(rawEvent)
getDeviceStatuses(userId)
requestVerification(userId, deviceId)
confirmVerification(verificationId, data)
exportSecrets(passphrase)
importSecrets(bundle, passphrase)
```

No internal Rust structure is directly re-exported. Any evolution adds capabilities and never leaks objects.

## 6. Encryption — bridge contract

The bridge implements the following cryptographic primitives:

- 1:1 and group message encryption aligned with the modern Matrix stack (Olm/Megolm) via `matrix-sdk-crypto`;
- SAS and QR verification between devices and between users;
- session rotation, revocation, and audit;
- passphrase-protected export and import of secrets.

Regarding MLS group encryption (retained in the cryptographic spec as the production target for Messagr communities), the bridge must expose its primitives in a **crypto-agile** form: the TypeScript contract must not hardwire the assumption that a `Channel` is necessarily a Megolm room. Any evolution toward MLS or any hybrid post-quantum layer (PQXDH, ML-KEM Braid) must be introducible without breaking the public facade. This agility is a normative requirement, not an intention.

## 7. Groups — as traversed by the bridge

The bridge does not define the product notion of group, community, or channel, but it supports its encryption. Its obligations for multi-participant scenarios are:

- provide one `SessionIdentifier` per active group session;
- expose the state of each `LinkedDevice` known for each participant;
- signal trust transitions caused by membership changes or by an unknown key;
- surface, through typed signals, any degraded crypto event (undecryptable message, missing key, unexpected device).

The notion of an "anonymous group", of client-signed admin roles, or of limited-use invitation tokens belongs to the product and crypto specs. The bridge merely encrypts the events they produce.

## 8. Anonymity — technical surfaces exposed

The bridge does not define anonymity policy but must not obstruct the strategies retained in the crypto and product specs:

- the API does not assume any phone number, email, or public network identifier;
- the identifiers it exposes are opaque Matrix identifiers from the bridge's viewpoint;
- bridge logs and errors do not journal cleartext payloads, nor device identifiers beyond the strict minimum;
- any application telemetry must be carried by the product, never by the bridge itself.

This neutrality makes "enhanced anonymity" scenarios possible (pseudonymous identifiers derived from a root key, sealed-sender-like envelopes, IP protection through relays) without requiring a bridge redesign.

## 9. Linked devices and recovery — bridge contract

The bridge is the source of the technical states:

- registration and removal of a `LinkedDevice`;
- crypto attestation state of a device (`unverified`, `pending verification`, `verified`);
- key rotation and re-sealing of secrets;
- export of a `RecoveryBundle` and controlled import on a new device.

UX presentation (recovery nudge after the first message, device-add screen) and security semantics (implications of a compromised device, exportable local encrypted vault) belong respectively to product and crypto.

## 10. Inter-instance federation — bridge view

The bridge is **federation-neutral**. It encrypts and decrypts for a given `SessionIdentifier`, regardless of the recipient's homeserver.

Its obligations:

- do not distinguish a local participant from a federated participant at the level of crypto primitives;
- expose in `EventEnvelope` a fully-qualified user identifier `@user:server` without transformation;
- cleanly report cryptographic errors originating from a federated device (unknown key, unshared session, revoked remote device).

Any remote identity resolution logic, federated trust inspection, degraded federation state handling, or inter-instance policy is **outside the bridge**. The contract only guarantees that upper layers can react deterministically to the typed signals the bridge raises.

## 11. Technical trust & safety surfaces

The bridge does not own moderation policy but owns the technical surfaces that trigger it:

- device/session trust state transitions;
- error surfaces for a compromised or degraded crypto state (missing key, broken session, unexpected device appearing in a group);
- usage safeguards for secret export/import (volume limits, invalidation on suspicion).

These surfaces are typed, silent by default, and take no product decision: they feed the UX view and audit maintained by the product layer.

## 12. Platform and deployment assumptions

The bridge must remain portable:

- embedded in React Native mobile apps (iOS, Android);
- reusable by other RN projects without any Messagr-specific configuration;
- compatible with Tauri desktop integration as a native dependency, macOS first, then Windows and Debian/Ubuntu;
- local storage isolated per platform, without implicit sharing between host apps;
- no dependency on a particular Messagr service (backend, discovery, recovery orchestrator).

The full deployment topology (mobile + desktop + backend + agent runtime + homeserver + appservice) is described in the product spec. The bridge only exposes its portability assumptions.

## 13. Bridge test strategy

The bridge test pyramid comprises:

| Level | Content | Purpose |
|---|---|---|
| Rust / crypto tests | encryption, decryption, devices, verification, secrets | correctness at the source |
| RN integration tests | TypeScript facade, Turbo Module, local storage | contract stability |
| Multi-participant contract tests | encrypted A/B scenarios, membership changes | group robustness |
| Binding interop tests | shared JS suite executed against each produced binding (`bridge-native`, and any future binding) | semantic equivalence between bindings, drift detection in CI |
| Federation-neutral tests | `@a:server1` / `@b:server2` scenarios without product logic | non-regression on neutrality |

Product E2E tests (Detox iOS/Android, 1:1 calling, visible recovery) are described by the product spec and consume the bridge as a component.

## 14. Roadmap

| Phase | Content | Expected outcome |
|---|---|---|
| V0.1 | crypto machine, encrypt/decrypt, devices, verification, secrets | package usable in a simple RN app |
| V0.2 | DX hardening, typed errors, robust storage | comfortable use by a product team |
| V0.3 | crypto sync helpers, multi-device scenarios, MLS-ready agility | closer integration into an RN Matrix client |
| V1.0 | stabilized API, public docs, complete example, multi-platform CI | component publishable to third-party projects |

## 15. Structuring decisions to freeze early

- name and license of the public library;
- exact V0.1 scope;
- public TypeScript contract and compatibility policy;
- shape of local crypto storage and export;
- iOS / Android / npm build and publication strategy;
- explicit crypto-agility policy (MLS, hybrid PQ);
- logs and errors policy compatible with the anonymity requirements owned by product.

## 15bis. Project naming and publishing convention

The bridge is published under a neutral, Messagr-independent name, so it remains reusable by the wider ecosystem. Normative convention:

| Item | Name |
|---|---|
| Project, code repository, tagline | `react-native-matrix-crypto` — *A React Native bridge for Matrix cryptography* |
| Public npm package (chosen) | `react-native-matrix-crypto` |
| Scoped npm package (secondary option, if an org namespace is preferred) | `@linagora/react-native-matrix-crypto` |
| Rust core crate | `matrix-crypto-core` |
| Rust FFI crate | `matrix-crypto-ffi` |
| Rust secondary binding crate (reserved, not active) | `matrix-crypto-wasm` |

Availability was verified against the npm registry and crates.io at the time of writing. Names must be effectively reserved as early as possible (a `0.0.0` placeholder package should be published).

Governance: LINAGORA as primary maintainer, licence to be finalized (Apache 2.0 or AGPLv3, according to the group's sovereign strategy). Messagr product decisions do not enter the bridge; the §0 boundary prevails.

## 16. Bridge glossary

| Term | Meaning |
|---|---|
| Generic crypto bridge | Native RN library exposing modern Matrix E2EE. |
| LinkedDevice | Secondary device of an account, seen by the bridge as an identifier and a state. |
| TrustState | Product-friendly trust signal carried on top of Matrix verification. |
| RecoveryBundle | Encrypted bundle of exportable secrets, for which the bridge provides the primitives. |
| Session | Local cryptographic context associated with a user/device pair. |
| Event envelope | Typed envelope of an encrypted or decrypted Matrix event exposed by the bridge. |

Other terms (Channel, Human user, Agent participant, Discovery, Federation, Product API/backend, Agent runtime, Tool gateway, Capability grant, Audit log) are defined by the product spec, canonical source of the complete glossary.

## Consolidation notes

This version integrates:

- the "logical architecture — bridge boundaries" portion of the formalization document;
- the "permissions — out of scope for the bridge" portion;
- the "threat & safety — technical surfaces" portion;
- the "deployment — portability assumptions" portion;
- the "glossary — bridge subset" portion;
- the cross-cutting decisions on groups (crypto-agility), anonymity (neutrality), encryption (contract), and federation (federation-neutral).

The standalone formalization document is no longer the source of truth for this portion and remains only as a migration note.
