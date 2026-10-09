# intranet2026 — Contexto Claude

Plataforma intranet institucional: chat, incidencias, reservas, correo, MTO, push, admin.

---

## ⚠️ REGLA OBLIGATORIA — Idioma

**Responder SIEMPRE en castellano.** El usuario solo entiende castellano: todas las respuestas, los avisos cortos entre pasos y el resumen final, también después de una tarea larga o de un resumen de contexto. Nunca en inglés.

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
# cambios backend (pase sin corte: levanta el nuevo al lado, espera /api/health y apaga el viejo):
scripts/rollout.sh backend -f docker-compose.yml -f docker-compose.prod.yml
# cambios frontend (sin reiniciar nginx: copia los archivos y, si cambió nginx.conf, "nginx -s reload"):
scripts/rollout-frontend.sh -f docker-compose.yml -f docker-compose.prod.yml
# solo si cambió el contenedor del frontend en el compose (puertos, volúmenes): corte breve.
# --no-deps es obligatorio: sin él, compose también reinicia el backend.
# docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --no-deps frontend
```

### Pase sin corte (`scripts/rollout.sh`)
- El backend no tiene `container_name` ni puertos publicados en prod/staging: durante el pase conviven dos copias. nginx (servicio `frontend`) lo busca por nombre en el DNS de Docker en cada pedido (`resolver 127.0.0.11`) y, si una copia no responde, prueba la otra.
- El puerto 3000 del servidor (mail-bridge → `10.98.40.24:3000`) y `127.0.0.1:3001` (scripts) los publica ahora el `frontend`: un `server { listen 3000; }` de `nginx.conf` que reenvía todo al backend.
- Si la versión nueva no queda sana (`/api/health`: arrancó y llega a la base), el script la borra y la vieja sigue atendiendo.
- Los contenedores del backend se llaman `intranet2026-backend-N` (cambia N en cada pase): para logs, `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend`.
- La copia nueva se crea con el compose y el `.env` actuales, así que el rollout también aplica cambios de variables. `nginx.conf` va con el frontend.
- Frontend (`scripts/rollout-frontend.sh`): copia los archivos nuevos al nginx que está corriendo sin borrar los viejos (las pestañas abiertas siguen encontrando sus chunks) e `index.html`/`ngsw.json` al final; `nginx.conf` con `nginx -t` + `nginx -s reload`. No corta conexiones.
- Los navegadores se actualizan solos (`AppVersionService`): detectan el ETag nuevo de `index.html` y recargan en un momento seguro (pestaña en segundo plano, cambio de sección, 3 min sin actividad), activando antes la versión nueva del service worker. Nunca con trabajo en curso: cada pantalla lo declara con `holdWhile()` (MTO, incidencia, reserva, parte, subida, PST) y tampoco si hay foco en un campo con texto. Solo tras 1 h sin momento seguro aparece un aviso con botón.

---

## Stack e infraestructura

- **Backend**: NestJS 11, puerto 3000 (prod: `127.0.0.1:3001`, solo interno, prefix `/api`)
- **Frontend**: Angular 20 standalone, puerto 4200 (prod: `8280` externo)
- **DB**: PostgreSQL 16, TypeORM (`synchronize=true` salvo con `NODE_ENV=production`; ⚠️ producción corre con `NODE_ENV=development`, así que sincroniza el esquema solo). Log SQL: solo errores, avisos y consultas > 2 s; todas con `DB_LOG_QUERIES=true`.
- **Auth**: AD/LDAP en `10.98.40.1` (hasta el 06/10/2026 era `10.98.40.22`), dominio `iugnad.lan`. La IP se configura en el `.env` de la VM: `LDAP_URL` (backend: login y reseteo de contraseña) y, si está, `AD_HOST` (ad-bridge: alta de usuarios, grupos, limpieza); sin `AD_HOST` se usa el valor por defecto de `docker-compose.yml`.
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
- En el AD los grupos son `AYUDANTIA DIREDTOS` / `AYUDANTIA RECTORADO` (con espacio); Reservas usa los nombres juntos. El login agrega el alias (`ROLE_ALIASES` en `auth.service.ts`). Los tres grupos de ayudantía son categoría `especial`; los nombres juntos, `oculto` (no existen en el AD).
- Error AD 773 (must change password) → `LdapAuthGuard` retorna mensaje claro al usuario.
- Sockets: el JWT se verifica solo en el handshake → `scheduleSocketExpiry()` (`socket-token.util.ts`) los corta al vencer. El frontend detecta el corte (`io server disconnect`) en `/announcements` y va al login.
- Inactividad: `SESSION_IDLE_MINUTES` (default 30, vía `GET /api/auth/session-config`; en producción 480 = 8 h desde el 06/10/2026). Igual la sesión dura como mucho lo que el JWT (`JWT_EXPIRES_IN`, 8 h desde el login): no hay renovación. `IdleTimeoutService` avisa 15 s antes (anillo en `main-layout`) y hace logout. Última actividad en `localStorage` `pac_last_activity`, compartida entre pestañas; al reabrir el navegador pasado el límite, cierra aunque la cookie siga viva.
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
- Tailwind CSS **3.4** (`tailwind.config.js` + directivas `@tailwind` en `styles.scss`; `@tailwindcss/postcss` v4 está instalado pero no se usa). Sin consultas de contenedor (`@container`, `@lg:`): escribirlas en CSS del componente.
- Indicador de carga estándar: `<app-comet-spinner>` (`shared/comet-spinner`), no `animate-spin`.
- **Modo oscuro** (`darkMode: 'class'`, 1.7.13): todo sale de `styles.scss`, que traduce las clases claras (`bg-white`, `text-gray-500`…) y las `dark:…-zinc-*` a una paleta de variables (`--d-page`/`--d-sunken`/`--d-surface`/`--d-raised*` para fondos, `--d-text-1…5` blancos, `--d-line*`). En CSS propio de un componente: `:host-context(.dark) .x { color: var(--d-text-2) }`, nunca un gris fijo. ⚠️ Las reglas `[style*="background:#fff"]` oscurecen cualquier estilo en línea que contenga ese texto (también `#ffff00`): para algo que debe quedar blanco o amarillo (hoja de un documento, resaltado) usar `background-color:` o una clase.
- Logos (`public/assets/images/diredtosintranetlogo*.png`): fondo transparente; el claro para tema claro, el oscuro (texto blanco) para tema oscuro.
- Versión visible: `APP_VERSION` en `frontend/src/app/app-version.ts`. Subirla en cada pase a producción con cambios visibles.

