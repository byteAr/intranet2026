# Contexto del proyecto — intranet2026

Plataforma intranet institucional completa: comunicaciones internas, reserva de equipos, seguimiento de incidencias, chat en tiempo real y gestión de correo institucional.

---

## ⚠️ REGLA OBLIGATORIA — Workflow tras cada cambio de código

**SIEMPRE** al terminar cualquier edición de código:

1. Hacer `git add` + `git commit` + `git push origin <rama-actual>`
2. Dar al usuario los comandos exactos para aplicar en el servidor remoto

**El usuario NO tiene Docker local. Todo corre en el servidor Debian `10.98.40.24`.**

Comandos a dar siempre después de cada push:

```bash
ssh usuario@10.98.40.24
cd /usr/local/proyectos/intranet2026
git pull origin <rama>

# Si hubo cambios en backend:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend

# Si hubo cambios en frontend:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build frontend
```

Nunca terminar una sesión de cambios sin dar estos comandos. Es un requisito no negociable.

---

## Stack
- **Backend**: NestJS 11 (Node.js), puerto 3000 (prod: 3001 interno)
- **Frontend**: Angular 20 standalone, puerto 4200 (prod: 8280)
- **Base de datos**: PostgreSQL 16 (TypeORM, synchronize=true en dev)
- **Auth**: Active Directory (LDAP/LDAPS) en 10.98.40.22, dominio `iugnad.lan`
- **Real-time**: Socket.IO (namespaces por módulo) + Web Push Notifications
- **Deploy**: Docker Compose en servidor Debian

---

## Infraestructura

### Servidor de producción
- IP: `10.98.40.24`, OS: Debian
- Path: `/usr/local/proyectos/intranet2026`
- Compose: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
- Contenedores: `intranet_postgres`, `intranet_backend`, `intranet_frontend`, `intranet_openldap`, `intranet_phpldapadmin`, `intranet_ad_bridge`
- Frontend: `http://10.98.40.24:8280` (externo)
- Backend: `127.0.0.1:3001` (solo interno, prefix `/api`)

### PC de desarrollo (oficina)
- Windows 10, sin Docker Desktop
- Docker Engine corre dentro de WSL (Ubuntu)
- Levantar con `docker compose` desde consola WSL

### Repositorio
- GitHub: https://github.com/byteAr/intranet2026.git
- Rama principal: `main`

---

## Módulos del backend (`backend/src/`)

### 1. Auth (`auth/`)

**Endpoints:**
| Ruta | Método | Auth | Throttle | Descripción |
|------|--------|------|----------|-------------|
| `/api/auth/login` | POST | - | 5/min | Login LDAP → JWT |
| `/api/auth/forgot-password` | POST | - | 3/min | Envía OTP al email de recuperación |
| `/api/auth/verify-otp` | POST | - | 5/min | Verifica código OTP |
| `/api/auth/reset-password` | POST | - | 5/min | Resetea contraseña con OTP |
| `/api/auth/change-password` | POST | JWT | - | Cambia contraseña (requiere actual) |

**Servicios clave:**
- `ldap.strategy.ts` — Passport LDAP strategy, extrae atributos AD → User entity
- `jwt.strategy.ts` — Verifica JWT, carga user de DB
- `auth.service.ts` — Upsert User desde entry LDAP, firma JWT
- `password-reset.service.ts` — OTP en memoria (10 min expiry), reset vía AD Bridge

**Flujo de password reset:**
1. `forgot-password` → busca `recoveryEmail` en DB (o mail del AD), genera OTP 4 dígitos, envía por SMTP
2. `verify-otp` → valida código
3. `reset-password` → llama a `linux-ad-bridge` vía LDAPS para cambiar en AD

---

### 2. Users (`users/`)

**Endpoints:**
| Ruta | Método | Auth | Descripción |
|------|--------|------|-------------|
| `/api/users/me` | GET | JWT | Perfil del usuario actual |
| `/api/users/me` | PATCH | JWT | Actualiza perfil (recoveryEmail, avatar) |
| `/api/users/search` | GET | JWT | Búsqueda en DB + LDAP |
| `/api/users/ensure` | POST | - | Crea usuario stub si no existe |
| `/api/users/:id/avatar` | GET | - | Descarga avatar (público) |
| `/api/users/:id` | GET | JWT + admin | Usuario por ID |

**Entidad `User`:**
```
id: UUID | username | email | displayName | firstName | lastName
roles: string[]        — extraídos de AD memberOf
adDn | upn             — campos de Active Directory
title | department | company | phone | mobile | office | manager | employeeId
isActive | lastLoginAt
recoveryEmail          — para reset de contraseña vía OTP
avatar                 — base64 data URI (máx 6MB, servido en /api/users/:id/avatar)
createdAt | updatedAt
```

- `ldap-search.service.ts` — búsqueda async en directorio LDAP (fallback en search de usuarios)

---

### 3. Chat (`chat/`)

**Endpoints REST:**
| Ruta | Método | Auth | Descripción |
|------|--------|------|-------------|
| `/api/chat/upload` | POST | JWT | Sube adjunto (máx 50MB) |
| `/api/chat/files/:filename` | GET | - | Descarga adjunto |

**WebSocket namespace `/chat`:**
- Auth: JWT en handshake
- Presencia en tiempo real (online/offline + avatar)
- Mensajes globales (recipientId = null) y directos (DM)
- Historial y sincronización al conectar
- Marcado de leídos (`readBy: string[]`)

**Entidad `Message`:**
```
id: UUID | senderId | senderName | senderAvatar?
recipientId?           — null = mensaje global
content | attachmentUrl? | attachmentName? | attachmentSize? | attachmentMimeType?
readBy: string[]       — IDs de usuarios que lo leyeron (sender incluido desde el inicio)
createdAt
```

**Tipos de archivo permitidos:** JPG, PNG, GIF, WebP, PDF, DOCX, XLS — máx 50MB

---

### 4. Incidents (`incidents/`)

**Endpoints:**
| Ruta | Método | Auth | Roles | Descripción |
|------|--------|------|-------|-------------|
| `/api/incidents` | POST | JWT | - | Crear incidencia (imagen opcional, máx 10MB) |
| `/api/incidents` | GET | JWT | - | Listar (filtrado por rol) |
| `/api/incidents/files/:filename` | GET | - | - | Descargar adjunto |
| `/api/incidents/:id` | GET | JWT | - | Detalle de incidencia |
| `/api/incidents/:id/assign` | PATCH | JWT | TICOM | Asignar técnico |
| `/api/incidents/:id/resolve` | PATCH | JWT | TICOM | Resolver con texto de solución |
| `/api/incidents/:id/hold` | PATCH | JWT | TICOM | Poner en espera |
| `/api/incidents/:id/reactivate` | PATCH | JWT | TICOM | Reactivar desde espera |
| `/api/incidents/:id/close-unresolved` | PATCH | JWT | TICOM | Cerrar sin solución |

