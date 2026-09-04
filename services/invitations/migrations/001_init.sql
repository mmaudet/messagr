CREATE TABLE invitations (
    id              TEXT PRIMARY KEY,
    inviter_user_id TEXT    NOT NULL,
    token_sha256    BLOB    NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    max_uses        INTEGER NOT NULL,
    used_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL,
    revoked_at      INTEGER
);

CREATE TABLE reserved_accounts (
    user_id           TEXT PRIMARY KEY,
    invitation_id     TEXT    NOT NULL REFERENCES invitations(id),
    password_enc      BLOB    NOT NULL,
    -- Mot de passe candidat, persisté AVANT la rotation sur le homeserver.
    -- Sans ce champ, un échec entre persistance et rotation rend le compte
    -- définitivement inatteignable par le nettoyage. Voir Task 6.
    password_next_enc BLOB,
    access_token_enc  BLOB    NOT NULL,
    status            TEXT    NOT NULL,
    created_at        INTEGER NOT NULL,
    claimed_at        INTEGER
);
CREATE INDEX idx_reserved_invitation ON reserved_accounts(invitation_id, status);

CREATE TABLE invitation_edges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_user_id TEXT    NOT NULL,
    invited_user_id TEXT    NOT NULL,
    invitation_id   TEXT    NOT NULL,
    redeemed_at     INTEGER NOT NULL,
    purge_after     INTEGER
);
CREATE INDEX idx_edges_purge ON invitation_edges(purge_after);

CREATE TABLE inviter_counters (
    inviter_user_id TEXT PRIMARY KEY,
    issued_count    INTEGER NOT NULL DEFAULT 0,
    claimed_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE abuse_holds (
    invitation_id TEXT PRIMARY KEY,
    opened_at     INTEGER NOT NULL,
    closed_at     INTEGER
);
