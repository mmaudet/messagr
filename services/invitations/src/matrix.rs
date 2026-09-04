use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub struct DormantAccount {
    pub user_id: String,
    pub localpart: String,
    pub password: String,
    pub access_token: String,
}

/// What a `sync` learns about a reserved account's invitation room.
///
/// The TWO kinds of missing room must be distinguished, because they call for
/// OPPOSITE decisions in the caller: one condemns the account, the other must
/// leave it strictly intact.
///
/// The account is created at claim time (lot 0, task 0.2): it is **the
/// inviter's client** that issues the Matrix invitation, with its own rights
/// (§7). A reserved account this client has not yet invited — or has failed to
/// invite — therefore appears in none of the three lists, and that is a
/// perfectly healthy state. Confusing it with an account stuck mid-flow
/// destroys accounts that nothing condemned.
#[derive(Debug, PartialEq, Eq)]
pub enum PendingInviteRoom {
    /// Room found: pending invitation (`rooms.invite`), or room already joined
    /// (`rooms.join`) — resuming a flow interrupted after the `join`.
    Found(String),
    /// No pending or joined room, but the account has LEFT at least one: the
    /// flow was interrupted between `leave_room` and `deactivate`. This
    /// account has already given up its place, it can do nothing any more.
    Left,
    /// The account appears nowhere: nobody has invited it yet. Normal state of
    /// a freshly reserved account.
    NeverInvited,
}

/// What an invitation attempt produced.
///
/// Both outcomes are SUCCESSES for the caller, and a type was needed to say
/// so: the refusal "the target is already in the room" describes exactly the
/// desired state, reached in advance. Confusing it with a failure answers
/// "retry" to a situation retrying cannot improve, and costs a reserved
/// resource on each attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum InviteIssue {
    /// The invitation was issued.
    Issued,
    /// The homeserver refused it because the target is already a member of the
    /// room, or already invited.
    AlreadyThere,
    /// The homeserver REFUSED TO AUTHORIZE (403), and the target has no place
    /// in the room.
    ///
    /// Distinct from an `Err`, which covers transport AND any other status:
    /// here the homeserver answered, it is fine, and its answer is a refusal
    /// of RIGHTS. The difference is not cosmetic — it separates "the stack is
    /// unwell" from "the room's rights forbid inviting", which call for
    /// opposite gestures, one of which is repaired by a single configuration
    /// line.
    ///
    /// The status is carried because it is the one that was OBSERVED, and it
    /// goes to the log as-is.
    Refused(reqwest::StatusCode),
}

/// What a room's own state says about ONE account inviting into it.
///
/// Two numbers and no verdict, deliberately: the verdict is
/// [`permits_invitation`](InviteRights::permits_invitation), and the numbers
/// go into the refusal the caller reads. A refusal that says "not allowed"
/// without saying "50 required, you hold 0" tells an operator nothing, and
/// this service has already paid once for an error message that named no
/// cause (`AppError::MatrixInviteRefused`).
#[derive(Debug, PartialEq, Eq)]
pub struct InviteRights {
    /// The level `m.room.power_levels` requires for `invite` IN THIS ROOM.
    ///
    /// **NEVER A CONSTANT, AND THAT IS THE POINT.** The Matrix specification's
    /// default for this key is 0, and a room born before this lot carries no
    /// `invite` key at all — measured on production on 14 August 2026, on the
    /// demonstration room and on both of the fixture account's other rooms.
    /// Comparing against a hardcoded 50 would refuse the demonstration.
    pub required: i64,
    /// What the room grants the account asked about.
    pub held: HeldPower,
}

/// The power an account holds in a room, with the ONE case a number cannot
/// express.
#[derive(Debug, PartialEq, Eq)]
pub enum HeldPower {
    /// A creator of the room, in a room version that privileges creators
    /// IMPLICITLY — from version 12 on. Such an account is above every number
    /// and is absent from `users` BY RULE: production served `users: {}` for a
    /// room the fixture account had just created (14 August 2026), and ruma
    /// refuses a `users` map that names a creator outright
    /// (`PowerLevelsError::CreatorInUsersMap`).
    ///
    /// Reading such an account's level out of `users` would put the creator of
    /// a brand-new room at 0 against its own `invite` of 50, and refuse her
    /// the first invitation into the room she just made.
    Creator,
    /// A plain level, from `users`, or from `users_default` when the map does
    /// not name the account.
    Level(i64),
}

impl InviteRights {
    pub fn permits_invitation(&self) -> bool {
        match self.held {
            HeldPower::Creator => true,
            HeldPower::Level(level) => level >= self.required,
        }
    }
}

