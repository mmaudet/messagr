//! Deactivating ONE claimed account, named by hand, and never one of the
//! demonstration.
//!
//! # THE SWEEP IS NOT BROKEN, AND THIS IS WRITTEN BESIDE IT, NOT OVER IT
//!
//! [`crate::cleanup::deactivate_orphans`] refuses `claimed` rows ON PURPOSE,
//! and its own capitalised comment says why: acting on one would use a living
//! claimant's password and destroy an account handed to somebody. Nothing in
//! this module weakens that filter, and nothing here is called by the sweep.
//! What is written here is the OTHER gesture — an operator, by hand, naming one
//! account, having read what it is about to lose.
//!
//! # WHY A FLAG ON THE BINARY AND NOT A ROUTE
//!
//! A route is reachable by accident: a client retry, a misconfigured proxy,
//! anything holding a bearer. This gesture uses a claimant's LIVING password on
//! purpose. It must be reachable only by a human typing, so it is a mode of the
//! binary, entered from the command line, and it never binds a port nor spawns
//! `cleanup::run_forever` — it can therefore run beside the live service.
//!
//! # THE SIX REFUSALS
//!
//! 1. the batch — exactly one identifier, no filter anywhere in this file;
//! 2. any account of the demonstration — its root, and anyone holding a place;
//! 3. anything that could not be ESTABLISHED — never "then it is not a member";
//! 4. nothing happens before the plan is announced and the identifier typed back;
//! 5. an already deactivated account is a success that calls nothing;
//! 6. an account whose secrets the purge DESTROYED — said as a destruction, not
//!    as a key fault.
//!
//! # WHAT THIS TOOL CANNOT DO, AND WHY IT IS WRITTEN HERE
//!
//! This module authenticates AS the account, with the password and token sealed
//! on its row. [`crate::cleanup::purge_claimed_secrets_of_expired`] destroys
//! both when the invitation expires, and an invitation's lifetime is whatever
//! `ttl_seconds` the client asked for — a quarter of an hour on the shortest
//! `messagr.eu` has served. So this tool reaches a claimed account for AT MOST
//! that lifetime, and never afterwards; refusal 6 is where that boundary is met
//! and named.
//!
//! That boundary is a PRODUCT DECISION (9 August 2026), not an oversight, and
//! reversing it is not this module's business. What was an oversight is that
//! the boundary was never stated: nineteen accounts hit it on 17 August and the
//! refusal blamed the encryption key, which had never changed.

use std::sync::Arc;

use serde_json::Value;
use sqlx::Row;

use crate::{crypto, handlers::revoke::deactivate_with_either, util::localpart, AppState};

/// The flag that selects this mode. Anything STARTING with it selects it too —
/// see [`selects_the_named_deactivation`].
pub const THE_FLAG: &str = "--deactivate-claimed";

/// Names the operations extract that says what the demonstration is.
pub const SEED_PATH_VARIABLE: &str = "MESSAGR_DEMONSTRATION_SEED";

/// Relative to `$HOME`. The path `MessagrApp.kt`'s `readInviterSeed` and the
/// four `live_fixtures` loaders under `core/tests/` already name.
pub const DEFAULT_SEED_PATH: &str = ".messagr-exploitation/demo-maria.json";

/// What the extract says the demonstration IS.
///
/// Two of the six keys `deploy/exploitation::seed::write_the_seed` lays down
/// are read, and NEITHER of the two secrets is touched — not into this value,
/// not into any refusal this module produces. A document carrying only these
/// keys satisfies the reader identically, which is operationally necessary: the
/// real seed is the only copy of a root account's password anywhere, and the
/// service host has no business holding it.
#[derive(Debug, PartialEq, Eq)]
pub struct TheDemonstration {
    /// The rooms of the demonstration. `room_id` always, plus whatever the
    /// optional `room_ids` array names — see [`read_the_demonstration`] on why
    /// this is a set and not one identifier.
    pub rooms: Vec<String>,
    /// The root: it created the room and is its most certain member.
    pub root_user_id: String,
    /// The path all of the above was read from. It goes into the announcement:
    /// an operator must be able to see WHICH document decided.
    pub read_from: String,
}

/// Where one account stands with respect to the demonstration.
#[derive(Debug, PartialEq, Eq)]
pub enum Standing {
    /// It IS the demonstration's root. Refused with no network call at all.
    TheRoot,
    /// It holds a place in a room of the demonstration.
    InTheDemonstration {
        room: String,
        /// `joined`, `invited`, or the successor link that caught it.
        how: String,
    },
    /// It holds no place in any room of the demonstration.
    OutsideIt,
}

/// What the run did.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Deactivated,
    /// Already dead. A success, and it calls nothing and asks nothing.
    AlreadyDeactivated,
}

/// Does this command line select this mode, and what does it name?
///
/// `None` means "start the service normally", which is what every command line
/// without the flag has always meant.
///
/// ANYTHING STARTING WITH THE FLAG SELECTS THE MODE, deliberately.
/// `--deactivate-claimed=@x:h` is a near miss on the flag; landing it in this
/// mode with zero identifiers gets it REFUSED by name (refusal 1), whereas
/// treating it as "not the flag" would start a second service instead.
pub fn selects_the_named_deactivation(argv: &[String]) -> Option<Vec<String>> {
    let after_the_program = argv.iter().skip(1).collect::<Vec<_>>();
    if !after_the_program.iter().any(|a| a.starts_with(THE_FLAG)) {
        return None;
    }
    // Everything that is not an option is a NAMED identifier. Options are left
    // out on purpose: `--all`, `--yes`, `--force` must arrive at refusal 1 as
    // ZERO identifiers, and be refused for naming nobody.
    Some(
        after_the_program
            .into_iter()
            .filter(|a| !a.starts_with('-'))
            .cloned()
            .collect(),
    )
}

/// **REFUSAL 1 — exactly one identifier, and it must look like one.**
///
/// A run that could take two could take twenty. There is NO FILTER anywhere in
/// this file: the two statements below bind this single identifier, and the
/// read is a point lookup on `reserved_accounts`' primary key — at most one row
/// by construction, not by a filter that happens to be narrow today.
///
/// The shape is checked here rather than at the database, so a set arriving
/// dressed as an identifier — `@a:h,@b:h`, a wildcard, a pasted `SELECT` line —
/// is refused BEFORE a file is opened or a socket built.
pub fn the_one_identifier(named: &[String]) -> Result<String, String> {
    match named.len() {
        0 => {
            return Err(
                "this run names nobody: exactly one identifier, typed by hand, per run".into(),
            )
        }
        1 => {}
        many => {
            return Err(format!(
                "this run names {many} accounts: exactly one per run — a run that \
                 could take two could take twenty"
            ))
        }
    }
    let one = &named[0];
    if !is_a_user_id(one) {
        return Err(format!(
            "{one:?} is not a Matrix user identifier (@localpart:server), and nothing \
             that could designate a SET is ever accepted here"
        ));
    }
    Ok(one.clone())
}

/// `@localpart:server`, on the specification's grammar for the localpart.
pub fn is_a_user_id(s: &str) -> bool {
    let Some(rest) = s.strip_prefix('@') else {
        return false;
    };
    let Some((local, server)) = rest.split_once(':') else {
        return false;
    };
    !local.is_empty()
        && !server.is_empty()
        && local
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._=/+-".contains(&b))
        && server
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:[]".contains(&b))
}

