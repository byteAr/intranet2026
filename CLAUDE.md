# intranet2026 — Contexto Claude

Plataforma intranet institucional: chat, incidencias, reservas, correo, MTO, push, admin.

---

## ⚠️ REGLA OBLIGATORIA — Workflow tras cada cambio

**SIEMPRE** al terminar cualquier edición de código:
1. `git add` + `git commit` + `git push origin <rama-actual>`
2. Dar comandos exactos para aplicar en el servidor remoto

**No hay Docker local. Todo corre en el servidor Debian `10.98.40.24`.**

```bash
ssh usuario@10.98.40.24
cd /usr/local/proyectos/intranet2026
git pull origin <rama>
# cambios backend:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend
# cambios frontend:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build frontend
```

---

## Stack e infraestructura

- **Backend**: NestJS 11, puerto 3000 (prod: `127.0.0.1:3001`, solo interno, prefix `/api`)
- **Frontend**: Angular 20 standalone, puerto 4200 (prod: `8280` externo)
- **DB**: PostgreSQL 16, TypeORM (`synchronize=true` en dev)
- **Auth**: AD/LDAP en `10.98.40.22`, dominio `iugnad.lan`
- **Real-time**: Socket.IO — namespaces: `/chat`, `/incidents`, `/reservations`, `/mail`, `/draft-mail`
- **Deploy**: Docker Compose en `10.98.40.24`, path `/usr/local/proyectos/intranet2026`
- **PC dev**: Windows 10, Docker Engine corre en WSL (Ubuntu). Levantar con `docker compose` desde WSL.
- **Repo**: GitHub `byteAr/intranet2026`, rama principal `main`

---

## Decisiones arquitectónicas no obvias

### Auth y roles
- JWT payload: `{ id, username, roles }`, 8h. Frontend guarda en localStorage.
- Roles extraídos del `memberOf` del AD (CN de los grupos AD).
- `JwtAuthGuard` global; rutas públicas con `@Public()`.
- Rol legado `AYUDANTIA` mapea a `AYUDANTIADIREDTOS`.
- Error AD 773 (must change password) → `LdapAuthGuard` retorna mensaje claro al usuario.
- AD Bridge interno (`http://ad-bridge:3002`) para ops de AD; Kerberos/GSSAPI; `svc-pac` debe ser Domain Admin.

### ldapjs 3.x — CRÍTICO
`entry.object` es `undefined`. Usar:
```js
const obj = {};
entry.pojo.attributes.forEach(a => obj[a.type] = a.values?.[0] ?? '');
```
Afecta: `ldap-search.service.ts`, `password-reset.service.ts`.

### Angular 20
- Componente raíz: `app.ts` (NO `app.component.ts`).
- Standalone components, sin NgModules.
- Tailwind CSS 4: usar `@use 'tailwindcss/...'` (NO directivas `@tailwind`).

### Límites de archivo
- Avatar: 6MB (base64 en DB, servido en `/api/users/:id/avatar` — público)
- Chat adjuntos: 50MB (JPG, PNG, GIF, WebP, PDF, DOCX, XLS)
- Incidencias: 10MB (solo imágenes)
- Draft MTO — frontend: 5MB/archivo; backend multer: 20MB
- ⚠️ Adjuntos de draft-mail siempre vía blob+JWT (`responseType:'blob'`) — nunca `<a href>` directo (retorna 401)

---

## Módulo Mail — gotchas críticos

### Modo bridge vs IMAP directo
- Si `MAIL_BRIDGE_URL` está seteado → IMAP poller interno se deshabilita automáticamente.
- ⚠️ `MAIL_SMTP_FROM` es obligatorio en modo bridge — si está vacío, Postfix rechaza con `MAIL FROM:<>`.
- `docker compose restart` NO recarga `.env` → usar `docker compose up -d <servicio>`.
- nodemailer necesita `tls: { rejectUnauthorized: false }` para `smtp.mto.gna` (cert autofirmado).

### Clasificación de carpetas (prioridad)
```
FROM=DIREDTOS@MTO.GNA → TX
TO/CC=REDGEN@MTO.GNA  → REDGEN
TO=DIREDTOS@MTO.GNA   → EJECUTIVOS
CC=DIREDTOS@MTO.GNA   → INFORMATIVOS  (fallback también)
```

