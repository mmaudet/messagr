-- Les signalements (#468, #462, ADR 0015) : les messages qu'une personne a
-- choisis, scellés sur son appareil pour la clé de l'exploitant, arrivent ici
-- avec un motif, et en repartent avec un numéro de signalement.
--
-- CE QUE LE SERVICE GARDE : le numéro, le compte qui signale tel que le
-- homeserver nomme le jeton de l'appel, le code du motif, le pli tel qu'il
-- est venu, l'instant où il est venu, et la clé d'idempotence de l'envoi.
-- JAMAIS LE COMPTE VISÉ, LA CONVERSATION NI LES MESSAGES : ils sont dans le
-- pli, que seul l'exploitant ouvre, sur sa machine. Aucune colonne ne les
-- porterait.
--
-- Le numéro s'écrit comme il s'affiche, K7QM-4ZT2 : huit caractères de
-- l'alphabet du suffixe fort, groupés par quatre.
--
-- LA CLÉ D'IDEMPOTENCE, comme celle de POST /invitations : l'appareil la
-- tire au hasard pour un signalement, et la garde pour chaque nouvel envoi
-- du même. Une réponse perdue puis « Réessayer » rendent ainsi le numéro déjà
-- donné, sans rien garder ni prévenir de nouveau. Propre au compte qui
-- signale, elle ne dit rien de ce qui est signalé.
--
-- La décision et ses dates, et l'effacement qui en dépend, viennent avec
-- #473.
CREATE TABLE reports (
    number            TEXT    PRIMARY KEY,
    reporter_user_id  TEXT    NOT NULL,
    reason            TEXT    NOT NULL,
    sealed            BLOB    NOT NULL,
    received_at       INTEGER NOT NULL,
    idempotency_key   TEXT    NOT NULL,
    UNIQUE (reporter_user_id, idempotency_key)
);
