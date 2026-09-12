import type { CopyKey } from './fr'

/**
 * The product’s English copy.
 *
 * # Translated, not glossed
 *
 * The French is the original and several of its strings are arguments rather
 * than labels — what moderation can and cannot do, what vouching establishes,
 * why a receipt is public. Those are translated as arguments: the same claim,
 * made as plainly in English as it is in French, rather than word for word.
 *
 * # Two of them are legal text
 *
 * `legal_report_scope` names an article of a European regulation, and
 * `legal_report_delay` states a deadline the operator is bound by. They are
 * translated from the French, which is the authoritative version — the screen
 * says as much — and they should have a lawyer’s eye before the store listing
 * goes out. Recorded here so it is a scheduled check rather than a surprise.
 *
 * # The placeholders are the French ones, exactly
 *
 * `%@`, `%1$d`, `%2$@`: their positions may move within a sentence, but every
 * one that appears in the French appears here, and none is invented. A
 * catalogue that dropped one would render a sentence with a hole in it.
 */
export const en: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Core version: %@',
  presence_online: 'online',
  message_placeholder: 'Message',
  today: 'Today',
  yesterday: 'Yesterday',
  titlebar_invite: 'Invite someone',
  titlebar_back: 'Back to conversations',
  date_separator: '%2$@ %1$d, %3$d',
  month_1: 'January',
  month_2: 'February',
  month_3: 'March',
  month_4: 'April',
  month_5: 'May',
  month_6: 'June',
  month_7: 'July',
  month_8: 'August',
  month_9: 'September',
  month_10: 'October',
  month_11: 'November',
  month_12: 'December',
  sunday: 'Sunday',
  tab_discussions: 'Chats',
  tab_communities: 'Communities',
  tab_calls: 'Calls',
  tab_settings: 'Settings',
  room_list_subtitle: 'This account’s conversations',
  room_list_untitled: 'No name, and nobody else known here',
  people_separator: ', ',
  room_list_nothing_yet: 'Nothing received since the app was opened',
  room_list_empty: 'This device knows of no conversation yet.',
  room_list_opening: 'Opening the conversation…',
  titlebar_new_conversation: 'New conversation',
  new_conversation_title: 'New conversation',
  new_conversation_subtitle:
    'Invite someone, or talk to someone you already know',
  new_conversation_invite_section: 'Invite',
  new_conversation_invite_label: 'Invite someone',
  new_conversation_invite_hint: 'Creates an invitation link to pass on.',
  new_conversation_people_section: 'People',
  new_conversation_no_people: 'This device knows of nobody yet.',
  new_conversation_no_conversation:
    'No one-to-one conversation with this person on this device. The app cannot open one yet: invite them to begin.',
  person_name_action: 'Give a name',
  person_name_title: 'Give a name',
  person_name_field: 'Name',
  person_name_local:
    'This name stays on this device. It is never sent to the server, and you will not find it on another device.',
  person_name_save: 'Save',
  person_name_remove: 'Remove this name',
  reserved_calls_promise:
    'Audio calls are made from within each one-to-one conversation. The call log is not built yet.',
  reserved_generic_promise: 'This screen is not built yet.',
  titlebar_call: 'Call',
  settings_subtitle: 'Privacy, recovery, oversight',
  settings_row_chevron: '›',
  settings_section_account_title: 'Account and device',
  settings_section_account_note:
    'What identifies you, and what lets you come back.',
  settings_row_lang_label: 'App language',
  settings_row_lang_hint: 'English · seven languages, chosen at first launch',
  settings_row_recovery_label: 'Account recovery',
  settings_row_recovery_hint:
    'Recovery key · confirmation by someone close, PIN vault (V1.1) · no escrow: nobody else holds a copy',
  settings_row_minor_label: 'A minor’s account',
  settings_row_minor_hint: 'Age estimation, legal guardian, DSA information',
  settings_section_privacy_title: 'Privacy',
  settings_section_privacy_note:
    'By default nothing leaves, and nobody finds you.',
  settings_row_chat_label: 'Group privacy',
  settings_row_chat_hint: 'No visible identifiers · limited forwarding',
  settings_row_ephemeral_label: 'Disappearing messages',
  settings_row_ephemeral_hint:
    'Per conversation · 24 hours by default in teen mode',
  settings_row_discovery_label: 'Private contact discovery',
  settings_row_discovery_hint: 'V1.1 · local, optional · reciprocity undecided',
  settings_section_moderation_title: 'Groups and moderation',
  settings_section_moderation_note:
    'Tools meant for a volunteer, not for a system administrator.',
  settings_row_govern_label: 'Governance and roles',
  settings_row_govern_hint: 'Roles, invitation quota, revoking a branch',
  settings_row_report_label: 'Report, block, leave',
  settings_row_report_hint:
    'Reason, attachments, acknowledgement · moderator view',
  settings_row_teen_label: 'Teen mode and supervision',
  settings_row_teen_hint: 'Restrictive settings by default',
  settings_row_legal_label: 'Legal information',
  settings_row_legal_hint:
    'What is forbidden, how moderation decides, how to appeal',
  settings_section_sharing_title: 'Sharing and data',
  settings_section_sharing_note:
    'Your conversations stay files you can take with you.',
  settings_row_share_label: 'Sharing from another app',
  settings_row_share_hint:
    'iOS and Android share sheet · send without opening Messagr',
  settings_row_export_label: 'Export my conversations',
  settings_row_export_hint: 'Open, documented format, unsupported',
  settings_section_automation_title: 'Automation',
  settings_section_automation_note:
    'A place held in the product, outside what V1 ships.',
  settings_row_bot_label: 'Group bots',
  settings_row_bot_hint: 'Engine shown · removable by any administrator',
  settings_row_api_label: 'API tokens and applications',
  settings_row_api_hint: 'Limited rights · revocable at any time',
  settings_row_not_yet: 'Not yet',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'English',
  language_choose: 'Choose the language',
  language_close: 'Close',

  emoji_title: 'React',
  emoji_close: 'Close',
  emoji_more: 'More emoji',
  emoji_group_faces: 'Faces',
  emoji_group_gestures: 'Gestures',
  emoji_group_hearts: 'Hearts',
  emoji_group_people: 'People',
  emoji_group_nature: 'Nature',
  emoji_group_food: 'Food',
  emoji_group_activity: 'Activities',
  emoji_group_things: 'Objects',
  'conversation_sender_claimed %@': 'Presents itself as %@',
  conversation_send: 'Send',
  conversation_empty: 'Nothing has been said here yet.',
  conversation_unreadable: 'Unreadable on this device: its key never arrived.',
  conversation_removed: 'Message deleted',

  'selection_count %1$d': '%1$d selected',
  selection_clear: 'Leave selection',
  selection_copy: 'Copy',
  selection_forward: 'Forward',
  selection_keep: 'Save',
  selection_kept: 'Photograph saved to this device’s photo library.',
  selection_keep_failed: 'The photograph could not be saved.',
  selection_favourite: 'Favourite',
  selection_unfavourite: 'Remove from favourites',
  favourites_title: 'Favourite messages',
  favourites_cost:
    'These messages are favourites on this device only. They do not follow you to another telephone and do not survive a reinstall.',
  favourites_empty:
    'No favourite messages. A long press on a message offers “Favourite”.',
  favourites_lost: 'This message can no longer be read on this device.',
  'favourites_where %1$@ %2$@': '%1$@ · %2$@',
  settings_favourites: 'Favourite messages',
  selection_remove: 'Delete',
  'remove_title %1$d': 'Delete %1$d message(s)?',
  remove_everyone: 'Delete for everyone',
  remove_everyone_why:
    'The message goes from the other person’s copy too. A line stays where it was: a removal is visible.',
  remove_me: 'Delete for me',
  remove_me_why:
    'The message stays with the other person. It will not be shown on this telephone again — but it comes back on another device or after a reinstall.',
  remove_cancel: 'Cancel',
  conversation_sending: 'Sending…',
  conversation_send_failed: 'Not sent. Try again.',
  consequence_irreversible: 'Irreversible',
  vouch_action: 'I vouch for this person',
  vouch_hint:
    'To be done when you are sure who is writing to you — not before.',
  vouch_explain_title: 'What you are giving them',
  vouch_explain_lead: 'Everything this gesture hands over, before you decide.',
  vouch_explain_history:
    'They will be able to read everything said here from the beginning, including before they arrived.',
  vouch_explain_history_empty:
    'Nothing has been said here yet, so there is no past to pass on.',
  vouch_explain_invite: 'They will be able to invite other people.',
  vouch_fact_history: 'The past becomes readable to them',
  vouch_fact_invite: 'They will be able to let somebody in',
  vouch_explain_final:
    'This cannot be undone: the keys they receive, they keep.',
  vouch_confirm: 'Yes, I vouch for this person',
  vouch_cancel: 'Cancel',
  vouch_working: 'Working…',
  vouch_done: 'Done. They have the history and can invite.',
  vouch_done_no_history: 'Done. They can invite; there was no past to pass on.',
  vouch_failed_nothing_changed:
    'That did not go through, and nothing changed for them. You can try again.',
  vouch_history_arrived:
    'Someone vouched for you: this conversation’s past is now readable to you.',
  vouch_history_untrusted:
    'A past was offered to you, from a device this one cannot tie to its owner. It was not taken up.',
  evict_action: 'Remove this person',
  evict_hint: 'They will not be able to read anything said here afterwards.',
  evict_explain_title: 'What stops, and what stays',
  evict_explain_lead:
    'Messagr cannot take back what is already on their device. Here is the whole truth, before you decide.',
  evict_explain_future:
    'They will leave the conversation and will not be able to read what is said in it.',
  evict_explain_past:
    'What they have already read, they keep. Nothing can take it back — not this app, not the server.',
  evict_fact_future: 'What comes next is out of their reach',
  evict_fact_past: 'What they have read stays theirs',
  evict_explain_final:
    'This cannot be undone: bringing them back needs a new invitation.',
  evict_confirm: 'Yes, remove this person',
  evict_cancel: 'Cancel',
  evict_working: 'Working…',
  evict_done: 'Done. The key has been replaced.',
  evict_done_no_key: 'Done. There was no key of that device to replace.',
  evict_failed_nothing_changed:
    'That did not go through, and nothing changed. You can try again.',
  evict_failed_key_still_valid:
    'They are out, but the key could not be replaced: they can still read what is said. Try again.',
  promise_thesis: 'The messenger that asks you for nothing.',
  promise_subtitle:
    'No number, no account, no password. Someone invites you, you write.',
  promise_point_encrypted: 'End-to-end encrypted, with nothing to set',
  promise_point_no_harvest: 'No address book harvested, no advertising',
  promise_point_agents: 'Agents here are declared participants',
  promise_point_invitation: 'You enter by invitation, not by form',
  promise_action: 'Begin',
  list_title: 'Conversations',
  list_invitation_used:
    'You opened an invitation. The conversation it opens will appear in your list.',
  list_invitation_refused:
    'This invitation could not be used. Ask the person who sent it for a new one.',
  'list_invitation_already %@':
    'You already have a conversation with %@. That one carries on: the invitation did not open a second.',
  list_not_in_yet:
    'You are not in yet. Open the invitation link somebody sent you: it is the only door, and the application can do nothing before it.',
  list_reinstalled_back:
    'This device was reinstalled. It has come back under a new device identity, and messages received before the reinstall stay unreadable: their keys went with the old installation.',
  list_reinstalled_stranded:
    'This device has lost its encryption keys, most likely in a reinstall. Messages received before are unreadable and cannot be recovered. To write here again you need a new invitation.',
  list_empty: 'No conversations yet. Invite someone to start one.',
  list_nothing_said: 'Nothing has been said yet',
  list_unreadable: 'This device cannot read the last message',
  list_unreachable: 'This conversation could not be read back',
  list_name_action: 'Give a name',
  list_name_title: 'What do you call this person?',
  list_name_hint:
    'This name stays on this device. Neither the server nor the person you are writing to sees it.',
  list_name_placeholder: 'A first name, a nickname',
  list_name_confirm: 'Save',
  list_name_cancel: 'Cancel',
  list_back: 'Conversations',
  invite_action: 'Invite someone',
  invite_who: 'Who are you inviting?',
  invite_working: 'Creating the conversation…',
  invite_ready:
    'Send this link to them. It is valid for an hour and works once.',
  invite_qr: 'Or let them scan this code.',
  invite_qr_label: 'QR code of the invitation link',
  invite_share: 'Share the link',
  invite_close: 'Close',
  invite_failed: 'The invitation could not be created.',
  invite_waiting: 'Nobody has opened the link yet.',
  invite_admitted: 'Done: this person can come in.',
  list_name_not_kept:
    'The name could not be kept: it will be forgotten at the next launch.',
  settings_action: 'Settings',
  settings_title: 'Settings',
  settings_legal: 'Legal information',
  settings_disturb: 'Ring during Do Not Disturb',
  settings_disturb_hint:
    'Without this, Android silences Messagr’s calls whenever the mode is on. The screen that opens lists every application: find Messagr and turn the access on.',
  settings_nothing_else:
    'There is nothing else here for now. Settings this version does not carry yet are absent rather than present and inert.',
  legal_title: 'Legal information',
  legal_intro:
    'What this app shows is what stands. The terms published at messagr.eu restate what follows and add what a screen cannot carry: who operates the service, and under which law.',
  legal_forbidden_title: 'What is forbidden',
  legal_forbidden_body:
    'Child sexual abuse material, threats against a person’s life or safety, harassment, impersonation, and any other content illegal under French or European law.',
  legal_forbidden_entry:
    'Entry is by named invitation only. An invitation is personal, limited in use, and not for resale. The minimum age is fifteen.',
  legal_moderation_title: 'How moderation actually works',
  legal_moderation_human:
    'Moderation is done by the server’s administrators. They are people. Every decision is taken by a person, never by an automatism.',
  legal_moderation_no_tools:
    'There is no automatic detection tool, no filter, no content analysis, and there cannot be: content is end-to-end encrypted, and the operator holds messages it is cryptographically unable to read.',
  legal_moderation_reported:
    'Nothing is examined that a person has not reported. There is no general monitoring, no proactive detection, and no algorithmic ranking.',
  legal_moderation_can:
    'What the operator can decide without reading: suspend an account, take away its ability to issue invitations, remove it from a group, revoke a branch of invitations.',
  legal_moderation_cannot:
    'What it cannot do: take down a particular message, characterise a piece of content, or establish by reading that a rule was broken.',
  legal_report_title: 'Reporting, and what follows',
  legal_report_how:
    'Reports go by email to conformite@messagr.eu. Reporting from inside the app does not exist yet, and saying so is better than promising it.',
  legal_report_delay:
    'A report produces a reference. It receives an acknowledgement, then a reasoned decision within thirty days of receipt at the latest, with the route to contest it. Reporting a threat to life or safety to the authorities does not wait for that deadline: it goes immediately.',
  legal_report_review:
    'A decision can be contested at conformite@messagr.eu, quoting the reference. It is re-examined by someone other than whoever took it whenever the organisation allows. On a service run by one or two people that condition cannot always be met, and writing this down is better than promising a separation that would not exist.',
  legal_report_scope:
    'Messagr is a hosting service and not an online platform, recital 14 of the DSA excluding interpersonal messaging services. Articles 20 and 21 therefore do not apply, and this text does not claim to offer them.',
  legal_full_terms: 'Full terms and conditions: messagr.eu',
  trust_action: 'What is known about this person',
  trust_title: 'What is known about this person',
  trust_calm:
    'This is not an alert. Your messages have been end-to-end encrypted since the first one, and that does not depend on anything below. What follows is about certainty as to the person, not about the encryption.',
  trust_state_nothing: 'Nothing establishes yet who this person is.',
  trust_state_vouched: 'Someone who was already here vouched for this person.',
  trust_state_confirmed:
    'One of their devices was confirmed from this one, in person.',
  trust_devices_title: 'Their devices',
  'trust_devices %d': '%d device(s) known to this account.',
  'trust_claimed %d':
    'This person has signed %d of them as their own. That is what their account asserts, and it does not say who holds that account.',
  'trust_confirmed %d': '%d were confirmed from here, in person.',
  trust_none_confirmed:
    'None has been confirmed from here. That is the normal starting state.',
  trust_vouch_title: 'What vouching establishes',
  trust_vouch_means:
    'Someone already present judged that they knew who was coming in, and opened the door. That is a human judgement and nothing more: nothing was established by cryptography. An account can be held by somebody else without that judgement knowing anything about it.',
  trust_raise_title: 'What would settle the doubt',
  trust_raise_how:
    'Compare a short string of words with this person, out loud, or scan their code in their presence. Two minutes, once and for all.',
  trust_raise_missing:
    'That gesture is not built in this app yet. Saying so is better than showing a button that would do nothing.',
  reaction_offer: 'React to this message',
  message_sent: 'Sent',
  message_read: 'Read',
  settings_receipts: 'Read receipts',
  settings_receipts_hint: 'Public: the server learns who read what, and when.',
  settings_receipts_on: 'On',
  settings_receipts_off: 'Off',
  settings_receipts_not_kept:
    'This choice could not be kept: it will return to its previous state at the next launch.',
  day_short_0: 'Sun',
  day_short_1: 'Mon',
  day_short_2: 'Tue',
  day_short_3: 'Wed',
  day_short_4: 'Thu',
  day_short_5: 'Fri',
  day_short_6: 'Sat',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d/%2$d',
  list_no_directory:
    'No phone number appears anywhere in the system. You only come into contact by invitation.',
  calls_empty: 'No calls yet.',
  calls_video: 'Video',

  pick_title: 'To which conversation?',
  pick_cancel: 'Cancel',
  pick_empty: 'You have no other conversation.',
  'calls_ring_back %@': 'Call %@ back',
  'calls_lasted %@': 'Lasted %@',
  calls_taken: 'Incoming call',
  calls_placed: 'Outgoing call',
  calls_missed: 'Missed call',
  calls_no_answer: 'No answer',
  calls_declined: 'Declined',
  calls_you_declined: 'You declined',
  calls_unplaced: 'Could not be placed',
  calls_soon_title: 'Coming: audio calls, then video',
  calls_soon_why:
    'The tab is held from V1 so the bar does not move later. V1 carries text, links and still images only; voice messages in V2, one-to-one then group calls in V3.',
  calls_soon_v2: 'V2 · voice messages',
  calls_soon_v3: 'V3 · audio + video',
  // A call in progress. One screen draws every one of these -- see
  // `CallScreen.tsx` -- so what changes between two states is exactly this
  // sentence and which buttons sit under it.
  call_start: 'Call',
  call_start_video: 'Video call',
  call_ringing: 'Calling…',
  call_incoming: 'Incoming call',
  call_incoming_video: 'Incoming video call',
  call_answer_video: 'Answer with video',
  call_answer_audio: 'Answer without video',
  call_connecting: 'Connecting…',
  call_active: 'In call',
  call_reconnecting: 'Reconnecting…',
  call_ended_hung_up: 'Call ended',
  call_ended_unanswered: 'Nobody answered',
  call_ended_declined: 'Call declined',
  call_ended_failed: 'The connection could not be made',
  call_ended_elsewhere: 'Answered on another device',
  call_ended_unreachable: 'Could not reach them',
  call_answer: 'Answer',
  call_reject: 'Decline',
  call_hangup: 'Hang up',
  call_mute: 'Mute',
  call_unmute: 'Unmute',
  call_speaker: 'Speaker',
  call_camera_on: 'Camera',
  call_camera_off: 'Turn camera off',
  call_switch_camera: 'Flip',
  call_their_camera_off: 'Their camera is off',
  call_failed_no_relay:
    'This server has no call relay: the call could not be placed.',
  call_failed_no_microphone: 'The microphone is not available.',
  community_soon_title: 'Coming: communities and rooms',
  community_soon_why:
    'A community groups rooms under a pseudonymous object. The tab is held for the same reason as the calls one: the bar must not move when they arrive.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'View photo',
  plate_close: 'Close',
  'plate_of %1$d %2$d': '%1$d of %2$d',
  'plate_sending %1$d %2$d': 'Sending %1$d of %2$d…',
  'plate_partly %1$d': '%1$d photos sent. The rest could not go.',
  plate_too_many: 'Too many photos at once. Fifty at most.',
  composer_emoji: 'Emoji',
  composer_photo: 'Add a photo',
  composer_document: 'Add a document',
  composer_attach: 'Attach',
  share_not_yet: 'This file was not sent, and Messagr did not keep it.',
  share_too_large: 'This file is too large to send.',
  share_unreadable: 'This file could not be read.',
  composer_record: 'Voice message',
  composer_send: 'Send',
  composer_record_soon:
    'Voice messages arrive in V2. The button holds its place so the bar does not move that day.',
  person_open: 'About this person',
  person_title: 'This person',
  person_back: 'Back',
  message_delivered_hint: 'Handed to the server',
  message_read_hint: 'Read',
  settings_open: 'Open',
  settings_full_screen: 'Full-screen calls',
  settings_full_screen_hint:
    'An incoming call takes the whole screen, even locked, instead of one more notification line. Android reserves this for telephone applications: the screen that opens is where you grant it.',
  settings_wake: 'Notifications',
  settings_wake_hint:
    'The wake-up signal carries no sender and no message. The device decrypts here.',
  settings_wake_on: 'On',
  settings_wake_off: 'Off',
  settings_wake_not_kept:
    'This choice could not be kept: it will return to its previous state at the next launch.',
  promise_language: 'Choose your language',
  promise_terms: 'I accept Messagr’s terms and conditions of use.',
  promise_terms_link: 'Read the terms',
  promise_terms_required:
    'Tick the box to continue. Nothing starts before that.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Something arrived.',
  notify_channel: 'Messages',
  notify_ringing_body: 'Incoming call',
  notify_ringing_video_body: 'Incoming video call',
  'notify_missed %1$d %2$d': 'Missed call at %1$d:%2$d',
  notify_ringing_channel: 'Calls',
  notify_answer: 'Answer',
  notify_decline: 'Decline',
  image_alt: 'Photo',
  image_unreadable: 'This photo could not be opened on this device.',
  file_kept: 'Document saved where you chose.',
  file_keep_failed: 'The document could not be saved.',
  'file_size_kb %@': '%@ KB',
  'file_size_mb %@': '%@ MB',
  conversation_attach: 'Send a photo',
  conversation_attaching: 'Encrypting and sending the photo…',
  'list_unread %1$d': '%1$d unread messages',
  list_nobody_else: 'Nobody else here',
  list_nobody_joined: 'Nobody joined this conversation',
  invite_open: 'Invite someone',
  settings_backup: 'Message backup',
  backup_settings_on:
    'Your messages are kept on the server, closed by your recovery key.',
  backup_settings_off:
    'Your messages are not backed up. Reinstalling Messagr would lose everything that was said.',
  'backup_settings_progress %1$d %2$d': '%1$d keys backed up out of %2$d',
  backup_settings_catching_up:
    'The rest goes as the conversations sync. Nothing is lost in the meantime.',
  backup_settings_reading: 'Reading the state of the backup…',
  backup_settings_unreadable:
    'The state of the backup could not be read on this device.',
  backup_settings_unreadable_why:
    'That says nothing about the backup itself: if it was on, it still is, and nothing here was changed.',
  backup_settings_retry: 'Try again',
  backup_settings_enable: 'Back up my messages',
  backup_settings_never_shown:
    'Your current key cannot be shown again, here or anywhere else.',
  backup_settings_replace: 'Replace my recovery key',
  backup_settings_replace_why:
    'Do this if you have lost your key or wrote it down badly. A new key will be shown once, and the old one will stop opening anything.',
  backup_offer_title: 'Get your messages back if you lose this telephone',
  backup_offer_lead:
    'The keys that open your conversations exist on this device and nowhere else. Messagr can keep a copy on the server, closed by a key only you hold.',
  backup_offer_loss:
    'Without it, reinstalling Messagr loses everything that was said. The account comes back; the messages stay unreadable.',
  backup_offer_scope:
    'The backup keeps the messages. The names you give, your favourites and your read marks stay on this device and go with it.',
  backup_offer_trust:
    'The server cannot read the backup. It also cannot prove nothing in it was replaced: anyone who got your account or the server could slip other keys in, with nothing to say so.',
  backup_offer_accept: 'Back up my keys',
  backup_offer_refuse: 'Not now',
  backup_offer_later: 'You can turn it on later from Settings.',
  backup_replace_title: 'Replace your recovery key',
  backup_replace_lead: 'Before you decide, what this carries away.',
  backup_replace_fact_old: 'The old key will open nothing',
  backup_replace_old_body:
    'The backup it opened is taken off the server. If you wrote it down somewhere you no longer control, that piece of paper is now worth nothing — which is the point.',
  backup_replace_fact_new: 'The new one is shown once',
  backup_replace_new_body:
    'As the first was. Have something to write it on before you go on.',
  backup_replace_final:
    'Your messages stay backed up, under the new key. The old one does not come back.',
  backup_replace_confirm: 'Yes, replace my key',
  backup_replace_cancel: 'Cancel',
  backup_replace_working: 'Replacing…',
  backup_replace_failed:
    'The replacement did not go through, and nothing changed: your old key still opens your backup.',
  backup_key_old_still_opens:
    'The old key could not be retired: it still opens the old backup. You can start again from Settings.',
  backup_key_title: 'Your recovery key',
  backup_key_lead: 'Copy it now and keep it in a password manager.',
  backup_key_once:
    'It will never be shown again. Without it, the backup does not open.',
  backup_key_copy: 'Copy the key',
  backup_key_copied: 'Key copied.',
  backup_key_done: 'I have put my key away',
  restore_offer_title: 'Your older messages are here',
  restore_offer_lead:
    'This device cannot open them: the keys that did went with the previous installation.',
  'restore_offer_scope %1$d': '%1$d conversations are in that state.',
  restore_offer_have:
    'There is a backup on the server. Your recovery key opens them again, here, with nothing to reinstall.',
  restore_offer_accept: 'Enter my recovery key',
  restore_offer_refuse: 'Later',
  restore_offer_later:
    'You can do it from Settings. Without the key the application works: it is the past that stays shut, not the present.',
  restore_key_title: 'Your recovery key',
  restore_key_lead: 'The one you were shown once.',
  restore_key_field: 'Paste or type the key',
  restore_key_confirm: 'Open my messages again',
  restore_key_cancel: 'Cancel',
  restore_key_working: 'Opening…',
  restore_key_not_a_key:
    'That is not a recovery key. Part of the pasted line may be missing.',
  restore_key_wrong:
    'This key does not open this backup. It may be one from another account.',
  restore_key_failed: 'The backup could not be downloaded. Try again.',
  'restore_done %1$d':
    '%1$d keys came back. Your older messages are readable again.',
  restore_done_none:
    'The backup opened, but it held no key for anything this device is showing.',
  vault_title: 'A key vault, to keep where you like',
  vault_lead:
    'A file holding the keys to your conversations, closed by a passphrase of your own.',
  vault_standard:
    'It is the standard Matrix format: any Matrix client opens it, Element included. It is not a file only Messagr can read.',
  vault_worth:
    'This file opens everything that was said. It is worth what the place you put it is worth.',
  vault_not_export:
    'It is not an export of your data: a vault holds keys, an export holds messages.',
  vault_passphrase_field: 'A passphrase for this file',
  vault_passphrase_hint:
    'Different from your recovery key, and written down somewhere else. Without it the file does not open — not even by us.',
  vault_create: 'Create the vault',
  vault_working: 'Preparing the vault…',
  vault_failed: 'The vault could not be created.',
  vault_cancel: 'Cancel',
  vault_open_title: 'Open a key vault',
  vault_open_lead:
    'A file made by Messagr or by another Matrix client. It will make readable the conversations it holds the keys to.',
  vault_open_choose: 'Choose a file',
  vault_open_passphrase: 'The passphrase for this file',
  vault_open_working: 'Opening the vault…',
  vault_open_wrong: 'That passphrase does not open this file.',
  vault_open_not_a_vault: 'This file is not a key vault.',
  vault_open_failed: 'The vault could not be opened. Try again.',
  'vault_opened %1$d':
    '%1$d keys came back. The conversations they open are readable again.',
  vault_opened_none:
    'The vault opened, but it held no key this device did not already have.',
  settings_vault: 'Key vault',
  settings_vault_hint:
    'A file, for somebody who wants nothing left on a server.',
  restore_done_close: 'Close',
  settings_restore: 'Get my older messages back',
  settings_restore_hint: 'If you have your recovery key.',
  back_to_newest: 'Back to the latest message',
}
