import type { CopyKey } from './fr'

/**
 * The product’s Uzbek copy, in the Latin script.
 *
 * # Latin and not Cyrillic
 *
 * Uzbek is written in both. The Latin alphabet is the official one and is
 * what a telephone sold in Uzbekistan is set to, so it is the one a person
 * opening this application will expect. The two are not interchangeable and
 * this catalogue does not mix them: `oʻ` and `gʻ` are written with the
 * modifier letter turned comma (U+02BB), which is the standard form and not
 * an apostrophe.
 *
 * # Translated, not glossed
 *
 * The French is the original and several of its strings are arguments rather
 * than labels — what moderation can and cannot do, what vouching establishes,
 * why a receipt is public. Those are translated as arguments: the same claim,
 * made as plainly in Uzbek as it is in French.
 *
 * # THIS HAS NOT BEEN READ BY A NATIVE SPEAKER
 *
 * And that is recorded here rather than assumed away. The other five
 * languages were produced the same way, but this one is further from the
 * translator’s own and from the languages the product was designed in. Before
 * it is offered to anybody outside the project, somebody who speaks Uzbek has
 * to read it — particularly the legal section, where two strings name an
 * article of a European regulation and a deadline the operator is bound by.
 *
 * The build enforces that every key is present. It cannot enforce that a
 * sentence is right, and nothing here should be mistaken for that.
 */
