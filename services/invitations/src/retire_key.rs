//! Retiring a masking key at once, after a theft or a loss (#409, ADR 0014).
//!
//! A planned change needs nothing of this: the new key joins `MASKING_KEYS`,
//! both serve 28 days while every renewed proof moves onto the new one, and
//! the old key leaves once no mask lives under it
//! (`deploy/messagr-eu-invitations.md`). This is the other gesture: a key that
//! must stop serving before its masks run out.
//!
//! # A MODE OF THE BINARY, AS THE NAMED DEACTIVATION IS
//!
//! `messagr-invitations --retire-masking-key <N>`, typed on the host. It binds
//! no port and starts no sweeper, so it runs beside the live service. `main`
//! reaches it before the start's guard (`keys_of_live_masks_are_held`), which
//! refuses to start while live masks were made with a key `MASKING_KEYS` no
//! longer holds: a lost key is exactly what this retires.
//!
//! # WHAT IT DOES, IN ONE TRANSACTION
//!
//! - every running proof made under key N ends. Its account stops being
//!   findable, and its reading says why (`key-changed`) until its next proof,
//!   thirty days at most, as ADR 0014 and #392 promise;
//! - every mask made under N goes: the ended proofs', the proofs in progress
//!   (dropped), the masks kept beside a proof in progress under another key,
//!   and the counts of #401, which nothing links to a number without the key;
//! - the date N was first served goes with it.
//!
//! Then the key leaves `MASKING_KEYS`, and the service restarts: the operator
//! does that, and the document says how.
//!
//! # NOTHING IS WRITTEN BEFORE THE PLAN IS SAID AND THE KEY NUMBER TYPED BACK
//!
//! As for the named deactivation: a flag is typed by reflex, a key number
//! cannot be typed back without reading the plan, and the end of stdin is a
//! refusal, so a pasted runbook or a pipeline finds no way through. Answered
//! with anything else, the command is its own census: it says what it would
//! end, and writes nothing.

use sqlx::SqlitePool;

/// The flag that selects this mode. Anything starting with it selects it too,
/// for the reason `operator::named_after` gives.
pub const THE_FLAG: &str = "--retire-masking-key";

/// What the retirement ended, once done.
#[derive(Debug, PartialEq, Eq)]
pub struct Retired {
    /// The running proofs made under the key: accounts findable no more.
    pub ended: u64,
    /// The proofs in progress under the key, dropped.
    pub dropped: u64,
}

/// The one key number named, or why not: exactly one, and a number.
fn the_one_key_number(named: &[String]) -> Result<u32, String> {
    match named {
        [one] => one
            .trim()
            .parse()
            .map_err(|_| format!("{one:?} is not a key number: name the key as MASKING_KEYS does")),
        [] => Err("name the key number to retire: one, and only one".into()),
        _ => Err("one key at a time: name only one key number".into()),
    }
}

