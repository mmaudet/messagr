-- La limite de masquage (#401, #392, ADR 0014) : au plus 5 000 numéros
-- masqués par numéro prouvé, sur trente jours glissants.
--
-- LE COMPTEUR SUIT LE NUMÉRO, PAS LE COMPTE : il porte le masque du numéro
-- prouvé, sous sa clé, si bien qu'un retrait ou une nouvelle preuve du même
-- numéro, sur ce compte ou sur un autre, ne le remet pas à zéro tant que la
-- clé reste la même (#409 le fera passer sur la nouvelle). Une ligne par
-- jour ; le ménage oublie les jours sortis de la fenêtre.
CREATE TABLE masking_counts (
    key_id  INTEGER NOT NULL,
    mask    BLOB    NOT NULL,
    day     INTEGER NOT NULL,
    masked  INTEGER NOT NULL,
    PRIMARY KEY (key_id, mask, day)
);
