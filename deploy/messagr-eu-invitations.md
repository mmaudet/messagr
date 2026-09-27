# messagr.eu — the invitation service in production

What answers behind `https://messagr.eu/_messagr/`, where it is defined, how it
is updated and how it is rolled back. Written on 13 September 2026, the day
production stopped building the prototype (#289).

## What runs

- **The container.** `messagr-invitations-eu` on hermes, service `invitations`
  of `/opt/messagr-eu/docker-compose.yml`, image `messagr-invitations-eu:local`,
  published on `127.0.0.1:8095`.
- **The route.** nginx hands `/_messagr/` to it and strips the prefix:
  `https://messagr.eu/_messagr/health` reaches `/health`, and the homeserver's
  pushers post to `https://messagr.eu/_messagr/_matrix/push/v1/notify`.
- **The state.** One SQLite file, `/opt/messagr-eu/invitations-data/invitations.db`,
  bind-mounted at `/var/lib/messagr`. It survives a new container.
- **The configuration.** `/opt/messagr-eu/invitations.service.env`, which
  exists only on the host and is never printed. Its names, not its values:
  - required, or the service refuses to start: `DATABASE_URL`, `HOMESERVER_URL`,
    `REGISTRATION_TOKEN`, `ENCRYPTION_KEY`;
  - optional: `EDGE_RETENTION_DAYS`, `BIND_ADDR`,
    `MAX_RESERVED_ACCOUNTS_PER_INVITER`, `PUSH_GATEWAY_URL`, `MASKING_KEYS`;
  - optional, all four or none: `OVH_APPLICATION_KEY`,
    `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, with
    `SMS_SENDER` beside them;
  - for discovery, `ALERT_SMS_TO` and `REFERENCE_KEY`, without which it stays
    off;
  - optional: `DISCOVERY_COUNTRIES`, `SMS_CEILING_PER_COUNTRY_PER_DAY`,
    `SMS_BUDGET_PER_MONTH`, `SMS_CREDITS_ALERT_BELOW`.
- **The networks.** `default`, and `sygnal` (the external network
  `messagr-sygnal_default`), because the push gateway forwards to
  `http://messagr-sygnal:5000/_matrix/push/v1/notify`.

The bench, `messagr-invitations-fork` in `/opt/messagr-fork`, has the same shape
and builds from its own copy of `services/invitations`, which lags this
repository until somebody copies it again.

## The masking keys of address-book discovery

`MASKING_KEYS` holds the keys that mask phone numbers for address-book
discovery (#392, ADR 0014): `<key number>:<base64 seed>`, several separated by
commas, `1:…,2:…`. The highest key number is the key new masks are made with;
two serve together while one replaces the other. A seed is 32 random bytes:

    openssl rand -base64 32

- **Absent, discovery stays off.** The service starts, serves invitations as
  before, and says so right after the line that names its version:
  `MASKING_KEYS absent: address-book discovery stays off`. Every deployment
  before discovery ships is in this case.
- **Missing a key that masks are still made with, the service refuses to
  start.** Once a number is proven, its mask is useless without the key it
  was made with, so a key dropped or renumbered while this file is edited
  stops the start, naming the key number, until it is back or until the masks
  made with it have run out, 28 days after their proof.

### The reference key

`REFERENCE_KEY` is the key the reference of a findable account is computed
with (#451), 32 random bytes in base64, minted like a seed:

    openssl rand -base64 32

- **The reference follows the account.** Devices know a findable account by
  its reference. Computed from the account, it is the same whenever the
  account proves its number, even after the thirty days the service forgets
  its proof, so that whoever found it reads the same account; another account
  gets another. The database keeps only the key's fingerprint.
- **Kept where the other secrets of the host are kept**, nowhere else, like
  a seed: whoever holds it can relate the references of the directory to the
  accounts they know. The host's backup must not carry it.
- **Absent, discovery stays off**, like `MASKING_KEYS`; malformed, the service
  refuses to start without showing it.
- **Changed with a retirement at once, and only then** (below).
  - The start refuses a reference key that served before a masking key was
    retired at once. A service still running through a retirement proves
    nothing until it restarts with a new one.
  - The start refuses a new key given without a retirement since the previous
    one began to serve: every account whose proof is later forgotten would
    come back under a new reference, which whoever found it reads as a number
    that changed hands. Put the previous key back.

### Changing the key, once a year

No SMS is sent, and nobody stops being findable (#409, ADR 0014). With the
current key numbered `1`:

1. **Mint the new seed**, `openssl rand -base64 32`, and keep it where the
   other secrets of the host are kept, nowhere else: the host's backup must not
   carry it.
2. **Add it with the next number**, the old one kept: `1:…,2:…`. The highest
   number is the key new masks are made with.
3. **Restart** (`docker compose up -d --no-deps --no-build invitations`). The
   line after the version names two keys, the current one `#2`. The service
   notes the date `#2` is first served; a later restart keeps that date. The
   proofs in progress under `#1` are dropped at that start: their number was
   masked under `#1` alone, and they ask for another code.
4. **For 28 days, both keys serve.**
   - Every proof renewed moves onto `#2`, with the reference devices know the
     account by and the count of numbers its number had masked.
   - Devices compare under both keys, so an account that has not renewed yet is
     still found.
   - Each proven number may have 5,000 more numbers masked under `#2`, counted
     apart from its limit, for a device to compare its address book again,
     once. That extension ends when `#1` leaves `MASKING_KEYS`, and 28 days
     after `#2` was first served at the latest, even if `#1` is forgotten
     there.
5. **After those 28 days, remove `#1`** from `MASKING_KEYS` and restart. Every
   proof made under it has run out or moved by then. If a proof still lives
   under it, or one in progress, the service refuses to start and names the
   key: put it back and wait, or retire it at once, below.
6. **Destroy the old seed** wherever it was kept.

### Retiring a key at once, after a theft or a loss

The key stops serving before its masks run out, and the accounts made findable
under it stop being findable until their next proof (#409, ADR 0014).

**Not before the application reads « key changed ».** An application that
does not know that reading takes the whole discovery state of such an account
for unreadable. The application learns it with the second part of #409;
until a version that carries it is what people run, retire a key only if
discovery must stop at once.

With the key to retire numbered `N`, in `/opt/messagr-eu`:

1. **Stop the service**, `docker compose stop invitations`. Invitations wait a
   few minutes. While it runs, it goes on making proofs under `N` when `N` is
   the current key, and the start would then find them without their key.
2. **Retire `N`**:

       docker compose run --rm invitations --retire-masking-key N

   It binds no port and starts no sweeper, and it runs even when `N` is lost
   and no longer in `MASKING_KEYS`. It says first how many findable accounts
   stop being findable and how many proofs in progress are dropped, and
   whether `N` is the current key. Type the key number back to retire it; any
   other answer, or none, leaves everything as it is and exits in error.

3. **What it did**, in one transaction:
   - every proof running under `N` ended. Its account reads that the key changed
     until its next proof, thirty days at most, and that next proof passes the
     ceilings of a country and the budget as a renewal would;
   - every mask made under `N` is erased, with the proofs in progress under it
     and the counts of numbers masked, the extension's included. The proofs
     that had run out or been withdrawn under `N` go too, and with them what
     their accounts read of it;
   - the date `N` was first served is forgotten;
   - `N` is listed as retired at once by `GET /discovery/keys`, so that devices
     forget what they kept under it: the accounts it stopped get new references
     at their next proof.
4. **Edit `MASKING_KEYS`**: remove `N`, and when `N` was the current key, add
   a new seed with a higher number, as in the planned change above.
5. **Give `REFERENCE_KEY` a new key**, `openssl rand -base64 32` (#451). The
   start refuses the one that served before the retirement: the accounts it
   stopped come back under references nothing relates to the lost key.
6. **Start the service**, `docker compose up -d --no-deps --no-build
invitations`. The start no longer needs `N`.
7. **Destroy the seed of `N`**, if it still exists anywhere, and the old
   reference key.

## The SMS provider of address-book discovery

A proof sends a code by SMS to the number being proved, through OVHcloud's
European API (#397). The number leaves the service there, and only there: the
service keeps its mask, and OVHcloud sees it pass, as the consent screen says.

- `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`: an API
  application of the OVHcloud account and its consumer key, created at
  `https://eu.api.ovh.com/createToken/` with three rights on this SMS account
  and nothing else: `GET /sms/<service>` (the prepaid balance),
  `POST /sms/<service>/jobs` (sending) and `DELETE /sms/<service>/outgoing/*`
  (erasing from the history). **Never a right to read the history**
  (`GET /sms/<service>/outgoing`): keys that leaked could then read the
  numbers and the codes sent, which the erasure is there to shorten.
- `OVH_SMS_SERVICE`: the SMS account, `sms-xx00000-1`.
- `SMS_SENDER`: the sender the SMS carries, `Messagr` unless said otherwise.
  It must be a sender the SMS account has had validated.

What the service does with them:

- **None of the four, discovery stays off**, like without the masking keys:
  discovery serves with both or not at all, and the line after the version
  says which one is missing.
- **Some of them, the service refuses to start**, naming the first one
  missing: half an account is a mistake, not a choice.
- **Only OVHcloud's European API.** `OVH_API_URL` is refused unless it is
  `https://eu.api.ovh.com/1.0`. The bench alone may point it at its fake
  provider, with `SMS_PROVIDER_FOR_TESTS=1`, which never goes in this file,
  and even then only at an address that stays on its host: the loopback, or
  a container's name on a Docker network.
- **The secret and the consumer key are never printed.** The log names the
  endpoint, the SMS account and the sender, nothing else.

## The ceilings on the SMS that prove numbers

Every proof costs an SMS, and the service bounds what they cost (#399):

- **An account**: three codes a day and ten in thirty days, renewals
  included. Written in the service, not set. Beyond them, the request is
  refused and the application says when to ask again.
- **A country**: `SMS_CEILING_PER_COUNTRY_PER_DAY` codes in a calendar day
  (50 unless set).
- **The whole service**: `SMS_BUDGET_PER_MONTH` codes over thirty calendar
  days (500 unless set).

Beyond a country's ceiling or the budget, **new proofs wait and renewals go
through**. A renewal is the proof of a number an account proves now, under
any masking key in service; renewals still count toward the budget.
An unusable value falls back to its default, never to no ceiling; `0` holds
every new proof back. A code is counted in the same step that checks the
ceilings, so requests sent together cannot get past them, and uncounted if
its SMS does not leave.

- **The budget counts every SMS, renewals included.** Every findable account
  renews about once in 28 days, so set `SMS_BUDGET_PER_MONTH` above the number
  of findable accounts, with room for the new proofs of a month. Otherwise
  renewals alone hold every new proof back.
- **The operator is told by SMS**, through the same OVHcloud account, at
  `ALERT_SMS_TO` (international form): once a day for each ceiling reached,
  and once a day while the prepaid balance is under
  `SMS_CREDITS_ALERT_BELOW` credits (100 unless set), which the hourly sweep
  reads. **Discovery stays off without `ALERT_SMS_TO`**, and a malformed one
  stops the start.
- **The credits are prepaid, with automatic re-crediting off**, so that a
  swollen traffic can cost nothing beyond them. OVHcloud bills credits, not
  SMS, and a number abroad can cost more than one: the balance alert is what
  says when to buy more, before proofs and renewals stop.
- **The service keeps counters, never the number, and no link between an
  account and a country**: the codes an account asked for, by time, without
  a country; the SMS sent to each country, by calendar day, without an
  account. The sweep forgets both after thirty days.
- **Every SMS is erased from OVHcloud's history** once it can no longer be
  of use: a proof's ten minutes after it left, an alert's a day after. The
  hourly sweep deletes it by the id OVHcloud gave it. A failure is tried
  again at each pass and said in the log after a day; an id the history does
  not know is tried for a day and then given up, with a warning. **The day
  Q38 of #38 promises is kept only while OVHcloud answers.**
- **What the erasure really does at OVHcloud, observed on 26 September
  2026** on the real account, with a test SMS to the operator's own number:
  - the id `POST /jobs` answers is the history's own: `DELETE
/sms/<service>/outgoing/<id>` answered 200 once the SMS had arrived, then
    404 (« Outgoing sms not found ») when asked again;
  - once erased, the SMS no longer appears in the history of sent SMS in the
    control panel either;
  - it stays, as it must, in the messages of the telephone that received it:
    nothing a provider does reaches a delivered SMS. The policy (#412) says
    that the code stays on the person's own telephone;
  - what OVHcloud keeps as an operator (traffic data) is seen neither by the
    API nor in the control panel: the policy says it too (#392).

  The test left from OVHcloud's short number: the sender « Messagr » was
  still pending validation, and until it is validated OVHcloud refuses every
  SMS sent with it (« Sms sender Messagr is pending validation »), proofs
  included.

## The countries open to discovery

`DISCOVERY_COUNTRIES` lists them, `<ISO code>:<calling code>:<provider>`,
separated by commas: `FR:33:ovhcloud,DE:49:ovhcloud`. Absent, the launch list
written in `services/invitations/src/countries.rs` serves: the European Union,
the European Economic Area, Switzerland and the United Kingdom, all through
OVHcloud, less Italy, Denmark, Finland, Norway, Romania and Sweden, which open
when the steps OVHcloud asks for them succeed.

- **A country opens after a review** (Q35 of #38): no sanctions, a sender
  registered where the country asks for one, numbers that do not change hands
  within 28 days, a price under a ceiling, and a message that arrives intact.
  The line comes after the review, never before.
- **The setting replaces the launch list whole**, it does not add to it: to
  open Italy, write every country, Italy included.
- **Malformed, the service refuses to start**, naming what is wrong: an entry
  that is not three fields, a code that is not two capitals, a calling code
  that is not one to three digits or is the start of another, a provider
  other than `ovhcloud`, a country twice.

## Until 13 September 2026, production built the prototype

`build.context` was `../service`, that is `/opt/service`: the source of the
prototype, frozen on 25 August 2026, with migrations 001 to 008 and the
`/discovery/*` routes. The push gateway (#102, made usable by #110) exists only
in `services/invitations`. Every notification messagr.eu's homeserver sent was
therefore answered `404 unknown route`: 29 of them during the rehearsal of #91,
and no application that was closed ever rang. The bench had moved to a copy of
this repository on 6 September and delivered its notifications, which is what
hid the difference. The step of #108 that read "Production follows, and
/opt/service is retired" had not been taken.

On 13 September 2026 at 11:33 UTC the context became `./service`, a copy of
`services/invitations` at `b97978e`, and `PUSH_GATEWAY_URL` was set. Migration
009 was applied and the existing invitations were intact. A message and then a
call reached a closed application at 15:52 UTC.

## Updating it

`/opt/messagr-eu/service` is a copy, not a checkout: nothing on the host follows
this repository on its own.

1. **Copy the source of one commit into a new directory, and check it.**

       git archive <commit> services/invitations \
         | ssh hermes 'mkdir /opt/messagr-eu/service.new && tar -x --strip-components=2 -C /opt/messagr-eu/service.new'

   Compare every file's checksum with the same archive unpacked locally before
   going further.

2. **Build under a distinct tag.** The running container is untouched:

       docker build --build-arg MESSAGR_VERSION=<commit> \
         -t messagr-invitations-eu:<commit> /opt/messagr-eu/service.new

3. **Run it on a copy of the database, cut off from everything.** Copy
   `invitations.db` with SQLite's backup API, since the service writes while it
   runs. Start the new image on another port, with a copy of the environment in
   which `HOMESERVER_URL` points nowhere (`http://127.0.0.1:9`) and
   `PUSH_GATEWAY_URL` is absent: it can then neither touch an account nor send
   a notification. Expect `/health` to answer 200,
   `POST /_matrix/push/v1/notify` with `{}` to answer 422, an unknown route to
   answer `404 M_UNRECOGNIZED`, and the migrations table and the invitation
   count to be what they should. Remove the copy and its environment afterwards.

4. **Back up what would be replaced.** Tag the running image under another
   name, copy the compose file and the environment file, and take a consistent
   copy of the database, dated.

5. **Switch.** Replace `service` with `service.new`, then:

       docker tag messagr-invitations-eu:<commit> messagr-invitations-eu:local
       docker compose up -d --no-deps --no-build invitations

   in `/opt/messagr-eu`. On 13 September the service answered again 12 seconds
   later.

6. **Check production itself.** `https://messagr.eu/_messagr/health` answers
   200, `POST http://127.0.0.1:8095/_matrix/push/v1/notify` with `{}` answers
   422 and not 404, and the first log line names the version.

## Rolling back to the prototype

The prototype applies its migrations without `set_ignore_missing`, so it refuses
to start on a database that carries a migration it does not know, 009 or later.
Going back to it means restoring the database copied just before the switch,
and losing what was written since.
`/opt/messagr-eu/retour-au-prototype-20260913.sh <timestamp>` does that: it
keeps the post-switch state beside it, restores the compose file, the
environment file and the database, and retags `messagr-invitations-eu:prototype-20260825`
as `:local`.

## What proves a notification was sent

A `200` from the gateway proves nothing on its own. With `PUSH_GATEWAY_URL`
absent, or refused because it is neither `https://` nor `http://` to
`localhost`, `127.0.0.1` or `messagr-sygnal`, the service answers
`200 {"rejected":[]}` and forwards nothing. The proof is in sygnal's log,
`docker logs messagr-sygnal`: a `Sending (attempt 0)` line for the notification,
and no error after it.