### mailCode — regex
`/\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g`
- Primer código en los primeros ~150 chars del body → `mailCode` (null si empieza con "NOTA" u otro texto).
- Resto de códigos → `EmailReference[]`.
- Formato normalizado: `PREFIX NUM/YY` (ej: `DE 130/19`).

### Búsqueda full-text
PostgreSQL `tsvector` + `plainto_tsquery` (ignora chars especiales). Mantenido por trigger de DB.

### Árbol de referencias
CTE recursiva con límite de profundidad < 10 + tracking de path para evitar ciclos infinitos.

### Endpoints bridge en backend (`mail.controller.ts`)
- `POST /api/mail/bridge/ingest` — `@Public()` + `BridgeSecretGuard` (timingSafeEqual).
- `GET /api/mail/bridge/recipients?q=` — JWT normal, proxy a `${MAIL_BRIDGE_URL}/ldap-search?q=`.

---

## Mail Bridge (PC `172.21.36.104`)

Puente entre servidor de correo (`10.201.2.37`) e intranet. VLANs separadas por FortiGate.
- Stack: Plain Node.js. Archivos: `mail-bridge/` en el repo.
- Ruta en la PC: `C:\intranet2026\mail-bridge\`
- Auto-start: Windows Scheduled Task como SYSTEM via `start.bat` (loop reinicio cada 20s). El bat ya está en el repo.
- Git en esa PC: `& "C:\Program Files\Git\bin\git.exe" pull origin feature/mail-bridge`

### IMAP poller — comportamiento
- **NO marca `\Seen`** — no interferir con Outlook (misma cuenta `DIREDTOS@MTO.GNA`).
- UID tracking por carpeta en `state.json` (`{ "INBOX": 1542, ... }`). Busca UIDs > lastUid.
- Idempotency: `internetMessageId` unique constraint en DB.
- TLS: `rejectUnauthorized: false` (cert del servidor no incluye IP en SAN).
- `fetchOne` requiere `{ uid: true }` como tercer argumento para usar UIDs reales.

### LDAP del bridge (LIBRETALDAP.GNA)
- Host: `10.201.0.7:389` ⚠️ (NO `10.201.2.37` — ese es IMAP/correo).
- Bind: `DIREDTOS` sin dominio (`DIREDTOS@gendarmeria.local` falla).
- Base DN: `OU=MTO,DC=gendarmeria,DC=local`.
- "Size Limit Exceeded" = límite suave → devuelve resultados parciales (no es error).
- Windows Firewall en `172.21.36.104` bloquea TCP/389 saliente para `node.exe` por defecto → agregar regla manual.

---

## Módulo Draft-Mail / MTO

### Flujo de estados
```
draft → pending_review → approved → sent
              ↓               ↓
        needs_correction   cancelled (ticom_cancel)
              ↑
           (editar y reenviar a revisión)
