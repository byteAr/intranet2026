#!/bin/bash
# kit-contingencia.sh — Arma un archivo CIFRADO con todo lo que hace falta para
# volver a levantar la intranet en un servidor nuevo y que NO está en GitHub:
# variables (.env), secretos (secrets/, clave de Google), configuración del
# nginx del servidor (y su certificado), red, Docker y tareas programadas.
#
# Uso (como root, en el servidor 10.98.40.24):
#   bash /usr/local/proyectos/intranet2026/scripts/kit-contingencia.sh
#
# Pide una contraseña (dos veces) y deja /root/kit-contingencia-AAAAMMDD.tar.gz.enc.
# Ese archivo hay que GUARDARLO FUERA DEL SERVIDOR (pendrive en la caja fuerte,
# otra PC, el Drive de telemático) y la contraseña, aparte (gestor de contraseñas
# o sobre cerrado). Sin la contraseña el kit no sirve.
#
# Para abrirlo en el servidor nuevo:
#   openssl enc -d -aes-256-cbc -pbkdf2 -in kit-contingencia-AAAAMMDD.tar.gz.enc | tar xzf - -C /root/kit
#
# Rehacerlo cada vez que cambie una contraseña, una variable del .env o el
# certificado (y al menos una vez por mes).

set -euo pipefail

PROD=/usr/local/proyectos/intranet2026
STAGING=/usr/local/proyectos/intranet2026-staging
FECHA=$(date +%Y%m%d)
SALIDA="/root/kit-contingencia-${FECHA}.tar.gz.enc"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

copiar() { # copiar <origen> <destino dentro del kit>
  if [ -e "$1" ]; then
    mkdir -p "$TMP/$(dirname "$2")"
    cp -a "$1" "$TMP/$2"
    echo "  + $2"
  else
    echo "  - (no existe) $1"
  fi
}

echo "Armando el kit de contingencia…"
# Producción: variables y secretos (incluye la clave de la cuenta de servicio de Google).
copiar "$PROD/.env"                         produccion/.env
copiar "$PROD/secrets"                      produccion/secrets
copiar "$PROD/postgres.conf"                produccion/postgres.conf
# Staging (si existe).
copiar "$STAGING/.env"                      staging/.env
copiar "$STAGING/.env.staging"              staging/.env.staging
copiar "$STAGING/secrets"                   staging/secrets
# Servidor: nginx del puerto 443 (con su certificado), Docker, red y tareas.
copiar /etc/nginx                           servidor/etc/nginx
copiar /etc/ssl/private                     servidor/etc/ssl/private
copiar /etc/docker/daemon.json              servidor/etc/docker/daemon.json
copiar /etc/network/interfaces              servidor/etc/network/interfaces
copiar /etc/hosts                           servidor/etc/hosts
copiar /etc/crontab                         servidor/etc/crontab
crontab -l > "$TMP/servidor/crontab-root.txt" 2>/dev/null && echo "  + servidor/crontab-root.txt" || true
nmcli -t connection show > "$TMP/servidor/nmcli-conexiones.txt" 2>/dev/null || true
ip -4 addr show > "$TMP/servidor/ip-addr.txt"; ip route > "$TMP/servidor/ip-route.txt"
cat /etc/resolv.conf > "$TMP/servidor/resolv.conf"
# Qué versión del código corría (para volver exactamente a la misma).
( cd "$PROD" && git log --oneline -1 && git status -sb | head -1 ) > "$TMP/produccion/version-del-codigo.txt" 2>/dev/null || true
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' > "$TMP/servidor/contenedores.txt" 2>/dev/null || true
date > "$TMP/LEEME-fecha-del-kit.txt"

echo ""
echo "Ahora elegí la CONTRASEÑA del kit (anotala aparte: sin ella no se puede abrir)."
tar czf - -C "$TMP" . | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$SALIDA"
chmod 600 "$SALIDA"
echo ""
echo "Listo: $SALIDA ($(du -h "$SALIDA" | cut -f1))"
echo "Copialo FUERA del servidor (ver docs/plan-de-contingencia.md) y borralo de acá cuando esté a salvo."
