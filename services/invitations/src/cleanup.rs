use std::sync::Arc;

use anyhow::Result;
use sqlx::{Row, SqlitePool};

use crate::{
    crypto,
    util::{localpart, now},
    AppState,
};

/// `purge_after IS NULL` means "frozen by a report": never purged.
pub async fn purge_edges(pool: &SqlitePool, now: i64) -> Result<u64> {
    let r = sqlx::query(
        "DELETE FROM invitation_edges \
                         WHERE purge_after IS NOT NULL AND purge_after <= ?",
    )
    .bind(now)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn expire_invitations(pool: &SqlitePool, now: i64) -> Result<u64> {
    let r = sqlx::query(
        "UPDATE invitations SET status='expired' \
                         WHERE status='pending' AND expires_at <= ?",
    )
    .bind(now)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Wipes the secrets sealed on `claimed` rows whose invitation has EXPIRED.
///
/// Product decision of 9 August 2026: expiration is destructive for the
/// SECRETS, not for the accounts — see the test
/// `the_purge_wipes_claimed_secrets_on_expired_invitations_only`, which pins
/// the four boundaries of this sweep. The homeserver is never called here:
/// a claimed account is a living account, held by a real user, and this
/// sweep has no business reaching it. What expires is the service's POWER:
/// the rotated password and the access token were kept sealed on the row so
/// that `revoke` could delete the account (§8.2); once the invitation has
/// expired, that power lapses and the secrets are destroyed.
///
/// A SINGLE atomic statement, self-guarded by `length(password_enc) > 0`:
/// the guard is what makes a second pass a no-op (termination), and there
/// is no take-then-act interleaving to fear — the wipe IS the whole action,
/// and no other path writes to a `claimed` row's secrets.
pub async fn purge_claimed_secrets_of_expired(pool: &SqlitePool) -> Result<u64> {
    let r = sqlx::query(
        "UPDATE reserved_accounts \
         SET password_enc=X'', password_next_enc=NULL, access_token_enc=X'' \
         WHERE status='claimed' AND length(password_enc) > 0 \
           AND invitation_id IN (SELECT id FROM invitations WHERE status='expired')",
    )
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Deactivates the accounts created at claim time whose invitation is expired
/// or revoked, and that have NEVER been handed out to anyone.
/// The localpart is never released by the homeserver (verified): the account
/// is neutralized, not recycled.
///
/// # Why `claimed` is OUTSIDE this filter — the two halves of §8.2
///
/// §8.2 makes REVOCATION destructive: the inviter looks, and evicting an
/// account that has entered is their own gesture, executed synchronously by
/// `handlers::revoke`. EXPIRATION is not a decision either, and since the
/// product call of 9 August 2026 it is no longer inert either: it does not
/// touch the ACCOUNT — a `claimed` account on an expired invitation is a
/// LIVING account, held by a person who uses it — but it destroys the
/// SECRETS the service kept for revocation, which is
/// `purge_claimed_secrets_of_expired`'s job, above. From then on,
/// destructive revocation is bounded by the invitation's lifetime. This
/// sweep, for its part, only picks up what was never handed out
/// (`reserved`, `claiming`), on both kinds of dead invitations; the
/// handed-out accounts of a revoked invitation are already dead by the time
/// revoke returns its response.
// `deactivate_with_either` is defined in task 8 (`handlers/revoke.rs`) and
// reused here: revocation and cleanup have exactly the same need — try the
// candidate, then the old one. Do not redefine it.
use crate::handlers::revoke::deactivate_with_either;

async fn deactivate_orphans(st: &Arc<AppState>) -> Result<u64> {
    // This SELECT now only serves to DESIGNATE the candidates: everything we
    // then act upon is read back by the atomic take below, never from this
    // snapshot.
    // `claiming` IS in the filter, and that is what makes the trace written
    // ahead useful rather than decorative. Such a row was written BEFORE the
    // registration (see `handlers::claim::create_account_for_claim`): its
    // account may exist, and if it is attached to a dead invitation, nobody
    // else will ever come and finish it — a claim only picks `claiming` rows
    // back up on a LIVING invitation. Omitting it would leave exactly the
    // orphan we have just moved from the database to here.
    let candidates: Vec<String> = sqlx::query_scalar(
        "SELECT r.user_id \
         FROM reserved_accounts r JOIN invitations i ON i.id = r.invitation_id \
         WHERE r.status IN ('reserved','claiming') AND i.status IN ('expired','revoked')",
    )
    .fetch_all(&st.pool)
    .await?;
    let mut n = 0;
    for user_id in candidates {
        // LOCK AND FRESH READ IN A SINGLE ATOMIC STATEMENT, as in
        // `handlers::revoke` — and for the same reason, worse here: between
        // the SELECT and this moment, a claim may have handed this account to
        // a real user AND have written its candidate. Acting on the snapshot
        // would mean calling `deactivate_with_either` with what has become the
        // claimant's LIVING password: the deactivation would SUCCEED,
        // destroying a handed-out account. The unguarded UPDATE that followed
        // would then stamp `status='deactivated'` on a row carrying a
        // `claimed_at`.
        let taken = sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated' \
             WHERE user_id = ? AND status IN ('reserved','claiming') \
             RETURNING password_enc, password_next_enc, access_token_enc",
        )
        .bind(&user_id)
        .fetch_optional(&st.pool)
        .await?;
        // Claimed in the meantime, or — for a `claiming` row — picked back up
        // and completed in the meantime by the claim holding it: in both cases
        // it no longer belongs to us.
        let Some(fresh) = taken else { continue };

        let localpart = localpart(&user_id);
        // `.ok()` and NOT `?` — same reason as in `repair_half_deactivated`.
        // A secret that has become undecryptable (key rotation) is useless, and
        // propagating the error would abandon the WHOLE function: this row
        // would stay stuck with its secrets forever, the following rows of the
        // batch would never be processed, and the repair could only catch up
        // with it if the unconditional wipe below never ran. No way out.
        let pw = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("password_enc").as_slice(),
        )
        .ok();
        let next = fresh
            .get::<Option<Vec<u8>>, _>("password_next_enc")
            .and_then(|b| crypto::open(&st.cfg.encryption_key, &b).ok());
        let tk = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("access_token_enc").as_slice(),
        )
        .ok();
        // THE TOKEN MISSING FROM A ROW WRITTEN AHEAD.
        //
        // It carries its password — written before the registration — but no
        // access token: only the homeserver could give one, and this row
        // exists precisely because it never had the opportunity to return it.
        // Yet `deactivate` requires a bearer token ON TOP of password UIA.
        // Without this fallback, the trace would be visible and yet impossible
        // to honour: we would only have moved the orphan from the database to
        // the homeserver.
        //
        // Its failure is EXPECTED in the benign half of cases — if the
        // registration never completed, the account does not exist, the login
        // is refused, and there is nothing to neutralize. That is why it does
        // not propagate: the unconditional wipe below finishes the row in both
        // cases.
        let tk = match tk {
            Some(t) => Some(t),
            None => match pw.as_deref() {
                Some(password) => st.mx.login(&localpart, password).await.ok(),
                None => None,
            },
        };
        if let (Some(pw), Some(tk)) = (pw, tk) {
            let _ = deactivate_with_either(st.as_ref(), &tk, &localpart, next, &pw).await;
        }
        // UNCONDITIONAL wipe: it is what guarantees the row finishes, even if
        // nothing could be decrypted. The `status` is now redundant there —
        // the atomic take already set it — but it stays written: it is this
        // statement, and it alone, that must guarantee termination, whatever
        // happens above.
        sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated', \
                     password_enc=X'', password_next_enc=NULL, access_token_enc=X'' \
                     WHERE user_id=?",
        )
        .bind(&user_id)
        .execute(&st.pool)
        .await?;
        n += 1;
    }
    Ok(n)
}

