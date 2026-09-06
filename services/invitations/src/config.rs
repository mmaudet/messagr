use base64::{engine::general_purpose::STANDARD, Engine};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing environment variable: {0}")]
    Missing(&'static str),
    #[error("the encryption key must be exactly 32 bytes once decoded")]
    InvalidKey,
}

/// Default ceiling on accounts reserved simultaneously in the charge of a
/// single caller.
///
/// Conservative by design: two full pools (`MAX_USES` = 10). The 6 August
/// trials alone had created 28 permanent accounts — this value would have
/// stopped them. A deployment that needs more says so explicitly through
/// `MAX_RESERVED_ACCOUNTS_PER_INVITER`; the absence of a setting must never
/// mean the absence of a ceiling.
pub const DEFAULT_RESERVED_ACCOUNTS_CEILING: i64 = 20;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub homeserver_url: String,
    pub registration_token: String,
    pub encryption_key: [u8; 32],
    pub edge_retention_days: i64,
    pub bind_addr: String,
    /// Maximum number of reserved accounts an authenticated caller may hold
    /// simultaneously in its charge. See the "What a caller's charge is"
    /// section of `handlers::create` for the exact definition of "in its
    /// charge".
    pub max_reserved_accounts_per_inviter: i64,
    /// Where a stripped push notification is forwarded. `None` on a
    /// deployment that carries no push gateway, which is not an error --
    /// `handlers::wake` says what it answers then and why.
    pub push_gateway_url: Option<String>,
}

/// Reads the ceiling, or falls back to the conservative default.
///
/// A separate function, rather than an expression buried in `from_env`, so it
/// can be tested without mutating the test process's environment.
///
/// Any unusable value — absent, non-numeric, negative — falls back to
/// `DEFAULT_RESERVED_ACCOUNTS_CEILING`. That is the point of the guard: a typo
/// in the environment file must never result in a service without a ceiling.
/// Zero is still accepted as-is: it is an explicit circuit breaker, not a
/// data-entry error.
pub fn reserved_accounts_ceiling(raw: Option<String>) -> i64 {
    raw.and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|n| *n >= 0)
        .unwrap_or(DEFAULT_RESERVED_ACCOUNTS_CEILING)
}

/// The forward address, or nothing, with the same posture as the ceiling
/// above: an unusable value is refused rather than passed on.
///
/// Every push this deployment sends leaves by this URL. A scheme-less string
/// would make `reqwest` refuse at send time, once per notification, with the
/// failure appearing as a push that never arrives -- and plain `http` to a
/// host that is not the loopback would put the device tokens of everybody on
/// this instance on the wire in clear.
///
/// `http://` is allowed to `localhost` and `127.0.0.1` only, because that is
/// how sygnal is actually reached: a container on the same host, over a
/// network no one else is on. Anywhere else it must be `https`.
pub fn usable_gateway(raw: Option<String>) -> Option<String> {
    let url = raw?.trim().to_owned();
    if url.is_empty() {
        return None;
    }
    if url.starts_with("https://") {
        return Some(url);
    }
    let local = url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("http://messagr-sygnal");
    if url.starts_with("http://") && local {
        return Some(url);
    }
    // Dropped rather than accepted. `handlers::wake` answers "delivered,
    // nothing to clean up" when there is no gateway, which is the least wrong
    // thing a gateway with nowhere to send can say -- and a great deal better
    // than sending tokens somewhere unencrypted.
    None
}

