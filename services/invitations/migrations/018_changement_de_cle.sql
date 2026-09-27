-- Le changement de la clé de masquage (#409, #392, ADR 0014).
--
-- LE NUMÉRO SOUS CHAQUE AUTRE CLÉ EN SERVICE. Au début d'une preuve, le
-- service tient le numéro en clair : il le masque sous la clé courante, et
-- aussi sous chaque autre clé en service, gardés ici avec la preuve en cours.
-- La fin de la preuve y retrouve ce numéro sous une clé plus ancienne : la
-- preuve d'un autre compte qu'elle remplace, ou la référence et le compteur
-- de masquage du même compte, qui passent sur la clé courante (décision du
-- porteur du 27 septembre 2026).
CREATE TABLE pending_proof_masks (
    user_id  TEXT    NOT NULL,
    key_id   INTEGER NOT NULL,
    mask     BLOB    NOT NULL,
    PRIMARY KEY (user_id, key_id)
);

-- Oubliés avec la preuve en cours, par quelque chemin qu'elle s'en aille :
-- terminée, retirée, arrivée à échéance, ou abandonnée faute de SMS.
CREATE TRIGGER pending_proof_masks_go_with_their_proof
AFTER DELETE ON pending_proofs
BEGIN
    DELETE FROM pending_proof_masks WHERE user_id = old.user_id;
END;

-- Depuis quand chaque clé sert, noté au démarrage. La rallonge de masquage
-- vaut vingt-huit jours après la mise en service d'une nouvelle clé, tant
-- qu'une plus ancienne sert aussi : une ancienne clé oubliée dans
-- MASKING_KEYS ne la prolonge pas.
CREATE TABLE masking_keys_served (
    key_id  INTEGER PRIMARY KEY,
    since   INTEGER NOT NULL
);

-- Les preuves qu'une bascule d'urgence a arrêtées (#409) : le compte lit « clé
-- changée » jusqu'à sa prochaine preuve, et l'avis s'oublie trente jours plus
-- tard, comme celui d'une preuve remplacée.
CREATE TABLE retired_key_proofs (
    user_id     TEXT    PRIMARY KEY,
    retired_at  INTEGER NOT NULL
);