/// Repairs the rows left halfway: `deactivated` but still carrying secrets.
///
/// This happens when a revocation locked the row then failed before wiping —
/// an impossible decryption after a key rotation, a transient SQL error.
/// Without this sweep these rows are **invisible to every other query**, which
/// filter on `status='reserved'`, and their secrets would stay in the database
/// indefinitely. It is the repair path that lets revocation lock before acting
/// without creating a deadlock.
///
/// Decryption uses `.ok()` and not `?`: if a secret can no longer be
/// decrypted, it cannot be used anyway, and keeping it in the database gains
/// nothing. So we wipe in all cases.
///
/// # Why an atomic take here too
///
/// This was the ONLY one of the four sites to touch a row without taking it:
/// `SELECT`, network call, then unguarded wipe. It was safe as long as
/// `deactivated` was TERMINAL — nothing could get out of it any more.
/// `return_to_pool` (`handlers::claim`) removed that assumption, and the
/// interleaving below is anything but exotic: the filter below is EXACTLY the
/// state a claim's take leaves for its whole Matrix flow, so each hourly
/// pass mechanically picks up in-flight claims.
///
/// ```text
///   claim                                | this sweep
///   atomic take -> deactivated+secrets   |
///   join in progress                     | SELECT: the row is in the filter
///   invite fails -> return_to_pool       | deactivates the account -> DEAD
///                    -> reserved         |
///                                        | unguarded wipe
///   =>  "reserved" row WITHOUT SECRETS, beyond the reach of every sweep,
///       which `... AND status='reserved' LIMIT 1` draws FIRST on each call:
///       decryption fails, and the whole invitation returns 500 until its TTL
///       expires, healthy accounts included.
/// ```
///
/// A half-fix is not enough. Keeping only the final wipe guarded by
/// `status='deactivated'` would let the claim return to the pool a row whose
/// account has just been killed: no more 500, but a permanent 503.
///
/// Hence `purging`: the take MOVES the row OUT of the state `return_to_pool`
/// accepts (`status='deactivated'`), and it does so BEFORE the network call.
/// Both outcomes are then clean and exclusive:
///
/// - the take wins -> `return_to_pool` finds nothing any more, the row ends
///   `deactivated` without secrets, its account is dead: consistent;
/// - `return_to_pool` wins -> the take finds nothing any more, the row is
///   `reserved` with its secrets, its account is alive: consistent.
///
/// `purging` stays in the designation filter: an interruption between the take
/// and the wipe is therefore picked up on the next pass, and the row finishes.
async fn repair_half_deactivated(st: &Arc<AppState>) -> Result<u64> {
    // The filter covers TWO distinct residues, not one:
    //  - non-empty `password_enc`: revocation locked then failed before
    //    wiping;
    //  - non-null `password_next_enc` while `password_enc` is already empty:
    //    an in-flight claim repopulated the candidate AFTER revocation had
    //    wiped everything. Its write guard is `password_next_enc IS NULL`,
    //    with no `status` check, so it passes on a deactivated row.
    // Filtering on the first alone would leave the second in the database
    // indefinitely.
    //
    // This SELECT now only serves to DESIGNATE: everything we then act upon is
    // read back by the atomic take, never from this snapshot.
    let candidates: Vec<String> = sqlx::query_scalar(
        "SELECT user_id FROM reserved_accounts \
         WHERE status IN ('deactivated','purging') \
           AND (length(password_enc) > 0 OR password_next_enc IS NOT NULL)",
    )
    .fetch_all(&st.pool)
    .await?;
    let mut n = 0;
    for user_id in candidates {
        let taken = sqlx::query(
            "UPDATE reserved_accounts SET status='purging' \
             WHERE user_id = ? AND status IN ('deactivated','purging') \
               AND (length(password_enc) > 0 OR password_next_enc IS NOT NULL) \
             RETURNING password_enc, password_next_enc, access_token_enc",
        )
        .bind(&user_id)
        .fetch_optional(&st.pool)
        .await?;
        // Returned to the pool in the meantime: its account is alive, we do
        // not touch it.
        let Some(fresh) = taken else { continue };

        let localpart = localpart(&user_id);
        let pw = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("password_enc").as_slice(),
        )
        .ok();
        let next = fresh
            .get::<Option<Vec<u8>>, _>("password_next_enc")
            .and_then(|b| crypto::open(&st.cfg.encryption_key, &b).ok());
        let tk = crypto::open(
            &st.cfg.encryption_key,
            fresh.get::<Vec<u8>, _>("access_token_enc").as_slice(),
        )
        .ok();
        if let (Some(pw), Some(tk)) = (pw, tk) {
            let _ = deactivate_with_either(st.as_ref(), &tk, &localpart, next, &pw).await;
        }
        // Guarded by `purging`, and it is safe: we alone hold this state, no
        // other query in the service writes it or reads it to act. Termination
        // stays guaranteed — if this write does not happen, the row stays
        // `purging` WITH its secrets, hence in the designation filter, and the
        // next pass picks it back up.
        sqlx::query(
            "UPDATE reserved_accounts SET status='deactivated', password_enc=X'', \
                     password_next_enc=NULL, access_token_enc=X'' \
             WHERE user_id=? AND status='purging'",
        )
        .bind(&user_id)
        .execute(&st.pool)
        .await?;
        n += 1;
    }
    Ok(n)
}