### Límites de archivo
- Avatar: 6MB (base64 en DB, servido en `/api/users/:id/avatar` — público)
- Chat adjuntos: 50MB (JPG, PNG, GIF, WebP, PDF, DOCX, XLS, y desde la 1.7.8 TXT y RAR — estos dos también por la extensión, porque Chrome en Windows manda los .rar sin tipo; el .rar se descarga directo, sin vista previa); hasta 10 en un mismo mensaje (1.5.4): se suben con `/api/chat/upload` y van juntos en `messages.attachments` (jsonb). El primero también en `attachmentUrl/Name/…`, que leen la lista de conversaciones y los mensajes viejos. El gateway solo acepta URLs `/api/chat/files/<uuid>` (`sanitizeChatAttachments`). En la burbuja (1.7.14) van en grilla, imágenes hasta 3 por fila y documentos (tarjeta con `app-file-icon`) hasta 2, con columnas `minmax(0, ancho)`: la burbuja mide lo que ocupan y nunca pasa del 70 %.
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
TO=REDINSTITUTOS@MTO.GNA → EJECUTIVOS  (grupos de EXECUTIVE_GROUPS, solo en el Para)
CC=DIREDTOS@MTO.GNA   → INFORMATIVOS  (fallback también)
```
`EXECUTIVE_GROUPS` (`mail-parser.service.ts`, 09/10/2026): grupos de la libreta que incluyen a DIREDTOS. Al cambiar la lista, `reclassifyExecutiveGroups()` pasa a Ejecutivos los Informativos guardados que los traen en el Para (una vez por lista, marca `app_markers` `emails.executiveGroups`).

### mailCode — regex
`/\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g`
- Primer código en los primeros ~150 chars del body → `mailCode` (null si empieza con "NOTA" u otro texto).
- Resto de códigos → `EmailReference[]`. Desde el 09/10/2026 también los **mal escritos** (`findCodeMentions`, `mail-code.util.ts`; ⚠️ copia idéntica en `frontend/src/app/features/mail/mail-code.ts`, que usa la pantalla para pintarlos verde/rojo): sin `/AA` con grupo fecha-hora (`SDQ 446 (07OCT26)` → año de la fecha), año de 4 cifras (`/2026`) y `MTO SDQ 446` sin año (candidatos año del MTO y anterior; se guarda el que existe). Palabras que nunca son prefijo: `NOT_A_PREFIX`. Lo ya guardado se completó con una pasada única que solo agrega (`addInferredReferences`, marca `emails.refs`).
- Formato normalizado: `PREFIX NUM/YY` (ej: `DE 130/19`).

### Búsqueda full-text
- `search_vector` mantenido por trigger. Pesos: mailCode y asunto `A`, parte local del remitente `B`, cuerpo `D`.
- Config `es_unaccent` (= `simple` + `unaccent`): ignora tildes, sin stopwords — la `spanish` descartaba "ES", "DE", "AL" de los códigos. Si no se puede crear la extensión, cae a `simple`.
- Consulta: `websearch_to_tsquery` + `:*` en cada término (prefijo). Texto, mailCode (trigramas) y adjuntos (trigramas) se unen con `UNION`, no con `OR`.
- **Una sola palabra sin números** (1.7.5, `unitListing()`): si es el prefijo de algún código (2-5 letras: `SNF` → `"mailCode" LIKE 'SNF %'`) o el nombre de una casilla que mandó MTO (`DIRTICOM` → `upper(split_part("fromAddress",'@',1))`, índice `idx_emails_from_local` creado CONCURRENTLY), trae **todos los de eso, del más reciente al más antiguo** (si es las dos cosas, ambas); la respuesta lleva `listing` y la lista lo dice arriba. Si no es ninguna, búsqueda de texto normal.
- Orden: **con números** (`SNF 3411/26`, `2603`) mailCode exacto > `ts_rank_cd` > fecha; **sin números** (texto), por fecha, más reciente primero (1.7.5). Fragmento resaltado con `ts_headline` (marcadores U+0002/U+0003, el frontend escapa y los convierte en `<mark>`).
- ⚠️ El estado de lectura se carga aparte, sin JOIN: con JOIN + skip/take TypeORM pagina con DISTINCT y **descarta el ORDER BY**.
- Migración única en segundo plano (repara caracteres + reindexa ~300k correos, unos 5 min). La marca está en la tabla `app_markers` (`key='emails.fts'`, `value='fts:v3:<config>'`). Para forzar otra: `DELETE FROM app_markers WHERE key = 'emails.fts'` y reiniciar el backend. ⚠️ No usar el comentario de la tabla: la sincronización de TypeORM lo borra en cada arranque (así estuvo hasta el 05/10/2026 y se reindexaba siempre).

### Texto de los correos
Outlook declara `iso-8859-1` pero manda `windows-1252`: los bytes 0x80-0x9F (comillas “ ”, raya –, …) quedan como controles C1 y se ven como □. `normalizeMailText()` (`mail-text.util.ts`) los convierte al ingresar, en bridge, IMAP y PST. Además (08/10/2026):
- **Quoted-printable sin decodificar** (`decodeQpResidue`): el aviso de confidencialidad que agrega el servidor llega codificado sin declararlo ("electr=F3nico"). Si hay al menos dos bytes altos `=[89A-F][0-9A-F]`, cada tira se decodifica como UTF-8 si lo es y si no como windows-1252; un `=E1` suelto no se toca.
- **"�" (U+FFFD)** (`replaceLostSpaces`): eran espacios duros de Outlook (0xA0) en correos que decían ser UTF-8 (alinean "FDO:", "BT:", "TX:"). Se vuelven espacio, salvo pegados después de una letra ("est�"): ahí faltaba una letra con tilde y se deja.
- Reparación única de lo ya guardado en segundo plano al arrancar (`repairEncodingResidue`, marca `app_markers` `emails.encoding` = `qp-fffd:v1`); el trigger reindexa cada correo reparado.

### winmail.dat (TNEF) — adjuntos dentro de un paquete
Si el remitente manda desde Outlook en "Texto enriquecido", los adjuntos no viajan sueltos: van todos dentro de un `winmail.dat` (`application/ms-tnef`). Outlook lo abre solo; la intranet mostraba el paquete y los archivos (muchas veces encriptados `.~00`) no se veían (159 MTO del 31/03 al 08/10/2026). `tnef.util.ts` (`parseTnef`/`expandTnef`, lector propio: firma 0x223E9F78, atributos de nivel 2 `attAttachRendData`/`attAttachTitle`/`attAttachData` y nombre largo de las propiedades MAPI) los saca: al ingresar (`MailIngestService`) se guardan los archivos de adentro. Si el paquete solo trae el formato del texto o **objetos pegados** (OLE, `PR_ATTACH_METHOD` = 6: el escudo de Gendarmería), el `winmail.dat` **no se muestra** (no hay nada para descargar y confundía); si trae algún adjunto que no se supo leer, se conserva junto a lo que sí salió (`inspectTnef().unreadable`). Reparación única de lo guardado (`repairTnefAttachments`, marca `emails.tnef` = `tnef:v2`, `pg_try_advisory_lock`): crea los adjuntos nuevos y quita el `winmail.dat` de la lista (el archivo queda en el disco). Resultado del 08/10/2026: 128 paquetes con 213 archivos; 15 solo con el escudo y 16 solo con formato. La hace **producción**: staging tiene los adjuntos de solo lectura y la saltea.

### No leídos
`MAIL_UNREAD_SINCE` (ISO 8601): lo ingresado antes cuenta como leído para todos. Lo importado desde PST nunca cuenta como no leído.

### No leídos (1.8.1)
Botón "No leídos" arriba de la lista: solo los no leídos de la carpeta abierta (`GET /api/mail/emails?unread=true`), con el mismo criterio que los números de las carpetas (`getUnreadCounts`: año actual, sin PST, desde el corte del usuario). Filtra con `NOT EXISTS` sobre `email_read_status`, no con un JOIN (ver attachReadStatuses). Queda puesto al cambiar de carpeta; se apaga en Históricos.

### Marcar todo leído, banderita, Ctrl+P, Ejecutivos (1.7.0)
- **Marcar todo leído** (botón en la columna de carpetas, `POST /api/mail/mark-all-read`): guarda en `mail_read_marks` la fecha del usuario; lo ingresado antes cuenta como leído **para él** (`cutoffFor()` = el más nuevo entre `MAIL_UNREAD_SINCE` y su marca), sin crear filas en `email_read_status` (no ensucia "Visto por").
- **Banderita** (`mail_flags`, una por MTO: quién y cuándo): solo **TICOM** la ve y la pone (`POST/DELETE …/emails/:id/flag`, `@Roles('TICOM')`); es compartida entre ellos, como en el Outlook de DIREDTOS (el de turno marca hasta dónde leyó). Llega como `flag` en la lista y el detalle solo si el usuario es TICOM. **En vivo** (1.7.7): al ponerla o sacarla, el controller emite `mail_flag` `{emailId, flag}` por `/mail` a la sala `role:ticom` (se une al conectar si el JWT trae el rol TICOM); el frontend actualiza lista, MTO abierto y vista agrupada (`flagChanges`).
- **Ctrl+P** con un MTO abierto imprime con el formato de Outlook (`printEmail()`), no la página.
- **Ejecutivos** (son para cumplimentar): etiqueta **roja** llena y punto rojo en la carpeta. La fila es como las demás (se distingue leído/no leído); mientras no se abrió, la etiqueta **late** (`.badge-pulse`) y se detiene al abrirlo (1.7.2; en la 1.7.0-1.7.1 la fila entera iba coloreada y no se veía si estaba leído). Sin aviso en el detalle.
- Tablas `mail_read_marks` y `mail_flags` sin entidad: las crea `MailService.ensureMarkTables()` al arrancar.

### Seguir un MTO y "Mis alertas" (1.8.0, `mail-alerts.service.ts`, `features/mail/mail-alerts.component.ts`)
- **Seguir** (megáfono al lado de Compartir, cada usuario los suyos, tabla `mail_follows`): avisa en la campanita cuando llega un MTO que lo cita (referencia resuelta) o una corrección con el mismo `mailCode` (SVC). El que llega queda seguido también (`manual=false`): así se sigue la cadena de respuestas.
- **Mis alertas** (botón en la columna de carpetas, tabla `mail_alert_terms`): términos (DNI, nombre, expediente, frases) que se buscan en asunto, cuerpo y nombres de adjuntos de cada MTO nuevo (`mail-alert-match.util.ts`: sin tildes ni mayúsculas, números sin puntos — 29465318 = 29.465.318 —; frase tal cual o, con `allWords`, todas las palabras en cualquier orden; mínimo 3 caracteres, hasta 50 por usuario). La misma ventana lista los MTO que sigue.
- **"Probar con el MTO abierto"** (en Mis alertas, `POST …/emails/:id/test-alerts`): corre las alertas del usuario contra un MTO guardado como si acabara de llegar y manda el aviso marcado "Prueba". ⚠️ Es la única forma de probarlo en staging: **staging no recibe MTO** (el mail-bridge entrega a producción), así que ahí nunca se dispara solo.
- Lo dispara `MailIngestService` con cada MTO que entra (bridge/IMAP; no el PST ni lo ya guardado). Una notificación por usuario (tipo `mto`, que está en `NOTIFIED_TYPES`), con los motivos; al tocarla abre `/correo?mto=<id>`. El detalle del MTO trae `following`.

### Visto por (1.6.2, `features/mail/mto-viewers.component.ts`)
- Debajo del asunto: fotos encimadas de quienes abrieron el MTO (las 5 últimas, más "+N") y "N vistos"; al tocar, un cuadro con cada uno y la fecha y hora (Argentina) de la primera vez. Lo ve cualquiera que abra el MTO.
- Sale de `email_read_status` (`readAt` = primera apertura): `GET /api/mail/emails/:id/viewers` (sin la foto en base64: `hasAvatar` y se pide a `/api/users/:id/avatar`).
- El frontend llama a `POST …/read` **cada vez** que se abre un MTO (también los que ya contaban como leídos —anteriores a `MAIL_UNREAD_SINCE`, históricos— y los que se abren desde una referencia); el backend no duplica. Hasta la 1.6.1 solo se llamaba si figuraba como no leído, así que los vistos se cuentan desde esa versión.

### Compartir un MTO (1.5.0, `features/mail/mto-share.component.ts`)
- Botón "Compartir" junto a "Imprimir": WhatsApp Web (`web.whatsapp.com/send?text=`, asunto/De/Fecha/nombres de adjuntos + cuerpo recortado a 3500 caracteres; los adjuntos no viajan), por la intranet (elegir varias personas → un mensaje por persona en Conversaciones vía `ChatService.sendMessage`; a quien nunca entró se lo da de alta con `ensureUser`) y copiar enlace. El mensaje es `[nota\n\n]Te compartí el MTO <título>\n<enlace>` (hasta la 1.7.13 con 📨 delante) y Conversaciones lo muestra como tarjeta con el sobre (`MTO_SHARE_RE` en `chat.component.ts`): no cambiar el formato sin tocar las dos puntas.
- Enlace: `/correo?mto=<id>`; `MailComponent` lo lee de `queryParamMap`, abre el MTO y limpia el parámetro.
- El chat muestra los enlaces clicables (`shared/linked-text`): los de la intranet navegan adentro y el de un MTO se ve como "Abrir el MTO". Nunca interpreta HTML.

### Árbol de referencias
CTE recursiva con límite de profundidad < 10 + tracking de path para evitar ciclos infinitos.

### Endpoints bridge en backend (`mail.controller.ts`)
- `POST /api/mail/bridge/ingest` — `@Public()` + `BridgeSecretGuard` (timingSafeEqual).
- `GET /api/mail/bridge/recipients?q=` — JWT normal. Autocompletado de destinatarios de MTO: el backend consulta **directo** la libreta LDAP (`10.201.0.7`, `LdapRecipientsService`) con `DIREDTOS` (misma contraseña que los MTO). La contraseña se cambia desde Admin → Configuración (actualiza el mail-bridge y la libreta) y queda en `app_markers` (`key='mail.ldapBindPassword'`, cifrada con una clave derivada del JWT secret); si no hay, `BRIDGE_LDAP_BIND_PASSWORD` del `.env`. ⚠️ Hasta el 06/10/2026 solo quedaba en memoria: tras cada reinicio la libreta daba "Invalid Credentials" y el autocompletado no sugería nada.

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
- ZOPR: `DDHHMMMONYR` (ej: `302003MAR26`), vacío hasta aprobar. **En hora de Argentina** (`argentinaParts`, `common/argentina-time.ts`; en el front, `shared/date-group.ts`): el contenedor corre en UTC, nunca usar `getHours()`/`getDate()` para fechas que se muestran. Hasta 1.4.1 salía en UTC (3 h adelantado).
- Placeholder `DEI  /YY` en body se reemplaza por `mailCode` definitivo al enviar.
- Hash: 8 chars alfanuméricos únicos, generado al aprobar, impreso en papel físico para verificación.
- PROMOTOR siempre `DIREDTOS@MTO.GNA`.

### Adjuntos encriptados recibidos (`.~NN`) — permisos
- Original cifrado: lo ve y descarga cualquier usuario logueado (ilegible sin la clave).
- Desencriptado (`decrypted_attachments`, se desencripta fuera y se sube): sube/borra solo **TICOM**; lo ven y descargan solo **ENCRIPTADO y TICOM** (TICOM para revisar si se equivocó, desde la 1.5.1). Los datos (`decryptedFiles`: id, nombre, quién lo subió, cuándo) solo los reciben ellos. SIENA (`siena_files`): igual.
- **Qué es un MTO por SIENA** (`SienaFileService.isSiena(asunto, cuerpo)`): "SOFTWARE/SISTEMA/PLATAFORMA SIENA" o el enlace `siena.gna.gob.ar` en el cuerpo, o "SIENA" en el asunto. Hasta el 09/10/2026 solo "SOFTWARE SIENA" y se escapaban los "CIFRADO MEDIANTE SISTEMA SIENA" (IFM 839/26): sin eso no aparece la sección para subir los SIENA.
- SIENA (1.5.4): también varios a la vez (`POST …/siena-files`, campo `files`); ícono de su tipo con **"SIENA" celeste** en la esquina (`lock="siena"`) en lugar del candado verde.
- **Varios por adjunto** (1.5.2): un `.rar` encriptado trae varios documentos. TICOM elige varios a la vez (`POST …/decrypted`, campo `files`), se suman a los que hay; si se equivocó, borra ese (✕, `DELETE …/decrypted/:did`). Descarga: `GET …/decrypted/:did` (sin `:did`, el primero).
- **Arrastrar sobre el MTO** (1.5.5, solo TICOM y solo en MTO con adjuntos `.~NN` o por SIENA, `canDropFiles()`): se sueltan todos los archivos juntos sobre el panel del MTO. Cada uno va al encriptado con el mismo nombre sin extensión (`CONTRO~1.DOC` → `CONTRO~1.~00`); si hay un solo destino posible, todo va ahí; si no, un cuadro pregunta a cuál va cada uno (incluye "Archivos SIENA" si el MTO es por SIENA). Un pedido por destino (`uploadDropped`). Las carpetas se ignoran.
- **Nombre real** (1.5.3, `decrypted-name.util.ts`): el programa de PON devuelve el nombre corto de DOS (`CONTRO~1.DOC`); el verdadero está en el cuerpo (`ADJUNTO ARCHIVO "CONTROL09" (DOCX)`). Si el subido es un nombre corto y un único nombre entre comillas empieza igual, se muestra y se descarga como ese (`displayName`), con la extensión según lo que es por dentro (zip → .docx/.xlsx, OLE → .doc/.xls). Si no, el subido. En la base queda el nombre subido.
- Se muestra como tarjeta con el **ícono de su tipo (WORD, EXCEL, PDF…) y un candado abierto verde en la esquina** (`<app-file-icon lock="open">`), con "por <usuario TICOM>" y la fecha; abre el mismo visor que los adjuntos. TICOM ve el original (candado cerrado gris) y los desencriptados. **ENCRIPTADO ve solo los desencriptados**; mientras no hay ninguno, ve el original con "Todavía no se cargó el desencriptado" (`showOriginalAttachment()`).
- Se guardan en los volúmenes `decrypted_attachments` y `siena_files`. ⚠️ Hasta el 06/10/2026 no estaban en un volumen y se perdían al recrear el backend (se perdieron 5 desencriptados). `hasDecrypted` solo es verdadero si el archivo existe en disco.
- Pendiente de definir con la institución: registro de descargas, cifrado en disco, plazo de conservación.

### Detección encriptación
Regex PON en body → `requiresEncryption = true` automático. Override manual con `toggle-encryption`.

---

## Módulo Admin

### Creación de usuario — orden crítico
1. Crear en **Google Workspace** (si falla → stop, no continuar). El teléfono de recuperación (opcional) se normaliza antes (`recovery-phone.util.ts`: `011 15 1234-5678`, `+54 11…` → `+549` + 10 dígitos) y si está incompleto se rechaza con un mensaje claro: Google lo rechazaba con "Invalid recovery phone" y no se creaba el usuario.
2. Crear en **AD** vía bridge con `pwdLastSet=0` (fuerza cambio de contraseña).
3. Si AD falla → rollback automático en Google Workspace.
4. Crear stub en DB con `recoveryEmail` (evita pedirlo en el primer login).
5. Enviar email de bienvenida (no-bloqueante; si SMTP falla, el usuario igual se crea).

### Username
`primera_letra_nombre + apellido` (ej: `mlopez`). Si existe → segundo nombre (`mmlopez`). Mismo en AD y `@iugna.edu.ar`.

### Módulos configurables por grupo
`chat`, `incidencias`, `reservas`, `correo`, `redactar-mto`, `parte-diario`, `carpetas`
- Sin config explícita → acceso total (backward compatible).
- Items TICOM (PST import, Para enviar, Autorizadores, Admin) no son configurables.

### Cron limpieza (`@Cron('0 2 * * *')`)
- Inactivo >7 meses → deshabilita AD. Inactivo >8 meses + ya deshabilitado → elimina de AD.
- Usa `lastLogonTimestamp` del AD (fallback: `whenCreated`).
- Excluye: `administrator`, `guest`, `krbtgt`, `svc-pac`.

### Google Workspace
- JSON key en `/run/secrets/google-workspace-key.json`: montado archivo por archivo en `docker-compose.yml` (`./secrets/google-workspace-key.json:...:ro`). Hasta el 05/10/2026 no estaba montado en producción. Staging lo monta en `/run/google/` con su propio `GOOGLE_SERVICE_ACCOUNT_PATH`.
- Email ya existente en Google → error 409 bloqueante (puede ser de otro usuario).
- Email de bienvenida: imágenes inline (CID) pasos 1-7 desde `backend/assets/sfainstruction/`.

---

## ⚠️ Funcionalidades nuevas — etiqueta NUEVO

Toda funcionalidad nueva visible lleva la etiqueta **NUEVO** una semana desde su pase a producción: registrarla en `frontend/src/app/shared/new-badge/new-features.ts` (clave + fecha) y poner `<app-new-badge feature="...">` donde aparece (`[dot]="true"` en el menú contraído). Se oculta sola.

---

## Notificaciones — campanita (`notifications/`)

- Tabla `notifications`, una fila por destinatario (`username` en minúsculas), tipos `announcement` y `share`. Se borran a los 90 días.
- `NotificationsService.notify()` guarda, entrega en vivo por el namespace `/notifications` (sala `user:<username>`) y manda push. El service worker (`sw-custom.js`) solo muestra la push si la intranet no está a la vista; al tocarla abre `/cuenta?notificacion=<id>` (anuncio → modal) o `/archivos?compartido=<shareId>&notificacion=<id>`.
- Los anuncios llegan a todos los usuarios activos.
- ⚠️ **Solo se notifican los anuncios y los avisos de MTO (`mto`: seguir un MTO, "Mis alertas")** (09/10/2026, `NOTIFIED_TYPES` en `notifications.service.ts`): compartir, subir a la oficina (`upload`) y los escaneos (`scan`) siguen llamando a `notify()` pero no generan nada (ni campanita, ni en vivo, ni push), y la lista y el contador muestran solo esos tipos (las viejas quedan en la tabla hasta la purga de 90 días). Para volver a prender un tipo, agregarlo a `NOTIFIED_TYPES`.
- **Avisos en vivo sin campanita** (`NotificationsService.signal()` a todas las sesiones / `signalTo()` a usuarios; en el front, `notifications.signals`): no se guardan ni suenan, solo actualizan una pantalla abierta. `scan_arrived` {groupName, scanId} (pestaña Escaneos, que además se revisa cada 30 s a la vista: antes había que apretar F5) y `drive_uploaded` {groupName, folderId, files} (Archivos, solo a la oficina porque lleva nombres). ⚠️ Lo que va por `signal()` lo recibe cualquiera: nada privado en el payload.
- ⚠️ `NOTIFICATIONS_ONLY_TO` (staging): limita a quién se notifica. Staging comparte la base con producción, incluidas las suscripciones push.
- Sonido: "ding" generado con Web Audio en `notifications.service.ts`.

---

## Módulo Archivos compartidos (`shared-folders/`, ruta `/archivos`; `/carpetas` redirige)

- En el menú va justo debajo de los ítems de MTO. "Correo" se llama ahora **MTO's** (Mensajes de Tráfico Oficial); el módulo de permisos sigue siendo `correo`.

- Una **unidad compartida** de Google Drive por oficina (grupo AD con `category='oficina'`), nombre `Intranet - <GRUPO>`. Se crea al primer acceso; tabla `office_drives` (se crea sola al arrancar aunque `synchronize` esté apagado).
- Dueña/organizadora: `GOOGLE_DRIVE_OWNER_EMAIL` (o `GOOGLE_WORKSPACE_ADMIN_EMAIL`). Restricción `domainUsersOnly`.
- Miembros = integrantes **habilitados del grupo en el AD** (vía `AdminService.listAdUsers()`) con cuenta Google activa, rol `fileOrganizer`. Cron cada 30 min + `POST /api/shared-folders/sync` (TICOM). Los `organizer` no se tocan.
- Cuenta Google de un usuario: su `mail` del AD si es `@iugna.edu.ar`, si no `username@iugna.edu.ar`.
- Las operaciones se hacen **en nombre del usuario** (delegación de dominio) para que Drive registre al autor; si no tiene cuenta o Drive le niega acceso, se reintenta como la cuenta dueña. La intranet valida siempre oficina + que el archivo pertenezca a la unidad (`driveId`).
- Docs/Sheets/Slides nativos se descargan exportados (docx/xlsx/pptx; límite de export de Google: 10 MB).
- **Espacio por oficina** (1.2.0): 2 GB por integrante habilitado del grupo en el AD (todos, tengan o no cuenta de Google), mínimo 10 y tope 40 (`SHARED_FOLDERS_GB_PER_MEMBER`/`_MIN_GB`/`_MAX_GB`). `office_drives.memberCount` lo actualiza la sincronización de miembros (cron 30 min). TICOM puede fijar un valor a mano desde Mi cuenta ("Ajustar espacio", `PATCH /usage/:group`, `office_drives.quotaBytes`; null = automático). Uso = suma de `quotaBytesUsed` de la unidad **con papelera incluida** (así cuenta Google), guardado en `office_drives.usedBytes/trashedBytes`; se recalcula a los 10 min, en el cron de 30 min y tras borrar una carpeta, y entre medio se suma/resta lo que pasa por la intranet. Subir por la intranet sin lugar → 413 "No hay espacio…". Lo compartido cuenta para la oficina dueña. Lo subido directo en Drive solo lo frena el límite de unidades compartidas de la consola de Google: configurado el 05/10/2026 en la unidad organizativa **intranet unidades** (la raíz tiene 100 GB por unidad). Como es un único valor por unidad organizativa, va el **tope (40 GB)** como techo; el límite justo de cada oficina lo controla la intranet. ⚠️ Las unidades nuevas se crean en la raíz: al abrirse una oficina nueva hay que moverla a mano a "intranet unidades" (Drive y Documentos → Gestionar unidades compartidas → Cambiar unidad organizativa). Barra en Mi cuenta (TICOM ve todas: `GET /usage/all`) y en Archivos.
- ⚠️ **Eliminar es definitivo** (`files.delete` como la cuenta dueña: en una unidad compartida solo un administrador puede): la papelera seguiría ocupando espacio 30 días. No se puede recuperar.
- ⚠️ **La papelera de las unidades se vacía sola**: cada recálculo del uso que encuentra algo en la papelera (lo borrado desde Drive) llama a `files.emptyTrash({ driveId })`. Abrir Archivos pide el uso con `?fresh=1`, y antes de rechazar una subida se recalcula. Lo borrado desde Drive tampoco se puede recuperar pasados unos minutos.
- **Ámbito de acceso** (`AccessScope`): toda la unidad (`/shared-folders/:office/...`) o algo compartido (`/shared-folders/shares/:shareId/...`), con las mismas rutas. En lo compartido se verifica subiendo por `parents` que el archivo esté dentro de lo compartido; se opera como la cuenta dueña.
- **Compartir** es permiso de la intranet, no de Drive: tabla `shared_items` (`sharedWith` = username en minúsculas, rol `reader`/`writer`, `seenAt` para el badge). No se puede compartir con alguien de la misma oficina. Lo compartido en sí no se renombra ni borra desde quien lo recibe. Si quien recibe tiene cuenta `@iugna.edu.ar`, el permiso se replica en Drive (`drivePermissionId`, reader/writer) para que pueda abrirlo en Google; al quitarlo se revoca.
- **Editar en Google**: Word/Excel/PowerPoint se abren en modo de edición de Office (`rtpof=true`, sin convertir) y los nativos en su editor; la URL lleva `authuser=<cuenta @iugna>` (`googleEditUrl()` en `preview.util.ts`). ⚠️ Google escribe el `.docx/.xlsx` al cerrar el documento o al rato: mientras alguien edita, la vista previa y la descarga muestran la versión anterior (verificado en staging; la vista previa lo avisa).
- **Mis archivos** (1.4.0): espacio personal en una carpeta "Intranet - Mis archivos" del Drive ("Mi unidad") de cada usuario, creada la primera vez y operada en su nombre; no cuenta para la oficina. Se guarda en `office_drives` con `kind='personal'`, `groupName='@usuario'`, `driveId` = id de la carpeta y `ownerEmail`. En las rutas va `~mis-archivos` en lugar de la oficina (`scopeByKey`). 10 GB por persona (`SHARED_FOLDERS_PERSONAL_GB`; `quotaBytes` lo pisa). Uso = recorrido de la carpeta sin papelera (la del usuario no se toca). Sin cuenta @iugna.edu.ar → aviso para pedirla. Se puede compartir: los permisos de Drive los da el dueño de la carpeta (`grantorOf`) y quien recibe opera como él. ⚠️ `syncAll`/`syncMembers` ignoran los personales (tocar sus permisos le quitaría el acceso al dueño).
- **Archivos grandes** (> 100 MB, hasta 100 GB desde la 1.6.1 — antes 10 —, `SHARED_FOLDERS_MAX_FILE_GB`; el navegador lo recibe en `GET /offices` como `maxFileBytes`; igual manda el espacio libre de la oficina, y Google acepta hasta 750 GB por día y por cuenta): no pasan por el servidor. `POST /upload-session` valida acceso, tamaño y espacio y abre una subida reanudable en Drive (en nombre del usuario, con `Origin` para CORS); el navegador manda el archivo directo a Google en partes de 16 MB por XHR (`drive-direct-upload.ts`, reintenta y pregunta hasta dónde llegó) y cierra con `POST /upload-complete` (suma el espacio y avisa). Lo chico sigue por multer (200 MB máx.).
- **Descargas con enlace** (`folder-download.service.ts`): `POST …/files/:id/download-link` valida y firma un JWT de 2 min con secreto propio (`jwt.secret` + sufijo: no sirve como sesión); `GET /api/shared-folders/dl/:token` (`@Public`) revalida el acceso del usuario y baja el archivo, o la carpeta entera en .zip armado al vuelo (`archiver`, de a un archivo, Docs convertidos a Office, nombres repetidos con " (2)"). El navegador lo baja solo (sin blob en memoria). `ngsw-config.json` excluye `/api/**` de la navegación del service worker.
- **Subir carpetas** (arrastrar): el navegador las recorre (`webkitGetAsEntry`), crea la estructura con `POST /folders` (nombre repetido arriba → " (2)"), sube en tandas de 20 archivos o ~100 MB con `?quiet=1` y al final pide un único aviso (`POST /uploaded` con lo que quedó a la vista y el total de archivos). Hasta 1000 archivos por vez.
- **Vista previa** (`preview.util.ts`): PDF/imágenes/video en línea, texto como `text/plain` (nunca HTML/SVG en línea), Docs de Google exportados a PDF, Office convertido con LibreOffice (perfil temporal propio por conversión). Máx. 100 MB. Usa el mismo visor que los adjuntos de MTO.
- El ítem del menú aparece también para quien solo recibió algo compartido; badge con lo no visto (consulta cada 60 s).
- Requiere el scope `https://www.googleapis.com/auth/drive` en la delegación de dominio y la Drive API habilitada en el proyecto de la cuenta de servicio.
- Módulo `carpetas`: siempre disponible para todos (`MINIMAL_MODULES` en `admin.service.ts`), como chat/incidencias/reservas.

---

## Escaneos de impresoras (1.6.0, `scans/`, pestaña "Escaneos" de Archivos)

Reemplaza las carpetas de `\\serverad2`. Las impresoras escanean a una **bandeja por oficina** (grupos con categoría `oficina` y, desde el 09/10/2026, también `especial`, como AYUDANTIA: `SCAN_CATEGORIES`; un especial solo tiene bandeja si TICOM le creó el acceso — ENCRIPTADO, CIVILES… son grupos de permisos y no escanean —; no tienen unidad en Archivos y solo guardan en Mis archivos; `GET /api/scans/mine` da las bandejas de cada usuario) en la VM; lo que llega lo ven solo los integrantes de esa oficina. **No va a Drive** (no ocupa espacio) y se borra a los **90 días** (`SCANS_RETENTION_DAYS`).

- **Contenedor `scan-inbox`** (`scan-inbox/`): Samba (SMB2/3, sin SMB1) en el 445 y vsftpd en el 21 + pasivo 30000-30009 (`pasv_address` = `SCAN_PUBLIC_IP`, default `10.98.40.24`). Lee `accounts.conf` (`usuario<TAB>contraseña<TAB>carpeta`) del volumen `scan_config` cada 15 s: crea los usuarios `esc-<carpeta>`, una carpeta compartida `[escaneo-<carpeta>]` por oficina (`valid users` = solo ese usuario, `browseable = no`) y recarga; quita a los que ya no están. FTP: cada usuario encerrado en su carpeta.
- **En la impresora**: carpeta de red `\\10.98.40.24\escaneo-<carpeta>` con el usuario y la contraseña de la oficina (dominio vacío o WORKGROUP). Las que no soportan SMB2/3 (HP LaserJet Pro M521dn) van por FTP. Impresora compartida entre oficinas → un destino por oficina en su libreta.
- **Backend** (`ScansService`): la base es la que manda; cada 10 s reescribe `accounts.conf` si cambió, y cada **2 s** revisa `scan_inbox/<carpeta>/` (también subcarpetas). Un PDF o JPG se toma apenas está completo (`%%EOF` / `FFD9`, `looksComplete`) y no cambió entre dos vueltas; lo demás, tras 8 s sin cambiar. Medido el 09/10/2026: la impresora conecta al 445 al instante (no intenta el 139); la demora de ~30 s era la espera de la intranet (antes 10 s de vuelta + 15 s fijos). Los `.xml` que el Centro de digitalizaciones de Lexmark deja junto a cada escaneo (datos del trabajo) se borran de la bandeja sin mostrarlos (`IGNORED_EXT`). Al tomarlo pasa al volumen `scans`, tabla `scans` (nombre `Escaneo DD-MM-AAAA HH.MM.SS.pdf`, hora de Argentina), y avisa a la oficina (notificación `scan` → `/archivos?escaneos=<oficina>&escaneo=<id>`). Solo lo hace el backend que tiene montada la bandeja (producción): staging monta `scans` de solo lectura y no toma ni borra.
- **Staging** (comparte la base): tiene bandeja, cuentas y almacén propios; cada ambiente lista y borra solo los escaneos cuyo archivo tiene en su disco. Su `scan-inbox` va con perfil `escaneos` porque usa los mismos puertos que el de producción (SMB no admite otro puerto en las impresoras): **solo uno de los dos puede estar prendido**.
- **Accesos** (`scan_accounts`): contraseña cifrada con `secret-box.util.ts` (propósito `scan-inbox-password`) usando `BRIDGE_SECRET` (`secrets/bridge_secret.txt`, igual en staging y producción: los accesos creados al probar en staging sirven en producción), sin caracteres confusos para tipear en el panel. TICOM los crea / regenera desde la pestaña Escaneos → "Configurar impresoras" (`GET/POST /api/scans/admin/accounts`).
- **La oficina**: ver (mismo visor), descargar, renombrar (conserva la extensión), borrar (definitivo) y **Guardar en Archivos** → copia en la unidad de la oficina (ocupa su espacio, avisa como una subida) o en Mis archivos (`SharedFoldersService.upload`, que borra el archivo que recibe: se le pasa una copia). El escaneo sigue en la bandeja.
- **FortiGate**: permitir del grupo "Impresoras" a `10.98.40.24` TCP 445, 21 y 30000-30009 (relevamiento del 07/10/2026: 12 impresoras, VLAN 50 `172.21.27.0/24` y 53 `172.21.36.0/24`; la VM está en la DMZ, VLAN 51).

---

## Módulo Reservas — reglas de negocio

- Equipo compartido entre `piso_8` y `piso_6`.
- Margen de 30 min al cambiar de piso (equipo compartido).
- Bloquear período → cancela automáticamente reservas activas solapadas.
- `AYUDANTIADIREDTOS` → gestiona `piso_8`; `AYUDANTIARECTORADO` → `piso_6`.

---

## Docker — gotchas

- **Rebuild necesario** cuando se agregan archivos `.ts` nuevos (dist de Docker no se actualiza solo).
- ⚠️ **Índices creados a mano** (GIN, expresiones, `CREATE INDEX` en un servicio): declararlos en la entidad con `@Index('nombre', { synchronize: false })`. Si no, la sincronización de TypeORM (producción la tiene prendida) **los borra en cada arranque** y el servicio los vuelve a crear: con ~300k correos el de `search_vector` tarda minutos y el 09/10/2026 hizo fallar el pase sin corte (180 s). Además, la búsqueda se prepara en segundo plano (`MailService.prepareSearch()`): el backend atiende sin esperar los índices.
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