export const uz: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Yadro versiyasi: %@',
  presence_online: 'onlayn',
  message_placeholder: 'Xabar',
  today: 'Bugun',
  yesterday: 'Kecha',
  titlebar_invite: 'Odam taklif qilish',
  titlebar_back: 'Suhbatlarga qaytish',
  date_separator: '%1$d-%2$@, %3$d',
  month_1: 'yanvar',
  month_2: 'fevral',
  month_3: 'mart',
  month_4: 'aprel',
  month_5: 'may',
  month_6: 'iyun',
  month_7: 'iyul',
  month_8: 'avgust',
  month_9: 'sentabr',
  month_10: 'oktabr',
  month_11: 'noyabr',
  month_12: 'dekabr',
  sunday: 'Yakshanba',
  tab_discussions: 'Suhbatlar',
  tab_communities: 'Hamjamiyatlar',
  tab_calls: 'Qoʻngʻiroqlar',
  tab_settings: 'Sozlamalar',
  room_list_subtitle: 'Ushbu hisobning suhbatlari',
  room_list_untitled: 'Nomi yoʻq, bu yerda boshqa hech kim tanish emas',
  people_separator: ', ',
  room_list_nothing_yet: 'Ilova ochilgandan beri hech nima kelmadi',
  room_list_empty: 'Bu qurilma hali birorta suhbatni bilmaydi.',
  room_list_opening: 'Suhbat ochilmoqda…',
  titlebar_new_conversation: 'Yangi suhbat',
  new_conversation_title: 'Yangi suhbat',
  new_conversation_subtitle:
    'Odam taklif qiling yoki allaqachon tanish odam bilan yozishing',
  new_conversation_invite_section: 'Taklif',
  new_conversation_invite_label: 'Odam taklif qilish',
  new_conversation_invite_hint: 'Uzatish uchun taklif havolasini yaratadi.',
  new_conversation_people_section: 'Odamlar',
  new_conversation_no_people: 'Bu qurilma hali hech kimni bilmaydi.',
  new_conversation_no_conversation:
    'Bu qurilmada bu odam bilan yakkama-yakka suhbat yoʻq. Ilova uni hozircha ocha olmaydi: boshlash uchun uni taklif qiling.',
  person_name_action: 'Nom berish',
  person_name_title: 'Nom berish',
  person_name_field: 'Nom',
  person_name_local:
    'Bu nom shu qurilmada qoladi. U serverga hech qachon yuborilmaydi va boshqa qurilmada topilmaydi.',
  person_name_save: 'Saqlash',
  person_name_remove: 'Bu nomni olib tashlash',
  reserved_calls_promise:
    'Ovozli qoʻngʻiroqlar har bir yakkama-yakka suhbat ichidan qilinadi. Qoʻngʻiroqlar jurnali hali qurilmagan.',
  reserved_generic_promise: 'Bu ekran hali qurilmagan.',
  titlebar_call: 'Qoʻngʻiroq',
  settings_subtitle: 'Maxfiylik, tiklash, nazorat',
  settings_row_chevron: '›',
  settings_section_account_title: 'Hisob va qurilma',
  settings_section_account_note:
    'Sizni nima tanitadi va nima qaytib kirishga imkon beradi.',
  settings_row_lang_label: 'Ilova tili',
  settings_row_lang_hint:
    'Oʻzbekcha · yetti til, birinchi ishga tushirishda tanlanadi',
  settings_row_recovery_label: 'Hisobni tiklash',
  settings_row_recovery_hint:
    'Tiklash kaliti · yaqin odam tasdigʻi, PIN sandigʻi (V1.1) · saqlovchi yoʻq: nusxasi boshqa hech kimda emas',
  settings_row_minor_label: 'Voyaga yetmagan hisobi',
  settings_row_minor_hint: 'Yoshni baholash, qonuniy vakil, DSA maʼlumotlari',
  settings_section_privacy_title: 'Maxfiylik',
  settings_section_privacy_note:
    'Sukut boʻyicha hech nima chiqmaydi va sizni hech kim topmaydi.',
  settings_row_chat_label: 'Guruh maxfiyligi',
  settings_row_chat_hint:
    'Koʻrinadigan identifikatorlar yoʻq · uzatish cheklangan',
  settings_row_ephemeral_label: 'Oʻchib ketuvchi xabarlar',
  settings_row_ephemeral_hint:
    'Har bir suhbat uchun · oʻsmir rejimida sukut boʻyicha 24 soat',
  settings_row_discovery_label: 'Kontaktlarni maxfiy topish',
  settings_row_discovery_hint:
    'V1.1 · mahalliy, ixtiyoriy · oʻzaromalik hal qilinmagan',
  settings_section_moderation_title: 'Guruhlar va moderatsiya',
  settings_section_moderation_note:
    'Tizim maʼmuri uchun emas, koʻngilli uchun moʻljallangan vositalar.',
  settings_row_govern_label: 'Boshqaruv va rollar',
  settings_row_govern_hint: 'Rollar, taklif kvotasi, tarmoqni bekor qilish',
  settings_row_report_label: 'Shikoyat, bloklash, chiqish',
  settings_row_report_hint:
    'Sabab, ilovalar, tasdiqnoma · moderator koʻrinishi',
  settings_row_teen_label: 'Oʻsmir rejimi va nazorat',
  settings_row_teen_hint: 'Sukut boʻyicha cheklovchi sozlamalar',
  settings_row_legal_label: 'Huquqiy maʼlumot',
  settings_row_legal_hint:
    'Nima taqiqlangan, moderatsiya qanday qaror qiladi, qanday shikoyat qilinadi',
  settings_section_sharing_title: 'Ulashish va maʼlumotlar',
  settings_section_sharing_note:
    'Suhbatlaringiz oʻzingiz bilan olib ketadigan fayl boʻlib qoladi.',
  settings_row_share_label: 'Boshqa ilovadan ulashish',
  settings_row_share_hint:
    'iOS va Android ulashish oynasi · Messagr ni ochmasdan yuborish',
  settings_row_export_label: 'Suhbatlarimni eksport qilish',
  settings_row_export_hint:
    'Ochiq, hujjatlashtirilgan format, qoʻllab-quvvatlanmaydi',
  settings_section_automation_title: 'Avtomatlashtirish',
  settings_section_automation_note:
    'Mahsulotda saqlangan joy, V1 yetkazadigan narsadan tashqarida.',
  settings_row_bot_label: 'Guruh botlari',
  settings_row_bot_hint:
    'Dvigatel koʻrsatilgan · har qanday maʼmur olib tashlashi mumkin',
  settings_row_api_label: 'API tokenlari va ilovalar',
  settings_row_api_hint: 'Cheklangan huquqlar · istalgan vaqtda bekor qilinadi',
  settings_row_not_yet: 'Hali emas',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Oʻzbekcha',
  language_choose: 'Tilni tanlang',
  language_close: 'Yopish',
  emoji_title: 'Munosabat bildirish',
  emoji_close: 'Yopish',
  emoji_more: 'Koʻproq emoji',
  emoji_group_faces: 'Yuzlar',
  emoji_group_gestures: 'Imolar',
  emoji_group_hearts: 'Yuraklar',
  emoji_group_people: 'Odamlar',
  emoji_group_nature: 'Tabiat',
  emoji_group_food: 'Taom',
  emoji_group_activity: 'Mashgʻulotlar',
  emoji_group_things: 'Buyumlar',
  'conversation_sender_claimed %@': 'Oʻzini %@ deb koʻrsatadi',
  conversation_send: 'Yuborish',
  conversation_empty: 'Bu yerda hali hech nima aytilmagan.',
  conversation_unreadable:
    'Bu qurilmada oʻqib boʻlmaydi: uning kaliti yetib kelmagan.',
  conversation_removed: 'Xabar oʻchirilgan',
  'selection_count %1$d': '%1$d tanlandi',
  selection_clear: 'Tanlovdan chiqish',
  selection_copy: 'Nusxalash',
  selection_forward: 'Uzatish',
  selection_keep: 'Saqlash',
  selection_kept: 'Surat shu qurilmaning suratlar kutubxonasiga saqlandi.',
  selection_keep_failed: 'Suratni saqlab boʻlmadi.',
  selection_favourite: 'Saralangan',
  selection_unfavourite: 'Saralanganlardan olib tashlash',
  favourites_title: 'Saralangan xabarlar',
  favourites_cost:
    'Bu xabarlar faqat shu qurilmada saralangan. Ular boshqa telefonga oʻtmaydi va qayta oʻrnatishdan keyin qolmaydi.',
  favourites_empty:
    'Saralangan xabar yoʻq. Xabarni bosib turish «Saralangan» ni taklif qiladi.',
  favourites_lost: 'Bu xabarni endi shu qurilmada oʻqib boʻlmaydi.',
  'favourites_where %1$@ %2$@': '%1$@ · %2$@',
  settings_favourites: 'Saralangan xabarlar',
  selection_remove: 'Oʻchirish',
  'remove_title %1$d': '%1$d ta xabar oʻchirilsinmi?',
  remove_everyone: 'Hamma uchun oʻchirish',
  remove_everyone_why:
    'Xabar suhbatdoshning nusxasidan ham ketadi. Oʻrnida bir satr qoladi: oʻchirish koʻrinadi.',
  remove_me: 'Men uchun oʻchirish',
  remove_me_why:
    'Xabar suhbatdoshda qoladi. U bu telefonda boshqa koʻrsatilmaydi — ammo boshqa qurilmada yoki qayta oʻrnatishdan keyin qaytadi.',
  remove_cancel: 'Bekor qilish',
  conversation_sending: 'Yuborilmoqda…',
  conversation_send_failed: 'Yuborilmadi. Qayta urinib koʻring.',
  consequence_irreversible: 'Qaytarib boʻlmaydi',
  vouch_action: 'Men bu odamga kafillik beraman',
  vouch_hint:
    'Sizga kim yozayotganiga ishonch hosil qilganingizda qiling — undan oldin emas.',
  vouch_explain_title: 'Siz ularga nima berayotganingiz',
  vouch_explain_lead: 'Qaror qilishdan oldin, bu imo nimani topshiradi.',
  vouch_explain_history:
    'Ular bu yerda boshidan aytilgan hamma narsani, oʻzlari kelishidan oldingisini ham oʻqiy oladilar.',
  vouch_explain_history_empty:
    'Bu yerda hali hech nima aytilmagan, demak uzatiladigan oʻtmish yoʻq.',
  vouch_explain_invite: 'Ular boshqa odamlarni taklif qila oladilar.',
  vouch_fact_history: 'Oʻtmish ular uchun oʻqiladigan boʻladi',
  vouch_fact_invite: 'Ular kimnidir kirita oladilar',
  vouch_explain_final:
    'Buni qaytarib boʻlmaydi: olgan kalitlari ularda qoladi.',
  vouch_confirm: 'Ha, men bu odamga kafillik beraman',
  vouch_cancel: 'Bekor qilish',
  vouch_working: 'Bajarilmoqda…',
  vouch_done: 'Bajarildi. Ularda oʻtmish bor va taklif qila oladilar.',
  vouch_done_no_history:
    'Bajarildi. Ular taklif qila oladilar; uzatiladigan oʻtmish yoʻq edi.',
  vouch_failed_nothing_changed:
    'Bu oʻtmadi va ular uchun hech nima oʻzgarmadi. Qayta urinib koʻrishingiz mumkin.',
  vouch_history_arrived:
    'Kimdir sizga kafillik berdi: bu suhbatning oʻtmishi endi siz uchun oʻqiladi.',
  vouch_history_untrusted:
    'Sizga oʻtmish taklif qilindi, ammo bu qurilma uni egasiga bogʻlay olmaydigan qurilmadan. U qabul qilinmadi.',
  evict_action: 'Bu odamni chiqarish',
  evict_hint: 'Ular bundan keyin bu yerda aytilganlarni oʻqiy olmaydilar.',
  evict_explain_title: 'Nima toʻxtaydi va nima qoladi',
  evict_explain_lead:
    'Messagr ularning qurilmasidagi narsani qaytarib ololmaydi. Qaror qilishdan oldin, butun haqiqat shu.',
  evict_explain_future:
    'Ular suhbatdan chiqadilar va unda aytilganlarni oʻqiy olmaydilar.',
  evict_explain_past:
    'Allaqachon oʻqiganlari ularda qoladi. Buni hech nima qaytarib ololmaydi — na bu ilova, na server.',
  evict_fact_future: 'Bundan keyingisi ular uchun yopiq',
  evict_fact_past: 'Oʻqiganlari ularniki boʻlib qoladi',
  evict_explain_final:
    'Buni qaytarib boʻlmaydi: ularni qaytarish uchun yangi taklif kerak.',
  evict_confirm: 'Ha, bu odamni chiqaring',
  evict_cancel: 'Bekor qilish',
  evict_working: 'Bajarilmoqda…',
  evict_done: 'Bajarildi. Kalit almashtirildi.',
  evict_done_no_key:
    'Bajarildi. Almashtiriladigan oʻsha qurilma kaliti yoʻq edi.',
  evict_failed_nothing_changed:
    'Bu oʻtmadi va hech nima oʻzgarmadi. Qayta urinib koʻrishingiz mumkin.',
  evict_failed_key_still_valid:
    'Ular chiqarildi, ammo kalit almashtirilmadi: ular hamon aytilganlarni oʻqiy oladilar. Qayta urinib koʻring.',
  promise_thesis: 'Sizdan hech narsa soʻramaydigan messenjer.',
  promise_subtitle:
    'Raqam yoʻq, hisob yoʻq, parol yoʻq. Kimdir sizni taklif qiladi — siz yozasiz.',
  promise_point_encrypted:
    'Uchdan-uchgacha shifrlangan, hech narsani sozlash shart emas',
  promise_point_no_harvest: 'Kontaktlar yigʻilmaydi, reklama yoʻq',
  promise_point_agents: 'Bu yerdagi agentlar oshkor qilingan ishtirokchilar',
  promise_point_invitation: 'Bu yerga anketa bilan emas, taklif bilan kiriladi',
  promise_action: 'Boshlash',
  list_title: 'Suhbatlar',
  list_invitation_used:
    'Siz taklifni ochdingiz. U ochadigan suhbat roʻyxatingizda paydo boʻladi.',
  list_invitation_refused:
    'Bu taklifdan foydalanib boʻlmadi. Uni yuborgan odamdan yangisini soʻrang.',
  'list_invitation_already %@':
    'Sizda %@ bilan suhbat allaqachon bor. Oʻsha davom etadi: taklif ikkinchisini ochmadi.',
  list_not_in_yet:
    'Siz hali ichkarida emassiz. Kimdir yuborgan taklif havolasini oching: bu yagona eshik va ilova undan oldin hech nima qila olmaydi.',
  list_reinstalled_back:
    'Bu qurilma qayta oʻrnatilgan. U yangi qurilma sifatida qaytdi va qayta oʻrnatishdan oldin kelgan xabarlar oʻqilmay qoladi: ularning kalitlari eski oʻrnatma bilan ketdi.',
  list_reinstalled_stranded:
    'Bu qurilma shifrlash kalitlarini yoʻqotdi — ehtimol qayta oʻrnatish paytida. Undan oldingi xabarlarni oʻqib boʻlmaydi va ularni tiklab boʻlmaydi. Bu yerda yana yozish uchun yangi taklif kerak.',
  list_empty: 'Hali suhbat yoʻq. Boshlash uchun kimnidir taklif qiling.',
  list_nothing_said: 'Hali hech nima aytilmagan',
  list_unreadable: 'Bu qurilma oxirgi xabarni oʻqiy olmaydi',
  list_unreachable: 'Bu suhbatni qayta oʻqib boʻlmadi',
  list_name_action: 'Nom berish',
  list_name_title: 'Bu odamni nima deb ataysiz?',
  list_name_hint:
    'Bu nom shu qurilmada qoladi. Uni na server, na siz yozayotgan odam koʻradi.',
  list_name_placeholder: 'Ism yoki taxallus',
  list_name_confirm: 'Saqlash',
  list_name_cancel: 'Bekor qilish',
  list_back: 'Suhbatlar',
  invite_action: 'Odam taklif qilish',
  invite_who: 'Kimni taklif qilyapsiz?',
  invite_working: 'Suhbat yaratilmoqda…',
  invite_ready:
    'Bu havolani ularga yuboring. U bir soat amal qiladi va bir marta ishlaydi.',
  invite_qr: 'Yoki bu kodni skanerlashsin.',
  invite_qr_label: 'Taklif havolasining QR kodi',
  invite_share: 'Havolani ulashish',
  invite_close: 'Yopish',
  invite_failed: 'Taklifni yaratib boʻlmadi.',
  invite_waiting: 'Havolani hali hech kim ochmadi.',
  invite_admitted: 'Tayyor: bu odam kirishi mumkin.',
  list_name_not_kept:
    'Nomni saqlab boʻlmadi: keyingi ishga tushirishda u unutiladi.',
  settings_action: 'Sozlamalar',
  settings_title: 'Sozlamalar',
  settings_legal: 'Huquqiy maʼlumot',
  settings_disturb: '«Bezovta qilmang» rejimida ham jiringlasin',
  settings_disturb_hint:
    'Busiz Android bu rejim yoqilganida Messagr qoʻngʻiroqlarini ovozsiz qiladi. Ochiladigan ekranda barcha ilovalar roʻyxati bor: Messagr ni toping va ruxsatni yoqing.',
  settings_nothing_else:
    'Hozircha bu yerda boshqa hech nima yoʻq. Bu versiya hali olib yurmaydigan sozlamalar bor-u ishlamaydigan holda emas, umuman yoʻq.',
  legal_title: 'Huquqiy maʼlumot',
  legal_intro:
    'Ilova koʻrsatayotgan narsa — amal qiladigan narsa. messagr.eu da eʼlon qilingan shartlar quyidagini takrorlaydi va ekran sigʻdira olmaydigan narsani qoʻshadi: xizmatni kim yuritadi va qaysi qonun boʻyicha.',
  legal_forbidden_title: 'Nima taqiqlangan',
  legal_forbidden_body:
    'Bolalarni jinsiy suiisteʼmol qilish materiallari, odamning hayoti yoki xavfsizligiga tahdid, taʼqib, oʻzgalar nomidan ish koʻrish va Fransiya yoki Yevropa qonuniga koʻra noqonuniy boʻlgan har qanday boshqa mazmun.',
  legal_forbidden_entry:
    'Bu yerga faqat nomli taklif bilan kiriladi. Taklif shaxsiy, foydalanish soni cheklangan va qayta sotilmaydi. Eng kichik yosh — oʻn besh.',
  legal_moderation_title: 'Moderatsiya aslida qanday ishlaydi',
  legal_moderation_human:
    'Moderatsiyani server maʼmurlari bajaradi. Ular — odamlar. Har bir qaror odam tomonidan qabul qilinadi, hech qachon avtomatika tomonidan emas.',
  legal_moderation_no_tools:
    'Avtomatik aniqlash vositasi, filtr yoki mazmun tahlili yoʻq va boʻlishi ham mumkin emas: mazmun uchdan-uchgacha shifrlangan va operator oʻzi kriptografik jihatdan oʻqiy olmaydigan xabarlarni saqlaydi.',
  legal_moderation_reported:
    'Odam shikoyat qilmagan hech narsa koʻrib chiqilmaydi. Umumiy kuzatuv, oldindan aniqlash va algoritmik saralash yoʻq.',
  legal_moderation_can:
    'Operator oʻqimasdan nimani hal qila oladi: hisobni toʻxtatib turish, uning taklif berish imkonini olib qoʻyish, uni guruhdan chiqarish, takliflar tarmogʻining bir shoxini bekor qilish.',
  legal_moderation_cannot:
    'Nimani qila olmaydi: muayyan bir xabarni oʻchirish, mazmunga baho berish yoki oʻqib turib qoida buzilganini aniqlash.',
  legal_report_title: 'Shikoyat va undan keyin nima boʻladi',
  legal_report_how:
    'Shikoyatlar conformite@messagr.eu manziliga elektron pochta orqali yuboriladi. Ilova ichidan shikoyat qilish hali yoʻq va buni aytish uni vaʼda qilishdan yaxshiroq.',
  legal_report_delay:
    'Shikoyat raqam oladi. Avval qabul qilingani tasdiqlanadi, keyin kelib tushganidan boshlab koʻpi bilan oʻttiz kun ichida asoslangan qaror va unga eʼtiroz bildirish yoʻli beriladi. Hayot yoki xavfsizlikka tahdid haqida hokimiyat organlariga xabar berish bu muddatni kutmaydi: u darhol ketadi.',
  legal_report_review:
    'Qarorga raqamini koʻrsatgan holda conformite@messagr.eu orqali eʼtiroz bildirish mumkin. Tashkilot imkon bergan har holatda uni qaror qabul qilgan odamdan boshqa birov qayta koʻrib chiqadi. Bir-ikki kishi yuritadigan xizmatda bu shart doim bajarilmaydi va buni yozib qoʻyish mavjud boʻlmagan ajratmani vaʼda qilishdan yaxshiroq.',
  legal_report_scope:
    'Messagr — hosting xizmati, onlayn platforma emas: DSA ning 14-bandi shaxslararo xabar almashish xizmatlarini bundan chiqaradi. Demak 20- va 21-moddalar qoʻllanmaydi va bu matn ularni taklif qilayotgani yoʻq.',
  legal_full_terms: 'Toʻliq foydalanish shartlari: messagr.eu',
  trust_action: 'Bu odam haqida nima maʼlum',
  trust_title: 'Bu odam haqida nima maʼlum',
  trust_calm:
    'Bu ogohlantirish emas. Xabarlaringiz birinchisidan boshlab uchdan-uchgacha shifrlangan va bu quyidagilarga bogʻliq emas. Quyida shifrlash haqida emas, odamning kimligiga ishonch haqida gap boradi.',
  trust_state_nothing: 'Bu odam kimligini hali hech nima tasdiqlamaydi.',
  trust_state_vouched:
    'Bu yerda allaqachon boʻlgan kimdir bu odamga kafillik berdi.',
  trust_state_confirmed:
    'Ularning bir qurilmasi shu qurilmadan, yuzma-yuz tasdiqlangan.',
  trust_devices_title: 'Ularning qurilmalari',
  'trust_devices %d': 'Bu hisobga maʼlum %d ta qurilma.',
  'trust_claimed %d':
    'Bu odam ulardan %d tasini oʻziniki deb imzolagan. Bu — ularning hisobi aytayotgan narsa, va u hisobni kim ushlab turganini aytmaydi.',
  'trust_confirmed %d': 'Bu yerdan, yuzma-yuz %d tasi tasdiqlangan.',
  trust_none_confirmed:
    'Bu yerdan hech biri tasdiqlanmagan. Bu — odatdagi boshlangʻich holat.',
  trust_vouch_title: 'Kafillik nimani tasdiqlaydi',
  trust_vouch_means:
    'Bu yerda allaqachon boʻlgan kimdir kirayotgan odam kimligini bilaman deb hisobladi va eshikni ochdi. Bu — inson hukmi, undan ortigʻi emas: kriptografiya bilan hech nima tasdiqlanmagan. Hisobni oʻsha hukm bexabar qolgan holda boshqa odam ushlab turgan boʻlishi mumkin.',
  trust_raise_title: 'Shubhani nima tugatadi',
  trust_raise_how:
    'Bu odam bilan qisqa soʻzlar qatorini ovoz chiqarib solishtiring yoki uning yonida turib kodini skanerlang. Ikki daqiqa — bir umrga.',
  trust_raise_missing:
    'Bu imo hali bu ilovada qurilmagan. Buni aytish hech nima qilmaydigan tugmani koʻrsatishdan yaxshiroq.',
  reaction_offer: 'Bu xabarga munosabat bildirish',
  message_sent: 'Yuborildi',
  message_read: 'Oʻqildi',
  settings_receipts: 'Oʻqilgani haqida xabar',
  settings_receipts_hint:
    'Ochiq: server kim nimani va qachon oʻqiganini biladi.',
  settings_receipts_on: 'Yoqilgan',
  settings_receipts_off: 'Oʻchirilgan',
  settings_receipts_not_kept:
    'Bu tanlovni saqlab boʻlmadi: keyingi ishga tushirishda u avvalgi holatiga qaytadi.',
  day_short_0: 'Yak',
  day_short_1: 'Dush',
  day_short_2: 'Sesh',
  day_short_3: 'Chor',
  day_short_4: 'Pay',
  day_short_5: 'Jum',
  day_short_6: 'Shan',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d/%2$d',
  list_no_directory:
    'Tizimning hech bir yerida telefon raqami koʻrinmaydi. Aloqaga faqat taklif orqali chiqiladi.',
  calls_empty: 'Hali qoʻngʻiroq yoʻq.',
  calls_video: 'Video',

  pick_title: 'Qaysi suhbatga?',
  pick_cancel: 'Bekor qilish',
  pick_empty: 'Sizda boshqa suhbat yoʻq.',
  'calls_ring_back %@': '%@ ga qayta qoʻngʻiroq qilish',
  'calls_lasted %@': 'Davom etdi: %@',
  calls_taken: 'Kiruvchi qoʻngʻiroq',
  calls_placed: 'Chiquvchi qoʻngʻiroq',
  calls_missed: 'Javobsiz qoʻngʻiroq',
  calls_no_answer: 'Javob boʻlmadi',
  calls_declined: 'Rad etildi',
  calls_you_declined: 'Siz rad etdingiz',
  calls_unplaced: 'Qoʻngʻiroq amalga oshmadi',
  calls_soon_title: 'Tez orada: ovozli qoʻngʻiroqlar, keyin video',
  calls_soon_why:
    'Bu boʻlim V1 dan boshlab saqlab turiladi, keyinchalik panel siljib ketmasin. V1 faqat matn, havola va qimirlamas tasvir olib yuradi; ovozli xabarlar V2 da, yakkama-yakka keyin guruh qoʻngʻiroqlari V3 da.',
  calls_soon_v2: 'V2 · ovozli xabarlar',
  calls_soon_v3: 'V3 · ovoz + video',
  // A call in progress. One screen draws every one of these -- see
  // `CallScreen.tsx` -- so what changes between two states is exactly this
  // sentence and which buttons sit under it.
  call_start: 'Qoʻngʻiroq',
  call_start_video: 'Video qoʻngʻiroq',
  call_ringing: 'Qoʻngʻiroq qilinmoqda…',
  call_incoming: 'Kiruvchi qoʻngʻiroq',
  call_incoming_video: 'Kiruvchi video qoʻngʻiroq',
  call_answer_video: 'Video bilan javob berish',
  call_answer_audio: 'Videosiz javob berish',
  call_connecting: 'Ulanmoqda…',
  call_active: 'Suhbatda',
  call_reconnecting: 'Qayta ulanmoqda…',
  call_ended_hung_up: 'Qoʻngʻiroq tugadi',
  call_ended_unanswered: 'Hech kim javob bermadi',
  call_ended_declined: 'Qoʻngʻiroq rad etildi',
  call_ended_failed: 'Ulanish amalga oshmadi',
  call_ended_elsewhere: 'Boshqa qurilmada javob berildi',
  call_ended_unreachable: 'Ularga yetib boʻlmadi',
  call_answer: 'Javob berish',
  call_reject: 'Rad etish',
  call_hangup: 'Tugatish',
  call_mute: 'Mikrofonni oʻchirish',
  call_unmute: 'Mikrofonni yoqish',
  call_speaker: 'Karnay',
  call_camera_on: 'Kamera',
  call_camera_off: 'Kamerani oʻchirish',
  call_switch_camera: 'Almashtirish',
  call_their_camera_off: 'Ularning kamerasi oʻchirilgan',
  call_failed_no_relay:
    'Bu serverda qoʻngʻiroq relesi yoʻq: qoʻngʻiroq amalga oshmadi.',
  call_failed_no_microphone: 'Mikrofon mavjud emas.',
  community_soon_title: 'Tez orada: hamjamiyatlar va xonalar',
  community_soon_why:
    'Hamjamiyat xonalarni taxallusli obyekt ostida birlashtiradi. Bu boʻlim qoʻngʻiroqlar boʻlimi bilan bir sababdan saqlab turiladi: ular kelganda panel siljimasligi kerak.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'Suratni koʻrish',
  plate_close: 'Yopish',
  'plate_of %1$d %2$d': '%2$d tadan %1$d',
  'plate_sending %1$d %2$d': '%2$d tadan %1$d yuborilmoqda…',
  'plate_partly %1$d': '%1$d ta surat yuborildi. Qolganlari keta olmadi.',
  plate_too_many: 'Bir vaqtda juda koʻp surat. Koʻpi bilan ellikta.',
  composer_emoji: 'Emoji',
  composer_photo: 'Surat qoʻshish',
  composer_document: 'Hujjat qoʻshish',
  composer_attach: 'Biriktirish',
  composer_record: 'Ovozli xabar',
  composer_send: 'Yuborish',
  composer_record_soon:
    'Ovozli xabarlar V2 da keladi. Tugma oʻz joyini saqlab turadi, oʻsha kuni panel siljimasin.',
  person_open: 'Bu odam haqida',
  person_title: 'Bu odam',
  person_back: 'Orqaga',
  message_delivered_hint: 'Serverga topshirildi',
  message_read_hint: 'Oʻqildi',
  settings_open: 'Ochish',
  settings_full_screen: 'Toʻliq ekranli qoʻngʻiroqlar',
  settings_full_screen_hint:
    'Kiruvchi qoʻngʻiroq yana bitta bildirishnoma satri oʻrniga butun ekranni egallaydi — qulflangan holatda ham. Android buni telefon ilovalari uchun ajratgan: ochiladigan ekranda shu ruxsatni berasiz.',
  settings_wake: 'Bildirishnomalar',
  settings_wake_hint:
    'Uygʻotish signali na yuboruvchini, na xabarni olib yuradi. Qurilma shu yerda ochadi.',
  settings_wake_on: 'Yoqilgan',
  settings_wake_off: 'Oʻchirilgan',
  settings_wake_not_kept:
    'Bu tanlovni saqlab boʻlmadi: keyingi ishga tushirishda u avvalgi holatiga qaytadi.',
  promise_language: 'Tilingizni tanlang',
  promise_terms: 'Men Messagr foydalanish shartlarini qabul qilaman.',
  promise_terms_link: 'Shartlarni oʻqish',
  promise_terms_required:
    'Davom etish uchun katakchani belgilang. Undan oldin hech nima boshlanmaydi.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Bir narsa keldi.',
  notify_channel: 'Xabarlar',
  notify_ringing_body: 'Kiruvchi qoʻngʻiroq',
  notify_ringing_video_body: 'Kiruvchi video qoʻngʻiroq',
  'notify_missed %1$d %2$d': '%1$d:%2$d da javobsiz qoʻngʻiroq',
  notify_ringing_channel: 'Qoʻngʻiroqlar',
  notify_answer: 'Javob berish',
  notify_decline: 'Rad etish',
  image_alt: 'Surat',
  image_unreadable: 'Bu suratni shu qurilmada ochib boʻlmadi.',
  file_kept: 'Hujjat siz tanlagan joyga saqlandi.',
  file_keep_failed: 'Hujjatni saqlab boʻlmadi.',
  'file_size_kb %@': '%@ KB',
  'file_size_mb %@': '%@ MB',
  conversation_attach: 'Surat yuborish',
  conversation_attaching: 'Surat shifrlanib yuborilmoqda…',
  'list_unread %1$d': '%1$d ta oʻqilmagan xabar',
  list_nobody_else: 'Bu yerda boshqa hech kim yoʻq',
  list_nobody_joined: 'Bu suhbatga hech kim qoʻshilmadi',
  invite_open: 'Odam taklif qilish',
  settings_backup: 'Xabarlar zaxirasi',
  backup_settings_on:
    'Xabarlaringiz serverda saqlanadi, tiklash kalitingiz bilan yopilgan holda.',
  backup_settings_off:
    'Xabarlaringiz zaxiralanmayapti. Messagr ni qayta oʻrnatish aytilgan hamma narsani yoʻqotadi.',
  'backup_settings_progress %1$d %2$d': '%2$d tadan %1$d kalit zaxiralandi',
  backup_settings_catching_up:
    'Qolgani suhbatlar sinxronlangani sari ketadi. Bu orada hech nima yoʻqolmaydi.',
  backup_settings_reading: 'Zaxira holati oʻqilmoqda…',
  backup_settings_unreadable: 'Zaxira holatini bu qurilmada oʻqib boʻlmadi.',
  backup_settings_unreadable_why:
    'Bu zaxiraning oʻzi haqida hech nima demaydi: yoqilgan boʻlsa, hamon yoqilgan, va bu yerda hech nima oʻzgartirilmadi.',
  backup_settings_retry: 'Qayta urinish',
  backup_settings_enable: 'Xabarlarimni zaxiralash',
  backup_settings_never_shown:
    'Joriy kalitingizni qayta koʻrsatib boʻlmaydi — na bu yerda, na boshqa joyda.',
  backup_settings_replace: 'Tiklash kalitimni almashtirish',
  backup_settings_replace_why:
    'Kalitingizni yoʻqotgan yoki notoʻgʻri yozib olgan boʻlsangiz shuni qiling. Yangi kalit bir marta koʻrsatiladi, eskisi esa boshqa hech nimani ochmaydi.',
  backup_offer_title: 'Bu telefonni yoʻqotsangiz, xabarlaringizni qaytaring',
  backup_offer_lead:
    'Suhbatlaringizni ochadigan kalitlar shu qurilmada bor va boshqa hech qayerda yoʻq. Messagr ularning nusxasini serverda saqlashi mumkin — faqat sizdagi kalit bilan yopilgan holda.',
  backup_offer_loss:
    'Busiz Messagr ni qayta oʻrnatish aytilgan hamma narsani yoʻqotadi. Hisob qaytadi; xabarlar oʻqilmay qoladi.',
  backup_offer_scope:
    'Zaxira xabarlarni saqlaydi. Siz bergan nomlar, saralanganlaringiz va oʻqilgan belgilaringiz shu qurilmada qoladi va u bilan birga ketadi.',
  backup_offer_trust:
    'Server zaxirani oʻqiy olmaydi. Ammo undagi hech narsa almashtirilmaganini ham isbotlay olmaydi: hisobingizni yoki serverni qoʻlga kiritgan har kim ichiga boshqa kalitlarni qoʻshib qoʻyishi mumkin, buni aytadigan hech narsa yoʻq.',
  backup_offer_accept: 'Kalitlarimni zaxiralash',
  backup_offer_refuse: 'Hozir emas',
  backup_offer_later: 'Buni keyinroq Sozlamalardan yoqishingiz mumkin.',
  backup_replace_title: 'Tiklash kalitingizni almashtirish',
  backup_replace_lead: 'Qaror qilishdan oldin, bu imo nimani olib ketadi.',
  backup_replace_fact_old: 'Eski kalit endi hech nimani ochmaydi',
  backup_replace_old_body:
    'U ochgan zaxira serverdan olib tashlanadi. Agar uni oʻzingiz endi nazorat qilmaydigan joyga yozib qoʻygan boʻlsangiz, u qogʻoz endi hech narsaga arzimaydi — maqsad ham shu.',
  backup_replace_fact_new: 'Yangisi bir marta koʻrsatiladi',
  backup_replace_new_body:
    'Birinchisi kabi. Davom etishdan oldin yozib olish uchun nimadir tayyor tursin.',
  backup_replace_final:
    'Xabarlaringiz yangi kalit ostida zaxirada qoladi. Eskisi qaytmaydi.',
  backup_replace_confirm: 'Ha, kalitimni almashtiring',
  backup_replace_cancel: 'Bekor qilish',
  backup_replace_working: 'Almashtirilmoqda…',
  backup_replace_failed:
    'Almashtirish oʻtmadi va hech nima oʻzgarmadi: eski kalitingiz zaxirangizni hamon ochadi.',
  backup_key_old_still_opens:
    'Eski kalitni olib tashlab boʻlmadi: u eski zaxirani hamon ochadi. Sozlamalardan qaytadan boshlashingiz mumkin.',
  backup_key_title: 'Tiklash kalitingiz',
  backup_key_lead: 'Uni hozir nusxalang va parol menejerida saqlang.',
  backup_key_once:
    'U boshqa hech qachon koʻrsatilmaydi. Usiz zaxira ochilmaydi.',
  backup_key_copy: 'Kalitni nusxalash',
  backup_key_copied: 'Kalit nusxalandi.',
  backup_key_done: 'Kalitimni saqlab qoʻydim',
  restore_offer_title: 'Eski xabarlaringiz shu yerda',
  restore_offer_lead:
    'Bu qurilma ularni ocha olmaydi: ochadigan kalitlar oldingi oʻrnatma bilan ketgan.',
  'restore_offer_scope %1$d': '%1$d ta suhbat shu holatda.',
  restore_offer_have:
    'Serverda zaxira bor. Tiklash kalitingiz ularni shu yerda qaytadan ochadi, hech nimani qayta oʻrnatmasdan.',
  restore_offer_accept: 'Tiklash kalitimni kiritish',
  restore_offer_refuse: 'Keyinroq',
  restore_offer_later:
    'Buni Sozlamalardan qilishingiz mumkin. Kalitsiz ham ilova ishlaydi: yopiq qoladigani oʻtmish, hozirgi emas.',
  restore_key_title: 'Tiklash kalitingiz',
  restore_key_lead: 'Sizga bir marta koʻrsatilgani.',
  restore_key_field: 'Kalitni qoʻying yoki yozing',
  restore_key_confirm: 'Xabarlarimni qaytadan ochish',
  restore_key_cancel: 'Bekor qilish',
  restore_key_working: 'Ochilmoqda…',
  restore_key_not_a_key:
    'Bu tiklash kaliti emas. Qoʻyilgan qatorning bir qismi yetishmayotgan boʻlishi mumkin.',
  restore_key_wrong:
    'Bu kalit bu zaxirani ochmaydi. Ehtimol u boshqa hisobniki.',
  restore_key_failed: 'Zaxirani yuklab boʻlmadi. Qayta urinib koʻring.',
  'restore_done %1$d':
    '%1$d ta kalit qaytdi. Eski xabarlaringiz yana oʻqiladigan boʻldi.',
  restore_done_none:
    'Zaxira ochildi, ammo unda bu qurilma koʻrsatayotgan narsa uchun birorta kalit yoʻq edi.',
  vault_title: 'Kalitlar sandigʻi — xohlagan joyingizda saqlang',
  vault_lead:
    'Suhbatlaringiz kalitlarini saqlaydigan fayl, oʻzingiz qoʻygan maxfiy ibora bilan yopilgan.',
  vault_standard:
    'Bu Matrix ning standart formati: har qanday Matrix mijozi uni ochadi, Element ham. Bu faqat Messagr oʻqiy oladigan fayl emas.',
  vault_worth:
    'Bu fayl aytilgan hamma narsani ochadi. U siz qoʻygan joy qancha tursa, shuncha turadi.',
  vault_not_export:
    'Bu maʼlumotlaringiz eksporti emas: sandiqda kalitlar, eksportda xabarlar boʻladi.',
  vault_passphrase_field: 'Bu fayl uchun maxfiy ibora',
  vault_passphrase_hint:
    'Tiklash kalitingizdan boshqa, va boshqa joyga yozib qoʻyilgan. Usiz fayl ochilmaydi — biz ham ocha olmaymiz.',
  vault_create: 'Sandiqni yaratish',
  vault_working: 'Sandiq tayyorlanmoqda…',
  vault_failed: 'Sandiqni yaratib boʻlmadi.',
  vault_cancel: 'Bekor qilish',
  vault_open_title: 'Kalitlar sandigʻini ochish',
  vault_open_lead:
    'Messagr yoki boshqa Matrix mijozi yaratgan fayl. U kalitlari oʻzida boʻlgan suhbatlarni oʻqiladigan qiladi.',
  vault_open_choose: 'Fayl tanlash',
  vault_open_passphrase: 'Bu fayl uchun maxfiy ibora',
  vault_open_working: 'Sandiq ochilmoqda…',
  vault_open_wrong: 'Bu maxfiy ibora bu faylni ochmaydi.',
  vault_open_not_a_vault: 'Bu fayl kalitlar sandigʻi emas.',
  vault_open_failed: 'Sandiqni ochib boʻlmadi. Qayta urinib koʻring.',
  'vault_opened %1$d':
    '%1$d ta kalit qaytdi. Ular ochadigan suhbatlar yana oʻqiladigan boʻldi.',
  vault_opened_none:
    'Sandiq ochildi, ammo unda bu qurilmada boʻlmagan birorta kalit yoʻq edi.',
  settings_vault: 'Kalitlar sandigʻi',
  settings_vault_hint:
    'Fayl — serverda hech nima qoldirishni istamaganlar uchun.',
  restore_done_close: 'Yopish',
  settings_restore: 'Eski xabarlarimni qaytarish',
  settings_restore_hint: 'Agar tiklash kalitingiz boʻlsa.',
  back_to_newest: 'Oxirgi xabarga qaytish',
}
