-- La preuve d'un numéro, pour la découverte par le carnet (#397, #392, ADR 0014).
--
-- LES TABLES DU PROTOTYPE S'EN VONT. Les migrations 003 à 007 les avaient
-- créées sur le banc et en production ; en production, elles sont vides depuis
-- le 15 septembre 2026. La découverte les remplace par les deux tables
-- ci-dessous, qui ne reprennent aucun de leurs noms.
DROP TABLE IF EXISTS discovery_claims;
DROP TABLE IF EXISTS discovery_quota;
DROP TABLE IF EXISTS discovery_quota_key;
DROP TABLE IF EXISTS discovery_keys;
DROP TABLE IF EXISTS discovery_usage_spent;

-- Un compte trouvable : le masque de son numéro sous une clé de masquage,
-- jamais le numéro. Un numéro ne rend trouvable qu'un compte (la clé primaire),
-- et un compte n'a qu'un numéro (`user_id` unique) : la dernière preuve
-- l'emporte, la route qui la termine efface l'autre ligne.
CREATE TABLE findable_numbers (
    key_id      INTEGER NOT NULL,
    mask        BLOB    NOT NULL,
    user_id     TEXT    NOT NULL UNIQUE,
    -- La référence opaque que l'annuaire montrera, que seul le service relie
    -- au compte.
    reference   TEXT    NOT NULL UNIQUE,
    proven_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (key_id, mask)
);

-- Une preuve en cours, une par compte : le masque du numéro à prouver, et une
-- empreinte du code envoyé, jamais le code.
CREATE TABLE pending_proofs (
    user_id      TEXT    PRIMARY KEY,
    key_id       INTEGER NOT NULL,
    mask         BLOB    NOT NULL,
    code_digest  BLOB    NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    expires_at   INTEGER NOT NULL
);
