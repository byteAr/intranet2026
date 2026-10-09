import { BadRequestException } from '@nestjs/common';

const PHONE_EXAMPLE = '+54 9 11 1234 5678';

/**
 * Teléfono de recuperación en el formato que acepta Google (+549 + 10 dígitos
 * para un celular de Argentina). Google rechaza los números incompletos con
 * "Invalid recovery phone" y, como la cuenta de Google va primero, no se creaba
 * el usuario. Acepta cómo se escribe acá: "011 15 1234-5678", "11 1234 5678",
 * "+54 11 1234 5678" (sin el 9). Vacío → undefined (es opcional).
 */
export function normalizeRecoveryPhone(input?: string): string | undefined {
  const raw = (input ?? '').trim();
  if (!raw) return undefined;

  let digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!international) digits = `54${digits.replace(/^0/, '')}`;

  // Otro país: que lo valide Google.
  if (!digits.startsWith('54')) return `+${digits}`;

  let national = digits.slice(2);
  if (national.startsWith('9')) national = national.slice(1);
  national = national.replace(/^0/, '');
  // El "15" del celular después de la característica (2 a 4 dígitos): 11 15 1234 5678.
  if (national.length === 12) {
    for (const len of [2, 3, 4]) {
      if (national.slice(len, len + 2) === '15') {
        national = national.slice(0, len) + national.slice(len + 2);
        break;
      }
    }
  }

  if (national.length !== 10) {
    throw new BadRequestException(
      `El teléfono de recuperación no es válido: tiene ${national.length} dígitos sin el +54 y un celular de ` +
        `Argentina tiene 10 (característica + número). Ejemplo: ${PHONE_EXAMPLE}. Revisalo o dejalo vacío (es opcional).`,
    );
  }
  return `+549${national}`;
}
