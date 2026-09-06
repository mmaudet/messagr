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
/// # The tables are still there, and that is deliberate
///
/// Tolerating the migrations is not dropping the tables they made. The live
/// database still holds `discovery_claims`, `discovery_quota`,
/// `discovery_quota_key`, `discovery_keys` and `discovery_usage_spent`, with
/// rows in them. Dropping them is irreversible and belongs in its own step,
/// after this service has run somewhere for long enough that "nothing asks
/// for the directory" is an observation rather than an expectation.
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