/// `!opaque:server` (room versions 1–11) or `!opaque` (version 12 and later,
/// where the id is the create event's hash and carries no server). Nothing more
/// is knowable about a room identifier, and nothing more is needed: what this
/// catches is a MISCOPY.
pub fn is_a_room_id(s: &str) -> bool {
    let Some(rest) = s.strip_prefix('!') else {
        return false;
    };
    if rest.is_empty() || rest.contains(char::is_whitespace) {
        return false;
    }
    // TWO SHAPES, AND REFUSING THE SECOND REFUSED EVERY ROOM THIS PRODUCT MAKES.
    //
    // Measured against production on 17 August 2026: this function required an
    // `!opaque:server` pair, and the demonstration room is
    // `!rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI` — no colon at all. Room
    // version 12, which `core/src/inviter.rs` creates, derives the room id from
    // the create event and drops the server part. So the extract was rejected,
    // the whole gesture refused, and the census could not run.
    //
    // WHY THAT WAS THE DANGEROUS DIRECTION TO BE WRONG IN. The shape check
    // exists because a MISCOPIED room id matches no room ever, which would turn
    // the demonstration refusal into a permission (see `read_the_demonstration`).
    // Refusing a valid id fails loudly and costs a run; accepting an invalid one
    // deactivates an account of the demonstration. This function must keep
    // erring on the first side, which is why the emptiness and whitespace checks
    // above run before either shape is considered.
    match rest.split_once(':') {
        // Legacy (room versions 1–11): `!opaque:server`.
        Some((opaque, server)) => !opaque.is_empty() && !server.is_empty() && !server.contains('!'),
        // Room version 12 and later: the id IS the create event's hash, and
        // carries no server. Nothing further to check — `rest` is already
        // known non-empty and whitespace-free.
        None => true,
    }
}

/// **REFUSAL 3, second half — a demonstration that cannot be established is a
/// refusal, never a room identifier that matches nothing.**
///
/// A miscopied `room_id` does not fail. It matches no room ever, so every
/// account clears the gate and the refusal has quietly become a permission.
/// That is why the shape is checked and not only the presence.
///
/// # Why the rooms are a SET, and what that has to do with a room upgrade
///
/// The gate compares identifiers. A room that has been TOMBSTONED and replaced
/// keeps its identifier for the dead room, so an account living in the
/// SUCCESSOR would clear a gate built on the predecessor alone. Following the
/// tombstone forward needs a token that can read the demonstration room's
/// state, and this command deliberately holds none — the extract carries no
/// secret, on purpose. So the chain is something the extract may NAME, through
/// an optional `room_ids` array, and [`announce`] prints every identifier the
/// verdict was computed against so an operator cannot run this without being
/// told the exact shape of what it cannot see.
pub fn read_the_demonstration(path: &str) -> Result<TheDemonstration, String> {
    let cannot = |why: String| {
        format!(
            "the demonstration could not be established from {path}: {why}. \
             Nothing is deactivated on a guess — a document that cannot be read is \
             a refusal, NOT a room identifier that happens to match nothing."
        )
    };
    let raw = std::fs::read_to_string(path).map_err(|e| cannot(format!("unreadable ({e})")))?;
    let json: Value = serde_json::from_str(&raw).map_err(|e| cannot(format!("not JSON ({e})")))?;
    // Reads by key, and touches NEITHER of the extract's two secrets — not into
    // this value, not into any message above.
    let text = |k: &str| -> Result<String, String> {
        match json[k].as_str() {
            Some(v) if !v.is_empty() => Ok(v.to_string()),
            _ => Err(cannot(format!("it carries no usable `{k}`"))),
        }
    };
    let room_id = text("room_id")?;
    let root_user_id = text("user_id")?;
    if !is_a_room_id(&room_id) {
        return Err(cannot(format!(
            "its `room_id` {room_id:?} is not a room identifier (!opaque:server)"
        )));
    }
    if !is_a_user_id(&root_user_id) {
        return Err(cannot(format!(
            "its `user_id` {root_user_id:?} is not a user identifier (@localpart:server)"
        )));
    }
    let mut rooms = vec![room_id];
    for named in json["room_ids"].as_array().unwrap_or(&Vec::new()) {
        let more = named.as_str().unwrap_or_default().to_string();
        if !is_a_room_id(&more) {
            return Err(cannot(format!(
                "one of its `room_ids`, {more:?}, is not a room identifier"
            )));
        }
        if !rooms.contains(&more) {
            rooms.push(more);
        }
    }
    Ok(TheDemonstration {
        rooms,
        root_user_id,
        read_from: path.to_string(),
    })
}

/// **REFUSAL 2 — the verdict.**
///
/// Three arms, and the first needs no network at all, which is why `run` asks
/// this question once on an EMPTY standing before it opens a socket: the root
/// created the room and is its most certain member, so it stays refused on the
/// day the homeserver is unreachable.
///
/// A place OFFERED is a place held: deactivating declines the invitation, and
/// the frozen room stops showing an arrival it was showing. A room already LEFT
/// is the opposite — the place is already given up.
///
/// The `predecessors` arm reads a sync shape this repository has not measured,
/// and it is sound for one reason only: **it can only ever ADD a refusal.** A
/// sync that carries no state finds nothing here and nothing changes.
pub fn the_demonstration_verdict(
    demonstration: &TheDemonstration,
    user_id: &str,
    rooms: &crate::matrix::RoomsOfTheAccount,
) -> Standing {
    if user_id == demonstration.root_user_id {
        return Standing::TheRoot;
    }
    let holds_a_place = |room: &String| rooms.joined.contains(room) || rooms.invited.contains(room);
    for room in &demonstration.rooms {
        if rooms.joined.contains(room) {
            return Standing::InTheDemonstration {
                room: room.clone(),
                how: "it has joined it".into(),
            };
        }
        if rooms.invited.contains(room) {
            return Standing::InTheDemonstration {
                room: room.clone(),
                how: "it holds a standing invitation into it, and deactivating declines it".into(),
            };
        }
        for (successor, replaced) in &rooms.predecessors {
            if replaced == room && holds_a_place(successor) {
                return Standing::InTheDemonstration {
                    room: successor.clone(),
                    how: format!("that room replaced {room}, which the extract names"),
                };
            }
        }
    }
    Standing::OutsideIt
}

/// **REFUSAL 4, first half — what the operator reads before anything happens.**
///
/// It names the account, when it was handed out, the demonstration and the
/// document that said so, the standing that was checked, and the damage in
/// plain words. It quotes no secret, because it is handed none.
pub fn announce(
    user_id: &str,
    claimed_at: Option<i64>,
    demonstration: &TheDemonstration,
    standing: &Standing,
) -> String {
    let mut said = vec![
        format!("About to deactivate {user_id}, for good."),
        String::new(),
        match claimed_at {
            Some(at) => format!("  handed out at : {at} (Unix seconds)"),
            None => "  handed out at : unrecorded".into(),
        },
        format!(
            "  standing      : {}",
            match standing {
                Standing::TheRoot => "the ROOT of the demonstration".into(),
                Standing::InTheDemonstration { room, how } => format!("INSIDE {room} — {how}"),
                Standing::OutsideIt => "outside every room of the demonstration named below".into(),
            }
        ),
        format!("  said by       : {}", demonstration.read_from),
        format!("  its root      : {}", demonstration.root_user_id),
        "  demonstration :".into(),
    ];
    for room in &demonstration.rooms {
        said.push(format!("      {room}"));
    }
    said.extend([
        String::new(),
        "What this does, and there is no undo:".into(),
        "  - it leaves every room it is in, this demonstration included if the".into(),
        "    verdict above is wrong, and it cannot be put back;".into(),
        "  - its devices stop existing, and its history stops decrypting;".into(),
        "  - the localpart is never released by the homeserver;".into(),
        "  - it is irreversible.".into(),
        String::new(),
        "WHAT THIS CANNOT SEE: a room that REPLACED one of the rooms listed".into(),
        "above and that the document does not name. If the demonstration has".into(),
        format!(
            "been upgraded, add the successor to `room_ids` in {} first.",
            demonstration.read_from
        ),
        String::new(),
        format!("Type {user_id} to confirm. Anything else abandons."),
    ]);
    said.join("\n")
}

