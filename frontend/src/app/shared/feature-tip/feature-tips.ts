/**
 * Qué hace cada funcionalidad, para la burbuja que aparece al pasar el mouse
 * (directiva [appFeatureTip]). La clave es la misma de NEW_FEATURES: mientras
 * es nueva, la burbuja lleva la etiqueta NUEVO. En el texto, "{campana}" se
 * dibuja como la campanita de las notificaciones (la del encabezado).
 */
export interface FeatureTip {
  title: string;
  text: string;
  /** Puntos cortos: cómo se usa o qué conviene saber. */
  points?: string[];
}

export const FEATURE_TIPS: Record<string, FeatureTip> = {
  'seguir-mto': {
    title: 'Seguir este MTO',
    text: 'Te avisamos en el ícono de notificaciones {campana} cuando llegue un MTO que cite a este o una corrección (SVC).',
    points: [
      'También te avisa de las respuestas a esas respuestas.',
      'Tocalo de nuevo para dejar de seguirlo.',
      'Los que seguís están en «Mis alertas».',
    ],
  },
  'mis-alertas': {
    title: 'Mis alertas',
    text: 'Cargá palabras o frases —tu DNI, tu nombre y apellido, un expediente— y te avisamos en el ícono de notificaciones {campana} cuando llegue un MTO que las tenga.',
    points: [
      'Busca en el asunto, el texto del MTO y dentro de los adjuntos PDF, Word, Excel y texto; el aviso dice dónde apareció.',
      'No importan las tildes ni las mayúsculas: 29465318 encuentra 29.465.318.',
      'Ahí también ves los MTO que seguís.',
    ],
  },
  'marcar-todo-leido': {
    title: 'Marcar todo leído',
    text: 'Pone en cero los no leídos de Ejecutivos, Informativos, Redgen y Enviados, solo para vos.',
    points: ['No cuenta como que los abriste: no aparecés en «Visto por».'],
  },
  'no-leidos': {
    title: 'No leídos',
    text: 'Muestra solo los MTO que todavía no abriste de la carpeta en la que estás.',
    points: ['Sigue puesto si cambiás de carpeta.', 'Tocalo de nuevo para ver todos.'],
  },
  'bandera-mto': {
    title: 'Marcar con la bandera',
    text: 'Para TICOM: marcá hasta dónde se leyó, como en el Outlook de DIREDTOS.',
    points: ['La ven todos los de TICOM al instante, con quién la puso.'],
  },
  'compartir-mto': {
    title: 'Compartir el MTO',
    text: 'Mandalo por WhatsApp Web, a una o varias personas por Conversaciones de la intranet, o copiá el enlace.',
    points: ['Quien lo recibe por la intranet lo abre con un toque.'],
  },
  'vistos-mto': {
    title: 'Visto por',
    text: 'Quiénes abrieron este MTO.',
    points: ['Tocá para ver la lista con la fecha y hora en que cada uno lo vio por primera vez.'],
  },
  'subir-desencriptados': {
    title: 'Subir desencriptados/SIENA',
    text: 'Elegí todos los desencriptados o archivos SIENA de una vez (o arrastralos sobre el MTO) y cada uno va solo a su encriptado.',
    points: [
      'Se ubican por el nombre: MAR-01.PDF va a MAR-01.~00.',
      'Si alguno no coincide, se te pregunta a cuál va.',
      'También en los MTO por PON que mandan el archivo por enlace (SaaS).',
      'Si te equivocaste, borralo con la ✕ y volvé a subirlo.',
    ],
  },
  escaneos: {
    title: 'Escaneos',
    text: 'Lo que se escanea en las impresoras con el destino de tu oficina llega acá en segundos.',
    points: [
      'No ocupa el espacio de Drive.',
      'Se borra a los 90 días: guardá en Archivos lo que haya que conservar.',
    ],
  },
  'mover-archivos': {
    title: 'Mover archivos y carpetas',
    text: 'Arrastrá un archivo o una carpeta y soltalo sobre otra carpeta para moverlo ahí.',
    points: [
      'Para sacarlo a una carpeta de más arriba, soltalo sobre su nombre en la ruta de arriba.',
      'Se mueve dentro del mismo lugar: la unidad de tu oficina, Mis archivos o lo que te compartieron con permiso de edición.',
    ],
  },
  'mis-archivos': {
    title: 'Mis archivos',
    text: 'Tu espacio personal en Google Drive, que no ocupa el de tu oficina.',
    points: ['Podés compartir lo que quieras con otras personas de la intranet.'],
  },
  'archivos-compartidos': {
    title: 'Archivos compartidos',
    text: 'La unidad de Google Drive de tu oficina, tus archivos, lo que te compartieron y los escaneos de las impresoras.',
  },
  'espacio-oficinas': {
    title: 'Espacio de la oficina',
    text: 'Cuánto ocupa la unidad de tu oficina en Drive y cuánto le queda.',
    points: ['El espacio depende de la cantidad de integrantes de la oficina.'],
  },
  notificaciones: {
    title: 'Notificaciones',
    text: 'Acá llegan los anuncios y los avisos de MTO que pediste en «Mis alertas» o al seguir un MTO.',
  },
  'chat-varios-adjuntos': {
    title: 'Adjuntar archivos',
    text: 'Mandá hasta 10 archivos en un mismo mensaje.',
    points: ['Imágenes, PDF, Word, Excel, texto o RAR, de hasta 50 MB cada uno.'],
  },
};
