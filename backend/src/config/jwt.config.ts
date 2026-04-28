import { registerAs } from '@nestjs/config';
import { readFileSync } from 'fs';

function readSecret(filename: string, envFallback: string): string {
  const secretPath = `/run/secrets/${filename}`;
  try {
    return readFileSync(secretPath, 'utf-8').trim();
  } catch {
    return process.env[envFallback] ?? 'default-secret-change-in-production';
  }
}

export default registerAs('jwt', () => ({
  secret: readSecret('jwt_secret', 'JWT_SECRET'),
  expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
}));
