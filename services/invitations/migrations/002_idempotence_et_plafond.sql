-- Idempotence de POST /invitations et plafond par appelant (§15 du PRD,
-- « le service d'invitation peut créer des comptes sans borne »).
--
-- Applicable à la base DÉJÀ EN SERVICE sur hermes : les deux colonnes sont
-- ajoutées en NULL, donc les invitations antérieures restent valides et
-- l'index unique ne les fait pas entrer en conflit (SQLite tient deux NULL
-- pour distincts, y compris dans un index composite).

-- Clé fournie par l'APPELANT, jamais dérivée du corps de requête. Portée à
-- l'inviteur : sans le couple, un appelant qui devinerait la clé d'un autre se
-- verrait rendre SON invitation, donc son jeton — une divulgation, pas une
-- idempotence.
ALTER TABLE invitations ADD COLUMN idempotency_key TEXT;

-- Le jeton scellé, écrit UNIQUEMENT quand le lot est complet : c'est le
-- marqueur d'achèvement autant que la matière du rejeu. Sans lui, un réessai
-- ne peut pas recevoir la MÊME invitation — le jeton en clair n'existe nulle
-- part ailleurs, `token_sha256` étant irréversible — et l'appelant, privé de
-- son jeton, en redemanderait un autre : le lot dupliqué que l'on corrige.
--
-- Amende sciemment la ligne « empreinte du jeton, jamais le jeton » de la
-- conception (§ tables). Le scellé emploie la même clé de service que
-- `reserved_accounts.password_enc`, qui garde déjà des secrets STRICTEMENT
-- plus puissants (le mot de passe d'un compte réservé ouvre ce compte ; le
-- jeton d'invitation ne fait qu'y donner droit) : la surface au repos ne
-- change pas de nature.
ALTER TABLE invitations ADD COLUMN token_enc BLOB;

-- LA contrainte qui arbitre l'idempotence. Deux requêtes concurrentes portant
-- la même clé se disputent cet index, pas un verrou applicatif : la seconde
-- reçoit une violation d'unicité et part sur le chemin de rejeu, y compris
-- entre deux processus.
CREATE UNIQUE INDEX idx_invitations_idempotence
    ON invitations(inviter_user_id, idempotency_key);

-- Sert le calcul de la charge d'un appelant, évalué à chaque création.
CREATE INDEX idx_invitations_inviteur_statut
    ON invitations(inviter_user_id, status);
