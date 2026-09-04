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
} as const

/** Every key any screen may ask for. A typo is a compile error, not a blank. */
export type CopyKey = keyof typeof fr
