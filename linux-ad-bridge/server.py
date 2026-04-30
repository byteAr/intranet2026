from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, re, logging, subprocess, ssl, datetime
from urllib.parse import urlparse, parse_qs
import ldap3

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

PORT           = int(os.environ.get('BRIDGE_PORT', '3002'))
def _read_secret(path, env_var, default=''):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return os.environ.get(env_var, default)
SECRET         = _read_secret('/run/secrets/bridge_secret', 'BRIDGE_SECRET', 'pac-bridge-secret-change-me')
AD_HOST        = os.environ.get('AD_HOST', '10.98.40.22')
AD_USER        = os.environ.get('AD_USER', 'svc-pac')
AD_PASS        = _read_secret('/run/secrets/ldap_bind_credentials', 'AD_PASS', '')
AD_DOMAIN      = os.environ.get('AD_DOMAIN', 'IUGNAD')
AD_BASE_DN     = os.environ.get('AD_BASE_DN', 'DC=iugnad,DC=lan')
AD_USERS_OU    = os.environ.get('AD_USERS_OU') or f'CN=Users,{AD_BASE_DN}'
AD_DOMAIN_FQDN = os.environ.get('AD_DOMAIN_FQDN', 'iugnad.lan')
# Full DN for SIMPLE bind — evita NTLM que requiere MD4 (deshabilitado en OpenSSL 3.0)
AD_BIND_DN     = os.environ.get('AD_BIND_DN') or f'CN={AD_USER},CN=Users,{AD_BASE_DN}'
AD_GROUPS_OU   = os.environ.get('AD_GROUPS_OU') or AD_USERS_OU  # OU donde se crean grupos nuevos


def get_ldap_connection():
    """LDAP simple bind en puerto 389. Evita NTLM/MD4 incompatible con OpenSSL 3.0."""
    server = ldap3.Server(AD_HOST, port=389, use_ssl=False, get_info=ldap3.NONE)
    conn = ldap3.Connection(
        server,
        user=AD_BIND_DN,
        password=AD_PASS,
        authentication=ldap3.SIMPLE,
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
                'userAccountControl', 'distinguishedName', 'memberOf',
            ],
        )
        users = []
        for entry in conn.entries:
            uac = int(entry['userAccountControl'].value or 0)
            enabled = not bool(uac & 2)  # bit 1 = ACCOUNTDISABLE
            raw_groups = entry['memberOf'].values if entry['memberOf'] else []
            groups = sorted([
                m.group(1) for dn in raw_groups
                if (m := re.match(r'CN=([^,]+)', str(dn), re.IGNORECASE))
            ])
            users.append({
                'username':    str(entry['sAMAccountName'].value or ''),
                'displayName': str(entry['displayName'].value or ''),
                'firstName':   str(entry['givenName'].value or ''),
                'lastName':    str(entry['sn'].value or ''),
                'email':       str(entry['mail'].value or ''),
                'office':      str(entry['physicalDeliveryOfficeName'].value or ''),
                'title':       str(entry['title'].value or ''),
                'enabled':     enabled,
                'dn':          entry.entry_dn,
                'groups':      groups,
            })
        return sorted(users, key=lambda u: u['displayName'].lower())
    finally:
        conn.unbind()


def list_ad_groups() -> list:
    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            '(&(objectClass=group)(!(isCriticalSystemObject=TRUE)))',
            attributes=['cn', 'distinguishedName', 'description', 'member'],
        )
        groups = []
        for entry in conn.entries:
            member_count = len(entry['member'].values) if entry['member'] else 0
            groups.append({
                'cn':          str(entry['cn'].value or ''),
                'dn':          entry.entry_dn,
                'description': str(entry['description'].value or '') if entry['description'] else '',
                'memberCount': member_count,
            })
        return sorted(groups, key=lambda g: g['cn'].lower())
    finally:
        conn.unbind()


def get_group_members(group_dn: str) -> list:
    conn = get_ldap_connection()
    try:
        escaped = ldap3.utils.conv.escape_filter_chars(group_dn)
        conn.search(
            AD_BASE_DN,
            f'(&(objectClass=user)(objectCategory=person)(memberOf={escaped}))',
            attributes=['sAMAccountName', 'displayName', 'distinguishedName',
                        'physicalDeliveryOfficeName', 'title', 'userAccountControl'],
        )
        members = []
        for entry in conn.entries:
            uac = int(entry['userAccountControl'].value or 0)
            enabled = not bool(uac & 2)
            members.append({
                'username':    str(entry['sAMAccountName'].value or ''),
                'displayName': str(entry['displayName'].value or ''),
                'dn':          entry.entry_dn,
                'office':      str(entry['physicalDeliveryOfficeName'].value or ''),
                'title':       str(entry['title'].value or ''),
                'enabled':     enabled,
            })
        return sorted(members, key=lambda u: (u['displayName'] or u['username']).lower())
    finally:
        conn.unbind()