impl Config {
    pub fn parse_key(b64: &str) -> Result<[u8; 32], ConfigError> {
        let raw = STANDARD.decode(b64).map_err(|_| ConfigError::InvalidKey)?;
        raw.try_into().map_err(|_| ConfigError::InvalidKey)
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        fn var(k: &'static str) -> Result<String, ConfigError> {
            std::env::var(k).map_err(|_| ConfigError::Missing(k))
        }
        Ok(Config {
            database_url: var("DATABASE_URL")?,
            homeserver_url: var("HOMESERVER_URL")?,
            registration_token: var("REGISTRATION_TOKEN")?,
            encryption_key: Self::parse_key(&var("ENCRYPTION_KEY")?)?,
            edge_retention_days: std::env::var("EDGE_RETENTION_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8090".into()),
            max_reserved_accounts_per_inviter: reserved_accounts_ceiling(
                std::env::var("MAX_RESERVED_ACCOUNTS_PER_INVITER").ok(),
            ),
            // Absent rather than defaulted. A default would point this at
            // somewhere, and the somewhere a push gateway forwards to is not
            // a thing to guess.
            push_gateway_url: usable_gateway(std::env::var("PUSH_GATEWAY_URL").ok()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gateway_over_tls_is_kept() {
        assert_eq!(
            usable_gateway(Some("https://push.example/_matrix/push/v1/notify".into())),
            Some("https://push.example/_matrix/push/v1/notify".into())
        );
    }

    #[test]
    fn a_gateway_on_the_loopback_may_be_plain() {
        // How sygnal is actually reached: a container on the same host, over
        // a network nobody else is on.
        for local in [
            "http://localhost:5000/_matrix/push/v1/notify",
            "http://127.0.0.1:5000/_matrix/push/v1/notify",
            "http://messagr-sygnal:5000/_matrix/push/v1/notify",
        ] {
            assert!(usable_gateway(Some(local.into())).is_some(), "{local}");
        }
    }

    #[test]
    fn a_plain_gateway_anywhere_else_is_refused() {
        // It would put the device tokens of everybody on this instance on the
        // wire in clear, and whoever holds a token can wake that device.
        assert_eq!(
            usable_gateway(Some("http://push.example/_matrix/push/v1/notify".into())),
            None
        );
    }

    #[test]
    fn a_value_with_no_scheme_is_refused() {
        // reqwest would refuse it at send time instead, once per
        // notification, appearing as a push that never arrives.
        assert_eq!(usable_gateway(Some("push.example/notify".into())), None);
    }

    #[test]
    fn absent_blank_and_whitespace_all_mean_no_gateway() {
        assert_eq!(usable_gateway(None), None);
        assert_eq!(usable_gateway(Some(String::new())), None);
        assert_eq!(usable_gateway(Some("   ".into())), None);
    }

    #[test]
    fn surrounding_whitespace_does_not_make_a_url_unusable() {
        assert_eq!(
            usable_gateway(Some("  https://push.example/notify  ".into())),
            Some("https://push.example/notify".into())
        );
    }

    #[test]
    fn refuses_an_encryption_key_that_is_too_short() {
        let err = Config::parse_key("dGVzdA==").unwrap_err();
        assert!(matches!(err, ConfigError::InvalidKey));
    }

    #[test]
    fn accepts_a_32_byte_key() {
        let b64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        assert_eq!(Config::parse_key(b64).unwrap().len(), 32);
    }

    /// The ceiling is a safeguard: no unusable input must disable it or push
    /// it back. The property holds over the FAMILY of broken inputs, not over
    /// a particular case — variable absent, text, overflowing number, negative
    /// value: all fall back to the conservative default, never to a more
    /// permissive ceiling.
    #[test]
    fn an_unusable_ceiling_value_falls_back_to_the_conservative_default() {
        for broken in [
            None,
            Some("".to_string()),
            Some("plenty".to_string()),
            Some("10 accounts".to_string()),
            Some("3.5".to_string()),
            // Overflows i64: `parse` fails, it does not "saturate".
            Some("99999999999999999999".to_string()),
            Some("-1".to_string()),
            Some("-2000".to_string()),
        ] {
            assert_eq!(
                reserved_accounts_ceiling(broken.clone()),
                DEFAULT_RESERVED_ACCOUNTS_CEILING,
                "unusable input {broken:?}: the conservative default must apply"
            );
        }

        // Inseparable control: a usable value must indeed be kept, otherwise
        // the function could return the default in every circumstance and the
        // test above would pass for nothing.
        assert_eq!(reserved_accounts_ceiling(Some("7".into())), 7);
        assert_eq!(reserved_accounts_ceiling(Some("  7  ".into())), 7);
        // Explicit circuit breaker: zero is not a data-entry error.
        assert_eq!(reserved_accounts_ceiling(Some("0".into())), 0);
    }
}
