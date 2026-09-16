use std::sync::{Arc, OnceLock};

use axum::{extract::State, Json};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::AppState;

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
///
/// # ONE FORWARD PER DEVICE (#286)
///
/// Sygnal answers per REQUEST and not per device: a single device it cannot
/// dispatch to raises, and the whole request comes back `502` with an EMPTY
/// body. Measured on the production gateway on 13 September 2026, one
/// deliberately invalid token was enough to lose a notification for every
/// other device of the same account — and `reqwest`'s `json()` then failed
/// with *"EOF while parsing a value"*, which left here as `500 M_UNKNOWN`.
///
/// So each device is forwarded on its own. A refusal then names the device it
/// arrived for, the devices that were fine are still woken, and a body that
/// carries no JSON is a fact about the upstream rather than a fault of this
/// service's own.
///
/// The meaningless `event_id` is still ONE VALUE PER NOTIFICATION, shared by
/// the forwards of a single request. The paragraph above says what it may and
/// may not correlate, and splitting the request must not quietly change it.
///
/// # A REFUSAL NOBODY ATTRIBUTES REJECTS NOTHING
///
/// `rejected` is destructive: a homeserver that honours it deletes the pusher,
/// and the device is silent until it registers again. So the question is never
/// "did this fail" but "does the failure name a token".
///
/// From this side it often does not, and the annex of
/// `deploy/messagr-sygnal/sygnal.yaml` — measured against FCM on 6 August
/// 2026, not read off a web page — says exactly why:
///
/// ```text
/// FCM 400 INVALID_ARGUMENT   this is not a registration token   → sygnal 502, no body
/// FCM 401 UNAUTHENTICATED    OUR service account                → sygnal 502, no body
/// FCM 403 PERMISSION_DENIED  OUR project                        → sygnal 502, no body
/// FCM 404 UNREGISTERED       the application is gone            → sygnal 200 {"rejected":[…]}
/// ```
///
/// The first three are the same bodiless `502`. Rejecting on that alone would
/// mean that the day a service account key expires, every pusher on this
/// deployment is deleted at once, silently, and nothing comes back until every
/// device registers again. That is a far worse failure than one phone missing
/// its pushes, so a pushkey is reported rejected only where something names it:
///
/// - **sygnal names it** — its 200 path, which is where an FCM `UNREGISTERED`
///   and an APNs `BadDeviceToken` both end up. Passed back verbatim, as above,
///   and the two transports are coherent because they end in this same list.
/// - **the notification names it by elimination** — the forward carrying this
///   device was refused while the forward carrying another device **of the
///   same `app_id`** was accepted. Our credentials, our project and our
///   payload were identical across the two; the pushkey is the only thing that
///   differed, so the refusal is about it.
///
/// Anything else is written to the log and rejects nobody. What that costs is
/// a wasted push per event for one dead token, on a deployment whose
/// credentials work; what it buys is that no outage can empty the pushers.
///
/// **The same `app_id` is not a detail.** It is what picks the pushkin, and a
/// pushkin holds its own credentials: `eu.messagr` is a Firebase service
/// account, `eu.messagr.apns` is an Apple key, and they fail apart. A person
/// with an Android phone and an iPhone puts one of each in the same
/// notification — so eliminating across app ids would read an accepted APNs
/// device as proof that Firebase works, and the day that key expires, delete
/// the Android pusher of everybody who also owns an iPhone.
///
/// # WHAT THIS STILL CANNOT TELL APART
///
/// Sygnal sheds load with a `502` of its own once a pushkin passes
/// `inflight_request_limit` (512 in `sygnal.yaml`). A notification whose
/// devices share a pushkin could therefore, on a busy enough deployment, have
/// one accepted and one shed — and the rule above would read the shed one as a
/// dead token. `AT_ONCE` keeps this service from ever being the cause of that
/// by itself; a deployment busy enough for it to happen anyway is one where
/// this rule wants revisiting, and the log line says which branch was taken
/// every time.
///
/// # AND THIS HANDLER DOES NOT FAIL
///
/// It answers `200 {"rejected":[…]}` whatever the upstream does, which is why
/// it returns no `Result`. A homeserver reading `500` learns nothing it can
/// act on: it retries the same notification for ever, against a token that
/// will never be valid, and the devices that were fine stay asleep.
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

