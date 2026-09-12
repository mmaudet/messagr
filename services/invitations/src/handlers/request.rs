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
//! # LE JETON ACCORDÉ EST SCELLÉ PAR UNE CLÉ QUE LE SERVICE N'A PAS
//!
//! `create` rend le jeton d'invitation une fois et n'en garde que
//! l'empreinte. Ici il faut le rendre plus tard, à quelqu'un qui revient :
//! il doit donc être gardé. Le garder en clair ferait de cette table un
//! trousseau d'invitations utilisables.
//!
//! Il est donc scellé avec une clé **dérivée du code**, que seule la personne
//! détient. La base contient `SHA-256(code)` pour retrouver la ligne et
//! `seal(SHA-256(code ‖ domaine), jeton)` pour le rendre : deux dérivations à
//! sens unique du même secret, et aucune des deux ne donne l'autre. Un vol de
//! la base ne rend aucune invitation.
//!
//! C'est plus que ce que `reserved_accounts` fait de ses secrets — ceux-là
//! sont scellés par la clé du service, parce que le service doit s'en servir
//! seul. Ici il n'a pas à s'en servir, donc il n'a pas à pouvoir.
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
use sha2::{Digest, Sha256};
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

/// Le domaine de dérivation, pour que la clé ne soit jamais l'empreinte.
///
/// Sans ce suffixe, `SHA-256(code)` servirait à la fois d'index en base et de
/// clé de scellement : qui lit la base lirait la clé. Un octet de séparation
/// suffit à ce que l'un ne donne pas l'autre, et le nommer ici évite qu'on le
/// « simplifie » un jour.
const SEAL_DOMAIN: &str = "messagr/invitation-request/seal/v1";

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

fn seal_key(code: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(code.as_bytes());
    hasher.update(SEAL_DOMAIN.as_bytes());
    hasher.finalize().into()
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
    let row = sqlx::query(
        "SELECT status, invitation_token_enc FROM invitation_requests WHERE code_sha256 = ?",
    )
    .bind(crypto::token_hash(&code))
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;

    let status: String = row.get("status");
    let sealed: Option<Vec<u8>> = row.get("invitation_token_enc");

    // OUVERT AVEC LA CLÉ DU CODE PRÉSENTÉ, et pas avec celle du service : ce
    // sceau n'a jamais eu de clé que le service détienne. Un échec ici ne peut
    // donc pas être une panne de configuration ; c'est un code qui ne
    // correspond pas, ce qui répond comme un code inconnu.
    let token = match (status.as_str(), sealed) {
        ("granted", Some(sealed)) => {
            Some(crypto::open(&seal_key(&code), &sealed).map_err(|_| AppError::InvitationInvalid)?)
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    fn state(pool: SqlitePool) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: "http://127.0.0.1:1".into(),
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
    async fn a_granted_request_hands_back_the_token_to_that_code_alone(pool: SqlitePool) {
        let st = state(pool.clone());
        let Json(asked) = ask(State(st.clone())).await.unwrap();

        let token = "THETOKEN";
        sqlx::query(
            "UPDATE invitation_requests SET status='granted', invitation_token_enc=? \
             WHERE code_sha256 = ?",
        )
        .bind(crypto::seal(&seal_key(&asked.code), token).unwrap())
        .bind(crypto::token_hash(&asked.code))
        .execute(&pool)
        .await
        .unwrap();

        let Json(seen) = look(State(st), Path(asked.code)).await.unwrap();
        assert_eq!(seen.status, "granted");
        assert_eq!(seen.token.as_deref(), Some(token));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_service_key_does_not_open_the_seal(pool: SqlitePool) {
        // LA PROPRIÉTÉ QUI JUSTIFIE TOUT CE MÉCANISME. Le sceau est fermé par
        // une clé dérivée du code ; la clé de chiffrement du service -- celle
        // qui ouvre `reserved_accounts` -- ne l'ouvre pas. Un vol de la base
        // ET de la configuration ne rend toujours aucune invitation.
        let st = state(pool.clone());
        let Json(asked) = ask(State(st)).await.unwrap();
        let sealed = crypto::seal(&seal_key(&asked.code), "THETOKEN").unwrap();

        assert!(crypto::open(&[0u8; 32], &sealed).is_err());
        assert!(crypto::open(&seal_key("ANOTHERCODE"), &sealed).is_err());
        assert_eq!(
            crypto::open(&seal_key(&asked.code), &sealed).unwrap(),
            "THETOKEN"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_seal_key_is_not_the_index(pool: SqlitePool) {
        // Qui lit la base lit `SHA-256(code)`. Si c'était aussi la clé, la
        // base se déchiffrerait elle-même. Le domaine de dérivation est ce
        // qui l'empêche, et rien d'autre ne le dirait.
        let _ = pool;
        let code = "SOMECODE";
        assert_ne!(seal_key(code).to_vec(), crypto::token_hash(code));
    }
}
