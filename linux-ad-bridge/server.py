from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, re, logging, subprocess, ssl
from urllib.parse import urlparse, parse_qs
import ldap3

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

PORT           = int(os.environ.get('BRIDGE_PORT', '3002'))
SECRET         = os.environ.get('BRIDGE_SECRET', 'pac-bridge-secret-change-me')
AD_HOST        = os.environ.get('AD_HOST', '10.98.40.22')
AD_USER        = os.environ.get('AD_USER', 'svc-pac')
AD_PASS        = os.environ.get('AD_PASS', '')
AD_DOMAIN      = os.environ.get('AD_DOMAIN', 'IUGNAD')
AD_BASE_DN     = os.environ.get('AD_BASE_DN', 'DC=iugnad,DC=lan')
AD_USERS_OU    = os.environ.get('AD_USERS_OU') or f'CN=Users,{AD_BASE_DN}'
AD_DOMAIN_FQDN = os.environ.get('AD_DOMAIN_FQDN', 'iugnad.lan')


def get_ldap_connection():
    """Create LDAP connection to AD using NTLM. Tries LDAPS (636) first, falls back to LDAP (389)."""
    tls_config = ldap3.Tls(validate=ssl.CERT_NONE)
    # Try LDAPS first
    try:
        server = ldap3.Server(AD_HOST, port=636, use_ssl=True, tls=tls_config, get_info=ldap3.NONE)
        conn = ldap3.Connection(
            server,
            user=f'{AD_DOMAIN}\\{AD_USER}',
            password=AD_PASS,
            authentication=ldap3.NTLM,
            auto_bind=True,
        )
        return conn
    except Exception as e:
        logger.warning('LDAPS falló, intentando LDAP plano: %s', e)
        server = ldap3.Server(AD_HOST, port=389, use_ssl=False, get_info=ldap3.NONE)
        conn = ldap3.Connection(
            server,
            user=f'{AD_DOMAIN}\\{AD_USER}',
            password=AD_PASS,
            authentication=ldap3.NTLM,
            auto_bind=True,
        )
        return conn


def reset_ad_password(username: str, new_password: str) -> None:
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


def list_ad_users() -> list:
    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            '(&(objectClass=user)(objectCategory=person)(sAMAccountName=*)(!(isCriticalSystemObject=TRUE)))',
            attributes=[
                'sAMAccountName', 'displayName', 'givenName', 'sn',
                'mail', 'physicalDeliveryOfficeName', 'title',
                'userAccountControl', 'distinguishedName',
            ],
        )
        users = []
        for entry in conn.entries:
            uac = int(entry['userAccountControl'].value or 0)
            enabled = not bool(uac & 2)  # bit 1 = ACCOUNTDISABLE
            users.append({
                'username':    str(entry['sAMAccountName'].value or ''),
                'displayName': str(entry['displayName'].value or ''),
                'firstName':   str(entry['givenName'].value or ''),
                'lastName':    str(entry['sn'].value or ''),
                'email':       str(entry['mail'].value or ''),
                'office':      str(entry['physicalDeliveryOfficeName'].value or ''),
                'title':       str(entry['title'].value or ''),
                'enabled':     enabled,
            })
        return sorted(users, key=lambda u: u['displayName'].lower())
    finally:
        conn.unbind()


def check_username_exists(username: str) -> bool:
    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            f'(sAMAccountName={ldap3.utils.conv.escape_filter_chars(username)})',
            attributes=['sAMAccountName'],
        )
        return len(conn.entries) > 0
    finally:
        conn.unbind()


def create_ad_user(data: dict) -> None:
    username     = data['username']
    first_name   = data['firstName']
    last_name    = data['lastName']
    display_name = f'{first_name} {last_name}'
    email        = data['email']
    office       = data.get('office', '')
    title        = data.get('title', '')
    password     = data['password']

    dn  = f'CN={display_name},{AD_USERS_OU}'
    upn = f'{username}@{AD_DOMAIN_FQDN}'

    conn = get_ldap_connection()
    try:
        attributes = {
            'objectClass': ['top', 'person', 'organizationalPerson', 'user'],
            'cn': display_name,
            'givenName': first_name,
            'sn': last_name,
            'displayName': display_name,
            'sAMAccountName': username,
            'userPrincipalName': upn,
            'mail': email,
            'userAccountControl': 514,  # Disabled, normal account
        }
        if office:
            attributes['physicalDeliveryOfficeName'] = office
        if title:
            attributes['title'] = title

        success = conn.add(dn, attributes=attributes)
        if not success:
            raise RuntimeError(f'Error al crear usuario en AD: {conn.result["description"]}')
    finally:
        conn.unbind()

    # Set password via net rpc (Samba) — no TLS cert issues
    reset_ad_password(username, password)

    # Enable account
    conn2 = get_ldap_connection()
    try:
        conn2.modify(dn, {'userAccountControl': [(ldap3.MODIFY_REPLACE, [512])]})
        if conn2.result['result'] != 0:
            logger.warning('No se pudo habilitar cuenta %s: %s', username, conn2.result)
    finally:
        conn2.unbind()

    logger.info('Usuario AD creado y habilitado: %s (%s)', username, dn)


