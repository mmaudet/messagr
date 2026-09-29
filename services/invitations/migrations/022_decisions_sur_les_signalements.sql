-- La décision sur un signalement, et ce qui s'efface après elle (#473, #462,
-- ADR 0015).
--
-- Sur l'hôte, l'exploitant note la décision (maintenue, levée, fermeture),
-- sa motivation et sa date, et retient un signalement transmis aux
-- autorités, puis lève cette retenue (`moderation`). Le ménage horaire
-- efface le pli et la clé d'idempotence 181 jours après la décision, et
-- l'enregistrement 365 jours après : jamais tant que le signalement est
-- retenu, et jamais un signalement sans décision, que la liste montre
-- toujours comme en attente.
--
-- LA DATE D'UNE DÉCISION EST UN JOUR, JAMAIS UNE HEURE : minuit UTC du jour
-- où l'exploitant la note, comme celle d'une retenue. Rien sur un signalement
-- ne garde l'instant où l'exploitant était à son terminal : une fermeture,
-- enregistrée à part comme une suppression de compte (`account_deletions`,
-- 011), n'y retrouve pas son heure, et aucune colonne ne relie l'une à
-- l'autre.
--
-- LA MOTIVATION est la décision raisonnée, jamais une citation : elle ne nomme
-- aucun compte et ne recopie rien de ce qui a été dit. Le mode qui la note
-- refuse un identifiant Matrix.
--
-- LA TABLE EST REFAITE, parce que SQLite ne sait pas rendre une colonne
-- facultative : le pli et la clé d'idempotence deviennent NULL une fois
-- effacés, et deux clés effacées du même compte ne se heurtent pas à
-- l'unicité, qui ignore NULL. Chaque signalement déjà reçu est recopié tel
-- quel, sans décision.
CREATE TABLE reports_022 (
    number            TEXT    PRIMARY KEY,
    reporter_user_id  TEXT    NOT NULL,
    reason            TEXT    NOT NULL,
    sealed            BLOB,
    received_at       INTEGER NOT NULL,
    idempotency_key   TEXT,
    decision          TEXT    CHECK (decision IN ('maintained', 'lifted', 'termination')),
    motivation        TEXT,
    decided_on        INTEGER,
    held_since        INTEGER,
    UNIQUE (reporter_user_id, idempotency_key),
    -- Une décision a toujours sa motivation et sa date, et rien de cela
    -- n'existe sans elle.
    CHECK ((decision IS NULL) = (motivation IS NULL)
       AND (decision IS NULL) = (decided_on IS NULL))
);

INSERT INTO reports_022
    (number, reporter_user_id, reason, sealed, received_at, idempotency_key)
SELECT number, reporter_user_id, reason, sealed, received_at, idempotency_key
FROM reports;

DROP TABLE reports;

ALTER TABLE reports_022 RENAME TO reports;
