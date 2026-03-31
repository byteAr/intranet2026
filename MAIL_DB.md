# Base de datos — Módulo de correo

## Tablas

### `emails` (entidad principal)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `internetMessageId` | varchar UNIQUE | Message-ID del header IMAP — evita duplicados |
| `mailCode` | varchar nullable | Código institucional extraído del body (ej: `DE 130/19`) |
| `subject` | varchar | |
| `bodyText` | text nullable | Cuerpo en texto plano |
| `bodyHtml` | text nullable | Cuerpo en HTML |
| `fromAddress` | varchar | |
| `toAddresses` | simple-array | Serializado como CSV en una columna |
| `ccAddresses` | simple-array | Idem |
| `date` | timestamptz nullable | Fecha del email (del header, no de inserción) |
| `folder` | enum | `informativos` / `ejecutivos` / `redgen` / `tx` |
| `isFromPstImport` | boolean | `true` si vino de importación PST |
| `searchVector` | tsvector | Full-text search — mantenido por trigger de DB, nunca seleccionado por default (`select: false`) |
| `createdAt` | timestamp | Fecha de inserción en la BD |

**Índices:**
- `idx_emails_folder_date` → `(folder, date)` — consulta principal del inbox
- `idx_emails_mail_code` → `(mailCode)`
- `idx_emails_date` → `(date)`
- `idx_emails_folder` → `(folder)`

---

### `attachments`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `emailId` | UUID FK → emails | CASCADE DELETE |
| `filename` | varchar | Nombre original del archivo |
| `contentType` | varchar | MIME type |
| `size` | int | Tamaño en bytes |
| `storagePath` | varchar | Ruta en disco (`MAIL_ATTACHMENTS_PATH/...`) |
| `createdAt` | timestamp | |

**Índice:** `idx_attachments_email_id` → `(emailId)`

Los archivos no se guardan en la BD. El binario vive en el filesystem del contenedor; en la BD solo se guarda la ruta.

---

### `email_read_status`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `emailId` | UUID FK → emails | CASCADE DELETE |
| `userId` | UUID FK → users | CASCADE DELETE |
| `isRead` | boolean | default `false` |
| `readAt` | timestamptz nullable | Cuándo se marcó como leído |

**Constraint:** `UNIQUE(emailId, userId)` — un registro por par usuario/email.

El registro se crea de forma lazy: recién cuando el usuario abre el email o lo marca explícitamente. Si no existe fila → no leído.

---

### `email_references`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `emailId` | UUID FK → emails | El email que **contiene** la referencia — CASCADE DELETE |
| `referencedCode` | varchar | El código encontrado en el body (ej: `DE 130/19`) |
| `referencedEmailId` | UUID FK → emails nullable | El email al que apunta ese código — SET NULL on delete |

**Índices:**
- `idx_references_email_id` → `(emailId)`
- `idx_references_code` → `(referencedCode)`
- `idx_references_referenced_email_id` → `(referencedEmailId)`

**Cómo funciona:**

Dado un email con body `"DE 130/19 ... ver también RE 45/22 y DE 128/19"`:
- `mailCode` del email = `DE 130/19` (primer código en los primeros ~150 chars)
- Se crean 2 filas en `email_references`:
  - `{ emailId: X, referencedCode: "RE 45/22", referencedEmailId: Y }`
  - `{ emailId: X, referencedCode: "DE 128/19", referencedEmailId: Z }`

Si `referencedEmailId` es `null` significa que el código está mencionado pero aún no existe en la BD un email con ese `mailCode`. Se resuelve cuando ese email llega (o durante el import PST).

La FK usa `onDelete: 'SET NULL'` (no CASCADE): si se borra el email referenciado, la referencia no desaparece — queda con `referencedEmailId = null` pero `referencedCode` sigue registrado para no perder la cadena histórica.

---

### `pst_import_logs`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `filename` | varchar | Nombre del archivo PST subido |
| `startedAt` | timestamp | Inicio del proceso |
| `finishedAt` | timestamptz nullable | Fin (`null` si todavía está corriendo) |
| `status` | enum | `running` / `completed` / `failed` |
| `totalProcessed` | int | Emails procesados del PST |
| `inserted` | int | Emails nuevos insertados |
| `skippedDuplicates` | int | Emails ignorados por `internetMessageId` duplicado |
| `referencesResolved` | int | Referencias que se pudieron linkear a un email existente |
| `attachmentsSaved` | int | Archivos guardados en disco |
| `errorMessage` | text nullable | Mensaje de error si `status = failed` |

---

## Diagrama de relaciones

```
emails (1) ──────────────── (N) attachments
  │                                storagePath → filesystem del contenedor
  │
emails (1) ──────────────── (N) email_read_status ──── (N) users
  │
emails (1) ──────────────── (N) email_references
                                    │
                                    ├── emailId            → email que contiene el código en su body
                                    ├── referencedCode     → código textual encontrado (ej: "DE 130/19")
                                    └── referencedEmailId  → email cuyo mailCode coincide (nullable)
                                            │
                                            └──────────────── emails (el email referenciado)
```

---

## Árbol de referencias (CTE recursiva)

El endpoint `GET /api/mail/emails/:id/tree` construye el árbol navegando las referencias hacia arriba y hacia abajo usando una CTE recursiva con límite de profundidad < 10 y tracking de path para evitar ciclos infinitos.

```sql
WITH RECURSIVE mail_tree AS (
  -- base: email cuyo mailCode = :code
  SELECT * FROM emails WHERE mailCode = $1
  UNION ALL
  -- recursión: emails que este referencia
  SELECT e.* FROM emails e
  JOIN email_references ref ON ref.referencedEmailId = e.id
  JOIN mail_tree mt ON ref.emailId = mt.id
  WHERE depth < 10
)
```

