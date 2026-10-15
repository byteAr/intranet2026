// Prueba un inicio de sesión real contra cada controlador de dominio por separado.
// Corre dentro del backend; la contraseña llega por la variable P (nunca se muestra):
//   read -rs -p "Contraseña: " P; echo
//   docker compose ... exec -T -e P="$P" backend node - mlopez 10.98.40.1 10.98.40.10 10.98.40.22 < scripts/probar-login-dc.js
//   unset P
// Para cada servidor: si acepta usuario y contraseña (y si no, el código del AD:
// 52e = contraseña incorrecta, 775 = bloqueado, 532 = vencida…) y qué datos tiene
// de ese usuario (último cambio de contraseña, intentos fallidos, bloqueo).
const fs = require('fs');
const ldap = require('ldapjs');

const [usuario, ...hosts] = process.argv.slice(2);
const dominio = process.env.AD_DOMAIN_FQDN || 'iugnad.lan';
const pass = process.env.P || '';
let svcPass = process.env.LDAP_BIND_CREDENTIALS || '';
try { svcPass = fs.readFileSync('/run/secrets/ldap_bind_credentials', 'utf8').trim(); } catch {}
const ft = (v) => { const n = Number(v); return n ? new Date(n / 1e4 - 11644473600000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-'; };
const motivo = (e) => (/data ([0-9a-f]+)/i.exec(e.message)?.[1] ?? e.name);

function conectar(host) {
  const c = ldap.createClient({ url: `ldap://${host}:389`, connectTimeout: 4000, timeout: 8000 });
  c.on('error', () => {});
  return c;
}

function bind(host, dn, pw) {
  return new Promise((ok) => {
    const c = conectar(host);
    c.on('error', (e) => ok({ c, err: e }));
    c.bind(dn, pw, (e) => ok({ c, err: e }));
  });
}

function datos(c) {
  return new Promise((ok) => {
    const o = {};
    c.search(process.env.LDAP_SEARCH_BASE, {
      scope: 'sub', filter: `(sAMAccountName=${usuario})`,
      attributes: ['pwdLastSet', 'badPwdCount', 'lockoutTime', 'lastLogon', 'whenChanged'],
    }, (se, res) => {
      if (se) return ok(null);
      res.on('searchEntry', (en) => en.pojo.attributes.forEach((a) => { o[a.type] = a.values?.[0] ?? ''; }));
      res.on('error', () => ok(null));
      res.on('end', () => ok(o));
    });
  });
}

(async () => {
  if (!usuario || !hosts.length) { console.log('Uso: node - <usuario> <ip1> <ip2> ...'); return; }
  if (!pass) console.log('(sin contraseña en P: solo se muestran los datos de cada servidor)');
  for (const host of hosts) {
    console.log(`\n== ${host}`);
    if (pass) {
      const r = await bind(host, `${usuario}@${dominio}`, pass);
      console.log(r.err ? `   INICIO DE SESIÓN: RECHAZADO (${motivo(r.err)}) ${r.err.message.slice(0, 90)}` : '   INICIO DE SESIÓN: ACEPTADO');
      try { r.c.destroy(); } catch {}
    }
    const s = await bind(host, process.env.LDAP_BIND_DN, svcPass);
    if (s.err) { console.log(`   datos: no se pudo leer (${motivo(s.err)})`); try { s.c.destroy(); } catch {} continue; }
    const o = await datos(s.c);
    try { s.c.destroy(); } catch {}
    if (!o || !Object.keys(o).length) { console.log('   datos: no encuentra al usuario'); continue; }
    console.log(`   contraseña cambiada: ${ft(o.pwdLastSet)} | intentos fallidos: ${o.badPwdCount ?? '-'} | bloqueado: ${ft(o.lockoutTime)} | último login en este DC: ${ft(o.lastLogon)} | modificado: ${o.whenChanged}`);
  }
})();