/// **REFUSAL 4, second half — the identifier typed back, and nothing else.**
///
/// NOT `--yes`: a flag is typed by reflex and sits in a shell history one arrow
/// key from a command that named a different account. Typing the identifier
/// cannot be done without reading it, and cannot be carried between runs.
///
/// Surrounding whitespace is forgiven — a terminal supplies a newline. Case is
/// not: a Matrix localpart is case-sensitive, and an operator who typed the
/// wrong case did not read the identifier off the announcement.
///
/// `None` is the end of stdin, and it is a refusal: a cron entry, a pipeline or
/// a pasted runbook finds no way through.
pub fn is_the_confirmation(answer: Option<&str>, user_id: &str) -> bool {
    answer.is_some_and(|typed| typed.trim() == user_id)
}

/// The whole gesture, in the ONE order that makes each refusal worth having,
/// with the asking INJECTED so a test can drive it — and, more to the point, so
/// a test can assert it was never asked at all.
///
/// Everything before the confirmation is a READ — the row, the extract, the
/// verdict, the announcement — which is what makes this command its own
/// read-only census: run it and answer anything else, and it writes nothing
/// while telling you the verdict.
///
/// The extract's path is a PARAMETER and not read from the environment here:
/// the environment is process-global, and a test that had to set it could not
/// run beside another. `main` passes [`the_seed_path`].
pub async fn run<A>(
    st: &Arc<AppState>,
    named: &[String],
    seed_path: &str,
    ask: A,
) -> Result<Outcome, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    let user_id = the_one_identifier(named)?;

    let row = sqlx::query(
        "SELECT status, claimed_at, password_enc, password_next_enc, access_token_enc \
         FROM reserved_accounts WHERE user_id = ?",
    )
    .bind(&user_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(|e| format!("{user_id}: the database could not be read: {e}"))?;
    let Some(row) = row else {
        return Err(format!("{user_id}: no such row"));
    };

    let status: String = row.get("status");
    let claimed_at: Option<i64> = row.get("claimed_at");

    // REFUSAL 5 — idempotent. Already dead is a SUCCESS, and there is nothing
    // to announce about an account that is already dead: this returns before
    // the extract is read, before a socket is built, and before `ask`.
    if status == "deactivated" {
        return Ok(Outcome::AlreadyDeactivated);
    }
    // This mode is for accounts HANDED OUT to somebody, and for nothing else.
    // `reserved` and `claiming` rows belong to `cleanup::deactivate_orphans`,
    // WHICH IS NOT BROKEN, and taking them here would duplicate a sweep that
    // already runs hourly.
    if status != "claimed" {
        return Err(format!(
            "{user_id}: this row is {status:?}, not `claimed`. Rows never handed out are \
             `cleanup::deactivate_orphans`'s, and it is not broken."
        ));
    }

    let demonstration = read_the_demonstration(seed_path)?;

    // REFUSAL 2, the arm that needs NO NETWORK. Asked here, on an empty
    // standing, so it still holds on the day the homeserver is unreachable or
    // the room identifier in hand has become a tombstone. Single-sourced from
    // the same verdict as the rest, so the two cannot drift apart.
    if the_demonstration_verdict(
        &demonstration,
        &user_id,
        &crate::matrix::RoomsOfTheAccount::default(),
    ) == Standing::TheRoot
    {
        return Err(format!(
            "{user_id} is the ROOT of the demonstration, per {}. It created the room \
             and is its most certain member. Refused before any network call.",
            demonstration.read_from
        ));
    }

    // **REFUSAL 6 — the secrets were DESTROYED, and that is not a key fault.**
    //
    // `cleanup::purge_claimed_secrets_of_expired` empties these three columns
    // the moment the invitation expires (product decision of 9 August 2026):
    // the service's power over a handed-out account is bounded by the
    // invitation's lifetime, which is the `ttl_seconds` the CLIENT asked for.
    // Measured on `messagr.eu` on 17 August 2026, across 73 invitations: 900 s
    // on 4, 3600 s on 33, 86 400 s on 33, and the 30-day ceiling on 3. So the
    // window in which this tool can reach a claimed account is a quarter of an
    // hour on the shortest, and no key reopens it afterwards.
    //
    // SAID APART FROM THE DECRYPTION FAILURE BECAUSE THE TWO CALL FOR OPPOSITE
    // ACTIONS. A ciphertext that is present and unreadable means the key is
    // wrong: look at `ENCRYPTION_KEY`. An EMPTY column means the service
    // deliberately surrendered its power: there is nothing to look for, and
    // nothing to repair. `crypto::open` cannot tell them apart — it refuses an
    // empty blob on `sealed.len() < 12` and an altered one on the AEAD tag,
    // both as a bare `Err` — so the difference must be established HERE, before
    // the call, by looking at the column itself.
    //
    // Placed AFTER refusals 2 and 5 on purpose: the root of the demonstration
    // and an already-dead account must keep being refused by their own name,
    // whatever state their secrets are in.
    if row.get::<Vec<u8>, _>("password_enc").is_empty() {
        return Err(format!(
            "{user_id}: its secrets were DESTROYED when its invitation expired — not \
             corrupted, and not a key fault. `cleanup::purge_claimed_secrets_of_expired` \
             empties `password_enc`, `password_next_enc` and `access_token_enc` on every \
             claimed row whose invitation has expired (product decision of 9 August 2026). \
             The service therefore kept no means of authenticating as this account: no key \
             opens anything, and this tool cannot deactivate it. The homeserver's own admin \
             API is the only remaining path."
        ));
    }

    let pw = crypto::open(
        &st.cfg.encryption_key,
        row.get::<Vec<u8>, _>("password_enc").as_slice(),
    )
    .map_err(|_| format!("{user_id}: the sealed password no longer opens"))?;
    let next = row
        .get::<Option<Vec<u8>>, _>("password_next_enc")
        .and_then(|b| crypto::open(&st.cfg.encryption_key, &b).ok());
    let token = crypto::open(
        &st.cfg.encryption_key,
        row.get::<Vec<u8>, _>("access_token_enc").as_slice(),
    )
    .ok();
    let bare = localpart(&user_id);
    let token =
        match token {
            Some(t) => t,
            None => st.mx.login(&bare, &pw).await.map_err(|e| {
                format!("{user_id}: no usable token and the session did not open: {e}")
            })?,
        };

    // REFUSAL 3, first half — NEVER "then it is not a member". Every failure of
    // this read, transport and shapeless 200 alike, becomes a refusal that says
    // in as many words that it is not concluding absence.
    let rooms = st.mx.rooms_of_the_account(&token).await.map_err(|e| {
        format!(
            "{user_id}: its standing in the demonstration could NOT be established ({e}). \
             This is not a conclusion that it is outside the room — nothing is \
             deactivated on a guess."
        )
    })?;

    // REFUSAL 2 — the room decides, and it decides before the operator is even
    // asked, so no confirmation can override it.
    let standing = the_demonstration_verdict(&demonstration, &user_id, &rooms);
    if let Standing::InTheDemonstration { room, how } = &standing {
        return Err(format!(
            "{user_id} holds a place in {room}, a room of the demonstration per {}: {how}. \
             Deactivating it makes it LEAVE that room, and the demonstration device's \
             history depends on it.",
            demonstration.read_from
        ));
    }

    // REFUSAL 4 — it says what it will do, then waits for the identifier typed
    // back. Everything above this line was a read.
    let plan = announce(&user_id, claimed_at, &demonstration, &standing);
    let answer = ask(&plan);
    if !is_the_confirmation(answer.as_deref(), &user_id) {
        return Err(format!(
            "{user_id}: abandoned. Nothing was asked of the homeserver and nothing \
             was written."
        ));
    }

    if !deactivate_with_either(st.as_ref(), &token, &bare, next, &pw).await {
        return Err(format!(
            "{user_id}: the homeserver refused the deactivation"
        ));
    }

    // UNGUARDED on `status` ON PURPOSE: by this line the homeserver has
    // answered that the account is dead, so `deactivated` without secrets is
    // the only true thing left to write, in every interleaving.
    sqlx::query(
        "UPDATE reserved_accounts SET status='deactivated', password_enc=X'', \
                 password_next_enc=NULL, access_token_enc=X'' WHERE user_id=?",
    )
    .bind(&user_id)
    .execute(&st.pool)
    .await
    .map_err(|e| format!("{user_id}: the account is DEAD but the row was not finished: {e}"))?;
    Ok(Outcome::Deactivated)
}

