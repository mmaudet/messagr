//! The countries whose numbers can become findable (#392, Q35), each with the
//! provider that sends its proofs (Q24).
//!
//! # A SETTING, WITH THE LAUNCH LIST FOR DEFAULT
//!
//! #392 puts the list in the service's configuration: `DISCOVERY_COUNTRIES`,
//! `<ISO code>:<calling code>:<provider>`, separated by commas, read by
//! `config`. Absent, the launch list below serves: the European Union, the
//! European Economic Area, Switzerland and the United Kingdom, all through
//! OVHcloud. Italy, Denmark, Finland, Norway, Romania and Sweden are not in it:
//! OVHcloud asks for steps of its own for them, and they open when those steps
//! succeed.
//!
//! A country opens once its numbers cannot change hands within a proof's
//! lifetime, it is under no sanctions, its sender rules are met, the message
//! arrives intact and its price stays under a ceiling (Q35). That review comes
//! before the line is written, wherever it is written.

/// Who sends the SMS that proves a number, and is named to the person on the
/// number screen before anything is sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Ovhcloud,
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Provider::Ovhcloud => "OVHcloud",
        }
    }

    /// The provider a setting names, in lower case.
    fn from_setting(name: &str) -> Option<Self> {
        match name {
            "ovhcloud" => Some(Provider::Ovhcloud),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Country {
    /// ISO 3166-1 alpha-2.
    pub code: String,
    /// The calling code, without the `+`.
    pub prefix: String,
    pub provider: Provider,
}

/// An ISO 3166-1 alpha-2 code, two capitals and nothing else: all the
/// operator's SMS says of a country (#464).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CountryCode([u8; 2]);

impl CountryCode {
    pub fn new(code: &str) -> Option<CountryCode> {
        match code.as_bytes() {
            &[a, b] if a.is_ascii_uppercase() && b.is_ascii_uppercase() => {
                Some(CountryCode([a, b]))
            }
            _ => None,
        }
    }
}

impl std::fmt::Display for CountryCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let [a, b] = self.0.map(char::from);
        write!(f, "{a}{b}")
    }
}

/// The countries open at launch, all through OVHcloud.
const LAUNCH: &[(&str, &str)] = &[
    // The European Union, less Italy, Denmark, Finland, Romania and Sweden.
    ("AT", "43"),
    ("BE", "32"),
    ("BG", "359"),
    ("CY", "357"),
    ("CZ", "420"),
    ("DE", "49"),
    ("EE", "372"),
    ("ES", "34"),
    ("FR", "33"),
    ("GR", "30"),
    ("HR", "385"),
    ("HU", "36"),
    ("IE", "353"),
    ("LT", "370"),
    ("LU", "352"),
    ("LV", "371"),
    ("MT", "356"),
    ("NL", "31"),
    ("PL", "48"),
    ("PT", "351"),
    ("SI", "386"),
    ("SK", "421"),
    // The European Economic Area beyond the Union, less Norway.
    ("IS", "354"),
    ("LI", "423"),
    // Switzerland and the United Kingdom.
    ("CH", "41"),
    ("GB", "44"),
];

pub fn launch_list() -> Vec<Country> {
    LAUNCH
        .iter()
        .map(|(code, prefix)| Country {
            code: (*code).into(),
            prefix: (*prefix).into(),
            provider: Provider::Ovhcloud,
        })
        .collect()
}

/// Reads `DISCOVERY_COUNTRIES`. A refusal is a sentence about the shape of
/// the setting.
pub fn parse(value: &str) -> Result<Vec<Country>, &'static str> {
    let mut countries: Vec<Country> = Vec::new();
    for entry in value.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let parts: Vec<&str> = entry.split(':').map(str::trim).collect();
        let [code, prefix, provider] = parts[..] else {
            return Err("an entry is not <ISO code>:<calling code>:<provider>");
        };
        if code.len() != 2 || !code.bytes().all(|b| b.is_ascii_uppercase()) {
            return Err("a country code is not two capital letters");
        }
        if !(1..=3).contains(&prefix.len())
            || !prefix.bytes().all(|b| b.is_ascii_digit())
            || prefix.starts_with('0')
        {
            return Err("a calling code is not one to three digits");
        }
        let provider = Provider::from_setting(provider).ok_or("a provider is not ovhcloud")?;
        if countries.iter().any(|c| c.code == code) {
            return Err("a country appears twice");
        }
        countries.push(Country {
            code: code.into(),
            prefix: prefix.into(),
            provider,
        });
    }
    if countries.is_empty() {
        return Err("it names no country");
    }
    if !prefix_free(&countries) {
        return Err("a calling code is the start of another");
    }
    Ok(countries)
}