**Entidad `Incident`:**
```
id: UUID | creatorId | creatorName | creatorAvatar?
description | attachmentUrl? (solo imagen)
status: 'pendiente' | 'en_proceso' | 'en_espera' | 'no_resuelta' | 'finalizada'
technicianId? | technicianName? | assignedAt?
resolution? | resolvedAt?
waitingReason? | waitingSince?
unresolvedReason? | unresolvedAt? | unresolvedById? | unresolvedByName?
history: IncidentEvent[] (JSONB)   — audit trail completo
createdAt | updatedAt
```

**`IncidentEvent` (dentro del JSONB `history`):**
```
type: 'creada' | 'tomada' | 'en_espera' | 'reactivada' | 'finalizada' | 'sin_solucion'
at: string (ISO) | byName? | detail?
```

**WebSocket namespace `/incidents`:** broadcast en tiempo real de creaciones y cambios de estado.

---

### 5. Reservations (`reservations/`)

**Endpoints:**
| Ruta | Método | Auth | Roles | Descripción |
|------|--------|------|-------|-------------|
| `/api/reservations` | POST | JWT | - | Crear solicitud |
| `/api/reservations` | GET | JWT | - | Listar (filtrado por rol) |
| `/api/reservations/availability` | GET | - | - | Disponibilidad por fecha |
| `/api/reservations/blocked-periods` | GET | - | - | Períodos bloqueados |
| `/api/reservations/blocked-periods` | POST | JWT | AYUDANTIA* | Bloquear período |
| `/api/reservations/blocked-periods/:id` | DELETE | JWT | AYUDANTIA* | Desbloquear período |
| `/api/reservations/:id` | GET | JWT | - | Detalle |
| `/api/reservations/:id/approve` | PATCH | JWT | AYUDANTIA* | Aprobar (1er nivel) |
| `/api/reservations/:id/reject` | PATCH | JWT | AYUDANTIA* | Rechazar con motivo |
| `/api/reservations/:id/confirm` | PATCH | JWT | TICOM | Confirmar (2do nivel) |
| `/api/reservations/:id/ticom-cancel` | PATCH | JWT | TICOM | Cancelar definitivo |
| `/api/reservations/:id/cancel` | PATCH | JWT | - | Cancelar la propia reserva |
| `/api/reservations/:id` | PATCH | JWT | - | Editar reserva rechazada |

*AYUDANTIA = AYUDANTIADIREDTOS (piso_8) o AYUDANTIARECTORADO (piso_6)

**Entidad `Reservation`:**
```
id: UUID | creatorId | creatorName | creatorAvatar?
date: string (YYYY-MM-DD) | startTime | endTime (HH:MM) | durationHours
location: 'piso_8' | 'piso_6'
equipmentType: 'notebook' | 'equipo_completo'
conferenceUrl?

STATUS:
  pendiente_ayudantia → pendiente_ticom (aprueba AYUDANTIA)
                      → rechazada (rechaza AYUDANTIA) → [editar] → pendiente_ayudantia
  pendiente_ticom     → confirmada (confirma TICOM)
                      → cancelada  (cancela TICOM — definitivo)

Campos de workflow:
  ayudantiaApprovedById/Name/Group/At
  rejectionReason | rejectedById/Name/Group/At
  ticomConfirmedById/Name/At
  ticomCancellationReason | ticomCancelledById/Name/At
  blockCancellationReason | blockCancelledById/Name/Group/At
  creatorCancelledAt
```

**Entidad `BlockedPeriod`:**
```
id: UUID | date | startTime | endTime | location
reason | createdById | createdByName | createdByGroup | createdAt
```

**Reglas de disponibilidad:**
- Equipo compartido entre piso_8 y piso_6
- Margen de 30 min al cambiar de piso (equipo compartido)
- Al bloquear un período, las reservas confirmadas/pendientes solapadas se cancelan automáticamente

**Filtrado por rol:**
- Creador → solo las propias
- TICOM → todas
- AYUDANTIADIREDTOS → solo piso_8
- AYUDANTIARECTORADO → solo piso_6

**Servicios:**
- `reservations-email.service.ts` — notificaciones SMTP al creador, ayudantia y TICOM en cada cambio de estado
- `blocked-periods.service.ts` — lógica de bloqueo y auto-cancelación

**WebSocket namespace `/reservations`:** notificaciones en tiempo real de creaciones y cambios de estado.

---

### 6. Mail (`mail/`)

**Endpoints:**
| Ruta | Método | Auth | Roles | Descripción |
|------|--------|------|-------|-------------|
| `/api/mail/emails` | GET | JWT | - | Listar emails (paginado, filtro carpeta) |
| `/api/mail/emails/search` | GET | JWT | - | Búsqueda full-text |
| `/api/mail/emails/:id` | GET | JWT | - | Detalle + adjuntos |
| `/api/mail/emails/:id/tree` | GET | JWT | - | Árbol de referencias recursivo |
| `/api/mail/emails/:id/attachments/:aid` | GET | JWT | - | Descargar adjunto |
| `/api/mail/emails/:id/read` | POST | JWT | - | Marcar como leído |
| `/api/mail/emails/send` | POST | JWT | TICOM | Enviar email (máx 10 adjuntos) |
| `/api/mail/admin/pst-import` | POST | JWT | admin | Subir archivo PST |
| `/api/mail/admin/pst-status` | GET | JWT | admin | Estado del import PST |

**Entidades:**
```
Email:
  id: UUID | internetMessageId (unique) | mailCode?
  subject | bodyText? | bodyHtml?
  fromAddress | toAddresses: string[] | ccAddresses: string[]
  date | folder: MailFolder | isFromPstImport
  searchVector: tsvector (mantenido por trigger de DB)
  → attachments: Attachment[]
  → readStatuses: EmailReadStatus[]
  → outgoingRefs: EmailReference[]

Attachment:
  id | emailId (FK cascade) | filename | contentType | size | storagePath | createdAt

EmailReadStatus:
  id | emailId (FK cascade) | userId (FK cascade) | isRead | readAt?
  UNIQUE(emailId, userId)

EmailReference:
  id | emailId (FK cascade) — email que contiene la referencia
  referencedCode            — código institucional encontrado en el body
  referencedEmailId?        — null si el código no matchea ningún email existente

PstImportLog:
  id | filename | startedAt | finishedAt? | status: 'running'|'completed'|'failed'
  totalProcessed | inserted | skippedDuplicates | referencesResolved | attachmentsSaved
  errorMessage?
```

