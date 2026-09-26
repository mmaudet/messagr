use base64::{engine::general_purpose::STANDARD, Engine};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing environment variable: {0}")]
    Missing(&'static str),
    #[error("the encryption key must be exactly 32 bytes once decoded")]
    InvalidKey,
    /// Why `MASKING_KEYS` was refused: a sentence about its shape, never a
    /// piece of it.
    #[error("MASKING_KEYS is unusable: {0}")]
    InvalidMaskingKeys(&'static str),
    #[error("the SMS provider is half configured: {0} is missing")]
    IncompleteSmsProvider(&'static str),
    #[error("OVH_API_URL must be OVHcloud's European API outside the bench")]
    SmsProviderNotOvhcloud,
    #[error("DISCOVERY_COUNTRIES is unusable: {0}")]
    InvalidCountries(&'static str),
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
    /// The keys that mask the numbers of address-book discovery (#396).
    /// `None` while a deployment has not been given them: discovery stays off
    /// and the log says so. See `masking_keys`.
    pub masking_keys: Option<std::sync::Arc<crate::masking::MaskingKeys>>,
    /// Who sends the SMS that proves a number (#397). `None` while a
    /// deployment has not been given an OVHcloud account: discovery stays
    /// off. See `sms_provider`.
    pub sms_provider: Option<crate::sms::Ovhcloud>,
    /// The countries whose numbers can be proved, each with its provider
    /// (#397). See `discovery_countries`.
    pub countries: Vec<crate::countries::Country>,
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

/// The masking keys, from `MASKING_KEYS`: `<key number>:<base64 seed>`,
/// separated by commas. Or nothing, with two answers of different weight.
///
/// Absent or blank, discovery stays off and the service starts: a deployment
/// that has not been given the keys yet goes on serving invitations, and every
/// deployment of this service before discovery ships is one. Present but
/// malformed, the service refuses to start: a typo in a key is not a choice to
/// leave discovery off, and serving with a key other than the one meant would
/// make every mask already kept unreadable. The refusal names the variable and
/// the shape it expects, never a piece of the value.
pub fn masking_keys(
    raw: Option<String>,
) -> Result<Option<std::sync::Arc<crate::masking::MaskingKeys>>, ConfigError> {
    use crate::masking::{MaskingKey, MaskingKeys};
    let Some(value) = raw.filter(|v| !v.trim().is_empty()) else {
        return Ok(None);
    };
    let unusable = ConfigError::InvalidMaskingKeys;
    let mut keys: Vec<MaskingKey> = Vec::new();
    for entry in value.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let not_an_entry = || unusable("an entry is not <key number>:<base64 seed>");
        let (number, seed) = entry.split_once(':').ok_or_else(not_an_entry)?;
        let id: u32 = number.trim().parse().map_err(|_| not_an_entry())?;
        let seed = Config::parse_key(seed.trim())
            .map_err(|_| unusable("a seed is not 32 bytes of base64"))?;
        if keys.iter().any(|k| k.id() == id) {
            return Err(unusable("a key number appears twice"));
        }
        keys.push(
            MaskingKey::from_seed(id, &seed)
                .map_err(|_| unusable("a key could not be derived from its seed"))?,
        );
    }
    MaskingKeys::new(keys)
        .map(|keys| Some(std::sync::Arc::new(keys)))
        .ok_or(unusable("it names no key"))
}

/// The OVHcloud account that sends proofs, or nothing, read through `var` so
/// that it can be tested without touching the process's environment.
///
/// All four of its credentials, or none: none leaves discovery off, some of
/// them stop the start, naming the first one missing, since a half-given
/// account is a deployment mistake and not a choice. The address is
/// OVHcloud's European API; another one (the bench's fake provider) is taken
/// only when `SMS_PROVIDER_FOR_TESTS=1` says so, and only on this host
/// (`stays_on_the_host`).
pub fn sms_provider(
    var: impl Fn(&str) -> Option<String>,
) -> Result<Option<crate::sms::Ovhcloud>, ConfigError> {
    let given = |key| var(key).filter(|v| !v.trim().is_empty());
    const NEEDED: [&str; 4] = [
        "OVH_APPLICATION_KEY",
        "OVH_APPLICATION_SECRET",
        "OVH_CONSUMER_KEY",
        "OVH_SMS_SERVICE",
    ];
    let values: Vec<Option<String>> = NEEDED.iter().map(|k| given(k)).collect();
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    if let Some(missing) = NEEDED.iter().zip(&values).find(|(_, v)| v.is_none()) {
        return Err(ConfigError::IncompleteSmsProvider(missing.0));
    }
    let base_url = given("OVH_API_URL").unwrap_or_else(|| crate::sms::OVHCLOUD_EUROPE.into());
    let bench = given("SMS_PROVIDER_FOR_TESTS").as_deref() == Some("1");
    if base_url != crate::sms::OVHCLOUD_EUROPE && !(bench && stays_on_the_host(&base_url)) {
        return Err(ConfigError::SmsProviderNotOvhcloud);
    }
    let mut values = values.into_iter().map(Option::unwrap);
    Ok(Some(crate::sms::Ovhcloud {
        base_url,
        application_key: values.next().unwrap(),
        application_secret: values.next().unwrap(),
        consumer_key: values.next().unwrap(),
        service_name: values.next().unwrap(),
        sender: given("SMS_SENDER").unwrap_or_else(|| "Messagr".into()),
    }))
}

/// Whether an address can only reach this host or a container beside it: the
/// loopback, or a name without a dot, which only a Docker network resolves.
///
/// THE BENCH'S FLAG IS NOT ENOUGH ON ITS OWN. It sits in the same environment
/// file as everything else, so a bench file copied to the wrong host would
/// carry it; what it cannot carry is a fake provider that answers from the
/// internet. So even on the bench, a number never leaves the host except for
/// OVHcloud.
fn stays_on_the_host(address: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(address) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    matches!(url.scheme(), "http" | "https")
        && match host.parse::<std::net::IpAddr>() {
            Ok(ip) => ip.is_loopback(),
            Err(_) => host == "localhost" || !host.contains('.'),
        }
}

/// The countries open to discovery: `DISCOVERY_COUNTRIES` when it is given,
/// the launch list otherwise (`countries`). A malformed setting stops the
/// start, like a malformed key: a typo is not a choice to close every country.
pub fn discovery_countries(
    raw: Option<String>,
) -> Result<Vec<crate::countries::Country>, ConfigError> {
    match raw.filter(|v| !v.trim().is_empty()) {
        None => Ok(crate::countries::launch_list()),
        Some(value) => crate::countries::parse(&value).map_err(ConfigError::InvalidCountries),
    }
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
            masking_keys: masking_keys(std::env::var("MASKING_KEYS").ok())?,
            sms_provider: sms_provider(|key| std::env::var(key).ok())?,
            countries: discovery_countries(std::env::var("DISCOVERY_COUNTRIES").ok())?,
        })
    }

    /// The configuration every test starts from, changing only what it needs
    /// with `Config { push_gateway_url: gateway, ..Config::for_tests() }`
    /// (#393). A new setting gets its test value here, once, rather than in
    /// every test that builds a state.
    ///
    /// There is no push gateway, so a test that does not set one cannot come
    /// to depend on something reachable. The homeserver a test talks to is the
    /// `MatrixClient` it builds itself: the URL here is never read by a test.
    #[cfg(test)]
    pub fn for_tests() -> Self {
        Config {
            database_url: String::new(),
            homeserver_url: "http://127.0.0.1:1".into(),
            registration_token: "token".into(),
            encryption_key: [0u8; 32],
            edge_retention_days: 30,
            bind_addr: String::new(),
            max_reserved_accounts_per_inviter: DEFAULT_RESERVED_ACCOUNTS_CEILING,
            push_gateway_url: None,
            masking_keys: None,
            sms_provider: None,
            countries: crate::countries::launch_list(),
        }
    }

    /// The keys and the SMS provider of address-book discovery, or what is
    /// missing. Discovery serves with both or not at all: one without the
    /// other would mask numbers nobody can prove, or prove numbers nobody can
    /// mask. The one place that rule is written.
    pub fn discovery(
        &self,
    ) -> Result<(&crate::masking::MaskingKeys, &crate::sms::Ovhcloud), &'static str> {
        match (&self.masking_keys, &self.sms_provider) {
            (Some(keys), Some(provider)) => Ok((keys, provider)),
            (None, _) => Err("MASKING_KEYS absent"),
            (_, None) => Err("no SMS provider"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_SEED: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key| owned.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    const OVH: &[(&str, &str)] = &[
        ("OVH_APPLICATION_KEY", "ak"),
        ("OVH_APPLICATION_SECRET", "as"),
        ("OVH_CONSUMER_KEY", "ck"),
        ("OVH_SMS_SERVICE", "sms-ab12345-1"),
    ];

    #[test]
    fn no_sms_provider_leaves_discovery_off() {
        assert!(sms_provider(env(&[])).unwrap().is_none());
    }

    #[test]
    fn a_complete_sms_provider_is_ovhcloud_in_europe_by_default() {
        let provider = sms_provider(env(OVH))
            .unwrap()
            .expect("the provider is loaded");
        assert_eq!(provider.base_url, crate::sms::OVHCLOUD_EUROPE);
        assert_eq!(provider.sender, "Messagr");
        assert_eq!(provider.service_name, "sms-ab12345-1");
    }

    #[test]
    fn half_a_provider_stops_the_start_and_names_what_is_missing() {
        let refused = sms_provider(env(&OVH[..3])).expect_err("half a provider is refused");
        assert!(refused.to_string().contains("OVH_SMS_SERVICE"), "{refused}");
    }

    #[test]
    fn another_address_than_ovhcloud_is_refused_outside_the_bench() {
        let mut elsewhere = OVH.to_vec();
        elsewhere.push(("OVH_API_URL", "http://fake-sms:8080"));
        assert!(sms_provider(env(&elsewhere)).is_err());

        elsewhere.push(("SMS_PROVIDER_FOR_TESTS", "1"));
        let bench = sms_provider(env(&elsewhere)).unwrap().unwrap();
        assert_eq!(bench.base_url, "http://fake-sms:8080");
    }

    #[test]
    fn on_the_bench_the_fake_provider_stays_on_the_host() {
        for (address, kept) in [
            ("http://fake-sms:8080", true),
            ("http://127.0.0.1:9999/1.0", true),
            ("http://localhost:9999", true),
            ("https://sms.example.net/1.0", false),
            ("http://203.0.113.7:8080", false),
            ("not an address", false),
        ] {
            let mut bench = OVH.to_vec();
            bench.push(("OVH_API_URL", address));
            bench.push(("SMS_PROVIDER_FOR_TESTS", "1"));
            assert_eq!(sms_provider(env(&bench)).is_ok(), kept, "{address}");
        }
    }

    #[test]
    fn absent_masking_keys_leave_discovery_off() {
        // Not a refusal to start: a deployment that has not given the keys
        // yet serves invitations as before, and the log says discovery is off.
        assert!(masking_keys(None).unwrap().is_none());
        assert!(masking_keys(Some("   ".into())).unwrap().is_none());
    }

    #[test]
    fn malformed_masking_keys_stop_the_start_without_showing_them() {
        let refused = masking_keys(Some("1:not-a-seed".into()));
        let said = refused
            .expect_err("a malformed setting is refused")
            .to_string();
        assert!(said.contains("MASKING_KEYS"), "{said}");
        assert!(!said.contains("not-a-seed"), "{said}");
    }

    #[test]
    fn without_a_setting_the_launch_countries_are_open() {
        let open = discovery_countries(None).unwrap();
        assert!(open.iter().any(|c| c.code == "FR"));
        assert!(open.iter().all(|c| c.code != "IT"), "Italy waits");
        assert_eq!(discovery_countries(Some("  ".into())).unwrap(), open);
    }

    #[test]
    fn a_setting_replaces_the_launch_countries_and_a_malformed_one_stops_the_start() {
        let open = discovery_countries(Some("IT:39:ovhcloud".into())).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].code, "IT");
        let refused = discovery_countries(Some("IT:39".into()))
            .expect_err("a malformed setting is refused")
            .to_string();
        assert!(
            refused.starts_with("DISCOVERY_COUNTRIES is unusable: "),
            "{refused}"
        );
    }

    #[test]
    fn well_formed_masking_keys_are_loaded() {
        let keys = masking_keys(Some(format!("3:{ONE_SEED}")))
            .unwrap()
            .expect("the keys are loaded");
        assert_eq!(keys.current().id(), 3);
    }

    #[test]
    fn the_environment_names_each_key_by_its_key_number() {
        let two = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="; // 32 × 0x02
        let keys = masking_keys(Some(format!("2:{two}, 1:{ONE_SEED}")))
            .unwrap()
            .expect("the keys are loaded");

        assert_eq!(keys.len(), 2);
        assert_eq!(keys.current().id(), 2, "the highest key number is current");
        assert_eq!(keys.get(1).map(|k| k.id()), Some(1));
    }

    #[test]
    fn a_malformed_setting_is_refused_without_showing_a_seed() {
        // EVERY INPUT CARRIES A SEED, so that the check below could fail on
        // each of them: a refusal that echoed its input would show `AQEB`.
        let seed = &ONE_SEED[..4];
        assert_eq!(seed, "AQEB");
        for bad in [
            ONE_SEED.to_string(),
            format!("x:{ONE_SEED}"),
            format!("1:{ONE_SEED}!"),
            "1:AQEB".to_string(),
            format!("1:{ONE_SEED},1:{ONE_SEED}"),
            format!("1:{ONE_SEED},2"),
        ] {
            let said = masking_keys(Some(bad.clone()))
                .expect_err(&format!("{bad:?} must be refused"))
                .to_string();
            assert!(said.starts_with("MASKING_KEYS is unusable: "), "{said}");
            assert!(!said.contains(seed), "{bad:?} shows its seed: {said}");
        }
        // A setting of commas alone carries nothing to show, and names no key.
        assert!(masking_keys(Some(" , ".into())).is_err());
    }

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
