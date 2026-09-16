use std::sync::{Arc, OnceLock};

use axum::{extract::State, Json};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{error::AppError, AppState};

/// POST /_matrix/push/v1/notify — the push gateway, and what makes it ours.
///
/// # Why this exists at all, when sygnal already does this job
///
/// Sygnal is a good push gateway and it holds the Firebase credentials, which
/// is work nobody should do twice. What it will not do is send **nothing**.
///
/// Its Firebase pushkin copies every field the homeserver gives it —
/// `event_id`, `type`, `sender`, `room_name`, `room_alias`, `membership`,
/// `sender_display_name`, `content`, `room_id` — into the payload that crosses
/// Google. Matrix's quietest pusher format, `event_id_only`, still leaves
/// `event_id` and `room_id` in there. A room identifier is not a name, but it
/// is a stable identifier, and two devices receiving pushes for the same one
/// is a social graph. That is exactly the thing this product spends its design
/// refusing to hand anybody.
///
/// So the homeserver's pusher points **here**, and this forwards to sygnal a
/// notification stripped to the devices it must reach. Sygnal skips absent
/// fields (`if current is None: continue`), so what leaves for Firebase is a
/// data message reading `{"prio": "high"}` and nothing else: a device is told
/// to wake up and is told nothing about why. It syncs, decrypts what it finds,
/// and draws the notification itself, where the content already is.
///
/// # `data` is dropped, and that is not tidying
///
/// A pusher's `data` is written by the client that registered it, and sygnal
/// merges `data.default_payload` into what it sends. Left alone, that is a way
/// for anything holding an access token to reintroduce content into the push —
/// the guarantee above would hold only as long as every client chose to let it.
/// Dropping `data` makes it hold by construction.
///
/// # SYGNAL WILL NOT SEND NOTHING, SO IT IS GIVEN NOISE
///
/// The first version of this forwarded a notification carrying only its
/// devices. Sygnal accepted it, logged nothing alarming, and **discarded it**:
///
/// ```text
/// if not data.get("room_id") and not data.get("event_id") and not counts:
///     return {}
/// ```
///
/// -- and an empty payload is then dropped with *"Discarding notification
/// since it contains no data."* Measured against the real deployment, not
/// read out of the source: the request answered `200 {"rejected":[]}` and no
/// push was ever sent. A gateway that silently delivers nothing is worse than
/// one that refuses.
///
/// So it is given an `event_id`, and the `event_id` is **a fresh random value
/// with no relation to the event**. Sygnal is satisfied, the device ignores
/// it, and nothing about the message crosses. Passing the real one through
/// would have been the leak this module exists to prevent: two devices
/// receiving the same event id is two devices in the same conversation, which
/// is a social graph handed over one message at a time.
///
/// One value per notification, not per device. A homeserver's notify request
/// is for one account's own pushers, so what a shared value could correlate
/// is a person's own devices with each other -- which arriving in the same
/// millisecond already suggests. Across people the values are unrelated,
/// because their notifications are separate requests.
///
/// # Rejections are passed back verbatim
///
/// A pushkey Firebase says is gone must reach the homeserver, or it keeps
/// pushing to a device that has been wiped for as long as the pusher exists.
/// This forwards sygnal's answer unchanged, which is the one thing here that
/// must not be filtered.
#[derive(Deserialize)]
pub struct Notify {
    notification: Notification,
}

#[derive(Deserialize)]
pub struct Notification {
    /// Everything else the homeserver sends is deliberately not read.
    devices: Vec<Device>,
    #[serde(default)]
    prio: Option<String>,
}

#[derive(Deserialize)]
pub struct Device {
    app_id: String,
    pushkey: String,
}

#[derive(Serialize)]
pub struct Rejected {
    pub rejected: Vec<String>,
}

