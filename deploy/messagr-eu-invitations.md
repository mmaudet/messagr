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
    `MAX_RESERVED_ACCOUNTS_PER_INVITER`, `PUSH_GATEWAY_URL`.
- **The networks.** `default`, and `sygnal` (the external network
  `messagr-sygnal_default`), because the push gateway forwards to
  `http://messagr-sygnal:5000/_matrix/push/v1/notify`.

The bench, `messagr-invitations-fork` in `/opt/messagr-fork`, has the same shape
and builds from its own copy of `services/invitations`, which lags this
repository until somebody copies it again.

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
