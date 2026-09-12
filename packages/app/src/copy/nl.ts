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
  settings_row_lang_hint:
    'Nederlands · zeven talen, gekozen bij de eerste start',
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
  selection_forward: 'Doorsturen',
  selection_keep: 'Bewaren',
  selection_kept: 'Foto bewaard in de fotobibliotheek van dit toestel.',
  selection_keep_failed: 'De foto kon niet worden bewaard.',
  selection_favourite: 'Favoriet',
  selection_unfavourite: 'Uit favorieten halen',
  favourites_title: 'Favoriete berichten',
  favourites_cost:
    'Deze berichten zijn alleen op dit toestel favoriet. Ze volgen u niet naar een ander toestel en overleven een herinstallatie niet.',
  favourites_empty:
    'Geen favoriete berichten. Een lange druk op een bericht biedt “Favoriet” aan.',
  favourites_lost: 'Dit bericht is op dit toestel niet meer leesbaar.',
  'favourites_where %1$@ %2$@': '%1$@ · %2$@',
  settings_favourites: 'Favoriete berichten',
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
  consequence_irreversible: 'Onomkeerbaar',
  vouch_action: 'Ik sta in voor deze persoon',
  vouch_hint: 'Te doen wanneer u zeker weet wie u schrijft — niet eerder.',
  vouch_explain_title: 'Wat u deze persoon geeft',
  vouch_explain_lead: 'Alles wat dit gebaar overdraagt, voordat u beslist.',
  vouch_explain_history:
    'Deze persoon zal alles kunnen lezen wat hier vanaf het begin is gezegd, ook van vóór haar komst.',
  vouch_explain_history_empty:
    'Hier is nog niets gezegd, dus er is geen verleden om door te geven.',
  vouch_explain_invite: 'Deze persoon zal anderen kunnen uitnodigen.',
  vouch_fact_history: 'Het verleden wordt voor deze persoon leesbaar',
  vouch_fact_invite: 'Deze persoon kan iemand binnenlaten',
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
  evict_explain_title: 'Wat stopt en wat blijft',
  evict_explain_lead:
    'Messagr kan niet terugnemen wat al op het toestel van deze persoon staat. Dit is de hele waarheid, voordat u beslist.',
  evict_explain_future:
    'Zij verlaat het gesprek en kan niet meer lezen wat daar wordt gezegd.',
  evict_explain_past:
    'Wat zij al heeft gelezen, houdt zij. Niets kan het terugnemen — deze app niet, en de server ook niet.',
  evict_fact_future: 'Wat hierna komt, blijft buiten bereik',
  evict_fact_past: 'Wat deze persoon heeft gelezen, blijft van hen',
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
  list_invitation_used:
    'U hebt een uitnodiging geopend. Het gesprek dat ze opent, verschijnt zo in uw lijst.',
  list_invitation_refused:
    'Deze uitnodiging kon niet worden gebruikt. Vraag de afzender om een nieuwe.',
  'list_invitation_already %@':
    'U hebt al een gesprek met %@. Dat loopt door: de uitnodiging heeft geen tweede geopend.',
  list_not_in_yet:
    'U bent er nog niet in. Open de uitnodigingslink die iemand u heeft gestuurd: dat is de enige deur, en daarvoor kan de applicatie niets doen.',
  list_reinstalled_back:
    'Dit toestel is opnieuw geïnstalleerd. Het is teruggekomen met een nieuwe toestelidentiteit, en berichten van vóór de herinstallatie blijven onleesbaar: hun sleutels zijn met de vorige installatie verdwenen.',
  list_reinstalled_stranded:
    'Dit toestel heeft zijn versleutelingssleutels verloren, waarschijnlijk bij een herinstallatie. Eerder ontvangen berichten zijn onleesbaar en niet terug te halen. Om hier weer te schrijven is een nieuwe uitnodiging nodig.',
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
  settings_disturb: 'Bellen ondanks „Niet storen”',
  settings_disturb_hint:
    'Zonder deze toestemming dempt Android de oproepen van Messagr zodra de modus aanstaat. Het scherm dat opent toont alle apps: zoek Messagr en zet de toegang aan.',
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
  'calls_lasted %@': 'Duur: %@',
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
  call_switch_camera: 'Wisselen',
  call_their_camera_off: 'Hun camera staat uit',
  call_camera_refused:
    'Uw camera kon niet geopend worden. Het gesprek gaat door zonder uw beeld.',
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
  composer_document: 'Een document toevoegen',
  composer_attach: 'Bijvoegen',
  share_not_yet:
    'Dit bestand is niet verstuurd, en Messagr heeft het niet bewaard.',
  share_too_large: 'Dit bestand is te groot om te versturen.',
  share_unreadable: 'Dit bestand kon niet gelezen worden.',
  composer_record: 'Spraakbericht',
  composer_send: 'Versturen',
  composer_record_soon:
    'Spraakberichten komen in V2. De knop houdt zijn plek zodat de balk die dag niet verschuift.',
  person_open: 'Over deze persoon',
  person_title: 'Deze persoon',
  person_back: 'Terug',
  message_delivered_hint: 'Aan de server afgegeven',
  message_read_hint: 'Gelezen',
  settings_open: 'Openen',
  settings_full_screen: 'Oproepen op het volledige scherm',
  settings_full_screen_hint:
    'Een inkomende oproep neemt het hele scherm in, ook vergrendeld, in plaats van nog een meldingsregel. Android houdt dit voor telefoon-apps: op het scherm dat opent geeft u het.',
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
  file_kept: 'Document bewaard waar u het gekozen hebt.',
  file_keep_failed: 'Het document kon niet bewaard worden.',
  'file_size_kb %@': '%@ KB',
  'file_size_mb %@': '%@ MB',
  conversation_attach: 'Een foto versturen',
  conversation_attaching: 'De foto wordt versleuteld en verstuurd…',
  'list_unread %1$d': '%1$d ongelezen berichten',
  list_nobody_else: 'Verder niemand hier',
  list_nobody_joined: 'Niemand heeft aan dit gesprek deelgenomen',
  invite_open: 'Iemand uitnodigen',
  settings_backup: 'Reservekopie van berichten',
  backup_settings_on:
    'Uw berichten staan op de server, gesloten met uw herstelsleutel.',
  backup_settings_off:
    'Van uw berichten is geen reservekopie. Messagr opnieuw installeren zou alles wat er is gezegd verliezen.',
  'backup_settings_progress %1$d %2$d': '%1$d van %2$d sleutels bewaard',
  backup_settings_catching_up:
    'De rest gaat mee met de volgende synchronisaties. Ondertussen gaat er niets verloren.',
  'backup_settings_count %1$d':
    '%1$d sleutels bewaard: dat is wat Messagr op de server ziet.',
  backup_settings_reading: 'De staat van de back-up wordt gelezen…',
  backup_settings_unreadable:
    'De staat van de back-up kon op dit apparaat niet gelezen worden.',
  backup_settings_unreadable_why:
    'Dat zegt niets over de back-up zelf: stond die aan, dan staat die nog aan, en hier is niets veranderd.',
  backup_settings_retry: 'Opnieuw proberen',
  backup_settings_enable: 'Mijn berichten bewaren',
  backup_settings_never_shown:
    'Uw huidige sleutel kan niet opnieuw worden getoond, hier niet en elders niet.',
  backup_settings_replace: 'Mijn herstelsleutel vervangen',
  backup_settings_replace_why:
    'Doe dit als u uw sleutel kwijt bent of verkeerd hebt genoteerd.',
  backup_offer_title: 'Uw berichten terugkrijgen als u deze telefoon verliest',
  backup_offer_lead:
    'De sleutels die uw gesprekken openen, bestaan alleen op dit toestel. Messagr kan er een kopie van op de server bewaren, gesloten met een sleutel die alleen u heeft.',
  backup_offer_loss:
    'Zonder die sleutel verliest u bij het opnieuw installeren van Messagr alles wat er is gezegd. Het account komt terug; de berichten blijven onleesbaar.',
  backup_offer_scope:
    'De reservekopie bewaart de berichten. De namen die u geeft, uw favorieten en uw leesmarkeringen blijven op dit toestel en verdwijnen ermee.',
  backup_offer_trust:
    'De server kan de reservekopie niet lezen. Hij kan ook niet aantonen dat er niets in is vervangen: wie uw account of de server in handen kreeg, zou er andere sleutels in kunnen schuiven zonder dat iets dat meldt.',
  backup_offer_accept: 'Mijn sleutels bewaren',
  backup_offer_refuse: 'Nu niet',
  backup_offer_later: 'U kunt het later inschakelen bij Instellingen.',
  backup_replace_title: 'Uw herstelsleutel vervangen',
  backup_replace_lead: 'Voordat u beslist: wat dit meeneemt.',
  backup_replace_fact_old: 'De oude sleutel opent niets meer',
  backup_replace_old_body:
    'De back-up die hij opende wordt van de server gehaald. Hebt u hem ergens genoteerd waarover u geen zeggenschap meer hebt, dan is dat papier nu niets meer waard — dat is de bedoeling.',
  backup_replace_fact_new: 'De nieuwe wordt één keer getoond',
  backup_replace_new_body:
    'Zoals de eerste. Houd iets bij de hand om hem op te schrijven voordat u doorgaat.',
  backup_replace_final:
    'Uw berichten blijven bewaard, onder de nieuwe sleutel. De oude komt niet terug.',
  backup_replace_confirm: 'Ja, vervang mijn sleutel',
  backup_replace_cancel: 'Annuleren',
  backup_replace_working: 'Bezig met vervangen…',
  backup_replace_failed:
    'De vervanging is niet doorgegaan en er is niets veranderd: uw oude sleutel opent uw back-up nog steeds.',
  backup_key_old_still_opens:
    'De oude sleutel kon niet worden ingetrokken: hij opent de oude back-up nog. U kunt opnieuw beginnen vanuit Instellingen.',
  backup_key_title: 'Uw herstelsleutel',
  backup_key_lead: 'Kopieer hem nu en bewaar hem in een wachtwoordmanager.',
  backup_key_once:
    'Hij wordt nooit meer getoond. Zonder hem gaat de reservekopie niet open.',
  backup_key_copy: 'Sleutel kopiëren',
  backup_key_copied: 'Sleutel gekopieerd.',
  backup_key_done: 'Ik heb mijn sleutel opgeborgen',
  restore_offer_title: 'Uw oudere berichten zijn er',
  restore_offer_lead:
    'Dit apparaat kan ze niet openen: de sleutels die dat deden gingen mee met de vorige installatie.',
  'restore_offer_scope %1$d': '%1$d gesprekken zijn in dat geval.',
  restore_offer_have:
    'Er staat een back-up op de server. Uw herstelsleutel opent ze weer, hier, zonder iets opnieuw te installeren.',
  restore_offer_accept: 'Mijn herstelsleutel invoeren',
  restore_offer_refuse: 'Later',
  restore_offer_later:
    'U kunt het vanuit Instellingen doen. Zonder de sleutel werkt de toepassing: het verleden blijft dicht, het heden niet.',
  restore_key_title: 'Uw herstelsleutel',
  restore_key_lead: 'Die u één keer is getoond.',
  restore_key_field: 'Plak of typ de sleutel',
  restore_key_confirm: 'Mijn berichten weer openen',
  restore_key_cancel: 'Annuleren',
  restore_key_working: 'Bezig met openen…',
  restore_key_not_a_key:
    'Dat is geen herstelsleutel. Mogelijk ontbreekt een deel van de geplakte regel.',
  restore_key_wrong:
    'Deze sleutel opent deze back-up niet. Misschien is het die van een ander account.',
  restore_key_failed: 'De back-up kon niet worden opgehaald. Probeer opnieuw.',
  'restore_done %1$d':
    '%1$d sleutels zijn terug. Uw oudere berichten zijn weer leesbaar.',
  restore_done_none:
    'De back-up ging open, maar bevatte geen sleutel voor wat dit apparaat toont.',
  vault_title: 'Een sleutelkluis, te bewaren waar u wilt',
  vault_lead:
    'Een bestand met de sleutels van uw gesprekken, gesloten met een eigen wachtwoordzin.',
  vault_standard:
    'Het is het standaardformaat van Matrix: elke Matrix-client opent het, Element inbegrepen. Het is geen bestand dat alleen Messagr kan lezen.',
  vault_worth:
    'Dit bestand opent alles wat er gezegd is. Het is waard wat de plek waar u het bewaart waard is.',
  vault_not_export:
    'Het is geen export van uw gegevens: een kluis bevat sleutels, een export bevat berichten.',
  vault_passphrase_field: 'Een wachtwoordzin voor dit bestand',
  vault_passphrase_hint:
    'Anders dan uw herstelsleutel, en ergens anders genoteerd. Zonder die gaat het bestand niet open — ook niet door ons.',
  vault_create: 'Kluis aanmaken',
  vault_working: 'Kluis wordt voorbereid…',
  vault_failed: 'De kluis kon niet worden aangemaakt.',
  vault_cancel: 'Annuleren',
  vault_open_title: 'Een sleutelkluis openen',
  vault_open_lead:
    'Een bestand van Messagr of van een andere Matrix-client. Het maakt de gesprekken leesbaar waarvan het de sleutels bevat.',
  vault_open_choose: 'Een bestand kiezen',
  vault_open_passphrase: 'De wachtwoordzin van dit bestand',
  vault_open_working: 'Kluis wordt geopend…',
  vault_open_wrong: 'Deze wachtwoordzin opent dit bestand niet.',
  vault_open_not_a_vault: 'Dit bestand is geen sleutelkluis.',
  vault_open_failed: 'De kluis kon niet worden geopend. Probeer opnieuw.',
  'vault_opened %1$d':
    '%1$d sleutels zijn terug. De gesprekken die ze openen zijn weer leesbaar.',
  vault_opened_none:
    'De kluis ging open, maar bevatte geen sleutel die dit apparaat nog niet had.',
  settings_vault: 'Sleutelkluis',
  settings_vault_hint: 'Een bestand, voor wie niets op een server wil laten.',
  restore_done_close: 'Sluiten',
  settings_restore: 'Mijn oudere berichten terughalen',
  settings_restore_hint: 'Als u uw herstelsleutel hebt.',
  back_to_newest: 'Terug naar het nieuwste bericht',
}
