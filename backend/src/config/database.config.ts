import { registerAs } from '@nestjs/config';
import { readSecret } from './read-secret.util';

export default registerAs('database', () => ({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB ?? 'pac_db',
  username: process.env.POSTGRES_USER ?? 'pac_user',
  password: readSecret('postgres_password', 'POSTGRES_PASSWORD', 'changeme_dev'),
}));