def add_to_group(group_dn: str, user_dn: str) -> None:
    conn = get_ldap_connection()
    try:
        conn.modify(group_dn, {'member': [(ldap3.MODIFY_ADD, [user_dn])]})
        if conn.result['result'] not in (0, 68):  # 68 = already member
            raise RuntimeError(f'Error al agregar al grupo: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Usuario %s agregado al grupo %s', user_dn, group_dn)


def remove_from_group(group_dn: str, user_dn: str) -> None:
    conn = get_ldap_connection()
    try:
        conn.modify(group_dn, {'member': [(ldap3.MODIFY_DELETE, [user_dn])]})
        if conn.result['result'] != 0:
            raise RuntimeError(f'Error al quitar del grupo: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Usuario %s quitado del grupo %s', user_dn, group_dn)


def create_ad_group(name: str, description: str = '') -> str:
    """Crea un grupo de seguridad global en AD. Si ya existe, devuelve su DN sin error."""
    conn = get_ldap_connection()
    try:
        safe_name = ldap3.utils.conv.escape_filter_chars(name)
        conn.search(AD_BASE_DN, f'(&(objectClass=group)(sAMAccountName={safe_name}))', attributes=['distinguishedName'])
        if conn.entries:
            existing_dn = conn.entries[0].entry_dn
            logger.info('Grupo AD ya existe, se omite creación: %s (%s)', name, existing_dn)
            return existing_dn
    finally:
        conn.unbind()

    conn2 = get_ldap_connection()
    try:
        group_dn = f'CN={name},{AD_GROUPS_OU}'
        attributes = {
            'objectClass': ['top', 'group'],
            'cn': name,
            'sAMAccountName': name,
            'groupType': '-2147483646',  # Global Security Group
        }
        if description:
            attributes['description'] = description
        success = conn2.add(group_dn, attributes=attributes)
        if not success:
            raise RuntimeError(f'Error al crear grupo en AD: {conn2.result["description"]}')
        logger.info('Grupo AD creado: %s (%s)', name, group_dn)
        return group_dn
    finally:
        conn2.unbind()


def normalize_groups_to_uppercase() -> dict:
    """Renombra todos los grupos de AD cuyo sAMAccountName no esté en mayúsculas."""
    # Primero recolectamos los grupos que necesitan cambio
    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            '(&(objectClass=group)(!(isCriticalSystemObject=TRUE)))',
            attributes=['sAMAccountName', 'cn'],
        )
        to_rename = [
            {'dn': e.entry_dn, 'sam': str(e.sAMAccountName)}
            for e in conn.entries
            if str(e.sAMAccountName) != str(e.sAMAccountName).upper()
        ]
    finally:
        conn.unbind()

    renamed, skipped, errors = [], [], []

    for entry in to_rename:
        old_dn  = entry['dn']
        old_sam = entry['sam']
        new_name = old_sam.upper()

        # 1. Renombrar CN via modifyDN
        conn2 = get_ldap_connection()
        try:
            conn2.modify_dn(old_dn, f'CN={new_name}')
            result_code = conn2.result['result']
        finally:
            conn2.unbind()

        if result_code == 68:  # entryAlreadyExists → CN uppercase ya existe como otro objeto
            skipped.append({'name': old_sam, 'reason': f'Ya existe un grupo llamado "{new_name}"'})
            continue
        if result_code != 0:
            errors.append({'name': old_sam, 'error': f'modifyDN: {conn2.result["description"]}'})
            continue

        # 2. Calcular el nuevo DN y actualizar sAMAccountName
        parent_dn = ','.join(old_dn.split(',')[1:])
        new_dn    = f'CN={new_name},{parent_dn}'

        conn3 = get_ldap_connection()
        try:
            conn3.modify(new_dn, {'sAMAccountName': [(ldap3.MODIFY_REPLACE, [new_name])]})
            sam_result = conn3.result['result']
        finally:
            conn3.unbind()

        if sam_result != 0:
            errors.append({'name': old_sam, 'error': f'sAMAccountName: {conn3.result["description"]}'})
            continue

        renamed.append({'from': old_sam, 'to': new_name})
        logger.info('Grupo normalizado a mayúsculas: %s -> %s', old_sam, new_name)

    return {'renamed': renamed, 'skipped': skipped, 'errors': errors}


def _get_user_dn(conn, username: str) -> str:
    """Busca el DN de un usuario por sAMAccountName. Lanza RuntimeError si no existe."""
    safe = ldap3.utils.conv.escape_filter_chars(username)
    conn.search(AD_BASE_DN, f'(sAMAccountName={safe})', attributes=['distinguishedName'])
    if not conn.entries:
        raise RuntimeError(f'Usuario {username} no encontrado en AD')
    return conn.entries[0].entry_dn


