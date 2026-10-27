# Plan de contingencia — Intranet DIREDTOS

Cómo volver a poner en marcha la intranet si se rompe la máquina virtual, el servidor físico o la PC del puente de correo, y cómo recuperar los MTO desde el respaldo en Google Drive.

> Última revisión: 27/10/2026 (versión 1.8.17). Mantener este documento al día: cada vez que cambie una IP, una contraseña o la forma de desplegar, actualizarlo y subirlo a GitHub.

---

## 1. Qué hay y dónde está respaldado

| Qué | Dónde vive | Respaldo | Cada cuánto |
|---|---|---|---|
| **Toda la VM** (sistema, Docker, base de datos, adjuntos, desencriptados, escaneos, configuración) | VM 100 en el Proxmox `iugnad` | Backup de Proxmox (`vzdump`) en el NAS `10.98.40.2` (`/media/nas`), se guardan los **2 últimos** | Todas las noches a las 21:00 (~22 min, ~116 GB) |
| **MTO** (cuerpo + adjuntos, como `.msg`) y sus **desencriptados / SIENA** | Base de datos y volúmenes de la VM | Google Drive de `telematicodiredtos@iugna.edu.ar`, carpeta **Respaldo MTO** | Todas las madrugadas de 1:00 a 6:30 |
| **Archivos compartidos** (unidades de las oficinas y "Mis archivos") | Google Drive | Viven en Google: no se pierden con el servidor | — |
| **Código** | GitHub `byteAr/intranet2026` | Rama `develop` (producción) y `feature/mail-bridge` (puente) | Con cada cambio |
| **Configuración y secretos** (`.env`, `secrets/`, nginx y certificado, red) | Solo dentro de la VM | **Kit de contingencia cifrado** (`scripts/kit-contingencia.sh`), guardado fuera del servidor | **Hay que hacerlo**: al menos una vez por mes y con cada cambio |
| **Puente de correo** (`mail-bridge`) | PC `172.21.36.104` (DIREDTOS) | Código en GitHub; su `.env` se arma con los datos de la sección 6 | — |

### Lo que se pierde si solo queda el respaldo de Drive

Si se pierden **la VM y los backups del NAS a la vez**, el respaldo de Drive recupera **todos los MTO con sus adjuntos y desencriptados**, pero **no** lo que solo está en la base de datos:

- conversaciones del chat, reservas, incidencias, parte diario, anuncios y notificaciones;
- "Visto por", leídos/no leídos, banderitas, "Seguir" y "Mis alertas";
- borradores y MTO en redacción, firmantes, permisos por grupo y categorías de los grupos;
- accesos de las impresoras (Escaneos) y los escaneos de los últimos 90 días;
- la lista de quién envía anuncios y los correos de los avisos de reservas.

Los usuarios no se pierden: se vuelven a crear solos al iniciar sesión, porque salen del Active Directory.

Por eso **el camino principal siempre es restaurar la VM desde Proxmox** (sección 3). El respaldo de Drive es la red de seguridad.

---

## 2. Primero: ¿qué se rompió?

| Situación | Ir a |
|---|---|
| La VM no arranca, se corrompió, se borró algo grave, pero **Proxmox y el NAS andan** | **Sección 3** — Restaurar la VM desde el backup de Proxmox |
| Se perdió **el servidor físico y/o el NAS** (no hay backup de la VM) | **Sección 4** — Servidor nuevo desde cero + MTO desde Drive |
| La intranet anda pero **no llegan MTO nuevos** o no salen | **Sección 6** — Puente de correo (PC `172.21.36.104`) |
| Solo hay que recuperar MTO (por ejemplo, se borraron de la base) | **Sección 5** — Restaurar MTO desde Drive |

> ⚠️ **Nunca reiniciar la VM 100 desde el botón de Proxmox**: el reinicio forzado deja el disco para `fsck`. Desde adentro de la VM: `sync && systemctl reboot`.

---

## 3. Escenario A — Restaurar la VM desde el backup de Proxmox

Es lo más rápido y deja **todo** como estaba a la hora del último backup (21:00 del día anterior).

