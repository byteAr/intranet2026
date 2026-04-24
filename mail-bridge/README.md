# mail-bridge

Puente entre el servidor de correo institucional (`10.201.2.37`) y el servidor intranet (`10.98.40.24`).

Corre en la PC con IP fija `172.21.36.104` que tiene acceso permitido al servidor de correo.

## Funciones

- **IMAP poller**: polling cada 30s, envía emails nuevos al backend vía `POST /api/mail/bridge/ingest`
- **SMTP relay**: recibe solicitudes de envío del backend y las despacha por SMTP
- **LDAP search**: consulta la libreta `LIBRETALDAP.GNA` para autocompletar destinatarios

## Requisitos

- Node.js 18 o superior
- Acceso de red a `10.201.2.37` (IMAP 993, SMTP 587, LDAP 389)
- Acceso de red a `10.98.40.24:3000` (backend intranet)

## Instalación

```bat
REM Copiar esta carpeta a C:\mail-bridge
REM Crear C:\mail-bridge\.env copiando .env.example y completando los valores

cd C:\mail-bridge
npm install
```

## Instalación como Windows Service (NSSM) — recomendado

NSSM convierte el bridge en un servicio de Windows que arranca automáticamente con la PC.

1. Descargar NSSM desde https://nssm.cc/download
2. Copiar `nssm.exe` a `C:\Windows\System32\`
3. Abrir **Símbolo del sistema como Administrador** y ejecutar:

```bat
nssm install mail-bridge "C:\Program Files\nodejs\node.exe" "C:\mail-bridge\index.js"
nssm set mail-bridge AppDirectory "C:\mail-bridge"
nssm set mail-bridge Start SERVICE_AUTO_START
nssm set mail-bridge AppStdout "C:\mail-bridge\logs\out.log"
nssm set mail-bridge AppStderr "C:\mail-bridge\logs\err.log"

mkdir C:\mail-bridge\logs
nssm start mail-bridge
```

El servicio queda visible en el panel **Servicios de Windows** (`services.msc`) como `mail-bridge`.

### Gestión del servicio

```bat
nssm start mail-bridge
nssm stop mail-bridge
nssm restart mail-bridge
nssm status mail-bridge
nssm remove mail-bridge confirm   # desinstala
```

## Ejecución manual (para pruebas)

```bat
cd C:\mail-bridge
node index.js
```

## Variables de entorno

Ver `.env.example` para la lista completa. Crear un archivo `.env` en `C:\mail-bridge\` con los valores reales.

## Variables de entorno en el servidor backend (Debian)

Agregar al `.env` del servidor:

```env
MAIL_BRIDGE_URL=http://172.21.36.104:3002
MAIL_BRIDGE_SECRET=<mismo-secreto-que-BRIDGE_SECRET>
```

Cuando `MAIL_BRIDGE_URL` está seteado, el backend:
- Deshabilita el IMAP poller interno (el bridge lo reemplaza)
- Rutea los envíos SMTP a través del bridge
- Consulta la libreta LDAP a través del bridge
