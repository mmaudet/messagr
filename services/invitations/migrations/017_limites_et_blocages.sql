-- Les limites des invitations remises dans Messagr, et le blocage (#406, #392).
--
-- LE BLOCAGE : un destinataire refuse une invitation et bloque son inviteur.
-- Ses invitations ne lui sont plus remises : acceptées, elles expirent, et
-- rien ne dit à l'inviteur qu'il est bloqué. Un refus que le service garde,
-- quand celui d'une invitation s'oublie à l'échéance : c'est le prix du
-- blocage, que la personne choisit. Gardé tant que les deux comptes existent :
-- la purge d'un compte supprimé l'efface, de part et d'autre, jamais
-- l'annonce de sa suppression, qui n'est pas une preuve (#423). Sans date : il
-- n'a rien d'autre à dire que son existence.
CREATE TABLE delivered_blocks (
    blocker_user_id TEXT NOT NULL,
    blocked_user_id TEXT NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id)
);

-- Les limites se lisent par inviteur : combien il en a envoyé ce jour, et la
-- dernière vers tel destinataire.
CREATE INDEX delivered_invitations_by_inviter
    ON delivered_invitations (inviter_user_id, sent_at);
