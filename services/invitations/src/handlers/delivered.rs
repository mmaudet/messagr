//! Invitations delivered inside the application (#404, #392, ADR 0014): a
//! findable account invites the account behind a contact's reference, found
//! by looking for its contacts, and never its number. An invitation so
//! delivered has no link: it is good for a week, and for one use.
//!
//! - `POST /discovery/invitations`: the inviter, findable, sends an
//!   invitation to a reference of the directory;
//! - `GET /discovery/invitations`: the recipient lists the invitations
//!   waiting for it, each with its deadline;
//! - `POST /discovery/invitations/:id/join`: the recipient joins. The service
//!   records the claim, which the inviter's device reads to invite the
//!   account into the conversation;
//! - `POST /discovery/invitations/:id/decline`: the recipient declines, and
//!   the invitation leaves its list;
//! - `GET /discovery/invitations/:id`: the inviter reads where its invitation
//!   stands, in the shape it reads a link's (`status.rs`).
//!
//! # THE INVITER LEARNS THE ACCOUNT WHEN IT JOINS, AND ONLY THEN
//!
//! The service knows the recipient from the moment the invitation leaves:
//! the reference names it. The inviter is told who it is when it joins, which
//! is when its device must invite that account; before, the invitation reads
//! « pending » and names nobody.
//!
//! # A REFUSAL READS AS AN INVITATION NOBODY HAS SEEN
//!
//! Declining is written for the recipient alone, so that the invitation
//! leaves its list on every device. The inviter reads « pending » until the
//! deadline, then « expired », exactly as for an invitation never opened:
//! nothing tells it whether it was seen, or refused.
//!
//! # WHAT THE SERVICE KEEPS
//!
//! Who invites whom, from the moment an invitation leaves, and thirty days
//! after it ended, as it keeps the links it hands out (#416). Never the
//! conversation: the inviter's device holds it, and invites the account into
//! it when the claim comes.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    auth, error::AppError, extract::Body, handlers::discovery, handlers::status::InvitationStatus,
    AppState,
};

/// How long an invitation delivered inside the application stays good.
pub const DELIVERED_LIFETIME_SECONDS: i64 = 7 * 86_400;

#[derive(Deserialize)]
pub struct SendRequest {
    /// A reference of the directory (`GET /discovery/directory`).
    pub reference: String,
}

#[derive(Serialize)]
pub struct Sent {
    pub id: String,
    /// Unix time.
    pub expires_at: i64,
}

