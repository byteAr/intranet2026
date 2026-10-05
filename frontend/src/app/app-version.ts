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
 */
export const APP_VERSION = '1.4.2';