impl Notification {
    /// Priority describes delivery, not the message: a call has to wake a
    /// sleeping phone and a message does not. A homeserver that sends none
    /// gets the one that wakes a phone -- the alternative is a notification
    /// arriving when the device next feels like it, which for a messenger is
    /// not arriving.
    fn priority(&self) -> &str {
        self.prio.as_deref().unwrap_or("high")
    }
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

/// What one forward to sygnal turned out to be.
///
/// Three outcomes and not two. "The gateway said no" and "the gateway said
/// nothing" lead to different answers here, and the code before #286 folded
/// both of them into an internal error of this service's own.
#[derive(Debug, PartialEq)]
enum Forwarded {
    /// Sygnal delivered, and named the pushkeys it refuses. Possibly none.
    Named(Vec<String>),
    /// Sygnal refused this notification, under this status, naming nothing.
    Refused(u16),
    /// Sygnal was not reached, or its answer could not be read at all.
    Unanswered(String),
}

/// How many forwards of one notification may be in flight at once.
///
/// A homeserver's notify request is for one account's own pushers, so real
/// traffic is a handful and never meets this. What it bounds is the shape this
/// route took on when the forward was split.
///
/// The body limit on the route admits a body naming thousands of devices, and
/// its comment reasons about that costing ONE outbound request: sygnal owned
/// the fan-out and shed load with its own `inflight_request_limit`. Since #286
/// the fan-out is here, and unbounded it would be thousands of simultaneous
/// connections out of this process -- on the one route in this service that
/// authenticates nobody.
const AT_ONCE: usize = 8;

/// One device, and what became of the forward that carried it.
struct Answer {
    /// Its rank in the notification the homeserver sent. The forwards finish
    /// in whatever order the network gives them; `rejected` is still listed in
    /// the order the devices arrived, so two identical notifications produce
    /// two identical answers.
    at: usize,
    app_id: String,
    pushkey: String,
    outcome: Forwarded,
}

pub async fn notify(State(st): State<Arc<AppState>>, Json(body): Json<Notify>) -> Json<Rejected> {
    // Nothing to do and nothing to report. Answered rather than refused: an
    // empty device list is a homeserver being thorough, not a bad request.
    if body.notification.devices.is_empty() {
        return Json(Rejected { rejected: vec![] });
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
        return Json(Rejected { rejected: vec![] });
    };

    // ONE VALUE FOR THE WHOLE NOTIFICATION, and every forward below carries
    // it. See the module header: one per device would be a different property
    // from the one that was reasoned about.
    let event_id = meaningless_id();
    let prio = body.notification.priority().to_owned();

    // Concurrently, because sygnal retries FCM three times before giving up
    // -- ten then twenty seconds, sixty then a hundred and twenty on a quota.
    // Sent one after another, a notification for a handful of devices could
    // hold this request for minutes, which the single batched forward never
    // did.
    let mut forwards = tokio::task::JoinSet::new();
    let at_once = Arc::new(tokio::sync::Semaphore::new(AT_ONCE));
    for (at, device) in body.notification.devices.iter().enumerate() {
        let payload = strip(std::slice::from_ref(device), &prio, &event_id);
        let gateway = gateway.to_owned();
        let app_id = device.app_id.clone();
        let pushkey = device.pushkey.clone();
        let at_once = at_once.clone();
        forwards.spawn(async move {
            // Held for the forward and released with the task. `ok()` and not
            // `unwrap()`: the semaphore is never closed, so this cannot fail,
            // and a forward is not worth a panic if that ever stops being true.
            let _permit = at_once.acquire_owned().await.ok();
            let outcome = forward(&gateway, &payload).await;
            Answer {
                at,
                app_id,
                pushkey,
                outcome,
            }
        });
    }

    let mut answers = Vec::with_capacity(body.notification.devices.len());
    while let Some(finished) = forwards.join_next().await {
        match finished {
            Ok(answer) => answers.push(answer),
            // A forward that panicked. Nothing to say about a pushkey: the
            // fault is this service's own, and it must not cost anybody a
            // pusher.
            Err(why) => tracing::error!("a forward to the push gateway did not finish: {why}"),
        }
    }
    answers.sort_by_key(|answer| answer.at);

    Json(Rejected {
        rejected: rejections(&answers),
    })
}

/// Sends one device's stripped notification, and reads what came back.
///
/// NOT `reqwest`'s `json()`, which is where #286 began: it fails on a body
/// that is not JSON, and the body that matters here is empty. The status is
/// read first and the text second, because a body is only worth parsing once
/// the upstream has said it delivered.
async fn forward(gateway: &str, payload: &Value) -> Forwarded {
    let answer = match forwarder().post(gateway).json(payload).send().await {
        Ok(answer) => answer,
        Err(why) => return Forwarded::Unanswered(why.to_string()),
    };
    let status = answer.status().as_u16();
    match answer.text().await {
        Ok(body) => read(status, &body),
        Err(why) => Forwarded::Unanswered(why.to_string()),
    }
}

/// What a status and a body from sygnal mean.
///
/// Pure, so the table measured against FCM in
/// `deploy/messagr-sygnal/sygnal.yaml` can be asserted without a network.
fn read(status: u16, body: &str) -> Forwarded {
    if !(200..300).contains(&status) {
        return Forwarded::Refused(status);
    }
    match serde_json::from_str::<Value>(body) {
        Ok(answer) => Forwarded::Named(named(answer.get("rejected"))),
        // Delivered, and what it rejected cannot be read. Nothing to report,
        // and NOT a failure: the notification went out.
        Err(_) => Forwarded::Named(Vec::new()),
    }
}

fn named(rejected: Option<&Value>) -> Vec<String> {
    rejected
        .and_then(Value::as_array)
        .map(|found| {
            found
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// Which pushkeys the homeserver is told to stop aiming at, and the line in
/// the log that says why, for every device either way.
///
/// The module header carries the reasoning; this is it, applied.
fn rejections(answers: &[Answer]) -> Vec<String> {
    // Naming by elimination needs something to eliminate against, and it has
    // to be an acceptance UNDER THE SAME `app_id`.
    //
    // `app_id` is what picks the pushkin, and a pushkin carries its own
    // credentials: `eu.messagr` is the Firebase service account, `eu.messagr
    // .apns` is an Apple key, and they can fail apart. A person with an
    // Android phone and an iPhone has one of each in the same notification, so
    // eliminating across app ids would read an accepted APNs device as proof
    // that our Firebase service account works -- and the day that key expires,
    // delete the Android pusher of everybody who also owns an iPhone.
    let accepted: std::collections::HashSet<&str> = answers
        .iter()
        .filter(|answer| matches!(answer.outcome, Forwarded::Named(_)))
        .map(|answer| answer.app_id.as_str())
        .collect();

    let mut rejected = Vec::new();
    for answer in answers {
        match &answer.outcome {
            Forwarded::Named(names) => rejected.extend(names.iter().cloned()),
            Forwarded::Refused(status) if accepted.contains(answer.app_id.as_str()) => {
                tracing::info!(
                    app_id = %answer.app_id, pushkey = %tail(&answer.pushkey), status = %status,
                    "the push gateway refused this device and accepted another of the \
                     same notification under the same app id: the pushkey is the only \
                     thing that differed between the two, so it is reported rejected. \
                     A token an application no longer holds is an ordinary event"
                );
                rejected.push(answer.pushkey.clone());
            }
            Forwarded::Refused(status) => {
                tracing::warn!(
                    app_id = %answer.app_id, pushkey = %tail(&answer.pushkey), status = %status,
                    "the push gateway refused this device and accepted nothing else \
                     under this app id, so nothing is reported rejected: a token FCM \
                     will never accept and a service account that is no longer \
                     authorised arrive here as the same bodiless 502, and only the \
                     second is a reason to keep this deployment's pushers"
                );
            }
            Forwarded::Unanswered(why) => {
                tracing::warn!(
                    app_id = %answer.app_id, pushkey = %tail(&answer.pushkey),
                    "the push gateway did not answer for this device, so it was not \
                     woken and nothing is reported rejected: {why}"
                );
            }
        }
    }
    rejected
}

/// What a pushkey may look like in a log line.
///
/// Not the pushkey. Whoever holds one can wake that device -- `config` refuses
/// a plain-HTTP gateway anywhere but the loopback for exactly that reason --
/// so the whole value does not belong in a journal that is read, quoted and
/// pasted. Six characters are enough to match a line against a `rejected` list
/// or against sygnal's own access log, and not enough to push to anybody.
///
/// Counted in CHARACTERS and not in bytes: a pushkey is a string a client
/// chose, and slicing one by bytes panics the first time it is not ASCII.
fn tail(pushkey: &str) -> String {
    let length = pushkey.chars().count();
    pushkey.chars().skip(length.saturating_sub(6)).collect()
}

/// What is left of a notification once nothing about the message remains.
///
/// Built by naming what to keep rather than what to remove: a deny list would
/// let a field added by a future homeserver through by default, and the whole
/// point is that nothing gets through by default.
///
/// It takes the devices as a slice rather than the notification, because since
/// #286 a forward carries ONE of them and they all share the value their
/// notification drew. There is deliberately no second builder taking a whole
/// notification: a privacy contract asserted against a function production
/// does not call guards nothing.
fn strip(devices: &[Device], prio: &str, event_id: &str) -> Value {
    json!({
        "notification": {
            // Noise, and required. See the module header: sygnal drops a
            // notification carrying no `room_id`, no `event_id` and no
            // counts, so this carries an `event_id` that is not one.
            "event_id": event_id,
            "devices": devices
                .iter()
                .map(|device| json!({
                    "app_id": device.app_id,
                    "pushkey": device.pushkey,
                }))
                .collect::<Vec<_>>(),
            // Kept because it is about delivery and not about the message: a
            // call has to wake a sleeping phone and a message does not need
            // to. It says nothing about who or what.
            "prio": prio,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What leaves for sygnal for a whole notification: the very call the
    /// handler makes for each of its devices, with every device at once.
    ///
    /// A helper and not a second builder — see `strip`. What it asserts about
    /// is the function production calls.
    fn stripped(notification: &Notification) -> Value {
        strip(
            &notification.devices,
            notification.priority(),
            &meaningless_id(),
        )
    }

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

        let sent = stripped(&full);
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
        let sent = stripped(&real);
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
            stripped(&one)["notification"]["event_id"],
            stripped(&two)["notification"]["event_id"]
        );
    }

    /// Sygnal drops a notification with no `room_id`, no `event_id` and no
    /// counts -- measured against the real deployment, where it answered 200
    /// and sent nothing. Whatever else changes here, one of those has to
    /// survive, and `event_id` is the only one that can be made meaningless.
    #[test]
    fn something_survives_that_sygnal_will_accept() {
        let bare = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        let sent = stripped(&bare);
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
        assert!(!stripped(&smuggled).to_string().contains("secret"));
    }

    /// Priority describes delivery, not the message: a call has to wake a
    /// sleeping phone and a message does not. It says nothing about who or
    /// what, so it is the one thing carried through.
    #[test]
    fn priority_is_carried_because_it_describes_delivery() {
        let low = notification(
            r##"{"notification":{"prio":"low","devices":[{"app_id":"a","pushkey":"K"}]}}"##,
        );
        assert_eq!(stripped(&low)["notification"]["prio"], "low");
    }

    /// A homeserver that sends no priority gets the one that wakes a phone.
    /// The alternative is a notification that arrives when the device next
    /// feels like it, which for a messenger is not arriving.
    #[test]
    fn a_missing_priority_becomes_high() {
        let none = notification(r##"{"notification":{"devices":[{"app_id":"a","pushkey":"K"}]}}"##);
        assert_eq!(stripped(&none)["notification"]["prio"], "high");
    }

    /// Every device reaches sygnal. A person with a phone and a tablet has
    /// two, and forwarding one would be a notification that arrives on
    /// whichever registered first.
    ///
    /// Since #286 they reach it in a forward each, and what holds that is
    /// `a_device_is_still_woken_when_its_neighbour_is_refused`. This one holds
    /// the half that stayed here: none of them is dropped on the way in.
    #[test]
    fn every_device_is_carried() {
        let two = notification(
            r##"{"notification":{"devices":[{"app_id":"a","pushkey":"ONE"},
                                           {"app_id":"b","pushkey":"TWO"}]}}"##,
        );
        let sent = stripped(&two);
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
        let wire = stripped(&future).to_string();
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
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
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

    /// **An acceptance under another `app_id` proves nothing.**
    ///
    /// A person with an Android phone and an iPhone puts two app ids in one
    /// notification, and they are two pushkins with two sets of credentials: a
    /// Firebase service account and an Apple key, which fail apart. The day
    /// the Firebase key expires, every Android forward comes back a bodiless
    /// 502 while the iPhone is delivered — and eliminating across app ids
    /// would delete the Android pusher of everybody who also owns an iPhone.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_acceptance_on_another_transport_rejects_nothing(pool: SqlitePool) {
        let (gateway, _seen) = sygnal(|carried: &[String]| {
            if carried.iter().any(|key| key == "ANDROID") {
                bodiless_502()
            } else {
                accepted(&[])
            }
        })
        .await;
        let (status, body) = answer(
            state(pool, Some(gateway)),
            r##"{"notification":{"devices":[
                 {"app_id":"eu.messagr.apns","pushkey":"IPHONE"},
                 {"app_id":"eu.messagr","pushkey":"ANDROID"}]}}"##,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["rejected"],
            json!([]),
            "an accepted Apple push says nothing about the Firebase service \
             account, and this is how an expired key would empty the pushers"
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

    /// The annex of `deploy/messagr-sygnal/sygnal.yaml`, as an assertion.
    ///
    /// Each line of it was measured against FCM on 6 August 2026, and the one
    /// that matters is the last: a 200 whose body cannot be read is still a
    /// notification that went out, not an error to hand back.
    #[test]
    fn what_each_answer_from_sygnal_means() {
        assert_eq!(
            read(200, r#"{"rejected":["GONE"]}"#),
            Forwarded::Named(vec!["GONE".to_owned()]),
            "FCM 404 UNREGISTERED and APNs BadDeviceToken both arrive here"
        );
        assert_eq!(read(200, r#"{"rejected":[]}"#), Forwarded::Named(vec![]));
        assert_eq!(
            read(502, ""),
            Forwarded::Refused(502),
            "FCM 400, 401 and 403 are indistinguishable at this point"
        );
        assert_eq!(read(400, "not json"), Forwarded::Refused(400));
        assert_eq!(
            read(200, ""),
            Forwarded::Named(vec![]),
            "delivered, and nothing readable to report -- not a failure"
        );
    }

    /// A pushkey is not written to the log whole: whoever holds one can wake
    /// that device. Counted in characters, because a client chooses the
    /// string and slicing one by bytes panics the first time it is not ASCII.
    #[test]
    fn a_log_line_carries_a_tail_and_never_the_pushkey() {
        assert_eq!(tail("cXVpdGVhbG9uZ2xvb2tpbmd0b2tlbg"), "b2tlbg");
        assert_eq!(tail("short"), "short");
        assert_eq!(tail(""), "");
        // Multibyte, and this is the line that would have panicked.
        assert_eq!(tail("clé-é-€-abc"), "-€-abc");
    }
}
