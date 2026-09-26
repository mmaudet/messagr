//! Sending the SMS that proves a number, through OVHcloud (#397, Q24).
//!
//! One call: `POST /sms/{serviceName}/jobs` of OVHcloud's API, signed as that
//! API asks. The number leaves the service here, and only here, towards the
//! provider named on the consent screen and the number screen; the service
//! itself keeps only its mask (`masking`).
//!
//! # NOTHING HERE PRINTS A SECRET
//!
//! `Ovhcloud` has its own `Debug`, which shows the endpoint and the service
//! name and nothing else, and no error carries the number or the message.

use sha1::{Digest, Sha1};
use std::sync::OnceLock;
use std::time::Duration;

/// Where OVHcloud's API lives for accounts opened in Europe. Any other address
/// is refused outside the bench (`config`).
pub const OVHCLOUD_EUROPE: &str = "https://eu.api.ovh.com/1.0";

#[derive(Clone)]
pub struct Ovhcloud {
    pub base_url: String,
    pub application_key: String,
    pub application_secret: String,
    pub consumer_key: String,
    /// The SMS account, `sms-xx00000-1`.
    pub service_name: String,
    /// The alphanumeric sender registered with OVHcloud.
    pub sender: String,
}

impl std::fmt::Debug for Ovhcloud {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ovhcloud")
            .field("base_url", &self.base_url)
            .field("service_name", &self.service_name)
            .field("sender", &self.sender)
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SmsError {
    #[error("the SMS provider could not be reached")]
    Unreachable,
    #[error("the SMS provider refused the message")]
    Refused,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("a client with a timeout builds")
    })
}

