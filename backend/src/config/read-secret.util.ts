import { readFileSync } from 'fs';

/**
 * Reads a value from a Docker secret file at /run/secrets/{filename}.
 * Falls back to the given environment variable if the file does not exist.
 */
export function readSecret(filename: string, envFallback: string, defaultValue = ''): string {
  try {
    const value = readFileSync(`/run/secrets/${filename}`, 'utf-8').trim();
    if (value) return value;
  } catch {
    // file not found — fall through to env var
  }
  return process.env[envFallback] ?? defaultValue;
}
