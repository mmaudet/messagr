use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Serialize;
use sqlx::Row;

use crate::{
    auth, crypto,
    error::AppError,
    util::{localpart, now},
    AppState,
};

#[derive(Serialize)]
pub struct RevokeResponse {
    pub revoked: bool,
    pub deactivated_accounts: u32,
}

pub fn may_revoke(inviter: &str, caller: &str) -> bool {
    inviter == caller
}

/// Tries the candidate password, then the previous one.
///
/// A claim interrupted after the rotation succeeded leaves the account
/// with the CANDIDATE as its live password, not `password_enc`. Trying only
/// the previous one would make the neutralisation fail precisely on the most
/// fragile accounts — those whose claim was interrupted — and a localpart is
/// never released by the homeserver.
///
/// Defined here and reused by cleanup (task 9), which has the same need.
pub async fn deactivate_with_either(
    st: &AppState,
    token: &str,
    localpart: &str,
    candidate: Option<String>,
    previous: &str,
) -> bool {
    if let Some(next) = candidate {
        if st.mx.deactivate(token, localpart, &next).await.is_ok() {
            return true;
        }
    }
    st.mx.deactivate(token, localpart, previous).await.is_ok()
}

pub async fn revoke(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<RevokeResponse>, AppError> {
    let caller = auth::authenticate(&st.mx, &headers).await?;
    let row = sqlx::query("SELECT inviter_user_id FROM invitations WHERE id = ?")
        .bind(&id)
        .fetch_optional(&st.pool)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(AppError::InvitationInvalid)?;
    if !may_revoke(row.get::<String, _>("inviter_user_id").as_str(), &caller) {
        return Err(AppError::InvitationInvalid); // do not reveal the existence
    }

    // PRD §8.2: revocation is DESTRUCTIVE for the accounts this invitation
    // created. That covers every status a created account can be in:
    //
    // - `reserved` — created at claim time, never handed out (leftover of an
    //   interrupted claim, or created by the losing side of a race);
    // - `claiming` — trace written before `register_dormant`, account maybe
    //   real; it carries the password but possibly no access token, hence the
    //   login fallback below (same one as `cleanup::deactivate_orphans`);
    // - `claimed` — handed out, therefore ENTERED. Promotion does not exist
    //   yet in the product, so every claimed account is unpromoted BY
    //   CONSTRUCTION, and §8.2's destructive criterion is met for all of
    //   them. The row still holds the rotated password and the access token,
    //   sealed — kept at claim time precisely so this deletion is possible.
    //   WITH ONE BOUND, since 9 August 2026: an EXPIRED invitation sees its
    //   claimed rows' secrets destroyed by
    //   `cleanup::purge_claimed_secrets_of_expired`. Such a row is excluded
    //   below by the `length(password_enc) > 0` clause — its account is
    //   alive and out of the service's reach, and stamping it `deactivated`
    //   would write a lie the traceability cannot afford.
    //
    // `deactivated` rows are excluded: their accounts are already dead (the
    // place-cession of an existing-user claim self-destructs), there is
    // nothing left to delete.
    let accounts = sqlx::query(
        "SELECT user_id FROM reserved_accounts \
         WHERE invitation_id = ? AND (status IN ('reserved','claiming') \
           OR (status = 'claimed' AND length(password_enc) > 0))",
    )
    .bind(&id)
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    let mut n = 0u32;
    for c in &accounts {
        let user_id: String = c.get("user_id");

        // LOCK AND FRESH READ IN A SINGLE ATOMIC STATEMENT.
        //
        // The lock must precede the irreversible action: between the SELECT
        // and here, a concurrent claim may have handed this account out to a
        // real user, and the candidate-then-previous double attempt would
        // succeed in killing it, the candidate being precisely the claimant's
        // password.
        //
        // And the `RETURNING` is what closes the race: without it we would act
        // on the SELECT's snapshot, and a candidate written meanwhile by a
        // claim would be ignored — we would then fail to deactivate an account
        // that is nevertheless alive, whose password nobody would know
        // anymore.
        let taken = sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated' \
             WHERE user_id = ? AND (status IN ('reserved','claiming') \
               OR (status = 'claimed' AND length(password_enc) > 0)) \
             RETURNING password_enc, password_next_enc, access_token_enc",
        )
        .bind(&user_id)
        .fetch_optional(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
        let Some(fresh) = taken else { continue }; // taken by someone else meanwhile

        let localpart = localpart(&user_id);
        // `.ok()` and not `?`, as in `cleanup::deactivate_orphans`: a secret
        // that has become undecryptable is useless, and giving up here would
        // leave the row stuck with its secrets forever. The unconditional
        // wipe further down terminates the row in every case.
        let pw = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("password_enc").as_slice(),
        )
        .ok();
        let candidate = fresh
            .get::<Option<Vec<u8>>, _>("password_next_enc")
            .and_then(|b| crypto::open(&st.cfg.encryption_key, &b).ok());
        let tk = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("access_token_enc").as_slice(),
        )
        .ok();
        // A `claiming` row carries the password — written before the
        // registration — but possibly NO access token: only the homeserver
        // could issue one, and the interrupted claim never got that far. Open
        // a session with the traced password, exactly as cleanup does. Its
        // failure is expected in the benign half of cases (the account never
        // existed): nothing to neutralise, the row terminates below anyway.
        let tk = match tk {
            Some(t) => Some(t),
            None => match pw.as_deref() {
                Some(password) => st.mx.login(&localpart, password).await.ok(),
                None => None,
            },
        };
        if let (Some(pw), Some(tk)) = (pw, tk) {
            if deactivate_with_either(&st, &tk, &localpart, candidate, &pw).await {
                n += 1;
            }
        }

        // The secrets are wiped only AFTER: wiping them earlier would deprive
        // us of the means to deactivate. UNCONDITIONAL wipe: it is what
        // guarantees the row terminates, even if nothing could be decrypted.
        // `password_next_enc` is wiped too — leaving it would keep a
        // neutralised account's secret in the database.
        sqlx::query(
            "UPDATE reserved_accounts SET password_enc=X'', \
                     password_next_enc=NULL, access_token_enc=X'' WHERE user_id=?",
        )
        .bind(&user_id)
        .execute(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    }

    sqlx::query("UPDATE invitations SET status='revoked', revoked_at=? WHERE id=?")
        .bind(now())
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(RevokeResponse {
        revoked: true,
        deactivated_accounts: n,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_inviter_may_revoke() {
        assert!(may_revoke("@alice:h", "@alice:h"));
        assert!(!may_revoke("@alice:h", "@bob:h"));
    }

    /// A closed port does not distinguish "one password tried" from "two
    /// tried": a connection refused looks like any other whatever the number
    /// of attempts. Here, a real TCP server accepts each connection, counts
    /// it, answers 401 (refused, like a wrong password) then closes with
    /// `Connection: close` to prevent reqwest from reusing the socket —
    /// without which a second attempt might never reopen a connection and
    /// would skew the count. With a candidate, the fallback must try the
    /// candidate THEN the previous one after its refusal: two connections.
    /// Without a candidate, only one. This test fails on the code from before
    /// task 8's fix, which only ever tried `password_enc` — that is the only
    /// criterion that matters here.
    #[tokio::test]
    async fn candidate_yields_two_attempts_otherwise_a_single_one() {
        assert_eq!(
            count_attempts(Some("candidate")).await,
            2,
            "a candidate must be tried, then the previous one after its refusal"
        );
        assert_eq!(
            count_attempts(None).await,
            1,
            "without a candidate, only the previous one must be tried"
        );
    }

    async fn count_attempts(candidate: Option<&str>) -> usize {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let counter = std::sync::Arc::new(AtomicUsize::new(0));
        let for_the_task = counter.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                for_the_task.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(respond_401(stream));
            }
        });

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mx = std::sync::Arc::new(crate::matrix::MatrixClient::new(
            format!("http://127.0.0.1:{port}"),
            String::new(),
        ));
        let cfg = crate::config::Config {
            database_url: String::new(),
            homeserver_url: String::new(),
            registration_token: String::new(),
            encryption_key: [0u8; 32],
            edge_retention_days: 30,
            bind_addr: String::new(),
            max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
        };
        let st = AppState { pool, mx, cfg };

        deactivate_with_either(
            &st,
            "faketoken",
            "localpart",
            candidate.map(str::to_string),
            "previous",
        )
        .await;
        counter.load(Ordering::SeqCst)
    }

    /// Reads what comes in (a small JSON request, received in a single packet
    /// on the loopback) then answers 401 and closes — enough for reqwest to
    /// get a usable status without us needing a real HTTP parser, `deactivate`
    /// never reading the body of a failed response.
    async fn respond_401(mut stream: tokio::net::TcpStream) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 4096];
        let _ = stream.read(&mut buf).await;
        let _ = stream
            .write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
        let _ = stream.shutdown().await;
    }

    /// No mock: a real temporary SQLite database, with the repo's real
    /// migrations, checks that the per-row atomic take really excludes a
    /// second take. This is exactly the defect fixed here — without this
    /// guard, a concurrent claim and a revocation could both succeed on the
    /// same row, leaving `status='deactivated'` with a filled-in `claimed_at`:
    /// a contradictory state, with no repair path.
    #[tokio::test]
    async fn the_per_row_lock_excludes_a_second_take() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}/lock.db?mode=rwc", dir.path().display());
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(&url)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('inv1','@alice:h',X'00',0,1000000000,1,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) \
             VALUES ('@x:h','inv1',X'00',X'00','reserved',0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // The revoke take: the exact UPDATE used in the loop.
        let first = sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated' \
             WHERE user_id = ? AND status = 'reserved'",
        )
        .bind("@x:h")
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(first.rows_affected(), 1, "the first take must succeed");

        // A concurrent claim arriving now (same guard as claim.rs:
        // `AND status='reserved'`) must no longer affect anything — the row
        // is already taken, it must never become 'claimed' again.
        let second = sqlx::query(
            "UPDATE reserved_accounts SET status='claimed' \
             WHERE user_id = ? AND status = 'reserved'",
        )
        .bind("@x:h")
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            second.rows_affected(),
            0,
            "a second take on the same row must never succeed"
        );
    }

    /// Addition outside the requested scope, reported as such in the report:
    /// none of the required tests executes the critical fix's `RETURNING` SQL
    /// — the fallback test above does not touch the database, and the
    /// existing lock test deliberately copies the OLD text without RETURNING
    /// (it was not to be touched). Without this, a RETURNING syntax error
    /// against THIS version of SQLite would have remained invisible until a
    /// real call.
    #[tokio::test]
    async fn returning_yields_the_fresh_secrets_then_nothing_anymore() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}/returning.db?mode=rwc", dir.path().display());
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(&url)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('inv1','@alice:h',X'00',0,1000000000,1,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             password_next_enc, access_token_enc, status, created_at) \
             VALUES ('@x:h','inv1',X'AA',X'BB',X'CC','reserved',0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // The exact take text in `revoke`: lock + fresh read in a single
        // atomic statement.
        let fresh = sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated' \
             WHERE user_id = ? AND status = 'reserved' \
             RETURNING password_enc, password_next_enc, access_token_enc",
        )
        .bind("@x:h")
        .fetch_optional(&pool)
        .await
        .unwrap()
        .expect("RETURNING must return the row it has just locked");
        assert_eq!(fresh.get::<Vec<u8>, _>("password_enc"), vec![0xAAu8]);
        assert_eq!(
            fresh.get::<Option<Vec<u8>>, _>("password_next_enc"),
            Some(vec![0xBBu8])
        );
        assert_eq!(fresh.get::<Vec<u8>, _>("access_token_enc"), vec![0xCCu8]);

        // Replayed on the same row, already 'deactivated': nothing left to
        // return, exactly what `let Some(fresh) = taken else { continue };`
        // expects.
        let nothing = sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated' \
             WHERE user_id = ? AND status = 'reserved' \
             RETURNING password_enc, password_next_enc, access_token_enc",
        )
        .bind("@x:h")
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(
            nothing.is_none(),
            "a row already locked must return nothing anymore"
        );
    }

    // -----------------------------------------------------------------------
    // Destructive revocation (PRD §8.2): a fake homeserver that RECORDS every
    // deactivation attempt — which account, with which password — and only
    // accepts the live password of an account it knows.
    // -----------------------------------------------------------------------

    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    const KEY: [u8; 32] = [0u8; 32];

    struct FakeHs {
        /// `(localpart, password)` presented to `/account/deactivate`, in order.
        deactivations: Mutex<Vec<(String, String)>>,
        /// `localpart` of every `/v3/login` attempt, in order.
        logins: Mutex<Vec<String>>,
        /// Accounts the fake knows: `(localpart, live_password)`.
        live_accounts: Vec<(String, String)>,
    }

    async fn route_hs(
        State(f): State<Arc<FakeHs>>,
        req: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        let path = req.uri().path().to_string();
        let bearer = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("unknown")
            .to_string();
        let raw = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let body: serde_json::Value = serde_json::from_slice(&raw).unwrap_or(json!({}));

        if path.ends_with("/account/whoami") {
            return Json(json!({"user_id": format!("@{bearer}:h")})).into_response();
        }
        if path.ends_with("/v3/login") {
            let u = body["identifier"]["user"]
                .as_str()
                .unwrap_or("?")
                .to_string();
            let pw = body["password"].as_str().unwrap_or_default();
            f.logins.lock().unwrap().push(u.clone());
            if f.live_accounts.iter().any(|(x, p)| *x == u && p == pw) {
                return Json(json!({"access_token": "login-token"})).into_response();
            }
            return (StatusCode::FORBIDDEN, Json(json!({}))).into_response();
        }
        if path.ends_with("/account/deactivate") {
            let u = body["auth"]["identifier"]["user"]
                .as_str()
                .unwrap_or("?")
                .to_string();
            let pw = body["auth"]["password"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let correct = f.live_accounts.iter().any(|(x, p)| *x == u && *p == pw);
            f.deactivations.lock().unwrap().push((u, pw));
            return if correct {
                Json(json!({})).into_response()
            } else {
                (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response()
            };
        }
        (StatusCode::NOT_FOUND, Json(json!({}))).into_response()
    }

    async fn setup(
        pool: SqlitePool,
        live_accounts: &[(&str, &str)],
    ) -> (Arc<AppState>, Arc<FakeHs>) {
        let fake = Arc::new(FakeHs {
            deactivations: Mutex::new(Vec::new()),
            logins: Mutex::new(Vec::new()),
            live_accounts: live_accounts
                .iter()
                .map(|(u, p)| (u.to_string(), p.to_string()))
                .collect(),
        });
        let app = axum::Router::new()
            .fallback(route_hs)
            .with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let st = Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                base.clone(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: base,
                registration_token: "token".into(),
                encryption_key: KEY,
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        });
        (st, fake)
    }

    async fn seed_invitation(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('inv1','@alice:h',X'01',0,4000000000,2,1,'pending')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_row(pool: &SqlitePool, user_id: &str, password: &str, token: &str, status: &str) {
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at, claimed_at) \
             VALUES (?,'inv1',?,?,?,0,1)",
        )
        .bind(user_id)
        .bind(crypto::seal(&KEY, password).unwrap())
        .bind(if token.is_empty() {
            Vec::new()
        } else {
            crypto::seal(&KEY, token).unwrap()
        })
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn revoke_as(st: &Arc<AppState>, caller: &str) -> RevokeResponse {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {caller}").parse().unwrap());
        revoke(State(st.clone()), headers, Path("inv1".to_string()))
            .await
            .map(|Json(r)| r)
            .expect("revocation by the inviter must succeed")
    }

    /// **PRD §8.2 — revocation DELETES the accounts the invitation created,
    /// claimed ones included.**
    ///
    /// A `claimed` row is an entered account; promotion does not exist yet,
    /// so it is unpromoted by construction and §8.2's destructive criterion
    /// is met. The fake only accepts the account's LIVE password — the
    /// rotated one, kept sealed in the row at claim time precisely for this.
    /// Presenting the pre-rotation password would fail, and the fake's
    /// journal would show it.
    #[sqlx::test(migrations = "./migrations")]
    async fn revoke_deletes_reserved_and_claimed_accounts(pool: SqlitePool) {
        seed_invitation(&pool).await;
        // Entered, unpromoted: the rotated password is the live one.
        seed_row(
            &pool,
            "@entered:h",
            "rotated-password",
            "access-token",
            "claimed",
        )
        .await;
        // Created at claim time, never handed out.
        seed_row(
            &pool,
            "@never-handed-out:h",
            "previous-password",
            "access-token",
            "reserved",
        )
        .await;
        let (st, fake) = setup(
            pool.clone(),
            &[
                ("entered", "rotated-password"),
                ("never-handed-out", "previous-password"),
            ],
        )
        .await;

        let r = revoke_as(&st, "alice").await;
        assert!(r.revoked);
        assert_eq!(
            r.deactivated_accounts, 2,
            "the reserved AND the claimed account must be deleted"
        );
        assert_eq!(
            *fake.deactivations.lock().unwrap(),
            vec![
                ("entered".to_string(), "rotated-password".to_string()),
                (
                    "never-handed-out".to_string(),
                    "previous-password".to_string()
                ),
            ],
            "each account must be deleted with its LIVE password — for the \
             claimed one, the rotated password kept sealed at claim time"
        );
        for uid in ["@entered:h", "@never-handed-out:h"] {
            let (status, pw, tk): (String, Vec<u8>, Vec<u8>) = sqlx::query_as(
                "SELECT status, password_enc, access_token_enc FROM reserved_accounts \
                 WHERE user_id = ?",
            )
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(status, "deactivated", "{uid}");
            assert!(
                pw.is_empty() && tk.is_empty(),
                "{uid}: no secret may remain"
            );
        }
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM invitations WHERE id='inv1'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "revoked"
        );
    }

    /// **A `claiming` trace is honoured too: login with the traced password,
    /// then deactivate.**
    ///
    /// The row was written BEFORE `register_dormant`: its account may exist
    /// (here it does) but no access token was ever obtained — and the traced
    /// password is the live one, since no rotation ever ran on this row
    /// (`PERSIST_CANDIDATE` requires `reserved`, so a `claiming` row can
    /// never carry a candidate). Without the login fallback the trace would
    /// be visible and impossible to honour — the orphan merely moved from
    /// the base to the homeserver.
    #[sqlx::test(migrations = "./migrations")]
    async fn revoke_honors_a_claiming_trace_without_token(pool: SqlitePool) {
        seed_invitation(&pool).await;
        seed_row(&pool, "bare-trace", "traced-password", "", "claiming").await;
        let (st, fake) = setup(pool.clone(), &[("bare-trace", "traced-password")]).await;

        let r = revoke_as(&st, "alice").await;
        assert_eq!(r.deactivated_accounts, 1);
        assert_eq!(
            *fake.logins.lock().unwrap(),
            vec!["bare-trace".to_string()],
            "without a token, a session must be opened with the traced password"
        );
        assert_eq!(
            *fake.deactivations.lock().unwrap(),
            vec![("bare-trace".to_string(), "traced-password".to_string())],
            "and neutralise THE account the trace names, with its password"
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id='bare-trace'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "deactivated");
        let pw: Vec<u8> = sqlx::query_scalar(
            "SELECT password_enc FROM reserved_accounts WHERE user_id='bare-trace'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(pw.is_empty(), "the secrets must be wiped");
    }

    /// **A purged claimed row is NOT stamped `deactivated`: its account is
    /// alive, and the trace must not lie.**
    ///
    /// Since 9 August 2026, expiration is destructive for the SECRETS:
    /// `cleanup::purge_claimed_secrets_of_expired` wipes what the claimed
    /// rows of an expired invitation held. Revoking such an invitation
    /// afterwards finds no means to evict the entered account — that power
    /// lapsed with the invitation. What must NOT happen is the row being
    /// moved to `deactivated` anyway: the account is alive, in the room,
    /// and a trace claiming otherwise is a falsehood. The row stays
    /// `claimed`, and the response counts zero deactivations.
    #[sqlx::test(migrations = "./migrations")]
    async fn revoke_does_not_stamp_deactivated_a_purged_claimed_row(pool: SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('inv1','@alice:h',X'01',0,4000000000,2,1,'expired')",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Exactly what the purge leaves: `claimed`, `claimed_at` set, every
        // secret wiped.
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at, claimed_at) \
             VALUES ('@entered:h','inv1',X'',X'','claimed',0,1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let (st, fake) = setup(pool.clone(), &[]).await;

        let r = revoke_as(&st, "alice").await;
        assert!(r.revoked, "the invitation itself is still revoked");
        assert_eq!(
            r.deactivated_accounts, 0,
            "nothing can be deactivated: the purge destroyed the means"
        );
        assert!(
            fake.deactivations.lock().unwrap().is_empty(),
            "no deactivation may be attempted with empty secrets"
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id='@entered:h'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            status, "claimed",
            "the account is alive and out of reach: the row must keep saying so"
        );
    }
}
