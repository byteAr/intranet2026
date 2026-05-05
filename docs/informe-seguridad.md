# Informe de Seguridad — Sistema Intranet Diredtos

**Medidas de protección implementadas en la plataforma**

| Campo | Detalle |
|-------|---------|
| Unidad | Dirección de Educación e Institutos |
| Área responsable | División Tecnologías de la Información y Comunicaciones |
| Fecha de emisión | Abril 2026 |
| Responsable | Cabo Marcos López |
| Clasificación | Uso interno / Auditoría — Documento controlado |

---

## Índice

1. [Descripción del sistema](#1-descripción-del-sistema)
2. [Stack tecnológico y puertos](#2-stack-tecnológico-y-puertos)
3. [Módulos funcionales](#3-módulos-funcionales)
4. [Resumen ejecutivo de controles](#4-resumen-ejecutivo-de-controles)
5. [Autenticación y gestión de sesiones](#5-autenticación-y-gestión-de-sesiones)
6. [Protección de credenciales y secretos](#6-protección-de-credenciales-y-secretos)
7. [Seguridad en la capa de transporte](#7-seguridad-en-la-capa-de-transporte)
8. [Controles de acceso y autorización](#8-controles-de-acceso-y-autorización)
9. [Protección de APIs y endpoints](#9-protección-de-apis-y-endpoints)
10. [Auditoría y trazabilidad](#10-auditoría-y-trazabilidad)
11. [Seguridad de infraestructura y contenedores](#11-seguridad-de-infraestructura-y-contenedores)
12. [Protección del frontend](#12-protección-del-frontend)
13. [Backups](#13-backups)

---

## 1. Descripción del sistema

La **Intranet Diredtos** es una plataforma web de uso interno desarrollada para la Dirección de Educación e Institutos. Centraliza las herramientas de comunicación, gestión documental y administración de usuarios en un único sistema accesible desde la red institucional.

La plataforma está desplegada sobre infraestructura Docker en un servidor Debian (`10.98.40.24`) y se integra con el Active Directory institucional para la autenticación y gestión de identidades.

---

## 2. Stack tecnológico y puertos

### 2.1 Componentes y ubicación

| Componente | Tecnología | Versión | Ubicación |
|------------|-----------|---------|-----------|
| Backend API | NestJS / Node.js | NestJS 11 | Servidor Debian `10.98.40.24` (Docker) |
| Frontend | Angular / nginx | Angular 20 | Servidor Debian `10.98.40.24` (Docker) |
| Base de datos | PostgreSQL | 16 | Servidor Debian `10.98.40.24` (Docker) |
| Caché / Blacklist | Redis | 7 | Servidor Debian `10.98.40.24` (Docker) |
| Directorio de usuarios | Active Directory (LDAP) | Windows Server | Controlador de dominio `10.98.40.22` |
| Proxy inverso / TLS | nginx | — | Servidor Debian `10.98.40.24` (host) |
| Puente de correo | Node.js (mail-bridge) | — | PC Windows `172.21.36.104` |

### 2.2 Puertos por tecnología

| Servicio | Puerto interno (Docker) | Puerto externo / acceso | Protocolo |
|----------|------------------------|------------------------|-----------|
| nginx (HTTPS — acceso institucional) | — | **443** (público) | HTTPS / TLS |
| Frontend — nginx | 80 | 8280 (solo `localhost` del servidor) | HTTP |
| Backend — NestJS | 3000 | 127.0.0.1:3001 (solo `localhost`) | HTTP |
| PostgreSQL | 5432 | 127.0.0.1:5442 (solo `localhost`) | TCP |
| Redis | 6379 | Sin exposición externa | TCP |
| Active Directory / LDAP | 389 / 636 | Red interna `10.98.40.22` | LDAP / LDAPS |
| Mail Bridge (HTTPS) | — | 3002 (red TELEMÁTICO) | HTTPS / TLS |
| IMAP (recepción de correo) | — | 993 | IMAP sobre TLS |
| SMTP (envío de correo) | — | 587 | SMTP con STARTTLS |
| OpenLDAP (solo desarrollo) | 389 / 636 | Sin exposición en producción | LDAP |

> **Nota de seguridad:** El backend, la base de datos y Redis nunca son accesibles directamente desde la red institucional. Todo el tráfico externo pasa exclusivamente por el proxy nginx en el puerto 443.

---

## 3. Módulos funcionales

### 3.1 Chat institucional

Mensajería en tiempo real entre usuarios de la plataforma con soporte de archivos adjuntos.

- Comunicación mediante Socket.IO (namespace `/chat`)
- Adjuntos: hasta 50 MB por archivo (JPG, PNG, GIF, WebP, PDF, DOCX, XLS)
- Historial persistido en PostgreSQL
- Entrega de archivos protegida por JWT (nunca URLs directas sin autenticación)

### 3.2 Gestión de incidencias

Sistema de tickets para reportar y hacer seguimiento de incidencias técnicas o institucionales.

- Comunicación en tiempo real: Socket.IO (namespace `/incidents`)
- Adjuntos: hasta 10 MB, solo imágenes
- Estados: abierta → en progreso → resuelta / cerrada

### 3.3 Sistema de reservas

Reserva de espacios físicos y equipamiento para videoconferencias, con reglas de negocio por piso.

- Comunicación en tiempo real: Socket.IO (namespace `/reservations`)
- Equipo compartido entre piso 6 y piso 8 con margen de 30 minutos al cambiar de piso
- Rol `AYUDANTIADIREDTOS` gestiona piso 8; `AYUDANTIARECTORADO` gestiona piso 6
- Bloqueo de períodos con cancelación automática de reservas solapadas

### 3.4 Módulo de correo

Integración con el servidor de correo institucional (`DIREDTOS@MTO.GNA`) mediante IMAP/SMTP o modo bridge.

- Comunicación en tiempo real: Socket.IO (namespaces `/mail`, `/draft-mail`)
- Recepción IMAP sobre TLS (puerto 993); envío SMTP con STARTTLS (puerto 587)
- Clasificación automática de carpetas según remitente/destinatario
- Búsqueda full-text con `tsvector` + `plainto_tsquery` en PostgreSQL
- Árbol de referencias con CTE recursiva y protección contra ciclos
- Adjuntos siempre servidos vía blob+JWT (nunca URLs directas — evita 401)

### 3.5 Redacción MTO (Draft-Mail)

Flujo de redacción y aprobación de correspondencia oficial con firma digital y trazabilidad.

- Flujo de estados: `draft → pending_review → approved → sent` (con desvíos a `needs_correction` / `cancelled`)
- Modos de envío: `normal`, `sass` (TICOM agrega texto), `siena` (descarga para SIENA externo), `pon` (versión encriptada)
- Hash único de 8 caracteres para verificación en papel físico
- ZOPR generado automáticamente: formato `DDHHMMMONYR`
- Detección automática de encriptación requerida vía regex en el body
- Adjuntos: hasta 5 MB por archivo en frontend, 20 MB validado en backend

### 3.6 Panel de administración

Gestión centralizada de usuarios en Active Directory y Google Workspace.

- Creación de usuario con rollback automático si falla algún paso
- Orden garantizado: Google Workspace → Active Directory (con `pwdLastSet=0`) → DB → email bienvenida
- Permisos configurables por grupo de AD para cada módulo
- Audit log de todas las acciones administrativas en tabla `admin_audit_log`
- Cron de limpieza diario a las 02:00 AM (inactividad >7 meses → deshabilita AD; >8 meses → elimina)

### 3.7 Notificaciones push y presencia

- Notificaciones push al navegador vía Web Push API
- Estado de presencia (online/offline) en tiempo real
- Gestionado por Socket.IO con namespaces dedicados

---

## 4. Resumen ejecutivo de controles

| Área | Control implementado | Estado |
|------|---------------------|--------|
| Sesiones | JWT en cookie httpOnly (sin acceso desde JavaScript) | ✅ Implementado |
| Sesiones | Lista negra de tokens en Redis (invalidación en logout) | ✅ Implementado |
| Credenciales | Secretos en Docker Secrets (fuera del proceso y del repo) | ✅ Implementado |
| Transporte | HTTPS con certificado en acceso externo (nginx TLS) | ✅ Implementado |
| Transporte | TLS autofirmado en comunicación interna bridge-backend | ✅ Implementado |
| Autenticación | Autenticación centralizada contra Active Directory (LDAP) | ✅ Implementado |
| Autenticación | Rate limiting en endpoint de login (3 intentos/min por IP) | ✅ Implementado |
| Auditoría | Log de intentos de autenticación (éxito y fallo) con IP | ✅ Implementado |
| Autorización | Control de acceso basado en roles (RBAC) del AD | ✅ Implementado |
| API interna | Whitelist de IP en endpoint de ingestión del bridge | ✅ Implementado |
| API interna | Secreto compartido con comparación resistente a timing attack | ✅ Implementado |
| Frontend | Cabeceras de seguridad HTTP (Helmet) y protección CORS | ✅ Implementado |
| Validación | Validación estricta de entradas en todos los endpoints | ✅ Implementado |
| Infraestructura | Puertos de BD y servicios internos no expuestos; aislamiento Docker | ✅ Implementado |
| Contraseñas | Cambio forzado de contraseña en primer login (AD policy) | ✅ Implementado |
| Backups | Procedimiento de respaldo de base de datos y volúmenes | ✅ Implementado |

---

## 5. Autenticación y gestión de sesiones

### 5.1 Autenticación contra Active Directory

Todos los usuarios se autentican exclusivamente contra el Active Directory institucional mediante LDAP. **No existen contraseñas locales almacenadas** en la base de datos del sistema. El servidor AD reside en la red interna y no es accesible desde internet.

- **Protocolo:** LDAP sobre red interna (dominio `iugnad.lan`, controlador `10.98.40.22`)
- **Credenciales de cuenta de servicio:** almacenadas como Docker Secret, nunca en variables de entorno planas
- **Error AD 773** (contraseña expirada): devuelve mensaje claro al usuario en lugar de error genérico
- **Roles y permisos:** extraídos del atributo `memberOf` del AD en cada login y firmados dentro del JWT

### 5.2 Tokens JWT con cookie httpOnly

Tras una autenticación exitosa, el servidor emite un token JWT entregado al navegador exclusivamente mediante una **cookie httpOnly**. Esta modalidad impide que cualquier script JavaScript pueda leer o robar el token de sesión.

| Propiedad | Valor | Efecto de seguridad |
|-----------|-------|---------------------|
| `httpOnly: true` | Activado | Inaccesible desde JavaScript — elimina XSS como vector de robo |
| `SameSite: Strict` | Activado | Protección contra ataques CSRF |
| `Secure: true` | Activado en producción | Solo transmitida por HTTPS |
| Vigencia | 8 horas | Ventana de exposición acotada |
| `jti` | UUID v4 criptográfico | Identificador único por token para blacklist |

> **Mejora respecto a la versión anterior:** En versiones previas el token JWT se almacenaba en `localStorage`, siendo accesible desde JavaScript. Esta vulnerabilidad fue corregida migrando a cookie httpOnly, eliminando el riesgo de robo de sesión por XSS.

### 5.3 Lista negra de tokens (Redis)

Al cerrar sesión, el identificador único del token (`jti`) se registra en Redis como token invalidado. Cualquier intento posterior de usar ese token es rechazado, **incluso si el token aún no expiró**.

- **Almacenamiento:** Redis 7 en memoria, accesible solo desde la red interna de Docker
- **TTL automático:** la entrada en Redis expira al mismo tiempo que el JWT original
- **Verificación:** el guard de JWT consulta Redis en cada request autenticado

### 5.4 Rate limiting en login

El endpoint de autenticación tiene un límite estricto de intentos para mitigar ataques de fuerza bruta y credential stuffing.

- Máximo **3 intentos por minuto** por dirección IP
- Al superar el límite: respuesta `429 Too Many Requests` con countdown visible al usuario
- Los endpoints normales de la API tienen límite global de 300 req/min (independiente del login)

---

## 6. Protección de credenciales y secretos

### 6.1 Docker Secrets

Todos los secretos del sistema se gestionan mediante **Docker Secrets**. Los valores se almacenan en archivos independientes montados en el contenedor como archivos de solo lectura en `/run/secrets/`. Los secretos **nunca aparecen** en variables de entorno visibles, en logs, ni en el repositorio de código.

| Secreto | Uso | Fortaleza |
|---------|-----|-----------|
| `jwt_secret` | Firma de tokens JWT | 64 bytes hexadecimales (512 bits) |
| `postgres_password` | Acceso a la base de datos | 48 bytes hexadecimales (384 bits) |
| `ldap_bind_credentials` | Cuenta de servicio AD para búsquedas LDAP | Contraseña compleja rotada periódicamente |
| `bridge_secret` | Autenticación del AD Bridge interno | 48 bytes hexadecimales (384 bits) |
| `mail_bridge_secret` | Autenticación del puente de correo externo | 48 bytes hexadecimales (384 bits) |
| `smtp_pass` | Cuenta de correo saliente (SMTP) | Token de aplicación de 16 caracteres |
| `google-workspace-key.json` | Service account Google Workspace | JSON key con delegación de dominio |

### 6.2 Exclusión del repositorio Git

El directorio `secrets/` contiene un archivo `.gitignore` que excluye todos los archivos `*.txt`, impidiendo que cualquier credencial sea comprometida accidentalmente en el historial del repositorio.

### 6.3 Generación criptográfica de secretos

Todos los secretos fueron generados utilizando `crypto.randomBytes()` de Node.js (CSPRNG). Ningún secreto fue elegido manualmente ni reutilizado entre entornos.

---

## 7. Seguridad en la capa de transporte

### 7.1 Acceso externo — nginx con TLS

El acceso a la plataforma se realiza exclusivamente a través de **HTTPS**. nginx actúa como proxy inverso y termina la conexión TLS antes de reenviar el tráfico a los servicios internos.

- **Puerto 443 (HTTPS)** expuesto hacia la red institucional
- Certificado TLS distribuido a los equipos del dominio mediante **Política de Grupo (GPO)** del controlador de dominio Windows Server
- **Puerto 80 (HTTP) no expuesto** al exterior
- Backend y frontend accesibles solo desde `localhost` en el servidor

### 7.2 Comunicación interna — puente de correo (mail-bridge)

El puente de correo opera en una PC Windows en la red `172.21.36.104` (TELEMÁTICO), separada del servidor principal por un firewall FortiGate. La comunicación entre ambos componentes utiliza **TLS con certificado autofirmado**.

- Certificado autofirmado con SAN (Subject Alternative Name) para la IP `172.21.36.104`
- Algoritmo: RSA 2048 bits, validez 10 años
- El servidor HTTPS del bridge escucha en el **puerto 3002**
- El backend verifica la identidad del bridge mediante secreto compartido adicional

### 7.3 Comunicación con servicios de correo

- **IMAP sobre TLS** (puerto 993) para recepción
- **SMTP con STARTTLS** (puerto 587) para envío
- `tls: { rejectUnauthorized: false }` para servidor `smtp.mto.gna` (certificado autofirmado corporativo)

---

## 8. Controles de acceso y autorización

### 8.1 Control de acceso basado en roles (RBAC)

Los permisos de acceso están determinados por los grupos del Active Directory a los que pertenece cada usuario. Los roles se extraen del atributo `memberOf` en el momento del login y se incluyen en el payload del token JWT.

| Rol | Permisos principales |
|-----|---------------------|
| `DIREDTOS` | Acceso al módulo de correo como destinatario principal |
| `TICOM` | Gestión de redacción MTO, importación PST, administración de envíos |
| `AYUDANTIADIREDTOS` | Gestión de reservas piso 8 |
| `AYUDANTIARECTORADO` | Gestión de reservas piso 6 |
| `admin` | Acceso al panel de administración de usuarios y configuración |

- Cada endpoint de la API declara explícitamente qué roles tienen acceso mediante decoradores
- Rol legado `AYUDANTIA` mapea automáticamente a `AYUDANTIADIREDTOS`

### 8.2 Guard global de autenticación

Todos los endpoints de la API requieren autenticación JWT **por defecto**. Las rutas públicas se declaran explícitamente con el decorador `@Public()`, evitando la exposición accidental de endpoints protegidos.

### 8.3 Permisos configurables por grupo

Los administradores pueden restringir el acceso a módulos específicos (`chat`, `incidencias`, `reservas`, `correo`, `redactar-MTO`) por grupo de AD, sin necesidad de modificar el código fuente. Los grupos sin configuración explícita mantienen acceso total (compatibilidad hacia atrás).

### 8.4 Creación de usuarios — orden con rollback automático

| Paso | Acción | Comportamiento ante fallo |
|------|--------|--------------------------|
| 1 | Crear en **Google Workspace** | Detiene todo el proceso |
| 2 | Crear en **Active Directory** con `pwdLastSet=0` | Rollback automático en Google Workspace |
| 3 | Registrar stub en base de datos local | — |
| 4 | Enviar email de bienvenida | No bloqueante — el usuario se crea igual |

---

## 9. Protección de APIs y endpoints

### 9.1 Validación estricta de entradas

Configurada globalmente en NestJS con `ValidationPipe`:

- `whitelist: true` — propiedades no declaradas en el DTO son eliminadas automáticamente
- `forbidNonWhitelisted: true` — requests con propiedades no esperadas son rechazados con error
- `transform: true` — los tipos de datos son convertidos y validados automáticamente

### 9.2 Cabeceras de seguridad HTTP (Helmet)

| Cabecera | Efecto |
|----------|--------|
| `X-Content-Type-Options: nosniff` | Previene MIME-type sniffing |
| `X-Frame-Options: SAMEORIGIN` | Protección contra clickjacking |
| `X-XSS-Protection` | Filtro XSS en navegadores legacy |
| `Strict-Transport-Security` | Fuerza HTTPS en navegadores modernos |
| `Content-Security-Policy` | Restricción de orígenes de recursos |

### 9.3 Protección CORS

La política CORS restringe qué orígenes pueden realizar peticiones a la API. Solo el frontend de la Intranet y el servidor de desarrollo figuran en la lista de orígenes permitidos.

### 9.4 Endpoint de ingestión del bridge — doble protección

El endpoint `POST /api/mail/bridge/ingest` implementa **dos capas de protección independientes**:

1. **Whitelist de IP:** solo se aceptan conexiones desde `172.21.36.104`. Cualquier otra IP recibe `403 Forbidden` sin información adicional.
2. **Secreto compartido:** el bearer token se verifica usando `crypto.timingSafeEqual()`, que previene ataques de temporización (timing attacks).

### 9.5 Límites de tamaño en uploads

| Contexto | Límite | Tipos permitidos |
|----------|--------|-----------------|
| Avatares de usuario | 6 MB | Imágenes (base64 en DB) |
| Adjuntos de chat | 50 MB | JPG, PNG, GIF, WebP, PDF, DOCX, XLS |
| Adjuntos de incidencias | 10 MB | Solo imágenes |
| Adjuntos de borradores MTO (frontend) | 5 MB por archivo | — |
| Adjuntos de borradores MTO (backend multer) | 20 MB | — |

---

## 10. Auditoría y trazabilidad

### 10.1 Log de autenticación

Cada intento de autenticación (exitoso o fallido) genera una entrada de log estructurada con:

- **Tipo de evento:** `AUTH_OK` o `AUTH_FAIL`
- **Nombre de usuario** utilizado en el intento
- **Dirección IP** de origen
- **Timestamp** (UTC)

### 10.2 Audit log de acciones administrativas

Todas las acciones realizadas desde el panel de administración quedan registradas en la tabla `admin_audit_log` de la base de datos:

- ID y nombre del usuario que realizó la acción
- Descripción de la acción (ej.: "Creó usuario X en AD", "Actualizó contraseña de correo DIREDTOS")
- Timestamp de la operación

### 10.3 Filtro global de excepciones

Un filtro global intercepta todos los errores no controlados de la API y devuelve respuestas de error estructuradas **sin exponer stack traces, rutas internas ni información sensible del servidor** al cliente.

---

## 11. Seguridad de infraestructura y contenedores

### 11.1 Exposición de puertos

| Servicio | Puerto interno | Acceso externo |
|----------|---------------|----------------|
| nginx (HTTPS) | — | Puerto 443 público |
| Frontend (nginx) | 80 / 8280 | Solo desde localhost del servidor |
| Backend (NestJS) | 3000 / 127.0.0.1:3001 | Solo desde localhost del servidor |
| PostgreSQL | 5432 / 127.0.0.1:5442 | Solo desde localhost del servidor |
| Redis | 6379 | Sin exposición externa |
| OpenLDAP (dev) | 389 / 636 | Sin exposición en producción |

### 11.2 Aislamiento de red entre contenedores

Todos los contenedores operan en una **red Docker interna privada** (`192.168.200.0/24`). La comunicación entre servicios utiliza nombres DNS internos (`postgres`, `redis`, etc.), sin exposición a la red del host.

### 11.3 Healthchecks y reinicio automático

- Los servicios críticos (PostgreSQL, Redis) tienen healthchecks que verifican disponibilidad antes de iniciar servicios dependientes
- Todos los contenedores están configurados con `restart: unless-stopped` para recuperación automática ante fallos

### 11.4 Gestión de cuentas inactivas (cron automático)

Un proceso cron ejecutado **diariamente a las 02:00 AM** aplica la política de inactividad:

| Condición | Acción |
|-----------|--------|
| Inactividad > 7 meses | Deshabilita la cuenta en AD |
| Inactividad > 8 meses + ya deshabilitada | Elimina la cuenta de AD |

- Basado en el atributo `lastLogonTimestamp` del Active Directory (fallback: `whenCreated`)
- Cuentas excluidas: `administrator`, `guest`, `krbtgt`, `svc-pac`

---

## 12. Protección del frontend

### 12.1 Sin tokens en almacenamiento local

El frontend Angular **no almacena tokens de sesión en `localStorage` ni en `sessionStorage`**. El token JWT reside exclusivamente en la cookie httpOnly gestionada por el navegador, eliminando el vector de ataque XSS más común.

### 12.2 Interceptor de credenciales

Todas las peticiones HTTP del frontend incluyen automáticamente las cookies de sesión mediante `withCredentials: true`. El token se envía de forma transparente sin ser accesible desde el código de la aplicación.

### 12.3 Manejo de errores de autenticación

Un interceptor global detecta respuestas `401 Unauthorized`, limpia la sesión local y redirige al login, previniendo estados inconsistentes donde el frontend cree tener sesión activa cuando el servidor ya la invalidó.

### 12.4 Entrega segura de adjuntos

Los adjuntos (correo, chat, MTO) se descargan siempre mediante peticiones autenticadas con el token JWT en la cookie, usando `responseType: 'blob'`. **Nunca se generan URLs directas** (`<a href>`) que expongan los adjuntos sin autenticación.

---

## 13. Backups

Los procedimientos de backup se ejecutan fuera del sistema de la aplicación, mediante scripts bash y tareas programadas (cron) directamente en los servidores. Cada servidor VM realiza su propio backup y lo copia vía red al servidor NAS central.

### 13.1 Base de datos (PostgreSQL)

Herramienta: `pg_dump` en formato comprimido custom (`-F c`), copiado al NAS mediante montaje de red.

| Parámetro | Detalle |
|-----------|---------|
| Herramienta | `pg_dump` (PostgreSQL) / `mysqldump` (MySQL/GLPI) |
| Formato | Custom comprimido (`-F c`) / SQL + gzip |
| Frecuencia | Diaria (cron) |
| Destino NAS | `/var/backups/todo/siu/db/`, `/var/backups/todo/intranet/db/` |
| Retención local VM | 60 días (servidor SIU) |
| Retención NAS | 30 días |
| Nomenclatura | `intranet_YYYYMMDDHHMM.backup` |

**Bases de datos respaldadas:**

- Servidor SIU — BD: `gestion` (puerto 5432) → `/media/nas/repo-docentes/db/`
- Servidor Intranet — BD: `intranet` (puerto 5442) → `/media/nas/intranet/db/`
- Servidor GLPI/Ticket — BD: `ticket` (MySQL, `mysqldump`) → `/media/nas/glpi/`

**Comando utilizado (servidor Intranet):**
```bash
pg_dump -h localhost -p 5442 -U postgres -F c -b -v -f intranet.backup intranet
```

### 13.2 Volúmenes Docker (archivos adjuntos)

| Parámetro | Detalle |
|-----------|---------|
| Origen | `/var/lib/docker/volumes/intranet2026_mail_attachments/_data` |
| Destino NAS | `/media/nas/intranet/adjuntos/` → `/var/backups/todo/intranet/adjuntos/` |
| Herramienta | `rsync -avz --delete` |
| Frecuencia | Diaria (cron) |
| Modo | Incremental con `--delete` |
| Log | `/var/log/mtos_adjuntos_YYYYMMDD.log` |

### 13.3 Frecuencia y retención

| Parámetro | Detalle |
|-----------|---------|
| Frecuencia de backup | Diaria — cada VM genera backup propio por cron |
| Copia a NAS | Inmediata — cada script copia al NAS al finalizar |
| Retención en NAS | 30 días |
| Limpieza NAS | Semanal — todos los domingos a las 07:00 (`cleanup_backups.sh`) |
| Criterio de eliminación | Se borran backups con más de 30 días **solo si existe al menos un backup reciente** en el mismo directorio (protección contra borrado total) |
| Retención local VM (SIU) | 60 días |
| Tipos cubiertos | `.backup`, `.gz`, `.sql`, `.zst`, `.vma.zst`, `.lzo`, `.vma.lzo`, `.log` |

### 13.4 Almacenamiento y ubicación

| Parámetro | Detalle |
|-----------|---------|
| Servidor NAS | Servidor dedicado con disco `sda` (1.8 TB) |
| Ruta raíz backups | `/var/backups/todo/` |
| Backups Proxmox VMs | `/var/backups/todo/proxmox/{ip_servidor}/dump/` |
| Backups BD PostgreSQL | `/var/backups/todo/siu/db/`, `/var/backups/todo/intranet/db/` |
| Backups BD MySQL (GLPI) | `/var/backups/todo/glpi/` |
| Backups adjuntos Intranet | `/var/backups/todo/intranet/adjuntos/` |

### 13.5 Pendientes identificados

- [ ] Implementar prueba de restauración semestral documentada
- [ ] Incorporar almacenamiento externo u offsite para redundancia real
- [ ] Designar responsable formal de verificación de backups
- [ ] Implementar alertas automáticas si el backup falla (monitoreo de logs)

---

*Informe de Seguridad — Sistema Intranet · Dirección de Educación e Institutos · División TIC | Abril 2026 · Documento de uso interno. No distribuir sin autorización.*