/// Why the rights could not be established. THREE outcomes, because they call
/// for three different things from the caller, and flattening them is how a
/// service ends up sending an operator to chase an outage that does not exist
/// (the reasoning `AppError::MatrixInviteRefused` already carries).
#[derive(Debug, PartialEq, Eq)]
pub enum InviteRightsError {
    /// The homeserver answered, and its answer is that this account may not
    /// see that room's state. Measured on 14 August 2026: continuwuity returns
    /// **404** `M_NOT_FOUND` "You don't have permission to view the room
    /// state." for a room the account has left; the specification prescribes
    /// 403. Both mean the same thing here and neither is retryable.
    NotVisible,
    /// Transport failure, or a status that says the stack is unwell. Retryable
    /// — nothing about the room's rights has been established.
    Unreachable,
    /// The homeserver answered 200 and this code cannot conclude from what it
    /// sent. NEVER a permission: the campaign has just measured what the
    /// opposite costs, `revoke_invitation` turning a 404 into a success and
    /// leaving thirty-two live accounts the database believed dead.
    Unreadable(&'static str),
}

/// Reads out of a room's state what it permits `user_id` to do about inviting.
///
/// A free function taking the state ALREADY FETCHED, so the whole rule is
/// testable against the exact bytes production serves, with no server in the
/// way. [`MatrixClient::invite_rights_in_room`] is the one caller that fetches.
///
/// **THE ORDER OF THE TWO QUESTIONS MATTERS.** The create event is read
/// first, and its absence is an error rather than a default: it is what proves
/// the answer describes a room at all. The power levels event, on the other
/// hand, may legitimately be absent — the specification then applies its own
/// defaults, under which inviting costs 0.
pub fn invite_rights(state: &[Value], user_id: &str) -> Result<InviteRights, InviteRightsError> {
    let event = |kind: &str| {
        state.iter().find(|e| {
            e["type"].as_str() == Some(kind) && e["state_key"].as_str().unwrap_or("").is_empty()
        })
    };
    let create = event("m.room.create").ok_or(InviteRightsError::Unreadable(
        "the room's state carries no m.room.create event",
    ))?;

    // The creator is the SENDER of the create event, never a field of its
    // content: room version 11 removed `creator`, and the live read of
    // 14 August 2026 returned exactly `{"room_version":"12"}` — content alone
    // names nobody. A create event with no sender is therefore not something
    // to shrug at; it is a state this code cannot conclude from.
    let creator = create["sender"]
        .as_str()
        .ok_or(InviteRightsError::Unreadable(
            "the room's m.room.create event names no sender, so no creator can be recognised",
        ))?;

    // Version 12 is where creators stop appearing in `users` and start being
    // privileged implicitly. An UNPARSEABLE version — a custom or future one —
    // is treated as NOT privileging its creators, which costs at worst a
    // refusal, never a link the emitter cannot honour.
    let version = create["content"]["room_version"].as_str().unwrap_or("1");
    let creators_are_privileged = version.parse::<u64>().is_ok_and(|v| v >= 12);
    let is_creator = creators_are_privileged
        && (user_id == creator
            || create["content"]["additional_creators"]
                .as_array()
                .is_some_and(|extra| extra.iter().any(|c| c.as_str() == Some(user_id))));

    let Some(levels) = event("m.room.power_levels") else {
        // A room with no power levels event at all: the specification's
        // defaults, under which `invite` is 0 and `users_default` is 0.
        return Ok(InviteRights {
            required: 0,
            held: if is_creator {
                HeldPower::Creator
            } else {
                HeldPower::Level(0)
            },
        });
    };
    let content = &levels["content"];

    // A KEY THAT IS ABSENT IS A SPECIFICATION DEFAULT; A KEY THAT IS PRESENT
    // AND UNREADABLE IS AN ERROR. Collapsing the two would turn `"invite":
    // "fifty"` into `invite: 0` — a permission, granted because a value could
    // not be read.
    let number = |value: &Value, what: &'static str| -> Result<Option<i64>, InviteRightsError> {
        match value {
            Value::Null => Ok(None),
            other => other
                .as_i64()
                .map(Some)
                .ok_or(InviteRightsError::Unreadable(what)),
        }
    };

    let required = number(
        &content["invite"],
        "the room's power levels carry an `invite` value that is not a whole number",
    )?
    .unwrap_or(0);

    let held = if is_creator {
        HeldPower::Creator
    } else {
        let own = number(
            &content["users"][user_id],
            "the room's power levels carry a level that is not a whole number",
        )?;
        let default = number(
            &content["users_default"],
            "the room's power levels carry a `users_default` that is not a whole number",
        )?;
        HeldPower::Level(own.or(default).unwrap_or(0))
    };

    Ok(InviteRights { required, held })
}

pub struct MatrixClient {
    base: String,
    registration_token: String,
    http: reqwest::Client,
}