---

## Clasificación de carpetas

Prioridad evaluada en orden: `tx → redgen → ejecutivos → informativos`

| Condición | Carpeta |
|-----------|---------|
| FROM contiene `DIREDTOS@MTO.GNA` | `tx` |
| TO o CC contiene `REDGEN@MTO.GNA` | `redgen` |
| TO contiene `DIREDTOS@MTO.GNA` | `ejecutivos` |
| CC contiene `DIREDTOS@MTO.GNA` | `informativos` |
| (fallback) | `informativos` |

---

## Reglas de mailCode

1. Regex: `/\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g`
2. Primer código encontrado en los primeros ~150 chars del body → `mailCode` del email
3. Si el body empieza con "NOTA" u otro texto antes del código → `mailCode = null`
4. Todos los demás códigos encontrados → filas en `email_references`
5. Normalización: siempre `PREFIX NUM/YY` con un solo espacio y sin espacios alrededor de `/` (ej: `DE 130/19`)

---

## Full-text search

- Columna `search_vector` tipo `tsvector` en tabla `emails`
- Mantenida automáticamente por un trigger de PostgreSQL (no desde la app)
- No se selecciona en queries normales (`select: false` en TypeORM)
- Búsqueda vía `plainto_tsquery` — ignora caracteres especiales, no requiere sintaxis especial del usuario

---

# Base de datos — Módulo Draft-Mail (MTO)

## Tablas

### `draft_emails`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `hash` | varchar UNIQUE nullable | 8 chars alfanum, generado al aprobar — impreso en papel para verificación |
| `creatorId` | varchar | |
| `creatorName` | varchar | |
| `creatorUsername` | varchar | |
| `subject` | varchar | |
| `bodyText` | text | |
| `toAddresses` | simple-json | `string[]` — ejecutivos |
| `ccAddresses` | simple-json | `string[]` — informativos |
| `status` | varchar, default `'draft'` | `draft` \| `pending_review` \| `needs_correction` \| `approved` \| `sent` \| `cancelled` |
| `sendMode` | varchar, default `'normal'` | `normal` \| `sass` \| `siena` \| `pon` — elegido por el creador |
| `requiresEncryption` | boolean, default `false` | Auto-detectado por regex PON en el body |
| `encryptionManualOverride` | boolean, default `false` | Override manual del flag |
| `assignedReviewerId` | varchar nullable | Revisor asignado (delegación) |
| `assignedReviewerName` | varchar nullable | |
| `approvedById` | varchar nullable | |
| `approvedByName` | varchar nullable | |
| `approvedByRank` | varchar nullable | Jerarquía al momento de aprobar |
| `approvedAt` | timestamp nullable | Fecha/hora de aprobación — usada como ZOPR y FDO en el documento MTO |
| `correctionNotes` | text nullable | Notas del autorizador al devolver para corrección |
| `mailCode` | varchar nullable | Código asignado por TICOM (ej: `DEI 125/26`) |
| `hashEnteredAt` | timestamp nullable | Cuando TICOM ingresó el hash — campo BT en el impreso |
| `hashEnteredById` | varchar nullable | |
| `hashEnteredByName` | varchar nullable | |
| `hashEnteredByRank` | varchar nullable | |
| `sentById` | varchar nullable | |
| `sentByName` | varchar nullable | |
| `sentByRank` | varchar nullable | |
| `sentAt` | timestamp nullable | |
| `sentMessageId` | varchar nullable | Message-ID devuelto por SMTP |
| `cancelledById` | varchar nullable | |
| `cancelledByName` | varchar nullable | |
| `cancellationReason` | text nullable | |
| `cancelledAt` | timestamp nullable | |
| `history` | jsonb, default `'[]'` | `DraftHistoryEntry[]` — audit trail con tipos: `created \| submitted \| resubmitted \| approved \| rejected \| cancelled \| ticom_cancelled \| sent \| delegated \| edited` |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

### `draft_email_attachments`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `draftEmailId` | UUID FK → `draft_emails(id)` | CASCADE DELETE |
| `filename` | varchar | Nombre original del archivo |
| `contentType` | varchar | MIME type |
| `size` | int | Bytes |
| `storagePath` | varchar | Ruta absoluta en disco (`DRAFT_ATTACHMENTS_PATH/...`) |
| `createdAt` | timestamp | |

Los archivos viven en el filesystem del contenedor (`DRAFT_ATTACHMENTS_PATH`, default `/app/storage/draft-attachments`). La BD solo guarda la ruta.

**⚠️ Descarga:** siempre vía `HttpClient` con JWT (`responseType: 'blob'`). El endpoint `GET /api/draft-mail/:id/attachments/:attId` requiere autenticación — no sirve un `<a href>` directo.

---

### `draft_mail_authorizers`

Lista de usuarios habilitados para aprobar MTOs (MTOSAUTORIZADOS).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID PK | |
| `userId` | varchar UNIQUE | FK lógico a `users` |
| `username` | varchar | |
| `displayName` | varchar | |
| `addedById` | varchar | Quién lo agregó |
| `addedByName` | varchar | |
| `createdAt` | timestamp | |

Gestionado por `superApprover` (admin o TICOM con privilegios) vía `GET/POST/DELETE /api/draft-mail/authorizers`.

---

## Diagrama de relaciones

```
draft_emails (1) ──────────────── (N) draft_email_attachments
                                        storagePath → filesystem del contenedor

draft_mail_authorizers ────── lista de userId habilitados para aprobar
```