impl Ovhcloud {
    /// Sends `message` to `number`, and answers with the job OVHcloud
    /// created. `valid_minutes` is how long the message is worth delivering:
    /// a code is useless once it has run out. `now` is the Unix time the
    /// request is signed with.
    pub async fn send(
        &self,
        number: &str,
        message: &str,
        valid_minutes: i64,
        now: i64,
    ) -> Result<u64, SmsError> {
        let url = format!("{}/sms/{}/jobs", self.base_url, self.service_name);
        let body = serde_json::json!({
            "message": message,
            "receivers": [number],
            "sender": self.sender,
            // A proof is not marketing: no « STOP » line, which would also
            // push the domain-bound last line off the end iOS reads.
            "noStopClause": true,
            "priority": "high",
            "validityPeriod": valid_minutes,
        })
        .to_string();
        let timestamp = now.to_string();
        let answer = client()
            .post(&url)
            .header("Content-Type", "application/json")
            .header("X-Ovh-Application", &self.application_key)
            .header("X-Ovh-Consumer", &self.consumer_key)
            .header("X-Ovh-Timestamp", &timestamp)
            .header(
                "X-Ovh-Signature",
                signature(
                    &self.application_secret,
                    &self.consumer_key,
                    "POST",
                    &url,
                    &body,
                    &timestamp,
                ),
            )
            .body(body)
            .send()
            .await
            .map_err(|_| SmsError::Unreachable)?;
        if !answer.status().is_success() {
            return Err(SmsError::Refused);
        }
        let report: SendingReport = answer.json().await.map_err(|_| SmsError::Refused)?;
        match (report.ids.first(), report.invalid_receivers.is_empty()) {
            (Some(id), true) => Ok(*id),
            _ => Err(SmsError::Refused),
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendingReport {
    #[serde(default)]
    ids: Vec<u64>,
    #[serde(default)]
    invalid_receivers: Vec<String>,
}

/// OVHcloud's request signature: `$1$` and the SHA-1, in hexadecimal, of the
/// application secret, the consumer key, the method, the full URL, the body
/// and the timestamp, joined by `+`.
pub fn signature(
    application_secret: &str,
    consumer_key: &str,
    method: &str,
    url: &str,
    body: &str,
    timestamp: &str,
) -> String {
    let signed = [
        application_secret,
        consumer_key,
        method,
        url,
        body,
        timestamp,
    ]
    .join("+");
    let digest = Sha1::digest(signed.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("$1${hex}")
}

/// The SMS a proof sends, in the language of the application that asked. Its
/// last line binds the code to messagr.eu: iOS offers it above the keyboard,
/// and only inside Messagr.
pub fn proof_message(language: &str, code: &str) -> String {
    let first = match language {
        "en" => format!("Your Messagr code: {code}"),
        "de" => format!("Ihr Messagr-Code: {code}"),
        "es" => format!("Su código de Messagr: {code}"),
        "it" => format!("Il suo codice Messagr: {code}"),
        "nl" => format!("Uw Messagr-code: {code}"),
        "uz" => format!("Messagr kodingiz: {code}"),
        _ => format!("Votre code Messagr : {code}"),
    };
    format!("{first}\n\n@messagr.eu #{code}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Json, Router};
    use std::sync::{Arc, Mutex};

    #[test]
    fn the_signature_is_the_one_ovhcloud_documents() {
        // Computed independently, with Python's hashlib, as `python-ovh`
        // computes it.
        assert_eq!(
            signature(
                "EXEgWIz07P0HYwtQDs7cNIqCiQaWSuHF",
                "MtSwSrPpNjqfVSmJhLbPyr2i45lSwPU1",
                "POST",
                "https://eu.api.ovh.com/1.0/sms/sms-ab12345-1/jobs",
                r#"{"message":"x"}"#,
                "1458034342",
            ),
            "$1$e6e11c9913bb51b2481195b448d649e1ad0ee8d3"
        );
    }

    #[test]
    fn the_message_ends_with_the_line_ios_reads() {
        for language in ["fr", "en", "de", "es", "it", "nl", "uz", "??"] {
            let message = proof_message(language, "123456");
            assert!(message.contains("123456"), "{language}");
            assert_eq!(
                message.lines().last(),
                Some("@messagr.eu #123456"),
                "{language}"
            );
        }
        assert_eq!(
            proof_message("fr", "042042"),
            "Votre code Messagr : 042042\n\n@messagr.eu #042042"
        );
        // THE VERB OF #392 HOLDS HERE TOO: a proof is not a verification,
        // in any of the seven languages, and the copy guards of the
        // application never read this text.
        for language in ["fr", "en", "de", "es", "it", "nl", "uz"] {
            let message = proof_message(language, "123456").to_lowercase();
            for word in ["vérifi", "verifi", "confirm", "bestätig", "verific"] {
                assert!(!message.contains(word), "{language}: {message}");
            }
        }
    }

    #[derive(Default)]
    struct Seen {
        headers: Option<HeaderMap>,
        body: Option<String>,
    }

    async fn fake_ovhcloud(answer: serde_json::Value) -> (String, Arc<Mutex<Seen>>) {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let kept = seen.clone();
        let app = Router::new().route(
            "/sms/sms-ab12345-1/jobs",
            post(move |headers: HeaderMap, body: String| {
                let kept = kept.clone();
                let answer = answer.clone();
                async move {
                    let mut s = kept.lock().unwrap();
                    s.headers = Some(headers);
                    s.body = Some(body);
                    Json(answer)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, seen)
    }

    fn provider(base_url: String) -> Ovhcloud {
        Ovhcloud {
            base_url,
            application_key: "AK".into(),
            application_secret: "AS".into(),
            consumer_key: "CK".into(),
            service_name: "sms-ab12345-1".into(),
            sender: "Messagr".into(),
        }
    }

    #[tokio::test]
    async fn a_proof_is_sent_signed_to_one_receiver() {
        let (base, seen) = fake_ovhcloud(serde_json::json!({
            "ids": [42], "invalidReceivers": [], "validReceivers": ["+33612345678"],
            "totalCreditsRemoved": 1
        }))
        .await;
        let sent = provider(base.clone())
            .send("+33612345678", "Votre code", 10, 1_458_034_342)
            .await;
        assert_eq!(sent.unwrap(), 42);

        let s = seen.lock().unwrap();
        let raw = s.body.as_ref().unwrap();
        let body: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert_eq!(body["receivers"], serde_json::json!(["+33612345678"]));
        assert_eq!(body["sender"], "Messagr");
        assert_eq!(body["noStopClause"], true);
        assert_eq!(body["validityPeriod"], 10);
        let headers = s.headers.as_ref().unwrap();
        assert_eq!(headers["x-ovh-application"], "AK");
        assert_eq!(headers["x-ovh-consumer"], "CK");
        assert_eq!(headers["x-ovh-timestamp"], "1458034342");
        // The signature covers the URL and the body the provider received,
        // byte for byte; the formula itself is pinned by the test above.
        assert_eq!(
            headers["x-ovh-signature"],
            signature(
                "AS",
                "CK",
                "POST",
                &format!("{base}/sms/sms-ab12345-1/jobs"),
                raw,
                "1458034342"
            )
            .as_str()
        );
    }

    #[tokio::test]
    async fn an_invalid_receiver_is_a_refusal() {
        let (base, _) = fake_ovhcloud(serde_json::json!({
            "ids": [], "invalidReceivers": ["+33612345678"], "validReceivers": []
        }))
        .await;
        let sent = provider(base).send("+33612345678", "x", 10, 0).await;
        assert!(matches!(sent, Err(SmsError::Refused)));
    }

    #[tokio::test]
    async fn an_unreachable_provider_is_said_so() {
        let sent = provider("http://127.0.0.1:1".into())
            .send("+33612345678", "x", 10, 0)
            .await;
        assert!(matches!(sent, Err(SmsError::Unreachable)));
    }

    #[test]
    fn the_provider_never_prints_its_secrets() {
        let printed = format!("{:?}", provider("https://eu.api.ovh.com/1.0".into()));
        assert!(
            !printed.contains("AS") && !printed.contains("CK"),
            "{printed}"
        );
        assert!(printed.contains("sms-ab12345-1"), "{printed}");
    }
}