def disable_user(username: str) -> None:
    conn = get_ldap_connection()
    try:
        dn = _get_user_dn(conn, username)
        conn.modify(dn, {'userAccountControl': [(ldap3.MODIFY_REPLACE, [514])]})
        if conn.result['result'] != 0:
            raise RuntimeError(f'Error al deshabilitar: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Usuario deshabilitado: %s', username)


def enable_user(username: str) -> None:
    conn = get_ldap_connection()
    try:
        dn = _get_user_dn(conn, username)
        conn.modify(dn, {'userAccountControl': [(ldap3.MODIFY_REPLACE, [512])]})
        if conn.result['result'] != 0:
            raise RuntimeError(f'Error al habilitar: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Usuario habilitado: %s', username)


def delete_user(username: str) -> None:
    conn = get_ldap_connection()
    try:
        dn = _get_user_dn(conn, username)
        conn.delete(dn)
        if conn.result['result'] != 0:
            raise RuntimeError(f'Error al eliminar usuario: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Usuario eliminado del AD: %s', username)


def delete_group(group_dn: str) -> None:
    conn = get_ldap_connection()
    try:
        conn.delete(group_dn)
        if conn.result['result'] != 0:
            raise RuntimeError(f'Error al eliminar grupo: {conn.result["description"]}')
    finally:
        conn.unbind()
    logger.info('Grupo eliminado del AD: %s', group_dn)


