-- La référence d'un compte trouvable suit le compte (#451, décision du
-- porteur du 27 septembre 2026). Elle se calcule à partir du compte, avec la
-- clé REFERENCE_KEY gardée sur l'hôte ; la base n'en garde que l'empreinte.
--
-- Un retrait d'urgence change aussi cette clé, et seul un retrait la change :
-- les comptes qu'il arrête reviennent sous une référence neuve (ADR 0014,
-- #409). Pour dire quelle clé a servi avant quel retrait, l'horloge ne suffit
-- pas : deux événements tombent dans la même seconde, et l'heure d'un retrait
-- est prise avant que l'opérateur tape sa confirmation. Chaque retrait prend
-- donc un numéro d'ordre, et chaque clé de référence note le dernier numéro
-- qu'elle a vu en commençant à servir.
CREATE TABLE retirements (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id     INTEGER NOT NULL,
    retired_at INTEGER NOT NULL
);

-- Les retraits déjà faits, dans l'ordre où ils l'ont été.
INSERT INTO retirements (key_id, retired_at)
    SELECT key_id, retired_at FROM retired_keys ORDER BY retired_at, key_id;

CREATE TABLE reference_keys_served (
    fingerprint      BLOB PRIMARY KEY,
    since            INTEGER NOT NULL,
    retirements_seen INTEGER NOT NULL
);
