/**
 * The product's French copy.
 *
 * Carried over from the previous product's `fr.lproj/Localizable.strings`,
 * which is the most directly reusable asset this project has: 404 strings,
 * already translated into four other languages, already argued over.
 *
 * # The keys are the previous product's, verbatim
 *
 * Including their shape -- `core_version_label %@` really does carry its
 * placeholder in its own name. Renaming them to something prettier would
 * break the one property that makes the other four catalogues droppable
 * later without touching a screen, which is the whole point of this module.
 *
 * # What did not come across, and why
 *
 * 311 of the 404 stayed behind, in two groups.
 *
 * **The trust and entry copy is refused on purpose**: `recognition_` (64
 * strings), `ceremony_`, `arrival_`, `first_`, `promotion_`, `revocation_`,
 * `invitation_`, `inert_`. It describes a ceremony that gated nothing, and it
 * uses "reconnaissance" in the sense the glossary has since reassigned to
 * vouching -- `inert_notice` says a conversation opens "quand %@ vous aura
 * reconnue", which is now a different act with different consequences.
 * Reusing it would be worse than starting from nothing, because it would be
 * plausible and wrong.
 *
 * **The rest is simply not needed yet**: `call_`, `export_`, `legal_`,
 * `recovery_`, `discovery_`, `demo_`. Nothing is wrong with those strings.
 * They have no screen here, and copy should arrive with the screen it
 * belongs to, where somebody can read the two together.
 *
 * # Adding a language
 *
 * Convert that language's `Localizable.strings` the same way, export it
 * beside this one, and select it in `index.ts`. No screen changes, because
 * no screen holds a string.
 */
