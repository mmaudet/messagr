//! Integration tests against the prototype (Task 10).
//!
//! Ignored by default: they require the prototype homeserver (SSH tunnel) and
//! the `messagr-invitations` service running locally. See
//! `.superpowers/sdd/2026-08-05-service-invitation/task-10-brief.md` for the
//! environment variable details.
//!
//! Run with: cargo test --test integration -- --ignored --test-threads=1
//!
//! This file depends on no internal module of the service (it exposes no
//! library, only a binary): the three tests go through the public HTTP API,
//! with one deliberate exception in property 3 — see the comment preceding
//! `rotation_happens_and_the_service_keeps_the_means_to_revoke`.

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::Row;

const SERVICE: &str = "http://127.0.0.1:8090";
const HOMESERVER: &str = "http://127.0.0.1:8008";

// ---------------------------------------------------------------------------
// Helpers mandated by the brief.
// ---------------------------------------------------------------------------

async fn create_invitation(max_uses: u32) -> (String, String) {
    let inviter_token = std::env::var("INVITER_TOKEN")
        .expect("INVITER_TOKEN: token of a test account on the prototype");
    // MANDATORY since the issuance gate: the service reads, with THIS token,
    // the power levels of the room the invitation names, and refuses (403
    // `MESSAGR_NOT_PROMOTED`) an account that could not invite there. The room
    // must therefore be one `INVITER_TOKEN`'s account is joined to — otherwise
    // the refusal is `MESSAGR_ROOM_NOT_VISIBLE` and says so.
    let room_id = std::env::var("INVITER_ROOM_ID")
        .expect("INVITER_ROOM_ID: a room the INVITER_TOKEN account is in and may invite into");
    let r: serde_json::Value = reqwest::Client::new()
        .post(format!("{SERVICE}/invitations"))
        .bearer_auth(inviter_token)
        // MANDATORY: without this header the service rejects with
        // 400 `M_INVALID_PARAM`, and the two tests calling this helper would
        // fail at the first `unwrap` on a body carrying no token — a failure
        // that would not point at its cause.
        //
        // A FRESH key on every helper call, because each call IS a distinct
        // intent: both tests each want their own pool, and a shared key would
        // make the second one be handed back the first's pool, whose single
        // use is already consumed. What it protects remains secured — an HTTP
        // stack retry replays the SAME request, hence the same key, and the
        // service hands back the already-created pool instead of reserving a
        // second one on the prototype homeserver, where localparts are never
        // released.
        .header("Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .json(&serde_json::json!({
            "max_uses": max_uses, "ttl_seconds": 3600, "room_id": room_id
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    (
        r["token"].as_str().unwrap().to_string(),
        r["invitation_id"].as_str().unwrap().to_string(),
    )
}

async fn claim(token: &str) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{SERVICE}/invitations/claim"))
        .json(&serde_json::json!({"token": token}))
        .send()
        .await
        .unwrap()
}

// ---------------------------------------------------------------------------
// Helpers specific to property 3.
//
// The API NEVER reveals a reserved account's sealed password in clear text:
// this test therefore reads `password_enc` directly from the database and
// decrypts it with `ENCRYPTION_KEY` — the same environment variable as the
// one given to the service under test — to verify that the `claimed` row
// indeed keeps the ROTATED password, the very one that was handed back to
// the client, without which §8.2's destructive revocation would be
// impossible.
//
// Same format as `service/src/crypto.rs::seal`: 12-byte nonce then
// ChaCha20-Poly1305 ciphertext without AAD. Duplicated here on purpose — the
// service exposes no library to import.
// ---------------------------------------------------------------------------

fn encryption_key() -> [u8; 32] {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let b64 = std::env::var("ENCRYPTION_KEY")
        .expect("ENCRYPTION_KEY: same key as the one given to the service under test");
    STANDARD
        .decode(b64)
        .expect("ENCRYPTION_KEY must be valid base64")
        .try_into()
        .expect("ENCRYPTION_KEY must be 32 bytes once decoded")
}

fn decrypt(key: &[u8; 32], sealed: &[u8]) -> String {
    use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, KeyInit, Nonce};
    assert!(sealed.len() >= 12, "truncated sealed data");
    let (nonce, ct) = sealed.split_at(12);
    let cipher = ChaCha20Poly1305::new(key.into());
    let clear = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .expect("decryption of the initial secret (wrong ENCRYPTION_KEY?)");
    String::from_utf8(clear).expect("the decrypted secret must be UTF-8")
}

async fn db_pool() -> SqlitePool {
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL: same database as the service under test's");
    SqlitePoolOptions::new()
        .connect(&url)
        .await
        .expect("connection to the service under test's database")
}

async fn login_status(localpart: &str, password: &str) -> reqwest::StatusCode {
    reqwest::Client::new()
        .post(format!("{HOMESERVER}/_matrix/client/v3/login"))
        .json(&serde_json::json!({
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": localpart},
            "password": password}))
        .send()
        .await
        .unwrap()
        .status()
}

