//! Demander une invitation quand on n'en a pas, et ce que cela ne collecte pas.
//!
//! # LA DEMANDE NE PORTE RIEN QUI DÉSIGNE QUELQU'UN
//!
//! Pas d'adresse, pas de nom, pas de texte libre. La page de confidentialité
//! publiée promet « pas d'adresse électronique », et une file d'attente
//! pleine de courriels de gens qui n'ont pas encore de compte aurait démenti
//! cette phrase sur le service même qui la sert.
//!
//! Ce que la personne emporte est un CODE. Elle le garde, elle revient avec.
//! C'est la même forme que « Copier le lien » sur la page d'invitation, qui
//! fait déjà porter un secret à travers une installation — et la même forme
//! que le produit entier, où l'identifiant d'un compte est tiré au hasard et
//! n'est rattaché à rien.
//!
//! La contrepartie est assumée et elle est écrite sur la page : **celui qui
//! décide ne sait pas qui demande**. Il arbitre un rythme, pas une personne.
//! C'est moins que ce qu'un parrainage porte, et c'est ce que ce produit peut
//! tenir sans se contredire.
//!
//! # LE JETON ACCORDÉ N'EST PAS STOCKÉ ICI, ET UNE PREMIÈRE VERSION L'A CRU
//!
//! Elle portait une colonne `invitation_token_enc`, scellée par une clé
//! dérivée du CODE, et s'en félicitait : le service lui-même ne pouvait pas
//! l'ouvrir. C'était vrai, et c'était impossible — **le code n'existe que
//! chez le demandeur, et l'accord se prononce en son absence**. Personne
//! n'aurait jamais pu remplir cette colonne.
//!
//! Les tests ne l'ont pas vu parce qu'ils scellaient eux-mêmes avec le code :
//! ils jouaient le demandeur ET l'exploitant, donc ils disposaient d'un
//! secret que l'exploitant n'a jamais. Chaque pièce était juste et rien ne
//! reliait les deux bouts.
//!
//! Il n'y a en fait rien à stocker. `invitations.token_enc` tient déjà le
//! jeton, scellé par la clé du service, pour que `create` puisse rejouer une
//! réponse idempotente. Une demande accordée retient donc un
//! `invitation_id`, et rien de plus : le jeton d'une invitation accordée est
//! exactement là où sont déjà ceux de toutes les autres, et cette table
//! **n'ajoute aucune exposition**.
//!
//! Le code garde son rôle, qui est celui qui compte : il commande l'ACCÈS.
//! Sans lui, personne ne sait quelle demande regarder.
//!
//! # TROIS DÉFENSES, ET AUCUNE NE DEMANDE DE TIERS
//!
//! Pas de captcha : il mettrait un tiers sur un site dont l'argument est de
//! n'en avoir aucun. Ce qui reste, le ticket le nomme — un plafond, une
//! cadence, un délai — et les trois tiennent sans rien savoir du demandeur.
//!
//! Elles sont **globales**, faute d'identifiant, et c'est le prix de ne rien
//! collecter : quelqu'un d'obstiné peut saturer la file et faire attendre les
//! autres. Le mal est borné — la file est une commodité, et le chemin par
//! cooptation, qui est la vraie porte, n'en dépend pas.
//!
//! # CE QUI EST IDENTIQUE, ET CE QUI NE L'EST PAS
//!
//! Le critère du ticket dit « la réponse de la page est identique quoi qu'on
//! ait soumis ». Ici **rien n'est soumis** : il n'y a donc rien par quoi la
//! réponse pourrait varier, et la propriété est tenue par construction plutôt
//! que par vigilance.
//!
//! Le code rendu change à chaque demande, ce qui n'est pas une variation
//! « selon ce qui a été soumis » mais la réponse elle-même. Et un refus pour
//! file pleine dit l'état du SERVICE, jamais quelque chose sur une personne :
//! c'est une information que le demandeur doit avoir, sans quoi il repartirait
//! avec un code qui ne se résoudra jamais.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Serialize;
use sqlx::Row;