export const fr = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Version du noyau : %@',
  presence_online: 'en ligne',
  message_placeholder: 'Message',
  today: "Aujourd'hui",
  yesterday: 'Hier',
  titlebar_invite: "Inviter quelqu'un",
  titlebar_back: 'Revenir aux discussions',
  date_separator: '%1$d %2$@ %3$d',
  month_1: 'janvier',
  month_2: 'février',
  month_3: 'mars',
  month_4: 'avril',
  month_5: 'mai',
  month_6: 'juin',
  month_7: 'juillet',
  month_8: 'août',
  month_9: 'septembre',
  month_10: 'octobre',
  month_11: 'novembre',
  month_12: 'décembre',
  sunday: 'Dimanche',
  tab_discussions: 'Discussions',
  tab_communities: 'Communautés',
  tab_calls: 'Appels',
  tab_settings: 'Réglages',
  room_list_subtitle: 'Les conversations de ce compte',
  room_list_untitled: "Sans nom, et personne d'autre de connu ici",
  people_separator: ', ',
  room_list_nothing_yet: "Rien reçu depuis l'ouverture de l'application",
  room_list_empty: 'Aucune conversation connue de cet appareil pour le moment.',
  room_list_opening: 'Ouverture de la conversation…',
  titlebar_new_conversation: 'Nouvelle conversation',
  new_conversation_title: 'Nouvelle conversation',
  new_conversation_subtitle:
    "Inviter quelqu'un, ou parler à quelqu'un que vous connaissez déjà",
  new_conversation_invite_section: 'Inviter',
  new_conversation_invite_label: "Inviter quelqu'un",
  new_conversation_invite_hint: "Crée un lien d'invitation à lui transmettre.",
  new_conversation_people_section: 'Personnes',
  new_conversation_no_people:
    'Aucune personne connue de cet appareil pour le moment.',
  new_conversation_no_conversation:
    "Aucune conversation en tête-à-tête avec cette personne sur cet appareil. L'application ne sait pas encore en ouvrir une : invitez-la pour commencer.",
  person_name_action: 'Donner un nom',
  person_name_title: 'Donner un nom',
  person_name_field: 'Nom',
  person_name_local:
    "Ce nom reste sur cet appareil. Il n'est jamais envoyé au serveur, et vous ne le retrouverez pas sur un autre appareil.",
  person_name_save: 'Enregistrer',
  person_name_remove: 'Retirer ce nom',
  reserved_calls_promise:
    "Les appels audio se font depuis chaque conversation en tête-à-tête. Le journal des appels n'est pas encore construit.",
  reserved_generic_promise: "Cet écran n'est pas encore construit.",
  titlebar_call: 'Appeler',
  settings_subtitle: 'Confidentialité, récupération, supervision',
  settings_row_chevron: '›',
  settings_section_account_title: 'Compte et appareil',
  settings_section_account_note:
    'Ce qui vous identifie, ce qui vous permet de revenir.',
  settings_row_lang_label: "Langue de l'application",
  settings_row_lang_hint:
    'Français · six langues, choisies au premier lancement',
  settings_row_recovery_label: 'Récupération de compte',
  settings_row_recovery_hint:
    "Clé de récupération · validation par un proche, coffre PIN (V1.1) · aucun séquestre : personne d'autre ne détient la clé de vos messages",
  settings_row_minor_label: "Compte d'un mineur",
  settings_row_minor_hint:
    "Estimation d'âge, représentant légal, information DSA",
  settings_section_privacy_title: 'Confidentialité',
  settings_section_privacy_note:
    'Par défaut, rien ne sort et personne ne vous trouve.',
  settings_row_chat_label: 'Confidentialité des groupes',
  settings_row_chat_hint: 'Aucun identifiant visible · transferts limités',
  settings_row_ephemeral_label: 'Messages éphémères',
  settings_row_ephemeral_hint:
    'Réglage par conversation · 24 heures par défaut en mode ado',
  settings_row_discovery_label: 'Découverte privée de contacts',
  settings_row_discovery_hint:
    'V1.1 · locale, optionnelle · réciprocité non tranchée',
  settings_section_moderation_title: 'Groupes et modération',
  settings_section_moderation_note:
    'Outils pensés pour un bénévole, pas pour un administrateur système.',
  settings_row_govern_label: 'Gouvernance et rôles',
  settings_row_govern_hint:
    "Rôles, quota d'invitation, révocation d'une branche",
  settings_row_report_label: 'Signaler, bloquer, quitter',
  settings_row_report_hint:
    'Motif, pièces jointes, accusé de réception · vue modérateur',
  settings_row_teen_label: 'Mode ado et supervision',
  settings_row_teen_hint: 'Réglages restrictifs par défaut',
  settings_row_legal_label: 'Informations légales',
  settings_row_legal_hint:
    'Ce qui est interdit, comment la modération décide, comment contester',
  settings_section_sharing_title: 'Partage et données',
  settings_section_sharing_note:
    'Vos conversations restent des fichiers que vous pouvez emporter.',
  settings_row_share_label: 'Partage depuis une autre application',
  settings_row_share_hint:
    'Feuille système iOS et Android · envoi sans ouvrir Messagr',
  settings_row_export_label: 'Exporter mes conversations',
  settings_row_export_hint: 'Format ouvert et documenté, sans support',
  settings_section_automation_title: 'Automatisations',
  settings_section_automation_note:
    'Place réservée dans le produit, hors périmètre livré en V1.',
  settings_row_bot_label: 'Bots du groupe',
  settings_row_bot_hint: 'Moteur affiché · retirable par tout administrateur',
  settings_row_api_label: "Jetons d'API et applications",
  settings_row_api_hint: 'Droits limités · révocable à tout moment',
  settings_row_not_yet: 'Pas encore',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Français',

  // WRITTEN HERE, NOT CARRIED OVER.
  //
  // The previous product's conversation copy came with its trust wording
  // attached, and that wording is refused above: it describes a ceremony
  // which gated nothing and uses "reconnaissance" in the sense the glossary
  // reassigned to vouching. These few lines are what a conversation needs and
  // are new, so they say what is true now rather than what was true then.
  //
  // `conversation_sender_claimed` is the one that matters. Decrypting an
  // event proves which key wrote it and nothing about who holds that key, so
  // the screen says the sender is announced rather than known. It avoids
  // "vérifier" on purpose: verification is a real act in this product, it has
  // not happened here, and borrowing its word would be the first place the
  // interface starts lying about its own trust model.
  'conversation_sender_claimed %@': 'Se présente comme %@',
  conversation_send: 'Envoyer',
  conversation_empty: 'Rien n’a encore été dit ici.',
  conversation_unreadable:
    'Message illisible sur cet appareil : sa clé n’est pas arrivée.',
  conversation_sending: 'Envoi…',
  conversation_send_failed: 'Non envoyé. Réessayez.',

  // Vouching. The key prefix is `vouch_` rather than `promotion_`, which the
  // copy spec refuses: `promotion` was the previous product's word for a
  // ceremony that gated nothing. What happens here is a person saying they
  // answer for another person, and the promotion is its consequence rather
  // than its name.
  //
  // **No string here counts anything.** `buildHistoryBundle` reports how many
  // Megolm sessions a bundle carries, and that number exists so the
  // application can tell "there is a past to hand over" from "there is not".
  // It is not a count of messages and does not correspond to anything a
  // person could check, so putting it on screen would be precision about a
  // quantity nobody can interpret. The screen says what is handed over
  // instead, which is the thing that is actually true: everything.
  //
  // "Vérifier" appears nowhere, for the reason `conversation_sender_claimed`
  // states: verification is a real act in this product and this is not it.
  vouch_action: 'Je réponds de cette personne',
  vouch_hint:
    'À faire quand vous êtes sûr de savoir qui vous écrit — pas avant.',
  vouch_explain_title: 'Ce que cela fait',
  vouch_explain_history:
    'Elle pourra lire tout ce qui a été dit ici depuis le début, y compris avant son arrivée.',
  vouch_explain_history_empty:
    'Rien n’a encore été dit ici, donc il n’y a pas de passé à lui transmettre.',
  vouch_explain_invite: 'Elle pourra inviter d’autres personnes.',
  vouch_explain_final:
    'Cela ne s’annule pas : les clés qu’elle reçoit, elle les garde.',
  vouch_confirm: 'Oui, je réponds de cette personne',
  vouch_cancel: 'Annuler',
  vouch_working: 'En cours…',
  vouch_done: 'C’est fait. Elle a l’historique et peut inviter.',
  vouch_done_no_history:
    'C’est fait. Elle peut inviter ; il n’y avait pas de passé à transmettre.',
  vouch_failed_nothing_changed:
    'Cela n’a pas abouti, et rien n’a changé pour elle. Vous pouvez réessayer.',
  vouch_history_arrived:
    'Quelqu’un a répondu de vous : le passé de cette conversation vous est désormais lisible.',
  vouch_history_untrusted:
    'Un passé vous a été proposé, depuis un appareil que celui-ci ne sait pas rattacher à son propriétaire. Il n’a pas été repris.',

  // Eviction. `evict_` and not `revocation_`, which the copy spec refuses:
  // that was the previous product's word for something else. What happens
  // here is a person being put out of a conversation, and the key rotation
  // that decides whether it means anything.
  //
  // **The third line is the one the ticket requires**, and it is the one a
  // product is tempted to leave off. Removing somebody bounds the future and
  // cannot touch the past: every message already delivered to their device,
  // and every key that opened it, is theirs now and stays theirs. Saying it
  // where the gesture is offered, rather than in a help page, is the
  // difference between a person choosing this and a person discovering it.
  evict_action: 'Retirer cette personne',
  evict_hint: 'Elle ne pourra plus rien lire de ce qui sera dit ici ensuite.',
  evict_explain_title: 'Ce que cela fait',
  evict_explain_future:
    'Elle sortira de la conversation et ne pourra plus lire ce qui s’y dira.',
  evict_explain_past:
    'Ce qu’elle a déjà lu, elle le garde. Rien ne peut le lui reprendre — ni cette application, ni le serveur.',
  evict_explain_final:
    'Cela ne s’annule pas : pour la faire revenir, il faudra une nouvelle invitation.',
  evict_confirm: 'Oui, retirer cette personne',
  evict_cancel: 'Annuler',
  evict_working: 'En cours…',
  evict_done: 'C’est fait. La clé a été remplacée.',
  // Said apart, because it is a different fact and not a lesser success:
  // this device had never encrypted here, so no key of its own was out there.
  evict_done_no_key:
    'C’est fait. Il n’y avait aucune clé de cet appareil à remplacer.',
  evict_failed_nothing_changed:
    'Cela n’a pas abouti, et rien n’a changé. Vous pouvez réessayer.',
  // The half-state, and the only one worth a different sentence: she is out
  // and still holds a working key. A person told merely "cela n'a pas abouti"
  // would reasonably stop, which is exactly the wrong thing to do here.
  evict_failed_key_still_valid:
    'Elle est sortie, mais la clé n’a pas pu être remplacée : elle peut encore lire ce qui sera dit. Réessayez.',

  // THE PROMISE, shown once and before anything is asked of anybody.
  //
  // Verbatim from the prototype's §1, which is the only brand screen of the
  // whole journey. These words are the design rather than a caption for it,
  // so they are copied rather than rewritten -- and the four points are the
  // product's claims, each one falsifiable, which is why none of them is a
  // slogan.
  promise_thesis: 'La messagerie qui ne vous demande rien.',
  promise_subtitle:
    'Pas de numéro, pas de compte, pas de mot de passe. Quelqu’un vous invite, vous écrivez.',
  promise_point_encrypted: 'Chiffrée de bout en bout, sans réglage',
  promise_point_no_harvest: 'Aucun carnet d’adresses aspiré, aucune publicité',
  promise_point_agents: 'Les agents y sont des participants déclarés',
  promise_point_invitation: 'Vous entrez par invitation, pas par formulaire',
  promise_action: 'Commencer',

  // THE LIST OF CONVERSATIONS.
  //
  // Degraded states in natural language, never an error code and never the
  // word "federation" -- §13.19 invariant 6. What went wrong technically goes
  // to the log; a row says what it means for the person reading it.
  list_title: 'Conversations',
  list_empty:
    'Aucune conversation pour l’instant. Invitez quelqu’un pour en commencer une.',
  list_nothing_said: 'Rien n’a encore été dit',
  list_unreadable: 'Cet appareil ne peut pas lire le dernier message',
  list_unreachable: 'Cette conversation n’a pas pu être relue',
  list_name_action: 'Donner un nom',
  list_name_title: 'Comment appelez-vous cette personne ?',
  list_name_hint:
    'Ce nom reste sur cet appareil. Ni le serveur ni votre correspondant ne le voient.',
  list_name_placeholder: 'Un prénom, un surnom',
  list_name_confirm: 'Enregistrer',
  list_name_cancel: 'Annuler',
  list_back: 'Conversations',

  // INVITER, qui est le même geste que commencer une conversation.
  //
  // Le nom se donne avant que le compte existe : le service tire un compte au
  // moment où la personne ouvre le lien, donc ce que l'inviteur tape est mis
  // de côté et écrit quand on sait à qui il s'applique.
  invite_action: 'Inviter quelqu’un',
  invite_who: 'Qui invitez-vous ?',
  invite_working: 'Création de la conversation…',
  invite_ready:
    'Envoyez ce lien à cette personne. Il est valable une heure et ne sert qu’une fois.',
  invite_share: 'Partager le lien',
  invite_close: 'Fermer',
  invite_failed: 'L’invitation n’a pas pu être créée.',
  invite_waiting: 'Personne n’a encore ouvert le lien.',
  invite_admitted: 'C’est fait : cette personne peut entrer.',
  list_name_not_kept:
    'Le nom n’a pas pu être conservé : il sera oublié au prochain démarrage.',

  // LES RÉGLAGES, et dedans l'écran que les conditions publiées promettent.
  //
  // Ce n'est pas une décoration. Les CGU publiées sur messagr.eu disent que
  // « les trois points exigés par l'article 14 sont portés par l'écran
  // "Informations légales", atteignable depuis les Réglages ». Ou l'écran
  // existe, ou la page est fausse — et ces textes ont déjà eu à corriger une
  // fausse affirmation sur la rétention, ce qui est toute la raison d'être de
  // scripts/assert-retention.sh.
  //
  // Le rapprochement des deux n'est pas laissé à la bonne foi :
  // scripts/assert-legal-screen.sh va chercher la page en ligne et vérifie
  // que ce qu'elle engage se retrouve ici.
  settings_action: 'Réglages',
  settings_title: 'Réglages',
  settings_legal: 'Informations légales',
  settings_nothing_else:
    'Il n’y a rien d’autre ici pour l’instant. Les réglages que cette version ne porte pas encore sont absents plutôt que présents et inertes.',

  legal_title: 'Informations légales',
  legal_intro:
    'Ce que cette application affiche fait foi. Les conditions publiées sur messagr.eu reprennent ce qui suit et ajoutent ce qu’un écran ne peut pas porter : qui exploite le service, et sous quel droit.',

  legal_forbidden_title: 'Ce qui est interdit',
  legal_forbidden_body:
    'Les contenus pédocriminels, les menaces contre la vie ou la sécurité d’une personne, le harcèlement, l’usurpation d’identité, et tout autre contenu illégal au regard du droit français ou européen.',
  legal_forbidden_entry:
    'On n’entre que sur invitation nominative. Une invitation est personnelle, à usage limité, et elle ne se revend pas. L’âge minimum est de quinze ans.',

  legal_moderation_title: 'Comment la modération fonctionne réellement',
  legal_moderation_human:
    'La modération est celle des administrateurs du serveur. Ce sont des personnes. Toute décision est prise par une personne, jamais par un automatisme.',
  legal_moderation_no_tools:
    'Il n’existe aucun outil automatique de détection, aucun filtre, aucune analyse de contenu, et il ne peut pas en exister : le contenu est chiffré de bout en bout et l’exploitant détient des messages qu’il lui est cryptographiquement impossible de lire.',
  legal_moderation_reported:
    'Rien n’est examiné qui n’ait été signalé par une personne. Il n’y a ni surveillance générale, ni détection proactive, ni classement algorithmique.',
  legal_moderation_can:
    'Ce que l’exploitant peut décider sans lire : suspendre un compte, lui retirer sa capacité d’émettre des invitations, l’exclure d’un groupe, révoquer une branche d’invitation.',
  legal_moderation_cannot:
    'Ce qu’il ne peut pas faire : retirer un message précis, qualifier un contenu, établir qu’une règle a été enfreinte par la lecture.',

  legal_report_title: 'Signaler, et ce qui suit',
  legal_report_how:
    'Le signalement se fait par courriel à conformite@messagr.eu. Le geste depuis l’application n’existe pas encore, et le dire vaut mieux que le promettre.',
  legal_report_delay:
    'Un signalement produit une référence. Il reçoit un accusé de réception, puis une décision motivée au plus tard trente jours après sa réception, avec la voie pour la contester. Le signalement d’une menace pour la vie ou la sécurité aux autorités ne suit pas ce délai : il part sans attendre.',
  legal_report_review:
    'Une décision peut être contestée auprès de conformite@messagr.eu, en citant la référence. Elle est réexaminée par une personne autre que celle qui l’a prise chaque fois que l’organisation le permet. Sur un service exploité par une ou deux personnes, cette condition ne peut pas toujours être tenue, et l’écrire vaut mieux que de promettre une séparation qui n’existerait pas.',
  legal_report_scope:
    'Messagr est un service d’hébergement et non une plateforme en ligne, le considérant 14 du DSA écartant les services de messagerie interpersonnelle. Les articles 20 et 21 ne s’appliquent donc pas, et ce texte ne prétend pas les offrir.',

  legal_full_terms: 'Conditions générales complètes : messagr.eu',

  // LA CONFIANCE, EXPLIQUÉE PLUTÔT QUE SIGNALÉE.
  //
  // Le prototype (§4.4) est catégorique sur deux choses. Un écran dédié, pas
  // une pastille que personne ne sait interpréter. Et aucun ton alarmiste :
  // l'état de départ est normal, le chiffrement est déjà là, ce qui manque
  // c'est la certitude sur la personne.
  //
  // Le mot que tout le monde attend ici est interdit par copy.spec.ts, et à
  // raison : répondre de quelqu'un est un jugement humain, l'autre acte est
  // cryptographique, et un écran qui emprunterait le même mot dirait à
  // quelqu'un qu'il a fait l'un quand il a fait l'autre. Ce texte décrit donc
  // des gestes -- comparer des mots, scanner un code -- au lieu de les
  // nommer. C'est plus long et c'est plus vrai.
  trust_action: 'Ce que l’on sait de cette personne',
  trust_title: 'Ce que l’on sait de cette personne',
  trust_calm:
    'Ce n’est pas une alerte. Vos messages sont chiffrés de bout en bout depuis le premier, et cela ne dépend de rien de ce qui suit. Ce qui suit parle de la certitude sur la personne, pas du chiffrement.',

  trust_state_nothing: 'Rien n’établit encore qui est cette personne.',
  trust_state_vouched:
    'Quelqu’un qui était déjà là a répondu de cette personne.',
  trust_state_confirmed:
    'Un de ses appareils a été confirmé depuis cet appareil-ci, en personne.',

  trust_devices_title: 'Ses appareils',
  'trust_devices %d': '%d appareil(s) connu(s) de ce compte.',
  'trust_claimed %d':
    'Cette personne a signé %d d’entre eux comme étant les siens. C’est ce que son compte affirme, et cela ne dit pas qui tient ce compte.',
  'trust_confirmed %d': '%d ont été confirmés depuis ici, en personne.',
  trust_none_confirmed:
    'Aucun n’a été confirmé depuis ici. C’est l’état de départ normal.',

  trust_vouch_title: 'Ce que « répondre de quelqu’un » établit',
  trust_vouch_means:
    'Une personne déjà présente a estimé savoir qui entrait, et lui a ouvert la porte. C’est un jugement humain, et c’est tout : rien n’a été établi par la cryptographie. Un compte peut être tenu par quelqu’un d’autre sans que ce jugement en sache rien.',

  trust_raise_title: 'Ce qui lèverait le doute',
  trust_raise_how:
    'Comparer une courte suite de mots avec cette personne, de vive voix, ou scanner son code en sa présence. Deux minutes, une fois pour toutes.',
  trust_raise_missing:
    'Ce geste n’est pas encore construit dans cette application. Le dire vaut mieux que d’afficher un bouton qui ne ferait rien.',

  // Une réaction. Le geste est une pression longue : une pression simple sur
  // un message, c'''est ce qu'''on fait pour le lire, et voler ce geste pour
  // ouvrir un menu, c'''est une conversation qui ne défile plus.
  reaction_offer: 'Réagir à ce message',

  // ENVOYÉ, LU — et pas de « remis ».
  //
  // Matrix ne donne pas trois états mais deux : le serveur accepte
  // l'événement, et un client dit qu'il a été lu. Rien entre les deux. Une
  // coche qui voudrait dire « sans doute arrivé » serait une supposition
  // dessinée comme un fait, et la seule chose pire que d'ignorer si un
  // message est arrivé, c'est de s'entendre dire qu'il l'est quand personne
  // ne le sait.
  message_sent: 'Envoyé',
  message_read: 'Lu',

  // Le réglage. Un accusé de lecture est une métadonnée publique : qui a lu
  // quoi, et quand, lisible par le serveur.
  settings_receipts: 'Accusés de lecture',
  settings_receipts_hint:
    'Désactivés. Un accusé de lecture est public : le serveur apprend qui a lu quoi, et à quelle heure. Les activer prévient votre correspondant que vous avez lu — et le serveur en même temps.',
  settings_receipts_on: 'Activés',
  settings_receipts_off: 'Désactivés',
  settings_receipts_not_kept:
    'Ce choix n’a pas pu être conservé : il reviendra à son état précédent au prochain démarrage.',

  // LA BARRE D'ONGLETS. Quatre, et le troisième est réservé.
  //
  // L'onglet Appels existe dès la V1 alors que les appels n'y sont pas, et sa
  // maquette dit pourquoi : « pour ne pas déplacer la barre plus tard ». Ce
  // n'est pas la règle de settings_nothing_else -- un interrupteur qui ne
  // commande rien ment sur une capacité, un onglet réservé qui explique qu'il
  // l'est est une promesse datée, et il achète une barre qui ne bouge pas
  // sous le pouce des gens le jour où les appels arrivent.
  // Les quatre libellés existaient déjà, hérités du produit précédent et
  // identiques à ceux de la maquette : tab_discussions, tab_communities,
  // tab_calls, tab_settings. Rien à ajouter ici.

  // La phrase qui explique le produit sous la liste. Sans le « (§8.2, P2,
  // P3) » de la maquette : les repères de spécification s'adressent au
  // relecteur, pas à la personne qui lit son écran.
  // Les jours abrégés, pour l'horodatage d'une ligne de liste. Le catalogue
  // hérité ne portait que « Dimanche » en toutes lettres, par accident : une
  // ligne a la place de cinq caractères, pas de huit.
  day_short_0: 'dim.',
  day_short_1: 'lun.',
  day_short_2: 'mar.',
  day_short_3: 'mer.',
  day_short_4: 'jeu.',
  day_short_5: 'ven.',
  day_short_6: 'sam.',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d/%2$d',

  list_no_directory:
    'Aucun numéro de téléphone n’apparaît nulle part dans le système. On n’entre en relation que par invitation.',

  calls_soon_title: 'Bientôt : appels audio, puis vidéo',
  calls_soon_why:
    'L’onglet est réservé dès la V1 pour ne pas déplacer la barre plus tard. La V1 ne transporte que texte, liens et images statiques ; vocaux en V2, appels individuels puis de groupe en V3.',
  calls_soon_v2: 'V2 · messages vocaux',
  calls_soon_v3: 'V3 · audio + vidéo',

  community_soon_title: 'Bientôt : communautés et salons',
  community_soon_why:
    'Une communauté regroupe des salons sous un objet pseudonyme. L’onglet est réservé pour la même raison que celui des appels : la barre ne doit pas bouger quand ils arriveront.',

  // The band across the top of every screen. `brand_name` is the product's
  // own name and is not translated -- a name that changes by language is a
  // different product.
  brand_name: 'Messagr',

  // Le premier lancement : la langue, puis l'acceptation.
  promise_language: 'Choisissez votre langue',
  promise_terms: 'J’accepte les conditions générales d’utilisation de Messagr.',
  promise_terms_link: 'Lire les conditions',
  promise_terms_required:
    'Cochez la case pour continuer. Rien ne démarre avant.',

  // Notifications. The blind one is what a wake can say before anything is
  // decrypted: something arrived. It names nobody, because nothing naming
  // anybody crossed the push infrastructure.
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Quelque chose est arrivé.',
  notify_channel: 'Messages',

  // Photographs. `image_alt` is what a screen reader says: not a description
  // of the picture, which nothing here can produce, but what the thing is.
  image_alt: 'Photo',
  image_unreadable: 'Cette photo n’a pas pu être ouverte sur cet appareil.',
  conversation_attach: 'Envoyer une photo',
  conversation_attaching: 'Chiffrement et envoi de la photo…',
  header_no_directory: 'aucun annuaire',

  // The list's own furniture. The badge itself draws a bare number, which
  // needs no translation; what needs one is what a screen reader says about
  // it, since "3" alone tells somebody nothing.
  'list_unread %1$d': '%1$d messages non lus',
  invite_open: 'Inviter quelqu’un',
} as const

/** Every key any screen may ask for. A typo is a compile error, not a blank. */
export type CopyKey = keyof typeof fr