// ---------------------------------------------------------------------------
// The three property tests.
// ---------------------------------------------------------------------------

/// Property 1 — no use is consumed when the token fails.
///
/// A completely unknown token must be refused outright (404), never degraded
/// towards another behaviour. If the service degraded — for example by
/// returning 200 on a bogus token, or masking the failure behind a 500 — the
/// status assertion would fail directly. The token is replayed a second time
/// to verify that no residual state from the first failed attempt changes the
/// response (no trace created that would "consume" anything on a token that
/// matches nothing).
#[tokio::test]
#[ignore]
async fn no_use_consumed_when_the_token_is_invalid() {
    let c = reqwest::Client::new();
    let r = c
        .post(format!("{SERVICE}/invitations/claim"))
        .json(&serde_json::json!({"token": "TOKENTHATDOESNOTEXISTATALL12345678"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404, "an unknown token is refused, not degraded");
    let body: serde_json::Value = r.json().await.unwrap();
    assert_eq!(body["errcode"], "M_NOT_FOUND");

    let r2 = c
        .post(format!("{SERVICE}/invitations/claim"))
        .json(&serde_json::json!({"token": "TOKENTHATDOESNOTEXISTATALL12345678"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r2.status(),
        404,
        "a second attempt on the same bogus token fails identically"
    );
}

/// Property 2 — claiming is idempotent on retry.
///
/// A single-use token already consumed must be refused, never serve a second
/// account: this is the scenario of a client retrying after a network outage.
/// If the retry succeeded a second time, `b` would get 200 (with a new or
/// identical `user_id`, it does not matter: a second success alone already
/// violates the property) instead of 410, and the assertion on `b.status()`
/// would fail.
#[tokio::test]
#[ignore]
async fn claiming_is_idempotent_on_retry() {
    let (token, _id) = create_invitation(1).await;
    let a = claim(&token).await;
    assert_eq!(a.status(), 200);
    let first: serde_json::Value = a.json().await.unwrap();

    let b = claim(&token).await;
    assert_eq!(b.status(), 410, "uses exhausted");
    assert!(first["user_id"].is_string());
    let second: serde_json::Value = b.json().await.unwrap();
    assert_eq!(
        second["errcode"], "MESSAGR_USES_EXHAUSTED",
        "the retry must never serve a second account"
    );
}

/// Property 3 — rotation happens at hand-out, and the service KEEPS the
/// means to revoke (PRD §8.2).
///
/// This property changed meaning with lot 0, task 0.2, and the change is
/// deliberate. The reservation model erased every secret at hand-out so the
/// service lost all access; PRD §8.2 makes revocation DESTRUCTIVE for an
/// entered-but-unpromoted account (promotion does not exist yet — every
/// claimed account qualifies), which is only possible if the service retains
/// the means: the ROTATED password and the access token, sealed in the
/// `claimed` row. What must NOT survive is the PRE-rotation password on the
/// homeserver — the rotation itself is unchanged.
///
/// The flow: (1) claim — the account is created AT CLAIM TIME now, so
/// nothing readable exists beforehand; (2) the new password returned to the
/// client opens a session — a real hand-out, not a lock-up; (3) the sealed
/// password in the base decrypts to EXACTLY that same rotated password, and
/// the sealed access token is still there — the proof that a later `DELETE
/// /invitations/:id` can delete this account from the homeserver.
#[tokio::test]
#[ignore]
async fn rotation_happens_and_the_service_keeps_the_means_to_revoke() {
    let (token, invitation_id) = create_invitation(1).await;

    let r: serde_json::Value = claim(&token).await.json().await.unwrap();
    let user_id = r["user_id"].as_str().unwrap().to_string();
    let new_password = r["password"].as_str().unwrap().to_string();
    let localpart = user_id
        .trim_start_matches('@')
        .split(':')
        .next()
        .unwrap()
        .to_string();

    // A real hand-out, not a lock-up: the NEW secret handed to the client
    // opens a session.
    assert_eq!(
        login_status(&localpart, &new_password).await,
        200,
        "the new password handed to the client must open a session"
    );

    // The `claimed` row KEEPS the means of destructive revocation: the
    // rotated password (identical to the one handed back to the client) and
    // the access token, sealed under the same service key as before.
    let pool = db_pool().await;
    let after = sqlx::query(
        "SELECT password_enc, access_token_enc, status FROM reserved_accounts \
         WHERE invitation_id = ? AND user_id = ?",
    )
    .bind(&invitation_id)
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .expect("the handed-out account's row must exist");
    assert_eq!(after.get::<String, _>("status"), "claimed");
    assert_eq!(
        decrypt(&encryption_key(), &after.get::<Vec<u8>, _>("password_enc")),
        new_password,
        "the service must keep the ROTATED password, sealed: this is what \
         makes destructive revocation (§8.2) possible"
    );
    assert!(
        !after.get::<Vec<u8>, _>("access_token_enc").is_empty(),
        "and the access token, indispensable for deactivation"
    );
}
