use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

/// Opens the database and brings its schema up to date.
///
/// # Why migrations may be missing, and why that is not a mistake
///
/// `set_ignore_missing(true)` allows a database to carry migrations this
/// build does not have. That is normally a mistake to refuse loudly, and here
/// it is a fact to accommodate: **this service is the previous one with the
/// blind directory removed**, so 003 through 007 -- `annuaire_aveugle`,
/// `quota_annuaire`, `cle_annuaire`, `rachat_jeton`, `fenetre_glissante` --
/// ran on every existing deployment and exist nowhere here.
///
/// Without this, the service starts, reads the version table, and refuses
/// with *"migration 3 was previously applied but is missing in the resolved
/// migrations"*. It then restart-loops. Watched on the bench, which is how
/// this was found (#108).
///
/// # What it does not excuse
///
/// A migration missing because somebody deleted the wrong file is the same
/// error and would now pass. The protection against that is that this list is
/// closed and written down: five numbers, one removed feature, one ticket. A
/// sixth appearing is a thing to explain, not to tolerate.
///
/// # And the tables they made are gone since 010
///
/// Tolerating the migrations was not dropping the tables they made:
/// `discovery_claims`, `discovery_quota`, `discovery_quota_key`,
/// `discovery_keys` and `discovery_usage_spent` stayed until address-book
/// discovery came back (#397). In production they had been empty since
/// 15 September 2026; migration 010 drops them, and discovery's own tables
/// take none of their names.
pub async fn connect(url: &str) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await?;
    sqlx::migrate!("./migrations")
        .set_ignore_missing(true)
        .run(&pool)
        .await?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PRODUCTION'S SHAPE, REBUILT: this build's migrations up to 009, then
    /// the five tables the prototype's 003 to 007 made (which exist nowhere
    /// here), then the whole list as `connect` runs it.
    #[sqlx::test(migrations = false)]
    async fn migration_010_drops_the_prototype_s_tables(pool: SqlitePool) {
        let mut before = sqlx::migrate!("./migrations");
        before.migrations = before
            .migrations
            .iter()
            .filter(|m| m.version < 10)
            .cloned()
            .collect::<Vec<_>>()
            .into();
        before.run(&pool).await.unwrap();
        let prototype = [
            "discovery_claims",
            "discovery_quota",
            "discovery_quota_key",
            "discovery_keys",
            "discovery_usage_spent",
        ];
        for table in prototype {
            sqlx::query(&format!("CREATE TABLE {table} (kept BLOB)"))
                .execute(&pool)
                .await
                .unwrap();
        }

        sqlx::migrate!("./migrations")
            .set_ignore_missing(true)
            .run(&pool)
            .await
            .unwrap();

        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
                .fetch_all(&pool)
                .await
                .unwrap();
        for table in prototype {
            assert!(!tables.iter().any(|t| t == table), "{table} survived");
        }
        for table in ["findable_numbers", "pending_proofs"] {
            assert!(tables.iter().any(|t| t == table), "{table} is missing");
        }
    }
}
