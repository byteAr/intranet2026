/**
 * MTO cifrado por PON cuyo archivo no viene adjunto sino en un enlace: cuando
 * es demasiado grande para Outlook se sube a SaaS (saas.gna.gob.ar) y el MTO
 * trae el link y la contraseña (BAE 2182/26: "MEDIANTE PON 33/96 … SE ENVÍAN
 * ARCHIVOS ADJUNTOS MEDIANTE SIGUIENTE LINK"). No hay un ".~00" donde colgar el
 * desencriptado: TICOM lo sube al MTO (mismo lugar que los SIENA, siena_files) y
 * lo ven TICOM y ENCRIPTADO.
 */
const PON = /\bPON\s*\d+\s*\/\s*\d+/i;
const LINK = /\bhttps?:\/\/\S+/i;

export function isEncryptedByLink(bodyText: string | null | undefined, hasEncryptedAttachments: boolean): boolean {
  if (hasEncryptedAttachments) return false; // ya se suben sobre su ".~00"
  const body = bodyText ?? '';
  return PON.test(body) && LINK.test(body);
}
