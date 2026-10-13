/**
 * Partes que Outlook mete en el correo para dibujar el cuerpo (líneas, cuadros,
 * logos de la firma) y que no son adjuntos: Outlook no las muestra en la lista
 * de adjuntos. Las .emz/.wmz (metarchivos de Windows comprimidos) llegan con un
 * tipo que no es "image/", así que el filtro de imágenes incrustadas del
 * mail-bridge las dejaba pasar y la intranet mostraba "image001.emz" en MTO sin
 * adjuntos (FGI 2757/26, 13/10/2026). Solo por el nombre exacto que pone
 * Outlook, para no descartar nunca un archivo que alguien adjuntó.
 */
const OUTLOOK_DRAWING = /^image\d{3,}\.(emz|wmz)$/i;

export function isOutlookDrawing(filename: string | null | undefined): boolean {
  return !!filename && OUTLOOK_DRAWING.test(filename.trim());
}

/** El mismo patrón para SQL (operador ~*). */
export const OUTLOOK_DRAWING_SQL = '^image[0-9]{3,}\\.(emz|wmz)$';
