import { registerAs } from '@nestjs/config';
import { readSecret } from './read-secret.util';

export default registerAs('ldap', () => ({
  url: process.env.LDAP_URL ?? 'ldap://localhost:389',
  bindDn: process.env.LDAP_BIND_DN ?? 'cn=admin,dc=example,dc=com',
  bindCredentials: readSecret('ldap_bind_credentials', 'LDAP_BIND_CREDENTIALS', 'admin_password'),
  searchBase: process.env.LDAP_SEARCH_BASE ?? 'dc=example,dc=com',
  searchFilter: process.env.LDAP_SEARCH_FILTER ?? '(uid={{username}})',
  tlsRejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
}));
