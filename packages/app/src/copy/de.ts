import type { CopyKey } from './fr'

/**
 * The product’s German copy.
 *
 * Translated from the French, which is the authoritative version — several
 * strings are arguments rather than labels, and they are translated as
 * arguments: the same claim, made as plainly in German as it is in French.
 *
 * The two legal strings (`legal_report_delay`, `legal_report_scope`) name a
 * deadline the operator is bound by and an article of a European regulation.
 * They want a lawyer’s eye before the store listing goes out; see `en.ts`,
 * which says the same and for the same reason.
 *
 * `Sie` throughout. A messenger addressing somebody it has never met, about
 * what a server can and cannot read, is not the place for `du` — and the
 * French uses `vous`.
 */
export const de: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Kernversion: %@',
  presence_online: 'online',
  message_placeholder: 'Nachricht',
  today: 'Heute',
  yesterday: 'Gestern',
  titlebar_invite: 'Jemanden einladen',
  titlebar_back: 'Zurück zu den Unterhaltungen',
  date_separator: '%1$d. %2$@ %3$d',
  month_1: 'Januar',
  month_2: 'Februar',
  month_3: 'März',
  month_4: 'April',
  month_5: 'Mai',
  month_6: 'Juni',
  month_7: 'Juli',
  month_8: 'August',
  month_9: 'September',
  month_10: 'Oktober',
  month_11: 'November',
  month_12: 'Dezember',
  sunday: 'Sonntag',
  tab_discussions: 'Chats',
  tab_communities: 'Communitys',
  tab_calls: 'Anrufe',
  tab_settings: 'Einstellungen',
  room_list_subtitle: 'Die Unterhaltungen dieses Kontos',
  room_list_untitled: 'Ohne Namen, und niemand sonst hier bekannt',
  people_separator: ', ',
  room_list_nothing_yet: 'Seit dem Öffnen der App nichts empfangen',
  room_list_empty: 'Diesem Gerät ist noch keine Unterhaltung bekannt.',
  room_list_opening: 'Unterhaltung wird geöffnet …',
  titlebar_new_conversation: 'Neue Unterhaltung',
  new_conversation_title: 'Neue Unterhaltung',
  new_conversation_subtitle:
    'Jemanden einladen oder mit jemandem sprechen, den Sie schon kennen',
  new_conversation_invite_section: 'Einladen',
  new_conversation_invite_label: 'Jemanden einladen',
  new_conversation_invite_hint:
    'Erstellt einen Einladungslink zum Weitergeben.',
  new_conversation_people_section: 'Personen',
  new_conversation_no_people: 'Diesem Gerät ist noch niemand bekannt.',
  new_conversation_no_conversation:
    'Auf diesem Gerät gibt es keine Einzelunterhaltung mit dieser Person. Die App kann noch keine öffnen: laden Sie sie ein, um zu beginnen.',
  person_name_action: 'Namen vergeben',
  person_name_title: 'Namen vergeben',
  person_name_field: 'Name',
  person_name_local:
    'Dieser Name bleibt auf diesem Gerät. Er wird nie an den Server gesendet, und auf einem anderen Gerät finden Sie ihn nicht wieder.',
  person_name_save: 'Speichern',
  person_name_remove: 'Diesen Namen entfernen',
  reserved_calls_promise:
    'Audioanrufe werden aus jeder Einzelunterhaltung heraus geführt. Die Anrufliste ist noch nicht gebaut.',
  reserved_generic_promise: 'Dieser Bildschirm ist noch nicht gebaut.',
  titlebar_call: 'Anrufen',
  settings_subtitle: 'Vertraulichkeit, Wiederherstellung, Aufsicht',
  settings_row_chevron: '›',
  settings_section_account_title: 'Konto und Gerät',
  settings_section_account_note:
    'Was Sie ausweist, und was Sie zurückkehren lässt.',
  settings_row_lang_label: 'Sprache der App',
  settings_row_lang_hint: 'Deutsch · sechs Sprachen, beim ersten Start gewählt',
  settings_row_recovery_label: 'Kontowiederherstellung',
  settings_row_recovery_hint:
    'Wiederherstellungsschlüssel · Bestätigung durch eine nahestehende Person, PIN-Tresor (V1.1) · keine Hinterlegung: niemand sonst hält den Schlüssel zu Ihren Nachrichten',
  settings_row_minor_label: 'Konto einer minderjährigen Person',
  settings_row_minor_hint:
    'Altersschätzung, gesetzliche Vertretung, DSA-Information',
  settings_section_privacy_title: 'Vertraulichkeit',
  settings_section_privacy_note:
    'Standardmäßig geht nichts hinaus, und niemand findet Sie.',
  settings_row_chat_label: 'Vertraulichkeit in Gruppen',
  settings_row_chat_hint:
    'Keine sichtbaren Kennungen · begrenztes Weiterleiten',
  settings_row_ephemeral_label: 'Verschwindende Nachrichten',
  settings_row_ephemeral_hint:
    'Einstellung je Unterhaltung · im Jugendmodus 24 Stunden voreingestellt',
  settings_row_discovery_label: 'Private Kontaktsuche',
  settings_row_discovery_hint:
    'V1.1 · lokal, optional · Gegenseitigkeit nicht entschieden',
  settings_section_moderation_title: 'Gruppen und Moderation',
  settings_section_moderation_note:
    'Werkzeuge für Freiwillige, nicht für Systemadministratoren.',
  settings_row_govern_label: 'Verwaltung und Rollen',
  settings_row_govern_hint:
    'Rollen, Einladungskontingent, Widerruf eines Zweigs',
  settings_row_report_label: 'Melden, blockieren, verlassen',
  settings_row_report_hint:
    'Grund, Anhänge, Empfangsbestätigung · Moderationsansicht',
  settings_row_teen_label: 'Jugendmodus und Aufsicht',
  settings_row_teen_hint: 'Standardmäßig restriktive Einstellungen',
  settings_row_legal_label: 'Rechtliche Hinweise',
  settings_row_legal_hint:
    'Was verboten ist, wie die Moderation entscheidet, wie man widerspricht',
  settings_section_sharing_title: 'Teilen und Daten',
  settings_section_sharing_note:
    'Ihre Unterhaltungen bleiben Dateien, die Sie mitnehmen können.',
  settings_row_share_label: 'Teilen aus einer anderen App',
  settings_row_share_hint:
    'System-Teilen-Dialog unter iOS und Android · senden, ohne Messagr zu öffnen',
  settings_row_export_label: 'Meine Unterhaltungen exportieren',
  settings_row_export_hint: 'Offenes, dokumentiertes Format, ohne Support',
  settings_section_automation_title: 'Automatisierungen',
  settings_section_automation_note:
    'Im Produkt vorgesehen, außerhalb des Lieferumfangs von V1.',
  settings_row_bot_label: 'Bots der Gruppe',
  settings_row_bot_hint:
    'Engine wird angezeigt · von jeder Administration entfernbar',
  settings_row_api_label: 'API-Token und Anwendungen',
  settings_row_api_hint: 'Begrenzte Rechte · jederzeit widerrufbar',
  settings_row_not_yet: 'Noch nicht',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Deutsch',
  language_choose: 'Sprache wählen',
  language_close: 'Schließen',

  emoji_title: 'Reagieren',
  emoji_close: 'Schließen',
  emoji_more: 'Mehr Emojis',
  emoji_group_faces: 'Gesichter',
  emoji_group_gestures: 'Gesten',
  emoji_group_hearts: 'Herzen',
  emoji_group_people: 'Menschen',
  emoji_group_nature: 'Natur',
  emoji_group_food: 'Essen',
  emoji_group_activity: 'Aktivitäten',
  emoji_group_things: 'Objekte',
  'conversation_sender_claimed %@': 'Gibt sich aus als %@',
  conversation_send: 'Senden',
  conversation_empty: 'Hier wurde noch nichts gesagt.',
  conversation_unreadable:
    'Auf diesem Gerät nicht lesbar: der Schlüssel ist nie angekommen.',
  conversation_removed: 'Nachricht gelöscht',

  'selection_count %1$d': '%1$d ausgewählt',
  selection_clear: 'Auswahl verlassen',
  selection_copy: 'Kopieren',
  selection_forward: 'Weiterleiten',
  selection_remove: 'Löschen',
  'remove_title %1$d': '%1$d Nachricht(en) löschen?',
  remove_everyone: 'Für alle löschen',
  remove_everyone_why:
    'Die Nachricht verschwindet auch bei Ihrem Gegenüber. An ihrer Stelle bleibt eine Zeile: eine Entfernung ist sichtbar.',
  remove_me: 'Für mich löschen',
  remove_me_why:
    'Die Nachricht bleibt bei Ihrem Gegenüber. Auf diesem Telefon wird sie nicht mehr angezeigt — auf einem anderen Gerät oder nach einer Neuinstallation kommt sie zurück.',
  remove_cancel: 'Abbrechen',
  conversation_sending: 'Wird gesendet …',
  conversation_send_failed: 'Nicht gesendet. Versuchen Sie es erneut.',
  vouch_action: 'Ich stehe für diese Person ein',
  vouch_hint:
    'Zu tun, wenn Sie sicher wissen, wer Ihnen schreibt — nicht vorher.',
  vouch_explain_title: 'Was das bewirkt',
  vouch_explain_history:
    'Sie wird alles lesen können, was hier von Anfang an gesagt wurde, auch vor ihrer Ankunft.',
  vouch_explain_history_empty:
    'Hier wurde noch nichts gesagt, es gibt also keine Vergangenheit weiterzugeben.',
  vouch_explain_invite: 'Sie wird andere Personen einladen können.',
  vouch_explain_final:
    'Das lässt sich nicht rückgängig machen: die Schlüssel, die sie erhält, behält sie.',
  vouch_confirm: 'Ja, ich stehe für diese Person ein',
  vouch_cancel: 'Abbrechen',
  vouch_working: 'Läuft …',
  vouch_done: 'Erledigt. Sie hat den Verlauf und kann einladen.',
  vouch_done_no_history:
    'Erledigt. Sie kann einladen; es gab keine Vergangenheit weiterzugeben.',
  vouch_failed_nothing_changed:
    'Das hat nicht geklappt, und für sie hat sich nichts geändert. Sie können es erneut versuchen.',
  vouch_history_arrived:
    'Jemand ist für Sie eingetreten: die Vergangenheit dieser Unterhaltung ist Ihnen jetzt lesbar.',
  vouch_history_untrusted:
    'Ihnen wurde eine Vergangenheit angeboten, von einem Gerät, das dieses hier nicht seiner Inhaberin oder seinem Inhaber zuordnen kann. Sie wurde nicht übernommen.',
  evict_action: 'Diese Person entfernen',
  evict_hint: 'Sie wird nichts mehr lesen können, was hier danach gesagt wird.',
  evict_explain_title: 'Was das bewirkt',
  evict_explain_future:
    'Sie verlässt die Unterhaltung und kann nicht mehr lesen, was dort gesagt wird.',
  evict_explain_past:
    'Was sie bereits gelesen hat, behält sie. Nichts kann es ihr wieder nehmen — weder diese App noch der Server.',
  evict_explain_final:
    'Das lässt sich nicht rückgängig machen: für eine Rückkehr braucht es eine neue Einladung.',
  evict_confirm: 'Ja, diese Person entfernen',
  evict_cancel: 'Abbrechen',
  evict_working: 'Läuft …',
  evict_done: 'Erledigt. Der Schlüssel wurde ersetzt.',
  evict_done_no_key:
    'Erledigt. Es gab keinen Schlüssel dieses Geräts zu ersetzen.',
  evict_failed_nothing_changed:
    'Das hat nicht geklappt, und nichts hat sich geändert. Sie können es erneut versuchen.',
  evict_failed_key_still_valid:
    'Sie ist draußen, aber der Schlüssel konnte nicht ersetzt werden: sie kann weiterhin lesen, was gesagt wird. Versuchen Sie es erneut.',
  promise_thesis: 'Der Messenger, der nichts von Ihnen verlangt.',
  promise_subtitle:
    'Keine Nummer, kein Konto, kein Passwort. Jemand lädt Sie ein, Sie schreiben.',
  promise_point_encrypted: 'Ende-zu-Ende verschlüsselt, ohne Einstellung',
  promise_point_no_harvest: 'Kein abgesaugtes Adressbuch, keine Werbung',
  promise_point_agents: 'Agenten sind hier ausgewiesene Teilnehmer',
  promise_point_invitation:
    'Sie kommen per Einladung herein, nicht per Formular',
  promise_action: 'Beginnen',
  list_title: 'Unterhaltungen',
  list_invitation_ignored:
    'Sie haben eine Einladung geöffnet, und dieses Telefon hat bereits ein Konto. Sie wurde nicht verbraucht und gilt weiterhin für die Person, für die sie bestimmt war.',
  list_not_in_yet:
    'Sie sind noch nicht drin. Öffnen Sie den Einladungslink, den Ihnen jemand geschickt hat: er ist die einzige Tür, und davor kann die Anwendung nichts tun.',
  list_empty:
    'Noch keine Unterhaltung. Laden Sie jemanden ein, um eine zu beginnen.',
  list_nothing_said: 'Es wurde noch nichts gesagt',
  list_unreadable: 'Dieses Gerät kann die letzte Nachricht nicht lesen',
  list_unreachable: 'Diese Unterhaltung konnte nicht erneut gelesen werden',
  list_name_action: 'Namen vergeben',
  list_name_title: 'Wie nennen Sie diese Person?',
  list_name_hint:
    'Dieser Name bleibt auf diesem Gerät. Weder der Server noch Ihr Gegenüber sieht ihn.',
  list_name_placeholder: 'Ein Vorname, ein Spitzname',
  list_name_confirm: 'Speichern',
  list_name_cancel: 'Abbrechen',
  list_back: 'Unterhaltungen',
  invite_action: 'Jemanden einladen',
  invite_who: 'Wen laden Sie ein?',
  invite_working: 'Unterhaltung wird erstellt …',
  invite_ready:
    'Senden Sie dieser Person diesen Link. Er gilt eine Stunde und funktioniert einmal.',
  invite_qr: 'Oder lassen Sie diesen Code scannen.',
  invite_qr_label: 'QR-Code des Einladungslinks',
  invite_share: 'Link teilen',
  invite_close: 'Schließen',
  invite_failed: 'Die Einladung konnte nicht erstellt werden.',
  invite_waiting: 'Noch niemand hat den Link geöffnet.',
  invite_admitted: 'Erledigt: diese Person kann hereinkommen.',
  list_name_not_kept:
    'Der Name konnte nicht behalten werden: beim nächsten Start ist er vergessen.',
  settings_action: 'Einstellungen',
  settings_title: 'Einstellungen',
  settings_legal: 'Rechtliche Hinweise',
  settings_disturb: 'Trotz „Bitte nicht stören“ klingeln',
  settings_disturb_hint:
    'Ohne diese Erlaubnis schaltet Android Messagr-Anrufe stumm, sobald der Modus aktiv ist. Der sich öffnende Bildschirm listet alle Apps: Messagr suchen und Zugriff einschalten.',
  settings_nothing_else:
    'Mehr gibt es hier vorerst nicht. Einstellungen, die diese Version noch nicht trägt, fehlen ganz, statt vorhanden und wirkungslos zu sein.',
  legal_title: 'Rechtliche Hinweise',
  legal_intro:
    'Was diese App anzeigt, ist maßgeblich. Die auf messagr.eu veröffentlichten Bedingungen geben das Folgende wieder und ergänzen, was ein Bildschirm nicht tragen kann: wer den Dienst betreibt, und nach welchem Recht.',
  legal_forbidden_title: 'Was verboten ist',
  legal_forbidden_body:
    'Darstellungen sexuellen Kindesmissbrauchs, Drohungen gegen Leben oder Sicherheit einer Person, Belästigung, Identitätsmissbrauch und jeder andere nach französischem oder europäischem Recht rechtswidrige Inhalt.',
  legal_forbidden_entry:
    'Der Zugang erfolgt ausschließlich über eine namentliche Einladung. Eine Einladung ist persönlich, in der Nutzung begrenzt und nicht weiterverkäuflich. Das Mindestalter beträgt fünfzehn Jahre.',
  legal_moderation_title: 'Wie die Moderation tatsächlich arbeitet',
  legal_moderation_human:
    'Die Moderation liegt bei den Administratorinnen und Administratoren des Servers. Das sind Menschen. Jede Entscheidung wird von einem Menschen getroffen, nie von einem Automatismus.',
  legal_moderation_no_tools:
    'Es gibt kein automatisches Erkennungswerkzeug, keinen Filter, keine Inhaltsanalyse, und es kann sie nicht geben: die Inhalte sind Ende-zu-Ende verschlüsselt, und der Betreiber hält Nachrichten, die er kryptografisch nicht lesen kann.',
  legal_moderation_reported:
    'Geprüft wird nur, was ein Mensch gemeldet hat. Es gibt keine allgemeine Überwachung, keine proaktive Erkennung und keine algorithmische Einstufung.',
  legal_moderation_can:
    'Was der Betreiber ohne Lesen entscheiden kann: ein Konto sperren, ihm die Möglichkeit zu Einladungen entziehen, es aus einer Gruppe ausschließen, einen Einladungszweig widerrufen.',
  legal_moderation_cannot:
    'Was er nicht kann: eine bestimmte Nachricht entfernen, einen Inhalt einordnen oder durch Lesen feststellen, dass eine Regel verletzt wurde.',
  legal_report_title: 'Melden, und was danach folgt',
  legal_report_how:
    'Meldungen erfolgen per E-Mail an conformite@messagr.eu. Das Melden aus der App heraus gibt es noch nicht, und das zu sagen ist besser, als es zu versprechen.',
  legal_report_delay:
    'Eine Meldung erzeugt eine Referenz. Sie erhält eine Empfangsbestätigung und danach spätestens dreißig Tage nach Eingang eine begründete Entscheidung samt dem Weg, ihr zu widersprechen. Die Meldung einer Gefahr für Leben oder Sicherheit an die Behörden hält sich nicht an diese Frist: sie geht sofort hinaus.',
  legal_report_review:
    'Einer Entscheidung kann unter conformite@messagr.eu unter Angabe der Referenz widersprochen werden. Sie wird von einer anderen Person als der entscheidenden erneut geprüft, wann immer die Organisation das zulässt. Bei einem Dienst, den ein oder zwei Personen betreiben, lässt sich das nicht immer einhalten, und das aufzuschreiben ist besser, als eine Trennung zu versprechen, die es nicht gäbe.',
  legal_report_scope:
    'Messagr ist ein Hostingdienst und keine Online-Plattform; Erwägungsgrund 14 des DSA nimmt interpersonelle Kommunikationsdienste aus. Die Artikel 20 und 21 gelten daher nicht, und dieser Text beansprucht nicht, sie zu bieten.',
  legal_full_terms: 'Vollständige Bedingungen: messagr.eu',
  trust_action: 'Was über diese Person bekannt ist',
  trust_title: 'Was über diese Person bekannt ist',
  trust_calm:
    'Das ist kein Alarm. Ihre Nachrichten sind seit der ersten Ende-zu-Ende verschlüsselt, und das hängt von nichts im Folgenden ab. Es geht im Folgenden um die Gewissheit über die Person, nicht um die Verschlüsselung.',
  trust_state_nothing: 'Noch nichts belegt, wer diese Person ist.',
  trust_state_vouched:
    'Jemand, der bereits hier war, ist für diese Person eingetreten.',
  trust_state_confirmed:
    'Eines ihrer Geräte wurde von diesem Gerät aus persönlich bestätigt.',
  trust_devices_title: 'Ihre Geräte',
  'trust_devices %d': 'Diesem Konto sind %d Gerät(e) bekannt.',
  'trust_claimed %d':
    'Diese Person hat %d davon als die ihren signiert. Das behauptet ihr Konto, und es sagt nicht, wer dieses Konto hält.',
  'trust_confirmed %d': '%d wurden von hier aus persönlich bestätigt.',
  trust_none_confirmed:
    'Keines wurde von hier aus bestätigt. Das ist der normale Ausgangszustand.',
  trust_vouch_title: 'Was das Eintreten für jemanden belegt',
  trust_vouch_means:
    'Eine bereits anwesende Person hielt sich für sicher, wer hereinkam, und hat die Tür geöffnet. Das ist ein menschliches Urteil und mehr nicht: kryptografisch wurde nichts belegt. Ein Konto kann von jemand anderem gehalten werden, ohne dass dieses Urteil davon etwas wüsste.',
  trust_raise_title: 'Was den Zweifel ausräumen würde',
  trust_raise_how:
    'Eine kurze Wortfolge mit dieser Person laut vergleichen oder ihren Code in ihrer Gegenwart scannen. Zwei Minuten, ein für alle Mal.',
  trust_raise_missing:
    'Diese Handlung ist in dieser App noch nicht gebaut. Das zu sagen ist besser, als einen Knopf zu zeigen, der nichts täte.',
  reaction_offer: 'Auf diese Nachricht reagieren',
  message_sent: 'Gesendet',
  message_read: 'Gelesen',
  settings_receipts: 'Lesebestätigungen',
  settings_receipts_hint:
    'Öffentlich: der Server erfährt, wer was gelesen hat und wann.',
  settings_receipts_on: 'An',
  settings_receipts_off: 'Aus',
  settings_receipts_not_kept:
    'Diese Wahl konnte nicht behalten werden: beim nächsten Start gilt wieder der vorherige Zustand.',
  day_short_0: 'So.',
  day_short_1: 'Mo.',
  day_short_2: 'Di.',
  day_short_3: 'Mi.',
  day_short_4: 'Do.',
  day_short_5: 'Fr.',
  day_short_6: 'Sa.',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d.%2$d',
  list_no_directory:
    'Nirgendwo im System erscheint eine Telefonnummer. In Kontakt kommt man nur über eine Einladung.',
  calls_empty: 'Noch keine Anrufe.',
  calls_video: 'Video',

  pick_title: 'In welche Unterhaltung?',
  pick_cancel: 'Abbrechen',
  pick_empty: 'Sie haben keine andere Unterhaltung.',
  'calls_ring_back %@': '%@ zurückrufen',
  'calls_lasted %@': 'Dauer: %@',
  calls_taken: 'Eingegangener Anruf',
  calls_placed: 'Ausgehender Anruf',
  calls_missed: 'Verpasster Anruf',
  calls_no_answer: 'Keine Antwort',
  calls_declined: 'Abgelehnt',
  calls_you_declined: 'Sie haben abgelehnt',
  calls_unplaced: 'Anruf nicht möglich',
  calls_soon_title: 'Bald: Audioanrufe, dann Video',
  calls_soon_why:
    'Der Reiter ist ab V1 reserviert, damit sich die Leiste später nicht verschiebt. V1 überträgt nur Text, Links und unbewegte Bilder; Sprachnachrichten in V2, Einzel- und dann Gruppenanrufe in V3.',
  calls_soon_v2: 'V2 · Sprachnachrichten',
  calls_soon_v3: 'V3 · Audio + Video',
  // A call in progress. One screen draws every one of these -- see
  // `CallScreen.tsx` -- so what changes between two states is exactly this
  // sentence and which buttons sit under it.
  call_start: 'Anrufen',
  call_start_video: 'Videoanruf',
  call_ringing: 'Anruf läuft …',
  call_incoming: 'Eingehender Anruf',
  call_incoming_video: 'Eingehender Videoanruf',
  call_answer_video: 'Mit Video annehmen',
  call_answer_audio: 'Ohne Video annehmen',
  call_connecting: 'Verbindung wird hergestellt …',
  call_active: 'Im Gespräch',
  call_reconnecting: 'Erneute Verbindung …',
  call_ended_hung_up: 'Anruf beendet',
  call_ended_unanswered: 'Niemand hat abgenommen',
  call_ended_declined: 'Anruf abgelehnt',
  call_ended_failed: 'Die Verbindung kam nicht zustande',
  call_ended_elsewhere: 'Auf einem anderen Gerät angenommen',
  call_ended_unreachable: 'Diese Person war nicht erreichbar',
  call_answer: 'Annehmen',
  call_reject: 'Ablehnen',
  call_hangup: 'Auflegen',
  call_mute: 'Mikrofon aus',
  call_unmute: 'Mikrofon ein',
  call_speaker: 'Lautsprecher',
  call_camera_on: 'Kamera',
  call_camera_off: 'Kamera ausschalten',
  call_switch_camera: 'Wechseln',
  call_their_camera_off: 'Die Kamera der anderen Person ist aus',
  call_failed_no_relay:
    'Dieser Server hat kein Anrufrelais: Der Anruf war nicht möglich.',
  call_failed_no_microphone: 'Das Mikrofon ist nicht verfügbar.',
  community_soon_title: 'Bald: Communitys und Räume',
  community_soon_why:
    'Eine Community fasst Räume unter einem pseudonymen Objekt zusammen. Der Reiter ist aus demselben Grund reserviert wie der für Anrufe: die Leiste darf sich nicht verschieben, wenn sie kommen.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'Foto ansehen',
  plate_close: 'Schließen',
  'plate_of %1$d %2$d': '%1$d von %2$d',
  'plate_sending %1$d %2$d': '%1$d von %2$d wird gesendet …',
  'plate_partly %1$d': '%1$d Fotos gesendet. Die übrigen konnten nicht weg.',
  plate_too_many: 'Zu viele Fotos auf einmal. Höchstens fünfzig.',
  composer_emoji: 'Emojis',
  composer_photo: 'Ein Foto hinzufügen',
  composer_record: 'Sprachnachricht',
  composer_send: 'Senden',
  composer_record_soon:
    'Sprachnachrichten kommen in V2. Der Knopf hält seinen Platz, damit sich die Leiste an dem Tag nicht verschiebt.',
  person_open: 'Über diese Person',
  person_title: 'Diese Person',
  person_back: 'Zurück',
  message_delivered_hint: 'An den Server übergeben',
  message_read_hint: 'Gelesen',
  settings_open: 'Öffnen',
  settings_full_screen: 'Anrufe im Vollbild',
  settings_full_screen_hint:
    'Ein eingehender Anruf nimmt den ganzen Bildschirm ein, auch gesperrt, statt einer weiteren Benachrichtigungszeile. Android behält das Telefon-Apps vor: auf dem sich öffnenden Bildschirm erteilen Sie es.',
  settings_wake: 'Benachrichtigungen',
  settings_wake_hint:
    'Das Wecksignal trägt weder Absender noch Nachricht. Das Gerät entschlüsselt hier.',
  settings_wake_on: 'An',
  settings_wake_off: 'Aus',
  settings_wake_not_kept:
    'Diese Wahl konnte nicht behalten werden: beim nächsten Start gilt wieder der vorherige Zustand.',
  promise_language: 'Wählen Sie Ihre Sprache',
  promise_terms: 'Ich akzeptiere die Nutzungsbedingungen von Messagr.',
  promise_terms_link: 'Bedingungen lesen',
  promise_terms_required:
    'Setzen Sie das Häkchen, um fortzufahren. Vorher startet nichts.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Es ist etwas angekommen.',
  notify_channel: 'Nachrichten',
  notify_ringing_body: 'Eingehender Anruf',
  notify_ringing_video_body: 'Eingehender Videoanruf',
  'notify_missed %1$d %2$d': 'Verpasster Anruf um %1$d:%2$d',
  notify_ringing_channel: 'Anrufe',
  notify_answer: 'Annehmen',
  notify_decline: 'Ablehnen',
  image_alt: 'Foto',
  image_unreadable:
    'Dieses Foto konnte auf diesem Gerät nicht geöffnet werden.',
  conversation_attach: 'Ein Foto senden',
  conversation_attaching: 'Foto wird verschlüsselt und gesendet …',
  'list_unread %1$d': '%1$d ungelesene Nachrichten',
  invite_open: 'Jemanden einladen',
  back_to_newest: 'Zurück zur neuesten Nachricht',
}