/// Calling codes are prefix-free, which is what lets a number name its
/// country: a list where one is the start of another could not.
fn prefix_free(countries: &[Country]) -> bool {
    countries.iter().all(|a| {
        countries
            .iter()
            .all(|b| a.code == b.code || !b.prefix.starts_with(&a.prefix))
    })
}

/// A number in international form: `+`, then 8 to 15 digits, the first not
/// zero. The device normalises what the person types; this is what it must
/// send.
pub fn is_international(number: &str) -> bool {
    let Some(digits) = number.strip_prefix('+') else {
        return false;
    };
    (8..=15).contains(&digits.len())
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !digits.starts_with('0')
}

/// The open country whose calling code the number carries, if any. The list
/// is prefix-free, so at most one of them matches.
pub fn open_country<'a>(countries: &'a [Country], number: &str) -> Option<&'a Country> {
    if !is_international(number) {
        return None;
    }
    let digits = &number[1..];
    countries.iter().find(|c| digits.starts_with(&c.prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_country_code_is_two_capitals_and_nothing_else() {
        // All the operator's SMS says of a country (#464).
        assert_eq!(
            CountryCode::new("FR").map(|c| c.to_string()),
            Some("FR".into())
        );
        for other in ["", "F", "fr", "Fr", "FRA", "F1", "@alice:h", "ÉT"] {
            assert_eq!(CountryCode::new(other), None, "{other:?}");
        }
    }

    #[test]
    fn a_number_is_international_or_it_is_not() {
        for good in ["+33612345678", "+442071838750", "+3524621234567"] {
            assert!(is_international(good), "{good}");
        }
        for bad in [
            "0612345678",
            "+33 6 12 34 56 78",
            "+0612345678",
            "+331234",
            "+3361234567890123",
            "",
            "+",
            "+33a12345678",
        ] {
            assert!(!is_international(bad), "{bad}");
        }
    }

    #[test]
    fn a_number_of_an_open_country_is_matched_to_it() {
        let open = launch_list();
        let code = |number| open_country(&open, number).map(|c| c.code.as_str());
        assert_eq!(code("+33612345678"), Some("FR"));
        assert_eq!(code("+447700900123"), Some("GB"));
        assert_eq!(code("+41791234567"), Some("CH"));
        assert_eq!(code("+35699123456"), Some("MT"));
        assert_eq!(
            open_country(&open, "+33612345678").map(|c| c.provider.name()),
            Some("OVHcloud")
        );
    }

    #[test]
    fn a_number_of_a_country_not_yet_opened_is_matched_to_nothing() {
        let open = launch_list();
        for closed in [
            "+393123456789", // Italy
            "+4520123456",   // Denmark
            "+358401234567", // Finland
            "+4791234567",   // Norway
            "+40712345678",  // Romania
            "+46701234567",  // Sweden
            "+12025550123",  // the United States
            "+998901234567", // Uzbekistan
        ] {
            assert_eq!(open_country(&open, closed), None, "{closed}");
        }
    }

    #[test]
    fn the_launch_list_is_prefix_free() {
        assert!(prefix_free(&launch_list()));
        // Control: the check can fail.
        let mut clashing = launch_list();
        clashing.push(Country {
            code: "XX".into(),
            prefix: "3".into(),
            provider: Provider::Ovhcloud,
        });
        assert!(!prefix_free(&clashing));
    }

    #[test]
    fn a_setting_opens_the_countries_it_names() {
        let open = parse("IT:39:ovhcloud, FR:33:ovhcloud").unwrap();
        assert_eq!(
            open_country(&open, "+393123456789").map(|c| c.code.as_str()),
            Some("IT")
        );
        assert_eq!(open_country(&open, "+447700900123"), None);
    }

    #[test]
    fn a_malformed_setting_is_refused() {
        for bad in [
            "FR:33",
            "FR:33:sinch",
            "fr:33:ovhcloud",
            "FRA:33:ovhcloud",
            "FR:033:ovhcloud",
            "FR:3333:ovhcloud",
            "FR:33:ovhcloud, FR:34:ovhcloud",
            "FR:33:ovhcloud, XX:3:ovhcloud",
            " , ",
        ] {
            assert!(parse(bad).is_err(), "{bad:?} must be refused");
        }
    }
}
