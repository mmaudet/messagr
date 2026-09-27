-- Le nom que l'inviteur se donne voyage scellé pour le destinataire (#405,
-- #392, ADR 0014). Une invitation remise dans Messagr n'a pas de lien, donc
-- pas de fragment où le porter.

-- LA CLÉ PUBLIQUE D'ENVELOPPE de l'appareil qui a prouvé le numéro (X25519,
-- 32 octets), publiée avec la preuve et portée par l'annuaire avec la
-- référence. Une nouvelle preuve la remplace. Absente quand l'appareil n'en a
-- pas publié : les invitations de ce compte arrivent sans nom.
ALTER TABLE findable_numbers ADD COLUMN envelope_key BLOB;

-- L'ENVELOPPE, que le service transmet sans pouvoir l'ouvrir : scellée par
-- l'appareil de l'inviteur pour la clé du destinataire (HPKE, RFC 9180), et
-- toujours de la même taille. Effacée dès que le destinataire a répondu, et à
-- l'échéance : passé l'une ou l'autre, aucun écran ne la montre plus. La
-- ligne entière part trente jours après la fin de l'invitation.
ALTER TABLE delivered_invitations ADD COLUMN sealed_name BLOB;
