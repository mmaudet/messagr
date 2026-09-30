//! Small utilities shared by the handlers and the cleanup — previously
//! duplicated (the timestamp identically in three handlers and inline in
//! `cleanup.rs`, the localpart derivation five times).

/// A day, in seconds: the window of the daily ceilings and limits.
pub const DAY_SECONDS: i64 = 86_400;

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

/// Midnight UTC of the day `at` falls on: the date a gesture of the operator
/// leaves on a report, and the date of every account deletion, never its
/// hour (#473).
pub fn day_of(at: i64) -> i64 {
    at - at.rem_euclid(DAY_SECONDS)
}

/// `at` as a date in UTC, `2026-10-01`.
pub fn date(at: i64) -> String {
    let (year, month, day) = civil(at.div_euclid(DAY_SECONDS));
    format!("{year:04}-{month:02}-{day:02}")
}

/// `at` in UTC to the minute, `2026-10-01 14:03 UTC`.
pub fn instant(at: i64) -> String {
    let seconds = at.rem_euclid(DAY_SECONDS);
    format!(
        "{} {:02}:{:02} UTC",
        date(at),
        seconds / 3_600,
        seconds % 3_600 / 60
    )
}

/// The civil date of a day counted from 1970-01-01, in the proleptic
/// Gregorian calendar (Howard Hinnant's `civil_from_days`).
pub fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let of_the_era = z.rem_euclid(146_097);
    let year_of_the_era =
        (of_the_era - of_the_era / 1_460 + of_the_era / 36_524 - of_the_era / 146_096) / 365;
    let day_of_the_year =
        of_the_era - (365 * year_of_the_era + year_of_the_era / 4 - year_of_the_era / 100);
    let shifted_month = (5 * day_of_the_year + 2) / 153;
    let day = day_of_the_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_the_era + era * 400 + i64::from(month <= 2);
    // Both are bounded by the arithmetic above: 1 to 31, and 1 to 12.
    (year, month as u32, day as u32)
}

/// Days from 1970-01-01 to a civil date: the inverse of `civil`, written
/// apart from it (Howard Hinnant's `days_from_civil`), for the tests that
/// check it and count calendar months with it.
#[cfg(test)]
pub(crate) fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_the_era = year.rem_euclid(400);
    let shifted = if month > 2 { month - 3 } else { month + 9 };
    let of_the_year = (153 * shifted + 2) / 5 + day - 1;
    let day_of_the_era = of_the_era * 365 + of_the_era / 4 - of_the_era / 100 + of_the_year;
    era * 146_097 + day_of_the_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_and_instants_are_written_in_utc() {
        // 1_790_000_000 is 2026-09-21 14:13:20 UTC.
        assert_eq!(date(1_790_000_000), "2026-09-21");
        assert_eq!(instant(1_790_000_000), "2026-09-21 14:13 UTC");
        assert_eq!(day_of(1_790_000_000), 1_789_948_800);
        assert_eq!(instant(day_of(1_790_000_000)), "2026-09-21 00:00 UTC");
        assert_eq!(date(0), "1970-01-01");
        // A leap day, and the day after.
        assert_eq!(
            date(days_from_civil(2028, 2, 29) * DAY_SECONDS),
            "2028-02-29"
        );
        assert_eq!(
            date(days_from_civil(2028, 3, 1) * DAY_SECONDS),
            "2028-03-01"
        );
    }

    #[test]
    fn civil_and_its_inverse_agree_on_every_day_of_four_centuries() {
        for days in days_from_civil(1900, 1, 1)..days_from_civil(2300, 1, 1) {
            let (year, month, day) = civil(days);
            assert_eq!(
                days_from_civil(year, i64::from(month), i64::from(day)),
                days,
                "{year}-{month}-{day}"
            );
        }
    }
}