pub fn next_stage(body: &Value) -> Option<String> {
    let done: Vec<&str> = body["completed"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    body["flows"].as_array()?.iter().find_map(|f| {
        f["stages"]
            .as_array()?
            .iter()
            .filter_map(|s| s.as_str())
            .find(|s| !done.contains(s))
            .map(str::to_string)
    })
}

impl MatrixClient {
    pub fn new(base: String, registration_token: String) -> Self {
        Self {
            base,
            registration_token,
            http: reqwest::Client::new(),
        }
    }

    fn cs(&self, path: &str) -> String {
        format!("{}/_matrix/client{}", self.base, path)
    }

    /// Creates a dormant account under the name and password IT IS GIVEN.
    ///
    /// They used to be drawn here; they are now drawn by the caller, and that
    /// is not a cosmetic move. This function performs an IRREVERSIBLE act — a
    /// localpart is never released by the homeserver — and as long as it chose
    /// the name itself, nobody could keep track of it before it succeeded. A
    /// call that returns `Err` while the account has indeed been created
    /// (cut-off after validation on the Synapse side, truncated 2xx response
    /// rejected further down, expired deadline) then left an account that
    /// NOTHING in the world designated any more. Six `messagr-reserved`
    /// accounts from the prototype are exactly that.
    ///
    /// The caller therefore names the account, writes it down, then calls
    /// here. See `handlers::claim::create_account_for_claim`.
    ///
    /// **THIS BODY CARRIES NO `displayname`, AND THAT IS WHY EVERY ACCOUNT
    /// BORN HERE WEARS A FLAG.** Measured on 17 August 2026, against
    /// production, by reading the public profile of two accounts this service
    /// created:
    ///
    /// ```text
    /// GET https://messagr.eu/_matrix/client/v3/profile/@wfjptgycdyg2:messagr.eu
    /// {"displayname":"wfjptgycdyg2 🏳️‍⚧️"}
    /// ```
    ///
    /// The suffix is not this repository's. It is Continuwuity's
    /// `new_user_displayname_suffix`, whose documented DEFAULT is that flag
    /// ("Text which will be added to the end of the user's displayname upon
    /// registration with a space before the text",
    /// <https://continuwuity.org/reference/config.html>). Because this request
    /// names no display name, the homeserver composes one, and it composes it
    /// from its own default.
    ///
    /// **NOBODY HERE DECIDED IT, WHICH IS THE POINT OF WRITING IT DOWN.**
    /// `new_user_displayname_suffix` appears nowhere in this repository, and
    /// the production homeserver's own configuration file is not versioned
    /// here at all: `deploy/continuwuity.toml` is the prototype
    /// (`messagr.maudet.cloud`) and `deploy/fork/continuwuity.toml` is the
    /// fork (`messagr-fork.maudet.cloud`). So the string that names every
    /// account of this product came from an upstream default that no reader of
    /// this repository could trace. The porteur saw it in his conversation
    /// list on 17 August 2026 as `wfjptgycdyg2 🏳️‍⚧️` and nobody could say why.
    ///
    /// **WHAT IT IS NOT.** It is not a leak: the flag never came from another
    /// account, from a fixture or from anything this service stores. And it is
    /// not cosmetic either: `core::people::resolve` draws the Matrix display
    /// name faithfully whenever this device has given the person no local name
    /// of its own (AGENTS.md §7.6), so this string is what a reader sees.
    ///
    /// **WHAT IS OWED, AND IT IS THE PORTEUR'S TO DECIDE, NOT THIS FILE'S**:
    /// whether accounts should carry that suffix, no suffix, or a display name
    /// this service chooses. Any of the three is a product decision; recording
    /// the mechanism is not. Note that a configuration change would reach only
    /// accounts registered AFTER it: the existing ones keep the name the
    /// homeserver already wrote.
    pub async fn register_dormant(
        &self,
        localpart: &str,
        password: &str,
    ) -> Result<DormantAccount> {
        let (localpart, password) = (localpart.to_string(), password.to_string());
        let base_body = json!({
            "username": localpart, "password": password,
            "initial_device_display_name": "messagr-reserved"
        });
        let mut body = base_body.clone();
        for _ in 0..5 {
            let r = self
                .http
                .post(self.cs("/v3/register"))
                .query(&[("kind", "user")])
                .json(&body)
                .send()
                .await?;
            if r.status().is_success() {
                let d: Value = r.json().await?;
                // NEVER `unwrap_or_default()` on an identity or a secret: a
                // truncated 2xx response would produce an empty `user_id` and
                // an empty token, recorded as-is in the database — a phantom
                // reserved account, impossible to deactivate, and an empty
                // identity that propagates. An incomplete response is an
                // error, not a default.
                return Ok(DormantAccount {
                    user_id: d["user_id"]
                        .as_str()
                        .ok_or_else(|| anyhow!("register response without user_id"))?
                        .to_string(),
                    localpart,
                    password,
                    access_token: d["access_token"]
                        .as_str()
                        .ok_or_else(|| anyhow!("register response without access_token"))?
                        .to_string(),
                });
            }
            if r.status() != reqwest::StatusCode::UNAUTHORIZED {
                return Err(anyhow!(
                    "register failed: {} {}",
                    r.status(),
                    r.text().await?
                ));
            }
            let challenge: Value = r.json().await?;
            let stage =
                next_stage(&challenge).ok_or_else(|| anyhow!("UIA with no remaining stage"))?;
            let mut auth = json!({"type": stage, "session": challenge["session"]});
            if stage == "m.login.registration_token" {
                auth["token"] = json!(self.registration_token);
            }
            body = base_body.clone();
            body["auth"] = auth;
        }
        Err(anyhow!("too many UIA stages"))
    }

    /// Opens a session by password and returns the access token obtained.
    ///
    /// Exists for ONE path only, and it must be known: neutralizing an account
    /// whose reservation was interrupted between the writing of the trace and
    /// its completion. That row carries the password — written ahead — but NO
    /// access token, since only the homeserver could give one and it never had
    /// the opportunity to return it. Yet `deactivate` requires a bearer token
    /// on top of password UIA: without this function, such a row would be
    /// visible and yet impossible to honour, which would only have moved the
    /// orphan from the database to the homeserver.
    ///
    /// NOT an authentication path of the service: no external caller reaches
    /// it, and the password used is the one the service itself drew for a
    /// dormant account.
    pub async fn login(&self, localpart: &str, password: &str) -> Result<String> {
        let r = self
            .http
            .post(self.cs("/v3/login"))
            .json(&json!({
                "type": "m.login.password",
                "identifier": {"type": "m.id.user", "user": localpart},
                "password": password
            }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("login refused: {}", r.status()));
        }
        // Same discipline as `whoami` and `register_dormant`: a 2xx response
        // without a token is an error, never an empty string — an empty token
        // would make the deactivation fail further down, under a message that
        // would not name its cause.
        Ok(r.json::<Value>().await?["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("login response without access_token"))?
            .to_string())
    }

    /// Returns the caller's identity, or an error — **never an empty string**.
    /// An `unwrap_or_default()` here would turn a 2xx `whoami` without
    /// `user_id` into a valid authenticated principal `""`: under a single bad
    /// upstream configuration, every caller would authenticate as the same
    /// empty principal, and with `may_revoke("", "")` being true, each one
    /// could revoke the others' invitations.
    pub async fn whoami(&self, token: &str) -> Result<String> {
        let r = self
            .http
            .get(self.cs("/v3/account/whoami"))
            .bearer_auth(token)
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("token refused"));
        }
        Ok(r.json::<Value>().await?["user_id"]
            .as_str()
            .ok_or_else(|| anyhow!("whoami response without user_id"))?
            .to_string())
    }

    /// Identifier of the DEVICE this token belongs to.
    ///
    /// An access token is not enough to restore a Matrix session: the device
    /// identifier is also needed. Without it, the handed-out client would have
    /// to log back in by password — thus creating a SECOND device, and making
    /// the token just handed to it useless.
    ///
    /// Same discipline as `whoami`: a 2xx response without `device_id` is an
    /// error, never an empty string.
    pub async fn whoami_device(&self, token: &str) -> Result<String> {
        let r = self
            .http
            .get(self.cs("/v3/account/whoami"))
            .bearer_auth(token)
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("token refused"));
        }
        Ok(r.json::<Value>().await?["device_id"]
            .as_str()
            .ok_or_else(|| anyhow!("whoami response without device_id"))?
            .to_string())
    }

    pub async fn join_room(&self, token: &str, room: &str) -> Result<()> {
        let r = self
            .http
            .post(self.cs(&format!("/v3/join/{room}")))
            .bearer_auth(token)
            .json(&json!({}))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("join refused: {}", r.status()));
        }
        Ok(())
    }

    /// Invites `user_id` into `room`, distinguishing the refusal that is not
    /// one.
    ///
    /// The homeserver does NOT say why it refuses: measured on 6 August 2026
    /// on the prototype, inviting someone who is already a member of the room
    /// returns `403 M_FORBIDDEN {"error":"Event is not authorized."}` — word
    /// for word what a rights refusal returns. The status and the body are
    /// therefore silent, and it is the membership that must be read.
    ///
    /// It is only read AFTER a refusal: the nominal path keeps a single round
    /// trip.
    pub async fn invite(&self, token: &str, room: &str, user_id: &str) -> Result<InviteIssue> {
        let r = self
            .http
            .post(self.cs(&format!("/v3/rooms/{room}/invite")))
            .bearer_auth(token)
            .json(&json!({"user_id": user_id}))
            .send()
            .await?;
        if r.status().is_success() {
            return Ok(InviteIssue::Issued);
        }
        let status = r.status();
        // ONLY 403 lends itself to the interpretation that follows: it is the
        // authorization refusal, the one produced by an insufficient power
        // level as well as by an already-member target. Everything else says
        // the homeserver is NOT well — 429 for rate limiting, routine on this
        // route when a ten-use QR is scanned in a burst (§5.5), 502 and 504
        // for a struggling stack, 401 for a token worth nothing any more.
        //
        // Passing them off as an authorization refusal would send the operator
        // fixing rights that are not at fault, under a false assertion:
        // exactly the mistake the `Refused` distinction exists to remove, with
        // the polarity reversed.
        if status != reqwest::StatusCode::FORBIDDEN {
            return Err(anyhow!("invite failed: {status}"));
        }
        match self.membership(token, room, user_id).await {
            // Already a member, or already invited: the wanted result, reached
            // in advance.
            Ok(Some(m)) if m == "join" || m == "invite" => Ok(InviteIssue::AlreadyThere),
            // Everything else — absent membership, `leave`, `ban`, or
            // unreadable — remains a failure. When in doubt, do not conclude
            // the invitation took place: the caller draws irreversible
            // consequences from it.
            //
            // But an INFORMED failure: the homeserver answered, so it is not
            // the one missing. A membership read itself failing changes nothing
            // about that finding — the refusal is established.
            _ => Ok(InviteIssue::Refused(status)),
        }
    }

    /// Membership of `user_id` in `room`, or `None` if it does not exist.
    ///
    /// `404` is a legitimate absence (no member event), not an error; any
    /// other non-2xx status is one, for the usual reason in this file: a
    /// stammering homeserver must not pass for an absence, the caller drawing
    /// definitive conclusions from one.
    pub async fn membership(
        &self,
        token: &str,
        room: &str,
        user_id: &str,
    ) -> Result<Option<String>> {
        let r = self
            .http
            .get(self.cs(&format!("/v3/rooms/{room}/state/m.room.member/{user_id}")))
            .bearer_auth(token)
            .send()
            .await?;
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !r.status().is_success() {
            return Err(anyhow!("membership read refused: {}", r.status()));
        }
        Ok(r.json::<Value>().await?["membership"]
            .as_str()
            .map(str::to_string))
    }

    pub async fn leave_room(&self, token: &str, room: &str) -> Result<()> {
        let r = self
            .http
            .post(self.cs(&format!("/v3/rooms/{room}/leave")))
            .bearer_auth(token)
            .json(&json!({}))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("leave refused: {}", r.status()));
        }
        Ok(())
    }

    /// Password UIA. Used for the ROTATION at hand-out.
    ///
    /// BEWARE of what this step does and does not do. It changes the password;
    /// it REVOKES NOTHING: `logout_devices: false`, and it is this same access
    /// token — the one the service held — that is then handed out to the
    /// claimant. The service's loss of access (§5 of the spec) therefore rests
    /// solely on erasing its copy in the database, not on a revocation on the
    /// homeserver side: any earlier copy of the database (backup, snapshot,
    /// replica) remains valid after the hand-out.
    ///
    /// `logout_devices: false` is necessary here: it is what keeps the token
    /// handed to the claimant alive. Closing the hole would require handing
    /// out a NEW token, obtained after the rotation — not setting the flag to
    /// `true`.
    pub async fn set_password(
        &self,
        token: &str,
        localpart: &str,
        old: &str,
        new: &str,
    ) -> Result<()> {
        let auth = json!({
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": localpart},
            "password": old
        });
        let r = self
            .http
            .post(self.cs("/v3/account/password"))
            .bearer_auth(token)
            .json(&json!({"new_password": new, "logout_devices": false, "auth": auth}))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("password change refused: {}", r.status()));
        }
        Ok(())
    }

    /// Verified on 5 August 2026: requires m.login.password, the token alone is not enough.
    pub async fn deactivate(&self, token: &str, localpart: &str, password: &str) -> Result<()> {
        let auth = json!({
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": localpart},
            "password": password
        });
        let r = self
            .http
            .post(self.cs("/v3/account/deactivate"))
            .bearer_auth(token)
            .json(&json!({"auth": auth}))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("deactivation refused: {}", r.status()));
        }
        Ok(())
    }

    /// What `room` permits `user_id` to do about inviting, read WITH THAT
    /// ACCOUNT'S OWN TOKEN.
    ///
    /// **THE SERVICE HAS NO ROOM-READING RIGHT OF ITS OWN, AND DOES NOT NEED
    /// ONE.** Every other Matrix call in this file that concerns a room acts
    /// on behalf of an account and carries that account's bearer; the service's
    /// only credential of its own is `registration_token`, which registers
    /// accounts and does nothing else. This call is the same shape: the caller
    /// of `POST /invitations` presented a bearer, `auth::authenticate` proved
    /// whose it is, and the room is read as that person. **Reading is not
    /// inviting** — the invitation itself is still issued by the inviter's own
    /// client, with its own rights (§7), which is what
    /// `handlers::claim`'s `NoPendingRoom` exists to wait for.
    ///
    /// That the read succeeds with a member's own token is MEASURED, not
    /// assumed: on 14 August 2026 the fixture account read
    /// `m.room.power_levels` back off two rooms of production (messagr.eu,
    /// continuwuity) with nothing but its own access token, one of them a room
    /// it had just created and one the demonstration room. The same session
    /// then left and forgot the first room, and the endpoint that had answered
    /// 200 answered 404 — which is where [`InviteRightsError::NotVisible`]'s
    /// status comes from.
    ///
    /// **WHY THE WHOLE STATE AND NOT `state/m.room.power_levels`.** The single
    /// event endpoint returns a CONTENT, and from version 11 the creator is
    /// not in the create event's content — it is its `sender`. The measured
    /// read confirms it: `m.room.create` came back as `{"room_version":"12"}`
    /// and nothing else. So the one endpoint that answers both halves of the
    /// question in one round trip is the room's full state. The price is that
    /// price: a room with many members returns one event per member, on a
    /// gesture that happens once per invitation.
    pub async fn invite_rights_in_room(
        &self,
        token: &str,
        room: &str,
        user_id: &str,
    ) -> Result<InviteRights, InviteRightsError> {
        let r = self
            .http
            .get(self.cs(&format!("/v3/rooms/{room}/state")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| InviteRightsError::Unreachable)?;
        // ONLY these two statuses lend themselves to "this account may not see
        // that room". Everything else says the stack is unwell — 429 for rate
        // limiting, 502 and 504 for a struggling upstream — and passing them
        // off as a rights answer would send an operator fixing rights that are
        // not at fault. Same distinction, same reason, as `invite` above.
        if r.status() == reqwest::StatusCode::NOT_FOUND
            || r.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(InviteRightsError::NotVisible);
        }
        if !r.status().is_success() {
            return Err(InviteRightsError::Unreachable);
        }
        let state: Vec<Value> = r
            .json()
            .await
            .map_err(|_| InviteRightsError::Unreadable("the room's state could not be read"))?;
        invite_rights(&state, user_id)
    }

    /// Discovers TRANSIENTLY the room of a pending invitation.
    /// This `room_id` must never be written to the database (global constraint).
    ///
    /// A non-2xx status remains an `Err` and NEVER becomes a silent absence:
    /// the caller draws definitive conclusions about the account from an
    /// absence; a stammering homeserver must not trigger them.
    pub async fn pending_invite_room(&self, token: &str) -> Result<PendingInviteRoom> {
        let r = self
            .http
            .get(self.cs("/v3/sync"))
            .bearer_auth(token)
            .query(&[("timeout", "0")])
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("sync failed: {}", r.status()));
        }
        let d: Value = r.json().await?;
        // Pending invitations FIRST, then rooms already joined. This fallback
        // is what makes the task 7 flow replayable: `join_room` moves the
        // room out of `rooms.invite`, so without it any resumption after a
        // successful join would find nothing — hence a permanent 404, and a
        // reserved account poisoned forever.
        let found = d["rooms"]["invite"]
            .as_object()
            .and_then(|m| m.keys().next().cloned())
            .or_else(|| {
                d["rooms"]["join"]
                    .as_object()
                    .and_then(|m| m.keys().next().cloned())
            });
        if let Some(room) = found {
            return Ok(PendingInviteRoom::Found(room));
        }

        // THE DISCRIMINANT OF THE TWO ABSENCES. An account that has left a
        // room keeps a trace of it in `rooms.leave`: it is the signature of a
        // flow interrupted between `leave_room` and `deactivate`. An
        // account nobody has invited yet has none.
        //
        // It is the NON-EMPTINESS that matters, not the mere presence of the
        // key: a fresh account gets `"leave": {}`. Confusing this empty list
        // with a departure would condemn precisely the healthy accounts.
        let has_left = d["rooms"]["leave"]
            .as_object()
            .is_some_and(|m| !m.is_empty());
        Ok(if has_left {
            PendingInviteRoom::Left
        } else {
            PendingInviteRoom::NeverInvited
        })
    }

    /// EVERY room this account holds a place in, read with ITS OWN bearer.
    ///
    /// Distinct from [`pending_invite_room`](Self::pending_invite_room), which
    /// answers "which room is this reservation's flow about" and stops at the
    /// first one it finds. Here the caller must decide whether ONE named room
    /// is among them, so stopping at the first would answer the wrong question
    /// on any account that lives in two rooms.
    ///
    /// **THE SERVICE HAS NO ROOM-READING RIGHT OF ITS OWN**, which
    /// [`invite_rights_in_room`](Self::invite_rights_in_room) already states.
    /// The account's own point of view is what answers.
    ///
    /// # A body that parses is not an answer
    ///
    /// A 200 carrying no `rooms` object — or a `rooms` that is not an object —
    /// is an ERROR here, not an empty membership. The caller turns every error
    /// of this function into a refusal; turning a shapeless 200 into "it is in
    /// no room" would turn a refusal into a permission on exactly the day the
    /// homeserver is unwell.
    pub async fn rooms_of_the_account(&self, token: &str) -> Result<RoomsOfTheAccount> {
        let r = self
            .http
            .get(self.cs("/v3/sync"))
            .bearer_auth(token)
            .query(&[("timeout", "0")])
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("sync failed: {}", r.status()));
        }
        let d: Value = r.json().await?;
        let rooms = d["rooms"]
            .as_object()
            .ok_or_else(|| anyhow!("sync answered 200 without a `rooms` object"))?;
        let names = |key: &str| -> Vec<String> {
            rooms
                .get(key)
                .and_then(Value::as_object)
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default()
        };
        Ok(RoomsOfTheAccount {
            joined: names("join"),
            invited: names("invite"),
            left: names("leave"),
            predecessors: predecessors_in(rooms),
        })
    }
}