### 3.1 Verificar que el NAS esté montado (en el nodo Proxmox `iugnad`, no en la VM)

```bash
mountpoint /media/nas && df -h /media/nas
pvesm status
ls -lh /media/nas/dump/ | grep vzdump-qemu-100
```

`nas` tiene que mostrar ~1,9 TB (distinto de `local`). Si no está montado: `mount /media/nas`.

### 3.2 Restaurar

Desde la interfaz web de Proxmox: **VM 100 → Backup → elegir el backup más nuevo → Restore**. Tilda "Start after restore" solo si no hay otra VM con la IP `10.98.40.24` prendida.

O desde la consola del nodo (la VM tiene que estar apagada; `--force` reemplaza el disco actual):

```bash
qm stop 100
qmrestore /media/nas/dump/vzdump-qemu-100-AAAA_MM_DD-21_00_00.vma.zst 100 --force
qm start 100
```

### 3.3 Comprobar que todo levantó (en la VM, como root)

```bash
cd /usr/local/proyectos/intranet2026
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -s -o /dev/null -w "intranet: HTTP %{http_code}\n" http://127.0.0.1:8280/
curl -s http://127.0.0.1:3001/api/health; echo
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --since 10m backend | grep -iE "error|controlador" | tail -20
```

### 3.4 Recuperar los MTO que llegaron después del backup

El backup es de las 21:00. Lo que llegó entre esa hora y la falla **no está** en la VM restaurada:

1. **Lo respaldado esa madrugada en Drive** se recupera con la herramienta de la sección 5, solo del año actual (lo que ya está en la base se saltea solo):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend node dist/mto-backup/restore.js --desde=2026
   ```
2. **Lo que llegó después de la última madrugada**: hacer que el puente vuelva a leer el buzón desde la hora del backup. Ver la sección 6.6 ("Volver a leer correos").

---

## 4. Escenario B — Servidor nuevo desde cero

Para cuando no hay backup de la VM. Se necesita:

- el **kit de contingencia** (`kit-contingencia-AAAAMMDD.tar.gz.enc`) **y su contraseña**;
- acceso a GitHub (`byteAr/intranet2026`);
- acceso a la consola de Google Workspace (por si hay que rehacer la clave de la cuenta de servicio).

Si no hay kit, se puede igual: cada valor está explicado en la sección 4.4, pero algunas cosas hay que rehacerlas (ver "Si no hay kit").

### 4.1 La VM

- **Debian 12** (o 13), 8 vCPU, 16 GB de RAM, disco de **300 GB** o más (base + adjuntos ~50 GB, imágenes de Docker, escaneos y margen).
- **IP fija `10.98.40.24`** (VLAN 51, DMZ), la misma de antes: las impresoras, el puente de correo, el FortiGate y el DNS (`intranetdiredtos.iugnad.lan`) apuntan a esa IP.
- **DNS**: `10.98.40.1`, `10.98.40.10` y `9.9.9.9` (ver `servidor/etc/network/interfaces` y `servidor/resolv.conf` del kit).
- En Proxmox, el disco con `discard=on,ssd=1` (para que los backups no copien bloques borrados).

### 4.2 Paquetes y Docker

```bash
apt-get update && apt-get install -y ca-certificates curl git nginx openssl tmux
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Antes de levantar ningún contenedor**, decirle a Docker qué rangos de red puede usar. Si no, puede tomar `172.21.x.x`, que es la red de las PCs y del puente, y la intranet deja de ser alcanzable desde ahí:

```bash
cat > /etc/docker/daemon.json <<'JSON'
{
  "default-address-pools": [
    { "base": "172.28.0.0/16", "size": 24 },
    { "base": "172.29.0.0/16", "size": 24 },
    { "base": "172.30.0.0/16", "size": 24 },
    { "base": "172.31.0.0/16", "size": 24 }
  ]
}
JSON
systemctl restart docker
```

### 4.3 El código y el kit

```bash
mkdir -p /usr/local/proyectos && cd /usr/local/proyectos
git clone https://github.com/byteAr/intranet2026.git intranet2026
cd intranet2026 && git checkout develop
```

Abrir el kit (copiarlo antes a `/root`):

