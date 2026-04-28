import { registerAs } from '@nestjs/config';
import { readSecret } from './read-secret.util';

export default registerAs('jwt', () => ({
  secret: readSecret('jwt_secret', 'JWT_SECRET', 'default-secret-change-in-production'),
  expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
}));