/// Where the extract is, `$HOME`-relative unless the variable names another.
pub fn the_seed_path() -> String {
    std::env::var(SEED_PATH_VARIABLE).unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/{DEFAULT_SEED_PATH}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The account under test throughout, and the room it must never be in.
    const CLAIMANT: &str = "@x7qf2k9j:messagr.eu";
    const THE_ROOM: &str = "!demonstration:messagr.eu";
    const THE_ROOT: &str = "@maria:messagr.eu";
    /// Sorts BEFORE `!demonstration`, so the demonstration lands SECOND in the
    /// fake sync's `rooms.join`: a reader that stopped at the first room would
    /// miss it. `serde_json` orders object keys, so this is stable.
    const ANOTHER_ROOM: &str = "!aaa-ordinary:messagr.eu";

    // ── The fake homeserver ──────────────────────────────────────────────

    /// Notes what it was asked, and serves a sync body the test chose. Nothing
    /// here reaches a network: the whole point is that a successful
    /// deactivation cannot be tried to see.
    struct FakeHomeserver {
        calls: std::sync::Mutex<Vec<String>>,
        sync_status: u16,
        sync_body: String,
        refuse_login: bool,
    }

    impl FakeHomeserver {
        fn serving(sync_body: Value) -> Self {
            FakeHomeserver {
                calls: std::sync::Mutex::new(Vec::new()),
                sync_status: 200,
                sync_body: sync_body.to_string(),
                refuse_login: false,
            }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
        fn was_deactivated(&self) -> bool {
            self.calls().iter().any(|c| c.starts_with("deactivate:"))
        }
    }

    async fn route(
        axum::extract::State(f): axum::extract::State<Arc<FakeHomeserver>>,
        req: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        let path = req.uri().path().to_string();
        let body = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let v: Value = serde_json::from_slice(&body).unwrap_or(json!({}));

        if path.ends_with("/v3/sync") {
            f.calls.lock().unwrap().push("sync".into());
            return (
                axum::http::StatusCode::from_u16(f.sync_status).unwrap(),
                [("content-type", "application/json")],
                f.sync_body.clone(),
            )
                .into_response();
        }
        if path.ends_with("/v3/login") {
            let who = v["identifier"]["user"].as_str().unwrap_or("?").to_string();
            f.calls.lock().unwrap().push(format!("login:{who}"));
            if f.refuse_login {
                return (axum::http::StatusCode::FORBIDDEN, axum::Json(json!({}))).into_response();
            }
            return axum::Json(json!({"access_token": "a-session"})).into_response();
        }
        if path.ends_with("/v3/account/deactivate") {
            let who = v["auth"]["identifier"]["user"]
                .as_str()
                .unwrap_or("?")
                .to_string();
            f.calls.lock().unwrap().push(format!("deactivate:{who}"));
            return axum::Json(json!({})).into_response();
        }
        (axum::http::StatusCode::NOT_FOUND, axum::Json(json!({}))).into_response()
    }

    async fn spawn(fake: FakeHomeserver) -> (String, Arc<FakeHomeserver>) {
        let fake = Arc::new(fake);
        let app = axum::Router::new().fallback(route).with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, fake)
    }

    fn test_state(pool: sqlx::SqlitePool, homeserver: String) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                homeserver.clone(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: homeserver,
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        })
    }

    // ── The fixtures ─────────────────────────────────────────────────────

    /// A `claimed` row carrying its secrets: exactly what one of the accounts
    /// still alive on the homeserver looks like in this database.
    async fn plant_a_claimed_row(pool: &sqlx::SqlitePool, user_id: &str, with_a_token: bool) {
        sqlx::query(
            "INSERT OR IGNORE INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,9999999999,1,1,'pending')",
        )
        .execute(pool)
        .await
        .unwrap();
        let token = if with_a_token {
            crypto::seal(&[0u8; 32], "the-sealed-token").unwrap()
        } else {
            Vec::new()
        };
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at, claimed_at) VALUES (?,'i1',?,?,'claimed',0,1000)",
        )
        .bind(user_id)
        .bind(crypto::seal(&[0u8; 32], "the-living-password").unwrap())
        .bind(token)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Writes an extract and returns its path. The directory is kept alive by
    /// the returned handle.
    fn plant_a_seed(document: Value) -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("demo.json");
        std::fs::write(&path, document.to_string()).unwrap();
        let path = path.to_string_lossy().to_string();
        (dir, path)
    }

    fn the_usual_seed() -> Value {
        json!({"serveur": "https://messagr.eu", "user_id": THE_ROOT, "room_id": THE_ROOM})
    }

    /// A sync body naming rooms, with the demonstration SECOND when present.
    fn sync_with(joined: &[&str], invited: &[&str], left: &[&str]) -> Value {
        let section = |names: &[&str]| -> Value {
            Value::Object(names.iter().map(|n| (n.to_string(), json!({}))).collect())
        };
        json!({"rooms": {
            "join": section(joined),
            "invite": section(invited),
            "leave": section(left),
        }})
    }

    async fn status_of(pool: &sqlx::SqlitePool, user_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn password_of(pool: &sqlx::SqlitePool, user_id: &str) -> Vec<u8> {
        sqlx::query_scalar("SELECT password_enc FROM reserved_accounts WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// The confirmation a real operator would type. Used by every test whose
    /// subject is a refusal OTHER than refusal 4: without it those tests would
    /// stay green on a build where their own refusal had been deleted and
    /// refusal 4 alone stopped the run.
    fn types_it_back(_: &str) -> Option<String> {
        Some(CLAIMANT.to_string())
    }

    // ── REFUSAL 1 — the batch ────────────────────────────────────────────

    /// **One identifier per run, and there is NO FILTER ANYWHERE IN THIS FILE.**
    ///
    /// A run that could take two could take twenty. Zero is refused for naming
    /// nobody; two or more is refused for naming a set; and the shapes a set
    /// arrives in are each refused BEFORE a file is opened or a socket built.
    #[test]
    fn only_one_identifier_is_accepted_and_every_selection_is_refused() {
        let refused: Vec<Vec<String>> = vec![
            vec![],
            vec!["@a:h".into(), "@b:h".into()],
            vec!["@a:h".into(), "@b:h".into(), "@c:h".into()],
            // The shapes a SET arrives in, each one an identifier by arity.
            vec!["@a:h,@b:h".into()],
            vec!["@%:messagr.eu".into()],
            vec!["@*:messagr.eu".into()],
            vec!["SELECT user_id FROM reserved_accounts WHERE status='claimed'".into()],
            vec!["--all".into()],
            vec!["'".into()],
            vec!["x7qf2k9j:messagr.eu".into()],
            vec!["@x7qf2k9j".into()],
            vec!["@:messagr.eu".into()],
            vec!["@x7qf2k9j:".into()],
            vec!["@x7qf2k9j messagr.eu".into()],
            vec!["@x7qf2k9j:messagr.eu ".into()],
        ];
        for named in refused {
            assert!(
                the_one_identifier(&named).is_err(),
                "{named:?}: wrongly accepted — one identifier per run, and a \
                 run that could take two could take twenty"
            );
        }

        // Inseparable control: one well-formed identifier IS accepted,
        // otherwise a function refusing everything would pass the loop above
        // while delivering nothing.
        assert_eq!(the_one_identifier(&[CLAIMANT.into()]).unwrap(), CLAIMANT);

        // And the module itself carries NO FILTER: two statements, both binding
        // the single identifier, the read a point lookup on the primary key.
        // Scanned up to the test module, so the needles below — which live
        // AFTER it — cannot match themselves and make this vacuous.
        let source = include_str!("named_deactivation.rs");
        let (module, _) = source
            .split_once("#[cfg(test)]")
            .expect("the test module marker must be found");
        for filter in [
            " LIKE ",
            " IN (",
            "status='claimed'",
            "status = 'claimed'",
            "fetch_all",
        ] {
            assert!(
                !module.contains(filter),
                "the module must contain nothing that could designate a SET: found {filter:?}"
            );
        }
        // Two statements, no more: the point lookup and the final wipe.
        assert_eq!(
            module.matches("sqlx::query").count(),
            2,
            "exactly two statements, both binding the single identifier"
        );
    }

    /// The dispatch is a predicate, so it can be read AND tested. A near miss
    /// on the flag lands in this mode with zero identifiers — where refusal 1
    /// refuses it by name — rather than quietly starting a second service.
    #[test]
    fn the_flag_selects_the_mode_and_a_near_miss_does_not_start_a_service() {
        let argv = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        assert_eq!(
            selects_the_named_deactivation(&argv(&["messagr-invitations"])),
            None,
            "an ordinary start must stay an ordinary start"
        );
        assert_eq!(
            selects_the_named_deactivation(&argv(&["messagr-invitations", "--deactivate"])),
            None,
            "a different flag is not this one"
        );
        assert_eq!(
            selects_the_named_deactivation(&argv(&["messagr-invitations", THE_FLAG, CLAIMANT])),
            Some(vec![CLAIMANT.to_string()]),
        );
        // The near miss: selected, and NAMING NOBODY, so refusal 1 catches it.
        let near = selects_the_named_deactivation(&argv(&[
            "messagr-invitations",
            "--deactivate-claimed=@x7qf2k9j:messagr.eu",
        ]))
        .expect("a near miss on the flag must not start a service");
        assert!(the_one_identifier(&near).is_err());
        // And so does an attempt at a sweep.
        let sweep =
            selects_the_named_deactivation(&argv(&["messagr-invitations", THE_FLAG, "--all"]))
                .unwrap();
        assert!(the_one_identifier(&sweep).is_err());
    }

    // ── REFUSAL 2 — any account of the demonstration ─────────────────────

    /// **THE LOAD-BEARING TEST.** A claimed account that holds a place in the
    /// demonstration room is refused, and the homeserver is never asked to
    /// deactivate it.
    ///
    /// The identifier IS typed back at the confirmation, on purpose: the
    /// refusal must come from the room, not from an operator who hesitated.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_of_the_demonstration_room_is_refused_and_never_deactivated(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(
            &[ANOTHER_ROOM, THE_ROOM],
            &[],
            &[],
        )))
        .await;
        let st = test_state(pool.clone(), base);

        let refusal = run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("an account of the demonstration room must be refused");
        assert!(
            refusal.contains(THE_ROOM),
            "the refusal must name the room that decided: {refusal}"
        );
        assert!(
            !fake.was_deactivated(),
            "and NOTHING must have been asked of the homeserver: {:?}",
            fake.calls()
        );
        assert_eq!(status_of(&pool, CLAIMANT).await, "claimed");
        assert!(!password_of(&pool, CLAIMANT).await.is_empty());
    }

    /// The root is refused WITHOUT ANY NETWORK CALL. It created the room and is
    /// its most certain member, so it stays refused on the day the homeserver
    /// is unreachable or the identifier in hand has become a tombstone.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_root_of_the_demonstration_is_refused_without_any_network_call(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, THE_ROOT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
        let st = test_state(pool.clone(), base);

        let refusal = run(&st, &[THE_ROOT.into()], &seed, |_| {
            Some(THE_ROOT.to_string())
        })
        .await
        .expect_err("the root of the demonstration must be refused");
        assert!(
            refusal.to_lowercase().contains("root"),
            "the refusal must say it is the root: {refusal}"
        );
        assert!(
            fake.calls().is_empty(),
            "and it must be refused before ANY network call — a homeserver that \
             is down must not turn this refusal into a permission; observed: {:?}",
            fake.calls()
        );
    }

    /// A place OFFERED is a place held. Deactivating declines the invitation,
    /// and the frozen room stops showing an arrival it was showing. A room
    /// already LEFT is the opposite: the place is already given up.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_pending_invitation_into_the_room_counts_as_being_in_it(pool: sqlx::SqlitePool) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(
            &[ANOTHER_ROOM],
            &[THE_ROOM],
            &[],
        )))
        .await;
        let st = test_state(pool.clone(), base);

        run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("a standing invitation is a place held");
        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());

        // The counterweight: a room already LEFT is a place given up, and must
        // NOT refuse — otherwise "invited counts" would be indistinguishable
        // from "any mention of the room counts", which refuses everything.
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(
            &[ANOTHER_ROOM],
            &[],
            &[THE_ROOM],
        )))
        .await;
        let st = test_state(pool.clone(), base);
        assert_eq!(
            run(&st, &[CLAIMANT.into()], &seed, types_it_back)
                .await
                .unwrap(),
            Outcome::Deactivated
        );
        assert!(fake.was_deactivated());
    }

    /// **THE ROOM UPGRADE.** The gate compares identifiers, so an account
    /// living in a room that REPLACED the demonstration would otherwise clear
    /// it — the identifier in hand names the predecessor.
    ///
    /// Two ways in, and both are exercised here:
    ///
    /// 1. the extract NAMES the chain, through its optional `room_ids`;
    /// 2. the sync carries the successor's `m.room.create`, whose
    ///    `predecessor.room_id` is the room the extract names.
    ///
    /// The second reads a response shape this repository has not measured, and
    /// it is safe for one reason only: it can only ever ADD a refusal. When the
    /// sync carries no state, it finds nothing and nothing changes.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_of_a_room_that_replaced_the_demonstration_is_refused(
        pool: sqlx::SqlitePool,
    ) {
        const SUCCESSOR: &str = "!successor:messagr.eu";
        plant_a_claimed_row(&pool, CLAIMANT, true).await;

        // 1. The extract names the chain.
        let (_dir, named_chain) = plant_a_seed(json!({
            "user_id": THE_ROOT, "room_id": THE_ROOM, "room_ids": [SUCCESSOR]
        }));
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[SUCCESSOR], &[], &[]))).await;
        let st = test_state(pool.clone(), base);
        run(&st, &[CLAIMANT.into()], &named_chain, types_it_back)
            .await
            .expect_err("a room the extract names is a room of the demonstration");
        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());

        // 2. The extract names ONE room, and the successor declares itself.
        let (_dir2, seed) = plant_a_seed(the_usual_seed());
        let declares = json!({"rooms": {"join": {SUCCESSOR: {"state": {"events": [
            {"type": "m.room.create", "state_key": "",
             "content": {"room_version": "12", "predecessor": {"room_id": THE_ROOM}}}
        ]}}}}});
        let (base, fake) = spawn(FakeHomeserver::serving(declares)).await;
        let st = test_state(pool.clone(), base);
        run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("a room that declares the demonstration as its predecessor is refused");
        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());

        // Inseparable control: a room that succeeds SOMETHING ELSE is not the
        // demonstration, and must not be refused — otherwise the check above
        // would be "any predecessor at all refuses", which refuses everything.
        let elsewhere = json!({"rooms": {"join": {ANOTHER_ROOM: {"state": {"events": [
            {"type": "m.room.create", "state_key": "",
             "content": {"predecessor": {"room_id": "!unrelated:messagr.eu"}}}
        ]}}}}});
        let (base, fake) = spawn(FakeHomeserver::serving(elsewhere)).await;
        let st = test_state(pool.clone(), base);
        assert_eq!(
            run(&st, &[CLAIMANT.into()], &seed, types_it_back)
                .await
                .unwrap(),
            Outcome::Deactivated
        );
        assert!(fake.was_deactivated());
    }

    // ── REFUSAL 3 — what could not be established ────────────────────────

    /// **NEVER "then it is not a member".** A standing that could not be
    /// established is a refusal, and the message says so rather than concluding
    /// absence.
    ///
    /// The 200 that carries no `rooms` is the one that matters: a body that
    /// parses is not an answer.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_standing_that_cannot_be_established_is_refused_rather_than_assumed_absent(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());

        let unwell: Vec<(&str, u16, Value)> = vec![
            ("a homeserver that is unwell", 502, json!({})),
            ("a token the homeserver refuses", 401, json!({})),
            ("rate limiting", 429, json!({})),
            ("a 200 that carries no rooms at all", 200, json!({})),
            ("a 200 whose rooms is an array", 200, json!({"rooms": []})),
            (
                "a 200 whose rooms is a string",
                200,
                json!({"rooms": "none"}),
            ),
            ("a 200 that is not an object", 200, json!("ok")),
        ];
        for (name, status, body) in unwell {
            let (base, fake) = spawn(FakeHomeserver {
                calls: std::sync::Mutex::new(Vec::new()),
                sync_status: status,
                sync_body: body.to_string(),
                refuse_login: false,
            })
            .await;
            let st = test_state(pool.clone(), base);
            let refusal = run(&st, &[CLAIMANT.into()], &seed, types_it_back)
                .await
                .err()
                .unwrap_or_else(|| {
                    panic!(
                        "{name}: wrongly allowed through — a standing that could not \
                         be established must never pass for an absence"
                    )
                });
            assert!(
                refusal.contains("not a conclusion"),
                "{name}: the refusal must say it is NOT concluding the account is \
                 outside the room: {refusal}"
            );
            assert!(!fake.was_deactivated(), "{name}: calls {:?}", fake.calls());
        }
    }

    /// A MISCOPIED `room_id` does not fail: it matches no room ever, so every
    /// account clears the gate and the refusal has quietly become a permission.
    /// It is refused on SHAPE.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_demonstration_room_that_cannot_be_read_is_a_refusal_not_a_room_that_matches_nothing(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;

        let broken: Vec<(&str, Option<Value>)> = vec![
            ("no such file", None),
            ("not JSON at all", Some(Value::String("{not json".into()))),
            ("an empty document", Some(json!({}))),
            ("no room_id", Some(json!({"user_id": THE_ROOT}))),
            ("no user_id", Some(json!({"room_id": THE_ROOM}))),
            (
                "an empty room_id",
                Some(json!({"user_id": THE_ROOT, "room_id": ""})),
            ),
            (
                "an empty user_id",
                Some(json!({"user_id": "", "room_id": THE_ROOM})),
            ),
            // THE TREACHEROUS ONE: a miscopied identifier that is not a room.
            (
                "a room_id that is not a room identifier",
                Some(json!({"user_id": THE_ROOT, "room_id": "demonstration:messagr.eu"})),
            ),
            // `!demonstration` USED TO BE ON THIS LIST AND HAD TO LEAVE IT,
            // 17 August 2026. A room id with no server is not malformed: it is
            // what room version 12 produces, the version `core/src/inviter.rs`
            // creates, and the demonstration room of `messagr.eu` is exactly
            // that shape. Keeping it here made the whole gesture refuse every
            // room this product has ever made — measured against production,
            // where the census could not run at all.
            //
            // WHAT THAT COSTS, SAID PLAINLY RATHER THAN GLOSSED. The shape
            // check is weaker now: any miscopy that still begins with `!` and
            // carries no whitespace passes it, where before a missing server
            // caught a whole family of typos. What still catches those is
            // `announce`, which prints EVERY room identifier it compared
            // before asking for confirmation — refusal 4 is now load-bearing
            // for a case refusal 3 used to cover on its own.
            (
                "a room_id that is a user identifier",
                Some(json!({"user_id": THE_ROOT, "room_id": THE_ROOT})),
            ),
            (
                "a user_id that is not a user identifier",
                Some(json!({"user_id": "maria", "room_id": THE_ROOM})),
            ),
            (
                "a room_ids entry that is not a room identifier",
                Some(json!({"user_id": THE_ROOT, "room_id": THE_ROOM, "room_ids": ["oops"]})),
            ),
        ];
        for (name, document) in broken {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("demo.json");
            if let Some(d) = document {
                let body = match d {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                std::fs::write(&path, body).unwrap();
            }
            let path = path.to_string_lossy().to_string();

            assert!(
                read_the_demonstration(&path).is_err(),
                "{name}: wrongly read — a demonstration that cannot be established \
                 must be a refusal, never a room identifier that matches nothing"
            );

            // And the whole gesture refuses, with a live homeserver saying the
            // account is in no room at all: without the refusal above, THIS is
            // the run that would deactivate.
            let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
            let st = test_state(pool.clone(), base);
            assert!(
                run(&st, &[CLAIMANT.into()], &path, types_it_back)
                    .await
                    .is_err(),
                "{name}: the whole run must refuse too — with the homeserver saying \
                 the account is in no room at all, THIS is the run that would \
                 otherwise deactivate"
            );
            assert!(!fake.was_deactivated(), "{name}: calls {:?}", fake.calls());
        }

        // Inseparable control: a well-formed extract IS read, otherwise a
        // reader refusing everything would pass the loop above.
        let (_dir, good) = plant_a_seed(the_usual_seed());
        let read = read_the_demonstration(&good).unwrap();
        assert_eq!(read.rooms, vec![THE_ROOM.to_string()]);
        assert_eq!(read.root_user_id, THE_ROOT);
    }

    /// The extract's two secrets are never touched — not into the value the
    /// reader returns, not into any message it produces when it refuses. The
    /// real seed is the only copy of a root account's password anywhere.
    /// A ROOM VERSION 12 IDENTIFIER IS A ROOM IDENTIFIER, and until 17 August
    /// 2026 this function said otherwise — which refused every room this
    /// product has ever made, because `core/src/inviter.rs` creates version 12
    /// and that version derives the id from the create event and drops the
    /// server part. Measured against production: the demonstration room is
    /// `!rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI`, no colon at all, and
    /// the census could not run.
    ///
    /// This test exists so that tightening the check back costs a red rather
    /// than a silent refusal of the only shape that matters here.
    #[test]
    fn a_room_id_without_a_server_is_the_shape_room_version_12_produces() {
        assert!(
            is_a_room_id("!rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI"),
            "a room version 12 identifier was refused. Every room of this \
             product has this shape; refusing it refuses the whole gesture."
        );
        assert!(
            is_a_room_id("!demonstration:messagr.eu"),
            "the legacy shape must keep working: rooms made before version 12 \
             still exist and still carry a server part."
        );
        // The direction that must stay refused, and it is the dangerous one:
        // what is NOT a room id must not become one. See the broken-seed test
        // for why — a value that matches no room turns a refusal into a
        // permission.
        for not_a_room in [
            "demonstration:messagr.eu",
            "@maria:messagr.eu",
            "!",
            "",
            "!a b",
        ] {
            assert!(
                !is_a_room_id(not_a_room),
                "{not_a_room:?} was taken for a room identifier"
            );
        }
    }
    #[test]
    fn the_reader_never_touches_the_seeds_two_secrets() {
        const PASSWORD: &str = "MARIAS-ACTUAL-PASSWORD";
        const TOKEN: &str = "MARIAS-ACTUAL-TOKEN";
        let full = json!({
            "serveur": "https://messagr.eu", "user_id": THE_ROOT,
            "mot_de_passe": PASSWORD, "access_token": TOKEN,
            "room_id": THE_ROOM, "first_name": "Maria",
        });
        let (_dir, path) = plant_a_seed(full);
        let read = read_the_demonstration(&path).unwrap();
        let seen = format!("{read:?}");
        assert!(!seen.contains(PASSWORD), "the value carries the password");
        assert!(!seen.contains(TOKEN), "the value carries the token");

        // And a refusal produced from a document that DOES carry them must not
        // quote them either.
        let (_dir2, broken) = plant_a_seed(json!({
            "mot_de_passe": PASSWORD, "access_token": TOKEN, "room_id": "oops",
        }));
        let refusal = read_the_demonstration(&broken).unwrap_err();
        assert!(!refusal.contains(PASSWORD), "the refusal quotes: {refusal}");
        assert!(!refusal.contains(TOKEN), "the refusal quotes: {refusal}");
    }

    /// **THE DEFECT OF 17 AUGUST, WALKED END TO END.** Nineteen claimed
    /// accounts of `messagr.eu` refused deactivation, all with the same words:
    /// *the sealed password no longer opens*. Those words name the encryption
    /// key, so the key is what got investigated — its file's mtime, its length
    /// in the container, its identity with the sweep that still worked. The key
    /// had never changed, and never was the cause.
    ///
    /// `cleanup::purge_claimed_secrets_of_expired` had EMPTIED the three secret
    /// columns the moment each invitation expired, and `crypto::open` refuses an
    /// empty blob on its `sealed.len() < 12` guard — the very same `Err` an
    /// undecryptable ciphertext produces, reported behind the very same
    /// sentence. A destroyed secret and a wrong key were indistinguishable from
    /// the outside.
    ///
    /// This test walks the WHOLE chain in one piece and simulates none of it:
    /// secrets sealed with the service's own key exactly as the claim path
    /// seals them, an invitation that expires, the REAL sweep, then the real
    /// named deactivation. The failure is produced, not described.
    ///
    /// WHY NO TEST IN THIS FILE EVER CAUGHT IT: `plant_a_claimed_row` writes an
    /// invitation `status='pending'` with `expires_at=9999999999`, which the
    /// purge's `status='expired'` sub-select can never select. Every other test
    /// here therefore runs against a row that production would have emptied
    /// within the hour — the fixture guaranteed the green.
    #[sqlx::test(migrations = "./migrations")]
    async fn secrets_destroyed_by_the_purge_are_never_reported_as_a_key_failure(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;

        // CONTROL, and it is not decoration: without it this test would still
        // pass on a fixture that had never sealed anything openable, and would
        // then be asserting nothing about the purge.
        assert!(
            crypto::open(&[0u8; 32], &password_of(&pool, CLAIMANT).await).is_ok(),
            "control: while the invitation lives, the sealed password opens"
        );

        // The invitation expires — one hour after issue on every invitation
        // `messagr.eu` has served — and the sweep that runs hourly in
        // production does here exactly what it does there.
        sqlx::query("UPDATE invitations SET status='expired' WHERE id='i1'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            crate::cleanup::purge_claimed_secrets_of_expired(&pool)
                .await
                .unwrap(),
            1,
            "the purge must have emptied this row"
        );
        assert!(
            password_of(&pool, CLAIMANT).await.is_empty(),
            "the column is empty, which is the whole point"
        );

        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
        let st = test_state(pool.clone(), base);
        let refusal = run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("a row the purge emptied cannot be deactivated by this tool");

        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());

        // THE BITE. The column is EMPTY: blaming the sealed password blames a
        // key that is innocent, and that is precisely the sentence that cost
        // two days of production archaeology.
        assert!(
            !refusal.contains("the sealed password no longer opens"),
            "the refusal blames the key for what the purge did: {refusal}"
        );
        // And it must say what really happened, or the next operator reads a
        // refusal that explains nothing and starts the same hunt over.
        assert!(
            refusal.contains("DESTROYED") && refusal.contains("expired"),
            "the refusal must name the destruction and the expiry: {refusal}"
        );
    }

    /// The other arm, inseparable from the one above: a column that is NOT
    /// empty and does not decrypt is a genuine key problem, and must keep
    /// saying so. Without this, the fix above could degenerate into reporting
    /// every failure as a purge and would hide a real key fault.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_ciphertext_that_is_present_and_unreadable_still_names_the_key(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        // Present, non-empty, and openable by no key.
        sqlx::query("UPDATE reserved_accounts SET password_enc=X'0011223344556677889900112233' WHERE user_id=?")
            .bind(CLAIMANT)
            .execute(&pool)
            .await
            .unwrap();

        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
        let st = test_state(pool.clone(), base);
        let refusal = run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("an unreadable ciphertext is a refusal");

        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());
        assert!(
            refusal.contains("the sealed password no longer opens"),
            "a present-but-unreadable ciphertext must still name the key: {refusal}"
        );
    }

    /// A row with no usable token opens a session with its sealed password —
    /// the fallback `cleanup::deactivate_orphans` already holds — and is STILL
    /// checked against the demonstration first. The fallback must not become a
    /// way past refusal 2.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_row_without_a_usable_token_opens_a_session_and_is_still_checked_first(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, false).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[THE_ROOM], &[], &[]))).await;
        let st = test_state(pool.clone(), base);

        run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("the fallback must not be a way past refusal 2");
        let calls = fake.calls();
        assert!(
            calls.contains(&"login:x7qf2k9j".to_string()),
            "for lack of a token, a session must be opened: {calls:?}"
        );
        assert!(!fake.was_deactivated(), "calls: {calls:?}");

        // And a row whose sealed password no longer opens is refused, never
        // assumed: `deactivate` needs password UIA on top of a bearer.
        sqlx::query("UPDATE reserved_accounts SET password_enc=X'00' WHERE user_id=?")
            .bind(CLAIMANT)
            .execute(&pool)
            .await
            .unwrap();
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
        let st = test_state(pool.clone(), base);
        run(&st, &[CLAIMANT.into()], &seed, types_it_back)
            .await
            .expect_err("a sealed password that no longer opens is a refusal");
        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());
    }

    // ── REFUSAL 4 — it says what it will do, and the flag is not enough ──

    /// **THE CONFIRMATION IS THE IDENTIFIER TYPED BACK.** Not `--yes`: a flag
    /// is typed by reflex and sits in a shell history one arrow key from a
    /// command that named a different account. Typing the identifier cannot be
    /// done without reading it, and cannot be carried between runs.
    #[test]
    fn only_the_identifier_typed_back_confirms_and_no_reflex_answer_does() {
        let reflexes = [
            None,
            Some(""),
            Some("y"),
            Some("Y"),
            Some("yes"),
            Some("YES"),
            Some("oui"),
            Some("o"),
            Some("--yes"),
            Some("--force"),
            Some("ok"),
            Some("OK"),
            Some("1"),
            Some("true"),
            Some("\n"),
            Some("@X7QF2K9J:MESSAGR.EU"),
            Some("@x7qf2k9j:messagr.e"),
            Some("x7qf2k9j:messagr.eu"),
            Some("@x7qf2k9j"),
        ];
        for reflex in reflexes {
            assert!(
                !is_the_confirmation(reflex, CLAIMANT),
                "{reflex:?}: wrongly confirmed — a reflex answer must never be \
                 enough to destroy an account handed to somebody"
            );
        }

        // Inseparable control: the identifier itself DOES confirm, surrounding
        // whitespace forgiven — otherwise nothing could ever be confirmed and
        // the loop above would pass for nothing.
        assert!(is_the_confirmation(Some(CLAIMANT), CLAIMANT));
        assert!(is_the_confirmation(
            Some("  @x7qf2k9j:messagr.eu\n"),
            CLAIMANT
        ));
    }

    /// It announces the plan BEFORE anything, and a wrong answer abandons
    /// leaving the account alive, the row claimed, and the secrets intact.
    ///
    /// This is also what makes the command its own read-only census: everything
    /// before the confirmation is a read.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_plan_is_announced_before_anything_and_a_wrong_answer_abandons(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(
            &[ANOTHER_ROOM],
            &[],
            &[],
        )))
        .await;
        let st = test_state(pool.clone(), base);

        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let for_ask = seen.clone();
        run(&st, &[CLAIMANT.into()], &seed, move |plan| {
            *for_ask.lock().unwrap() = plan.to_string();
            Some("y".into())
        })
        .await
        .expect_err("a reflex answer must abandon");

        let plan = seen.lock().unwrap().clone();
        for must_say in [
            CLAIMANT,
            THE_ROOM,
            seed.as_str(),
            "irreversible",
            "leaves every room",
            "localpart",
        ] {
            assert!(
                plan.contains(must_say),
                "the announcement must name {must_say:?} — an operator cannot \
                 consent to what was not said. Read:\n{plan}"
            );
        }
        // It quotes NO secret.
        assert!(!plan.contains("the-living-password"), "plan: {plan}");
        assert!(!plan.contains("the-sealed-token"), "plan: {plan}");

        assert!(!fake.was_deactivated(), "calls: {:?}", fake.calls());
        assert_eq!(status_of(&pool, CLAIMANT).await, "claimed");
        assert!(!password_of(&pool, CLAIMANT).await.is_empty());
    }

    /// The announcement names EVERY room the verdict was computed against, and
    /// says what it cannot see. A room upgrade the extract does not name is not
    /// detected; an operator must be told that, and told the fix.
    #[test]
    fn the_announcement_names_every_room_it_checked_and_says_what_it_cannot_see() {
        const SUCCESSOR: &str = "!successor:messagr.eu";
        let demonstration = TheDemonstration {
            rooms: vec![THE_ROOM.into(), SUCCESSOR.into()],
            root_user_id: THE_ROOT.into(),
            read_from: "/somewhere/demo.json".into(),
        };
        let plan = announce(CLAIMANT, Some(1000), &demonstration, &Standing::OutsideIt);
        assert!(plan.contains(THE_ROOM), "plan: {plan}");
        assert!(
            plan.contains(SUCCESSOR),
            "every room checked must be named: {plan}"
        );
        assert!(
            plan.contains("room_ids"),
            "and the fix for a successor it does not know must be named: {plan}"
        );
    }

    // ── REFUSAL 5 — idempotence ──────────────────────────────────────────

    /// An already deactivated account is a success that CALLS NOTHING and ASKS
    /// NOTHING — there is nothing to announce about an account already dead.
    /// The `ask` below panics if called, which is what makes "asks nothing" an
    /// assertion instead of a hope.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_already_deactivated_account_is_not_an_error_and_asks_nothing(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated', password_enc=X'', \
             password_next_enc=NULL, access_token_enc=X'' WHERE user_id=?",
        )
        .bind(CLAIMANT)
        .execute(&pool)
        .await
        .unwrap();
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(&[], &[], &[]))).await;
        let st = test_state(pool.clone(), base);

        assert_eq!(
            run(&st, &[CLAIMANT.into()], &seed, |_| {
                panic!("an account already dead must not be announced, nor asked about")
            })
            .await
            .unwrap(),
            Outcome::AlreadyDeactivated
        );
        assert!(
            fake.calls().is_empty(),
            "and nothing must be asked of the homeserver: {:?}",
            fake.calls()
        );
    }

    // ── THE INSEPARABLE CONTROL ──────────────────────────────────────────

    /// **WITHOUT THIS TEST every refusal above stays green on a command that
    /// refuses unconditionally** — the easiest way to make this task look
    /// finished while delivering nothing.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_claimed_account_outside_the_demonstration_room_is_deactivated_once_confirmed(
        pool: sqlx::SqlitePool,
    ) {
        plant_a_claimed_row(&pool, CLAIMANT, true).await;
        let (_dir, seed) = plant_a_seed(the_usual_seed());
        let (base, fake) = spawn(FakeHomeserver::serving(sync_with(
            &[ANOTHER_ROOM],
            &[],
            &[],
        )))
        .await;
        let st = test_state(pool.clone(), base);

        assert_eq!(
            run(&st, &[CLAIMANT.into()], &seed, types_it_back)
                .await
                .unwrap(),
            Outcome::Deactivated
        );

        // THE ACCOUNT THE IDENTIFIER NAMES, and no other.
        assert!(
            fake.calls().contains(&"deactivate:x7qf2k9j".to_string()),
            "calls: {:?}",
            fake.calls()
        );
        assert_eq!(status_of(&pool, CLAIMANT).await, "deactivated");
        // The wipe is what puts the row beyond `handlers::claim::return_to_pool`
        // (guard: `status='deactivated' AND length(password_enc) > 0`) and out
        // of `repair_half_deactivated`'s designation filter.
        assert!(password_of(&pool, CLAIMANT).await.is_empty());

        // And a rerun on the row it just made is idempotent.
        assert_eq!(
            run(&st, &[CLAIMANT.into()], &seed, |_| panic!("must not ask"))
                .await
                .unwrap(),
            Outcome::AlreadyDeactivated
        );
    }
}
