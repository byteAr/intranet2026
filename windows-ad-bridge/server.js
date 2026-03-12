const http = require('http');
const { spawn } = require('child_process');

const PORT   = process.env.BRIDGE_PORT   || 3001;
const SECRET = process.env.BRIDGE_SECRET || 'pac-bridge-secret-change-me';
const HOST   = process.env.BRIDGE_HOST   || '0.0.0.0';

function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.stdin.write(script);
    ps.stdin.end();

    ps.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `PowerShell exit code: ${code}`));
    });
  });
}

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/reset-password') {
    try {
      const { username, newPassword } = await readBody(req);

      if (!username || !newPassword) throw new Error('username and newPassword are required');
      if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw new Error('Invalid username format');

      const script = `
chcp 65001 | Out-Null
Add-Type -AssemblyName System.DirectoryServices.Protocols
$cred = New-Object System.Net.NetworkCredential("svc-pac", $env:AD_ADMIN_PASS, "iugnad")
$ldapId = New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier("10.98.40.22", 389)
$conn = New-Object System.DirectoryServices.Protocols.LdapConnection($ldapId, $cred)
$conn.AuthType = [System.DirectoryServices.Protocols.AuthType]::Negotiate
$conn.SessionOptions.Signing = $true
$conn.SessionOptions.Sealing = $true
$conn.Bind()
Write-Output "Bind OK"
$searchReq = New-Object System.DirectoryServices.Protocols.SearchRequest("DC=iugnad,DC=lan", "(sAMAccountName=${username})", "Subtree", [string[]]@("distinguishedName"))
$searchResp = $conn.SendRequest($searchReq)
$dn = $searchResp.Entries[0].DistinguishedName
Write-Output "Found: $dn"
$pwdBytes = [System.Text.Encoding]::Unicode.GetBytes('"' + $env:RESET_PWD + '"')
$mod = New-Object System.DirectoryServices.Protocols.DirectoryAttributeModification
$mod.Name = "unicodePwd"
$mod.Operation = [System.DirectoryServices.Protocols.DirectoryAttributeOperation]::Replace
[void]$mod.Add($pwdBytes)
$modReq = New-Object System.DirectoryServices.Protocols.ModifyRequest($dn, $mod)
$modResp = $conn.SendRequest($modReq)
Write-Output "Password result: $($modResp.ResultCode)"
$mod2 = New-Object System.DirectoryServices.Protocols.DirectoryAttributeModification
$mod2.Name = "pwdLastSet"
$mod2.Operation = [System.DirectoryServices.Protocols.DirectoryAttributeOperation]::Replace
[void]$mod2.Add("-1")
$modReq2 = New-Object System.DirectoryServices.Protocols.ModifyRequest($dn, $mod2)
[void]$conn.SendRequest($modReq2)
Write-Output "OK"
`;
      const adAdminPass = process.env.AD_ADMIN_PASS || 'Margen.26';
      const output = await runPowerShell(script, { RESET_PWD: newPassword, AD_ADMIN_PASS: adAdminPass });
      console.log(`[${new Date().toISOString()}] Password reset OK for: ${username} | PS output: ${output}`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] reset-password error:`, err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AD Bridge running on http://${HOST}:${PORT}`);
});