/// Every room an account holds, or has given up, a place in.
///
/// The three lists are kept apart because they do NOT call for the same
/// decision: a place held is a place held whether it was accepted or only
/// offered, while a room already left is a place given up.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RoomsOfTheAccount {
    /// `rooms.join` — membership accepted.
    pub joined: Vec<String>,
    /// `rooms.invite` — a place offered and still standing. Deactivating
    /// declines it, and a frozen room stops showing an arrival it was showing.
    pub invited: Vec<String>,
    /// `rooms.leave` — a place already given up.
    pub left: Vec<String>,
    /// `(room, the room it replaced)`, for every room whose `m.room.create`
    /// the sync happened to carry with a `predecessor`.
    ///
    /// **READ ONLY TO REFUSE, NEVER TO PERMIT**, and that is what makes it
    /// safe to build out of a response shape this repository has not measured.
    /// If the sync carries no state at all this list is empty and NOTHING
    /// changes; it can only ever ADD a refusal. See
    /// `named_deactivation::the_demonstration_verdict`.
    pub predecessors: Vec<(String, String)>,
}

/// Digs `m.room.create`'s `predecessor.room_id` out of whatever state a sync
/// chose to carry, under both of the shapes that carry state: `state.events`
/// for a joined room, `invite_state.events` for an offered one.
fn predecessors_in(rooms: &serde_json::Map<String, Value>) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for section in ["join", "invite", "leave"] {
        let Some(by_room) = rooms.get(section).and_then(Value::as_object) else {
            continue;
        };
        for (room, body) in by_room {
            for holder in ["state", "invite_state"] {
                let Some(events) = body[holder]["events"].as_array() else {
                    continue;
                };
                for e in events {
                    if e["type"] == "m.room.create" {
                        if let Some(p) = e["content"]["predecessor"]["room_id"].as_str() {
                            found.push((room.clone(), p.to_string()));
                        }
                    }
                }
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_first_uncompleted_stage() {
        let body = serde_json::json!({
            "flows": [{"stages": ["m.login.registration_token", "m.login.dummy"]}],
            "completed": ["m.login.registration_token"],
            "session": "s1"
        });
        assert_eq!(next_stage(&body), Some("m.login.dummy".to_string()));
    }

    #[test]
    fn returns_none_when_everything_is_completed() {
        let body = serde_json::json!({
            "flows": [{"stages": ["m.login.dummy"]}],
            "completed": ["m.login.dummy"], "session": "s1"
        });
        assert_eq!(next_stage(&body), None);
    }

    /// A real local TCP server that answers 200 with the given JSON body,
    /// whatever the request. Enough to test the decoding of homeserver
    /// responses without simulating its logic: it is exactly the truncated 2xx
    /// body that is at stake here.
    async fn fake_server(body: &'static str) -> String {
        fake_server_with_status("200 OK", body).await
    }

    /// Same thing, but with the chosen status — and ALWAYS a usable JSON body.
    /// An empty body would make the decoding fail by itself: the status test
    /// would then pass even if the status check disappeared, and would prove
    /// nothing.
    async fn fake_server_with_status(status: &'static str, body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let response = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        base
    }

    /// The fixed defect: `unwrap_or_default()` turned a 2xx `whoami` without
    /// `user_id` into an `Ok("")`, which `auth::authenticate` returned as an
    /// authenticated principal. With `may_revoke("", "")` being true, any
    /// caller could then revoke the invitations issued in that state. On the
    /// pre-fix code, the first assertion fails.
    #[tokio::test]
    async fn whoami_rejects_an_absent_identity_and_returns_the_one_that_is_there() {
        let empty = MatrixClient::new(fake_server("{}").await, String::new());
        assert!(
            empty.whoami("token").await.is_err(),
            "a 2xx response without user_id must never produce a principal"
        );

        // Control: without it, the assertion above would also pass for a
        // broken server or a client that never reaches the decoding.
        let good = MatrixClient::new(
            fake_server(r#"{"user_id":"@alice:h"}"#).await,
            String::new(),
        );
        assert_eq!(good.whoami("token").await.unwrap(), "@alice:h");
    }

    /// Same family on `/register`: a `user_id` or an `access_token` missing
    /// from a 2xx response produced a reserved account recorded in the
    /// database with empty fields — unfindable on the homeserver, hence never
    /// deactivatable.
    #[tokio::test]
    async fn register_rejects_a_truncated_response_and_accepts_a_complete_one() {
        for truncated in ["{}", r#"{"user_id":"@a:h"}"#, r#"{"access_token":"t"}"#] {
            let mx = MatrixClient::new(fake_server(truncated).await, String::new());
            assert!(
                mx.register_dormant("localpart", "pw").await.is_err(),
                "incomplete 2xx response accepted: {truncated}"
            );
        }

        let mx = MatrixClient::new(
            fake_server(r#"{"user_id":"@a:h","access_token":"t"}"#).await,
            String::new(),
        );
        let account = mx.register_dormant("localpart", "pw").await.unwrap();
        assert_eq!(account.user_id, "@a:h");
        assert_eq!(account.access_token, "t");
        assert_eq!(
            (account.localpart.as_str(), account.password.as_str()),
            ("localpart", "pw"),
            "the account must be created under the GIVEN name, otherwise the \
             trace written ahead would not designate the account actually created"
        );
    }

    /// `login` is the only way to honour a row written ahead: it carries the
    /// password but no access token, and `deactivate` requires one.
    ///
    /// Same discipline as its neighbours: a refusal stays a refusal, and a 2xx
    /// response without `access_token` is an ERROR — never an empty token,
    /// which would make the deactivation fail further down under a silent
    /// message.
    #[tokio::test]
    async fn login_rejects_a_failure_and_a_truncated_response_then_returns_the_token() {
        let refused = MatrixClient::new(
            fake_server_with_status("403 Forbidden", r#"{"errcode":"M_FORBIDDEN"}"#).await,
            String::new(),
        );
        assert!(refused.login("x", "pw").await.is_err(), "403");

        let truncated =
            MatrixClient::new(fake_server(r#"{"user_id":"@a:h"}"#).await, String::new());
        assert!(
            truncated.login("x", "pw").await.is_err(),
            "a 2xx response without access_token must never produce an empty token"
        );

        // Control: without it, the two assertions above would also pass for a
        // `login` that always failed.
        let good = MatrixClient::new(
            fake_server(r#"{"access_token":"fresh-token"}"#).await,
            String::new(),
        );
        assert_eq!(good.login("x", "pw").await.unwrap(), "fresh-token");
    }

    /// The fixed defect: "no room" had TWO meanings merged into a single
    /// `None`, and the caller destroyed the account in both cases. Yet the
    /// account is created at claim time and it is the inviter's client that
    /// issues the Matrix invitation (§7): an account not yet invited appears
    /// nowhere, exactly like an account stuck mid-flow, except that the
    /// latter has LEFT a room.
    ///
    /// The case that truly separates the two is `"leave": {}`: present but
    /// empty, which is what a fresh account returns. Testing the mere presence
    /// of the key would condemn every healthy account.
    #[tokio::test]
    async fn the_sync_distinguishes_the_room_the_departure_and_the_never_invited() {
        let cases: [(&'static str, PendingInviteRoom); 5] = [
            (
                r#"{"rooms":{"invite":{"!a:h":{}}}}"#,
                PendingInviteRoom::Found("!a:h".into()),
            ),
            // Resumption after a successful join: the room has left `invite`.
            (
                r#"{"rooms":{"join":{"!b:h":{}}}}"#,
                PendingInviteRoom::Found("!b:h".into()),
            ),
            (
                r#"{"rooms":{"leave":{"!c:h":{}}}}"#,
                PendingInviteRoom::Left,
            ),
            (
                r#"{"rooms":{"invite":{},"join":{},"leave":{}}}"#,
                PendingInviteRoom::NeverInvited,
            ),
            (r#"{"rooms":{}}"#, PendingInviteRoom::NeverInvited),
        ];
        for (body, expected) in cases {
            let mx = MatrixClient::new(fake_server(body).await, String::new());
            assert_eq!(
                mx.pending_invite_room("token").await.unwrap(),
                expected,
                "sync misinterpreted: {body}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // WHO MAY INVITE INTO A ROOM, read from the room's own state.
    //
    // Every fixture below is the SHAPE PRODUCTION SERVES, not an invented one:
    // the two power-levels events are copied verbatim from the live read of
    // 14 August 2026 against messagr.eu, and the create events carry the
    // `{"room_version":"12"}` that same read returned.
    // -----------------------------------------------------------------------

    /// The `m.room.power_levels` of a room born AFTER decision B, verbatim
    /// from the live read of 14 August 2026.
    fn power_levels_after_decision_b() -> Value {
        json!({
            "type": "m.room.power_levels",
            "state_key": "",
            "sender": "@maria:h",
            "content": {
                "events": {
                    "m.poll.response": 0,
                    "m.room.encryption": 100,
                    "m.room.history_visibility": 100,
                    "m.room.power_levels": 100,
                    "m.room.server_acl": 100,
                    "m.room.tombstone": 150,
                    "org.matrix.msc3381.poll.response": 0
                },
                "invite": 50,
                "users": {}
            }
        })
    }

    /// The `m.room.power_levels` of the DEMONSTRATION room, verbatim from the
    /// same read. It differs from the one above by exactly one key: it has no
    /// `invite` at all.
    fn power_levels_of_the_demonstration_room() -> Value {
        json!({
            "type": "m.room.power_levels",
            "state_key": "",
            "sender": "@maria:h",
            "content": {
                "events": {
                    "m.poll.response": 0,
                    "m.room.encryption": 100,
                    "m.room.history_visibility": 100,
                    "m.room.power_levels": 100,
                    "m.room.server_acl": 100,
                    "m.room.tombstone": 150,
                    "org.matrix.msc3381.poll.response": 0
                },
                "users": {}
            }
        })
    }

    fn create_event(sender: &str, room_version: &str) -> Value {
        json!({
            "type": "m.room.create",
            "state_key": "",
            "sender": sender,
            "content": {"room_version": room_version}
        })
    }

    /// **THE ROOM THIS LOT GIVES BIRTH TO: its creator may invite, and the
    /// entrant nobody promoted may not.**
    ///
    /// The trap this test exists to catch is the creator's half. Production
    /// creates at room version 12, where the creator is privileged IMPLICITLY
    /// and MUST NOT appear in `users` — the live read returned `users: {}`
    /// from a room its own account had just created. A gate that read
    /// `users[inviter]` and defaulted to `users_default` would put the room's
    /// own creator at 0 against an `invite` of 50 and refuse her the first
    /// invitation into the room she just made, which is the whole gesture this
    /// lot exists to deliver.
    #[test]
    fn a_room_born_of_this_lot_grants_its_creator_and_refuses_the_unpromoted() {
        let state = [
            create_event("@maria:h", "12"),
            power_levels_after_decision_b(),
        ];

        let maria = invite_rights(&state, "@maria:h").expect("the creator's rights must be read");
        assert_eq!(maria.required, 50);
        assert_eq!(maria.held, HeldPower::Creator);
        assert!(
            maria.permits_invitation(),
            "the creator of a version-12 room is absent from `users` BY RULE: reading \
             her level out of that map would refuse her her own room"
        );

        let entrant = invite_rights(&state, "@entrant:h").expect("the entrant's rights too");
        assert_eq!(entrant.held, HeldPower::Level(0));
        assert!(
            !entrant.permits_invitation(),
            "an account nobody promoted sits at 0 against an invite level of 50"
        );
    }

    /// **THE ROOM BORN BEFORE THIS LOT, AND ITS INVITER KEEPS THE RIGHT.**
    ///
    /// The demonstration room carries NO `invite` key, measured on production
    /// on 14 August 2026, and the specification reads that absence as 0. Every
    /// joined member may invite there, and nothing rewrites the room. A gate
    /// comparing against a hardcoded 50 would refuse the demonstration itself
    /// — which is why the required level is read from the room and from
    /// nowhere else.
    #[test]
    fn a_room_born_before_this_lot_lets_any_member_invite() {
        let state = [
            create_event("@maria:h", "12"),
            power_levels_of_the_demonstration_room(),
        ];

        let rights = invite_rights(&state, "@anyone:h").expect("readable state");
        assert_eq!(
            rights.required, 0,
            "no `invite` key means the specification's default, 0 — not 50"
        );
        assert_eq!(rights.held, HeldPower::Level(0));
        assert!(
            rights.permits_invitation(),
            "in a room where inviting costs 0, a member at 0 may invite: refusing here \
             would break the demonstration room, which carries no `invite` key at all"
        );
    }

    /// The creator's privilege is a property of the ROOM VERSION, not a
    /// blanket pass. Below version 12 the server writes the creator into
    /// `users`, so the map is the truth — and a creator demoted there must be
    /// refused like anyone else, or the gate would be a hole named "creator".
    #[test]
    fn below_version_twelve_the_users_map_is_the_only_truth() {
        let demoted = [
            create_event("@maria:h", "10"),
            json!({
                "type": "m.room.power_levels",
                "state_key": "",
                "sender": "@maria:h",
                "content": {"invite": 50, "users": {"@maria:h": 0, "@other:h": 100}}
            }),
        ];
        let maria = invite_rights(&demoted, "@maria:h").expect("readable state");
        assert_eq!(
            maria.held,
            HeldPower::Level(0),
            "in a version-10 room the creator is an ordinary entry of `users`"
        );
        assert!(!maria.permits_invitation());

        let other = invite_rights(&demoted, "@other:h").expect("readable state");
        assert_eq!(other.held, HeldPower::Level(100));
        assert!(other.permits_invitation());
    }

    /// `additional_creators` names creators too, and the gate must know it —
    /// they are as absent from `users` as the sender is.
    #[test]
    fn additional_creators_are_creators() {
        let state = [
            json!({
                "type": "m.room.create",
                "state_key": "",
                "sender": "@maria:h",
                "content": {"room_version": "12", "additional_creators": ["@second:h"]}
            }),
            power_levels_after_decision_b(),
        ];
        assert_eq!(
            invite_rights(&state, "@second:h").unwrap().held,
            HeldPower::Creator
        );
        assert_eq!(
            invite_rights(&state, "@third:h").unwrap().held,
            HeldPower::Level(0)
        );
    }

    /// `users_default` is consulted when the account has no entry of its own,
    /// which is what makes a room that raised its floor readable.
    #[test]
    fn the_default_level_applies_to_an_account_the_map_does_not_name() {
        let state = [
            create_event("@maria:h", "10"),
            json!({
                "type": "m.room.power_levels",
                "state_key": "",
                "sender": "@maria:h",
                "content": {"invite": 50, "users_default": 50, "users": {}}
            }),
        ];
        let rights = invite_rights(&state, "@anyone:h").unwrap();
        assert_eq!(rights.held, HeldPower::Level(50));
        assert!(rights.permits_invitation());
    }

    /// **WHAT CANNOT BE READ IS NEVER READ AS A PERMISSION.**
    ///
    /// The campaign has just measured what the opposite costs: `revoke_
    /// invitation` turned a 404 into a success and left thirty-two live
    /// accounts the database believed dead. Every malformed shape below must
    /// come back as an error, and NOT ONE of them may produce an
    /// `InviteRights` that permits.
    #[test]
    fn an_unreadable_state_is_never_a_permission() {
        let malformed: [(&str, Vec<Value>); 5] = [
            (
                "no m.room.create at all: this is not a room's state",
                vec![power_levels_after_decision_b()],
            ),
            (
                "an `invite` level that is not a number",
                vec![
                    create_event("@maria:h", "12"),
                    json!({"type":"m.room.power_levels","state_key":"","sender":"@m:h",
                           "content":{"invite":"fifty","users":{}}}),
                ],
            ),
            (
                "a level in `users` that is not a number",
                vec![
                    create_event("@maria:h", "10"),
                    json!({"type":"m.room.power_levels","state_key":"","sender":"@m:h",
                           "content":{"invite":0,"users":{"@anyone:h":"high"}}}),
                ],
            ),
            (
                "a `users_default` that is not a number",
                vec![
                    create_event("@maria:h", "10"),
                    json!({"type":"m.room.power_levels","state_key":"","sender":"@m:h",
                           "content":{"invite":0,"users_default":[],"users":{}}}),
                ],
            ),
            (
                "a create event with no sender: nobody can be named creator",
                vec![
                    json!({"type":"m.room.create","state_key":"","content":{"room_version":"12"}}),
                    power_levels_after_decision_b(),
                ],
            ),
        ];
        for (what, state) in malformed {
            let read = invite_rights(&state, "@anyone:h");
            assert!(
                matches!(read, Err(InviteRightsError::Unreadable(_))),
                "{what}: must be an explicit refusal to conclude, got {read:?}"
            );
        }
    }

    /// A room with no `m.room.power_levels` at all is the specification's
    /// defaults: inviting costs 0. It is a readable room, not a malformed one
    /// — and the create event is what says so.
    #[test]
    fn a_room_without_power_levels_falls_back_to_the_specification() {
        let state = [create_event("@maria:h", "12")];
        let rights = invite_rights(&state, "@anyone:h").expect("a room with only a create event");
        assert_eq!(rights.required, 0);
        assert!(rights.permits_invitation());
    }

    /// The read is a GET on the room's own state, carrying the INVITER'S
    /// bearer — the service holds no room-reading right of its own, and the
    /// whole gate rests on borrowing the caller's.
    #[tokio::test]
    async fn the_state_read_names_the_room_and_carries_the_callers_bearer() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
        let recorder = seen.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let body = serde_json::to_string(&json!([
            create_event("@maria:h", "12"),
            power_levels_after_decision_b()
        ]))
        .unwrap();
        tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let recorder = recorder.clone();
                let body = body.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = request.lines().next().unwrap_or("").to_string();
                    let auth = request
                        .lines()
                        .find(|l| l.to_ascii_lowercase().starts_with("authorization:"))
                        .unwrap_or("")
                        .to_string();
                    recorder.lock().unwrap().push((line, auth));
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let mx = MatrixClient::new(base, String::new());
        let rights = mx
            .invite_rights_in_room("the-inviters-token", "!room:h", "@maria:h")
            .await
            .expect("the state must be readable");
        assert_eq!(rights.held, HeldPower::Creator);

        let seen = seen.lock().unwrap();
        let (line, auth) = seen
            .first()
            .expect("exactly one request must have gone out");
        assert!(
            line.starts_with("GET /_matrix/client/v3/rooms/!room:h/state "),
            "the room must be named in the path of a READ: {line}"
        );
        assert_eq!(
            auth.trim(),
            "authorization: Bearer the-inviters-token",
            "the caller's own token is what the room is read with"
        );
    }

    /// A room this account cannot see is a REFUSAL, and it is told apart from
    /// a stammering homeserver: 404 is what continuwuity answered on 14 August
    /// 2026 to a state read on a room the account had left ("You don't have
    /// permission to view the room state"), and 403 is what the specification
    /// prescribes. Neither may become a permission, and neither may be
    /// reported as an outage the operator would then go chasing.
    #[tokio::test]
    async fn a_room_the_caller_cannot_see_is_a_refusal_of_its_own() {
        for status in ["404 Not Found", "403 Forbidden"] {
            let mx = MatrixClient::new(
                fake_server_with_status(
                    status,
                    r#"{"errcode":"M_NOT_FOUND","error":"You don't have permission to view the room state."}"#,
                )
                .await,
                String::new(),
            );
            let read = mx
                .invite_rights_in_room("token", "!room:h", "@maria:h")
                .await;
            assert!(
                matches!(read, Err(InviteRightsError::NotVisible)),
                "{status} must be the room's own refusal, got {read:?}"
            );
        }
    }

    /// A homeserver that is unwell must never look like a decision. The body
    /// served here is a PERFECTLY READABLE state that would permit: only the
    /// status separates it from a success, and it alone must decide.
    #[tokio::test]
    async fn a_stammering_homeserver_is_neither_a_permission_nor_a_refusal_of_rights() {
        let mx = MatrixClient::new(
            fake_server_with_status(
                "502 Bad Gateway",
                r#"[{"type":"m.room.create","state_key":"","sender":"@maria:h","content":{"room_version":"12"}}]"#,
            )
            .await,
            String::new(),
        );
        let read = mx
            .invite_rights_in_room("token", "!room:h", "@maria:h")
            .await;
        assert!(
            matches!(read, Err(InviteRightsError::Unreachable)),
            "a 502 says the stack is unwell, not that the room refuses: {read:?}"
        );
    }

    /// A 2xx whose body is not a state array is not a state: it must not be
    /// read as an empty room, which would be a room with no power levels —
    /// hence a permission.
    #[tokio::test]
    async fn a_two_hundred_that_is_not_a_state_is_unreadable_and_not_an_empty_room() {
        let mx = MatrixClient::new(fake_server(r#"{"rooms":{"join":{}}}"#).await, String::new());
        let read = mx
            .invite_rights_in_room("token", "!room:h", "@maria:h")
            .await;
        assert!(
            matches!(read, Err(InviteRightsError::Unreadable(_))),
            "an object where an array was promised proves nothing about the room: {read:?}"
        );
    }

    /// Inseparable control of the previous one: a FAILED sync must remain an
    /// `Err`. The body served here is a perfectly decodable non-empty
    /// `rooms.leave`: without the status check, this 500 would become a
    /// `Left`, and a downed homeserver would have healthy accounts destroyed.
    /// It is indeed the status, and it alone, that this test exercises.
    #[tokio::test]
    async fn a_failed_sync_stays_an_error() {
        let mx = MatrixClient::new(
            fake_server_with_status(
                "500 Internal Server Error",
                r#"{"rooms":{"leave":{"!c:h":{}}}}"#,
            )
            .await,
            String::new(),
        );
        assert!(
            mx.pending_invite_room("token").await.is_err(),
            "a non-2xx sync must never pass for an absence of room"
        );
    }
}