```

### sendMode (elegido por el creador, afecta vista TICOM)
| Valor | Efecto |
|-------|--------|
| `normal` | Envío estándar |
| `sass` | TICOM puede agregar texto antes del bloque FDO/BT/TX |
| `siena` | Botón enviar bloqueado; TICOM descarga y usa SIENA externo |
| `pon` | TICOM puede eliminar adjuntos y subir versiones encriptadas |

### Formato del body enviado
`{mailCode}.- {body}\n\nFDO: {approvedAt}     BT: {hashEnteredAt}     TX: {rank} {apellido}`
- ZOPR: `DDHHMMMONYR` (ej: `302003MAR26`), vacío hasta aprobar.
- Placeholder `DEI  /YY` en body se reemplaza por `mailCode` definitivo al enviar.
- Hash: 8 chars alfanuméricos únicos, generado al aprobar, impreso en papel físico para verificación.
- PROMOTOR siempre `DIREDTOS@MTO.GNA`.

### Detección encriptación
Regex PON en body → `requiresEncryption = true` automático. Override manual con `toggle-encryption`.

---

## Módulo Admin

### Creación de usuario — orden crítico
1. Crear en **Google Workspace** (si falla → stop, no continuar).
2. Crear en **AD** vía bridge con `pwdLastSet=0` (fuerza cambio de contraseña).
3. Si AD falla → rollback automático en Google Workspace.
4. Crear stub en DB con `recoveryEmail` (evita pedirlo en el primer login).
5. Enviar email de bienvenida (no-bloqueante; si SMTP falla, el usuario igual se crea).

### Username
`primera_letra_nombre + apellido` (ej: `mlopez`). Si existe → segundo nombre (`mmlopez`). Mismo en AD y `@iugna.edu.ar`.

### Módulos configurables por grupo
`chat`, `incidencias`, `reservas`, `correo`, `redactar-mto`
- Sin config explícita → acceso total (backward compatible).
- Items TICOM (PST import, Para enviar, Autorizadores, Admin) no son configurables.

### Cron limpieza (`@Cron('0 2 * * *')`)
- Inactivo >7 meses → deshabilita AD. Inactivo >8 meses + ya deshabilitado → elimina de AD.
- Usa `lastLogonTimestamp` del AD (fallback: `whenCreated`).
- Excluye: `administrator`, `guest`, `krbtgt`, `svc-pac`.

### Google Workspace
- JSON key en `/run/secrets/google-workspace-key.json` (bind mount `./secrets:/run/secrets:ro`).
- Email ya existente en Google → error 409 bloqueante (puede ser de otro usuario).
- Email de bienvenida: imágenes inline (CID) pasos 1-7 desde `backend/assets/sfainstruction/`.

---

## Módulo Reservas — reglas de negocio

- Equipo compartido entre `piso_8` y `piso_6`.
- Margen de 30 min al cambiar de piso (equipo compartido).
- Bloquear período → cancela automáticamente reservas activas solapadas.
- `AYUDANTIADIREDTOS` → gestiona `piso_8`; `AYUDANTIARECTORADO` → `piso_6`.

---

## Docker — gotchas

- **Rebuild necesario** cuando se agregan archivos `.ts` nuevos (dist de Docker no se actualiza solo).
- **NUNCA `docker compose down -v`** en producción — elimina todos los volúmenes (adjuntos + BD).
- `postgres:16-alpine` falla (arch mismatch) → usar `postgres:16`.
- Frontend: nginx escucha en puerto 80 (mapeado a 4200 en dev, 8280 en prod).
- Volúmenes prod en `/var/lib/docker/volumes/intranet2026_*/`.
- Prefijo de volumen: `intranet2026_` (nombre del directorio del proyecto).

---

## Variables de entorno — solo las no obvias

```bash
# ⚠️ Obligatorio en modo bridge (Postfix rechaza MAIL FROM:<> si está vacío):
MAIL_SMTP_FROM=DIREDTOS@MTO.GNA

# Activa bridge mode y deshabilita IMAP poller interno:
MAIL_BRIDGE_URL=http://172.21.36.104:3002
MAIL_BRIDGE_SECRET=<min-32-chars, compartido con el bridge>

# Google Workspace (service account con delegación en todo el dominio):
GOOGLE_SERVICE_ACCOUNT_PATH=/run/secrets/google-workspace-key.json
GOOGLE_WORKSPACE_ADMIN_EMAIL=mlopez@iugna.edu.ar
GOOGLE_WORKSPACE_DOMAIN=iugna.edu.ar

# LDAP: prod usa sAMAccountName, dev (OpenLDAP) usa uid:
LDAP_SEARCH_FILTER=(sAMAccountName={{username}})

# JWT mín 64 chars:
JWT_SECRET=<min-64-chars>
```

---

## Workflow de desarrollo

```bash
cd backend && npm run start:dev
cd frontend && npm start

# Deploy rápido frontend (sin rebuild Docker):
cd frontend && npx ng build
docker cp dist/frontend/browser/. intranet_frontend:/usr/share/nginx/html/

# Rebuild backend (cuando hay archivos .ts nuevos):
docker compose build backend && docker compose up -d backend

# Testuser dev: username=testuser / password=TestPass123 / role=admin
```
