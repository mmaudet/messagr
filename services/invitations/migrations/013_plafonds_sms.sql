-- Les plafonds de SMS, et l'effacement chez OVHcloud (#399, #392).
--
-- DES COMPTEURS, SANS LE NUMÉRO, ET SANS LIEN ENTRE UN COMPTE ET UN PAYS.
-- Deux tables séparées : les codes qu'un compte a demandés, par instant (de
-- quoi dire quand il pourra redemander), et les SMS partis vers chaque pays,
-- par jour civil (de quoi tenir le plafond du pays et le budget). Aucune ligne
-- ne dit dans quel pays est le numéro d'un compte. Le ménage efface les deux au
-- bout de trente jours.
CREATE TABLE sms_by_account (
    user_id  TEXT    NOT NULL,
    sent_at  INTEGER NOT NULL
);
CREATE INDEX sms_by_account_user ON sms_by_account (user_id, sent_at);

CREATE TABLE sms_by_country_day (
    country  TEXT    NOT NULL,
    day      INTEGER NOT NULL,
    sent     INTEGER NOT NULL,
    PRIMARY KEY (country, day)
);

-- Les SMS à effacer de l'historique d'OVHcloud, par l'identifiant qu'OVHcloud
-- leur a donné, avec l'instant à partir duquel on peut les effacer sans
-- empêcher leur remise : dix minutes pour un code, un jour pour une alerte.
CREATE TABLE sms_to_erase (
    message_id   INTEGER PRIMARY KEY,
    erase_after  INTEGER NOT NULL
);

-- Quand l'exploitant a été prévenu qu'un plafond était atteint, ou que les
-- crédits baissaient, pour ne le prévenir qu'une fois par jour et par sujet.
CREATE TABLE sms_alerts (
    ceiling  TEXT    PRIMARY KEY,
    sent_at  INTEGER NOT NULL
);
