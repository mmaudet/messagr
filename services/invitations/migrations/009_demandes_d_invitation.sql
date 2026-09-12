-- Une demande d'invitation, faite par quelqu'un qui n'a pas de compte.
--
-- # CE QUE CETTE TABLE NE CONTIENT PAS, ET C'EST LE POINT
--
-- Pas d'adresse, pas de nom, pas de texte libre, pas d'adresse IP. La page de
-- confidentialité publiée promet « pas d'adresse électronique », et une file
-- d'attente pleine de courriels de gens qui n'ont pas encore de compte aurait
-- démenti cette phrase sur le service même qui la sert.
--
-- Ce que la personne emporte est un CODE, qu'elle garde et avec lequel elle
-- revient. Le service n'en tient que l'empreinte, exactement comme il fait
-- déjà des jetons d'invitation (`invitations.token_sha256`) : un vol de la
-- base ne rend aucun code, et rien ici ne désigne personne.
--
-- La contrepartie est assumée et elle est écrite sur la page : celui qui
-- décide ne sait pas qui demande. C'est déjà vrai de tout le produit — pas
-- d'annuaire, pas de recherche — et ce qu'il arbitre est un rythme, pas une
-- personne.
--
-- # LES TROIS DÉFENSES, ET AUCUNE NE DEMANDE DE TIERS
--
-- `ripe_at` porte la troisième. Un plafond de file d'attente et une cadence
-- vivent dans le code ; le délai vit ici, parce qu'il appartient à la
-- demande : une invitation ne peut pas être accordée avant. Avec un humain
-- dans la boucle le délai est déjà là de fait — cette colonne est ce qui le
-- garde vrai le jour où quelqu'un voudra automatiser l'accord.
CREATE TABLE invitation_requests (
    id            TEXT PRIMARY KEY,
    -- L'empreinte du code, jamais le code. Voir `invitations.token_sha256`.
    code_sha256   BLOB    NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL,
    -- Avant cet instant, aucun accord n'est possible.
    ripe_at       INTEGER NOT NULL,
    -- 'waiting' | 'granted' | 'declined'
    status        TEXT    NOT NULL,
    decided_at    INTEGER,
    -- L'invitation accordée, quand il y en a une. C'est ce que la personne
    -- reçoit en revenant avec son code.
    invitation_id TEXT    REFERENCES invitations(id),
    -- LE JETON, SCELLÉ PAR UNE CLÉ QUE CE SERVICE N'A PAS.
    --
    -- `create` rend le jeton une fois et n'en garde que l'empreinte ; ici il
    -- faut le rendre plus tard, donc le garder. En clair, cette colonne serait
    -- un trousseau d'invitations utilisables.
    --
    -- Il est scellé avec une clé dérivée du CODE, que seule la personne
    -- détient : la base tient `SHA-256(code)` pour retrouver la ligne et
    -- `seal(SHA-256(code ‖ domaine), jeton)` pour la rendre. Deux dérivations
    -- à sens unique du même secret, et aucune ne donne l'autre. Un vol de la
    -- base ne rend aucune invitation.
    --
    -- C'est plus que ce que `reserved_accounts` fait des siens, scellés par la
    -- clé du service : ceux-là, le service doit s'en servir seul. Celui-ci,
    -- non — donc il n'a pas à pouvoir.
    invitation_token_enc BLOB,
    -- PURGÉE COMME LE GRAPHE, ET POUR LA MÊME RAISON. `retention.json` est la
    -- seule source de vérité des durées, et `scripts/assert-retention.sh`
    -- refuse que la politique publiée et le code divergent — parce que la
    -- politique a déjà affirmé une durée que le code ne pratiquait pas.
    purge_after   INTEGER NOT NULL
);

-- La file que quelqu'un dépouille : les plus anciennes d'abord.
CREATE INDEX idx_requests_waiting ON invitation_requests(status, created_at);
CREATE INDEX idx_requests_purge ON invitation_requests(purge_after);
