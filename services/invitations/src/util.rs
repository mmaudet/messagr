//! Small utilities shared by the handlers and the cleanup — previously
//! duplicated (the timestamp identically in three handlers and inline in
//! `cleanup.rs`, the localpart derivation five times).

/// Current Unix timestamp, in seconds.
pub fn now() -> i64 {
    std::time::UNIX_EPOCH.elapsed().unwrap().as_secs() as i64
}

/// What time it is, for the routes that must be tested at another time.
///
/// The system's clock everywhere but in tests, which move it by hand: a proof
/// runs out on its 28th day, and no test waits 28 days. Carried by the
/// configuration, which every test already builds (`Config::for_tests`).
#[derive(Clone)]
pub struct Clock(std::sync::Arc<dyn Fn() -> i64 + Send + Sync>);

impl Clock {
    pub fn system() -> Self {
        Clock(std::sync::Arc::new(now))
    }

    /// A clock that reads what the test stores in it.
    #[cfg(test)]
    pub fn settable(start: i64) -> (Self, std::sync::Arc<std::sync::atomic::AtomicI64>) {
        let time = std::sync::Arc::new(std::sync::atomic::AtomicI64::new(start));
        let read = time.clone();
        (
            Clock(std::sync::Arc::new(move || {
                read.load(std::sync::atomic::Ordering::SeqCst)
            })),
            time,
        )
    }

    pub fn now(&self) -> i64 {
        (self.0)()
    }
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
