-- La référence d'un compte trouvable suit le compte (#451, décision du
-- porteur du 27 septembre 2026). Elle se calcule à partir du compte, avec la
-- clé REFERENCE_KEY gardée sur l'hôte : la base n'en garde que l'empreinte, et
-- le moment où le service l'a servie pour la première fois. Un démarrage qui
-- la tient encore après qu'une clé de masquage a été retirée d'un coup est
-- refusé : les comptes que ce retrait arrête reviennent sous une référence
-- neuve (ADR 0014, #409).
CREATE TABLE reference_keys_served (
    fingerprint BLOB PRIMARY KEY,
    since       INTEGER NOT NULL
);