**Clasificación de carpetas (prioridad: tx > redgen > ejecutivos > informativos):**
```
FROM contiene DIREDTOS@MTO.GNA        → TX
TO/CC contiene REDGEN@MTO.GNA         → REDGEN
TO contiene DIREDTOS@MTO.GNA          → EJECUTIVOS
CC contiene DIREDTOS@MTO.GNA          → INFORMATIVOS
(fallback)                             → INFORMATIVOS
```

**Reglas de mailCode:**
1. Regex: `/\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g`
2. Primer código en los primeros ~150 chars del body → `mailCode`
3. Si empieza con "NOTA" u otro texto → `mailCode = null`
4. Todos los demás códigos → referencias a otros emails
5. Normalización: siempre `PREFIX NUM/YY` (ej: `DE 130/19`)

**Servicios:**
- `imap-poller.service.ts` — IMAP/IDLE listener, detecta carpeta Sent automáticamente, fallback polling 30s. En modo bridge (`MAIL_BRIDGE_URL` seteado), se deshabilita solo.
- `smtp-sender.service.ts` — envía via SMTP directo o via bridge según `MAIL_BRIDGE_URL`. Usa `MailIngestService` para guardar en DB.
- `mail-ingest.service.ts` — servicio central de ingesta (extraído de duplicados). Idempotency por `internetMessageId`, clasifica carpeta, guarda adjuntos en disco, resuelve referencias, notifica por WS.
- `mail-parser.service.ts` — clasificación de carpeta, extracción de códigos, resolución de referencias
- `pst-import.service.ts` — extrae PST, importa emails, resuelve referencias

**Guards:**
- `bridge-secret.guard.ts` — valida `Authorization: Bearer <secret>` con `timingSafeEqual` para endpoints del bridge

**Endpoints bridge (en `mail.controller.ts`):**
- `POST /api/mail/bridge/ingest` — `@Public()` + `BridgeSecretGuard`, recibe emails del mail-bridge y llama `MailIngestService.ingest()`
- `GET /api/mail/bridge/recipients?q=` — JWT normal, proxy a `GET ${MAIL_BRIDGE_URL}/ldap-search?q=` para autocompletar destinatarios desde LIBRETALDAP.GNA

**Búsqueda full-text:** PostgreSQL `tsvector` + `plainto_tsquery` (ignora chars especiales). Mantenido por trigger de DB.

**Árbol de referencias:** CTE recursiva SQL con límite de profundidad < 10 y tracking de path (evita ciclos infinitos).

**Almacenamiento de adjuntos:** disco en `MAIL_ATTACHMENTS_PATH` (/app/storage/attachments)

**Variables de entorno modo bridge:**
```env
MAIL_BRIDGE_URL=http://172.21.36.104:3002     # activa bridge mode (deshabilita IMAP poller interno)
MAIL_BRIDGE_SECRET=<secreto-compartido-min-32-chars>
```

**WebSocket namespace `/mail`:** notificaciones en tiempo real de nuevos emails y actualización de contadores.

---

### 7. Mail Bridge (`mail-bridge/`)

Puente entre el servidor de correo (`10.201.2.37`) y el servidor intranet (`10.98.40.24`). Corre en la PC con IP fija `172.21.36.104` que tiene acceso permitido al servidor de correo (los servidores están en VLANs distintas por FortiGate).

**Rama:** `feature/mail-bridge` (pendiente de merge a `main`)

**Stack:** Plain Node.js (sin TypeScript/frameworks), igual patrón que `windows-ad-bridge/server.js`.
**Dependencias:** `imapflow`, `nodemailer`, `mailparser`, `ldapjs`, `dotenv`

**Archivos:**
```
mail-bridge/
  index.js         — entry: valida env, arranca ImapPoller + HTTP server
  imap-poller.js   — poll IMAP cada 30s → POST /api/mail/bridge/ingest al backend
  smtp-server.js   — HTTP server: POST /send (SMTP relay) + GET /ldap-search (LDAP proxy)
  ldap-search.js   — búsqueda en LIBRETALDAP.GNA (10.201.0.7:389)
  package.json
  .env.example
  README.md
```

**Comportamiento del IMAP poller:**
- NO marca los mensajes como `\Seen` (para no interferir con Outlook)
- Idempotency garantizada por `internetMessageId` unique constraint en DB
- Si el backend no responde, el email no se procesa (reintenta en el próximo ciclo)
- TLS: `rejectUnauthorized: false` (cert del servidor de correo no incluye IP en SAN)
- `fetchOne` requiere tercer argumento `{ uid: true }` para usar UIDs reales

**LDAP (LIBRETALDAP.GNA):**
- Host: `10.201.0.7:389` (⚠️ NO es `10.201.2.37` — ese es el servidor de correo/IMAP)
- Bind: `DIREDTOS` (sin dominio — `DIREDTOS@gendarmeria.local` falla)
- Base DN: `OU=MTO,DC=gendarmeria,DC=local`
- Filtro: `(&(objectClass=person)(|(cn=*Q*)(mail=*Q*)(displayName=*Q*)(sAMAccountName=*Q*)))`
- "Size Limit Exceeded" se trata como límite suave: devuelve los resultados ya recolectados
- **Windows Firewall en 172.21.36.104** bloquea TCP/389 saliente para node.exe por defecto. Requiere regla:
  ```powershell
  New-NetFirewallRule -DisplayName "Node LDAP saliente 389" -Direction Outbound -Protocol TCP -RemotePort 389 -Action Allow -Profile Any
  ```

**Deploy en Windows (PC 172.21.36.104):**
- Ruta real del código: `C:\intranet2026\mail-bridge\`
- Auto-start: **Windows Scheduled Task como SYSTEM** vía `start.bat` (loop de reinicio cada 20s)
- `start.bat` (en `C:\intranet2026\mail-bridge\start.bat`):
```bat
@echo off
:loop
echo [%date% %time%] Starting mail-bridge...
node C:\intranet2026\mail-bridge\index.js
echo [%date% %time%] Process exited. Restarting in 20 seconds...
timeout /t 20 /nobreak
goto loop
```
- Instalación como servicio (ejecutar como Administrador):
```powershell
$action = New-ScheduledTaskAction `
  -Execute "C:\intranet2026\mail-bridge\start.bat" `
  -WorkingDirectory "C:\intranet2026\mail-bridge"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "mail-bridge" -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Start-ScheduledTask -TaskName "mail-bridge"
