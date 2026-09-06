# Messagr invitation service — runtime image.
#
# Two-stage build: hermes has no Rust toolchain installed and has no need
# for one. `docker compose build` is enough.
#
# No distroless image here, unlike the homeserver: reqwest is compiled with
# native-tls, so the binary is dynamically linked against the system's
# libssl/libcrypto. A debian-slim base provides them, and the root
# certificates with them.

# PINNED, FOR THE REASON THE ANDROID BUILD PINS ITS GRADLE PLUGIN: a base
# image that moved under a release build would move the binary with it, and
# "it built last week" would stop being a statement about anything. Raised
# deliberately, not by a rebuild.
FROM rust:1.98-bookworm AS builder
WORKDIR /src
# Served version, read at compile time by `option_env!` and returned in the
# `X-Messagr-Version` header of /health. Worth "unknown" if not provided —
# never a fake value. Passed by docker-compose:
#   MESSAGR_VERSION=$(git rev-parse --short HEAD) docker compose build invitations
ARG MESSAGR_VERSION
ENV MESSAGR_VERSION=$MESSAGR_VERSION
# The `migrations` directory must be present BEFORE compilation:
# `sqlx::migrate!` is a macro, it embeds the files into the binary at build
# time.
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-20251229-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
# The SQLite database lives in this directory, mounted as a volume: it must
# survive the replacement of the image, otherwise every in-flight invitation
# would be lost and their reserved accounts would become untraceable orphans.
RUN mkdir -p /var/lib/messagr
COPY --from=builder /src/target/release/messagr-invitations /usr/local/bin/messagr-invitations
# No secret in the image: all configuration comes from the environment
# (see the deployment's own invitations.service.env; a redacted example lives
# beside the compose file on the host, not in this image).
ENTRYPOINT ["/usr/local/bin/messagr-invitations"]