pub async fn run_forever(st: Arc<AppState>) {
    loop {
        let now = now();
        match (
            purge_edges(&st.pool, now).await,
            expire_invitations(&st.pool, now).await,
            deactivate_orphans(&st).await,
            repair_half_deactivated(&st).await,
            purge_claimed_secrets_of_expired(&st.pool).await,
        ) {
            (Ok(a), Ok(b), Ok(c), Ok(d), Ok(e)) => tracing::info!(
                "cleanup: {a} edges, {b} invitations, {c} accounts, \
                                {d} rows repaired, {e} claimed rows purged"
            ),
            _ => tracing::warn!("cleanup partially failed"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **THE PURGE FORGETS WHAT AN EXPIRED INVITATION LEFT BEHIND.**
    ///
    /// Product decision of 9 August 2026: expiration is destructive for the
    /// SECRETS, not for the accounts. A claimed account is a living account,
    /// held by a real user — the purge does not touch the homeserver. But an
    /// invitation's expiry closes the service's power over what it created:
    /// the rotated password and the access token, sealed on the `claimed`
    /// row since the hand-out precisely so that `revoke` could delete the
    /// account, are wiped. Destructive revocation is thereby bounded by the
    /// invitation's lifetime: pending, it can still evict; expired, the
    /// service holds nothing any more.
    ///
    /// What this test pins, row by row:
    ///  - the claimed row of an EXPIRED invitation is wiped, and stays
    ///    `claimed` with its `claimed_at` (the trace is not the secret);
    ///  - the claimed row of a PENDING invitation is UNTOUCHED — wiping it
    ///    would amputate §8.2's destructive revocation while the inviter is
    ///    still watching;
    ///  - a `reserved` row of an expired invitation is UNTOUCHED here: its
    ///    account may be alive on the homeserver, and neutralizing it is
    ///    `deactivate_orphans`' job, with its takes and its fallbacks — not
    ///    a bare wipe's;
    ///  - the next pass finds nothing: termination.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_purge_wipes_claimed_secrets_on_expired_invitations_only(pool: sqlx::SqlitePool) {
        let key = [0u8; 32];
        for (id, status, hash) in [
            ("i1", "expired", [0x01u8].as_slice()),
            ("i2", "pending", [0x02u8].as_slice()),
        ] {
            sqlx::query(
                "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
                 expires_at, max_uses, used_count, status) VALUES (?, '@a:h', ?, 0, \
                 4000000000, 1, 1, ?)",
            )
            .bind(id)
            .bind(hash)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        }
        for (user_id, inv) in [("@x:h", "i1"), ("@y:h", "i2")] {
            sqlx::query(
                "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
                 access_token_enc, status, created_at, claimed_at) \
                 VALUES (?, ?, ?, ?, 'claimed', 0, 123)",
            )
            .bind(user_id)
            .bind(inv)
            .bind(crypto::seal(&key, "rotated-password").unwrap())
            .bind(crypto::seal(&key, "access-token").unwrap())
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@z:h', 'i1', ?, ?, 'reserved', 0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(purge_claimed_secrets_of_expired(&pool).await.unwrap(), 1);

        let wiped: (String, Vec<u8>, Option<Vec<u8>>) = sqlx::query_as(
            "SELECT status, password_enc, access_token_enc FROM reserved_accounts \
             WHERE user_id='@x:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(wiped.0, "claimed", "the trace stays, and stays claimed");
        assert!(wiped.1.is_empty(), "the rotated password must be wiped");
        assert!(
            wiped.2.as_ref().is_none_or(|t| t.is_empty()),
            "the access token must be wiped"
        );
        let claimed_at: Option<i64> =
            sqlx::query_scalar("SELECT claimed_at FROM reserved_accounts WHERE user_id='@x:h'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(claimed_at, Some(123), "the audit field is not the secret");

        for user_id in ["@y:h", "@z:h"] {
            let pw: Vec<u8> =
                sqlx::query_scalar("SELECT password_enc FROM reserved_accounts WHERE user_id = ?")
                    .bind(user_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert!(
                !pw.is_empty(),
                "{user_id} must keep its secrets: pending invitation, or \
                 deactivate_orphans' row"
            );
        }

        assert_eq!(
            purge_claimed_secrets_of_expired(&pool).await.unwrap(),
            0,
            "termination: the second pass finds nothing"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn purges_due_edges_and_spares_frozen_ones(pool: sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO invitation_edges \
            (inviter_user_id, invited_user_id, invitation_id, redeemed_at, purge_after) \
            VALUES ('@a:h','@b:h','i1',100,200), ('@a:h','@c:h','i2',100,9999), \
                   ('@a:h','@d:h','i3',100,NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let n = purge_edges(&pool, 1000).await.unwrap();
        assert_eq!(n, 1, "only the due edge is purged");

        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitation_edges")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            remaining, 2,
            "the frozen (NULL) and the not-yet-due survive"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_undecryptable_row_finishes_anyway(pool: sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,0,1,0,'expired')",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Secrets deliberately unreadable under the service key: decryption
        // will fail, so the homeserver will never be called.
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) \
             VALUES ('@x:h','i1',X'DEADBEEF',X'DEADBEEF','reserved',0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let st = std::sync::Arc::new(crate::AppState {
            pool: pool.clone(),
            mx: std::sync::Arc::new(crate::matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: "http://127.0.0.1:1".into(),
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        });

        assert_eq!(deactivate_orphans(&st).await.unwrap(), 1);

        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='@x:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            status, "deactivated",
            "the row must finish despite the failure"
        );
        assert!(pw.is_empty(), "the secrets must be wiped in all cases");

        // THE proof of termination: on the next pass, the row is no longer
        // selected. On the pre-fix code, this test fails at the first
        // assertion, the function having abandoned on an Err.
        assert_eq!(deactivate_orphans(&st).await.unwrap(), 0);
    }

    fn test_state(pool: sqlx::SqlitePool, homeserver: String) -> std::sync::Arc<crate::AppState> {
        std::sync::Arc::new(crate::AppState {
            pool,
            mx: std::sync::Arc::new(crate::matrix::MatrixClient::new(
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

    /// The fixed defect: `deactivate_orphans` read the row, called the
    /// homeserver, THEN stamped `status='deactivated'` without a guard. A claim
    /// that interleaved itself handed the account to a real user, and the
    /// cleanup — still carrying the snapshot, candidate included — deactivated
    /// a LIVING account with what had become its owner's password, then
    /// overwrote the claimed row.
    ///
    /// What this test verifies is the property that closes the race: at the
    /// PRECISE moment the homeserver is called, the row is already taken, so
    /// no claim (which requires `status='reserved'`) can win any more. The
    /// fake homeserver queries the database at that very instant. On the
    /// pre-fix code, it observes `reserved` there and the test fails.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_row_is_already_taken_when_the_homeserver_is_called(pool: sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,0,1,0,'expired')",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Actually decryptable secrets, otherwise the network call does not
        // happen and the test would observe nothing.
        let key = [0u8; 32];
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@x:h','i1',?,?,'reserved',0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let for_task = observed.clone();
        let server_pool = pool.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                // Read BEFORE answering: the caller is still blocked here.
                let status: String =
                    sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id='@x:h'")
                        .fetch_one(&server_pool)
                        .await
                        .unwrap();
                {
                    for_task.lock().unwrap().push(status);
                }
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream
                        .write_all(
                            b"HTTP/1.1 401 Unauthorized\r\n\
                        Content-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let st = test_state(pool.clone(), format!("http://127.0.0.1:{port}"));
        assert_eq!(deactivate_orphans(&st).await.unwrap(), 1);

        let observed = observed.lock().unwrap().clone();
        assert!(
            !observed.is_empty(),
            "the homeserver must have been called, otherwise this test proves nothing"
        );
        assert!(
            observed.iter().all(|s| s == "deactivated"),
            "the row must be taken BEFORE any network call; observed: {observed:?}"
        );
    }

    /// A fake homeserver that, on each request, records the row's `status`
    /// BEFORE answering — hence while the caller is still blocked — then
    /// refuses. Returns `(base, observations)`.
    async fn observing_homeserver(
        pool: sqlx::SqlitePool,
        user_id: &'static str,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let for_task = observed.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let status: String =
                    sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id = ?")
                        .bind(user_id)
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                for_task.lock().unwrap().push(status);
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream
                        .write_all(
                            b"HTTP/1.1 401 Unauthorized\r\n\
                              Content-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        (base, observed)
    }

    /// A fake homeserver that NOTES what it is asked, distinguishing the
    /// routes — which the raw TCP servers of this file cannot do, and it is
    /// needed here: the property under test is precisely "there was a login
    /// THEN a deactivation".
    ///
    /// `refuse_login` models the benign half of the fix: the row written ahead
    /// whose account was NEVER created. The homeserver knows nobody, the login
    /// fails, and there is nothing to neutralize.
    struct FakeHomeserver {
        calls: std::sync::Mutex<Vec<String>>,
        refuse_login: bool,
    }

    async fn route_hs(
        axum::extract::State(f): axum::extract::State<Arc<FakeHomeserver>>,
        req: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        let path = req.uri().path().to_string();
        let body = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::json!({}));

        if path.ends_with("/v3/login") {
            let who = v["identifier"]["user"].as_str().unwrap_or("?").to_string();
            f.calls.lock().unwrap().push(format!("login:{who}"));
            if f.refuse_login {
                return (
                    axum::http::StatusCode::FORBIDDEN,
                    axum::Json(serde_json::json!({"errcode": "M_FORBIDDEN"})),
                )
                    .into_response();
            }
            return axum::Json(serde_json::json!({"access_token": "login-token"})).into_response();
        }
        if path.ends_with("/v3/account/deactivate") {
            let who = v["auth"]["identifier"]["user"]
                .as_str()
                .unwrap_or("?")
                .to_string();
            f.calls.lock().unwrap().push(format!("deactivate:{who}"));
            return axum::Json(serde_json::json!({})).into_response();
        }
        (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({})),
        )
            .into_response()
    }

    async fn spawn_hs(refuse_login: bool) -> (String, Arc<FakeHomeserver>) {
        let fake = Arc::new(FakeHomeserver {
            calls: std::sync::Mutex::new(Vec::new()),
            refuse_login,
        });
        let app = axum::Router::new()
            .fallback(route_hs)
            .with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, fake)
    }

    /// Writes the exact row an interrupted claim leaves before the end of the
    /// registration: the BARE localpart as the key, the password written
    /// ahead, and NO access token — the homeserver never had the opportunity
    /// to return one.
    async fn plant_interrupted_trace(pool: &sqlx::SqlitePool, localpart: &str) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,0,1,0,'revoked')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES (?,'i1',?,X'','claiming',0)",
        )
        .bind(localpart)
        .bind(crypto::seal(&[0u8; 32], "password-written-ahead").unwrap())
        .execute(pool)
        .await
        .unwrap();
    }

    /// **THE CLEANUP HONOURS A ROW WRITTEN AHEAD.**
    ///
    /// This is the second half of the window fix, and without it the first is
    /// worthless: writing the trace before registering only matters IF someone
    /// knows how to use it. Such a row has no access token — only the
    /// homeserver could give one, and it never had the opportunity to return
    /// it — whereas `deactivate` requires one. The cleanup must therefore open
    /// a session with the password written ahead, then deactivate.
    ///
    /// Without this fallback, the trace would be visible and yet impossible to
    /// honour: we would only have moved the orphan from the database to the
    /// homeserver.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_cleanup_honours_a_row_written_before_the_registration(pool: sqlx::SqlitePool) {
        plant_interrupted_trace(&pool, "abcdef234567").await;
        let (base, fake) = spawn_hs(false).await;
        let st = test_state(pool.clone(), base);

        assert_eq!(deactivate_orphans(&st).await.unwrap(), 1);

        let calls = fake.calls.lock().unwrap().clone();
        assert!(
            calls.contains(&"login:abcdef234567".to_string()),
            "for lack of a token, the cleanup must open a session with the \
             password written ahead; observed calls: {calls:?}"
        );
        assert!(
            calls.contains(&"deactivate:abcdef234567".to_string()),
            "and neutralize THE account the trace names; calls: {calls:?}"
        );

        // The row finishes, like any other.
        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='abcdef234567'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "deactivated");
        assert!(pw.is_empty(), "the secrets must be wiped");
        assert_eq!(deactivate_orphans(&st).await.unwrap(), 0, "termination");
    }

    /// **The benign half: the row whose account never existed.**
    ///
    /// This is the case the fix makes NORMAL — a row without an account,
    /// instead of an account without a row. The homeserver knows nobody, the
    /// login is refused, and there is precisely nothing to neutralize. The row
    /// must finish anyway: that is what distinguishes "the window falls on the
    /// right side" from "the window changed its name".
    ///
    /// The counterweight to the previous test: without it, a cleanup that
    /// abandoned on a login failure would go unnoticed.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_row_without_an_account_finishes_despite_the_login_refusal(pool: sqlx::SqlitePool) {
        plant_interrupted_trace(&pool, "zyxwvu765432").await;
        let (base, fake) = spawn_hs(true).await;
        let st = test_state(pool.clone(), base);

        assert_eq!(deactivate_orphans(&st).await.unwrap(), 1);

        let calls = fake.calls.lock().unwrap().clone();
        assert!(
            calls.contains(&"login:zyxwvu765432".to_string()),
            "the attempt must happen: it is what distinguishes the two cases"
        );
        assert!(
            !calls.iter().any(|a| a.starts_with("deactivate:")),
            "nothing to neutralize: no deactivation must be attempted on an \
             account the homeserver does not know; calls: {calls:?}"
        );

        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='zyxwvu765432'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "deactivated", "the row must finish anyway");
        assert!(pw.is_empty());
        assert_eq!(deactivate_orphans(&st).await.unwrap(), 0, "termination");
    }

    /// **R1** — the repair must take the row BEFORE calling the homeserver,
    /// and move it out of the state `return_to_pool` accepts.
    ///
    /// It was the only one of the four sites to act without a take: `SELECT`,
    /// network call, unguarded wipe. Safe as long as `deactivated` was
    /// terminal, wrong since `return_to_pool` moves rows out of it. And this
    /// sweep's filter is EXACTLY the state a claim leaves for its whole Matrix
    /// flow: each hourly pass therefore picks up in-flight claims — this
    /// is no exotic window.
    ///
    /// What this test exercises is the property that closes the race: at the
    /// PRECISE moment the homeserver is called, the row is already `purging`,
    /// hence beyond the reach of `return_to_pool`, whose guard requires
    /// `deactivated`. Without the take, the fake observes `deactivated` there
    /// and the test fails.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_repair_takes_the_row_before_calling_the_homeserver(pool: sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,4000000000,2,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let key = [0u8; 32];
        // The row to repair: `deactivated` while still carrying its secrets,
        // exactly what an in-flight claim's take leaves.
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@x:h','i1',?,?,'deactivated',0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();
        // Witness: a row returned to the pool must not be touched at all.
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@returned:h','i1',?,?,'reserved',0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();

        let (base, observed) = observing_homeserver(pool.clone(), "@x:h").await;
        let st = test_state(pool.clone(), base);

        assert_eq!(repair_half_deactivated(&st).await.unwrap(), 1);

        let observed = observed.lock().unwrap().clone();
        assert!(
            !observed.is_empty(),
            "the homeserver must have been called, otherwise this test proves nothing"
        );
        assert!(
            observed.iter().all(|s| s == "purging"),
            "the row must be taken, and taken OUT of the state return_to_pool \
             accepts, before any network call; observed: {observed:?}"
        );

        // The row finishes: wiped, and out of the designation filter.
        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='@x:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "deactivated");
        assert!(pw.is_empty(), "the secrets must be wiped");
        assert_eq!(
            repair_half_deactivated(&st).await.unwrap(),
            0,
            "termination"
        );

        // The witness is intact: the repair never comes down on a row returned
        // to the pool, whose account is alive.
        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='@returned:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "reserved");
        assert!(
            !pw.is_empty(),
            "a row returned to the pool keeps its secrets: its account is alive"
        );
    }

    /// `purging` MUST stay in the designation filter.
    ///
    /// It is the clause that guarantees termination, and the comment of
    /// `repair_half_deactivated` promises it in so many words: "an
    /// interruption between the take and the wipe is picked up on the next
    /// pass". Without it, a row taken then abandoned — killed process,
    /// restarted machine — stays `purging` WITH its secrets, and no sweep
    /// looks at it any more: the secrets stay in the database permanently.
    ///
    /// The property was true in the code and tested nowhere.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_interrupted_repair_is_picked_up_on_the_next_pass(pool: sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,4000000000,1,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let key = [0u8; 32];
        // Exactly what a pass interrupted between the take and the wipe
        // leaves: `purging`, secrets still there.
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@x:h','i1',?,?,'purging',0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();

        let (base, observed) = observing_homeserver(pool.clone(), "@x:h").await;
        let st = test_state(pool.clone(), base);

        assert_eq!(
            repair_half_deactivated(&st).await.unwrap(),
            1,
            "a row left in `purging` must be picked back up, otherwise its \
             secrets stay in the database forever"
        );
        assert!(
            !observed.lock().unwrap().is_empty(),
            "the homeserver must have been called again: the resumption must \
             retry neutralizing the account, not merely wipe"
        );
        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='@x:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "deactivated");
        assert!(pw.is_empty(), "the resumption must wipe the secrets");
    }

    /// The final wipe touches ONLY the row the repair still holds.
    ///
    /// Its `status='purging'` guard is what keeps it from emptying a row
    /// another path would have taken back during the network call. Without it,
    /// we would fall back to the state R1 exists to prevent: a row in the pool
    /// WITHOUT SECRETS, invisible to every sweep, which makes the whole
    /// invitation return 500.
    ///
    /// The fake returns the row to `reserved` while the repair is blocked on
    /// the homeserver — the precise instant the guard comes into play.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_final_wipe_does_not_empty_a_row_taken_back_in_the_meantime(
        pool: sqlx::SqlitePool,
    ) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('i1','@a:h',X'01',0,4000000000,1,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let key = [0u8; 32];
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES ('@x:h','i1',?,?,'deactivated',0)",
        )
        .bind(crypto::seal(&key, "password").unwrap())
        .bind(crypto::seal(&key, "access-token").unwrap())
        .execute(&pool)
        .await
        .unwrap();

        // Fake homeserver that RETURNS THE ROW TO THE POOL before answering.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server_pool = pool.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                sqlx::query("UPDATE reserved_accounts SET status='reserved' WHERE user_id='@x:h'")
                    .execute(&server_pool)
                    .await
                    .unwrap();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream
                        .write_all(
                            b"HTTP/1.1 401 Unauthorized\r\n\
                              Content-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let st = test_state(pool.clone(), base);
        repair_half_deactivated(&st).await.unwrap();

        let (status, pw): (String, Vec<u8>) = sqlx::query_as(
            "SELECT status, password_enc FROM reserved_accounts WHERE user_id='@x:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            status, "reserved",
            "the row taken back must stay in the pool"
        );
        assert!(
            !pw.is_empty(),
            "the wipe must not empty a row we no longer hold: that would be a \
             pool row without secrets, which nothing can decrypt or pick up \
             any more"
        );
    }
}
