import type { CopyKey } from './fr'

/**
 * The product’s Italian copy.
 *
 * Translated from the French, which is the authoritative version. Several
 * strings are arguments rather than labels and are translated as arguments:
 * the same claim, made as plainly in Italian as it is in French.
 *
 * `lei` throughout, as the French uses `vous`.
 *
 * The two legal strings want a lawyer’s eye before the store listing goes
 * out; `en.ts` says the same and for the same reason.
 */
export const it: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Versione del nucleo: %@',
  presence_online: 'in linea',
  message_placeholder: 'Messaggio',
  today: 'Oggi',
  yesterday: 'Ieri',
  titlebar_invite: 'Invitare qualcuno',
  titlebar_back: 'Tornare alle conversazioni',
  date_separator: '%1$d %2$@ %3$d',
  month_1: 'gennaio',
  month_2: 'febbraio',
  month_3: 'marzo',
  month_4: 'aprile',
  month_5: 'maggio',
  month_6: 'giugno',
  month_7: 'luglio',
  month_8: 'agosto',
  month_9: 'settembre',
  month_10: 'ottobre',
  month_11: 'novembre',
  month_12: 'dicembre',
  sunday: 'Domenica',
  tab_discussions: 'Chat',
  tab_communities: 'Comunità',
  tab_calls: 'Chiamate',
  tab_settings: 'Impostazioni',
  room_list_subtitle: 'Le conversazioni di questo account',
  room_list_untitled: 'Senza nome, e nessun altro conosciuto qui',
  people_separator: ', ',
  room_list_nothing_yet:
    'Nulla ricevuto da quando l’applicazione è stata aperta',
  room_list_empty:
    'Questo dispositivo non conosce ancora nessuna conversazione.',
  room_list_opening: 'Apertura della conversazione…',
  titlebar_new_conversation: 'Nuova conversazione',
  new_conversation_title: 'Nuova conversazione',
  new_conversation_subtitle:
    'Invitare qualcuno, o parlare con qualcuno che conosce già',
  new_conversation_invite_section: 'Invitare',
  new_conversation_invite_label: 'Invitare qualcuno',
  new_conversation_invite_hint: 'Crea un link di invito da consegnarle.',
  new_conversation_people_section: 'Persone',
  new_conversation_no_people: 'Questo dispositivo non conosce ancora nessuno.',
  new_conversation_no_conversation:
    'Nessuna conversazione a due con questa persona su questo dispositivo. L’applicazione non sa ancora aprirne una: la inviti per cominciare.',
  person_name_action: 'Dare un nome',
  person_name_title: 'Dare un nome',
  person_name_field: 'Nome',
  person_name_local:
    'Questo nome resta su questo dispositivo. Non viene mai inviato al server, e non lo ritroverà su un altro dispositivo.',
  person_name_save: 'Salvare',
  person_name_remove: 'Togliere questo nome',
  reserved_calls_promise:
    'Le chiamate audio si fanno da ogni conversazione a due. Il registro delle chiamate non è ancora costruito.',
  reserved_generic_promise: 'Questa schermata non è ancora costruita.',
  titlebar_call: 'Chiamare',
  settings_subtitle: 'Riservatezza, recupero, supervisione',
  settings_row_chevron: '›',
  settings_section_account_title: 'Account e dispositivo',
  settings_section_account_note:
    'Ciò che la identifica, e ciò che le permette di tornare.',
  settings_row_lang_label: 'Lingua dell’applicazione',
  settings_row_lang_hint: 'Italiano · sei lingue, scelte al primo avvio',
  settings_row_recovery_label: 'Recupero dell’account',
  settings_row_recovery_hint:
    'Chiave di recupero · convalida da parte di una persona vicina, cassaforte con PIN (V1.1) · nessun deposito: nessun altro detiene la chiave dei suoi messaggi',
  settings_row_minor_label: 'Account di un minore',
  settings_row_minor_hint:
    'Stima dell’età, rappresentante legale, informazione DSA',
  settings_section_privacy_title: 'Riservatezza',
  settings_section_privacy_note:
    'Per impostazione predefinita nulla esce, e nessuno la trova.',
  settings_row_chat_label: 'Riservatezza dei gruppi',
  settings_row_chat_hint: 'Nessun identificativo visibile · inoltri limitati',
  settings_row_ephemeral_label: 'Messaggi effimeri',
  settings_row_ephemeral_hint:
    'Impostazione per conversazione · 24 ore per impostazione predefinita in modalità adolescenti',
  settings_row_discovery_label: 'Scoperta privata dei contatti',
  settings_row_discovery_hint:
    'V1.1 · locale, facoltativa · reciprocità non decisa',
  settings_section_moderation_title: 'Gruppi e moderazione',
  settings_section_moderation_note:
    'Strumenti pensati per una persona volontaria, non per amministrare sistemi.',
  settings_row_govern_label: 'Governance e ruoli',
  settings_row_govern_hint: 'Ruoli, quota di inviti, revoca di un ramo',
  settings_row_report_label: 'Segnalare, bloccare, uscire',
  settings_row_report_hint: 'Motivo, allegati, ricevuta · vista di moderazione',
  settings_row_teen_label: 'Modalità adolescenti e supervisione',
  settings_row_teen_hint:
    'Impostazioni restrittive per impostazione predefinita',
  settings_row_legal_label: 'Informazioni legali',
  settings_row_legal_hint:
    'Cosa è vietato, come decide la moderazione, come contestare',
  settings_section_sharing_title: 'Condivisione e dati',
  settings_section_sharing_note:
    'Le sue conversazioni restano file che può portare con sé.',
  settings_row_share_label: 'Condivisione da un’altra applicazione',
  settings_row_share_hint:
    'Foglio di sistema iOS e Android · inviare senza aprire Messagr',
  settings_row_export_label: 'Esportare le mie conversazioni',
  settings_row_export_hint: 'Formato aperto e documentato, senza assistenza',
  settings_section_automation_title: 'Automazioni',
  settings_section_automation_note:
    'Posto riservato nel prodotto, fuori dal perimetro consegnato in V1.',
  settings_row_bot_label: 'Bot del gruppo',
  settings_row_bot_hint:
    'Motore mostrato · rimovibile da qualsiasi amministrazione',
  settings_row_api_label: 'Token API e applicazioni',
  settings_row_api_hint: 'Diritti limitati · revocabili in qualsiasi momento',
  settings_row_not_yet: 'Non ancora',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Italiano',
  language_choose: 'Scegliere la lingua',
  language_close: 'Chiudere',

  emoji_title: 'Reagire',
  emoji_close: 'Chiudere',
  emoji_more: 'Altre emoji',
  emoji_group_faces: 'Volti',
  emoji_group_gestures: 'Gesti',
  emoji_group_hearts: 'Cuori',
  emoji_group_people: 'Persone',
  emoji_group_nature: 'Natura',
  emoji_group_food: 'Cibo',
  emoji_group_activity: 'Attività',
  emoji_group_things: 'Oggetti',
  'conversation_sender_claimed %@': 'Si presenta come %@',
  conversation_send: 'Inviare',
  conversation_empty: 'Qui non è ancora stato detto nulla.',
  conversation_unreadable:
    'Illeggibile su questo dispositivo: la sua chiave non è mai arrivata.',
  conversation_removed: 'Messaggio eliminato',

  'selection_count %1$d': '%1$d selezionato/i',
  selection_clear: 'Uscire dalla selezione',
  selection_copy: 'Copiare',
  selection_forward: 'Inoltrare',
  selection_keep: 'Salvare',
  selection_kept: 'Fotografia salvata nella fototeca di questo dispositivo.',
  selection_keep_failed: 'Non è stato possibile salvare la fotografia.',
  selection_remove: 'Eliminare',
  'remove_title %1$d': 'Eliminare %1$d messaggio/i?',
  remove_everyone: 'Eliminare per tutti',
  remove_everyone_why:
    'Il messaggio scompare anche dal dispositivo del suo interlocutore. Al suo posto resta una riga: una rimozione si vede.',
  remove_me: 'Eliminare per me',
  remove_me_why:
    'Il messaggio resta presso il suo interlocutore. Non sarà più mostrato su questo telefono, ma riapparirà su un altro dispositivo o dopo una reinstallazione.',
  remove_cancel: 'Annullare',
  conversation_sending: 'Invio…',
  conversation_send_failed: 'Non inviato. Riprovi.',
  consequence_irreversible: 'Irreversibile',
  vouch_action: 'Rispondo io di questa persona',
  vouch_hint: 'Da fare quando è sicuro di sapere chi le scrive — non prima.',
  vouch_explain_title: 'Che cosa le state dando',
  vouch_explain_lead: 'Tutto ciò che questo gesto consegna, prima di decidere.',
  vouch_explain_history:
    'Potrà leggere tutto ciò che è stato detto qui dall’inizio, anche prima del suo arrivo.',
  vouch_explain_history_empty:
    'Qui non è ancora stato detto nulla, quindi non c’è passato da trasmettere.',
  vouch_explain_invite: 'Potrà invitare altre persone.',
  vouch_fact_history: 'Il passato le diventa leggibile',
  vouch_fact_invite: 'Potrà far entrare qualcuno',
  vouch_explain_final: 'Non si annulla: le chiavi che riceve, se le tiene.',
  vouch_confirm: 'Sì, rispondo io di questa persona',
  vouch_cancel: 'Annullare',
  vouch_working: 'In corso…',
  vouch_done: 'Fatto. Ha lo storico e può invitare.',
  vouch_done_no_history:
    'Fatto. Può invitare; non c’era passato da trasmettere.',
  vouch_failed_nothing_changed:
    'Non è andata a buon fine, e per lei non è cambiato nulla. Può riprovare.',
  vouch_history_arrived:
    'Qualcuno ha risposto di lei: il passato di questa conversazione le è ora leggibile.',
  vouch_history_untrusted:
    'Le è stato offerto un passato, da un dispositivo che questo non sa ricondurre a chi lo possiede. Non è stato accettato.',
  evict_action: 'Togliere questa persona',
  evict_hint: 'Non potrà più leggere nulla di ciò che si dirà qui in seguito.',
  evict_explain_title: 'Ciò che si ferma e ciò che resta',
  evict_explain_lead:
    'Messagr non può riprendersi ciò che è già sul suo dispositivo. Ecco tutta la verità, prima di decidere.',
  evict_explain_future:
    'Uscirà dalla conversazione e non potrà più leggere ciò che vi si dirà.',
  evict_explain_past:
    'Ciò che ha già letto, se lo tiene. Nulla può riprenderglielo — né questa applicazione, né il server.',
  evict_fact_future: 'Il seguito le sfugge',
  evict_fact_past: 'Ciò che ha letto resta suo',
  evict_explain_final:
    'Non si annulla: per farla tornare servirà un nuovo invito.',
  evict_confirm: 'Sì, togliere questa persona',
  evict_cancel: 'Annullare',
  evict_working: 'In corso…',
  evict_done: 'Fatto. La chiave è stata sostituita.',
  evict_done_no_key:
    'Fatto. Non c’era nessuna chiave di quel dispositivo da sostituire.',
  evict_failed_nothing_changed:
    'Non è andata a buon fine, e nulla è cambiato. Può riprovare.',
  evict_failed_key_still_valid:
    'È uscita, ma la chiave non è stata sostituita: può ancora leggere ciò che si dirà. Riprovi.',
  promise_thesis: 'La messaggistica che non le chiede nulla.',
  promise_subtitle:
    'Nessun numero, nessun account, nessuna password. Qualcuno la invita, lei scrive.',
  promise_point_encrypted: 'Cifrata end-to-end, senza nulla da impostare',
  promise_point_no_harvest: 'Nessuna rubrica aspirata, nessuna pubblicità',
  promise_point_agents: 'Qui gli agenti sono partecipanti dichiarati',
  promise_point_invitation: 'Si entra su invito, non compilando un modulo',
  promise_action: 'Cominciare',
  list_title: 'Conversazioni',
  list_invitation_used:
    'Avete aperto un invito. La conversazione che apre comparirà nel vostro elenco.',
  list_invitation_refused:
    'Questo invito non ha potuto essere usato. Chiedetene uno nuovo a chi ve l’ha mandato.',
  'list_invitation_already %@':
    'Avete già una conversazione con %@. È quella che prosegue: l’invito non ne ha aperta una seconda.',
  list_not_in_yet:
    'Non è ancora entrato. Apra il link di invito che le hanno mandato: è l’unica porta, e prima l’applicazione non può fare nulla.',
  list_empty:
    'Nessuna conversazione per ora. Inviti qualcuno per cominciarne una.',
  list_nothing_said: 'Non è ancora stato detto nulla',
  list_unreadable: 'Questo dispositivo non può leggere l’ultimo messaggio',
  list_unreachable: 'Non è stato possibile rileggere questa conversazione',
  list_name_action: 'Dare un nome',
  list_name_title: 'Come chiama questa persona?',
  list_name_hint:
    'Questo nome resta su questo dispositivo. Né il server né il suo interlocutore lo vedono.',
  list_name_placeholder: 'Un nome, un soprannome',
  list_name_confirm: 'Salvare',
  list_name_cancel: 'Annullare',
  list_back: 'Conversazioni',
  invite_action: 'Invitare qualcuno',
  invite_who: 'Chi sta invitando?',
  invite_working: 'Creazione della conversazione…',
  invite_ready:
    'Invii questo link a questa persona. Vale un’ora e serve una volta sola.',
  invite_qr: 'Oppure fagli scansionare questo codice.',
  invite_qr_label: 'Codice QR del link di invito',
  invite_share: 'Condividere il link',
  invite_close: 'Chiudere',
  invite_failed: 'Non è stato possibile creare l’invito.',
  invite_waiting: 'Nessuno ha ancora aperto il link.',
  invite_admitted: 'Fatto: questa persona può entrare.',
  list_name_not_kept:
    'Il nome non è stato conservato: sarà dimenticato al prossimo avvio.',
  settings_action: 'Impostazioni',
  settings_title: 'Impostazioni',
  settings_legal: 'Informazioni legali',
  settings_disturb: 'Squillare nonostante «Non disturbare»',
  settings_disturb_hint:
    'Senza questa autorizzazione, Android silenzia le chiamate di Messagr appena il modo è attivo. La schermata che si apre elenca tutte le applicazioni: cercare Messagr e attivare l’accesso.',
  settings_nothing_else:
    'Qui non c’è altro per ora. Le impostazioni che questa versione non porta ancora sono assenti invece che presenti e inerti.',
  legal_title: 'Informazioni legali',
  legal_intro:
    'Ciò che questa applicazione mostra fa fede. Le condizioni pubblicate su messagr.eu riprendono quanto segue e aggiungono ciò che una schermata non può portare: chi gestisce il servizio, e sotto quale diritto.',
  legal_forbidden_title: 'Cosa è vietato',
  legal_forbidden_body:
    'I contenuti pedopornografici, le minacce contro la vita o la sicurezza di una persona, le molestie, l’usurpazione d’identità, e ogni altro contenuto illecito secondo il diritto francese o europeo.',
  legal_forbidden_entry:
    'Si entra soltanto su invito nominativo. Un invito è personale, a uso limitato, e non si rivende. L’età minima è di quindici anni.',
  legal_moderation_title: 'Come funziona realmente la moderazione',
  legal_moderation_human:
    'La moderazione è quella di chi amministra il server. Sono persone. Ogni decisione è presa da una persona, mai da un automatismo.',
  legal_moderation_no_tools:
    'Non esiste alcuno strumento automatico di rilevamento, nessun filtro, nessuna analisi dei contenuti, e non può esistere: il contenuto è cifrato end-to-end e chi gestisce il servizio detiene messaggi che gli è crittograficamente impossibile leggere.',
  legal_moderation_reported:
    'Non viene esaminato nulla che non sia stato segnalato da una persona. Non c’è sorveglianza generale, né rilevamento proattivo, né classificazione algoritmica.',
  legal_moderation_can:
    'Ciò che chi gestisce il servizio può decidere senza leggere: sospendere un account, togliergli la capacità di emettere inviti, escluderlo da un gruppo, revocare un ramo di inviti.',
  legal_moderation_cannot:
    'Ciò che non può fare: rimuovere un messaggio preciso, qualificare un contenuto, o stabilire leggendo che una regola è stata infranta.',
  legal_report_title: 'Segnalare, e cosa segue',
  legal_report_how:
    'La segnalazione si fa per posta elettronica a conformite@messagr.eu. Il gesto dall’applicazione non esiste ancora, e dirlo vale più che prometterlo.',
  legal_report_delay:
    'Una segnalazione produce un riferimento. Riceve una ricevuta, poi una decisione motivata al più tardi trenta giorni dopo il suo ricevimento, con la via per contestarla. La segnalazione alle autorità di una minaccia per la vita o la sicurezza non segue questo termine: parte senza attendere.',
  legal_report_review:
    'Una decisione può essere contestata presso conformite@messagr.eu, citando il riferimento. Viene riesaminata da una persona diversa da quella che l’ha presa ogni volta che l’organizzazione lo permette. In un servizio gestito da una o due persone, questa condizione non può sempre essere rispettata, e scriverlo vale più che promettere una separazione che non esisterebbe.',
  legal_report_scope:
    'Messagr è un servizio di hosting e non una piattaforma online, poiché il considerando 14 del DSA esclude i servizi di comunicazione interpersonale. Gli articoli 20 e 21 non si applicano quindi, e questo testo non pretende di offrirli.',
  legal_full_terms: 'Condizioni generali complete: messagr.eu',
  trust_action: 'Ciò che si sa di questa persona',
  trust_title: 'Ciò che si sa di questa persona',
  trust_calm:
    'Non è un allarme. I suoi messaggi sono cifrati end-to-end fin dal primo, e questo non dipende da nulla di ciò che segue. Ciò che segue parla della certezza sulla persona, non della cifratura.',
  trust_state_nothing: 'Nulla stabilisce ancora chi sia questa persona.',
  trust_state_vouched:
    'Qualcuno che era già qui ha risposto di questa persona.',
  trust_state_confirmed:
    'Uno dei suoi dispositivi è stato confermato da questo, di persona.',
  trust_devices_title: 'I suoi dispositivi',
  'trust_devices %d': '%d dispositivo/i conosciuto/i da questo account.',
  'trust_claimed %d':
    'Questa persona ne ha firmati %d come propri. È ciò che afferma il suo account, e non dice chi tiene quell’account.',
  'trust_confirmed %d': '%d sono stati confermati da qui, di persona.',
  trust_none_confirmed:
    'Nessuno è stato confermato da qui. È lo stato di partenza normale.',
  trust_vouch_title: 'Cosa stabilisce «rispondere di qualcuno»',
  trust_vouch_means:
    'Una persona già presente ha ritenuto di sapere chi entrava, e le ha aperto la porta. È un giudizio umano, e nient’altro: la crittografia non ha stabilito nulla. Un account può essere tenuto da qualcun altro senza che quel giudizio ne sappia nulla.',
  trust_raise_title: 'Cosa toglierebbe il dubbio',
  trust_raise_how:
    'Confrontare una breve sequenza di parole con questa persona, a voce, o scansionare il suo codice in sua presenza. Due minuti, una volta per tutte.',
  trust_raise_missing:
    'Questo gesto non è ancora costruito in questa applicazione. Dirlo vale più che mostrare un pulsante che non farebbe nulla.',
  reaction_offer: 'Reagire a questo messaggio',
  message_sent: 'Inviato',
  message_read: 'Letto',
  settings_receipts: 'Conferme di lettura',
  settings_receipts_hint:
    'Pubblica: il server viene a sapere chi ha letto cosa, e quando.',
  settings_receipts_on: 'Attivate',
  settings_receipts_off: 'Disattivate',
  settings_receipts_not_kept:
    'Questa scelta non è stata conservata: tornerà allo stato precedente al prossimo avvio.',
  day_short_0: 'dom',
  day_short_1: 'lun',
  day_short_2: 'mar',
  day_short_3: 'mer',
  day_short_4: 'gio',
  day_short_5: 'ven',
  day_short_6: 'sab',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d/%2$d',
  list_no_directory:
    'Nessun numero di telefono compare in alcun punto del sistema. Si entra in relazione soltanto su invito.',
  calls_empty: 'Ancora nessuna chiamata.',
  calls_video: 'Video',

  pick_title: 'Verso quale conversazione?',
  pick_cancel: 'Annullare',
  pick_empty: 'Non ha altre conversazioni.',
  'calls_ring_back %@': 'Richiama %@',
  'calls_lasted %@': 'Durata: %@',
  calls_taken: 'Chiamata ricevuta',
  calls_placed: 'Chiamata effettuata',
  calls_missed: 'Chiamata persa',
  calls_no_answer: 'Nessuna risposta',
  calls_declined: 'Rifiutata',
  calls_you_declined: 'Hai rifiutato',
  calls_unplaced: 'Chiamata non riuscita',
  calls_soon_title: 'Presto: chiamate audio, poi video',
  calls_soon_why:
    'La scheda è riservata fin dalla V1 per non spostare la barra più tardi. La V1 trasporta solo testo, link e immagini fisse; note vocali in V2, chiamate individuali e poi di gruppo in V3.',
  calls_soon_v2: 'V2 · note vocali',
  calls_soon_v3: 'V3 · audio + video',
  // A call in progress. One screen draws every one of these -- see
  // `CallScreen.tsx` -- so what changes between two states is exactly this
  // sentence and which buttons sit under it.
  call_start: 'Chiama',
  call_start_video: 'Videochiamata',
  call_ringing: 'Chiamata in corso…',
  call_incoming: 'Chiamata in arrivo',
  call_incoming_video: 'Videochiamata in arrivo',
  call_answer_video: 'Rispondere con video',
  call_answer_audio: 'Rispondere senza video',
  call_connecting: 'Connessione…',
  call_active: 'In chiamata',
  call_reconnecting: 'Riconnessione…',
  call_ended_hung_up: 'Chiamata terminata',
  call_ended_unanswered: 'Nessuno ha risposto',
  call_ended_declined: 'Chiamata rifiutata',
  call_ended_failed: 'Non è stato possibile stabilire la connessione',
  call_ended_elsewhere: 'Risposta da un altro dispositivo',
  call_ended_unreachable: 'Non è stato possibile raggiungere questa persona',
  call_answer: 'Rispondi',
  call_reject: 'Rifiuta',
  call_hangup: 'Riaggancia',
  call_mute: 'Disattiva il microfono',
  call_unmute: 'Attiva il microfono',
  call_speaker: 'Vivavoce',
  call_camera_on: 'Fotocamera',
  call_camera_off: 'Spegnere la fotocamera',
  call_switch_camera: 'Cambiare',
  call_their_camera_off: 'La sua fotocamera è spenta',
  call_failed_no_relay:
    'Questo server non ha un relay per le chiamate: la chiamata non è partita.',
  call_failed_no_microphone: 'Il microfono non è disponibile.',
  community_soon_title: 'Presto: comunità e stanze',
  community_soon_why:
    'Una comunità raggruppa stanze sotto un oggetto pseudonimo. La scheda è riservata per la stessa ragione di quella delle chiamate: la barra non deve spostarsi quando arriveranno.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'Vedere la foto',
  plate_close: 'Chiudere',
  'plate_of %1$d %2$d': '%1$d di %2$d',
  'plate_sending %1$d %2$d': 'Invio %1$d di %2$d…',
  'plate_partly %1$d': '%1$d foto inviate. Le altre non sono potute partire.',
  plate_too_many: 'Troppe foto in una volta. Cinquanta al massimo.',
  composer_emoji: 'Emoji',
  composer_photo: 'Aggiungere una foto',
  composer_record: 'Messaggio vocale',
  composer_send: 'Inviare',
  composer_record_soon:
    'I messaggi vocali arrivano in V2. Il pulsante tiene il suo posto perché la barra non si sposti quel giorno.',
  person_open: 'Su questa persona',
  person_title: 'Questa persona',
  person_back: 'Indietro',
  message_delivered_hint: 'Consegnato al server',
  message_read_hint: 'Letto',
  settings_open: 'Aprire',
  settings_full_screen: 'Chiamate a schermo intero',
  settings_full_screen_hint:
    'Una chiamata in arrivo occupa tutto lo schermo, anche bloccato, invece di una riga di notifica in più. Android lo riserva alle applicazioni telefoniche: la schermata che si apre serve a concederlo.',
  settings_wake: 'Notifiche',
  settings_wake_hint:
    'Il segnale di risveglio non porta né mittente né messaggio. Il dispositivo decifra qui.',
  settings_wake_on: 'Attive',
  settings_wake_off: 'Disattivate',
  settings_wake_not_kept:
    'Questa scelta non è stata conservata: tornerà allo stato precedente al prossimo avvio.',
  promise_language: 'Scelga la sua lingua',
  promise_terms: 'Accetto le condizioni generali d’uso di Messagr.',
  promise_terms_link: 'Leggere le condizioni',
  promise_terms_required:
    'Spunti la casella per continuare. Prima non parte nulla.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'È arrivato qualcosa.',
  notify_channel: 'Messaggi',
  notify_ringing_body: 'Chiamata in arrivo',
  notify_ringing_video_body: 'Videochiamata in arrivo',
  'notify_missed %1$d %2$d': 'Chiamata persa alle %1$d:%2$d',
  notify_ringing_channel: 'Chiamate',
  notify_answer: 'Rispondi',
  notify_decline: 'Rifiuta',
  image_alt: 'Foto',
  image_unreadable:
    'Non è stato possibile aprire questa foto su questo dispositivo.',
  conversation_attach: 'Inviare una foto',
  conversation_attaching: 'Cifratura e invio della foto…',
  'list_unread %1$d': '%1$d messaggi non letti',
  list_nobody_else: 'Nessun altro qui',
  list_nobody_joined: 'Nessuno si è unito a questa conversazione',
  invite_open: 'Invitare qualcuno',
  back_to_newest: 'Torna all’ultimo messaggio',
}
