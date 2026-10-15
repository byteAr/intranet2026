// A quién se le cambió la contraseña en los últimos N días (pwdLastSet), con la hora.
// Corre dentro del backend con la cuenta de servicio (no muestra contraseñas):
//   docker compose ... exec -T backend node - 3 < scripts/cambios-contrasena.js
// Varios usuarios a la misma hora = un cambio masivo (script, reseteo, migración).
const fs = require('fs');
const ldap = require('ldapjs');

const dias = Number(process.argv[2] || 3);
const host = process.argv[3] || (process.env.LDAP_URL || '').split(/[\s,;]+/)[0];
let svcPass = process.env.LDAP_BIND_CREDENTIALS || '';
try { svcPass = fs.readFileSync('/run/secrets/ldap_bind_credentials', 'utf8').trim(); } catch {}

const desde = (Date.now() - dias * 864e5 + 11644473600000) * 1e4;
const arg = (n) => new Date(Number(n) / 1e4 - 11644473600000)
  .toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });

const c = ldap.createClient({ url: host.startsWith('ldap') ? host : `ldap://${host}:389`, connectTimeout: 4000, timeout: 20000 });
c.on('error', (e) => console.log('No conecta:', e.message));
c.bind(process.env.LDAP_BIND_DN, svcPass, (e) => {
  if (e) { console.log('Cuenta de servicio rechazada:', e.message); return c.destroy(); }
  const filas = [];
  c.search(process.env.LDAP_SEARCH_BASE, {
    scope: 'sub', paged: true, sizeLimit: 0,
    filter: `(&(objectCategory=person)(objectClass=user)(pwdLastSet>=${Math.floor(desde)}))`,
    attributes: ['sAMAccountName', 'pwdLastSet', 'userAccountControl'],
  }, (se, res) => {
    if (se) { console.log('Búsqueda falló:', se.message); return c.destroy(); }
    res.on('searchEntry', (en) => {
      const o = {}; en.pojo.attributes.forEach((a) => { o[a.type] = a.values?.[0] ?? ''; });
      filas.push(o);
    });
    res.on('error', (er) => { console.log('Búsqueda falló:', er.message); c.destroy(); });
    res.on('end', () => {
      filas.sort((a, b) => Number(a.pwdLastSet) - Number(b.pwdLastSet));
      console.log(`Consultado en ${host}: ${filas.length} usuario(s) con la contraseña cambiada en los últimos ${dias} días (hora de Argentina)`);
      for (const f of filas) {
        const deshab = Number(f.userAccountControl) & 2 ? ' (deshabilitado)' : '';
        console.log(`  ${arg(f.pwdLastSet)}  ${f.sAMAccountName}${deshab}`);
      }
      c.destroy();
    });
  });
});
