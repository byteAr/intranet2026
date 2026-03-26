'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SENT_FOLDER_NAMES = [
  'sent', 'sent items', 'sent messages',
  'enviados', 'elementos enviados',
  '[gmail]/sent mail',
];

function postToBackend(backendUrl, secret, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(backendUrl + '/api/mail/bridge/ingest');
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${secret}`,
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ ok: true }); }
          } else {
            reject(new Error(`Backend responded ${res.statusCode}: ${data}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Backend request timeout')); });
    req.write(body);
    req.end();
  });
}

class ImapPoller {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.timer = null;
    this.running = false;
  }

  start() {
    this.running = true;
    this.log('IMAP poller starting...');
    this._poll();
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  _schedule() {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._poll();
    }, this.config.pollIntervalMs);
  }

  async _poll() {
    const client = new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.tls,
      auth: { user: this.config.imap.user, pass: this.config.imap.password },
      tls: { rejectUnauthorized: false },
      logger: false,
    });

    try {
      await client.connect();
      await this._fetchFromMailbox(client, 'INBOX', false);
      await this._fetchFromSent(client);
      await client.logout();
    } catch (err) {
      this.log(`IMAP poll error: ${err.message} | stack: ${err.stack}`);
      try { await client.logout(); } catch { /* ignore */ }
    }

    this._schedule();
  }

  async _fetchFromSent(client) {
    try {
      const list = await client.list();
      const sentBox = list.find((m) => {
        const name = (m.path || m.name || '').toLowerCase();
        return SENT_FOLDER_NAMES.some((s) => name.includes(s));
      });
      if (!sentBox) return;
      await this._fetchFromMailbox(client, sentBox.path || sentBox.name, true);
    } catch (err) {
      this.log(`Sent folder error: ${err.message}`);
    }
  }

  async _fetchFromMailbox(client, mailbox, isSentFolder) {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = [];
      for await (const msg of client.fetch('1:*', { flags: true, envelope: true })) {
        if (msg.flags && !msg.flags.has('\\Seen')) uids.push(msg.uid);
      }

      for (const uid of uids) {
        await this._processMessage(client, uid, isSentFolder);
      }
    } finally {
      lock.release();
    }
  }

  async _processMessage(client, uid, isSentFolder) {
    try {
      const rawResult = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!rawResult?.source) return;

      const parsed = await simpleParser(rawResult.source);
      const internetMessageId = parsed.messageId || `uid-${uid}-${Date.now()}`;

      const from = this._extractAddress(parsed.from);
      const toList = this._extractAddressList(parsed.to);
      const ccList = this._extractAddressList(parsed.cc);

      const attachments = (parsed.attachments || []).map((att) => ({
        filename: att.filename || 'attachment',
        contentType: att.contentType || 'application/octet-stream',
        base64: att.content.toString('base64'),
      }));

      const payload = {
        internetMessageId,
        subject: parsed.subject || '(sin asunto)',
        fromAddress: from,
        toAddresses: toList,
        ccAddresses: ccList,
        bodyText: parsed.text || '',
        bodyHtml: parsed.html || undefined,
        date: (parsed.date || new Date()).toISOString(),
        isSentFolder,
        attachments,
      };

      await postToBackend(this.config.backendUrl, this.config.secret, payload);
      this.log(`Ingested uid=${uid} <${internetMessageId}>`);
    } catch (err) {
      // Do NOT mark as seen — will retry on next poll
      this.log(`processMessage uid=${uid} error: ${err.message} — will retry`);
    }
  }

  _extractAddress(from) {
    if (!from) return '';
    const addr = Array.isArray(from) ? from[0] : from;
    if (!addr) return '';
    const first = addr.value?.[0];
    return first?.address || first?.name || '';
  }

  _extractAddressList(field) {
    if (!field) return [];
    const list = Array.isArray(field) ? field : [field];
    return list.flatMap((g) =>
      (g.value || []).map((a) => a.address || a.name || '').filter(Boolean),
    );
  }
}

module.exports = { ImapPoller };
