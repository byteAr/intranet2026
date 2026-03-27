'use strict';

const http = require('http');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const { searchRecipients } = require('./ldap-search');
const { URL } = require('url');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function validateSecret(req, secret) {
  return req.headers['authorization'] === `Bearer ${secret}`;
}

function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
}

async function appendToSent(imapConfig, rawMessage, logger) {
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: imapConfig.tls,
    auth: { user: imapConfig.user, pass: imapConfig.password },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  try {
    await client.connect();
    await client.append('INBOX.Elementos enviados', rawMessage, ['\\Seen']);
    await client.logout();
    logger('Appended sent message to INBOX.Elementos enviados');
  } catch (err) {
    logger(`IMAP append error: ${err.message}`);
    try { await client.logout(); } catch (_) {}
  }
}

class SmtpServer {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      tls: { rejectUnauthorized: false },
    });
  }

  start() {
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (!validateSecret(req, this.config.secret)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // POST /send — enviar email por SMTP
      if (req.method === 'POST' && req.url === '/send') {
        try {
          const body = await readBody(req);
          const attachments = (body.attachments || []).map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: Buffer.from(a.base64, 'base64'),
          }));

          const mailOptions = {
            from: body.from,
            to: Array.isArray(body.to) ? body.to.join(', ') : body.to,
            cc: Array.isArray(body.cc) && body.cc.length ? body.cc.join(', ') : undefined,
            subject: body.subject,
            text: body.text,
            html: body.html,
            attachments,
          };

          const info = await this.transporter.sendMail(mailOptions);
          this.log(`Sent email "${body.subject}" → messageId: ${info.messageId}`);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, messageId: info.messageId }));

          // Guardar copia en Elementos enviados (async, no bloquea la respuesta)
          buildRawMessage(mailOptions)
            .then((raw) => appendToSent(this.config.imap, raw, this.log))
            .catch((err) => this.log(`Failed to append to sent: ${err.message}`));

        } catch (err) {
          this.log(`SMTP send error: ${err.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // GET /ldap-search?q=término — buscar en libreta LIBRETALDAP.GNA
      if (req.method === 'GET' && req.url?.startsWith('/ldap-search')) {
        try {
          const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const q = parsedUrl.searchParams.get('q') || '';
          if (!q.trim()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Parámetro q requerido' }));
            return;
          }

          const results = await searchRecipients(this.config.ldap, q.trim());
          res.writeHead(200);
          res.end(JSON.stringify(results));
        } catch (err) {
          this.log(`LDAP search error: ${err.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(this.config.http.port, this.config.http.host, () => {
      this.log(`HTTP server listening on http://${this.config.http.host}:${this.config.http.port}`);
    });

    server.on('error', (err) => this.log(`HTTP server error: ${err.message}`));
  }
}

module.exports = { SmtpServer };