```bash
mkdir -p /root/kit
openssl enc -d -aes-256-cbc -pbkdf2 -in /root/kit-contingencia-AAAAMMDD.tar.gz.enc | tar xzf - -C /root/kit
cp -a /root/kit/produccion/.env /root/kit/produccion/secrets /root/kit/produccion/postgres.conf /usr/local/proyectos/intranet2026/
chmod 600 /usr/local/proyectos/intranet2026/.env /usr/local/proyectos/intranet2026/secrets/*
cat /root/kit/produccion/version-del-codigo.txt   # qué versión corría
```

### 4.4 Si no hay kit: rearmar `.env` y `secrets/`

Partir de `.env.example` (`cp .env.example .env`) y completar. Lo importante:

| Variable / archivo | Valor |
|---|---|
| `NODE_ENV` | `development` (producción corre así a propósito: sincroniza el esquema de la base) |
| `APP_PORT` | `3000` |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` | `postgres` / `5432` / `pac_db` / `pac_user` |
| `secrets/postgres_password.txt` | Contraseña nueva cualquiera (la base es nueva) |
| `secrets/jwt_secret.txt` | 64+ caracteres al azar: `openssl rand -hex 48`. Si cambia, todos vuelven a iniciar sesión y hay que volver a cargar la contraseña de DIREDTOS en Admin → Configuración (se guarda cifrada con este valor) |
| `LDAP_URL` | `ldap://10.98.40.1:389,ldap://10.98.40.10:389` |
| `LDAP_BIND_DN` | DN de la cuenta `svc-pac` (`CN=svc-pac,CN=Users,DC=iugnad,DC=lan`) |
| `secrets/ldap_bind_credentials.txt` | Contraseña de `svc-pac` (la tiene el administrador del dominio; `svc-pac` tiene que ser Domain Admin) |
| `LDAP_SEARCH_BASE` / `LDAP_SEARCH_FILTER` | `DC=iugnad,DC=lan` / `(sAMAccountName={{username}})` |
| `MAIL_BRIDGE_URL` | `https://172.21.36.104:3002` (el puente atiende HTTPS si tiene su certificado en `certs\`; si no, `http://`) |
| `MAIL_BRIDGE_SECRET` y `secrets/mail_bridge_secret.txt` | El **mismo** valor que `BRIDGE_SECRET` del `.env` del puente (sección 6). Si se pierde, se genera uno nuevo y se pone en los dos lados |
| `secrets/bridge_secret.txt` | 32+ caracteres al azar (ad-bridge y contraseñas de las impresoras). Si cambia, hay que regenerar los accesos de Escaneos y cargarlos en cada impresora |
| `MAIL_SMTP_FROM` | `DIREDTOS@MTO.GNA` (obligatorio) |
| `MAIL_UNREAD_SINCE` | Fecha ISO desde la que los MTO cuentan como no leídos (por ejemplo, el día de la restauración) |
| `SMTP_*` y `secrets/smtp_pass.txt` | Cuenta que manda los correos de la intranet (bienvenida, reservas, código de recuperación) |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | `/run/secrets/google-workspace-key.json` |
| `secrets/google-workspace-key.json` | Clave de la cuenta de servicio. Si se perdió: Google Cloud Console → proyecto de la intranet → Cuentas de servicio → la misma cuenta → Claves → **Agregar clave (JSON)**. La delegación de dominio sigue valiendo porque es la misma cuenta |
| `GOOGLE_WORKSPACE_ADMIN_EMAIL` / `GOOGLE_WORKSPACE_DOMAIN` / `GOOGLE_DRIVE_OWNER_EMAIL` | `mlopez@iugna.edu.ar` / `iugna.edu.ar` / la cuenta dueña de las unidades compartidas |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_MAILTO` | Claves de las notificaciones push. Si se perdieron: `npx web-push generate-vapid-keys` (los navegadores se vuelven a suscribir) |
| `SESSION_IDLE_MINUTES` | `480` |
| `MTO_BACKUP_ENABLED` / `MTO_BACKUP_ACCOUNT` | Dejar **sin** `MTO_BACKUP_ENABLED` hasta terminar la sección 5; después `true` y `telematicodiredtos@iugna.edu.ar` |

### 4.5 Levantar los contenedores

La primera vez con `up` (los pases normales después son con `scripts/rollout.sh`):

```bash
cd /usr/local/proyectos/intranet2026
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend   # esperar "Nest application successfully started"
```

Comprobar:

```bash
curl -s http://127.0.0.1:3001/api/health; echo        # {"ok":true}
curl -s -o /dev/null -w "frontend: HTTP %{http_code}\n" http://127.0.0.1:8280/
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend | grep -i "controladores de dominio"
```

### 4.6 HTTPS (puerto 443) con el nginx del servidor

Los usuarios entran por `https://intranetdiredtos.iugnad.lan`: el nginx del servidor (fuera de Docker) atiende el 443 con el certificado interno y pasa todo al frontend (`8280`).

```bash
cp -a /root/kit/servidor/etc/nginx/. /etc/nginx/
cp -a /root/kit/servidor/etc/ssl/private/. /etc/ssl/private/ 2>/dev/null || true
nginx -t && systemctl restart nginx
curl -sk -o /dev/null -w "HTTPS: HTTP %{http_code}\n" https://127.0.0.1/
```

Sin kit: crear un sitio en `/etc/nginx/sites-enabled/` que escuche en 443 con el certificado del dominio (lo emite la CA interna `iugnad-SERVERAD2-CA` y lo reparte la GPO) y haga `proxy_pass http://127.0.0.1:8280;` con `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` (el chat usa WebSockets) y `client_max_body_size 200m;`.

Verificar también que en el DNS del dominio `intranetdiredtos.iugnad.lan` apunte a `10.98.40.24`.

### 4.7 Restaurar los MTO

Ver la **sección 5**. Con la base vacía, conviene empezar por el año actual para que la gente tenga a mano lo reciente.

### 4.8 Rearmar lo que no está en el respaldo de Drive

Desde la intranet, con un usuario de TICOM:

1. **Administración → Configuración**: cargar la contraseña de la cuenta DIREDTOS (libreta de destinatarios de MTO).
2. **Administración → Permisos / Grupos**: categoría de cada grupo (`oficina`, `especial`, `oculto`) y módulos por grupo. Mientras no se configure, todos ven todo.
3. **Archivos compartidos**: las unidades `Intranet - <OFICINA>` siguen existiendo en Google Drive. Antes de que alguien de una oficina entre a Archivos, revisar en Drive (cuenta dueña) que no se cree una unidad duplicada; si se creó, mover el contenido y borrar la nueva.
4. **Archivos → Escaneos → Configurar impresoras**: regenerar el acceso de cada oficina y cargarlo en cada impresora (`\\10.98.40.24\escaneo-<oficina>`).
5. **Administración → Anuncios** (solo mlopez) y **Administración → Avisos de reservas**: volver a cargar las listas.
6. Agregar `MTO_BACKUP_ENABLED=true` al `.env` y aplicar: `scripts/rollout.sh backend -f docker-compose.yml -f docker-compose.prod.yml`.

### 4.9 Staging (opcional)

```bash
cd /usr/local/proyectos && git clone https://github.com/byteAr/intranet2026.git intranet2026-staging
cd intranet2026-staging && git checkout develop
cp -a /root/kit/staging/.env /root/kit/staging/.env.staging /root/kit/staging/secrets .
docker compose -p intranet_staging -f docker-compose.staging.yml up -d --build
```

Staging comparte la base de producción y **no** debe tener `MTO_BACKUP_ENABLED`.

### 4.10 Otros proyectos de la misma VM

En la VM también corren OJS (Apache + PHP en el sistema), el gimnasio, repodocentes, n8n, DSpace (Tomcat + Solr). Este documento cubre solo la intranet: si se reconstruye la VM desde cero, cada uno necesita su propio plan.

---

## 5. Restaurar los MTO desde Google Drive

Herramienta: `backend/src/mto-backup/restore.ts` (ya compilada en el contenedor como `dist/mto-backup/restore.js`). Corre **dentro del contenedor del backend**, con el backend andando.

Qué hace con cada carpeta del respaldo:

- baja el `.msg` y lo vuelve a ingresar como un MTO, por la misma vía que el puente: se reclasifica en su carpeta y se le sacan el código y las referencias, como siempre;
- **no avisa a nadie** (ni campanita, ni "Mis alertas") y le pone como fecha de ingreso la fecha del MTO, así lo viejo no aparece como "no leído";
- los demás archivos de la carpeta son los **desencriptados** (o SIENA): los guarda y los engancha a su adjunto encriptado;
- anota que ese MTO ya está en Drive, así el respaldo de la madrugada no lo vuelve a subir.

**Se puede cortar y volver a correr**: lo que ya está en la base se saltea.

1. Si el respaldo nocturno está activado, **apagarlo** mientras dura la restauración: sacar `MTO_BACKUP_ENABLED` del `.env` y aplicar con `scripts/rollout.sh backend -f docker-compose.yml -f docker-compose.prod.yml`.

2. Probar primero, sin guardar nada (solo recorre y cuenta):
   ```bash
   cd /usr/local/proyectos/intranet2026
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend node dist/mto-backup/restore.js --desde=2026 --probar
   ```

3. Restaurar por años, del más nuevo al más viejo, dentro de `tmux` para que siga aunque se corte el SSH:
   ```bash
   tmux new -s restaurar
   cd /usr/local/proyectos/intranet2026
   for a in 2026 2025 2024; do
     docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend node dist/mto-backup/restore.js --desde=$a --hasta=$a 2>&1 | tee -a /root/restauracion.log
   done
   # El resto, de una vez:
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backend node dist/mto-backup/restore.js --hasta=2023 2>&1 | tee -a /root/restauracion.log
   ```
   Para salir de `tmux` sin cortarlo: `Ctrl+B` y después `D`. Para volver: `tmux attach -t restaurar`.

4. Al final de cada tanda dice cuántos MTO restauró, cuántos ya estaban, cuántos desencriptados y los errores. Si hay errores, volver a correr el mismo año: reintenta solo lo que faltó.

5. Comprobar en la base:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT extract(year FROM date)::int AS anio, count(*) FROM emails GROUP BY 1 ORDER BY 1;"'
   ```

6. Volver a activar el respaldo nocturno (`MTO_BACKUP_ENABLED=true` y `scripts/rollout.sh backend …`).

Tiempo estimado: depende de la red; para los ~310 mil MTO, entre uno y dos días corriendo sin parar. Por eso conviene hacerlo por años, empezando por los más nuevos.

---

## 6. Puente de correo — PC `172.21.36.104` (DIREDTOS)

El puente lee el buzón `DIREDTOS@MTO.GNA` (IMAP, solo `INBOX` y "Elementos enviados"), le pasa cada MTO a la intranet (`10.98.40.24:3000`), envía los MTO que salen de la intranet (SMTP) y consulta la libreta LDAP. Corre como **tarea programada de Windows** que arranca con el equipo (`start.bat`, que lo reinicia solo cada 20 s si se cae).

> ⚠️ El buzón se archiva en pocos días: si el puente queda caído mucho tiempo, los MTO que se archivan sin haberse leído **no** vuelven a aparecer en el INBOX. Levantarlo es urgente.

### 6.1 Diagnóstico rápido (desde DEI-003, sin Escritorio Remoto)

```powershell
Get-Content \\172.21.36.104\c$\intranet2026\mail-bridge\bridge.log -Tail 40
schtasks /Query /S 172.21.36.104 /TN "mail-bridge"
```

Reiniciar:

```powershell
schtasks /End /S 172.21.36.104 /TN "mail-bridge"; schtasks /Run /S 172.21.36.104 /TN "mail-bridge"
```

### 6.2 Reinstalar el puente en una PC nueva

Requisitos de red (FortiGate): la PC tiene que llegar a `10.201.2.37` (IMAP 993, SMTP 587), a `10.201.0.7` (LDAP 389) y a `10.98.40.24:3000`; y el servidor `10.98.40.24` tiene que llegar a la PC por el `3002`. Por eso conviene que la PC nueva tenga **la misma IP, `172.21.36.104`**.

1. Instalar **Node.js 20 LTS** y **Git para Windows**.
2. Bajar el código (rama del puente):
   ```powershell
   git clone -b feature/mail-bridge https://github.com/byteAr/intranet2026.git C:\intranet2026
   cd C:\intranet2026\mail-bridge
   npm install
   ```
3. Crear `C:\intranet2026\mail-bridge\.env`:
   ```env
   BRIDGE_SECRET=<el mismo valor que MAIL_BRIDGE_SECRET del servidor>
   BRIDGE_BACKEND_URL=http://10.98.40.24:3000
   BRIDGE_POLL_INTERVAL_MS=30000

   BRIDGE_IMAP_HOST=10.201.2.37
   BRIDGE_IMAP_PORT=993
   BRIDGE_IMAP_TLS=true
   BRIDGE_IMAP_USER=DIREDTOS@MTO.GNA
   BRIDGE_IMAP_PASSWORD=<contraseña de DIREDTOS@MTO.GNA>

   BRIDGE_SMTP_HOST=10.201.2.37
   BRIDGE_SMTP_PORT=587
   BRIDGE_SMTP_USER=DIREDTOS@MTO.GNA
   BRIDGE_SMTP_PASSWORD=<contraseña de DIREDTOS@MTO.GNA>
   BRIDGE_SMTP_FROM=DIREDTOS@MTO.GNA

   BRIDGE_LDAP_HOST=10.201.0.7
   BRIDGE_LDAP_PORT=389
   BRIDGE_LDAP_BIND_USER=DIREDTOS
   BRIDGE_LDAP_BIND_PASSWORD=<contraseña de DIREDTOS@MTO.GNA>
   BRIDGE_LDAP_BASE_DN=OU=MTO,DC=gendarmeria,DC=local

   BRIDGE_HTTP_PORT=3002
   BRIDGE_HTTP_HOST=0.0.0.0
   ```
   Ojo: la libreta LDAP es `10.201.0.7`, **no** `10.201.2.37`, y el usuario va **sin** dominio (`DIREDTOS`, no `DIREDTOS@gendarmeria.local`).
4. Certificado del servidor HTTPS del puente (puerto 3002): ejecutar `generate-cert.bat`, que deja los archivos en `certs\`.
5. Firewall de Windows (PowerShell como administrador):
   ```powershell
   New-NetFirewallRule -DisplayName "mail-bridge LDAP salida" -Direction Outbound -Program "C:\Program Files\nodejs\node.exe" -Protocol TCP -RemotePort 389 -Action Allow
   New-NetFirewallRule -DisplayName "mail-bridge 3002 entrada" -Direction Inbound -Protocol TCP -LocalPort 3002 -RemoteAddress 10.98.40.24 -Action Allow
   ```
6. Tarea programada que lo arranca con el equipo, como SYSTEM:
   ```powershell
   schtasks /Create /TN "mail-bridge" /TR "C:\intranet2026\mail-bridge\start.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
   schtasks /Run /TN "mail-bridge"
   ```
7. Comprobar: en `bridge.log` tiene que aparecer `mail-bridge started` y, cuando llegue un MTO, `Ingested uid=…`. Desde el servidor:
   ```bash
   curl -sk -o /dev/null -w "puente: HTTP %{http_code}\n" https://172.21.36.104:3002/   # 401 = vivo
   ```

### 6.3 Actualizar el código del puente (sin Escritorio Remoto)

Desde DEI-003:

```powershell
git -c safe.directory=* -C \\172.21.36.104\c$\intranet2026 pull --ff-only origin feature/mail-bridge
schtasks /End /S 172.21.36.104 /TN "mail-bridge"; schtasks /Run /S 172.21.36.104 /TN "mail-bridge"
```

> Solo la primera vez después del 27/10/2026: `start.bat` pasó a estar en el repositorio y en esa PC ya existía suelto, así que el `pull` se niega a pisarlo. Antes del `pull`, una única vez:
> ```powershell
> git -c safe.directory=* -C \\172.21.36.104\c$\intranet2026 fetch origin
> git -c safe.directory=* -C \\172.21.36.104\c$\intranet2026 checkout origin/feature/mail-bridge -- mail-bridge/start.bat
> ```
> (Es el mismo contenido: no cambia nada del funcionamiento.)

### 6.4 Cambió la contraseña de DIREDTOS@MTO.GNA

En la intranet: **Administración → Configuración → Contraseña cuenta de correo DIREDTOS**. Actualiza el `.env` del puente (que se reinicia solo) y la libreta. Si el puente no responde, editar a mano `BRIDGE_IMAP_PASSWORD`, `BRIDGE_SMTP_PASSWORD` y `BRIDGE_LDAP_BIND_PASSWORD` en su `.env` y reiniciar la tarea.

### 6.5 `state.json`

Guarda hasta qué correo leyó en cada carpeta (`{"INBOX": 272804, "INBOX.Elementos enviados": 10843}`). Si se pierde, el puente vuelve a leer todo lo que haya en el buzón; no duplica nada, porque la intranet descarta lo que ya tiene.

### 6.6 Volver a leer correos desde un momento dado

Primero frenar el puente: si sigue andando, pisa `state.json` con lo que tiene en memoria.

```powershell
schtasks /End /S 172.21.36.104 /TN "mail-bridge"
Select-String -Path \\172.21.36.104\c$\intranet2026\mail-bridge\bridge.log -Pattern "2026-10-26.*Ingested uid=" | Select-Object -Last 1   # el último UID bueno antes de la falla
@{ "INBOX" = 272700; "INBOX.Elementos enviados" = 10800 } | ConvertTo-Json | Set-Content \\172.21.36.104\c$\intranet2026\mail-bridge\state.json -Encoding ascii
schtasks /Run /S 172.21.36.104 /TN "mail-bridge"
```

---

## 7. Verificación final (checklist)

- [ ] `https://intranetdiredtos.iugnad.lan` abre desde una PC del dominio, sin aviso de certificado.
- [ ] Iniciar sesión con un usuario común y con uno de TICOM.
- [ ] El log del backend dice "Controladores de dominio: 10.98.40.1, 10.98.40.10".
- [ ] **MTO's**: se ven los MTO; abrir uno con adjuntos y uno encriptado con su desencriptado (usuario ENCRIPTADO).
- [ ] Entra un MTO nuevo (mirar `bridge.log`: `Ingested uid=`) y aparece en la intranet.
- [ ] **Redactar MTO** → aprobar → enviar uno de prueba a una casilla propia: sale por el puente.
- [ ] Autocompletado de destinatarios en Redactar MTO (libreta LDAP).
- [ ] **Conversaciones**: mandar un mensaje con un adjunto.
- [ ] **Archivos compartidos**: abrir la unidad de una oficina y subir un archivo.
- [ ] **Escaneos**: escanear una hoja desde una impresora y que aparezca en segundos.
- [ ] Notificaciones push: mandar un anuncio de prueba **a uno mismo** (no desde staging).
- [ ] **Administración → Respaldo MTO**: activado, y al día siguiente con la última madrugada registrada.

---

## 8. Prevención (para que la próxima vez sea fácil)

1. **Kit de contingencia todos los meses** y con cada cambio de contraseña, `.env` o certificado:
   ```bash
   bash /usr/local/proyectos/intranet2026/scripts/kit-contingencia.sh
   ```
   Guardar el `.tar.gz.enc` **fuera del servidor** (pendrive en la caja fuerte y otra copia en otro lugar) y la contraseña aparte. Después, borrarlo del servidor.
2. **Revisar el backup de Proxmox** una vez por semana (en el nodo): `pvesm status` (que `nas` esté activo) y que haya dos backups recientes de la VM 100 en `/media/nas/dump/`.
3. **Mirar Administración → Respaldo MTO** una vez por semana: que la última madrugada no tenga errores.
4. **Una vez por año, probar la restauración**: restaurar el backup de la VM en una VM de prueba (otra ID, sin red o con otra IP) y correr `restore.js --probar` contra Drive.
5. Pendiente recomendado: un **respaldo diario de la base de datos** (`pg_dump`) también en Drive, para no perder chat, reservas, permisos y demás si se pierden a la vez la VM y el NAS.
