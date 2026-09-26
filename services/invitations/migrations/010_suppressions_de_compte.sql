-- 010 : LES SUPPRESSIONS DE COMPTE, ANNONCÉES PAR L'APPLICATION (#385).
--
-- Juste avant de désactiver un compte, l'application le dit au service, avec
-- le jeton de ce compte (`handlers::deletion`). Une ligne par compte, avec
-- l'instant de l'annonce : c'est la liste que parcourt la purge manuelle sous
-- trente jours, que la politique de confidentialité promet et que #71
-- automatisera.
--
-- UNE ANNONCE, PAS UNE PREUVE. La désactivation vient après, et elle peut
-- échouer. L'exploitant vérifie que le compte est bien désactivé avant de
-- purger quoi que ce soit.
--
-- `inviter_counters` reste : plus rien ne l'écrit ni ne la lit depuis #418,
-- mais `cleanup::purge_inviter_counters` la vide encore à chaque passe, et
-- la supprimer ici obligerait à toucher ce ménage dans le même changement.
CREATE TABLE account_deletions (
    user_id      TEXT    PRIMARY KEY,
    announced_at INTEGER NOT NULL
);
