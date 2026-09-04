//! Small utilities shared by the handlers and the cleanup — previously
//! duplicated (the timestamp identically in three handlers and inline in
//! `cleanup.rs`, the localpart derivation five times).

/// Current Unix timestamp, in seconds.
pub fn now() -> i64 {
    std::time::UNIX_EPOCH.elapsed().unwrap().as_secs() as i64
}

/// Derives the localpart (the part before `:`) from a full Matrix identifier
/// `@localpart:server`.
pub fn localpart(user_id: &str) -> String {
    user_id
        .trim_start_matches('@')
        .split(':')
        .next()
        .unwrap_or_default()
        .to_string()
}
