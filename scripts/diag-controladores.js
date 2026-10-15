// Diagnóstico de los controladores de dominio: corre dentro del backend.
const fs = require('fs');
const ldap = require('ldapjs');
const usuario = process.argv[2] || 'mlopez';
let pass = process.env.LDAP_BIND_CREDENTIALS || '';
try { pass = fs.readFileSync('/run/secrets/ldap_bind_credentials', 'utf8').trim(); } catch {}
const urls = (process.env.LDAP_URL || '').split(/[\s,;]+/).filter(Boolean);
const ft = (v) => { const n = Number(v); if (!n) return 'nunca/0'; return new Date(n / 1e4 - 11644473600000).toISOString(); };

function probar(url) {
  return new Promise((done) => {
    const c = ldap.createClient({ url, connectTimeout: 4000, timeout: 8000, tlsOptions: { rejectUnauthorized: false } });
    const fin = (msg) => { console.log(`${url}  ${msg}`); try { c.destroy(); } catch {} done(); };
    c.on('error', (e) => fin(`NO CONECTA: ${e.message}`));
    c.bind(process.env.LDAP_BIND_DN, pass, (e) => {
      if (e) return fin(`CUENTA DE SERVICIO RECHAZADA: ${e.name} (código ${e.code}) ${e.message}`);
      console.log(`${url}  cuenta de servicio OK`);
      c.search(process.env.LDAP_SEARCH_BASE, {
        scope: 'sub', filter: `(sAMAccountName=${usuario})`,
        attributes: ['distinguishedName', 'userAccountControl', 'pwdLastSet', 'lockoutTime', 'badPwdCount', 'badPasswordTime', 'lastLogon', 'whenChanged'],
      }, (se, res) => {
        if (se) return fin(`búsqueda falló: ${se.message}`);
        let hallado = false;
        res.on('searchEntry', (en) => {
          hallado = true;
          const o = {}; en.pojo.attributes.forEach((a) => { o[a.type] = a.values?.[0] ?? ''; });
          const uac = Number(o.userAccountControl);
          console.log(`   ${usuario}: deshabilitado=${!!(uac & 2)} bloqueado(lockoutTime)=${ft(o.lockoutTime)} intentosFallidos=${o.badPwdCount} ultimoFallo=${ft(o.badPasswordTime)} contraseñaCambiada=${ft(o.pwdLastSet)} ultimoLogin(en este DC)=${ft(o.lastLogon)} cambiado=${o.whenChanged}`);
        });
        res.on('error', (er) => fin(`búsqueda falló: ${er.message}`));
        res.on('end', () => fin(hallado ? 'fin' : `NO ENCUENTRA al usuario ${usuario}`));
      });
    });
  });
}
(async () => { console.log(`LDAP_URL: ${urls.join(' , ')}`); for (const u of urls) await probar(u); })();