```
- Gestión: `Start-ScheduledTask "mail-bridge"`, `Stop-ScheduledTask "mail-bridge"`, `Get-ScheduledTask "mail-bridge"`
- Git en esa PC requiere ruta completa: `& "C:\Program Files\Git\bin\git.exe" pull origin feature/mail-bridge`

**UID tracking (`state.json`):**
- El poller guarda el último UID procesado por carpeta en `C:\intranet2026\mail-bridge\state.json`
- En cada ciclo busca UIDs > lastUid en lugar de filtrar por flag `\Seen`
- Esto lo hace independiente de Outlook (que está logueado con la misma cuenta DIREDTOS@MTO.GNA en esa PC)
- Si el bridge estuvo caído, al volver recupera todos los emails llegados durante ese tiempo
- Ejemplo de `state.json`: `{ "INBOX": 1542, "INBOX.Elementos enviados": 9564 }`

**Variables de entorno del bridge (`C:\intranet2026\mail-bridge\.env`):**
```env
BRIDGE_SECRET=<mismo-que-MAIL_BRIDGE_SECRET-del-servidor>
BRIDGE_BACKEND_URL=http://10.98.40.24:3000
BRIDGE_POLL_INTERVAL_MS=30000
BRIDGE_IMAP_HOST=10.201.2.37
BRIDGE_IMAP_PORT=993
BRIDGE_IMAP_TLS=true
BRIDGE_IMAP_USER=DIREDTOS@MTO.GNA
BRIDGE_IMAP_PASSWORD=<password>
BRIDGE_SMTP_HOST=smtp.mto.gna
BRIDGE_SMTP_PORT=587
BRIDGE_SMTP_USER=DIREDTOS@MTO.GNA
BRIDGE_SMTP_PASSWORD=<password>
BRIDGE_SMTP_FROM=DIREDTOS@MTO.GNA
BRIDGE_LDAP_HOST=10.201.0.7
BRIDGE_LDAP_PORT=389
BRIDGE_LDAP_BIND_USER=DIREDTOS
BRIDGE_LDAP_BIND_PASSWORD=<password>
BRIDGE_LDAP_BASE_DN=OU=MTO,DC=gendarmeria,DC=local
BRIDGE_HTTP_PORT=3002
BRIDGE_HTTP_HOST=0.0.0.0
```

**Recuperación tras formateo de la PC 172.21.36.104:**

Prerequisitos a instalar manualmente (descarga e instalación con wizard):
1. **Node.js LTS** — https://nodejs.org
2. **Git for Windows** — https://git-scm.com/download/win

Luego, desde PowerShell como **Administrador**:

```powershell
# 1. Clonar el repositorio
& "C:\Program Files\Git\bin\git.exe" clone https://github.com/byteAr/intranet2026.git C:\intranet2026
cd C:\intranet2026
& "C:\Program Files\Git\bin\git.exe" checkout feature/mail-bridge

# 2. Instalar dependencias
cd C:\intranet2026\mail-bridge
node -e "require('child_process').execSync('npm install', {stdio:'inherit'})"

# 3. Crear el archivo .env con las credenciales reales
# (completar los valores <password> y <secret> antes de ejecutar)
@"
BRIDGE_SECRET=<mismo-que-MAIL_BRIDGE_SECRET-del-servidor>
BRIDGE_BACKEND_URL=http://10.98.40.24:3000
BRIDGE_POLL_INTERVAL_MS=30000
BRIDGE_IMAP_HOST=10.201.2.37
BRIDGE_IMAP_PORT=993
BRIDGE_IMAP_TLS=true
BRIDGE_IMAP_USER=DIREDTOS@MTO.GNA
BRIDGE_IMAP_PASSWORD=<password>
BRIDGE_SMTP_HOST=smtp.mto.gna
BRIDGE_SMTP_PORT=587
BRIDGE_SMTP_USER=DIREDTOS@MTO.GNA
BRIDGE_SMTP_PASSWORD=<password>
BRIDGE_SMTP_FROM=DIREDTOS@MTO.GNA
BRIDGE_LDAP_HOST=10.201.0.7
BRIDGE_LDAP_PORT=389
BRIDGE_LDAP_BIND_USER=DIREDTOS
BRIDGE_LDAP_BIND_PASSWORD=<password>
BRIDGE_LDAP_BASE_DN=OU=MTO,DC=gendarmeria,DC=local
BRIDGE_HTTP_PORT=3002
BRIDGE_HTTP_HOST=0.0.0.0
"@ | Out-File -FilePath "C:\intranet2026\mail-bridge\.env" -Encoding utf8

# 4. Registrar la Scheduled Task
$action = New-ScheduledTaskAction `
  -Execute "C:\intranet2026\mail-bridge\start.bat" `
  -WorkingDirectory "C:\intranet2026\mail-bridge"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "mail-bridge" -Action $action -Trigger $trigger -Principal $principal -Settings $settings

# 5. Arrancar
Start-ScheduledTask -TaskName "mail-bridge"
Start-Sleep -Seconds 5

# 6. Verificar
Get-ScheduledTask -TaskName "mail-bridge" | Select-Object State
netstat -ano | findstr ":3002"
```

Resultado esperado: `State: Running` y puerto `3002` en escucha.
El archivo `state.json` se crea solo en el primer ciclo (30 segundos).

> **Nota:** el `start.bat` ya está en el repositorio, no hace falta crearlo.

---

**Estado (2026-03-27):**
- IMAP poller con UID tracking: ✅ funcionando, independiente de Outlook
- Auto-start con Scheduled Task + start.bat (reinicio cada 20s): ✅ verificado
- SMTP relay (envío desde app): ✅ funcionando
- LDAP autocompletar en Angular compose: ✅ funcionando

**Notas de diagnóstico SMTP:**
- El servidor Postfix rechaza `MAIL FROM:<>` aunque auth sea exitosa → el backend **debe** tener `MAIL_SMTP_FROM` seteado
- `docker compose restart` NO recarga variables del `.env` → usar `docker compose up -d <servicio>` para que tome cambios del `.env`
- nodemailer necesita `tls: { rejectUnauthorized: false }` (cert autofirmado en `smtp.mto.gna`)

---

### 8. Draft-Mail / MTO (`draft-mail/`)

Módulo para redacción, revisión y envío de Mensajes de Tráfico Oficial (MTO).

**Flujo de estados:**
```
draft → pending_review → approved → sent
              ↓               ↓
        needs_correction   cancelled (ticom_cancel)
              ↑
           (editar y reenviar)
