/**
 * Funcionalidades nuevas: cada una muestra la etiqueta NUEVO (<app-new-badge>)
 * durante una semana desde su fecha de lanzamiento, y después desaparece sola.
 *
 * Al agregar una funcionalidad visible, sumarla acá con la fecha en que llega
 * a producción (YYYY-MM-DD, hora de Argentina) y poner el badge donde aparece.
 */
export const NEW_FEATURES = {
  'archivos-compartidos': '2026-10-05',
  notificaciones: '2026-10-05',
  'espacio-oficinas': '2026-10-05',
  'mis-archivos': '2026-10-06',
} as const;

export type NewFeature = keyof typeof NEW_FEATURES;

const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export function isNewFeature(feature: NewFeature, now = Date.now()): boolean {
  const launched = Date.parse(`${NEW_FEATURES[feature]}T00:00:00-03:00`);
  // Sin cota inferior: en staging, antes del lanzamiento, ya se ve.
  return now < launched + NEW_FOR_MS;
}
