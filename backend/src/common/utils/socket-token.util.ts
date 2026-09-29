import { Socket } from 'socket.io';

/**
 * Extracts the JWT token from a Socket.IO handshake.
 * Priority: auth.token → Authorization header → pac_token cookie
 */
export function extractSocketToken(socket: Socket): string | null {
  const fromAuth = (socket.handshake.auth as Record<string, string>)?.token;
  if (fromAuth) return fromAuth;

  const fromHeader = (socket.handshake.headers?.authorization as string | undefined)
    ?.replace('Bearer ', '');
  if (fromHeader) return fromHeader;

  const cookie = socket.handshake.headers.cookie ?? '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === 'pac_token') return rest.join('=');
  }

  return null;
}

/** Máximo que admite setTimeout (~24,8 días); más allá dispara al instante. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Corta el socket cuando vence el JWT con el que se autenticó.
 *
 * El token solo se verifica en el handshake: sin esto, una conexión abierta
 * sobrevive al vencimiento de la sesión y el usuario sigue "en línea" y
 * recibiendo mensajes indefinidamente. El cliente recibe el corte con
 * motivo `io server disconnect` y no reintenta solo.
 */
export function scheduleSocketExpiry(socket: Socket, exp?: number): void {
  if (!exp) return;
  const ms = Math.max(0, exp * 1000 - Date.now());
  const timer = setTimeout(() => socket.disconnect(), Math.min(ms, MAX_TIMEOUT_MS));
  socket.once('disconnect', () => clearTimeout(timer));
}
