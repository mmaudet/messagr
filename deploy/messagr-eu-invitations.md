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
    `MAX_RESERVED_ACCOUNTS_PER_INVITER`, `PUSH_GATEWAY_URL`;
  - the SMS provider, all four or none: `OVH_APPLICATION_KEY`,
    `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE`, with
    `SMS_SENDER` or `SMS_SHORT_NUMBER` beside them, never both;
  - the operator's number, `ALERT_SMS_TO`. With the provider, the operator's
    alerts go by SMS, whether discovery is on or off; without either, they
    are only written in the log;
  - for discovery, `MASKING_KEYS` and `REFERENCE_KEY`, beside the provider
    and `ALERT_SMS_TO`: without any one of them, or by the short number, it
    stays off;
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
  before discovery ships is in this case. By OVHcloud's short number, that
  line names the short number instead (« The SMS provider »).
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
- **Lost, or shown where it should not be**: retire at once every masking key
  in service, below, and give `REFERENCE_KEY` a new key. That is the only way
  it changes, and the accounts made findable come back under new references,
  which nothing relates to the old key.

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

## The SMS provider

The service sends two kinds of SMS through OVHcloud's European API: the code
that proves a number, while discovery is on (#397), and the operator's
alerts, whether discovery is on or off (#464, below). A number being proved
leaves the service there, and only there: the service keeps its mask, and
OVHcloud sees it pass, as the consent screen says.

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
- `SMS_SHORT_NUMBER=1`: the SMS carry no sender and go by OVHcloud's short
  number instead, which needs no validation (#508, below). Never beside
  `SMS_SENDER`.

What the service does with them:

- **None of the four, no SMS leaves.** Discovery stays off, like without the
  masking keys, and the operator's alerts are only written in the log. The
  two lines after the version say so.
- **Some of them, the service refuses to start**, naming the first one
  missing, whether discovery is meant to serve or not: half an account is a
  mistake, not a choice.
- **`SMS_SHORT_NUMBER` and `SMS_SENDER` together, the service refuses to
  start**, naming both, whatever else is given: which one was meant is not a
  thing to guess. So does any value of `SMS_SHORT_NUMBER` but `1`, `0` and
  `true` included: a typo would leave the SMS under a sender OVHcloud refuses.
  Blank is absent.
- **By the short number, discovery stays off**, even with `MASKING_KEYS`,
  `REFERENCE_KEY` and `ALERT_SMS_TO`: a proof goes to a number of any open
  country, and only French numbers are known to receive the short number. The
  line after the version says so, before anything else discovery lacks:
  `the SMS go by OVHcloud's short number (SMS_SHORT_NUMBER), which only French numbers are known to receive: address-book discovery stays off`.
- **Only OVHcloud's European API.** `OVH_API_URL` is refused unless it is
  `https://eu.api.ovh.com/1.0`. The bench alone may point it at its fake
  provider, with `SMS_PROVIDER_FOR_TESTS=1`, which never goes in this file,
  and even then only at an address that stays on its host: the loopback, or
  a container's name on a Docker network.
- **The secret and the consumer key are never printed.** The log names the
  endpoint, the SMS account and the sender, or `sender_for_response: true`
  by the short number, nothing else.

### Until a sender is validated: the short number

On 30 September 2026, OVHcloud refused the sender « Messagr », declared for
the SMS account on 26 September: `POST /sms/<service>/jobs` answered 403,
`Sms sender Messagr is refused`. OVHcloud refuses every SMS sent under a
sender it has not validated, so no alert of the operator's could leave under
it. The same day, a test SMS sent with `"senderForResponse": true` and no
`sender` reached the operator's number.

So until a sender is validated, production gives `SMS_SHORT_NUMBER=1` and no
`SMS_SENDER`. The body OVHcloud receives then carries
`"senderForResponse": true` and no `sender`, and nothing else in it changes.
The line after discovery's says so, and never the number:

    the operator's alerts go by SMS from OVHcloud's short number, through Ovhcloud { base_url: "https://eu.api.ovh.com/1.0", service_name: "sms-xx00000-1", sender_for_response: true }

**Back to a named sender, once OVHcloud has validated one**: a change of the
environment and a restart, no new version. In `/opt/messagr-eu`:

1. **Edit `invitations.service.env`**: remove `SMS_SHORT_NUMBER`, and give
   `SMS_SENDER` the sender OVHcloud validated, or leave it absent for
   `Messagr`. Both at once, the service refuses to start and names them.
2. **Restart** (`docker compose up -d --no-deps --no-build invitations`). The
   line after discovery's names the sender again, `sender: "Messagr"`, and the
   alerts leave under it. Discovery can then serve, once it is given what it
   needs.

## The operator's alerts

The service tells the operator (#399, #464) in its log, with a warning that
starts `told to the operator:`, and by SMS at `ALERT_SMS_TO`, in
international form, when the provider is given too. Neither needs
discovery: production is to be given both without `MASKING_KEYS`, so that
its alerts go by SMS while discovery stays off (#462), and by OVHcloud's short
number until a sender is validated (#508, « The SMS provider »).

- **Without the provider or `ALERT_SMS_TO`, the log alone.** The service
  starts, and the line after discovery's says what is missing, such as
  `ALERT_SMS_TO absent: the operator's alerts are only written in the log`.
  With both, it names the provider, and says when the SMS go by the short
  number, never the number. A malformed number stops the start.
- **What the operator can be told is a closed list**, each alert written by
  the service from figures alone, so **no SMS names an account or carries
  anything that was said**:
  - **once a day**: a country's ceiling or the budget reached, and the
    prepaid balance under `SMS_CREDITS_ALERT_BELOW` (below). Such an alert
    counts as told for the day once its SMS is asked of OVHcloud, even if
    OVHcloud refuses it;
  - **at each call**: reports received, by their report numbers and
    reasons, the urgent ones first, and the number of blocks since the
    previous count. The service sets no limit of its own: one SMS per
    report (#468) until they are grouped every quarter of an hour (#478),
    and one a day that counts the blocks (#469).
- **The blocks are counted once a day by the hourly sweep**, at its first
  pass between 07:00 and 19:00 UTC, so that the operator is not woken: the
  blocks recorded since the blocks last told, in one SMS that names no
  account, and none when there were none. What was told is kept in the
  database (`blocks_count`) and moves only once the SMS has left: a refused
  SMS, or a stop between the count and its SMS, leaves its blocks to the next
  day's count, and a restart counts no block twice and misses none. Without
  the provider or `ALERT_SMS_TO`, the count written in the log is told, and
  the next day's does not repeat it. Blocks recorded before migration 021
  carry no date and are never counted.
- **The prepaid balance is read by the hourly sweep whenever the alerts go
  by SMS**, discovery on or off: they spend the same credits as the proofs.
  A balance that cannot be read is said in one line of the log per sweep,
  naming the SMS account, and fails nothing else.
- **Each alert is erased from OVHcloud's history** a day after it left, by
  the short number as under a sender. **None leaves under a sender OVHcloud
  has not validated**: the log says `the alert could not be sent`. Until one
  is, `SMS_SHORT_NUMBER=1` sends them by the short number (« The SMS
  provider »).

## Reports: acting within twenty-four hours

What the operator does with a report (#473, ADR 0015): read it, and when it
shows what the terms forbid, take the reported messages down and suspend
their author within twenty-four hours; then decide within thirty days. The
service keeps each report sealed for the operator key and cannot open it; the
operator opens it on their own Mac, where the key's private half lives, never
on the host.

Three tools, and where each runs:

- **the service's modes, on the host**, in `/opt/messagr-eu`, as
  `docker compose run --rm invitations <flag>`. Like the other modes of this
  guide, they bind no port and start no sweeper, and run beside the live
  service. Those that write say what they will write and wait for the report
  number, or the account, typed back: any other answer, or none, writes
  nothing and exits in error;
- **`scripts/admin-messagr.sh`, on the Mac.** The homeserver is Continuwuity,
  not Synapse: no `/_synapse/admin`, and its administration goes through
  commands posted in `#admins:messagr.eu`. The script posts them as the
  operator account, whose token it reads from
  `~/.messagr-exploitation/messagr-eu.json`, and prints the homeserver's
  answer. Each gesture waits for its target typed back;
- **`scripts/ouvrir-un-signalement.mjs`, on the Mac**, which opens a sealed
  report with `~/.messagr-exploitation/cle-de-l-exploitant.json`.

### 1. The SMS

Each report sends an SMS to `ALERT_SMS_TO` with its report number and its
reason, the urgent ones first (a child in danger, a threat to a life), and
nothing else: no account, nothing that was said.
`Messagr : 1 signalement reçu : K7QM-4ZT2 (menace).` Without the provider or
the number, the same line is in the log, after `told to the operator:`.

### 2. What awaits a decision, on the host

    docker compose run --rm invitations --reports

lists the reports awaiting a decision, the urgent ones first, each by number,
instant of reception and reason, with how long it has waited; then the
decided reports held for the authorities. **It never shows the reporting
account.** `--reports K7QM-4ZT2` shows one report, with its reporting account,
its decision and when what it keeps is erased: what the operator reads to
answer whoever writes to `conformite@messagr.eu` with that number. A report
with no decision stays listed, however old: nothing of it is erased until it
has one.

### 3. Open it, on the Mac

    ssh hermes 'cd /opt/messagr-eu && docker compose run --rm -T invitations --export-report K7QM-4ZT2' \
      | node scripts/ouvrir-un-signalement.mjs

The export writes the sealed report as the opening tool reads it,
`{ "reason", "reporter", "sealed" }`, and nothing else on its standard output;
`-T` keeps a terminal from mixing anything in. **Piped straight into the
tool, it is written on neither machine: never save it to a file**, and delete
a copy saved by mistake. The tool refuses a report whose reason or reporting
account is no longer what the device sealed. It shows the reporting account,
the reported author, the conversation, and each message with its time and its
event ID, which the takedown names; a photo or a document, the address of its
encrypted copy on the homeserver (#471), and a photo that has a thumbnail,
the address of the thumbnail's own copy, which is what the conversation
shows (#496). To see one, run the same pipe with `--ouvrir <n>`, the number
the tool gives the message, or with `--ouvrir-vignette <n>` for the thumbnail
of its photo: it downloads the copy with the operator account, shows it, and
erases what it wrote once Enter is pressed on the terminal
(`scripts/ouvrir-un-signalement.mjs` says how).

### 4. Within twenty-four hours, when it shows what the terms forbid

From the Mac, in this order:

1. **Take each reported message down**, one at a time:

       scripts/admin-messagr.sh retirer '$<event ID>'

   (`!admin users redact-event`). An event ID starts with `$`: between single
   quotes, or the shell reads it as a variable, and the script refuses what is
   left of it. The homeserver redacts as the author, **who must still be a
   member of the conversation: every takedown comes before a termination.**
   Read the answer: it says whether the event was redacted, and why not. The
   message is gone for everyone, and the application shows « Retiré par
   l'exploitant » in its place (#476), from the fixed reason Continuwuity
   writes.

2. **Erase the encrypted copy of a reported photo or document**, and that
   of a photo's thumbnail when the tool shows one, each with the address the
   opening tool shows:

       scripts/admin-messagr.sh effacer-media mxc://messagr.eu/<media ID>

   (`!admin media delete --mxc`).

3. **Suspend the author:**

       scripts/admin-messagr.sh suspendre @<author>:messagr.eu

   (`!admin users lock`). The account can do nothing but log out, and keeps
   its devices, its keys and its conversations; its holder reads that the
   operator suspended it, and how to contest (#477). **Never through the HTTP
   route that locks an account**: on the version in production, that route
   applies the homeserver's `suspend` instead, under which the account still
   reads its conversations.

### 5. The decision, within thirty days, on the host

    docker compose run --rm invitations --decide-report K7QM-4ZT2 <decision> "<motivation>"

A decision finds the report unfounded, lifts the suspension, or confirms it
by a termination:

- `unfounded` (« sans suite »): nothing in the report is forbidden. Nothing
  was taken down, or the operator restores what it can: a suspension is
  lifted from the Mac, `scripts/admin-messagr.sh lever @<author>:messagr.eu`
  (`!admin users unlock`), and a message taken down does not come back.
- `lifted` (« levée »): the takedown stands, and the suspension is lifted, as
  above.
- `confirmed` (« confirmée »): the suspension is confirmed, and the account is
  terminated (step 6).

**The motivation is the reasoned decision, never a quotation**: what the
report shows, and which rule of the terms it breaks or does not. It copies
nothing that was said and names no account, no conversation and no message;
the mode refuses a motivation holding a Matrix identifier. It is one line, in
quotes, and it is kept a year, when what was said is long erased. A decision
keeps its day, never its hour. **The erasures count from the first
decision**: a second decision on the same report, after a contestation,
replaces the first one's outcome and motivation, and moves neither erasure.

### 6. A termination

Once the decision is `confirmed`, and **every reported message is taken
down** (step 4):

1. **On the Mac**: `scripts/admin-messagr.sh fermer @<author>:messagr.eu`
   (`!admin users deactivate`). The account leaves every conversation and never
   comes back, and the homeserver never releases its name. It redacts
   nothing: that is why the takedowns come first.
2. **On the host**:

       docker compose run --rm invitations --record-termination @<author>:messagr.eu

   The account is recorded among the account deletions (#385), so that the
   purge within thirty days applies to it; its invitations still open
   expire, and its number leaves discovery. **The purge of an account's data
   is still done by hand (#423)**, from that list, as for any deletion. The
   row is dated by the day, as every account deletion is, one its holder
   announces included, and names no report; the decision names no account.
   What the dates still show is said below.

A device that had kept the suspension then reads that the operator closed
the account (#477).

### 7. Held for the authorities

    docker compose run --rm invitations --hold-report K7QM-4ZT2
    docker compose run --rm invitations --release-report K7QM-4ZT2

A report handed to the authorities is held: neither its sealed report nor
its record is erased, whatever its decision, until it is released. Released,
the erasures resume, and the next hourly sweep erases whatever is already
due.

### What the service keeps of a report, and when it goes

- From the report (#468): its number, the reporting account, the reason, the
  sealed report, the instant of reception, and the idempotency key of its
  sending. Never the reported account, the conversation or what was said,
  which only the sealed report holds.
- From the operator (#473): the decision, its motivation and the day of the
  first decision, and the day the report was held.
- **The sealed report and its idempotency key go 181 days after the first
  decision**, which never exceeds six calendar months, **and the record 365
  days after**, which never exceeds twelve; neither while the report is held,
  and neither while it has no decision. The hourly sweep does both
  (`moderation::sweep`), and its log line counts them:
  `reports: … sealed reports erased, … records erased`.
- **What a copy of the database still shows** (ADR 0015, amended on 30
  September 2026, and the policy says the same): a confirmed report and an
  account deletion recorded the same day can be related by their dates, when
  deletions are few; and a reporting account that also blocked the account it
  reported is related to it by that block, which the service keeps with its
  date (#469). Every account deletion is dated by the day, a termination as a
  deletion its holder announced (the owner's decision of 30 September 2026):
  the row does not say which it is.
- **The dated copies of the database** that an update leaves (step 4 of
  "Updating it") hold the reports as they were, sealed reports included, and
  no sweep reaches them: delete them once the update is behind, as #416 says
  of the invitation graph.

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
  reads whenever the alerts go by SMS, discovery on or off (above).
  **Discovery stays off without `ALERT_SMS_TO`**, and a malformed one stops
  the start.
- **The credits are prepaid, with automatic re-crediting off**, so that a
  swollen traffic can cost nothing beyond them. OVHcloud bills credits, not
  SMS, and a number abroad can cost more than one: the balance alert is what
  says when to buy more, before proofs, renewals and alerts stop.
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
  included. It was refused on 30 September (« Until a sender is validated:
  the short number », above).

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
   422 and not 404, and the first log line names the version. The next two
   say whether discovery is on, and whether the operator's alerts go by SMS,
   under a sender or by OVHcloud's short number.

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
