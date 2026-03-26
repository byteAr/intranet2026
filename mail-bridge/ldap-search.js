'use strict';

const ldap = require('ldapjs');

/**
 * Busca destinatarios en LIBRETALDAP.GNA.
 * Retorna un array de { displayName, email, department, title }.
 */
function searchRecipients(config, query) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: `ldap://${config.host}:${config.port}`,
      timeout: 10000,
      connectTimeout: 10000,
    });

    client.on('error', (err) => {
      reject(new Error(`LDAP connection error: ${err.message}`));
    });

    client.bind(config.bindUser, config.bindPassword, (bindErr) => {
      if (bindErr) {
        client.destroy();
        return reject(new Error(`LDAP bind error: ${bindErr.message}`));
      }

      const q = query.replace(/[*()\\\x00]/g, '\\$&'); // escape special chars
      const filter = `(&(objectClass=person)(|(cn=*${q}*)(mail=*${q}*)(displayName=*${q}*)(sAMAccountName=*${q}*)))`;
      const opts = {
        scope: 'sub',
        filter,
        attributes: ['displayName', 'mail', 'department', 'title', 'cn'],
        sizeLimit: 50,
        timeLimit: 10,
      };

      const results = [];

      client.search(config.baseDn, opts, (searchErr, res) => {
        if (searchErr) {
          client.destroy();
          return reject(new Error(`LDAP search error: ${searchErr.message}`));
        }

        res.on('searchEntry', (entry) => {
          const obj = {};
          entry.attributes.forEach((attr) => {
            obj[attr.type] = attr.values?.[0] ?? '';
          });

          const email = obj.mail || '';
          if (!email) return; // skip entries without email

          results.push({
            displayName: obj.displayName || obj.cn || email,
            email,
            department: obj.department || '',
            title: obj.title || '',
          });
        });

        res.on('error', (err) => {
          client.destroy();
          reject(new Error(`LDAP search stream error: ${err.message}`));
        });

        res.on('end', () => {
          client.unbind();
          resolve(results);
        });
      });
    });
  });
}

module.exports = { searchRecipients };