/// `POST /discovery/invitations`: an invitation to the account behind a
/// reference, from a findable account.
///
/// The reference must name a current proof: one withdrawn, run out or
/// replaced since the directory was read names nobody any more. The
/// caller's own reference is refused, since an invitation to oneself leads
/// nowhere.
pub async fn send(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<SendRequest>,
) -> Result<Json<Sent>, AppError> {
    let inviter = auth::authenticate(&st.mx, &headers).await?;
    discovery::served(&st)?;
    let now = st.cfg.clock.now();
    if discovery::current_proof(&st, &inviter, now)
        .await?
        .is_none()
    {
        return Err(AppError::NotFindable);
    }
    let recipient: String = sqlx::query_scalar(
        "SELECT user_id FROM findable_numbers \
         WHERE reference = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(&req.reference)
    .bind(now)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::UnknownReference)?;
    if recipient == inviter {
        return Err(AppError::OwnReference);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let expires_at = now + DELIVERED_LIFETIME_SECONDS;
    sqlx::query(
        "INSERT INTO delivered_invitations \
         (id, inviter_user_id, recipient_user_id, sent_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&inviter)
    .bind(&recipient)
    .bind(now)
    .bind(expires_at)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(Sent { id, expires_at }))
}

#[derive(Serialize)]
pub struct WaitingInvitation {
    pub id: String,
    /// Unix time.
    pub expires_at: i64,
}

#[derive(Serialize)]
pub struct Waiting {
    pub invitations: Vec<WaitingInvitation>,
}

/// `GET /discovery/invitations`: the invitations waiting for the caller,
/// neither joined, declined nor run out, oldest first.
///
/// Served even with discovery off, as withdrawing a number is: an invitation
/// already delivered is still the recipient's to answer.
pub async fn waiting(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Waiting>, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let rows = sqlx::query(
        "SELECT id, expires_at FROM delivered_invitations \
         WHERE recipient_user_id = ? AND claimed_at IS NULL AND declined_at IS NULL \
           AND expires_at > ? \
         ORDER BY sent_at, id",
    )
    .bind(&recipient)
    .bind(st.cfg.clock.now())
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let invitations = rows
        .iter()
        .map(|row| WaitingInvitation {
            id: row.get("id"),
            expires_at: row.get("expires_at"),
        })
        .collect();
    Ok(Json(Waiting { invitations }))
}

/// `POST /discovery/invitations/:id/join`: the recipient joins.
///
/// One statement decides, so that joining twice is joining once. An
/// invitation that is not the caller's, that it declined, or that ran out
/// gets the same answer as one that does not exist.
pub async fn join(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let now = st.cfg.clock.now();
    let answered = sqlx::query(
        "UPDATE delivered_invitations SET claimed_at = COALESCE(claimed_at, ?1) \
         WHERE id = ?2 AND recipient_user_id = ?3 AND declined_at IS NULL AND expires_at > ?1",
    )
    .bind(now)
    .bind(&id)
    .bind(&recipient)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    if answered.rows_affected() == 0 {
        return Err(AppError::InvitationInvalid);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /discovery/invitations/:id/decline`: the recipient declines. The
/// invitation leaves its list; the inviter is not told (see the module).
pub async fn decline(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let now = st.cfg.clock.now();
    let answered = sqlx::query(
        "UPDATE delivered_invitations SET declined_at = COALESCE(declined_at, ?1) \
         WHERE id = ?2 AND recipient_user_id = ?3 AND claimed_at IS NULL AND expires_at > ?1",
    )
    .bind(now)
    .bind(&id)
    .bind(&recipient)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    if answered.rows_affected() == 0 {
        return Err(AppError::InvitationInvalid);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /discovery/invitations/:id`: where the caller's invitation stands.
///
/// « pending », until it runs out, whether the recipient has seen it, declined
/// it or neither; « expired » after; « claimed » once the recipient joined,
/// naming the account the inviter's device invites (`entrant_user_id`), as a
/// link's status names it. To anybody but the inviter, it does not exist.
pub async fn status(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<InvitationStatus>, AppError> {
    let caller = auth::authenticate(&st.mx, &headers).await?;
    let row = sqlx::query(
        "SELECT inviter_user_id, recipient_user_id, expires_at, claimed_at \
         FROM delivered_invitations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;
    if row.get::<String, _>("inviter_user_id") != caller {
        return Err(AppError::InvitationInvalid);
    }
    let recipient: String = row.get("recipient_user_id");
    let expires_at: i64 = row.get("expires_at");
    let answer = match row.get::<Option<i64>, _>("claimed_at") {
        Some(claimed_at) => InvitationStatus {
            status: "claimed".into(),
            claimed_user_id: Some(recipient.clone()),
            claimed_at: Some(claimed_at),
            entrant_user_id: Some(recipient),
        },
        None => InvitationStatus {
            status: if st.cfg.clock.now() >= expires_at {
                "expired"
            } else {
                "pending"
            }
            .into(),
            claimed_user_id: None,
            claimed_at: None,
            entrant_user_id: None,
        },
    };
    Ok(Json(answer))
}

/// Forgets who invited whom once an invitation has ended, claimed or run
/// out, `retention_days` before `now`: the thirty days a link's are kept
/// (#416, `cleanup::purge_invitation_graph`).
pub async fn purge_ended(
    pool: &sqlx::SqlitePool,
    now: i64,
    retention_days: i64,
) -> anyhow::Result<u64> {
    let done = sqlx::query(
        "DELETE FROM delivered_invitations WHERE COALESCE(claimed_at, expires_at) <= ?",
    )
    .bind(now - retention_days * 86_400)
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::discovery::tests::{
        bearer, fake_ovhcloud, prove, reference_of, set, state_at, whoami_hs, DAY, NUMBER, OTHER,
        T0,
    };
    use sqlx::SqlitePool;

    /// Alice and Bob, each findable with a number of their own, at `T0`.
    async fn two_findable(
        pool: SqlitePool,
    ) -> (Arc<AppState>, Arc<std::sync::atomic::AtomicI64>, String) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;
        let bob = reference_of(&st.pool, "bob").await.unwrap();
        (st, time, bob)
    }

    async fn sent(st: &Arc<AppState>, who: &str, reference: &str) -> Result<Sent, AppError> {
        send(
            State(st.clone()),
            bearer(who),
            Body(SendRequest {
                reference: reference.into(),
            }),
        )
        .await
        .map(|Json(s)| s)
    }

    async fn waiting_for(st: &Arc<AppState>, who: &str) -> Vec<(String, i64)> {
        waiting(State(st.clone()), bearer(who))
            .await
            .map(|Json(w)| {
                w.invitations
                    .into_iter()
                    .map(|i| (i.id, i.expires_at))
                    .collect()
            })
            .unwrap()
    }

    async fn status_of(st: &Arc<AppState>, who: &str, id: &str) -> Result<String, AppError> {
        status(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|Json(s)| serde_json::to_string(&s).unwrap())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_findable_account_invites_a_reference_for_a_week(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;

        let invitation = sent(&st, "alice", &bob).await.unwrap();

        assert_eq!(invitation.expires_at, T0 + 7 * DAY);
        assert_eq!(
            waiting_for(&st, "bob").await,
            vec![(invitation.id.clone(), T0 + 7 * DAY)]
        );
        assert!(waiting_for(&st, "alice").await.is_empty());
        let (inviter, recipient): (String, String) = sqlx::query_as(
            "SELECT inviter_user_id, recipient_user_id FROM delivered_invitations WHERE id = ?",
        )
        .bind(&invitation.id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!(
            (inviter.as_str(), recipient.as_str()),
            ("@alice:h", "@bob:h"),
            "who invites whom, from the moment it leaves"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn only_a_findable_account_invites_and_only_a_current_proof_is_invited(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;

        assert!(matches!(
            sent(&st, "carol", &bob).await,
            Err(AppError::NotFindable)
        ));
        assert!(matches!(
            sent(&st, "alice", "no-such-reference").await,
            Err(AppError::UnknownReference)
        ));
        let own = reference_of(&st.pool, "alice").await.unwrap();
        assert!(matches!(
            sent(&st, "alice", &own).await,
            Err(AppError::OwnReference)
        ));
        crate::handlers::discovery::withdraw_number(State(st.clone()), bearer("bob"))
            .await
            .unwrap();
        assert!(
            matches!(
                sent(&st, "alice", &bob).await,
                Err(AppError::UnknownReference)
            ),
            "a number withdrawn names nobody"
        );
        set(&time, T0 + 28 * DAY);
        assert!(
            matches!(sent(&st, "alice", &own).await, Err(AppError::NotFindable)),
            "a proof run out invites nobody"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn joining_tells_the_inviter_the_account_and_only_then(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap().id;
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            r#"{"status":"pending"}"#
        );

        join(State(st.clone()), bearer("bob"), Path(id.clone()))
            .await
            .unwrap();
        join(State(st.clone()), bearer("bob"), Path(id.clone()))
            .await
            .expect("joining twice is joining once");

        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            format!(
                r#"{{"status":"claimed","claimed_user_id":"@bob:h","claimed_at":{T0},"entrant_user_id":"@bob:h"}}"#
            )
        );
        assert!(
            waiting_for(&st, "bob").await.is_empty(),
            "joined, it waits no more"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nobody_but_the_recipient_answers_and_nobody_but_the_inviter_reads(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap().id;

        for who in ["alice", "carol"] {
            assert!(matches!(
                join(State(st.clone()), bearer(who), Path(id.clone())).await,
                Err(AppError::InvitationInvalid)
            ));
            assert!(matches!(
                decline(State(st.clone()), bearer(who), Path(id.clone())).await,
                Err(AppError::InvitationInvalid)
            ));
        }
        for who in ["bob", "carol"] {
            assert!(matches!(
                status_of(&st, who, &id).await,
                Err(AppError::InvitationInvalid)
            ));
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invitation_runs_out_on_the_seventh_day(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap().id;

        set(&time, T0 + 7 * DAY - 1);
        assert_eq!(waiting_for(&st, "bob").await.len(), 1);
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            r#"{"status":"pending"}"#
        );

        set(&time, T0 + 7 * DAY);
        assert!(waiting_for(&st, "bob").await.is_empty());
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            r#"{"status":"expired"}"#
        );
        assert!(matches!(
            join(State(st.clone()), bearer("bob"), Path(id.clone())).await,
            Err(AppError::InvitationInvalid)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_refusal_reads_as_an_invitation_nobody_has_seen(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        let declined = sent(&st, "alice", &bob).await.unwrap().id;
        let unseen = sent(&st, "alice", &bob).await.unwrap().id;

        decline(State(st.clone()), bearer("bob"), Path(declined.clone()))
            .await
            .unwrap();

        assert_eq!(
            waiting_for(&st, "bob")
                .await
                .into_iter()
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            vec![unseen.clone()],
            "declined, it leaves the recipient's list"
        );
        assert!(matches!(
            join(State(st.clone()), bearer("bob"), Path(declined.clone())).await,
            Err(AppError::InvitationInvalid)
        ));
        for at in [T0, T0 + 7 * DAY - 1, T0 + 7 * DAY, T0 + 20 * DAY] {
            set(&time, at);
            assert_eq!(
                status_of(&st, "alice", &declined).await.unwrap(),
                status_of(&st, "alice", &unseen).await.unwrap(),
                "at {at}, the inviter cannot tell a refusal from an invitation nobody saw"
            );
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn who_invited_whom_is_forgotten_thirty_days_after_the_invitation_ended(
        pool: SqlitePool,
    ) {
        let (st, _, bob) = two_findable(pool).await;
        let claimed = sent(&st, "alice", &bob).await.unwrap().id;
        let _ran_out = sent(&st, "alice", &bob).await.unwrap().id;
        join(State(st.clone()), bearer("bob"), Path(claimed))
            .await
            .unwrap();
        let kept = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM delivered_invitations")
                .fetch_one(&st.pool)
                .await
                .unwrap()
        };

        assert_eq!(
            purge_ended(&st.pool, T0 + 30 * DAY - 1, 30).await.unwrap(),
            0
        );
        assert_eq!(
            purge_ended(&st.pool, T0 + 30 * DAY, 30).await.unwrap(),
            1,
            "the one claimed at T0"
        );
        assert_eq!(kept().await, 1);
        assert_eq!(
            purge_ended(&st.pool, T0 + 37 * DAY, 30).await.unwrap(),
            1,
            "the one that ran out at T0 + 7 days"
        );
        assert_eq!(kept().await, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_service_has_nowhere_to_keep_the_conversation(pool: SqlitePool) {
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('delivered_invitations')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            columns,
            [
                "id",
                "inviter_user_id",
                "recipient_user_id",
                "sent_at",
                "expires_at",
                "claimed_at",
                "declined_at"
            ]
        );
    }
}