def _filetime_to_dt(ft: int) -> datetime.datetime | None:
    """Convierte Windows FILETIME (entero) a datetime UTC."""
    if not ft or ft <= 0:
        return None
    EPOCH = datetime.datetime(1601, 1, 1)
    return EPOCH + datetime.timedelta(microseconds=ft // 10)


# Cuentas excluidas de la limpieza automática
_CLEANUP_EXCLUDED = {'administrator', 'guest', 'krbtgt', AD_USER.lower()}


def cleanup_inactive_users(disable_months: int = 7, delete_months: int = 8) -> dict:
    """
    Deshabilita usuarios sin actividad por disable_months meses.
    Elimina usuarios ya deshabilitados sin actividad por delete_months meses.
    Excluye cuentas de sistema y de servicio.
    """
    now = datetime.datetime.utcnow()
    disable_cutoff = now - datetime.timedelta(days=disable_months * 30)
    delete_cutoff  = now - datetime.timedelta(days=delete_months  * 30)

    conn = get_ldap_connection()
    try:
        conn.search(
            AD_BASE_DN,
            '(&(objectClass=user)(objectCategory=person)(!(isCriticalSystemObject=TRUE)))',
            attributes=['sAMAccountName', 'userAccountControl', 'lastLogonTimestamp', 'whenCreated'],
        )
        entries = list(conn.entries)
    finally:
        conn.unbind()

    disabled_list, deleted_list, errors = [], [], []

    for entry in entries:
        username = str(entry.sAMAccountName).lower()
        if username in _CLEANUP_EXCLUDED:
            continue

        uac = int(entry.userAccountControl.value) if entry.userAccountControl else 512
        is_disabled = bool(uac & 2)

        # Calcular última actividad
        last_active: datetime.datetime | None = None
        try:
            ft = int(entry.lastLogonTimestamp.value) if entry.lastLogonTimestamp else 0
            last_active = _filetime_to_dt(ft)
        except Exception:
            pass

        if last_active is None:
            try:
                wc = entry.whenCreated.value
                if isinstance(wc, datetime.datetime):
                    last_active = wc.replace(tzinfo=None)
                else:
                    last_active = datetime.datetime.strptime(str(wc)[:14], '%Y%m%d%H%M%S')
            except Exception:
                continue

        dn = entry.entry_dn
        try:
            if is_disabled and last_active < delete_cutoff:
                conn2 = get_ldap_connection()
                try:
                    conn2.delete(dn)
                    if conn2.result['result'] == 0:
                        deleted_list.append(str(entry.sAMAccountName))
                    else:
                        errors.append({'user': str(entry.sAMAccountName), 'error': conn2.result['description']})
                finally:
                    conn2.unbind()
            elif not is_disabled and last_active < disable_cutoff:
                conn2 = get_ldap_connection()
                try:
                    conn2.modify(dn, {'userAccountControl': [(ldap3.MODIFY_REPLACE, [514])]})
                    if conn2.result['result'] == 0:
                        disabled_list.append(str(entry.sAMAccountName))
                    else:
                        errors.append({'user': str(entry.sAMAccountName), 'error': conn2.result['description']})
                finally:
                    conn2.unbind()
        except Exception as e:
            errors.append({'user': str(entry.sAMAccountName), 'error': str(e)})

    logger.info('Cleanup: %d deshabilitados, %d eliminados, %d errores',
                len(disabled_list), len(deleted_list), len(errors))
    return {'disabled': disabled_list, 'deleted': deleted_list, 'errors': errors}


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

    # Enable account + force password change on next Windows login
    conn2 = get_ldap_connection()
    try:
        conn2.modify(dn, {
            'userAccountControl': [(ldap3.MODIFY_REPLACE, [512])],
            'pwdLastSet':         [(ldap3.MODIFY_REPLACE, [0])],
        })
        if conn2.result['result'] != 0:
            logger.warning('No se pudo habilitar cuenta %s: %s', username, conn2.result)
    finally:
        conn2.unbind()

    logger.info('Usuario AD creado y habilitado (debe cambiar contraseña): %s (%s)', username, dn)


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
            changes['physicalDeliveryOfficeName'] = [(ldap3.MODIFY_REPLACE, [data['office']] if data['office'] else [])]
        if 'title' in data and data['title'] is not None:
            changes['title'] = [(ldap3.MODIFY_REPLACE, [data['title']] if data['title'] else [])]
        if 'email' in data and data['email'] is not None:
            changes['mail'] = [(ldap3.MODIFY_REPLACE, [data['email']] if data['email'] else [])]
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

        elif parsed.path == '/list-groups':
            try:
                groups = list_ad_groups()
                self.send_json(200, {'groups': groups})
            except Exception as e:
                logger.error('Error list-groups: %s', e)
                self.send_json(500, {'error': str(e)})

        elif parsed.path == '/group-members':
            dn = params.get('dn', [''])[0].strip()
            if not dn:
                return self.send_json(400, {'error': 'dn es requerido'})
            try:
                members = get_group_members(dn)
                self.send_json(200, {'members': members})
            except Exception as e:
                logger.error('Error group-members: %s', e)
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

        elif path == '/add-to-group':
            group_dn = body.get('groupDn', '').strip()
            user_dn  = body.get('userDn', '').strip()
            if not group_dn or not user_dn:
                return self.send_json(400, {'error': 'groupDn y userDn son requeridos'})
            try:
                add_to_group(group_dn, user_dn)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error add-to-group: %s', e)
                self.send_json(500, {'error': str(e)})

        elif path == '/remove-from-group':
            group_dn = body.get('groupDn', '').strip()
            user_dn  = body.get('userDn', '').strip()
            if not group_dn or not user_dn:
                return self.send_json(400, {'error': 'groupDn y userDn son requeridos'})
            try:
                remove_from_group(group_dn, user_dn)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error remove-from-group: %s', e)
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

        elif path == '/create-group':
            name = body.get('name', '').strip()
            if not name:
                return self.send_json(400, {'error': 'name es requerido'})
            description = body.get('description', '').strip()
            try:
                dn = create_ad_group(name, description)
                self.send_json(200, {'success': True, 'dn': dn})
            except Exception as e:
                logger.error('Error create-group %s: %s', name, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/normalize-groups':
            try:
                result = normalize_groups_to_uppercase()
                self.send_json(200, result)
            except Exception as e:
                logger.error('Error normalize-groups: %s', e)
                self.send_json(500, {'error': str(e)})

        elif path == '/disable-user':
            username = body.get('username', '').strip()
            if not username:
                return self.send_json(400, {'error': 'username es requerido'})
            try:
                disable_user(username)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error disable-user %s: %s', username, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/enable-user':
            username = body.get('username', '').strip()
            if not username:
                return self.send_json(400, {'error': 'username es requerido'})
            try:
                enable_user(username)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error enable-user %s: %s', username, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/delete-user':
            username = body.get('username', '').strip()
            if not username:
                return self.send_json(400, {'error': 'username es requerido'})
            try:
                delete_user(username)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error delete-user %s: %s', username, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/delete-group':
            group_dn = body.get('groupDn', '').strip()
            if not group_dn:
                return self.send_json(400, {'error': 'groupDn es requerido'})
            try:
                delete_group(group_dn)
                self.send_json(200, {'success': True})
            except Exception as e:
                logger.error('Error delete-group %s: %s', group_dn, e)
                self.send_json(500, {'error': str(e)})

        elif path == '/cleanup-inactive':
            disable_months = int(body.get('disableMonths', 7))
            delete_months  = int(body.get('deleteMonths',  8))
            try:
                result = cleanup_inactive_users(disable_months, delete_months)
                self.send_json(200, result)
            except Exception as e:
                logger.error('Error cleanup-inactive: %s', e)
                self.send_json(500, {'error': str(e)})

        else:
            self.send_json(404, {'error': 'Not found'})


if __name__ == '__main__':
    httpd = HTTPServer(('0.0.0.0', PORT), Handler)
    logger.info('AD Bridge (Samba RPC + LDAP) en http://0.0.0.0:%d', PORT)
    httpd.serve_forever()
