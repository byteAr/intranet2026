import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Contraseñas que la intranet tiene que poder volver a leer (la de DIREDTOS para
 * la libreta, las de las bandejas de escaneo): AES-256-GCM con una clave derivada
 * del secreto del JWT y un propósito, para que cada uso tenga su propia clave.
 * Staging, con otro secreto, no las puede leer.
 */
function keyFor(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`${secret}:${purpose}`).digest();
}

export function sealSecret(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** null si no se puede descifrar (otro secreto, dato roto). */
export function openSecret(stored: string, secret: string, purpose: string): string | null {
  try {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, purpose), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
