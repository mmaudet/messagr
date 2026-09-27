-- Les invitations remises dans Messagr (#404, #392, ADR 0014) : un compte
-- trouvable invite le compte derrière la référence d'un contact trouvé,
-- jamais son numéro. Sept jours, un seul usage.
--
-- QUI INVITE QUI, DÈS L'ENVOI, trente jours après la fin de l'invitation
-- (sa réclamation, ou son échéance), comme pour un lien (#416). JAMAIS LA
-- CONVERSATION VISÉE : l'appareil de l'inviteur la tient, et y invite le
-- compte quand la réclamation arrive. Aucune colonne ne la porterait.
--
-- Un refus se note pour le seul destinataire : l'inviteur lit l'invitation
-- en attente jusqu'à son échéance, comme une invitation que personne n'a vue.
CREATE TABLE delivered_invitations (
    id                TEXT    PRIMARY KEY,
    inviter_user_id   TEXT    NOT NULL,
    recipient_user_id TEXT    NOT NULL,
    sent_at           INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    claimed_at        INTEGER,
    declined_at       INTEGER
);

CREATE INDEX delivered_invitations_by_recipient
    ON delivered_invitations (recipient_user_id);
