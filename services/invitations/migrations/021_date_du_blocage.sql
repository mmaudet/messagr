-- Bloquer un compte depuis une conversation, et le décompte quotidien des
-- blocages (#469, #462, ADR 0015).
--
-- UN SEUL BLOCAGE. La relation de « Refuser et bloquer » (#406, migration
-- 017) sert aussi au blocage fait depuis une conversation : un refus durable
-- que le service garde, par quelque entrée qu'il vienne. La table garde son
-- nom de #406, delivered_blocks, et tient désormais aussi les blocages faits
-- depuis une conversation, nommés par leur compte (handlers::blocks). Elle
-- gagne la date du blocage, pour que l'exploitant reçoive un SMS par jour qui
-- compte ceux faits depuis le précédent, sans nommer aucun compte. Les
-- blocages d'avant n'en ont pas : rien ne dit quand ils ont été faits, et
-- aucun décompte ne les compte. Un blocage rejoué garde sa première date.
ALTER TABLE delivered_blocks ADD COLUMN blocked_at INTEGER;

-- LE DÉCOMPTE QUOTIDIEN, en une ligne qui ne s'efface jamais
-- (blocks_count.rs).
--
-- told_up_to : les blocages datés d'avant cet instant ont été dits à
-- l'exploitant, par SMS, ou dans le journal quand le journal est son seul
-- canal. Il n'avance qu'une fois le décompte dit : un SMS refusé, ou un arrêt
-- entre le décompte et son SMS, laisse ses blocages au décompte suivant.
--
-- counted_at : quand le dernier décompte a été fait, dit ou non. Un décompte
-- par jour, et pas un de plus. Un blocage enregistré après lui prend au moins
-- cette date, même si l'heure qu'il a lue était plus ancienne : il compte au
-- décompte suivant plutôt que nulle part.
--
-- Zéro au départ : le premier décompte compte tous les blocages datés.
CREATE TABLE blocks_count (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    told_up_to INTEGER NOT NULL,
    counted_at INTEGER NOT NULL
);
INSERT INTO blocks_count (id, told_up_to, counted_at) VALUES (1, 0, 0);
