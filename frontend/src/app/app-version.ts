/**
 * Versión visible de la intranet (debajo del logo, en el menú).
 * Subirla en cada pase a producción con cambios visibles:
 *   - menor (1.x.0) al agregar funcionalidades;
 *   - parche (1.1.x) para correcciones.
 *
 * 1.1.0 — Archivos compartidos, notificaciones y cierre de sesión por inactividad.
 * 1.1.1 — Íconos de archivo nuevos en los adjuntos de MTO.
 * 1.1.2 — Candado en el ícono de los adjuntos encriptados (.~00).
 * 1.2.0 — Espacio por oficina (2 GB por integrante), pendrive, subir carpetas; eliminar es definitivo.
 * 1.2.1 — Menú propio con clic derecho en Archivos (actualizar, nueva carpeta, subir); doble clic para subir.
 * 1.3.0 — Archivos de hasta 10 GB (subida directa a Google) y descargar carpetas enteras en .zip.
 * 1.4.0 — Mis archivos: espacio personal de 10 GB en el Drive de cada uno, aparte del de la oficina.
 * 1.4.1 — Grupo fecha-hora de los MTO y logs en hora de Argentina (antes UTC).
 * 1.4.2 — La intranet se actualiza sola en un momento seguro, sin recargar a mano.
 * 1.4.3 — Leyenda en cada pestaña de Archivos compartidos.
 * 1.5.0 — Compartir un MTO por WhatsApp Web o por el chat (enlace que lo abre); enlaces clicables en el chat.
 * 1.5.1 — Desencriptados (PON y SIENA) con candado abierto y quién los subió; TICOM también los puede ver.
 * 1.5.2 — Varios desencriptados por adjunto encriptado (.rar); ENCRIPTADO ve solo los desencriptados.
 * 1.5.3 — Desencriptados con su nombre real (el del cuerpo del MTO) e ícono de su tipo con candado verde.
 * 1.5.4 — Varios archivos SIENA a la vez (ícono de su tipo con "SIENA" celeste); varios adjuntos en un mensaje del chat.
 * 1.5.5 — TICOM arrastra todos los desencriptados o SIENA sobre el MTO y se suben juntos.
 * 1.5.6 — En Conversaciones no aparece la burbuja flotante del chat (tapaba el botón de enviar).
 * 1.6.0 — Escaneos: las impresoras escanean a la bandeja de la oficina y aparece en Archivos → Escaneos.
 * 1.6.1 — Archivos compartidos: archivos de hasta 100 GB (antes 10).
 * 1.6.2 — "Visto por" en cada MTO: quiénes lo abrieron, con fecha y hora.
 * 1.6.3 — El MTO se imprime como en Outlook (cuenta arriba, De/Enviado el/Para/CC/Asunto, Calibri, sin encabezado del navegador).
 * 1.7.0 — MTO: marcar todo como leído, banderita para TICOM, Ctrl+P imprime el MTO, Ejecutivos destacados.
 * 1.7.1 — Ejecutivos en rojo (antes violeta), sin el aviso "es para cumplimentar".
 * 1.7.2 — Ejecutivos: la fila como las demás; la etiqueta roja late hasta que se abre.
 * 1.7.3 — El latido de los Ejecutivos se ve también con las animaciones de Windows apagadas, y es más notorio.
 * 1.7.4 — Bandera nueva; el botón dice "Marcar"/"Marcado" y al lado de los vistos, "Marcado por <usuario>".
 * 1.7.5 — Búsqueda: una palabra que es un código (SNF) o una unidad (DIRTICOM) trae todos los de eso, por fecha; el texto, por fecha.
 * 1.7.6 — Lista de MTO con scroll infinito (sin flechas de páginas); también en las búsquedas.
 */
export const APP_VERSION = '1.7.6';