/// A value shaped like an event id and carrying nothing.
///
/// Sixteen random bytes, hex. Not derived from anything: derivation is how a
/// value that was meant to be opaque turns out to be a stable identifier for
/// whatever it was derived from.
fn meaningless_id() -> String {
    let mut raw = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut raw);
    let mut out = String::from("$");
    for byte in raw {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The client this forwards with, made once.
///
/// A `reqwest::Client` is a connection pool, so there should be one of it and
/// not one per request -- and not one per test fixture either, which is what a
/// field on the application state would have meant.
fn forwarder() -> &'static reqwest::Client {
    static FORWARDER: OnceLock<reqwest::Client> = OnceLock::new();
    FORWARDER.get_or_init(reqwest::Client::new)
}

pub async fn notify(
    State(st): State<Arc<AppState>>,
    Json(body): Json<Notify>,
) -> Result<Json<Rejected>, AppError> {
    // Nothing to do and nothing to report. Answered rather than refused: an
    // empty device list is a homeserver being thorough, not a bad request.
    if body.notification.devices.is_empty() {
        return Ok(Json(Rejected { rejected: vec![] }));
    }

    let Some(gateway) = st.cfg.push_gateway_url.as_deref() else {
        // NOT CONFIGURED IS NOT A FAILURE OF THIS REQUEST.
        //
        // A deployment without a push gateway is a deployment where nobody
        // registered a pusher pointing here, so this should not be reachable
        // -- but answering 500 to a homeserver would make it retry forever,
        // and rejecting the pushkeys would make it delete pushers that are
        // fine. An empty rejection list says "delivered, nothing to clean
        // up", which is the least wrong thing a gateway with nowhere to send
        // can say.
        return Ok(Json(Rejected { rejected: vec![] }));
    };

    let stripped = strip(&body.notification);
    let answer = forwarder()
        .post(gateway)
        .json(&stripped)
        .send()
        .await
        .map_err(anyhow::Error::from)?;

    let parsed: Value = answer.json().await.map_err(anyhow::Error::from)?;
    Ok(Json(Rejected {
        rejected: parsed
            .get("rejected")
            .and_then(Value::as_array)
            .map(|found| {
                found
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    }))
}

/// What is left of a notification once nothing about the message remains.
///
/// Built by naming what to keep rather than what to remove: a deny list would
/// let a field added by a future homeserver through by default, and the whole
/// point is that nothing gets through by default.
pub fn strip(notification: &Notification) -> Value {
    json!({
        "notification": {
            // Noise, and required. See the module header: sygnal drops a
            // notification carrying no `room_id`, no `event_id` and no
            // counts, so this carries an `event_id` that is not one.
            "event_id": meaningless_id(),
            "devices": notification
                .devices
                .iter()
                .map(|device| json!({
                    "app_id": device.app_id,
                    "pushkey": device.pushkey,
                }))
                .collect::<Vec<_>>(),
            // Kept because it is about delivery and not about the message: a
            // call has to wake a sleeping phone and a message does not need
            // to. It says nothing about who or what.
            "prio": notification.prio.clone().unwrap_or_else(|| "high".to_owned()),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(raw: &str) -> Notification {
        serde_json::from_str::<Notify>(raw).unwrap().notification
    }

    /// The whole point of this module, as an assertion.
    ///
    /// A homeserver's notification carries the sender, the room, the type and
    /// the message. What leaves for Firebase must carry none of it, and this
    /// is written as "these keys and no others" rather than as a list of
    /// forbidden words -- a field added upstream tomorrow must fail this test
    /// by not being expected, rather than pass it by not being named.
    /// The literal below is `r##"…"##` rather than `r#"…"#`, because a room
    /// alias starts with a hash and `"#` would close the string. The alias
    /// stays in the fixture: it is one of the things that must not reach
    /// Firebase.
    #[test]
    fn nothing_about_the_message_survives() {
        let full = notification(
            r##"{"notification":{
                "event_id":"$abc:messagr.eu",
                "room_id":"!room:messagr.eu",
                "type":"m.room.message",
                "sender":"@her:messagr.eu",
                "sender_display_name":"Maria",
                "room_name":"Maria",
                "room_alias":"#maria:messagr.eu",
                "membership":"join",
                "content":{"msgtype":"m.text","body":"see you at eight"},
                "counts":{"unread":3},
                "prio":"high",
                "devices":[{"app_id":"cloud.maudet.messagr","pushkey":"KEY",
                            "pushkey_ts":1,"data":{"format":"event_id_only",
                            "default_payload":{"body":"see you at eight"}},
                            "tweaks":{"sound":"default"}}]
            }}"##,
        );

        let sent = strip(&full);
        let inner = sent.get("notification").unwrap().as_object().unwrap();

        let mut keys: Vec<&str> = inner.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["devices", "event_id", "prio"]);

        let device = inner["devices"][0].as_object().unwrap();
        let mut device_keys: Vec<&str> = device.keys().map(String::as_str).collect();
        device_keys.sort_unstable();
        assert_eq!(device_keys, vec!["app_id", "pushkey"]);

        // Said again as a string search, because the assertions above are
        // about shape and this one is about the thing anybody actually cares
        // about: no word of the message is anywhere in what goes out.
        let wire = sent.to_string();
        for leak in [
            "$abc",
            "!room",
            "@her",
            "Maria",
            "see you at eight",
            "m.room.message",
            "join",
            "unread",
        ] {
            assert!(!wire.contains(leak), "{leak} crossed the push gateway");
        }
    }

    /// `default_payload` is written by the client that registered the pusher,
    /// and sygnal merges it into what it sends. Dropping the whole `data`
    /// object is what makes the guarantee hold however a client registered.
    /// The easiest mistake to make here, now that an `event_id` is sent at
    /// all: passing the real one through. Two devices receiving the same
    /// event id are two devices in the same conversation, which is a social
    /// graph handed over one message at a time.
    #[test]
    fn the_event_id_that_goes_out_is_not_the_one_that_came_in() {
        let real = notification(
            r##"{"notification":{"event_id":"$realeventid:messagr.eu",
                "devices":[{"app_id":"a","pushkey":"K"}]}}"##,
        );
        let sent = strip(&real);
        assert_ne!(sent["notification"]["event_id"], "$realeventid:messagr.eu");
        assert!(!sent.to_string().contains("realeventid"));
    }

    /// And it is different every time, so it cannot become a handle for
    /// anything. A constant would satisfy sygnal and correlate every push
    /// this deployment ever sent.
    #[test]
    fn two_notifications_do_not_share_an_event_id() {
        let one = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        let two = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        assert_ne!(
            strip(&one)["notification"]["event_id"],
            strip(&two)["notification"]["event_id"]
        );
    }

    /// Sygnal drops a notification with no `room_id`, no `event_id` and no
    /// counts -- measured against the real deployment, where it answered 200
    /// and sent nothing. Whatever else changes here, one of those has to
    /// survive, and `event_id` is the only one that can be made meaningless.
    #[test]
    fn something_survives_that_sygnal_will_accept() {
        let bare = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        let sent = strip(&bare);
        let has_something = sent["notification"].get("event_id").is_some()
            || sent["notification"].get("room_id").is_some();
        assert!(has_something, "sygnal would discard this and say nothing");
    }

    #[test]
    fn a_client_cannot_smuggle_content_back_in() {
        let smuggled = notification(
            r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K",
                "data":{"default_payload":{"body":"secret"}}}]}}"##,
        );
        assert!(!strip(&smuggled).to_string().contains("secret"));
    }

    /// Priority describes delivery, not the message: a call has to wake a
    /// sleeping phone and a message does not. It says nothing about who or
    /// what, so it is the one thing carried through.
    #[test]
    fn priority_is_carried_because_it_describes_delivery() {
        let low = notification(
            r##"{"notification":{"prio":"low","devices":[{"app_id":"a","pushkey":"K"}]}}"##,
        );
        assert_eq!(strip(&low)["notification"]["prio"], "low");
    }

    /// A homeserver that sends no priority gets the one that wakes a phone.
    /// The alternative is a notification that arrives when the device next
    /// feels like it, which for a messenger is not arriving.
    #[test]
    fn a_missing_priority_becomes_high() {
        let none = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        assert_eq!(strip(&none)["notification"]["prio"], "high");
    }

    /// Every device reaches sygnal. A person with a phone and a tablet has
    /// two, and forwarding one would be a notification that arrives on
    /// whichever registered first.
    #[test]
    fn every_device_is_carried() {
        let two = notification(
            r##"{"notification":{"devices":[{"app_id":"a","pushkey":"ONE"},
                                           {"app_id":"b","pushkey":"TWO"}]}}"##,
        );
        let sent = strip(&two);
        let devices = sent["notification"]["devices"].as_array().unwrap();
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[1]["pushkey"], "TWO");
    }

    /// A notification whose fields this has never heard of is stripped to the
    /// same two keys. Written because the risk is a homeserver adding a field
    /// and nobody noticing it went out.
    #[test]
    fn a_field_nobody_here_has_heard_of_does_not_pass() {
        let future = notification(
            r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}],
                "thread_root":"$t","reply_to_sender":"@x:messagr.eu"}}"##,
        );
        let wire = strip(&future).to_string();
        assert!(!wire.contains("thread_root"));
        assert!(!wire.contains("@x:messagr.eu"));
    }

    // ======================================================================
    // #286 — A TOKEN THE GATEWAY REFUSES IS AN ORDINARY EVENT
    //
    // Measured on the production gateway on 13 September 2026: a
    // notification carrying a device token FCM will never accept came back
    // to the homeserver as `500 M_UNKNOWN`, with no `rejected` list and no
    // push for the devices that were fine. The tests below are that probe,
    // without a homeserver and without Google.
    // ======================================================================

    use crate::{config, matrix};
    use axum::{http::StatusCode, response::IntoResponse};
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    /// An application state whose only live part is the gateway address:
    /// `wake` reads nothing else. The homeserver points at a closed port on
    /// purpose — nothing here may depend on anything reachable.
    fn state(pool: SqlitePool, gateway: Option<String>) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: config::Config {
                database_url: String::new(),
                homeserver_url: "http://127.0.0.1:1".into(),
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
                push_gateway_url: gateway,
            },
        })
    }

    /// Puts a notification through the handler and reads back what a
    /// homeserver would receive: the STATUS and the BODY, not the Rust value.
    /// The status is half of what #286 is about, and a test asserting on an
    /// `Ok(...)` would not have seen it.
    async fn answer(st: Arc<AppState>, raw: &str) -> (StatusCode, Value) {
        let body: Notify = serde_json::from_str(raw).unwrap();
        let response = notify(State(st), Json(body)).await.into_response();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    /// A stand-in for sygnal: it answers according to the pushkeys the
    /// forwarded notification carries, and keeps every body it was given.
    ///
    /// It models the one behaviour of sygnal that this ticket is about: it
    /// answers per REQUEST and not per device, so a single device it cannot
    /// dispatch to takes the whole request down with it. That is written in
    /// `deploy/messagr-sygnal/sygnal.yaml`, annex of 6 August 2026, read off
    /// the code of the deployed image.
    async fn sygnal(
        reply: impl Fn(&[String]) -> (StatusCode, String) + Clone + Send + Sync + 'static,
    ) -> (String, Arc<Mutex<Vec<Value>>>) {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let kept = seen.clone();
        let app = axum::Router::new().route(
            "/_matrix/push/v1/notify",
            axum::routing::post(move |Json(body): Json<Value>| {
                let reply = reply.clone();
                let kept = kept.clone();
                async move {
                    let carried = pushkeys_of(&body);
                    kept.lock().unwrap().push(body);
                    reply(&carried)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/_matrix/push/v1/notify",
            listener.local_addr().unwrap()
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, seen)
    }

    fn pushkeys_of(notification: &Value) -> Vec<String> {
        notification["notification"]["devices"]
            .as_array()
            .map(|devices| {
                devices
                    .iter()
                    .filter_map(|one| one["pushkey"].as_str())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Sygnal's answer to a notification it could not dispatch: 502, and an
    /// EMPTY body. `reqwest` then fails to decode with "EOF while parsing a
    /// value", and that failure is what used to leave here as `500 M_UNKNOWN`.
    ///
    /// FCM's 400 INVALID_ARGUMENT — a token that is not a registration token
    /// — arrives this way. So do its 401 UNAUTHENTICATED and 403
    /// PERMISSION_DENIED, which are about OUR service account and not about
    /// anybody's device. The three are indistinguishable from this side,
    /// which is the whole difficulty of the ticket.
    fn bodiless_502() -> (StatusCode, String) {
        (StatusCode::BAD_GATEWAY, String::new())
    }

    /// Sygnal delivered, and names the pushkeys it refuses — its 200 path,
    /// the one an APNs `BadDeviceToken` and an FCM 404 UNREGISTERED take.
    fn accepted(rejected: &[&str]) -> (StatusCode, String) {
        (StatusCode::OK, json!({ "rejected": rejected }).to_string())
    }

    const ONE_DEVICE: &str = r##"{"notification":{"event_id":"$realevent:messagr.eu",
        "devices":[{"app_id":"eu.messagr","pushkey":"DEAD"}]}}"##;

    const TWO_DEVICES: &str = r##"{"notification":{"event_id":"$realevent:messagr.eu",
        "devices":[{"app_id":"eu.messagr","pushkey":"ALIVE"},
                   {"app_id":"eu.messagr","pushkey":"DEAD"}]}}"##;

    /// **The ticket, in one assertion.** An upstream answer this service
    /// cannot read is a fact about the upstream, not a fault of its own, and
    /// a homeserver must never be told `500 M_UNKNOWN` for it: it retries the
    /// same notification for ever and learns nothing.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_answer_that_carries_no_json_is_not_an_internal_error(pool: SqlitePool) {
        let (gateway, _seen) = sygnal(|_| bodiless_502()).await;
        let (status, body) = answer(state(pool, Some(gateway)), ONE_DEVICE).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "a gateway that cannot read its upstream's answer must not \
             report an internal error of its own"
        );
        assert_eq!(body["rejected"], json!([]));
    }

    /// A refusal that singles out ONE device, while another device of the
    /// same notification went through, is about that device: the pushkey is
    /// the only thing that differed between the two forwards.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_refusal_that_singles_out_one_device_names_that_pushkey(pool: SqlitePool) {
        let (gateway, _seen) = sygnal(|carried: &[String]| {
            if carried.iter().any(|key| key == "DEAD") {
                bodiless_502()
            } else {
                accepted(&[])
            }
        })
        .await;
        let (status, body) = answer(state(pool, Some(gateway)), TWO_DEVICES).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["rejected"],
            json!(["DEAD"]),
            "without this the homeserver never learns the token is dead, so \
             it keeps aiming at it"
        );
    }

    /// And the device that was fine is still woken. One bad token used to
    /// cost the whole notification, on every device of the account.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_device_is_still_woken_when_its_neighbour_is_refused(pool: SqlitePool) {
        let (gateway, seen) = sygnal(|carried: &[String]| {
            if carried.iter().any(|key| key == "DEAD") {
                bodiless_502()
            } else {
                accepted(&[])
            }
        })
        .await;
        let (status, _) = answer(state(pool, Some(gateway)), TWO_DEVICES).await;
        assert_eq!(status, StatusCode::OK);

        let forwarded = seen.lock().unwrap().clone();
        let carried: Vec<Vec<String>> = forwarded.iter().map(pushkeys_of).collect();
        assert_eq!(
            carried.len(),
            2,
            "one forward per device, or a refused device takes its \
             neighbours with it: {carried:?}"
        );
        assert!(
            carried.contains(&vec!["ALIVE".to_string()]),
            "the device that was fine was never offered on its own: {carried:?}"
        );
    }

    /// **The safeguard, and it is the important half.** When EVERY device is
    /// refused, nothing is reported rejected.
    ///
    /// A bodiless 502 is what sygnal answers for FCM's 400 (this token is not
    /// a token) and equally for its 401 and 403 (our service account is not
    /// authorised) — the annex in `deploy/messagr-sygnal/sygnal.yaml` says so,
    /// measured against FCM. Rejecting on that evidence alone would, the day a
    /// service account key expires, delete every pusher on this deployment at
    /// once, silently, and on a homeserver that honours `rejected` there is no
    /// way back but every device registering again.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_refusal_of_every_device_names_no_pushkey(pool: SqlitePool) {
        let (gateway, _seen) = sygnal(|_| bodiless_502()).await;
        let (status, body) = answer(state(pool, Some(gateway)), TWO_DEVICES).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["rejected"],
            json!([]),
            "an upstream that accepted nothing at all is an upstream that \
             has not said anything about anybody's token"
        );
    }

    /// The one thing here that must not be filtered, unchanged: what sygnal
    /// names, the homeserver receives. This is the path an APNs
    /// `BadDeviceToken` and an FCM 404 UNREGISTERED already took, and the
    /// coherence between the two transports is that they end in this same
    /// list.
    #[sqlx::test(migrations = "./migrations")]
    async fn what_the_gateway_names_is_passed_back_unchanged(pool: SqlitePool) {
        let (gateway, _seen) = sygnal(|carried: &[String]| {
            let gone: Vec<&str> = carried
                .iter()
                .filter(|key| key.as_str() == "DEAD")
                .map(String::as_str)
                .collect();
            accepted(&gone)
        })
        .await;
        let (status, body) = answer(state(pool, Some(gateway)), TWO_DEVICES).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["rejected"], json!(["DEAD"]));
    }

    /// A gateway nothing answers at is not a dead token either. Port 1 on the
    /// loopback: nothing listens there, and `reqwest` fails before any HTTP.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_unreachable_gateway_names_nothing_and_is_not_an_error(pool: SqlitePool) {
        let (status, body) = answer(
            state(
                pool,
                Some("http://127.0.0.1:1/_matrix/push/v1/notify".into()),
            ),
            ONE_DEVICE,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["rejected"], json!([]));
    }

    /// Splitting the forward per device must not multiply the meaningless
    /// event id: one value per NOTIFICATION, as the module header sets out.
    /// A fresh one per device would correlate nothing more — but the property
    /// written down there is the one that was reasoned about, and a forward
    /// that quietly stopped holding it would have nobody to notice.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_devices_of_one_notification_share_one_meaningless_event_id(pool: SqlitePool) {
        let (gateway, seen) = sygnal(|_| accepted(&[])).await;
        let (status, _) = answer(state(pool, Some(gateway)), TWO_DEVICES).await;
        assert_eq!(status, StatusCode::OK);

        let forwarded = seen.lock().unwrap().clone();
        assert_eq!(forwarded.len(), 2);
        let ids: Vec<&str> = forwarded
            .iter()
            .map(|one| one["notification"]["event_id"].as_str().unwrap())
            .collect();
        assert_eq!(ids[0], ids[1], "one value per notification");
        assert!(
            !ids[0].contains("realevent"),
            "the real event id crossed the push gateway"
        );
    }

    /// Unchanged, and re-asserted through the response rather than through
    /// the Rust value: a deployment with nowhere to forward answers
    /// "delivered, nothing to clean up".
    #[sqlx::test(migrations = "./migrations")]
    async fn a_deployment_with_no_gateway_names_nothing(pool: SqlitePool) {
        let (status, body) = answer(state(pool, None), ONE_DEVICE).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["rejected"], json!([]));
    }
}
