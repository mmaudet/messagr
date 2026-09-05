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
    'Français · deux langues livrées en V1, cinq possibles',
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
  list_name_not_kept:
    'Le nom n’a pas pu être conservé : il sera oublié au prochain démarrage.',
} as const

/** Every key any screen may ask for. A typo is a compile error, not a blank. */
export type CopyKey = keyof typeof fr
