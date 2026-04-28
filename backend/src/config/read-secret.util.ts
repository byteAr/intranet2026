import { readFileSync } from 'fs';

/**
 * Reads a value from a Docker secret file at /run/secrets/{filename}.
 * Falls back to the given environment variable if the file does not exist.
 */
export function readSecret(filename: string, envFallback: string, defaultValue = ''): string {
  try {
    return readFileSync(`/run/secrets/${filename}`, 'utf-8').trim();
  } catch {
    return process.env[envFallback] ?? defaultValue;
  }
}
