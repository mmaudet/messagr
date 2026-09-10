# Room keys are backed up to the homeserver, under a key it never holds

An account may keep its Megolm room keys in the homeserver's key backup
(`m.megolm_backup.v1.curve25519-aes-sha2`), encrypted by a **recovery key**
the device generates and the server never sees. It is offered once, refusable,
and off until accepted. A second route — a **key vault**, the Matrix standard
export file — exists beside it for somebody who wants no key material on a
server at all.

What this recovers is **readability**, never a message store: ADR-0005 derives
the timeline from ciphertext on every launch, so keys coming back make the
past legible again and nothing is cached that was not cached before.

## What it costs today to have none

Room keys live in the crypto store and nowhere else. A device that loses its
store loses every message it had already received, for good. ADR-0012 made a
reinstalled device come back as a _new_ device on the same account — which
fixed the account and said, in as many words, "it is not a key backup and does
not become one". This is that other half.

That price was the right one to pay while the alternative was unexamined. It
is not the right one to keep paying now that the examination is done: losing a
telephone is an ordinary event, and a messenger where it costs your history is
a messenger people keep a second copy of somewhere worse.

## Why the homeserver rather than only a file

§4.6 offers three routes and picks none: a device already connected, a locally
exportable encrypted vault, and social recovery. The first needs a second
device most people do not have and saves nothing when the only one dies. The
second only works for somebody who did it **before** losing the telephone,
which is precisely what nobody does.

The server backup is the one that covers the ordinary case. It is not the
"universal invisible recovery" §4.6 refuses: it is off until somebody accepts
it, and it is worthless without a key only they hold. Refuse it, or lose the
key, and the past is gone exactly as it is today.

ADR-0006 left this door open in its own words — _"Key backup, if it ever
lands, changes the third cost above but not this decision"_ — and it does not
reverse it: nothing decrypted reaches a disk here. What travels is key
material already encrypted for a key the server does not have.

## The weakness we accept, rather than discover later

`m.megolm_backup.v1.curve25519-aes-sha2` **does not authenticate its
ciphertext**. Whoever can write to a backup can substitute keys in it
undetectably, and a device restoring would decrypt what they chose.
`vodozemac` says so by gating the algorithm behind a feature flag named
`insecure-pk-encryption`, and the previous repository measured the whole
mechanism against Continuwuity 26.7.2 and left exactly this to be decided
here.

It is accepted, for two reasons and with one obligation.

The attack needs write access to _your_ backup, which means your account or
the server — and an adversary holding either has larger openings than
substituting room keys. And the alternative is no server backup at all, which
returns the ordinary case to losing everything.

The obligation: the product says it. This is not a footnote for an ADR, it is
the one place where "end-to-end encrypted" promises slightly more than the
mechanism delivers, and this repository has twice had to correct a published
claim that outran its code.

## What it does not cover, and that is deliberate

**Room keys only.** The encrypted notebook — given names, read marks, the call
log, favourites, the conversation list's openings — stays local and stays
mortal. ADR-0010 says why in terms this decision does not weaken: a book of
who you talk to and what you call them is often more revealing than what you
said. Making it travel is a larger decision than this one and is not taken
here.

**Nothing about the promise screen changes.** _« Chiffrée de bout en bout,
sans réglage »_ is about encryption, which stays automatic and unconfigurable.
Durability becomes a choice; encryption does not. No copy may present the
backup as making encryption optional.

## The shape, and why each part is as it is

**The secret is generated, not chosen.** Six words, the same mnemonic
vocabulary the verification gesture uses and the data export already borrows.
A passphrase somebody invents is weak and reused, and this is the single
secret that opens an entire history.

**It is shown once and never again, and it can be replaced.** Showing it again
means anyone holding an unlocked telephone can read it; never being able to
replace it condemns whoever wrote it down badly, and they find out at the
worst moment. Replacing it makes a new backup version and retires the old key,
which is what should happen to a key on a piece of paper nobody can find.

**The device keeps what it needs to keep writing, and only that.** The public
half lives in the keystore, `ThisDeviceOnly` as ADR-0008 requires, so backing
up never asks for anything. The secret is needed only to _restore_.

**It is offered after the first exchange arrives** — the first moment there is
something to lose. Once, refusable, and then a line in Réglages and nothing
else. A product that nags about security teaches people to dismiss it.

**A reinstalled device shows its conversations before asking for anything.**
Demanding a secret at the door is what a bank does. The person sees their
conversations return, understands the past is unreadable, and is offered the
key as the way to get it back — and somebody without a key is not locked out.

**The backup runs at the end of each sync cycle.** The application stops the
library's loop and runs its own (ADR-0007), so nothing uploads by itself. The
cycle's end is the one moment where "every key this device knows is current"
is true, and it costs no round trip per message.

**`/room_keys` goes through the pump**, as an eighth request kind. It is
Matrix protocol and belongs on the protocol's path; a second place that talks
to the homeserver with rules of its own is how two places come to disagree.
The pump's test that _rejects_ `room_key_backup` today becomes a test that
accepts it, rewritten with the reason.

## The vault, and why it is a second thing rather than the same thing

The key vault is Matrix's own export format — the armoured `MEGOLM SESSION
DATA` file, encrypted by a passphrase of its own. So there are **two secrets**
in the product, which an earlier draft of this decision tried to avoid by
encrypting the vault with the recovery key instead.

That was wrong and is recorded because the reasoning matters: a vault only
Messagr can open is a vault that locks somebody into Messagr, which is the
opposite of what this product claims to be. The bridge's own author refused
`exportSecrets` for that exact reason — a container format nobody else can
read. Two secrets that are never presented on the same screen do not get
confused: the recovery key belongs to the ordinary path, the vault is the
gesture of somebody with a reason.

**The vault is not the data export.** They both produce an encrypted file and
they hold different things: the vault holds _keys_, the export holds
_messages_. Somebody handed a `MEGOLM SESSION DATA` file has not received
their data — they have received the means to read it, which is not the same
and does not answer a right of access. Merging them would have made a legal
claim that is false, which this repository has already had to correct twice.

## What has to be built elsewhere first

`react-native-matrix-crypto` has **no key-backup surface at all**: no
`exportRoomKeys`, no `importRoomKeys`, no `m.megolm_backup`, and the Rust FFI
does not carry `BackupMachine`. Its `exportSecrets`/`importSecrets` are
`notImplemented` _on purpose rather than pending_. `createRecovery` exists and
is secret storage for cross-signing private keys only.

So this lot begins in the bridge, not in the application, and the surface is
added there against the upstream `matrix-sdk-crypto`, which carries it. Doing
it in TypeScript instead would mean reimplementing in the application
cryptography the Rust already performs beside it — the one place in this
product where "we will manage in the app" is refused outright.

The application depends on a git commit while the work is built and proved on
a device, and on a published version before it merges: a `yarn install` by
somebody else must not reach for a commit that can disappear.

## Consequences

Whoever accepts the backup trades "a lost telephone costs my history" for "a
lost recovery key costs my history, and a compromised homeserver could
substitute keys I would not detect". That trade is theirs to make, which is
why it is offered rather than defaulted.

ADR-0012 keeps saying it is not a key backup, and that stays true of its own
mechanism — it recovers an _account_. It now points here, so that a reader
does not mistake getting back in for getting back what was said.
