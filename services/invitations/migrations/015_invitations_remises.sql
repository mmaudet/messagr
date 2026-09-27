-- Les invitations remises dans Messagr (#404, #392, ADR 0014) : un compte
-- trouvable invite le compte derrière la référence d'un contact trouvé,
-- jamais son numéro. Sept jours, un seul usage.
--
-- QUI INVITE QUI, DÈS L'ENVOI, y compris pour une invitation refusée ou
-- restée sans réponse : c'est le prix que nomme l'ADR 0014, qu'un lien ne
-- paie qu'à sa réclamation. Gardé trente jours après la fin de l'invitation
-- (sa réclamation, ou son échéance), la durée des liens (#416). JAMAIS LA
-- CONVERSATION VISÉE : l'appareil de l'inviteur la tient, et y invite le
-- compte quand la réclamation arrive. Aucune colonne ne la porterait.
--
-- UN REFUS SE NOTE POUR LE SEUL DESTINATAIRE, sans date, et s'oublie à
-- l'échéance : l'inviteur lit l'invitation en attente jusqu'à son échéance,
-- comme une invitation que personne n'a vue, et une copie de la base ne dit
-- plus rien d'un refus passé.
CREATE TABLE delivered_invitations (
    id                TEXT    PRIMARY KEY,
    inviter_user_id   TEXT    NOT NULL,
    recipient_user_id TEXT    NOT NULL,
    sent_at           INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    claimed_at        INTEGER,
    declined          INTEGER NOT NULL DEFAULT 0,
    -- UNE INVITATION REJOINTE RESTE DANS LA LISTE DU DESTINATAIRE, avec son
    -- inviteur, jusqu'à ce que son appareil dise être entré dans la
    -- conversation : il sait ainsi quelle invitation de salon accepter, même
    -- après l'échéance, que l'appareil de l'inviteur peut dépasser. Un
    -- drapeau, sans date : la conversation dit déjà quand il est entré.
    entered           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX delivered_invitations_by_recipient
    ON delivered_invitations (recipient_user_id);
