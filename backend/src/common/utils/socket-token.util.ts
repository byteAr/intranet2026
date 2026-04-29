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
