'use strict';

require('dotenv').config();

const { ImapPoller } = require('./imap-poller');
const { SmtpServer } = require('./smtp-server');

function required(name) {
  const val = process.env[name];
  if (!val) { console.error(`[mail-bridge] Missing required env var: ${name}`); process.exit(1); }
  return val;
}

function optional(name, defaultVal) {
  return process.env[name] || defaultVal;
}

const config = {
  secret: required('BRIDGE_SECRET'),
  backendUrl: required('BRIDGE_BACKEND_URL'),
  pollIntervalMs: parseInt(optional('BRIDGE_POLL_INTERVAL_MS', '30000'), 10),

  imap: {
    host: required('BRIDGE_IMAP_HOST'),
    port: parseInt(optional('BRIDGE_IMAP_PORT', '993'), 10),
    tls: optional('BRIDGE_IMAP_TLS', 'true') !== 'false',
    user: required('BRIDGE_IMAP_USER'),
    password: required('BRIDGE_IMAP_PASSWORD'),
  },

  smtp: {
    host: required('BRIDGE_SMTP_HOST'),
    port: parseInt(optional('BRIDGE_SMTP_PORT', '587'), 10),
    user: required('BRIDGE_SMTP_USER'),
    password: required('BRIDGE_SMTP_PASSWORD'),
    from: required('BRIDGE_SMTP_FROM'),
  },

  ldap: {
    host: required('BRIDGE_LDAP_HOST'),
    port: parseInt(optional('BRIDGE_LDAP_PORT', '389'), 10),
    bindUser: required('BRIDGE_LDAP_BIND_USER'),
    bindPassword: required('BRIDGE_LDAP_BIND_PASSWORD'),
    baseDn: required('BRIDGE_LDAP_BASE_DN'),
  },

  http: {
    port: parseInt(optional('BRIDGE_HTTP_PORT', '3002'), 10),
    host: optional('BRIDGE_HTTP_HOST', '0.0.0.0'),
  },
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const poller = new ImapPoller(config, log);
const server = new SmtpServer(config, log);

server.start();
poller.start();

process.on('SIGTERM', () => { poller.stop(); process.exit(0); });
process.on('SIGINT',  () => { poller.stop(); process.exit(0); });

log('mail-bridge started');
