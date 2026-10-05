#!/usr/bin/env bash
# Pase sin corte de un servicio (blue-green en una sola VM).
#
#   1. Compila la imagen nueva (la versión vieja sigue atendiendo).
#   2. Levanta una copia nueva AL LADO de la vieja.
#   3. Espera a que su healthcheck dé "healthy". nginx ya le manda tráfico,
#      y si todavía no responde, sigue usando la vieja.
#   4. Recién ahí apaga la vieja. Si la nueva no arranca bien, la borra y la
#      vieja queda funcionando como si nada (no hay corte ni hace falta volver atrás).
#
# Uso (desde la carpeta del proyecto):
#   scripts/rollout.sh backend -f docker-compose.yml -f docker-compose.prod.yml
#   scripts/rollout.sh backend -p intranet_staging -f docker-compose.staging.yml
#
# El servicio no puede tener container_name ni puertos publicados (dos copias
# no pueden compartirlos) y necesita un healthcheck en el compose.
set -euo pipefail

SERVICE="${1:?Uso: scripts/rollout.sh <servicio> [opciones de docker compose: -p, -f ...]}"
shift
COMPOSE=(docker compose "$@")
WAIT_SECONDS="${ROLLOUT_WAIT_SECONDS:-180}"
STOP_TIMEOUT="${ROLLOUT_STOP_TIMEOUT:-20}"

log() { printf '\033[1;36m[rollout]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rollout]\033[0m %s\n' "$*" >&2; exit 1; }

log "Compilando la imagen de ${SERVICE} (la versión actual sigue atendiendo)…"
"${COMPOSE[@]}" build "$SERVICE"

OLD_IDS="$("${COMPOSE[@]}" ps -q "$SERVICE" || true)"
if [ -z "$OLD_IDS" ]; then
  log "${SERVICE} no estaba corriendo: se levanta normalmente."
  "${COMPOSE[@]}" up -d --no-deps "$SERVICE"
  exit 0
fi
OLD_COUNT="$(printf '%s\n' "$OLD_IDS" | wc -l | tr -d ' ')"

log "Levantando la versión nueva al lado de la actual…"
"${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "${SERVICE}=$((OLD_COUNT * 2))" "$SERVICE"
NEW_IDS="$("${COMPOSE[@]}" ps -q "$SERVICE" | grep -vxF "$OLD_IDS" || true)"
[ -n "$NEW_IDS" ] || fail "No se creó ninguna copia nueva."

remove_new() {
  log "Borrando la copia nueva; la versión anterior sigue atendiendo."
  # shellcheck disable=SC2086
  docker stop -t "$STOP_TIMEOUT" $NEW_IDS >/dev/null || true
  # shellcheck disable=SC2086
  docker rm $NEW_IDS >/dev/null || true
}

log "Esperando a que la versión nueva esté sana (hasta ${WAIT_SECONDS} s)…"
deadline=$((SECONDS + WAIT_SECONDS))
while :; do
  # shellcheck disable=SC2086
  states="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' $NEW_IDS | sort -u)"
  if [ "$states" = "healthy" ]; then
    break
  fi
  if printf '%s\n' "$states" | grep -q 'unhealthy\|sin-healthcheck'; then
    # shellcheck disable=SC2086
    docker logs --tail 40 $NEW_IDS 2>&1 | sed 's/^/    /' || true
    remove_new
    fail "La versión nueva no quedó sana (${states//$'\n'/, }). Revisá el log de arriba."
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    # shellcheck disable=SC2086
    docker logs --tail 40 $NEW_IDS 2>&1 | sed 's/^/    /' || true
    remove_new
    fail "La versión nueva no estuvo sana a tiempo (${WAIT_SECONDS} s)."
  fi
  sleep 3
done

log "La versión nueva está sana. Apagando la anterior…"
# shellcheck disable=SC2086
docker stop -t "$STOP_TIMEOUT" $OLD_IDS >/dev/null
# shellcheck disable=SC2086
docker rm $OLD_IDS >/dev/null
log "Listo: ${SERVICE} actualizado sin corte."
