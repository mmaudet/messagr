-- 010 : LES SUPPRESSIONS DE COMPTE, ANNONCÉES PAR L'APPLICATION (#385).
--
-- Juste avant de désactiver un compte, l'application le dit au service, avec
-- le jeton de ce compte (`handlers::deletion`). Une ligne par compte, avec
-- l'instant de l'annonce : de quoi faire la purge manuelle sous trente jours
-- que la politique de confidentialité promet, et que #423 automatisera.
--
-- CE N'EST PAS LA LISTE COMPLÈTE. Une suppression faite par courriel n'est
-- jamais annoncée, ni une suppression dont l'annonce a échoué (service
-- injoignable, ou pas encore déployé). Et une annonce n'est pas une preuve :
-- la désactivation vient après et peut échouer, laissant ici un compte
-- vivant. L'exploitant vérifie que le compte est désactivé avant de purger.
--
-- EFFACÉE À TRENTE JOURS, comme les demandes d'invitation (009) : la ligne
-- nomme un compte supprimé, et la promesse vaut pour elle aussi.
-- `cleanup::purge_account_deletions` l'applique.
--
-- `inviter_counters` reste : plus rien ne l'écrit ni ne la lit depuis #418,
-- mais `cleanup::purge_inviter_counters` la vide encore à chaque passe, et la
-- supprimer ici obligerait à retirer ce ménage dans le même changement.
CREATE TABLE account_deletions (
    user_id      TEXT    PRIMARY KEY,
    announced_at INTEGER NOT NULL,
    purge_after  INTEGER NOT NULL
);
