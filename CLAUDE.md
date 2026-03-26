# Contexto del proyecto — intranet2026

## Stack
- **Backend**: NestJS (Node.js), puerto 3000
- **Frontend**: Angular, puerto 4200 (nginx en Docker)
- **Base de datos**: PostgreSQL 16
- **Auth**: Active Directory (LDAP) en 10.98.40.22, dominio iugnad.lan
- **Deploy**: Docker Compose en servidor Debian

## Infraestructura

### Servidor de producción
- IP: `10.98.40.24`, OS: Debian
- Path: `/usr/local/proyectos/intranet2026`
- Compose: `docker-compose.prod.yml`
- Contenedores: `pac_postgres`, `pac_backend`, `pac_frontend`, `pac_openldap`, `pac_phpldapadmin`, `pac_ad_bridge`

### PC de desarrollo (oficina)
- Windows 10, sin Docker Desktop
- Docker Engine corre dentro de WSL (Ubuntu)
- Levantar con `docker compose` desde consola WSL

### Repositorio
- GitHub: https://github.com/byteAr/intranet2026.git
- Rama principal: `main`

## Módulo de correo — estado actual

### Qué está hecho y deployado
El módulo de distribución interna de correos está **completo y en producción** desde la rama `correo` (mergeada a `main`). Incluye:
- IMAP poller (imapflow) — detecta carpeta Sent automáticamente, guarda TX
- SMTP sender (nodemailer) con adjuntos
- Importación de PST históricos desde UI admin
- Búsqueda full-text con FTS (tsvector)
- Árbol de referencias entre correos por mailCode
- Frontend Angular completo (inbox, detalle, compose, búsqueda, panel admin PST)

### Problema pendiente: IMAP bloqueado por red
El servidor intranet (`10.98.40.24`) **no puede llegar** al servidor de correo (`10.201.2.37:993`) porque están en VLANs distintas (FortiManager + FortiSwitch).

**Solución**: pedir al admin del FortiGate que habilite:
```
Origen:   10.98.40.24 (servidor intranet)
Destino:  10.201.2.37, puerto 993 (TCP) — IMAPS
Dirección: unidireccional (solo el servidor intranet inicia)
```

**Verificar una vez habilitado** (desde el servidor Debian):
```bash
nc -zv -w 5 10.201.2.37 993
```
Si responde → el IMAP poller conecta solo en el próximo ciclo.

### Info adicional de red
- PC que recibe los correos: `172.21.36.104`
- El poller también monitorea la carpeta Sent para capturar los TX enviados desde esa PC

## Clasificación de correos
```
FROM contiene DIREDTOS → tx
TO   contiene REDGEN   → redgen
CC   contiene REDGEN   → redgen
TO   contiene DIREDTOS → ejecutivos
CC   contiene DIREDTOS → informativos
(fallback)             → informativos
```

## Reglas de mailCode
1. Primer código en los primeros ~150 chars del body = mailCode del email
2. Si empieza con NOTA u otro texto → mailCode = null
3. Todos los demás códigos en el body = referencias a otros emails
4. Regex: `/\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g`
5. Normalización: siempre `PREFIX NUM/YY` (ej: `DE 130/19`)

## Comandos útiles en producción
```bash
# Ver logs del backend
docker compose -f docker-compose.prod.yml logs backend --tail=40

# Rebuild y restart
docker compose -f docker-compose.prod.yml up -d --build backend frontend

# Acceder a postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U <user> -d <db>
```
