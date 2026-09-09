import type { CopyKey } from './fr'

/**
 * The product’s Dutch copy.
 *
 * Translated from the French, which is the authoritative version. Several
 * strings are arguments rather than labels and are translated as arguments:
 * the same claim, made as plainly in Dutch as it is in French.
 *
 * `u` throughout, as the French uses `vous`.
 *
 * The two legal strings want a lawyer’s eye before the store listing goes
 * out; `en.ts` says the same and for the same reason.
 */
export const nl: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Kernversie: %@',
  presence_online: 'online',
  message_placeholder: 'Bericht',
  today: 'Vandaag',
  yesterday: 'Gisteren',
  titlebar_invite: 'Iemand uitnodigen',
  titlebar_back: 'Terug naar de gesprekken',
  date_separator: '%1$d %2$@ %3$d',
  month_1: 'januari',
  month_2: 'februari',
  month_3: 'maart',
  month_4: 'april',
  month_5: 'mei',
  month_6: 'juni',
  month_7: 'juli',
  month_8: 'augustus',
  month_9: 'september',
  month_10: 'oktober',
  month_11: 'november',
  month_12: 'december',
  sunday: 'Zondag',
  tab_discussions: 'Gesprekken',
  tab_communities: 'Gemeenschappen',
  tab_calls: 'Oproepen',
  tab_settings: 'Instellingen',
  room_list_subtitle: 'De gesprekken van dit account',
  room_list_untitled: 'Zonder naam, en niemand anders hier bekend',
  people_separator: ', ',
  room_list_nothing_yet: 'Niets ontvangen sinds de app werd geopend',
  room_list_empty: 'Dit apparaat kent voorlopig geen enkel gesprek.',
  room_list_opening: 'Gesprek wordt geopend…',
  titlebar_new_conversation: 'Nieuw gesprek',
  new_conversation_title: 'Nieuw gesprek',
  new_conversation_subtitle:
    'Iemand uitnodigen, of praten met iemand die u al kent',
  new_conversation_invite_section: 'Uitnodigen',
  new_conversation_invite_label: 'Iemand uitnodigen',
  new_conversation_invite_hint: 'Maakt een uitnodigingslink om door te geven.',
  new_conversation_people_section: 'Personen',
  new_conversation_no_people: 'Dit apparaat kent voorlopig niemand.',
  new_conversation_no_conversation:
    'Geen gesprek onder vier ogen met deze persoon op dit apparaat. De app kan er nog geen openen: nodig deze persoon uit om te beginnen.',
  person_name_action: 'Een naam geven',
  person_name_title: 'Een naam geven',
  person_name_field: 'Naam',
  person_name_local:
    'Deze naam blijft op dit apparaat. Hij wordt nooit naar de server gestuurd, en u vindt hem niet terug op een ander apparaat.',
  person_name_save: 'Bewaren',
  person_name_remove: 'Deze naam verwijderen',
  reserved_calls_promise:
    'Audio-oproepen gaan vanuit elk gesprek onder vier ogen. Het oproeplogboek is nog niet gebouwd.',
  reserved_generic_promise: 'Dit scherm is nog niet gebouwd.',
  titlebar_call: 'Bellen',
  settings_subtitle: 'Vertrouwelijkheid, herstel, toezicht',
  settings_row_chevron: '›',
  settings_section_account_title: 'Account en apparaat',
  settings_section_account_note:
    'Wat u identificeert, en wat u laat terugkeren.',
  settings_row_lang_label: 'Taal van de app',
  settings_row_lang_hint: 'Nederlands · zes talen, gekozen bij de eerste start',
  settings_row_recovery_label: 'Accountherstel',
  settings_row_recovery_hint:
    'Herstelsleutel · bevestiging door iemand die u na staat, pincodekluis (V1.1) · geen bewaargeving: niemand anders houdt de sleutel van uw berichten',
  settings_row_minor_label: 'Account van een minderjarige',
  settings_row_minor_hint:
    'Leeftijdsschatting, wettelijke vertegenwoordiger, DSA-informatie',
  settings_section_privacy_title: 'Vertrouwelijkheid',
  settings_section_privacy_note:
    'Standaard gaat er niets naar buiten, en vindt niemand u.',
  settings_row_chat_label: 'Vertrouwelijkheid van groepen',
  settings_row_chat_hint: 'Geen zichtbare identificatoren · beperkt doorsturen',
  settings_row_ephemeral_label: 'Verdwijnende berichten',
  settings_row_ephemeral_hint:
    'Instelling per gesprek · standaard 24 uur in tienermodus',
  settings_row_discovery_label: 'Privé contacten ontdekken',
  settings_row_discovery_hint:
    'V1.1 · lokaal, optioneel · wederkerigheid niet beslist',
  settings_section_moderation_title: 'Groepen en moderatie',
  settings_section_moderation_note:
    'Gereedschap bedoeld voor een vrijwilliger, niet voor een systeembeheerder.',
  settings_row_govern_label: 'Bestuur en rollen',
  settings_row_govern_hint: 'Rollen, uitnodigingsquotum, intrekken van een tak',
  settings_row_report_label: 'Melden, blokkeren, verlaten',
  settings_row_report_hint:
    'Reden, bijlagen, ontvangstbevestiging · moderatieweergave',
  settings_row_teen_label: 'Tienermodus en toezicht',
  settings_row_teen_hint: 'Standaard beperkende instellingen',
  settings_row_legal_label: 'Juridische informatie',
  settings_row_legal_hint:
    'Wat verboden is, hoe de moderatie beslist, hoe u bezwaar maakt',
  settings_section_sharing_title: 'Delen en gegevens',
  settings_section_sharing_note:
    'Uw gesprekken blijven bestanden die u kunt meenemen.',
  settings_row_share_label: 'Delen vanuit een andere app',
  settings_row_share_hint:
    'Systeemdeelvenster op iOS en Android · versturen zonder Messagr te openen',
  settings_row_export_label: 'Mijn gesprekken exporteren',
  settings_row_export_hint:
    'Open, gedocumenteerd formaat, zonder ondersteuning',
  settings_section_automation_title: 'Automatiseringen',
  settings_section_automation_note:
    'Plaats gereserveerd in het product, buiten wat V1 levert.',
  settings_row_bot_label: 'Bots van de groep',
  settings_row_bot_hint: 'Motor zichtbaar · door elke beheerder te verwijderen',
  settings_row_api_label: 'API-tokens en toepassingen',
  settings_row_api_hint: 'Beperkte rechten · op elk moment intrekbaar',
  settings_row_not_yet: 'Nog niet',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Nederlands',
  language_choose: 'Taal kiezen',
  language_close: 'Sluiten',

  emoji_title: 'Reageren',
  emoji_close: 'Sluiten',
  emoji_more: 'Meer emoji',
  emoji_group_faces: 'Gezichten',
  emoji_group_gestures: 'Gebaren',
  emoji_group_hearts: 'Harten',
  emoji_group_people: 'Mensen',
  emoji_group_nature: 'Natuur',
  emoji_group_food: 'Eten',
  emoji_group_activity: 'Activiteiten',
  emoji_group_things: 'Voorwerpen',
  'conversation_sender_claimed %@': 'Geeft zich uit voor %@',
  conversation_send: 'Versturen',
  conversation_empty: 'Hier is nog niets gezegd.',
  conversation_unreadable:
    'Onleesbaar op dit apparaat: de sleutel is nooit aangekomen.',
  conversation_removed: 'Bericht verwijderd',

  'selection_count %1$d': '%1$d geselecteerd',
  selection_clear: 'Selectie verlaten',
  selection_copy: 'Kopiëren',
  selection_remove: 'Verwijderen',
  'remove_title %1$d': '%1$d bericht(en) verwijderen?',
  remove_everyone: 'Voor iedereen verwijderen',
  remove_everyone_why:
    'Het bericht verdwijnt ook bij uw gesprekspartner. Er blijft een regel op die plek staan: een verwijdering is zichtbaar.',
  remove_me: 'Voor mij verwijderen',
  remove_me_why:
    'Het bericht blijft bij uw gesprekspartner. Het wordt op deze telefoon niet meer getoond — maar het komt terug op een ander toestel of na een herinstallatie.',
  remove_cancel: 'Annuleren',
  conversation_sending: 'Versturen…',
  conversation_send_failed: 'Niet verstuurd. Probeer opnieuw.',
  vouch_action: 'Ik sta in voor deze persoon',
  vouch_hint: 'Te doen wanneer u zeker weet wie u schrijft — niet eerder.',
  vouch_explain_title: 'Wat dit doet',
  vouch_explain_history:
    'Deze persoon zal alles kunnen lezen wat hier vanaf het begin is gezegd, ook van vóór haar komst.',
  vouch_explain_history_empty:
    'Hier is nog niets gezegd, dus er is geen verleden om door te geven.',
  vouch_explain_invite: 'Deze persoon zal anderen kunnen uitnodigen.',
  vouch_explain_final:
    'Dit kan niet ongedaan worden gemaakt: de sleutels die zij krijgt, houdt zij.',
  vouch_confirm: 'Ja, ik sta in voor deze persoon',
  vouch_cancel: 'Annuleren',
  vouch_working: 'Bezig…',
  vouch_done: 'Klaar. Zij heeft de geschiedenis en kan uitnodigen.',
  vouch_done_no_history:
    'Klaar. Zij kan uitnodigen; er was geen verleden om door te geven.',
  vouch_failed_nothing_changed:
    'Dat is niet gelukt, en voor haar is er niets veranderd. U kunt het opnieuw proberen.',
  vouch_history_arrived:
    'Iemand heeft voor u ingestaan: het verleden van dit gesprek is nu voor u leesbaar.',
  vouch_history_untrusted:
    'U is een verleden aangeboden, vanaf een apparaat dat dit apparaat niet aan zijn eigenaar kan koppelen. Het is niet overgenomen.',
  evict_action: 'Deze persoon verwijderen',
  evict_hint:
    'Zij zal niets meer kunnen lezen van wat hierna hier wordt gezegd.',
  evict_explain_title: 'Wat dit doet',
  evict_explain_future:
    'Zij verlaat het gesprek en kan niet meer lezen wat daar wordt gezegd.',
  evict_explain_past:
    'Wat zij al heeft gelezen, houdt zij. Niets kan het terugnemen — deze app niet, en de server ook niet.',
  evict_explain_final:
    'Dit kan niet ongedaan worden gemaakt: om haar terug te laten komen is een nieuwe uitnodiging nodig.',
  evict_confirm: 'Ja, deze persoon verwijderen',
  evict_cancel: 'Annuleren',
  evict_working: 'Bezig…',
  evict_done: 'Klaar. De sleutel is vervangen.',
  evict_done_no_key:
    'Klaar. Er was geen sleutel van dat apparaat om te vervangen.',
  evict_failed_nothing_changed:
    'Dat is niet gelukt, en er is niets veranderd. U kunt het opnieuw proberen.',
  evict_failed_key_still_valid:
    'Zij is eruit, maar de sleutel kon niet worden vervangen: zij kan nog lezen wat er wordt gezegd. Probeer opnieuw.',
  promise_thesis: 'De berichtendienst die niets van u vraagt.',
  promise_subtitle:
    'Geen nummer, geen account, geen wachtwoord. Iemand nodigt u uit, u schrijft.',
  promise_point_encrypted: 'End-to-end versleuteld, zonder iets in te stellen',
  promise_point_no_harvest: 'Geen adresboek leeggezogen, geen advertenties',
  promise_point_agents: 'Agenten zijn hier aangegeven deelnemers',
  promise_point_invitation:
    'U komt binnen op uitnodiging, niet via een formulier',
  promise_action: 'Beginnen',
  list_title: 'Gesprekken',
  list_invitation_ignored:
    'U hebt een uitnodiging geopend, en deze telefoon heeft al een account. Ze is niet gebruikt en blijft geldig voor de persoon voor wie ze bedoeld was.',
  list_not_in_yet:
    'U bent er nog niet in. Open de uitnodigingslink die iemand u heeft gestuurd: dat is de enige deur, en daarvoor kan de applicatie niets doen.',
  list_empty:
    'Voorlopig geen gesprekken. Nodig iemand uit om er een te beginnen.',
  list_nothing_said: 'Er is nog niets gezegd',
  list_unreadable: 'Dit apparaat kan het laatste bericht niet lezen',
  list_unreachable: 'Dit gesprek kon niet worden herlezen',
  list_name_action: 'Een naam geven',
  list_name_title: 'Hoe noemt u deze persoon?',
  list_name_hint:
    'Deze naam blijft op dit apparaat. Noch de server noch uw gesprekspartner ziet hem.',
  list_name_placeholder: 'Een voornaam, een bijnaam',
  list_name_confirm: 'Bewaren',
  list_name_cancel: 'Annuleren',
  list_back: 'Gesprekken',
  invite_action: 'Iemand uitnodigen',
  invite_who: 'Wie nodigt u uit?',
  invite_working: 'Het gesprek wordt aangemaakt…',
  invite_ready:
    'Stuur deze link naar die persoon. Hij is een uur geldig en werkt één keer.',
  invite_qr: 'Of laat deze code scannen.',
  invite_qr_label: 'QR-code van de uitnodigingslink',
  invite_share: 'De link delen',
  invite_close: 'Sluiten',
  invite_failed: 'De uitnodiging kon niet worden aangemaakt.',
  invite_waiting: 'Nog niemand heeft de link geopend.',
  invite_admitted: 'Klaar: deze persoon kan binnenkomen.',
  list_name_not_kept:
    'De naam kon niet worden bewaard: bij de volgende start is hij vergeten.',
  settings_action: 'Instellingen',
  settings_title: 'Instellingen',
  settings_legal: 'Juridische informatie',
  settings_disturb: 'Bellen tijdens „Niet storen”',
  settings_disturb_hint:
    'Android dempt inkomende oproepen zolang Messagr geen toegang tot „Niet storen” heeft. Open de lijst, zoek Messagr, zet de toegang aan.',
  settings_nothing_else:
    'Voorlopig staat hier niets anders. Instellingen die deze versie nog niet draagt zijn afwezig in plaats van aanwezig en werkloos.',
  legal_title: 'Juridische informatie',
  legal_intro:
    'Wat deze app toont, is wat geldt. De op messagr.eu gepubliceerde voorwaarden nemen het onderstaande over en voegen toe wat een scherm niet kan dragen: wie de dienst exploiteert, en onder welk recht.',
  legal_forbidden_title: 'Wat verboden is',
  legal_forbidden_body:
    'Materiaal van seksueel kindermisbruik, bedreigingen tegen het leven of de veiligheid van een persoon, intimidatie, identiteitsmisbruik, en elke andere inhoud die onwettig is naar Frans of Europees recht.',
  legal_forbidden_entry:
    'Men komt uitsluitend binnen op naam en op uitnodiging. Een uitnodiging is persoonlijk, beperkt in gebruik, en wordt niet doorverkocht. De minimumleeftijd is vijftien jaar.',
  legal_moderation_title: 'Hoe de moderatie werkelijk werkt',
  legal_moderation_human:
    'De moderatie is die van de beheerders van de server. Dat zijn mensen. Elke beslissing wordt door een mens genomen, nooit door een automatisme.',
  legal_moderation_no_tools:
    'Er bestaat geen automatisch detectiehulpmiddel, geen filter, geen inhoudsanalyse, en die kan er ook niet zijn: de inhoud is end-to-end versleuteld en de exploitant houdt berichten die hij cryptografisch onmogelijk kan lezen.',
  legal_moderation_reported:
    'Er wordt niets onderzocht dat niet door een mens is gemeld. Er is geen algemeen toezicht, geen proactieve detectie en geen algoritmische rangschikking.',
  legal_moderation_can:
    'Wat de exploitant kan beslissen zonder te lezen: een account opschorten, het de mogelijkheid ontnemen uitnodigingen te versturen, het uit een groep zetten, een uitnodigingstak intrekken.',
  legal_moderation_cannot:
    'Wat hij niet kan: een bepaald bericht verwijderen, inhoud kwalificeren, of door te lezen vaststellen dat een regel is geschonden.',
  legal_report_title: 'Melden, en wat daarop volgt',
  legal_report_how:
    'Melden gaat per e-mail naar conformite@messagr.eu. Het gebaar vanuit de app bestaat nog niet, en dat zeggen is beter dan het beloven.',
  legal_report_delay:
    'Een melding levert een referentie op. Zij krijgt een ontvangstbevestiging, en daarna uiterlijk dertig dagen na ontvangst een met redenen omklede beslissing, met de weg om die aan te vechten. Het melden aan de autoriteiten van een bedreiging voor het leven of de veiligheid volgt die termijn niet: dat gaat onmiddellijk weg.',
  legal_report_review:
    'Tegen een beslissing kan bezwaar worden gemaakt bij conformite@messagr.eu, met vermelding van de referentie. Zij wordt opnieuw beoordeeld door iemand anders dan degene die haar nam, telkens wanneer de organisatie dat toelaat. Bij een dienst die door één of twee mensen wordt geëxploiteerd kan aan die voorwaarde niet altijd worden voldaan, en dat opschrijven is beter dan een scheiding beloven die niet zou bestaan.',
  legal_report_scope:
    'Messagr is een hostingdienst en geen onlineplatform; overweging 14 van de DSA sluit interpersoonlijke communicatiediensten uit. De artikelen 20 en 21 zijn dus niet van toepassing, en deze tekst beweert niet ze te bieden.',
  legal_full_terms: 'Volledige algemene voorwaarden: messagr.eu',
  trust_action: 'Wat er van deze persoon bekend is',
  trust_title: 'Wat er van deze persoon bekend is',
  trust_calm:
    'Dit is geen waarschuwing. Uw berichten zijn end-to-end versleuteld sinds het eerste, en dat hangt van niets hieronder af. Wat volgt gaat over de zekerheid omtrent de persoon, niet over de versleuteling.',
  trust_state_nothing: 'Nog niets stelt vast wie deze persoon is.',
  trust_state_vouched:
    'Iemand die er al was heeft voor deze persoon ingestaan.',
  trust_state_confirmed:
    'Een van haar apparaten is vanaf dit apparaat persoonlijk bevestigd.',
  trust_devices_title: 'Haar apparaten',
  'trust_devices %d': '%d apparaat/apparaten bekend bij dit account.',
  'trust_claimed %d':
    'Deze persoon heeft er %d als de hare ondertekend. Dat is wat haar account beweert, en het zegt niet wie dat account houdt.',
  'trust_confirmed %d': '%d zijn hier persoonlijk bevestigd.',
  trust_none_confirmed:
    'Geen enkel is hier bevestigd. Dat is de normale begintoestand.',
  trust_vouch_title: 'Wat «voor iemand instaan» vaststelt',
  trust_vouch_means:
    'Iemand die er al was meende te weten wie binnenkwam, en heeft de deur geopend. Dat is een menselijk oordeel, en niets meer: cryptografisch is er niets vastgesteld. Een account kan door iemand anders worden gehouden zonder dat dat oordeel daar iets van weet.',
  trust_raise_title: 'Wat de twijfel zou wegnemen',
  trust_raise_how:
    'Een korte reeks woorden hardop met deze persoon vergelijken, of haar code in haar aanwezigheid scannen. Twee minuten, eens en voor altijd.',
  trust_raise_missing:
    'Dat gebaar is in deze app nog niet gebouwd. Dat zeggen is beter dan een knop tonen die niets zou doen.',
  reaction_offer: 'Op dit bericht reageren',
  message_sent: 'Verstuurd',
  message_read: 'Gelezen',
  settings_receipts: 'Leesbevestigingen',
  settings_receipts_hint:
    'Openbaar: de server komt te weten wie wat heeft gelezen, en wanneer.',
  settings_receipts_on: 'Aan',
  settings_receipts_off: 'Uit',
  settings_receipts_not_kept:
    'Deze keuze kon niet worden bewaard: bij de volgende start geldt weer de vorige toestand.',
  day_short_0: 'zo',
  day_short_1: 'ma',
  day_short_2: 'di',
  day_short_3: 'wo',
  day_short_4: 'do',
  day_short_5: 'vr',
  day_short_6: 'za',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d-%2$d',
  list_no_directory:
    'Nergens in het systeem komt een telefoonnummer voor. Contact ontstaat uitsluitend op uitnodiging.',
  calls_empty: 'Nog geen oproepen.',
  calls_video: 'Video',

  pick_title: 'Naar welk gesprek?',
  pick_cancel: 'Annuleren',
  pick_empty: 'U hebt geen ander gesprek.',
  'calls_ring_back %@': '%@ terugbellen',
  calls_taken: 'Ontvangen oproep',
  calls_placed: 'Uitgaande oproep',
  calls_missed: 'Gemiste oproep',
  calls_no_answer: 'Geen antwoord',
  calls_declined: 'Geweigerd',
  calls_you_declined: 'U hebt geweigerd',
  calls_unplaced: 'Bellen niet mogelijk',
  calls_soon_title: 'Binnenkort: audio-oproepen, daarna video',
  calls_soon_why:
    'Het tabblad is vanaf V1 gereserveerd zodat de balk later niet verschuift. V1 draagt alleen tekst, links en stilstaande beelden; spraakberichten in V2, individuele en daarna groepsoproepen in V3.',
  calls_soon_v2: 'V2 · spraakberichten',
  calls_soon_v3: 'V3 · audio + video',
  // A call in progress. One screen draws every one of these -- see
  // `CallScreen.tsx` -- so what changes between two states is exactly this
  // sentence and which buttons sit under it.
  call_start: 'Bellen',
  call_start_video: 'Video-oproep',
  call_ringing: 'Bellen…',
  call_incoming: 'Inkomende oproep',
  call_incoming_video: 'Inkomende video-oproep',
  call_answer_video: 'Met video opnemen',
  call_answer_audio: 'Zonder video opnemen',
  call_connecting: 'Verbinden…',
  call_active: 'In gesprek',
  call_reconnecting: 'Opnieuw verbinden…',
  call_ended_hung_up: 'Gesprek beëindigd',
  call_ended_unanswered: 'Niemand heeft opgenomen',
  call_ended_declined: 'Oproep geweigerd',
  call_ended_failed: 'De verbinding kon niet tot stand komen',
  call_ended_elsewhere: 'Op een ander apparaat opgenomen',
  call_ended_unreachable: 'Deze persoon was niet bereikbaar',
  call_answer: 'Opnemen',
  call_reject: 'Weigeren',
  call_hangup: 'Ophangen',
  call_mute: 'Microfoon uit',
  call_unmute: 'Microfoon aan',
  call_speaker: 'Luidspreker',
  call_camera_on: 'Camera',
  call_camera_off: 'Camera uitzetten',
  call_switch_camera: 'Camera wisselen',
  call_their_camera_off: 'Hun camera staat uit',
  call_failed_no_relay:
    'Deze server heeft geen oproeprelais: bellen was niet mogelijk.',
  call_failed_no_microphone: 'De microfoon is niet beschikbaar.',
  community_soon_title: 'Binnenkort: gemeenschappen en kamers',
  community_soon_why:
    'Een gemeenschap groepeert kamers onder een pseudoniem object. Het tabblad is gereserveerd om dezelfde reden als dat van de oproepen: de balk mag niet verschuiven wanneer ze er zijn.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'Foto bekijken',
  plate_close: 'Sluiten',
  'plate_of %1$d %2$d': '%1$d van %2$d',
  'plate_sending %1$d %2$d': '%1$d van %2$d wordt verstuurd…',
  'plate_partly %1$d': '%1$d foto’s verstuurd. De rest kon niet weg.',
  plate_too_many: 'Te veel foto’s tegelijk. Hooguit vijftig.',
  composer_emoji: 'Emoji',
  composer_photo: 'Een foto toevoegen',
  composer_record: 'Spraakbericht',
  composer_send: 'Versturen',
  composer_record_soon:
    'Spraakberichten komen in V2. De knop houdt zijn plek zodat de balk die dag niet verschuift.',
  person_open: 'Over deze persoon',
  person_title: 'Deze persoon',
  person_back: 'Terug',
  message_delivered_hint: 'Aan de server afgegeven',
  message_read_hint: 'Gelezen',
  settings_full_screen: 'Een oproep het scherm laten inschakelen',
  settings_open: 'Openen',
  settings_full_screen_hint:
    'Android geeft alleen telefoontoepassingen het recht om voor een oproep het scherm in te schakelen. Zonder dat is een inkomende oproep één melding meer op het vergrendelscherm.',
  settings_wake: 'Meldingen',
  settings_wake_hint:
    'Het wekseintje draagt geen afzender en geen bericht. Het apparaat ontsleutelt hier.',
  settings_wake_on: 'Aan',
  settings_wake_off: 'Uit',
  settings_wake_not_kept:
    'Deze keuze kon niet worden bewaard: bij de volgende start geldt weer de vorige toestand.',
  promise_language: 'Kies uw taal',
  promise_terms: 'Ik aanvaard de algemene gebruiksvoorwaarden van Messagr.',
  promise_terms_link: 'De voorwaarden lezen',
  promise_terms_required:
    'Vink het vakje aan om verder te gaan. Daarvoor start er niets.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Er is iets aangekomen.',
  notify_channel: 'Berichten',
  notify_ringing_body: 'Inkomende oproep',
  notify_ringing_video_body: 'Inkomende video-oproep',
  'notify_missed %1$d %2$d': 'Gemiste oproep om %1$d:%2$d',
  notify_ringing_channel: 'Oproepen',
  notify_answer: 'Opnemen',
  notify_decline: 'Weigeren',
  image_alt: 'Foto',
  image_unreadable: 'Deze foto kon op dit apparaat niet worden geopend.',
  conversation_attach: 'Een foto versturen',
  conversation_attaching: 'De foto wordt versleuteld en verstuurd…',
  'list_unread %1$d': '%1$d ongelezen berichten',
  invite_open: 'Iemand uitnodigen',
}