```

**Roles involucrados:**
- Creador (cualquier usuario): redacta, envía a revisión, puede cancelar o editar si fue devuelto
- MTOSAUTORIZADOS / TICOM (autorizadores): revisan, aprueban o devuelven para corrección
- TICOM: además entra el hash y realiza el envío final

**Endpoints:**
| Ruta | Método | Auth | Roles | Descripción |
|------|--------|------|-------|-------------|
| `/api/draft-mail` | GET | JWT | - | Listar borradores (filtrado por rol) |
| `/api/draft-mail` | POST | JWT | - | Crear borrador (FormData, adjuntos opcionales) |
| `/api/draft-mail/next-mailcode` | GET | JWT | - | Próximo código DEI disponible |
| `/api/draft-mail/para-enviar` | GET | JWT | TICOM | Listar aprobados listos para enviar |
| `/api/draft-mail/hash/:hash` | GET | JWT | TICOM | Buscar por hash del papel firmado |
| `/api/draft-mail/pending-count` | GET | JWT | - | Conteo de pendientes de revisión |
| `/api/draft-mail/approved-count` | GET | JWT | TICOM | Conteo de aprobados pendientes de envío |
| `/api/draft-mail/authorizers` | GET/POST/DELETE | JWT | superApprover | Gestionar lista de autorizadores |
| `/api/draft-mail/:id` | GET | JWT | - | Detalle de un borrador |
| `/api/draft-mail/:id` | PATCH | JWT | creador | Editar (solo en `draft` o `needs_correction`) |
| `/api/draft-mail/:id` | DELETE | JWT | creador | Eliminar borrador |
| `/api/draft-mail/:id/submit` | POST | JWT | creador | Enviar a revisión |
| `/api/draft-mail/:id/approve` | POST | JWT | autorizador | Aprobar |
| `/api/draft-mail/:id/reject` | POST | JWT | autorizador | Devolver para corrección (con notas) |
| `/api/draft-mail/:id/cancel` | POST | JWT | creador | Cancelar (con motivo) |
| `/api/draft-mail/:id/ticom-cancel` | POST | JWT | TICOM/autorizador | Cancelar definitivo |
| `/api/draft-mail/:id/delegate` | POST | JWT | autorizador | Asignar revisor específico |
| `/api/draft-mail/:id/toggle-encryption` | POST | JWT | - | Forzar/desactivar encriptación manual |
| `/api/draft-mail/:id/enter-hash` | POST | JWT | TICOM | Ingresar hash del papel firmado (registra `hashEnteredAt`) |
| `/api/draft-mail/:id/send` | POST | JWT | TICOM | Enviar vía SMTP |
| `/api/draft-mail/:id/attachments` | POST | JWT | - | Agregar adjuntos a borrador existente |
| `/api/draft-mail/:id/attachments/:attId` | GET | JWT | - | Descargar adjunto (⚠️ requiere JWT — no usar `<a href>` directo) |
| `/api/draft-mail/:id/attachments/:attId` | DELETE | JWT | - | Eliminar adjunto individual |

**Entidad `DraftEmail`:**
```
id: UUID | hash: string|null (unique, generado al aprobar)
creatorId | creatorName | creatorUsername
subject | bodyText: text
toAddresses: string[] (simple-json) | ccAddresses: string[] (simple-json)
status: 'draft'|'pending_review'|'needs_correction'|'approved'|'sent'|'cancelled'
sendMode: 'normal'|'sass'|'siena'|'pon'   — elegido por el creador, condiciona la vista de TICOM
requiresEncryption: bool   — auto-detectado por regex PON en el body
encryptionManualOverride: bool
assignedReviewerId? | assignedReviewerName?   — delegación de revisión
approvedById? | approvedByName? | approvedByRank? | approvedAt?
correctionNotes: text?
mailCode: varchar?   — código asignado por TICOM (ej: "DEI 125/26")
hashEnteredAt? | hashEnteredById? | hashEnteredByName? | hashEnteredByRank?
sentById? | sentByName? | sentByRank? | sentAt? | sentMessageId?
cancelledById? | cancelledByName? | cancellationReason? | cancelledAt?
history: DraftHistoryEntry[] (jsonb)   — audit trail completo
attachments: DraftEmailAttachment[]    — CASCADE delete
createdAt | updatedAt
```

**sendMode — modalidades de envío:**
| Valor | Descripción | Efecto en vista TICOM |
|-------|-------------|----------------------|
| `normal` | Envío estándar | UI normal de envío |
| `sass` | Adjuntos vía sistema SASS | TICOM puede agregar texto adicional antes del bloque FDO/BT/TX |
| `siena` | Envío desde sistema SIENA externo | Botón "Enviar correo" bloqueado; TICOM descarga adjuntos y usa SIENA |
| `pon` | Adjuntos encriptados PON 33/96 | TICOM puede eliminar adjuntos y agregar versiones encriptadas |

**Documento MTO (formato visual):**
- ZOPR: fecha/hora de aprobación en formato `DDHHMMMONYR` (ej: `302003MAR26`); vacío hasta aprobar
- PROMOTOR: siempre `DIREDTOS@MTO.GNA`
- Body pre-cargado con `DEI  /YY\n\n` al crear nuevo MTO
- Body enviado: `{mailCode}.- {body}\n\nFDO: {approvedAt}     BT: {hashEnteredAt}     TX: {rank} {apellido}`
- DEI placeholder (`DEI  /26`) en body es reemplazado por el mailCode definitivo al enviar
- Hash: 8 caracteres alfanuméricos únicos, generados al aprobar, impresos en papel para verificación

**Adjuntos:**
- Almacenamiento en disco: `DRAFT_ATTACHMENTS_PATH` (default: `/app/storage/draft-attachments`)
- Límite frontend: 5 MB por archivo (error con sugerencia SASS/SIENA si supera)
- Límite backend multer: 20 MB
- ⚠️ Descarga siempre vía blob+JWT (`HttpClient responseType:'blob'`) — nunca `<a href>` directo (retorna 401)

**Detección automática de encriptación:**
- Regex PON en el body → `requiresEncryption = true` automáticamente
- Se puede forzar/desactivar con `toggle-encryption`

**WebSocket namespace `/draft-mail`:**
Eventos: `draft_submitted`, `draft_approved`, `draft_ready_to_send`, `draft_rejected`, `draft_sent`, `draft_cancelled`, `draft_status_changed`

**Rutas Angular:**
- `/correo/borradores` — vista del creador y autorizador (`DraftMailComponent`)
- `/correo/para-enviar` — vista exclusiva TICOM (`ParaEnviarComponent`)

**Variables de entorno:**
```env
DRAFT_ATTACHMENTS_PATH=/app/storage/draft-attachments   # default
```

---

### 9. Push Notifications (`push/`)

**Endpoints:**
| Ruta | Método | Auth | Descripción |
|------|--------|------|-------------|
| `/api/push/vapid-public-key` | GET | - | Obtener clave VAPID pública |
| `/api/push/subscribe` | POST | JWT | Registrar suscripción push |
| `/api/push/unsubscribe` | DELETE | JWT | Eliminar suscripción |

**Entidad `PushSubscription`:**
```
id: UUID | userId | endpoint (unique) | p256dh | auth | createdAt
```

- Web Push API (RFC 8291), autenticación VAPID
- Auto-cleanup de suscripciones inválidas (410 Gone)

---

### 10. Admin (`admin/`)

Panel de administración completo para usuarios TICOM.

**Endpoints (`/api/admin/*`, todos requieren rol TICOM):**
| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/admin/users` | GET | Listar usuarios (AD + DB merge) |
| `/api/admin/users` | POST | Crear usuario (AD + Google Workspace) |
| `/api/admin/users/:username` | PATCH | Editar área/jerarquía |
| `/api/admin/users/:username/disable` | PATCH | Deshabilitar cuenta AD |
| `/api/admin/users/:username/enable` | PATCH | Habilitar cuenta AD |
| `/api/admin/users/:username` | DELETE | Eliminar de AD + Google Workspace + DB |
| `/api/admin/username-suggestion` | GET | Sugerir username disponible |
| `/api/admin/groups` | GET | Listar grupos AD |
| `/api/admin/groups/members` | GET | Miembros de un grupo |
| `/api/admin/groups/members` | POST | Agregar usuario a grupo |
| `/api/admin/groups/members/remove` | POST | Quitar usuario de grupo |
| `/api/admin/groups/normalize` | POST | Normalizar nombres a mayúsculas |
| `/api/admin/groups` | DELETE | Eliminar grupo del AD |
| `/api/admin/departments` | GET/POST | Listar/crear áreas (crea grupo AD) |
| `/api/admin/departments/:id` | DELETE | Eliminar área |
| `/api/admin/module-permissions` | GET | Permisos de módulos por grupo |
| `/api/admin/module-permissions/:groupName` | PUT | Setear permisos de módulos |
| `/api/admin/audit-log` | GET | Log de auditoría (paginado) |
| `/api/admin/cleanup` | POST | Trigger manual de limpieza de inactivos |
| `/api/permissions/me` | GET | JWT (sin TICOM) | Módulos permitidos del usuario actual |

**Servicios:**
- `admin.service.ts` — lógica central, llama al AD bridge para todas las ops de AD
- `google-workspace.service.ts` — crea/elimina usuarios en Google Workspace vía Admin SDK con service account
- `welcome-email.service.ts` — envía email HTML con credenciales + instrucciones 2FA (imágenes inline pasos 1-7)
- `permissions.controller.ts` — controller separado sin `@Roles('TICOM')` para que cualquier usuario JWT consulte sus módulos

**Entidades:**
```
AdminAuditLog:
  id: UUID | actorUsername | actorDisplayName | description | createdAt

GroupPermission:
  id: UUID | groupName (unique) | allowedModules: string[] | updatedAt
```

**Creación de usuario — flujo completo:**
1. Validar email `@iugna.edu.ar` y disponibilidad de username (AD + DB)
2. Crear cuenta en **Google Workspace** vía Admin SDK (obligatorio — si falla, no se continúa)
3. Crear usuario en **AD** vía bridge con `pwdLastSet=0` (fuerza cambio de contraseña en Windows)
4. Si AD falla → rollback automático en Google Workspace
5. Crear **stub en DB** con `recoveryEmail` incluido (evita pedirlo en el primer login)
6. Enviar **email de bienvenida** al correo personal con credenciales e instrucciones de 2FA
7. Registrar en **audit log**

**Username generation:** `primera_letra_nombre + apellido` (ej: `mlopez`). Si existe → usa segundo nombre (ej: `mmlopez`). Mismo username en AD y en `@iugna.edu.ar`.

**Módulos configurables por grupo:**
`chat`, `incidencias`, `reservas`, `correo`, `redactar-mto`
- Sin config explícita → acceso total (backward compatible)
- Con config → solo los módulos asignados
- Items TICOM (PST import, Para enviar, Autorizadores, Administración) no son configurables

**Cron de limpieza de inactivos** (`@Cron('0 2 * * *')`):
- Inactivo > 7 meses → deshabilita cuenta AD
- Inactivo > 8 meses + deshabilitado → elimina de AD
- Usa `lastLogonTimestamp` del AD (fallback: `whenCreated`)
- Excluye: `administrator`, `guest`, `krbtgt`, `svc-pac`
- Resultado registrado en audit log como "Sistema (cron)"

**Error 773 (must change password):** `LdapAuthGuard` detecta este código y retorna mensaje claro: *"Debés cambiar tu contraseña en Windows antes de ingresar al sistema"*

**Google Workspace — configuración:**
- Service account con delegación en todo el dominio
- Scope: `https://www.googleapis.com/auth/admin.directory.user`
- JSON key en `/run/secrets/google-workspace-key.json` (montado vía Docker volume `./secrets:/run/secrets:ro`)
- Si el correo ya existe en Google → error 409 bloqueante (puede pertenecer a otro usuario)

**Email de bienvenida:**
- Template HTML en teal con credenciales AD y Gmail
- Imágenes inline (CID) pasos 1-7 desde `backend/assets/sfainstruction/`
- Alerta obligatoria de 2FA con advertencia de pérdida de acceso
- Envío no-bloqueante (si SMTP falla, el usuario igual se crea)

**Panel Angular (`/administracion`):**
- Tab Usuarios: tabla paginada con editar, deshabilitar/habilitar, eliminar
- Tab Grupos: drag & drop para mover usuarios entre grupos, eliminar grupo
- Tab Áreas: crear/eliminar áreas (crea grupo AD automáticamente)
- Tab Permisos: matriz grupo × módulo con checkboxes (optimistic update)
- Tab Actividad: audit log con timestamps relativos

---

## Autenticación y autorización

### Flujo JWT
1. `POST /api/auth/login` con username + password
2. Passport-ldapauth verifica contra LDAP/AD
3. AuthService extrae atributos → upsert User en DB
4. JWT firmado con `{ id, username, roles }`, expira en 8h
5. Frontend guarda en localStorage, adjunta como Bearer token

### Roles (extraídos de `memberOf` del AD)
- `admin` — acceso total al sistema
- `TICOM` — técnico: enviar emails, resolver incidencias, confirmar reservas
- `AYUDANTIADIREDTOS` — gestiona piso_8 (aprobar/rechazar/bloquear reservas)
- `AYUDANTIARECTORADO` — gestiona piso_6
- (Roles custom extraídos de los CN de los grupos AD)

**Backward compat:** el rol legado `AYUDANTIA` mapea a `AYUDANTIADIREDTOS`.

### Guards globales
- `JwtAuthGuard` — global, validar JWT (rutas públicas marcadas con `@Public()`)
- `RolesGuard` — verifica `user.roles` contra decorador `@Roles()`

### AD Bridge (`linux-ad-bridge`)
- Contenedor Docker interno, sin puerto expuesto al host
- Endpoint interno: `http://ad-bridge:3002/reset-password`
- Auth: Bearer token (`BRIDGE_SECRET`)
- Usa Kerberos/GSSAPI para manipular AD de forma segura
- `svc-pac` debe estar en **Domain Admins** para resetear cuentas privilegiadas
- Soporta OpenLDAP (dev) y Active Directory (prod)

---

## Frontend (`frontend/src/`)

**Framework:** Angular 20 standalone components, signals, lazy routing

### Rutas principales
```
/auth/login              — Login LDAP, forgot/reset password
/                        → redirect a /cuenta
/dashboard               — Vista general del usuario
/cuenta                  — Perfil, avatar, email de recuperación
/chat                    — Chat global + DMs, adjuntos, presencia
/incidencias             — Crear/ver/gestionar incidencias
/reservas                — Crear/aprobar/gestionar reservas de equipos
/correo                  — Inbox, búsqueda, árbol de referencias
/correo/admin            — Panel admin para importar PST
```

### Servicios core
- `auth.service.ts` — login, logout, reset, actualización de perfil
- `chat.service.ts` — WebSocket, historial, conteo de no leídos
- `incidents.service.ts` — CRUD, transiciones de estado
- `mail.service.ts` — queries, descarga adjuntos, WebSocket
- `reservations.service.ts` — CRUD, disponibilidad, aprobaciones
- `push.service.ts` — suscripción Web Push

### Guards e interceptors
- `auth.guard.ts` — protege rutas (verifica JWT)
- `jwt.interceptor.ts` — adjunta Bearer token a todas las requests
- `error.interceptor.ts` — 401 → redirect a login

### Estilos
- Tailwind CSS 4 (configuración via `tailwind.config.js` + `postcss.config.js`)
- Usar `@use 'tailwindcss/...'` (NO `@tailwind` directives)

### PWA
- Angular Service Worker (`@angular/service-worker`)
- Web Push Notifications
- Offline capability

---

## WebSocket gateways (Socket.IO)

Todos usan JWT en el handshake para autenticación.

| Namespace | Gateway | Eventos principales |
|-----------|---------|---------------------|
| `/chat` | `chat.gateway.ts` | `send_message`, `mark_read`, `visibility_change`, presencia |
| `/incidents` | `incidents.gateway.ts` | `new_incident`, `incident_update` |
| `/reservations` | `reservations.gateway.ts` | `new_reservation`, `reservation_update` |
| `/mail` | `mail.gateway.ts` | `new_email`, `email_count` |

---

## Docker

### Dev (`docker-compose.yml`)
```yaml
Servicios:
  postgres:16            — puerto 5432
  openldap:latest        — puertos 389, 636
  phpldapadmin:latest    — puerto 8090
  ad-bridge              — solo interno (no puerto expuesto)
  backend                — puerto 3000
  frontend               — puerto 4200

Volúmenes: postgres_data, openldap_data, openldap_config, chat_uploads
```

### Prod (`docker-compose.prod.yml`)
```yaml
Diferencias:
  postgres               — puerto NO expuesto
  openldap               — puerto NO expuesto
  phpldapadmin           — deshabilitado (profile)
  backend                — 127.0.0.1:3001:3000 (solo interno)
  frontend               — 8280:80 (externo)
  red: 192.168.200.0/24 (red custom)
```

### Volúmenes y persistencia de datos

#### Dev (`docker-compose.yml` base)

| Volumen / Bind mount | Ruta en contenedor | Qué persiste |
|----------------------|--------------------|--------------|
| `postgres_data` (named) | `/var/lib/postgresql/data` | Base de datos PostgreSQL completa |
| `openldap_data` (named) | `/var/lib/ldap` | Datos del directorio LDAP |
| `openldap_config` (named) | `/etc/ldap/slapd.d` | Configuración LDAP |
| `chat_uploads` (named) | `/app/uploads` | Adjuntos del chat (imágenes, PDFs, etc.) |
| `mail_attachments` (named) | `/app/storage/attachments` | Adjuntos de correos recibidos (IMAP/bridge) |
| `mail_pst` (named) | `/app/storage/pst` | Archivos PST subidos para importación |
| `draft_attachments` (named) | `/app/storage/draft-attachments` | Adjuntos de borradores MTO |
| `./backend/src` (bind) | `/app/src` | Código fuente backend (hot-reload en dev) |
| `./frontend/src` (bind) | `/app/src` | Código fuente frontend (hot-reload en dev) |

#### Dev alternativo (`docker-compose.dev.yml`)

| Bind mount | Ruta en contenedor | Nota |
|------------|--------------------|------|
| `./storage/attachments` | `/app/storage/attachments` | Adjuntos de correo en carpeta local del repo |
| `./storage/pst` | `/app/storage/pst` | PST en carpeta local del repo |

> En `docker-compose.dev.yml` los adjuntos de chat y draft-mail **no tienen volumen** → se pierden al recrear el contenedor.

#### Prod (ambos compose files combinados)

Los named volumes en producción los gestiona Docker Engine en el servidor Debian:

```
/var/lib/docker/volumes/
  intranet2026_postgres_data/_data        → datos PostgreSQL
  intranet2026_openldap_data/_data        → datos LDAP
  intranet2026_openldap_config/_data      → config LDAP
  intranet2026_chat_uploads/_data         → adjuntos chat (/app/uploads)
  intranet2026_mail_attachments/_data     → adjuntos correo recibido (/app/storage/attachments)
  intranet2026_mail_pst/_data             → uploads PST (/app/storage/pst)
  intranet2026_draft_attachments/_data    → adjuntos MTO (/app/storage/draft-attachments)
```

> El prefijo del volumen lo pone Docker Compose a partir del nombre del directorio del proyecto (`intranet2026_`).
> Verificar con `docker volume ls | grep intranet2026`.

#### Backup de volúmenes en producción

```bash
# Backup de adjuntos de correo recibido
docker run --rm -v pac_mail_attachments:/data -v $(pwd):/backup \
  alpine tar czf /backup/mail_attachments_$(date +%Y%m%d).tar.gz -C /data .

# Backup de adjuntos de borradores MTO
docker run --rm -v pac_draft_attachments:/data -v $(pwd):/backup \
  alpine tar czf /backup/draft_attachments_$(date +%Y%m%d).tar.gz -C /data .

# Backup de base de datos
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \
  pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql
```

### Comandos útiles en producción
```bash
# Ver logs del backend
docker compose -f docker-compose.prod.yml logs backend --tail=40

# Rebuild y restart
docker compose -f docker-compose.prod.yml up -d --build backend frontend

# Acceder a postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U <user> -d <db>

# Ver volúmenes del proyecto
docker volume ls | grep pac
```

### Notas de Docker
- `postgres:16-alpine` falla (arch mismatch) → usar `postgres:16`
- `osixia/phpldapadmin` está roto en esta plataforma → usar ldapadd directamente
- Frontend mapea `4200:80` (nginx escucha en 80)
- Backend no tiene `command:` override — usa `node dist/main` (producción)
- **Rebuild requerido cuando:** se agregan nuevos archivos `.ts` (el dist de Docker no se actualiza solo)
- **Nunca hacer `docker compose down -v`** en producción — elimina todos los volúmenes y se pierden adjuntos y datos de BD

---

## Variables de entorno clave

```bash
# Database
POSTGRES_HOST | POSTGRES_PORT | POSTGRES_DB | POSTGRES_USER | POSTGRES_PASSWORD

# JWT
JWT_SECRET                  # mín 64 chars
JWT_EXPIRES_IN              # default: 8h

# LDAP (dev: OpenLDAP)
LDAP_URL=ldap://openldap:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_CREDENTIALS
LDAP_SEARCH_BASE=dc=example,dc=com
LDAP_SEARCH_FILTER=(uid={{username}})   # prod: (sAMAccountName={{username}})

# AD Bridge
BRIDGE_SECRET | AD_HOST | AD_USER | AD_PASS | AD_DOMAIN | KRB5_REALM

# SMTP (para OTP y notificaciones de reservas)
SMTP_HOST | SMTP_PORT | SMTP_SECURE | SMTP_USER | SMTP_PASS | SMTP_FROM

# Mail Module (IMAP/SMTP)
IMAP_HOST | IMAP_PORT | IMAP_USER | IMAP_PASSWORD | IMAP_TLS
MAIL_SMTP_HOST | MAIL_SMTP_PORT | MAIL_SMTP_USER | MAIL_SMTP_PASSWORD | MAIL_SMTP_FROM
# ⚠️ MAIL_SMTP_FROM es obligatorio en modo bridge — si está vacío, Postfix rechaza todos los destinatarios (MAIL FROM:<>)
MAIL_ATTACHMENTS_PATH       # default: /app/storage/attachments
MAIL_PST_UPLOAD_PATH        # default: /app/storage/pst
MAIL_POLL_INTERVAL_MS       # default: 30000
MAIL_BRIDGE_URL             # si seteado: activa bridge mode (deshabilita IMAP poller)
MAIL_BRIDGE_SECRET          # secreto compartido con el mail-bridge

# Google Workspace (Admin SDK)
GOOGLE_SERVICE_ACCOUNT_PATH=/run/secrets/google-workspace-key.json  # JSON key montado como volumen
GOOGLE_WORKSPACE_ADMIN_EMAIL=mlopez@iugna.edu.ar                    # superadmin a impersonar
GOOGLE_WORKSPACE_DOMAIN=iugna.edu.ar                                # dominio institucional
# Prerequisito: service account con delegación en todo el dominio y scope admin.directory.user
# JSON key en ./secrets/google-workspace-key.json (gitignoreado, montado como /run/secrets:ro)

# Push Notifications
VAPID_MAILTO | VAPID_PUBLIC_KEY | VAPID_PRIVATE_KEY

# App
FRONTEND_URL                # para CORS
APP_PORT                    # default: 3000
NODE_ENV                    # development | production
```

---

## Workflow de desarrollo

```bash
# Backend
cd backend && npm install && npm run start:dev

# Frontend
cd frontend && npm install && npm start

# Docker (desde WSL en la PC de desarrollo)
docker compose up -d --build
docker compose logs -f backend

# Usuario de prueba (OpenLDAP dev)
# username: testuser / password: TestPass123 / role: admin

# Deploy rápido frontend (sin rebuild Docker)
cd frontend && npx ng build
docker cp dist/frontend/browser/. pac_frontend:/usr/share/nginx/html/

# Rebuild backend (cuando se agregan archivos .ts nuevos)
docker compose build backend && docker compose up -d backend
```

---

## Notas técnicas

### ldapjs 3.x
- `entry.object` es `undefined` → usar `entry.pojo.attributes` (array de `{type, values}`)
- `const obj={}; entry.pojo.attributes.forEach(a => obj[a.type]=a.values?.[0]??'')`
- Afecta: `ldap-search.service.ts` y `password-reset.service.ts`

### Angular
- Angular 20 usa `app.ts` como componente raíz (no `app.component.ts`)
- Componentes standalone (sin NgModules)

### Límites de archivo
- Avatar: 6MB (base64 en DB, servido en `/api/users/:id/avatar`)
- Chat adjuntos: 50MB
- Incidencias: 10MB (solo imágenes: JPG, PNG, GIF, WebP)
- PST imports: timeout 2 horas (archivos grandes)

### Reservas — verificación de disponibilidad
1. Reservas solapadas del mismo piso en estados activos (pendiente/confirmada)
2. Margen de 30 min al cambiar entre piso_8 ↔ piso_6 (equipo compartido)
3. Períodos bloqueados que se solapan

### Búsqueda full-text (módulo de correo)
- PostgreSQL `tsvector` mantenido por trigger de DB en tabla `emails`
- Query: `plainto_tsquery` (ignora caracteres especiales)
- Índices: folder, date, mailCode
