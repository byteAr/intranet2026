#!/usr/bin/env bash
# Pase sin corte del frontend: no se reinicia nginx (no se cortan las
# conexiones en vivo del chat, correo, MTO), solo se le cambian los archivos.
#
#   1. Compila la imagen nueva (la versión actual sigue atendiendo).
#   2. Copia los archivos nuevos adentro del nginx que está corriendo, SIN
#      borrar los viejos: quien tenga la intranet abierta sigue encontrando
#      los archivos de su versión. index.html y ngsw.json van al final, para
#      que nadie reciba un index que apunte a archivos que todavía no llegaron.
#   3. Si cambió nginx.conf, lo prueba (nginx -t) y lo aplica con
#      "nginx -s reload", que tampoco corta conexiones.
# Los navegadores detectan la versión nueva y se actualizan solos en un
# momento seguro (ver AppVersionService).
#
# Uso (desde la carpeta del proyecto):
#   scripts/rollout-frontend.sh -f docker-compose.yml -f docker-compose.prod.yml
#   scripts/rollout-frontend.sh -p intranet_staging -f docker-compose.staging.yml
#
# Si cambió algo del contenedor en el compose (puertos, volúmenes), esto no
# alcanza: ese caso va con "up -d --build --no-deps frontend" (corte breve).
set -euo pipefail

COMPOSE=(docker compose "$@")
HTML=/usr/share/nginx/html
CONF=/etc/nginx/conf.d/default.conf

log() { printf '\033[1;36m[rollout-frontend]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rollout-frontend]\033[0m %s\n' "$*" >&2; exit 1; }

log "Compilando la imagen del frontend (la versión actual sigue atendiendo)…"
"${COMPOSE[@]}" build frontend

CID="$("${COMPOSE[@]}" ps -q frontend || true)"
if [ -z "$CID" ]; then
  log "El frontend no estaba corriendo: se levanta normalmente."
  "${COMPOSE[@]}" up -d --no-deps frontend
  exit 0
fi
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CID")"

WORK="$(mktemp -d)"
TMP=""
cleanup() {
  [ -n "$TMP" ] && docker rm -f "$TMP" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

log "Sacando los archivos de la imagen nueva…"
TMP="$(docker create "$IMAGE")"
docker cp "$TMP:$HTML/." "$WORK/html"
docker cp "$TMP:$CONF" "$WORK/default.conf"

# Lo que dice "qué versión hay" va al final.
mkdir -p "$WORK/last"
for f in index.html ngsw.json version.json; do
  if [ -f "$WORK/html/$f" ]; then mv "$WORK/html/$f" "$WORK/last/$f"; fi
done

log "Copiando los archivos nuevos al nginx que está atendiendo…"
docker cp "$WORK/html/." "$CID:$HTML/"
docker cp "$WORK/last/." "$CID:$HTML/"

if ! docker exec -i "$CID" cmp -s "$CONF" - < "$WORK/default.conf"; then
  log "Cambió nginx.conf: probándolo…"
  docker exec "$CID" cp "$CONF" "$CONF.anterior"
  docker cp "$WORK/default.conf" "$CID:$CONF"
  if ! docker exec "$CID" nginx -t; then
    docker exec "$CID" mv "$CONF.anterior" "$CONF"
    fail "El nginx.conf nuevo tiene errores: se dejó el anterior (los archivos nuevos ya están)."
  fi
  docker exec "$CID" nginx -s reload
  log "nginx.conf aplicado sin cortar conexiones."
fi

log "Listo: frontend actualizado sin corte. Los navegadores se actualizan solos."
