from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, re, logging, subprocess

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

PORT     = int(os.environ.get('BRIDGE_PORT', '3002'))
SECRET   = os.environ.get('BRIDGE_SECRET', 'pac-bridge-secret-change-me')
AD_HOST  = os.environ.get('AD_HOST', '10.98.40.22')
AD_USER  = os.environ.get('AD_USER', 'svc-pac')
AD_PASS  = os.environ.get('AD_PASS', '')
AD_DOMAIN = os.environ.get('AD_DOMAIN', 'IUGNAD')


def reset_ad_password(username: str, new_password: str) -> None:
    # Usa Samba 'net rpc password' via SAMR/RPC (puerto 445, sin TLS)
    result = subprocess.run(
        [
            'net', 'rpc', 'password', username, new_password,
            '-U', f'{AD_DOMAIN}\\{AD_USER}%{AD_PASS}',
            '-S', AD_HOST,
        ],
        capture_output=True,
        timeout=15,
    )

    if result.returncode != 0:
        stderr = result.stderr.decode().strip()
        stdout = result.stdout.decode().strip()
        raise RuntimeError(stderr or stdout or 'net rpc password falló')

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
    logger.info('AD Bridge (Samba RPC) en http://0.0.0.0:%d', PORT)
    httpd.serve_forever()
