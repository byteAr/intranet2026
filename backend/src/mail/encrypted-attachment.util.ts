/**
 * Adjunto encriptado por PON: extensión ".~00", ".~01"… Desde el 26/10/2026
 * también ".\_00": algún sistema del camino reemplaza la tilde por un guion bajo
 * (DEB 2671/26 trajo "LUNA25_1._00" y no se reconocía como encriptado: no se
 * podía subir el desencriptado). ⚠️ Copia en el frontend (mail.component.ts y
 * file-icon.component.ts): tocar las tres.
 */
export const ENCRYPTED_ATTACHMENT = /\.[~_]\d{2}$/;

export function isEncryptedAttachment(filename: string | null | undefined): boolean {
  return !!filename && ENCRYPTED_ATTACHMENT.test(filename);
}

/** Adjunto encriptado: por su nombre o, si es un .rar/.zip, por lo que trae adentro (`encryptedInside`). */
export function isEncrypted(att: { filename: string; encryptedInside?: boolean | null }): boolean {
  return isEncryptedAttachment(att.filename) || !!att.encryptedInside;
}