/// The whole gesture, with the asking injected so that a test can drive it,
/// and assert that nothing was written without it.
pub async fn run<A>(
    pool: &SqlitePool,
    named: &[String],
    keys: Option<&crate::masking::MaskingKeys>,
    now: i64,
    ask: A,
) -> Result<Retired, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    let key_id = the_one_key_number(named)?;
    let unreadable = |e: sqlx::Error| format!("key #{key_id}: the database could not be read: {e}");
    let findable: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM findable_numbers \
         WHERE key_id = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(i64::from(key_id))
    .bind(now)
    .fetch_one(pool)
    .await
    .map_err(unreadable)?;
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_proofs WHERE key_id = ?")
        .bind(i64::from(key_id))
        .fetch_one(pool)
        .await
        .map_err(unreadable)?;

    // THE CURRENT KEY IS RETIRED WITH THE SERVICE STOPPED: while it runs, it
    // goes on making proofs under that key, which the start would then find
    // without their key (`deploy/messagr-eu-invitations.md`).
    let current = keys.is_some_and(|keys| keys.current().id() == key_id);
    let stop_first = if current {
        format!(
            "Key #{key_id} is the current key of MASKING_KEYS: the service must be stopped \
             while it is retired, and MASKING_KEYS given a new key with a higher number before \
             the service starts again.\n"
        )
    } else {
        String::new()
    };
    let plan = format!(
        "Retiring masking key #{key_id} at once. Every mask and count made under it is \
         erased.\n\
         Findable accounts that stop being findable until their next proof, and read that \
         the key changed: {findable}.\n\
         Proofs in progress dropped: {pending}.\n\
         {stop_first}\
         Type the key number to retire it, or anything else to leave everything as it is:"
    );
    if !crate::operator::typed_back(ask(&plan).as_deref(), &key_id.to_string()) {
        return Err(format!(
            "key #{key_id} was not retired: nothing was written"
        ));
    }

    let unwritten = |e: sqlx::Error| format!("key #{key_id}: nothing was retired: {e}");
    let mut tx = pool.begin().await.map_err(unwritten)?;
    // WHAT IS SAID AFTERWARDS IS WHAT THE TRANSACTION DID, not the plan's
    // counts: the service may have moved in between.
    let ended = sqlx::query(
        "INSERT INTO retired_key_proofs (user_id, retired_at) \
         SELECT user_id, ? FROM findable_numbers \
         WHERE key_id = ? AND withdrawn_at IS NULL AND expires_at > ? \
         ON CONFLICT(user_id) DO UPDATE SET retired_at = excluded.retired_at",
    )
    .bind(now)
    .bind(i64::from(key_id))
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(unwritten)?
    .rows_affected();
    let dropped = sqlx::query("DELETE FROM pending_proofs WHERE key_id = ?")
        .bind(i64::from(key_id))
        .execute(&mut *tx)
        .await
        .map_err(unwritten)?
        .rows_affected();
    for erased in [
        "DELETE FROM findable_numbers WHERE key_id = ?",
        "DELETE FROM pending_proof_masks WHERE key_id = ?",
        "DELETE FROM masking_counts WHERE key_id = ?",
        "DELETE FROM masking_extensions WHERE key_id = ?1 OR extension_key = ?1",
        "DELETE FROM masking_keys_served WHERE key_id = ?",
    ] {
        sqlx::query(erased)
            .bind(i64::from(key_id))
            .execute(&mut *tx)
            .await
            .map_err(unwritten)?;
    }
    tx.commit().await.map_err(unwritten)?;
    Ok(Retired { ended, dropped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::discovery::test_support::*;
    use crate::handlers::discovery::{directory, keys_of_live_masks_are_held, Ended};
    use axum::extract::State;

    fn named(key: &str) -> Vec<String> {
        vec![key.to_string()]
    }

    /// Alice proven under key #1; then, with keys #1 and #2, Bob proven under
    /// #2 and Carol's proof in progress, masked under both.
    async fn a_key_change_under_way(
        pool: &SqlitePool,
    ) -> (
        std::sync::Arc<crate::AppState>,
        std::sync::Arc<std::sync::Mutex<Inbox>>,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        prove(&two_keys, &inbox, "bob", OTHER).await;
        start(&two_keys, "carol", "+33611111111").await.unwrap();
        (two_keys, inbox)
    }

    async fn count(pool: &SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn retiring_a_key_ends_its_proofs_and_says_why_to_their_accounts(pool: SqlitePool) {
        let (st, _) = a_key_change_under_way(&pool).await;
        let asked = std::cell::Cell::new(String::new());

        let retired = run(&pool, &named("1"), None, st.cfg.clock.now(), |plan| {
            asked.set(plan.to_string());
            Some("1\n".into())
        })
        .await;

        assert_eq!(
            retired,
            Ok(Retired {
                ended: 1,
                dropped: 0
            })
        );
        assert!(
            asked.take().contains("read that the key changed: 1."),
            "the plan first"
        );
        assert_eq!(reading(&st, "alice").await.findable_until, None);
        assert_eq!(reading(&st, "alice").await.ended, Some(Ended::KeyChanged));
        assert!(
            reading(&st, "bob").await.findable_until.is_some(),
            "under #2"
        );
        let listed = directory(State(st.clone()), bearer("bob")).await.unwrap().0;
        assert_eq!(
            listed
                .entries
                .iter()
                .map(|e| e.key_number)
                .collect::<Vec<_>>(),
            vec![2]
        );
        // Carol's proof in progress is under #2: only its mask under #1 goes.
        let under_one: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pending_proof_masks WHERE key_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(under_one, 0);
        assert_eq!(count(&pool, "pending_proofs").await, 1);
        // And the start no longer needs key #1.
        let only_two =
            crate::masking::MaskingKeys::new(vec![crate::masking::MaskingKey::from_seed(
                2,
                &[0x02; 32],
            )
            .unwrap()])
            .unwrap();
        keys_of_live_masks_are_held(&pool, Some(&only_two), st.cfg.clock.now())
            .await
            .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn it_drops_the_proofs_in_progress_and_the_counts_made_under_the_key(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        start(&st, "dave", NUMBER).await.unwrap();
        sqlx::query(
            "INSERT INTO masking_counts (key_id, mask, day, masked) VALUES (1, x'01', 0, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let retired = run(&pool, &named("1"), None, st.cfg.clock.now(), |_| {
            Some("1".into())
        })
        .await;

        assert_eq!(
            retired,
            Ok(Retired {
                ended: 0,
                dropped: 1
            })
        );
        assert_eq!(count(&pool, "pending_proofs").await, 0);
        assert_eq!(count(&pool, "masking_counts").await, 0);
        assert_eq!(count(&pool, "masking_keys_served").await, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nothing_is_retired_without_the_key_number_typed_back(pool: SqlitePool) {
        let (st, _) = a_key_change_under_way(&pool).await;

        for answer in [None, Some("yes"), Some("2"), Some("")] {
            let refused = run(&pool, &named("1"), None, st.cfg.clock.now(), |_| {
                answer.map(Into::into)
            })
            .await;
            assert!(refused.is_err(), "{answer:?}");
        }

        assert!(reading(&st, "alice").await.findable_until.is_some());
        assert_eq!(count(&pool, "retired_key_proofs").await, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn one_key_number_is_named_and_nothing_else(pool: SqlitePool) {
        for named in [vec![], vec!["1".into(), "2".into()], vec!["un".into()]] {
            let refused = run(&pool, &named, None, T0, |_| panic!("asked for {named:?}")).await;
            assert!(refused.is_err(), "{named:?}");
        }
        let argv = |line: &str| line.split(' ').map(String::from).collect::<Vec<_>>();
        let selects = |line: &str| crate::operator::named_after(&argv(line), THE_FLAG);
        assert_eq!(selects("messagr-invitations"), None);
        assert_eq!(
            selects("messagr-invitations --retire-masking-key 3 --yes"),
            Some(vec!["3".to_string()])
        );
        assert_eq!(
            selects("messagr-invitations --retire-masking-key=3"),
            Some(vec![]),
            "a near miss on the flag is refused, not started as a service"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_plan_says_to_stop_the_service_before_retiring_the_current_key(pool: SqlitePool) {
        let (st, _) = a_key_change_under_way(&pool).await;
        let keys = keys_one_and_two();
        let plan_for = |key: &str| {
            let said = std::cell::RefCell::new(String::new());
            let named = named(key);
            let pool = pool.clone();
            let keys = keys.clone();
            let now = st.cfg.clock.now();
            async move {
                let _ = run(&pool, &named, Some(&keys), now, |plan| {
                    *said.borrow_mut() = plan.to_string();
                    None
                })
                .await;
                said.into_inner()
            }
        };

        assert!(
            plan_for("2").await.contains("must be stopped"),
            "#2 is current"
        );
        assert!(!plan_for("1").await.contains("must be stopped"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_the_retirement_ended_proves_again_as_a_renewal(pool: SqlitePool) {
        // The owner's decision of 27 September 2026: the service stopped these
        // proofs, and no country's ceiling nor the budget may keep them
        // unfindable (#392, story 80).
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool.clone(),
            hs.clone(),
            crate::config::Config {
                sms_ceilings: crate::config::SmsCeilings {
                    per_country_day: 1,
                    ..crate::config::SmsCeilings::default()
                },
                ..discovery_config(&hs, Some(ovh), clock)
            },
        );
        prove(&st, &inbox, "alice", NUMBER).await;
        run(&pool, &named("1"), None, T0, |_| Some("1".into()))
            .await
            .unwrap();

        assert!(
            matches!(
                start(&st, "bob", OTHER).await,
                Err(crate::error::AppError::SmsLater)
            ),
            "a new proof waits behind the country's ceiling"
        );
        start(&st, "alice", NUMBER)
            .await
            .expect("the account the retirement ended goes through");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_next_proof_ends_what_the_retirement_said(pool: SqlitePool) {
        let (st, inbox) = a_key_change_under_way(&pool).await;
        run(&pool, &named("1"), None, st.cfg.clock.now(), |_| {
            Some("1".into())
        })
        .await
        .unwrap();

        prove(&st, &inbox, "alice", NUMBER).await;

        let now = reading(&st, "alice").await;
        assert!(now.findable_until.is_some());
        assert_eq!(now.ended, None);
    }
}
