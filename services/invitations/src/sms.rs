//! Sending the SMS that proves a number, through OVHcloud (#397, Q24), and
//! what goes with it (#399).
//!
//! Three calls of OVHcloud's API, each signed as that API asks:
//! `POST /sms/{serviceName}/jobs` sends, `DELETE
//! /sms/{serviceName}/outgoing/{id}` erases a sent SMS from the history, and
//! `GET /sms/{serviceName}` reads the prepaid balance. The number leaves the
//! service here, and only here, towards the provider named on the consent
//! screen and the number screen; the service itself keeps only its mask
//! (`masking`).
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
    /// The history does not know this SMS: see `sms_history`.
    #[error("the SMS provider's history does not know this SMS")]
    Unknown,
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
        let answer = self
            .signed(reqwest::Method::POST, &url, body, now)
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

    /// Erases a sent SMS from OVHcloud's history, by the id `send` answered
    /// (#399). An id the history does not know is `Unknown`, which
    /// `sms_history` tells apart from an SMS erased.
    pub async fn erase(&self, id: u64, now: i64) -> Result<(), SmsError> {
        let url = format!("{}/sms/{}/outgoing/{id}", self.base_url, self.service_name);
        let answer = self
            .signed(reqwest::Method::DELETE, &url, String::new(), now)
            .send()
            .await
            .map_err(|_| SmsError::Unreachable)?;
        match answer.status() {
            status if status.is_success() => Ok(()),
            reqwest::StatusCode::NOT_FOUND => Err(SmsError::Unknown),
            _ => Err(SmsError::Refused),
        }
    }

    /// The prepaid credits left on the SMS account (#399).
    pub async fn credits_left(&self, now: i64) -> Result<f64, SmsError> {
        let url = format!("{}/sms/{}", self.base_url, self.service_name);
        let answer = self
            .signed(reqwest::Method::GET, &url, String::new(), now)
            .send()
            .await
            .map_err(|_| SmsError::Unreachable)?;
        if !answer.status().is_success() {
            return Err(SmsError::Refused);
        }
        let account: serde_json::Value = answer.json().await.map_err(|_| SmsError::Refused)?;
        account["creditsLeft"].as_f64().ok_or(SmsError::Refused)
    }

    /// A request signed as OVHcloud's API asks, at `now`.
    fn signed(
        &self,
        method: reqwest::Method,
        url: &str,
        body: String,
        now: i64,
    ) -> reqwest::RequestBuilder {
        let timestamp = now.to_string();
        let signed = signature(
            &self.application_secret,
            &self.consumer_key,
            method.as_str(),
            url,
            &body,
            &timestamp,
        );
        let request = client()
            .request(method, url)
            .header("X-Ovh-Application", &self.application_key)
            .header("X-Ovh-Consumer", &self.consumer_key)
            .header("X-Ovh-Timestamp", timestamp)
            .header("X-Ovh-Signature", signed);
        if body.is_empty() {
            request
        } else {
            request
                .header("Content-Type", "application/json")
                .body(body)
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

/// The SMS double every test of the service shares (#399, #464): OVHcloud
/// reduced to its calls, and the configuration that sends through it to the
/// operator's number.
#[cfg(test)]
pub(crate) mod test_support {
    use axum::{
        routing::{get, post},
        Json,
    };
    use std::sync::{Arc, Mutex};

    /// The operator's number in every test.
    pub(crate) const OPERATOR_NUMBER: &str = "+33600000000";

    /// OVHcloud reduced to the calls the service makes. It keeps what it was
    /// sent, so a test can read an SMS the way a phone would.
    #[derive(Default)]
    pub(crate) struct Inbox {
        pub(crate) sent: Vec<(Vec<String>, String)>,
        /// The ids OVHcloud was asked to erase from its history (#399).
        pub(crate) erased: Vec<u64>,
    }

    pub(crate) async fn fake_ovhcloud(refuse: bool) -> (String, Arc<Mutex<Inbox>>) {
        fake_ovhcloud_with(refuse, 0, 1_000.0).await
    }

    /// The same, answering each SMS after `delay_ms`, and saying
    /// `credits_left` of the account.
    pub(crate) async fn fake_ovhcloud_with(
        refuse: bool,
        delay_ms: u64,
        credits_left: f64,
    ) -> (String, Arc<Mutex<Inbox>>) {
        let inbox = Arc::new(Mutex::new(Inbox::default()));
        let kept = inbox.clone();
        let erasing = inbox.clone();
        let app = axum::Router::new()
            .route(
                "/sms/sms-test-1",
                get(move || async move { Json(serde_json::json!({"creditsLeft": credits_left})) }),
            )
            .route(
                "/sms/sms-test-1/jobs",
                post(move |Json(body): Json<serde_json::Value>| {
                    let kept = kept.clone();
                    async move {
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        let receivers: Vec<String> =
                            serde_json::from_value(body["receivers"].clone()).unwrap();
                        let message = body["message"].as_str().unwrap().to_string();
                        let mut inbox = kept.lock().unwrap();
                        inbox.sent.push((receivers.clone(), message));
                        // One id per SMS, as OVHcloud answers: the one its
                        // history knows the SMS by.
                        let id = inbox.sent.len();
                        if refuse {
                            Json(serde_json::json!({"ids": [], "invalidReceivers": receivers}))
                        } else {
                            Json(serde_json::json!({"ids": [id], "invalidReceivers": []}))
                        }
                    }
                }),
            )
            .route(
                "/sms/sms-test-1/outgoing/:id",
                axum::routing::delete(move |axum::extract::Path(id): axum::extract::Path<u64>| {
                    let erasing = erasing.clone();
                    async move {
                        erasing.lock().unwrap().erased.push(id);
                        Json(serde_json::Value::Null)
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, inbox)
    }

    /// The service's SMS through a fake OVHcloud at `ovh`, to the operator's
    /// number `OPERATOR_NUMBER` (#464).
    pub(crate) fn sms_through(ovh: String) -> crate::config::Sms {
        crate::config::Sms {
            provider: Some(super::Ovhcloud {
                base_url: ovh,
                application_key: "ak".into(),
                application_secret: "as".into(),
                consumer_key: "ck".into(),
                service_name: "sms-test-1".into(),
                sender: "Messagr".into(),
            }),
            operator_number: Some(OPERATOR_NUMBER.to_string()),
        }
    }

    /// How many SMS reached `number`.
    pub(crate) fn sent_to(inbox: &Arc<Mutex<Inbox>>, number: &str) -> usize {
        inbox
            .lock()
            .unwrap()
            .sent
            .iter()
            .filter(|(receivers, _)| receivers.iter().any(|r| r == number))
            .count()
    }
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

    /// OVHcloud's history, reduced to the one call that erases from it: it
    /// keeps the paths it was asked to delete, and knows only the ids given.
    async fn fake_history(known: Vec<u64>) -> (String, Arc<Mutex<Vec<(String, HeaderMap)>>>) {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let kept = asked.clone();
        let app = Router::new().route(
            "/sms/sms-ab12345-1/outgoing/:id",
            axum::routing::delete(
                move |axum::extract::Path(id): axum::extract::Path<u64>, headers: HeaderMap| {
                    let kept = kept.clone();
                    let known = known.clone();
                    async move {
                        kept.lock()
                            .unwrap()
                            .push((format!("/sms/sms-ab12345-1/outgoing/{id}"), headers));
                        if known.contains(&id) {
                            (axum::http::StatusCode::OK, Json(serde_json::Value::Null))
                        } else {
                            (
                                axum::http::StatusCode::NOT_FOUND,
                                Json(serde_json::json!({"message": "not found"})),
                            )
                        }
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, asked)
    }

    #[tokio::test]
    async fn an_sms_is_erased_from_the_history_signed_like_any_call() {
        let (base, asked) = fake_history(vec![42]).await;
        provider(base.clone())
            .erase(42, 1_458_034_342)
            .await
            .unwrap();

        let asked = asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        let (path, headers) = &asked[0];
        assert_eq!(path, "/sms/sms-ab12345-1/outgoing/42");
        assert_eq!(
            headers["x-ovh-signature"],
            signature(
                "AS",
                "CK",
                "DELETE",
                &format!("{base}/sms/sms-ab12345-1/outgoing/42"),
                "",
                "1458034342"
            )
            .as_str()
        );
    }

    #[tokio::test]
    async fn an_sms_the_history_does_not_know_is_not_counted_as_erased() {
        let (base, _) = fake_history(Vec::new()).await;
        assert!(matches!(
            provider(base).erase(7, 0).await,
            Err(SmsError::Unknown)
        ));
    }

    #[tokio::test]
    async fn an_erasure_that_does_not_reach_the_provider_says_so() {
        let erased = provider("http://127.0.0.1:1".into()).erase(7, 0).await;
        assert!(matches!(erased, Err(SmsError::Unreachable)));
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