def update_ad_user(data: dict) -> None:
    username = data['username']

    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            f'(sAMAccountName={ldap3.utils.conv.escape_filter_chars(username)})',
            attributes=['distinguishedName'],
        )
        if not conn.entries:
            raise RuntimeError(f'Usuario {username} no encontrado en AD')

        dn = conn.entries[0].entry_dn
        changes = {}
        if 'office' in data and data['office'] is not None:
            changes['physicalDeliveryOfficeName'] = [(ldap3.MODIFY_REPLACE, [data['office']])]
        if 'title' in data and data['title'] is not None:
            changes['title'] = [(ldap3.MODIFY_REPLACE, [data['title']])]
        if 'email' in data and data['email'] is not None:
            changes['mail'] = [(ldap3.MODIFY_REPLACE, [data['email']])]
        if 'firstName' in data and data['firstName']:
            changes['givenName'] = [(ldap3.MODIFY_REPLACE, [data['firstName']])]
        if 'lastName' in data and data['lastName']:
            changes['sn'] = [(ldap3.MODIFY_REPLACE, [data['lastName']])]

        if changes:
            conn.modify(dn, changes)
            if conn.result['result'] != 0:
                raise RuntimeError(f'Error al actualizar usuario: {conn.result["description"]}')
    finally:
        conn.unbind()

    logger.info('Usuario AD actualizado: %s', username)


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

    def _check_auth(self) -> bool:
        if self.headers.get('Authorization') != f'Bearer {SECRET}':
            self.send_json(401, {'error': 'Unauthorized'})
            return False
        return True

    def _read_body(self) -> dict:
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self) -> None:
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == '/list-users':
            try:
                users = list_ad_users()
                self.send_json(200, {'users': users})
            except Exception as e:
                logger.error('Error list-users: %s', e)
                self.send_json(500, {'error': str(e)})

        elif parsed.path == '/check-username':
            username = params.get('username', [''])[0].strip()
            if not username:
                return self.send_json(400, {'error': 'username es requerido'})
            if not re.match(r'^[a-zA-Z0-9._-]+$', username):
                return self.send_json(400, {'error': 'Formato de usuario inválido'})
            try:
                exists = check_username_exists(username)
                self.send_json(200, {'exists': exists})
            except Exception as e:
                logger.error('Error check-username %s: %s', username, e)
                self.send_json(500, {'error': str(e)})
        else:
            self.send_json(404, {'error': 'Not found'})

    def do_POST(self) -> None:
        if not self._check_auth():
            return

        body = self._read_body()
        path = urlparse(self.path).path

        if path == '/reset-password':
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

        elif path == '/create-user':
            required = ['username', 'firstName', 'lastName', 'email', 'password']
            missing  = [f for f in required if not body.get(f, '').strip()]
            if missing:
                return self.send_json(400, {'error': f'Campos requeridos: {", ".join(missing)}'})
            username = body['username'].strip()
            if not re.match(r'^[a-zA-Z0-9._-]+$', username):
                return self.send_json(400, {'error': 'Formato de usuario inválido'})
            try:
                create_ad_user(body)
                self.send_json(200, {'success': True, 'username': username})
            except Exception as e:
                logger.error('Error create-user %s: %s', username, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/update-user':
            username = body.get('username', '').strip()
            if not username:
                return self.send_json(400, {'error': 'username es requerido'})
            if not re.match(r'^[a-zA-Z0-9._-]+$', username):
                return self.send_json(400, {'error': 'Formato de usuario inválido'})
            try:
                update_ad_user(body)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error update-user %s: %s', username, e)
                self.send_json(500, {'error': str(e)})

        else:
            self.send_json(404, {'error': 'Not found'})


if __name__ == '__main__':
    httpd = HTTPServer(('0.0.0.0', PORT), Handler)
    logger.info('AD Bridge (Samba RPC + LDAP) en http://0.0.0.0:%d', PORT)
    httpd.serve_forever()
