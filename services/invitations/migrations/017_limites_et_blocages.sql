-- Les limites des invitations remises dans Messagr, et le blocage (#406, #392).
--
-- LE BLOCAGE : un destinataire refuse une invitation et bloque son inviteur.
-- Les invitations suivantes de ce compte sont acceptées, jamais remises, puis
-- expirent : rien ne dit à l'inviteur qu'il est bloqué. Gardé tant que les
-- deux comptes existent : l'annonce de la suppression de l'un ou de l'autre
-- l'efface. Sans date : il n'a rien d'autre à dire que son existence.
CREATE TABLE delivered_blocks (
    blocker_user_id TEXT NOT NULL,
    blocked_user_id TEXT NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id)
);

-- Les limites se lisent par inviteur : combien il en a envoyé ce jour, et la
-- dernière vers tel destinataire.
CREATE INDEX delivered_invitations_by_inviter
    ON delivered_invitations (inviter_user_id, sent_at);
