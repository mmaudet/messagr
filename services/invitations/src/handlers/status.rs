use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Serialize;
use sqlx::Row;

use crate::{auth, error::AppError, util::now, AppState};

#[derive(Serialize)]
pub struct InvitationStatus {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrant_user_id: Option<String>,
}

/// GET /invitations/:id — the arrival notice's read path (spec §4.2).
///
/// The 409 of `claim` cannot hand the entrant's `user_id` back to the
/// INVITER (by construction, it distinguishes nothing), and reading the
/// sqlite base is the benches' documented stopgap, not an API. This read is
/// how the inviter's client learns that someone entered, and who — PRD
/// §8.2: the arrival is announced to the inviter, immediately. It also
/// names the DRAWN entrant (`entrant_user_id`) while the claim is still
/// waiting on the inviter's Matrix invite: the account is drawn at the
/// first claim, and without this field the inviter had no API way to
/// learn who to invite.
///
/// READ-ONLY, and it stays so: no push, no websocket, no message in any
/// room (spec §4.4). The response never carries a secret — the sealed
/// blobs leave the base only for the claim hand-out and for revoke, and
/// this handler touches neither.
pub async fn status(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<InvitationStatus>, AppError> {
    let caller = auth::authenticate(&st.mx, &headers).await?;
    let row =
        sqlx::query("SELECT inviter_user_id, status, expires_at FROM invitations WHERE id = ?")
            .bind(&id)
            .fetch_optional(&st.pool)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(AppError::InvitationInvalid)?;
    if row.get::<String, _>("inviter_user_id") != caller {
        return Err(AppError::InvitationInvalid); // do not reveal the existence
    }
    let invitation_status: String = row.get("status");
    let expires_at: i64 = row.get("expires_at");

    // The expiry sweep (`cleanup::expire_invitations`) runs hourly; between
    // the deadline and the sweep the row still reads `pending` while `claim`
    // already refuses as expired (`invitation_usable`: `pending` with
    // `expires_at <= now` IS expired). The clock decides here too — same
    // rule, same helper — so the two endpoints cannot contradict each other
    // for up to an hour.
    let effective_status = if invitation_status == "pending" && expires_at <= now() {
        "expired".to_string()
    } else {
        invitation_status
    };

    // `claimed` is not an invitation state: the invitation stays `pending`
    // until it expires or is revoked. The arrival is a PROPERTY OF THE
    // POOL — a `claimed` row in reserved_accounts. The earliest claim is
    // reported: the first arrival is the one the inviter must never miss
    // (screen 10 announces per person). On a terminal status the mapping
    // below would discard the lookup, so it is skipped outright.
    let claimed = if effective_status == "pending" {
        sqlx::query(
            "SELECT user_id, claimed_at FROM reserved_accounts \
             WHERE invitation_id = ? AND status = 'claimed' \
             ORDER BY claimed_at ASC LIMIT 1",
        )
        .bind(&id)
        .fetch_optional(&st.pool)
        .await
        .map_err(anyhow::Error::from)?
    } else {
        None
    };

    // The entrant's account is drawn at the FIRST claim (a `reserved`
    // row), but the 409 wait contract cannot hand it back to the
    // INVITER, and reading the sqlite base is the benches' stopgap, not
    // an API. This lookup is how the inviter's client learns who to
    // invite on the homeserver. `reserved` ONLY: a `claiming` row is a
    // registration still in flight on the homeserver — the account is
    // not invitable yet, and its `user_id` is still the bare localpart,
    // not an invitable MXID. The row turns `reserved`, with the
    // completed MXID, when the registration completes; the polling
    // cadence picks it up then. The selection is otherwise
    // `account_for_claim`'s own (`ORDER BY rowid LIMIT 1`): the named
    // entrant is the account the next claim would hand out. Same skip
    // as the claimed lookup on terminal statuses — a leftover reserved
    // row must not resurrect an expired invitation. A `user_id` is an
    // identifier, not a secret.
    // AN EXISTING ACCOUNT WAITING TO BE INVITED OUTRANKS A DRAWN ONE, and the
    // order is not a preference: it is the difference between a gesture that
    // completes and one that cannot.
    //
    // A reserved account is named here so the inviter's client invites it and
    // the newcomer can then claim it. An existing account is named here for
    // the same reason and a stronger one: it has ALREADY claimed, and its
    // claim is blocked on exactly this invite (`claim.rs`'s `hand_over_place`,
    // which records the row). Naming the drawn account first would leave that
    // claim waiting behind a person who has not arrived and may never.
    //
    // The row disappears when the claim completes, so this preference lasts
    // exactly as long as the wait it exists for.
    let entrant_user_id: Option<String> = if effective_status == "pending" {
        let waiting: Option<String> = sqlx::query(
            "SELECT user_id FROM pending_existing_invites \
             WHERE invitation_id = ? ORDER BY requested_at ASC, user_id ASC LIMIT 1",
        )
        .bind(&id)
        .fetch_optional(&st.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(|r| r.get("user_id"));
        match waiting {
            Some(user_id) => Some(user_id),
            None => sqlx::query(
                "SELECT user_id FROM reserved_accounts \
                 WHERE invitation_id = ? AND status = 'reserved' \
                 ORDER BY rowid LIMIT 1",
            )
            .bind(&id)
            .fetch_optional(&st.pool)
            .await
            .map_err(anyhow::Error::from)?
            .map(|r| r.get("user_id")),
        }
    } else {
        None
    };

    // Only a still-pending invitation can be "claimed" here — `claimed` is
    // None on any other effective status. Past expiry the destructive
    // revocation has lapsed with the purged secrets (PR #8), and the answer
    // must stay `expired` — reviving `claimed` would promise a gesture the
    // service can no longer honour. `claimed_at` is decoded defensively:
    // the column is nullable, and a NULL must not panic the read — the
    // arrival is still reported, the key simply stays absent.
    let (status, claimed_user_id, claimed_at) = match claimed {
        Some(c) => (
            "claimed".to_string(),
            Some(c.get::<String, _>("user_id")),
            c.try_get::<Option<i64>, _>("claimed_at")
                .map_err(anyhow::Error::from)?,
        ),
        None => (effective_status, None, None),
    };
    Ok(Json(InvitationStatus {
        status,
        claimed_user_id,
        claimed_at,
        entrant_user_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Path, State},
        http::HeaderMap,
        Json,
    };
    use serde_json::json;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    /// A fake homeserver reduced to `whoami`: it knows no user, it simply
    /// trusts the bearer like `revoke`'s FakeHs does — Bearer alice becomes
    /// @alice:h. The refusal path needs nothing: `extract_bearer` fails
    /// before any HTTP call.
    async fn whoami_hs() -> String {
        async fn whoami(headers: HeaderMap) -> Json<serde_json::Value> {
            let bearer = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("unknown");
            Json(json!({"user_id": format!("@{bearer}:h")}))
        }
        let app = axum::Router::new().route(
            "/_matrix/client/v3/account/whoami",
            axum::routing::get(whoami),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    fn state(pool: SqlitePool, hs_base: String) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                hs_base.clone(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: hs_base,
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        })
    }

    async fn seed_invitation(pool: &SqlitePool, id: &str, inviter: &str, status: &str) {
        // A distinct hash per id: token_sha256 is UNIQUE, and one test seeds
        // two invitations in the same base.
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES (?,?,?,0,4000000000,1,0,?)",
        )
        .bind(id)
        .bind(inviter)
        .bind(crate::crypto::token_hash(id))
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Same seed with an explicit deadline, for the tests whose invitation
    /// must already be past `expires_at` while the hourly sweep has not run.
    async fn seed_invitation_expiring_at(
        pool: &SqlitePool,
        id: &str,
        inviter: &str,
        status: &str,
        expires_at: i64,
    ) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES (?,?,?,0,?,1,0,?)",
        )
        .bind(id)
        .bind(inviter)
        .bind(crate::crypto::token_hash(id))
        .bind(expires_at)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn status_as(
        st: &Arc<AppState>,
        caller: Option<&str>,
        id: &str,
    ) -> Result<Json<InvitationStatus>, AppError> {
        let mut headers = HeaderMap::new();
        if let Some(c) = caller {
            headers.insert("authorization", format!("Bearer {c}").parse().unwrap());
        }
        status(State(st.clone()), headers, Path(id.to_string())).await
    }

    async fn seed_claimed_row(
        pool: &SqlitePool,
        invitation_id: &str,
        user_id: &str,
        claimed_at: i64,
    ) {
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at, claimed_at) \
             VALUES (?,?,X'AA',X'BB','claimed',0,?)",
        )
        .bind(user_id)
        .bind(invitation_id)
        .bind(claimed_at)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Same claimed row with `claimed_at` left NULL: the schema allows it,
    /// and the read must not panic on it.
    async fn seed_claimed_row_without_claimed_at(
        pool: &SqlitePool,
        invitation_id: &str,
        user_id: &str,
    ) {
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at, claimed_at) \
             VALUES (?,?,X'AA',X'BB','claimed',0,NULL)",
        )
        .bind(user_id)
        .bind(invitation_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// A drawn-but-not-handed-out account: the row `claim` writes at the
    /// FIRST claim, before the inviter's Matrix invite exists. `status` is
    /// `reserved` once the registration completed, `claiming` while it is
    /// still in flight.
    async fn seed_entrant_row(pool: &SqlitePool, invitation_id: &str, user_id: &str, status: &str) {
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) \
             VALUES (?,?,X'AA',X'BB',?,0)",
        )
        .bind(user_id)
        .bind(invitation_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    /// **The nominal read: the inviter reads `pending`, and nothing more.**
    ///
    /// The `claimed_*` keys must be ABSENT from the body — not null, absent:
    /// a client that sees the key but not the value would have a third state
    /// to guess at.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_inviter_reads_a_pending_status_and_nothing_more(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1")
            .await
            .expect("the inviter must read their invitation's status");
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v, json!({"status": "pending"}));
    }

    /// Terminal states pass through VERBATIM: the inviter's client must be
    /// able to stop polling on `expired` and `revoked` (spec §4.3), so the
    /// endpoint must say them as they are.
    #[sqlx::test(migrations = "./migrations")]
    async fn expired_and_revoked_pass_through_verbatim(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "expired").await;
        seed_invitation(&pool, "inv2", "@alice:h", "revoked").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "expired"})
        );
        let Json(body) = status_as(&st, Some("alice"), "inv2").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "revoked"})
        );
    }

    /// An unknown invitation answers the silent 404.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_unknown_invitation_is_a_silent_404(pool: SqlitePool) {
        let st = state(pool, whoami_hs().await);
        let r = status_as(&st, Some("alice"), "nope").await;
        assert!(
            matches!(r, Err(AppError::InvitationInvalid)),
            "unknown id must fall into the silent response"
        );
    }

    /// **Someone else's invitation is indistinguishable from an unknown one.**
    ///
    /// Same `InvitationInvalid` as the unknown id — the endpoint must not
    /// become an oracle telling Mallory that inv1 exists and belongs to
    /// Alice. The comment on `revoke` says it: "do not reveal the existence".
    #[sqlx::test(migrations = "./migrations")]
    async fn another_inviter_gets_the_same_silent_404(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        let st = state(pool, whoami_hs().await);
        let r = status_as(&st, Some("mallory"), "inv1").await;
        assert!(
            matches!(r, Err(AppError::InvitationInvalid)),
            "another inviter must get exactly the unknown-id response"
        );
    }

    /// No bearer at all: 401, like create and revoke.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_unauthenticated_caller_gets_401(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        let st = state(pool, whoami_hs().await);
        let r = status_as(&st, None, "inv1").await;
        assert!(matches!(r, Err(AppError::Unauthenticated)));
    }

    /// **The arrival notice itself: `claimed`, with who and when.**
    ///
    /// PRD §8.2 — the inviter is told immediately. The `user_id` is the
    /// only thing the 409 of `claim` could never give them.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_claimed_invitation_says_who_and_when(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_claimed_row(&pool, "inv1", "@lea:h", 1754772000).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "claimed", "claimed_user_id": "@lea:h", "claimed_at": 1754772000})
        );
    }

    /// A multi-use invitation may have several entrants: the EARLIEST claim
    /// is reported. The notice is per-person anyway (screen 10); the first
    /// arrival is the one that must never be missed.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_earliest_claimant_is_reported(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_claimed_row(&pool, "inv1", "@second:h", 1754772100).await;
        seed_claimed_row(&pool, "inv1", "@first:h", 1754772000).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["claimed_user_id"], json!("@first:h"));
        assert_eq!(v["claimed_at"], json!(1754772000));
    }

    /// **The TTL bound (PR #8) shows here too**: once the invitation has
    /// expired, the endpoint says `expired` — even if someone had entered
    /// before the deadline. The destructive revocation has lapsed with the
    /// secrets, and the inviter's client stops polling; reviving `claimed`
    /// past expiry would promise a gesture the service can no longer honour.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_expired_invitation_stays_expired_even_once_claimed(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "expired").await;
        seed_claimed_row(&pool, "inv1", "@lea:h", 1754772000).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "expired"})
        );
    }

    /// **The clock decides before the sweep does.**
    ///
    /// `cleanup::expire_invitations` runs hourly; between the deadline and
    /// the sweep the row still reads `pending`, but `claim` already refuses
    /// as expired (`invitation_usable`: `pending` with `expires_at <= now`
    /// IS expired). This endpoint must agree — answering `pending` here
    /// would contradict the refusal for up to an hour.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_pending_invitation_past_its_deadline_reads_expired(pool: SqlitePool) {
        seed_invitation_expiring_at(&pool, "inv1", "@alice:h", "pending", 1).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "expired"})
        );
    }

    /// A claim landed before the deadline does NOT promote an invitation
    /// whose date has since passed, sweep run or not: the row still says
    /// `pending`, yet the answer must be `expired` — the destructive
    /// revocation has lapsed with the secrets, and `claim` refuses too.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_claim_does_not_promote_an_invitation_past_its_deadline(pool: SqlitePool) {
        seed_invitation_expiring_at(&pool, "inv1", "@alice:h", "pending", 1).await;
        seed_claimed_row(&pool, "inv1", "@lea:h", 1754772000).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "expired"})
        );
    }

    /// `claimed_at` is nullable in the schema; a NULL must not panic the
    /// read nor hide the arrival — `claimed` and `claimed_user_id` are
    /// still reported, and the `claimed_at` key stays absent (not null).
    #[sqlx::test(migrations = "./migrations")]
    async fn a_null_claimed_at_still_reports_the_arrival(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_claimed_row_without_claimed_at(&pool, "inv1", "@lea:h").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "claimed", "claimed_user_id": "@lea:h"})
        );
    }

    /// **The drawn entrant is named before the claim completes.**
    ///
    /// Since lot 0.2 the entrant's account is drawn at the FIRST claim,
    /// which answers 409 (the inviter's Matrix invite is still missing).
    /// The inviter's client must learn WHO to invite without reading the
    /// sqlite base: a `reserved` row surfaces as `entrant_user_id`, and the
    /// invitation's own status stays `pending` — nothing has been claimed
    /// yet.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_reserved_entrant_is_named_before_the_claim(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_entrant_row(&pool, "inv1", "@lea:h", "reserved").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "pending", "entrant_user_id": "@lea:h"})
        );
    }

    /// A `claiming` row names NO entrant: the registration is still in
    /// flight on the homeserver, so the account is not invitable yet —
    /// and its `user_id` is still the bare localpart, which is not an
    /// invitable MXID anyway. The row turns `reserved`, with the
    /// completed MXID, when the registration completes; the polling
    /// cadence picks it up then.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_claiming_row_names_no_entrant_yet(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_entrant_row(&pool, "inv1", "lea", "claiming").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "pending"}),
            "a mid-registration row surfaces no entrant: not invitable, not an MXID"
        );
    }

    /// Several drawn rows (a multi-use invitation, or a loser's leftover):
    /// the one named is the one the NEXT claim would hand out — the same
    /// `ORDER BY rowid LIMIT 1` as `account_for_claim`. Naming another row
    /// would have the inviter invite an account the entrant will never get.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_entrant_named_is_the_one_the_next_claim_would_draw(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_entrant_row(&pool, "inv1", "@first:h", "reserved").await;
        seed_entrant_row(&pool, "inv1", "@second:h", "reserved").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["entrant_user_id"], json!("@first:h"));
    }

    /// A claimed-only pool names no entrant: once the drawn account has
    /// been handed out, there is nobody left to invite, and the key must be
    /// ABSENT — not null. The arrival notice itself is unchanged.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_claimed_only_pool_names_no_entrant(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_claimed_row(&pool, "inv1", "@lea:h", 1754772000).await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(
            v,
            json!({"status": "claimed", "claimed_user_id": "@lea:h", "claimed_at": 1754772000}),
            "no entrant key on a claimed-only pool"
        );
    }

    /// A leftover reserved row must not resurrect on a terminal status:
    /// like the claimed lookup, the entrant lookup is skipped once the
    /// invitation is expired or revoked.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_terminal_status_skips_the_entrant_lookup(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "expired").await;
        seed_entrant_row(&pool, "inv1", "@lea:h", "reserved").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({"status": "expired"})
        );
    }

    /// **No secret ever leaves through this response.**
    ///
    /// Sealed blobs sit on the row (`X'AA'`, `X'BB'` above, standing for
    /// the real sealed values). The property is checked on the WHOLE body:
    /// exactly the expected keys, and neither the blobs nor anything
    /// beyond `user_id`/`claimed_at` from the row.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_response_never_carries_a_secret(pool: SqlitePool) {
        seed_invitation(&pool, "inv1", "@alice:h", "pending").await;
        seed_claimed_row(&pool, "inv1", "@lea:h", 1754772000).await;
        seed_entrant_row(&pool, "inv1", "@sam:h", "reserved").await;
        let st = state(pool, whoami_hs().await);

        let Json(body) = status_as(&st, Some("alice"), "inv1").await.unwrap();
        let v = serde_json::to_value(&body).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        for k in &keys {
            assert!(
                ["status", "claimed_user_id", "claimed_at", "entrant_user_id"].contains(k),
                "unexpected key in the response: {k}"
            );
        }
        let rendered = v.to_string();
        assert!(
            !rendered.contains("AA") && !rendered.contains("BB") && !rendered.contains("enc"),
            "nothing sealed may leak: {rendered}"
        );
    }
}
