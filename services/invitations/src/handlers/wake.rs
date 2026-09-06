use std::sync::{Arc, OnceLock};

use axum::{extract::State, Json};
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
        assert_eq!(keys, vec!["devices", "prio"]);

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
}
