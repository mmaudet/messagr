import type { CopyKey } from './fr'

/**
 * The product’s Spanish copy.
 *
 * Translated from the French, which is the authoritative version. Several
 * strings are arguments rather than labels and are translated as arguments:
 * the same claim, made as plainly in Spanish as it is in French.
 *
 * `usted` throughout, as the French uses `vous`: a messenger addressing
 * somebody it has never met, about what a server can and cannot read, is not
 * the place to be familiar.
 *
 * The two legal strings want a lawyer’s eye before the store listing goes
 * out; `en.ts` says the same and for the same reason.
 */
export const es: Readonly<Record<CopyKey, string>> = {
  shell_title: 'Messagr',
  'core_version_label %@': 'Versión del núcleo: %@',
  presence_online: 'en línea',
  message_placeholder: 'Mensaje',
  today: 'Hoy',
  yesterday: 'Ayer',
  titlebar_invite: 'Invitar a alguien',
  titlebar_back: 'Volver a las conversaciones',
  date_separator: '%1$d de %2$@ de %3$d',
  month_1: 'enero',
  month_2: 'febrero',
  month_3: 'marzo',
  month_4: 'abril',
  month_5: 'mayo',
  month_6: 'junio',
  month_7: 'julio',
  month_8: 'agosto',
  month_9: 'septiembre',
  month_10: 'octubre',
  month_11: 'noviembre',
  month_12: 'diciembre',
  sunday: 'Domingo',
  tab_discussions: 'Chats',
  tab_communities: 'Comunidades',
  tab_calls: 'Llamadas',
  tab_settings: 'Ajustes',
  room_list_subtitle: 'Las conversaciones de esta cuenta',
  room_list_untitled: 'Sin nombre, y nadie más conocido aquí',
  people_separator: ', ',
  room_list_nothing_yet:
    'No se ha recibido nada desde que se abrió la aplicación',
  room_list_empty: 'Este dispositivo no conoce ninguna conversación por ahora.',
  room_list_opening: 'Abriendo la conversación…',
  titlebar_new_conversation: 'Nueva conversación',
  new_conversation_title: 'Nueva conversación',
  new_conversation_subtitle:
    'Invitar a alguien, o hablar con alguien que ya conoce',
  new_conversation_invite_section: 'Invitar',
  new_conversation_invite_label: 'Invitar a alguien',
  new_conversation_invite_hint: 'Crea un enlace de invitación para entregarle.',
  new_conversation_people_section: 'Personas',
  new_conversation_no_people: 'Este dispositivo no conoce a nadie por ahora.',
  new_conversation_no_conversation:
    'No hay ninguna conversación cara a cara con esta persona en este dispositivo. La aplicación todavía no sabe abrir una: invítela para empezar.',
  person_name_action: 'Poner un nombre',
  person_name_title: 'Poner un nombre',
  person_name_field: 'Nombre',
  person_name_local:
    'Este nombre se queda en este dispositivo. No se envía nunca al servidor, y no lo encontrará en otro dispositivo.',
  person_name_save: 'Guardar',
  person_name_remove: 'Quitar este nombre',
  reserved_calls_promise:
    'Las llamadas de audio se hacen desde cada conversación cara a cara. El registro de llamadas todavía no está construido.',
  reserved_generic_promise: 'Esta pantalla todavía no está construida.',
  titlebar_call: 'Llamar',
  settings_subtitle: 'Privacidad, recuperación, supervisión',
  settings_row_chevron: '›',
  settings_section_account_title: 'Cuenta y dispositivo',
  settings_section_account_note:
    'Lo que le identifica, y lo que le permite volver.',
  settings_row_lang_label: 'Idioma de la aplicación',
  settings_row_lang_hint: 'Español · seis idiomas, elegidos al primer arranque',
  settings_row_recovery_label: 'Recuperación de la cuenta',
  settings_row_recovery_hint:
    'Clave de recuperación · validación por alguien cercano, caja con PIN (V1.1) · sin depósito: nadie más guarda la clave de sus mensajes',
  settings_row_minor_label: 'Cuenta de un menor',
  settings_row_minor_hint:
    'Estimación de edad, representante legal, información DSA',
  settings_section_privacy_title: 'Privacidad',
  settings_section_privacy_note:
    'Por defecto no sale nada, y nadie le encuentra.',
  settings_row_chat_label: 'Privacidad de los grupos',
  settings_row_chat_hint: 'Ningún identificador visible · reenvíos limitados',
  settings_row_ephemeral_label: 'Mensajes efímeros',
  settings_row_ephemeral_hint:
    'Ajuste por conversación · 24 horas por defecto en modo adolescente',
  settings_row_discovery_label: 'Descubrimiento privado de contactos',
  settings_row_discovery_hint:
    'V1.1 · local, opcional · reciprocidad sin decidir',
  settings_section_moderation_title: 'Grupos y moderación',
  settings_section_moderation_note:
    'Herramientas pensadas para una persona voluntaria, no para administrar sistemas.',
  settings_row_govern_label: 'Gobernanza y roles',
  settings_row_govern_hint:
    'Roles, cupo de invitaciones, revocación de una rama',
  settings_row_report_label: 'Denunciar, bloquear, salir',
  settings_row_report_hint:
    'Motivo, adjuntos, acuse de recibo · vista de moderación',
  settings_row_teen_label: 'Modo adolescente y supervisión',
  settings_row_teen_hint: 'Ajustes restrictivos por defecto',
  settings_row_legal_label: 'Información legal',
  settings_row_legal_hint:
    'Lo que está prohibido, cómo decide la moderación, cómo recurrir',
  settings_section_sharing_title: 'Compartir y datos',
  settings_section_sharing_note:
    'Sus conversaciones siguen siendo archivos que puede llevarse.',
  settings_row_share_label: 'Compartir desde otra aplicación',
  settings_row_share_hint:
    'Hoja del sistema en iOS y Android · enviar sin abrir Messagr',
  settings_row_export_label: 'Exportar mis conversaciones',
  settings_row_export_hint: 'Formato abierto y documentado, sin soporte',
  settings_section_automation_title: 'Automatizaciones',
  settings_section_automation_note:
    'Sitio reservado en el producto, fuera de lo que entrega la V1.',
  settings_row_bot_label: 'Bots del grupo',
  settings_row_bot_hint:
    'Motor a la vista · cualquier administración puede quitarlo',
  settings_row_api_label: 'Tokens de API y aplicaciones',
  settings_row_api_hint: 'Permisos limitados · revocables en cualquier momento',
  settings_row_not_yet: 'Todavía no',
  settings_version_footer: 'messagr %1$@ (%2$@)',
  language_endonym: 'Español',
  'conversation_sender_claimed %@': 'Se presenta como %@',
  conversation_send: 'Enviar',
  conversation_empty: 'Aquí todavía no se ha dicho nada.',
  conversation_unreadable:
    'Ilegible en este dispositivo: su clave nunca llegó.',
  conversation_sending: 'Enviando…',
  conversation_send_failed: 'No enviado. Inténtelo de nuevo.',
  vouch_action: 'Respondo por esta persona',
  vouch_hint: 'Hágalo cuando esté seguro de saber quién le escribe — no antes.',
  vouch_explain_title: 'Lo que esto hace',
  vouch_explain_history:
    'Podrá leer todo lo que se ha dicho aquí desde el principio, incluso antes de su llegada.',
  vouch_explain_history_empty:
    'Aquí todavía no se ha dicho nada, así que no hay pasado que transmitirle.',
  vouch_explain_invite: 'Podrá invitar a otras personas.',
  vouch_explain_final:
    'Esto no se deshace: las claves que reciba, se las queda.',
  vouch_confirm: 'Sí, respondo por esta persona',
  vouch_cancel: 'Cancelar',
  vouch_working: 'En curso…',
  vouch_done: 'Hecho. Tiene el historial y puede invitar.',
  vouch_done_no_history:
    'Hecho. Puede invitar; no había pasado que transmitir.',
  vouch_failed_nothing_changed:
    'No ha salido bien, y para ella no ha cambiado nada. Puede intentarlo de nuevo.',
  vouch_history_arrived:
    'Alguien ha respondido por usted: el pasado de esta conversación le es ahora legible.',
  vouch_history_untrusted:
    'Se le ha ofrecido un pasado, desde un dispositivo que este no sabe atribuir a su propietario. No se ha aceptado.',
  evict_action: 'Retirar a esta persona',
  evict_hint: 'Ya no podrá leer nada de lo que se diga aquí a partir de ahora.',
  evict_explain_title: 'Lo que esto hace',
  evict_explain_future:
    'Saldrá de la conversación y ya no podrá leer lo que se diga en ella.',
  evict_explain_past:
    'Lo que ya ha leído, se lo queda. Nada puede quitárselo — ni esta aplicación, ni el servidor.',
  evict_explain_final:
    'Esto no se deshace: para que vuelva hará falta una nueva invitación.',
  evict_confirm: 'Sí, retirar a esta persona',
  evict_cancel: 'Cancelar',
  evict_working: 'En curso…',
  evict_done: 'Hecho. La clave ha sido reemplazada.',
  evict_done_no_key:
    'Hecho. No había ninguna clave de ese dispositivo que reemplazar.',
  evict_failed_nothing_changed:
    'No ha salido bien, y no ha cambiado nada. Puede intentarlo de nuevo.',
  evict_failed_key_still_valid:
    'Ha salido, pero la clave no se ha podido reemplazar: todavía puede leer lo que se diga. Inténtelo de nuevo.',
  promise_thesis: 'La mensajería que no le pide nada.',
  promise_subtitle:
    'Sin número, sin cuenta, sin contraseña. Alguien le invita, usted escribe.',
  promise_point_encrypted: 'Cifrada de extremo a extremo, sin nada que ajustar',
  promise_point_no_harvest: 'Ninguna agenda aspirada, ninguna publicidad',
  promise_point_agents: 'Los agentes son aquí participantes declarados',
  promise_point_invitation: 'Se entra por invitación, no por formulario',
  promise_action: 'Empezar',
  list_title: 'Conversaciones',
  list_empty:
    'Ninguna conversación por ahora. Invite a alguien para empezar una.',
  list_nothing_said: 'Todavía no se ha dicho nada',
  list_unreadable: 'Este dispositivo no puede leer el último mensaje',
  list_unreachable: 'No se ha podido releer esta conversación',
  list_name_action: 'Poner un nombre',
  list_name_title: '¿Cómo llama a esta persona?',
  list_name_hint:
    'Este nombre se queda en este dispositivo. Ni el servidor ni su interlocutor lo ven.',
  list_name_placeholder: 'Un nombre, un apodo',
  list_name_confirm: 'Guardar',
  list_name_cancel: 'Cancelar',
  list_back: 'Conversaciones',
  invite_action: 'Invitar a alguien',
  invite_who: '¿A quién invita?',
  invite_working: 'Creando la conversación…',
  invite_ready: 'Envíele este enlace. Vale una hora y sirve una sola vez.',
  invite_qr: 'O deja que escaneen este código.',
  invite_qr_label: 'Código QR del enlace de invitación',
  invite_share: 'Compartir el enlace',
  invite_close: 'Cerrar',
  invite_failed: 'No se ha podido crear la invitación.',
  invite_waiting: 'Todavía nadie ha abierto el enlace.',
  invite_admitted: 'Hecho: esta persona puede entrar.',
  list_name_not_kept:
    'El nombre no se ha podido conservar: se olvidará en el próximo arranque.',
  settings_action: 'Ajustes',
  settings_title: 'Ajustes',
  settings_legal: 'Información legal',
  settings_nothing_else:
    'Aquí no hay nada más por ahora. Los ajustes que esta versión todavía no lleva están ausentes en lugar de presentes e inertes.',
  legal_title: 'Información legal',
  legal_intro:
    'Lo que muestra esta aplicación es lo que vale. Las condiciones publicadas en messagr.eu recogen lo que sigue y añaden lo que una pantalla no puede llevar: quién explota el servicio, y bajo qué derecho.',
  legal_forbidden_title: 'Lo que está prohibido',
  legal_forbidden_body:
    'Los contenidos de abuso sexual infantil, las amenazas contra la vida o la seguridad de una persona, el acoso, la suplantación de identidad, y cualquier otro contenido ilegal según el derecho francés o europeo.',
  legal_forbidden_entry:
    'Solo se entra por invitación nominativa. Una invitación es personal, de uso limitado, y no se revende. La edad mínima es de quince años.',
  legal_moderation_title: 'Cómo funciona realmente la moderación',
  legal_moderation_human:
    'La moderación es la de las personas que administran el servidor. Son personas. Toda decisión la toma una persona, nunca un automatismo.',
  legal_moderation_no_tools:
    'No existe ninguna herramienta automática de detección, ningún filtro, ningún análisis de contenido, y no puede existir: el contenido está cifrado de extremo a extremo y quien explota el servicio guarda mensajes que le es criptográficamente imposible leer.',
  legal_moderation_reported:
    'No se examina nada que no haya sido denunciado por una persona. No hay vigilancia general, ni detección proactiva, ni clasificación algorítmica.',
  legal_moderation_can:
    'Lo que quien explota el servicio puede decidir sin leer: suspender una cuenta, quitarle la capacidad de emitir invitaciones, excluirla de un grupo, revocar una rama de invitaciones.',
  legal_moderation_cannot:
    'Lo que no puede hacer: retirar un mensaje concreto, calificar un contenido, o establecer leyendo que se ha infringido una norma.',
  legal_report_title: 'Denunciar, y lo que viene después',
  legal_report_how:
    'La denuncia se hace por correo a conformite@messagr.eu. El gesto desde la aplicación todavía no existe, y decirlo vale más que prometerlo.',
  legal_report_delay:
    'Una denuncia produce una referencia. Recibe un acuse de recibo, y después una decisión motivada a más tardar treinta días después de su recepción, con la vía para recurrirla. La denuncia a las autoridades de una amenaza para la vida o la seguridad no sigue ese plazo: sale sin esperar.',
  legal_report_review:
    'Una decisión puede recurrirse ante conformite@messagr.eu, citando la referencia. La reexamina una persona distinta de quien la tomó siempre que la organización lo permita. En un servicio explotado por una o dos personas, esa condición no siempre puede cumplirse, y escribirlo vale más que prometer una separación que no existiría.',
  legal_report_scope:
    'Messagr es un servicio de alojamiento y no una plataforma en línea; el considerando 14 del DSA excluye los servicios de comunicaciones interpersonales. Los artículos 20 y 21 no se aplican, por tanto, y este texto no pretende ofrecerlos.',
  legal_full_terms: 'Condiciones generales completas: messagr.eu',
  trust_action: 'Lo que se sabe de esta persona',
  trust_title: 'Lo que se sabe de esta persona',
  trust_calm:
    'Esto no es una alerta. Sus mensajes están cifrados de extremo a extremo desde el primero, y eso no depende de nada de lo que sigue. Lo que sigue habla de la certeza sobre la persona, no del cifrado.',
  trust_state_nothing: 'Todavía nada establece quién es esta persona.',
  trust_state_vouched:
    'Alguien que ya estaba aquí ha respondido por esta persona.',
  trust_state_confirmed:
    'Uno de sus dispositivos ha sido confirmado desde este, en persona.',
  trust_devices_title: 'Sus dispositivos',
  'trust_devices %d': '%d dispositivo(s) conocido(s) por esta cuenta.',
  'trust_claimed %d':
    'Esta persona ha firmado %d de ellos como suyos. Es lo que afirma su cuenta, y no dice quién tiene esa cuenta.',
  'trust_confirmed %d': '%d han sido confirmados desde aquí, en persona.',
  trust_none_confirmed:
    'Ninguno ha sido confirmado desde aquí. Es el estado de partida normal.',
  trust_vouch_title: 'Lo que establece «responder por alguien»',
  trust_vouch_means:
    'Una persona ya presente ha considerado que sabía quién entraba, y le ha abierto la puerta. Es un juicio humano, y nada más: la criptografía no ha establecido nada. Una cuenta puede estar en manos de otra persona sin que ese juicio sepa nada de ello.',
  trust_raise_title: 'Lo que despejaría la duda',
  trust_raise_how:
    'Comparar una serie corta de palabras con esta persona, de viva voz, o escanear su código en su presencia. Dos minutos, de una vez por todas.',
  trust_raise_missing:
    'Ese gesto todavía no está construido en esta aplicación. Decirlo vale más que mostrar un botón que no haría nada.',
  reaction_offer: 'Reaccionar a este mensaje',
  message_sent: 'Enviado',
  message_read: 'Leído',
  settings_receipts: 'Confirmaciones de lectura',
  settings_receipts_hint:
    'Público: el servidor sabe quién ha leído qué, y cuándo.',
  settings_receipts_on: 'Activadas',
  settings_receipts_off: 'Desactivadas',
  settings_receipts_not_kept:
    'Esta elección no se ha podido conservar: volverá a su estado anterior en el próximo arranque.',
  day_short_0: 'dom',
  day_short_1: 'lun',
  day_short_2: 'mar',
  day_short_3: 'mié',
  day_short_4: 'jue',
  day_short_5: 'vie',
  day_short_6: 'sáb',
  'when_time %1$d %2$d': '%1$d:%2$d',
  'when_date %1$d %2$d': '%1$d/%2$d',
  list_no_directory:
    'Ningún número de teléfono aparece en ninguna parte del sistema. Solo se entra en contacto por invitación.',
  calls_soon_title: 'Pronto: llamadas de audio, luego vídeo',
  calls_soon_why:
    'La pestaña está reservada desde la V1 para no mover la barra más tarde. La V1 solo transporta texto, enlaces e imágenes fijas; notas de voz en V2, llamadas individuales y luego de grupo en V3.',
  calls_soon_v2: 'V2 · notas de voz',
  calls_soon_v3: 'V3 · audio + vídeo',
  community_soon_title: 'Pronto: comunidades y salas',
  community_soon_why:
    'Una comunidad agrupa salas bajo un objeto seudónimo. La pestaña está reservada por la misma razón que la de las llamadas: la barra no debe moverse cuando lleguen.',
  brand_name: 'Messagr',
  'plate_more %1$d': '+ %1$d',
  plate_open: 'Ver la foto',
  plate_close: 'Cerrar',
  'plate_of %1$d %2$d': '%1$d de %2$d',
  'plate_sending %1$d %2$d': 'Enviando %1$d de %2$d…',
  'plate_partly %1$d': '%1$d fotos enviadas. Las demás no han podido salir.',
  plate_too_many: 'Demasiadas fotos a la vez. Cincuenta como máximo.',
  composer_emoji: 'Emojis',
  composer_photo: 'Añadir una foto',
  composer_record: 'Nota de voz',
  composer_record_soon:
    'Las notas de voz llegan en la V2. El botón guarda su sitio para que la barra no se mueva ese día.',
  person_open: 'Sobre esta persona',
  person_title: 'Esta persona',
  person_back: 'Volver',
  message_delivered_hint: 'Entregado al servidor',
  message_read_hint: 'Leído',
  settings_wake: 'Notificaciones',
  settings_wake_hint:
    'La señal de despertar no lleva remitente ni mensaje. El dispositivo descifra aquí.',
  settings_wake_on: 'Activadas',
  settings_wake_off: 'Desactivadas',
  settings_wake_not_kept:
    'Esta elección no se ha podido conservar: volverá a su estado anterior en el próximo arranque.',
  promise_language: 'Elija su idioma',
  promise_terms: 'Acepto las condiciones generales de uso de Messagr.',
  promise_terms_link: 'Leer las condiciones',
  promise_terms_required:
    'Marque la casilla para continuar. Antes no arranca nada.',
  notify_blind_title: 'Messagr',
  notify_blind_body: 'Ha llegado algo.',
  notify_channel: 'Mensajes',
  image_alt: 'Foto',
  image_unreadable: 'Esta foto no se ha podido abrir en este dispositivo.',
  conversation_attach: 'Enviar una foto',
  conversation_attaching: 'Cifrando y enviando la foto…',
  'list_unread %1$d': '%1$d mensajes sin leer',
  invite_open: 'Invitar a alguien',
}
