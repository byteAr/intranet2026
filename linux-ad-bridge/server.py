import hashlib

# OpenSSL 3.x deshabilita MD4 por defecto; NTLM lo necesita.
# Usamos pycryptodome como fallback si no está disponible.
try:
    hashlib.new('md4', b'')
except ValueError:
    from Crypto.Hash import MD4 as _MD4

    class _MD4Wrapper:
        name = 'md4'
        digest_size = 16
        block_size  = 64

        def __init__(self, data: bytes = b''):
            self._h = _MD4.new(data)

        def update(self, data: bytes):
            self._h.update(data)
            return self

        def digest(self) -> bytes:
            return self._h.digest()

        def hexdigest(self) -> str:
            return self._h.hexdigest()

        def copy(self):
            w = _MD4Wrapper()
            w._h = self._h.copy()
            return w

    _orig_new = hashlib.new
    def _patched_new(name, data=b'', **kw):
        if name.lower() == 'md4':
            return _MD4Wrapper(data)
        return _orig_new(name, data, **kw)
    hashlib.new = _patched_new

from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, re, logging
from ldap3 import Server, Connection, NTLM, MODIFY_REPLACE, ENCRYPT

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

PORT    = int(os.environ.get('BRIDGE_PORT', '3002'))
SECRET  = os.environ.get('BRIDGE_SECRET', 'pac-bridge-secret-change-me')
AD_HOST = os.environ.get('AD_HOST', '10.98.40.22')
AD_USER = os.environ.get('AD_USER', r'iugnad\svc-pac')
AD_PASS = os.environ.get('AD_PASS', '')
AD_BASE = os.environ.get('AD_BASE', 'DC=iugnad,DC=lan')


def reset_ad_password(username: str, new_password: str) -> None:
    srv  = Server(AD_HOST, port=389, use_ssl=False)
    conn = Connection(srv, user=AD_USER, password=AD_PASS, authentication=NTLM,
                      session_security=ENCRYPT, auto_bind=True)

    conn.search(AD_BASE, f'(sAMAccountName={username})', attributes=['distinguishedName'])
    if not conn.entries:
        raise ValueError(f'Usuario no encontrado en AD: {username}')

    dn = conn.entries[0].entry_dn
    encoded = f'"{new_password}"'.encode('utf-16-le')

    if not conn.modify(dn, {'unicodePwd': [(MODIFY_REPLACE, [encoded])]}):
        raise ValueError(f'No se pudo cambiar la contraseña: {conn.result["description"]}')

    conn.modify(dn, {'pwdLastSet': [(MODIFY_REPLACE, ['-1'])]})
    conn.unbind()
    logger.info('Contraseña reseteada para: %s', username)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info('%s - %s', self.address_string(), fmt % args)

    def send_json(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.headers.get('Authorization') != f'Bearer {SECRET}':
            return self.send_json(401, {'error': 'Unauthorized'})

        if self.path != '/reset-password':
            return self.send_json(404, {'error': 'Not found'})

        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        username     = body.get('username', '').strip()
        new_password = body.get('newPassword', '')

        if not username or not new_password:
            return self.send_json(400, {'error': 'username y newPassword son requeridos'})

        if not re.match(r'^[a-zA-Z0-9._-]+$', username):
            return self.send_json(400, {'error': 'Formato de usuario inválido'})

        try:
            reset_ad_password(username, new_password)
            self.send_json(200, {'success': True})
        except Exception as e:
            logger.error('Error reset %s: %s', username, e)
            self.send_json(500, {'error': str(e)})


if __name__ == '__main__':
    httpd = HTTPServer(('0.0.0.0', PORT), Handler)
    logger.info('AD Bridge (Linux) en http://0.0.0.0:%d', PORT)
    httpd.serve_forever()