use crate::{auth, crypto, error::AppError, util::now, AppState};

/// Le plafond de la file : ce qu'un humain peut dépouiller.
///
/// Un plafond, et non une croissance sans fin, parce que la ressource rare
/// n'est pas la place en base — c'est l'attention de la personne qui décide.
/// Une file de dix mille demandes n'est pas une file, c'est un abandon.
pub const WAITING_MAX: i64 = 200;

/// La cadence, sur une heure glissante.
///
/// Comptée sur les demandes CRÉÉES et non sur celles qui attendent : sans
/// cela, dépouiller la file rouvrirait la porte à qui l'a saturée, et le
/// travail de la personne qui décide servirait à financer le suivant.
pub const PER_HOUR_MAX: i64 = 60;
pub const HOUR_SECONDS: i64 = 3_600;

/// Le délai avant qu'un accord soit possible.
///
/// Avec un humain dans la boucle il est déjà là de fait. Il est écrit quand
/// même, dans la colonne `ripe_at`, parce qu'une défense qui ne tient que par
/// la lenteur d'un humain disparaît le jour où quelqu'un automatise l'accord —
/// et ce jour-là personne ne se souviendra qu'elle en dépendait.
pub const RIPENS_AFTER_SECONDS: i64 = 3_600;

/// Trente jours, comme le graphe d'invitations.
///
/// `deploy/messagr-eu/retention.json` est la seule source de vérité des
/// durées, et `scripts/assert-retention.sh` refuse que la politique publiée et
/// le code divergent. Cette constante doit s'y accorder.
pub const PURGE_AFTER_SECONDS: i64 = 30 * 86_400;

#[derive(Serialize)]
pub struct AskedResponse {
    /// Rendu une fois. Le service n'en garde que des dérivations.
    pub code: String,
    /// L'instant avant lequel aucun accord n'est possible.
    pub ripe_at: i64,
}

