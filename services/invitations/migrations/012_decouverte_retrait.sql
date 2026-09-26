-- Rester trouvable, ou cesser de l'être (#398, #392).
--
-- UN NUMÉRO RETIRÉ QUITTE LA DÉCOUVERTE AUSSITÔT, et son masque reste trente
-- jours au service : la ligne garde l'instant du retrait, son échéance devient
-- cet instant, et le ménage l'efface trente jours plus tard, comme une preuve
-- expirée.
ALTER TABLE findable_numbers ADD COLUMN withdrawn_at INTEGER;

-- Les comptes qu'une preuve plus récente du même numéro a remplacés, pour que
-- leur état de découverte le leur dise à la prochaine lecture. Rien d'autre
-- que le compte et l'instant ; effacé par une nouvelle preuve du compte, ou
-- trente jours plus tard.
CREATE TABLE replaced_proofs (
    user_id      TEXT    PRIMARY KEY,
    replaced_at  INTEGER NOT NULL
);