#[derive(Serialize)]
pub struct LookResponse {
    /// `waiting` | `granted` | `declined`
    pub status: String,
    /// Le jeton d'invitation, uniquement quand la demande est accordée.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// `POST /invitation-requests` — public, et c'est le seul de ce service.
///
/// `wake` est l'autre route sans authentification, mais elle est appelée par
/// un homeserver. Celle-ci est appelée par quelqu'un qui n'a rien : pas de
/// compte, pas de jeton, rien à présenter. C'est exactement pour ça que les
/// trois bornes ci-dessus existent, et c'est pourquoi elle ne lit aucun corps.
pub async fn ask(State(st): State<Arc<AppState>>) -> Result<Json<AskedResponse>, AppError> {
    let at = now();

    let waiting: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invitation_requests WHERE status = 'waiting'")
            .fetch_one(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    if waiting >= WAITING_MAX {
        return Err(AppError::RequestsBusy);
    }

    let recent: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invitation_requests WHERE created_at > ?")
            .bind(at - HOUR_SECONDS)
            .fetch_one(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    if recent >= PER_HOUR_MAX {
        return Err(AppError::RequestsBusy);
    }

    let code = crypto::generate_token();
    let ripe_at = at + RIPENS_AFTER_SECONDS;
    sqlx::query(
        "INSERT INTO invitation_requests \
         (id, code_sha256, created_at, ripe_at, status, purge_after) \
         VALUES (?, ?, ?, ?, 'waiting', ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(crypto::token_hash(&code))
    .bind(at)
    .bind(ripe_at)
    .bind(at + PURGE_AFTER_SECONDS)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    Ok(Json(AskedResponse { code, ripe_at }))
}

/// `GET /invitation-requests/:code` — ce que la personne apprend en revenant.
///
/// Un code inconnu répond comme une invitation inconnue : `InvitationInvalid`,
/// qui ne dit pas si la valeur a jamais existé. Le code fait 160 bits, donc
/// il n'y a rien à deviner — mais la réponse muette est la doctrine de ce
/// service et une exception ici serait une exception de trop.
pub async fn look(
    State(st): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> Result<Json<LookResponse>, AppError> {
    // LE JETON VIENT DE `invitations`, où il est déjà. Une jointure plutôt
    // qu'une copie : `create` y scelle le jeton pour pouvoir rejouer une
    // réponse idempotente, et le recopier ici en ferait un second endroit à
    // protéger, à purger et à garder d'accord avec le premier.
    let row = sqlx::query(
        "SELECT r.status AS status, i.token_enc AS token_enc \
         FROM invitation_requests r \
         LEFT JOIN invitations i ON i.id = r.invitation_id \
         WHERE r.code_sha256 = ?",
    )
    .bind(crypto::token_hash(&code))
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;

    let status: String = row.get("status");
    let sealed: Option<Vec<u8>> = row.get("token_enc");

    // UN MARQUEUR ABSENT N'EST PAS UN CODE FAUX. `create` écrit `token_enc`
    // en dernier et n'échoue PAS la création s'il n'y parvient pas — le
    // demandeur d'alors tenait déjà sa réponse. Une invitation dans cet état
    // est intacte et son jeton est irrécupérable : il n'y a rien à rendre
    // ici, et le dire « en attente » serait mentir sur une décision qui a
    // bien été prise.
    let token = match (status.as_str(), sealed) {
        ("granted", Some(sealed)) => Some(crypto::open(&st.cfg.encryption_key, &sealed)?),
        ("granted", None) => return Err(AppError::InvitationInvalid),
        _ => None,
    };

    Ok(Json(LookResponse { status, token }))
}

#[derive(Serialize)]
pub struct WaitingRequest {
    pub id: String,
    pub created_at: i64,
    pub ripe_at: i64,
}

/// `GET /invitation-requests` — la file, pour la personne qui décide.
///
/// Authentifiée, comme tout ce qui n'est pas public ici. Elle ne rend que des
/// horodatages et des identifiants de ligne : il n'y a rien d'autre à rendre,
/// puisqu'il n'y a rien d'autre en base. C'est ce que « décider sans savoir
/// qui demande » veut dire, vu du côté de celui qui décide.
pub async fn queue(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<WaitingRequest>>, AppError> {
    auth::authenticate(&st.mx, &headers).await?;

    let rows = sqlx::query(
        "SELECT id, created_at, ripe_at FROM invitation_requests \
         WHERE status = 'waiting' ORDER BY created_at ASC LIMIT 500",
    )
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    Ok(Json(
        rows.into_iter()
            .map(|r| WaitingRequest {
                id: r.get("id"),
                created_at: r.get("created_at"),
                ripe_at: r.get("ripe_at"),
            })
            .collect(),
    ))
}

#[derive(serde::Deserialize)]
pub struct GrantRequest {
    /// L'invitation à remettre, créée par le chemin ordinaire.
    pub invitation_id: String,
}

/// `POST /invitation-requests/:id/grant` — la décision, prise par une personne.
///
/// # ELLE NE CRÉE PAS L'INVITATION, ELLE L'ATTACHE
///
/// L'exploitant crée l'invitation comme il l'a toujours fait, par
/// `POST /invitations` : avec son propre porteur, dans un salon où il a le
/// droit d'inviter, sous son propre plafond. Puis il l'attache ici.
///
/// Refaire ce travail dans cette route aurait dupliqué l'idempotence, le
/// plafond, la réservation des comptes et le contrôle du niveau de pouvoir —
/// quatre mécanismes que `create` porte déjà et dont aucun ne gagne à
/// exister deux fois.
///
/// # LE DÉLAI EST VÉRIFIÉ ICI
///
/// `ripe_at` est la troisième défense, et c'est le seul endroit qui puisse
/// la faire respecter. Avec un humain dans la boucle elle est déjà tenue de
/// fait ; elle est écrite pour le jour où quelqu'un automatisera ce geste, et
/// ce jour-là personne ne se souviendra qu'elle en dépendait.
///
/// # CE QUE LE DEMANDEUR N'APPREND PAS
///
/// Ni qui a accordé, ni depuis quel salon, ni sous quelle identité. Il
/// reçoit un jeton, comme s'il l'avait reçu de la main d'un proche — ce qui
/// est le geste que ce produit imite.
pub async fn grant(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    crate::extract::Body(req): crate::extract::Body<GrantRequest>,
) -> Result<Json<WaitingRequest>, AppError> {
    let caller = auth::authenticate(&st.mx, &headers).await?;

    // L'INVITATION EST-ELLE CELLE DE QUI L'ATTACHE ? Sans ce contrôle,
    // n'importe quel compte authentifié attacherait l'invitation d'un autre,
    // et la dépenserait à sa place.
    let owner: Option<String> =
        sqlx::query_scalar("SELECT inviter_user_id FROM invitations WHERE id = ?")
            .bind(&req.invitation_id)
            .fetch_optional(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    match owner {
        Some(who) if who == caller => {}
        // Muet dans les deux cas : « pas la vôtre » et « n'existe pas » ne se
        // distinguent pas, sinon la route dirait à qui interroge si une
        // invitation existe. C'est la doctrine de `revoke`, mot pour mot.
        _ => return Err(AppError::InvitationInvalid),
    }

    let at = now();
    let row = sqlx::query("SELECT ripe_at, status FROM invitation_requests WHERE id = ?")
        .bind(&id)
        .fetch_optional(&st.pool)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(AppError::InvitationInvalid)?;

    let ripe_at: i64 = row.get("ripe_at");
    let status: String = row.get("status");
    if status != "waiting" {
        // Déjà tranchée. Rejouer changerait la réponse sous les pieds de
        // quelqu'un qui tient peut-être déjà son jeton.
        return Err(AppError::InvitationInvalid);
    }
    if at < ripe_at {
        return Err(AppError::RequestsBusy);
    }

    sqlx::query(
        "UPDATE invitation_requests \
         SET status = 'granted', decided_at = ?, invitation_id = ? \
         WHERE id = ? AND status = 'waiting'",
    )
    .bind(at)
    .bind(&req.invitation_id)
    .bind(&id)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    Ok(Json(WaitingRequest {
        id,
        created_at: at,
        ripe_at,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use sqlx::SqlitePool;

    /// Un homeserver réduit à `whoami`, qui croit le porteur sur parole :
    /// « Bearer alice » devient « @alice:h ». Même forme que `status.rs`.
    async fn whoami_hs() -> String {
        async fn whoami(headers: HeaderMap) -> Json<serde_json::Value> {
            let bearer = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("unknown");
            Json(serde_json::json!({"user_id": format!("@{bearer}:h")}))
        }
        let app = axum::Router::new().route(
            "/_matrix/client/v3/account/whoami",
            axum::routing::get(whoami),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    fn bearer(who: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {who}").parse().unwrap());
        h
    }

    /// Une invitation créée par le chemin ordinaire, jeton scellé compris —
    /// c'est `create` qui écrit `token_enc`, et c'est de là que `look` le tire.
    async fn seed_invitation(
        pool: &SqlitePool,
        id: &str,
        inviter: &str,
        token: &str,
        key: &[u8; 32],
    ) {
        sqlx::query(
            "INSERT INTO invitations \
             (id, inviter_user_id, token_sha256, created_at, expires_at, max_uses, \
              used_count, status, token_enc) \
             VALUES (?,?,?,0,4000000000,1,0,'pending',?)",
        )
        .bind(id)
        .bind(inviter)
        .bind(crypto::token_hash(token))
        .bind(crypto::seal(key, token).unwrap())
        .execute(pool)
        .await
        .unwrap();
    }

    fn state(pool: SqlitePool) -> Arc<AppState> {
        state_with(pool, "http://127.0.0.1:1".into())
    }

    fn state_with(pool: SqlitePool, hs: String) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(hs.clone(), "token".into())),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: hs,
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
                push_gateway_url: None,
            },
        })
    }

    async fn fill(pool: &SqlitePool, how_many: i64, created_at: i64, status: &str) {
        for n in 0..how_many {
            sqlx::query(
                "INSERT INTO invitation_requests \
                 (id, code_sha256, created_at, ripe_at, status, purge_after) \
                 VALUES (?,?,?,0,?,0)",
            )
            .bind(format!("seeded-{status}-{n}"))
            .bind(crypto::token_hash(&format!("seeded-{status}-{n}")))
            .bind(created_at)
            .bind(status)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn asking_hands_back_a_code_and_keeps_none_of_it(pool: SqlitePool) {
        let st = state(pool.clone());
        let Json(asked) = ask(State(st)).await.unwrap();

        assert!(!asked.code.is_empty());
        assert!(asked.ripe_at > now());

        // LE CODE N'EST NULLE PART, et c'est la propriété qui compte. Ce que
        // la base tient est une empreinte ; un vol ne rend aucun code.
        let stored: Vec<u8> = sqlx::query_scalar("SELECT code_sha256 FROM invitation_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, crypto::token_hash(&asked.code));
        assert_ne!(stored, asked.code.as_bytes());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn two_requests_are_two_requests(pool: SqlitePool) {
        // Deux demandes de suite produisent deux résultats, et non le premier
        // deux fois -- le cas que le cadrage de #242 avait nommé pour les
        // partages et qui vaut ici pour la même raison.
        let st = state(pool.clone());
        let Json(first) = ask(State(st.clone())).await.unwrap();
        let Json(second) = ask(State(st)).await.unwrap();
        assert_ne!(first.code, second.code);

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitation_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_full_queue_refuses_and_says_so(pool: SqlitePool) {
        // Anciennes, pour que seul le PLAFOND morde et non la cadence.
        fill(&pool, WAITING_MAX, now() - 10 * HOUR_SECONDS, "waiting").await;
        let refused = ask(State(state(pool.clone()))).await;
        assert!(matches!(refused, Err(AppError::RequestsBusy)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_worked_through_queue_opens_again(pool: SqlitePool) {
        // LA FILE EST COMPTÉE SUR CE QUI ATTEND. Dépouiller rouvre la porte,
        // ce qui est le but : le plafond protège l'attention de la personne
        // qui décide, pas la place en base.
        fill(&pool, WAITING_MAX, now() - 10 * HOUR_SECONDS, "granted").await;
        assert!(ask(State(state(pool.clone()))).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_hourly_pace_holds_even_when_the_queue_is_empty(pool: SqlitePool) {
        // ET COMPTÉE SUR LES DEMANDES CRÉÉES. Sans cela, dépouiller la file
        // financerait le suivant : celles-ci sont toutes accordées, donc la
        // file est vide, et la cadence doit mordre quand même.
        fill(&pool, PER_HOUR_MAX, now() - 60, "granted").await;
        let refused = ask(State(state(pool.clone()))).await;
        assert!(matches!(refused, Err(AppError::RequestsBusy)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_pace_forgets_what_is_older_than_an_hour(pool: SqlitePool) {
        fill(&pool, PER_HOUR_MAX, now() - HOUR_SECONDS - 60, "waiting").await;
        assert!(ask(State(state(pool.clone()))).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_unknown_code_says_nothing(pool: SqlitePool) {
        let answered = look(State(state(pool)), Path("NOTACODE".into())).await;
        assert!(matches!(answered, Err(AppError::InvitationInvalid)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_waiting_request_says_waiting_and_hands_back_nothing(pool: SqlitePool) {
        let st = state(pool.clone());
        let Json(asked) = ask(State(st.clone())).await.unwrap();
        let Json(seen) = look(State(st), Path(asked.code)).await.unwrap();
        assert_eq!(seen.status, "waiting");
        assert!(seen.token.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn granting_attaches_an_invitation_and_the_code_collects_it(pool: SqlitePool) {
        // LE CHEMIN ENTIER, QUE LA PREMIÈRE VERSION NE POUVAIT PAS PARCOURIR.
        // Elle scellait le jeton avec une clé dérivée du code, que
        // l'exploitant n'a jamais : ce test-ci n'aurait pas pu s'écrire.
        let hs = whoami_hs().await;
        let st = state_with(pool.clone(), hs);
        let Json(asked) = ask(State(st.clone())).await.unwrap();

        // Mûre : le délai est une vraie garde, vérifiée par un test à part.
        sqlx::query("UPDATE invitation_requests SET ripe_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        seed_invitation(
            &pool,
            "inv-1",
            "@alice:h",
            "LEJETON",
            &st.cfg.encryption_key,
        )
        .await;

        let id: String = sqlx::query_scalar("SELECT id FROM invitation_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        let _ = grant(
            State(st.clone()),
            Path(id),
            bearer("alice"),
            crate::extract::Body(GrantRequest {
                invitation_id: "inv-1".into(),
            }),
        )
        .await
        .unwrap();

        let Json(seen) = look(State(st), Path(asked.code)).await.unwrap();
        assert_eq!(seen.status, "granted");
        assert_eq!(seen.token.as_deref(), Some("LEJETON"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nobody_attaches_somebody_else_s_invitation(pool: SqlitePool) {
        let hs = whoami_hs().await;
        let st = state_with(pool.clone(), hs);
        let _ = ask(State(st.clone())).await.unwrap();
        sqlx::query("UPDATE invitation_requests SET ripe_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        seed_invitation(
            &pool,
            "inv-1",
            "@alice:h",
            "LEJETON",
            &st.cfg.encryption_key,
        )
        .await;

        let id: String = sqlx::query_scalar("SELECT id FROM invitation_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        // MUET, comme `revoke` : « pas la vôtre » et « n'existe pas » ne se
        // distinguent pas, sinon la route dirait à qui interroge si une
        // invitation existe.
        let refused = grant(
            State(st),
            Path(id),
            bearer("mallory"),
            crate::extract::Body(GrantRequest {
                invitation_id: "inv-1".into(),
            }),
        )
        .await;
        assert!(matches!(refused, Err(AppError::InvitationInvalid)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_delay_is_a_real_guard(pool: SqlitePool) {
        // `ripe_at` n'est pas décoratif : sans cette vérification, la
        // troisième défense du ticket ne serait écrite nulle part.
        let hs = whoami_hs().await;
        let st = state_with(pool.clone(), hs);
        let _ = ask(State(st.clone())).await.unwrap();
        seed_invitation(
            &pool,
            "inv-1",
            "@alice:h",
            "LEJETON",
            &st.cfg.encryption_key,
        )
        .await;

        let id: String = sqlx::query_scalar("SELECT id FROM invitation_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        let too_soon = grant(
            State(st),
            Path(id),
            bearer("alice"),
            crate::extract::Body(GrantRequest {
                invitation_id: "inv-1".into(),
            }),
        )
        .await;
        assert!(matches!(too_soon, Err(AppError::RequestsBusy)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_granted_invitation_without_its_marker_says_nothing(pool: SqlitePool) {
        // `create` écrit `token_enc` en dernier et n'échoue pas la création
        // s'il n'y parvient pas. Une invitation dans cet état est intacte et
        // son jeton irrécupérable : il n'y a rien à rendre, et dire
        // « en attente » mentirait sur une décision qui a bien été prise.
        let hs = whoami_hs().await;
        let st = state_with(pool.clone(), hs);
        let Json(asked) = ask(State(st.clone())).await.unwrap();
        sqlx::query(
            "INSERT INTO invitations \
             (id, inviter_user_id, token_sha256, created_at, expires_at, max_uses, \
              used_count, status) VALUES ('inv-nu','@alice:h',x'00',0,4000000000,1,0,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE invitation_requests SET status='granted', invitation_id='inv-nu'")
            .execute(&pool)
            .await
            .unwrap();

        let answered = look(State(st), Path(asked.code)).await;
        assert!(matches!(answered, Err(AppError::InvitationInvalid)));
    }
}
