#!/usr/bin/env bash
# Limpieza de Docker después de un pase: lo llaman rollout.sh y rollout-frontend.sh.
#
# Cada pase compila una imagen nueva; la anterior queda sin nombre ("dangling")
# y la caché de compilación crece. El 19/11/2026 se habían juntado ~60 GB y el
# disco de la VM llegó al 100 %. Esto borra:
#   - las imágenes sin nombre que no usa ningún contenedor;
#   - la caché de compilación de más de una semana (la reciente se queda para
#     que los pases sigan siendo rápidos).
# No toca volúmenes ni contenedores. Si algo falla, el pase igual quedó hecho.

log() { printf '\033[1;36m[limpieza]\033[0m %s\n' "$*"; }

images="$(docker image prune -f 2>/dev/null | tail -1)"
cache="$(docker builder prune -f --filter until=168h 2>/dev/null | tail -1)"
log "Imágenes viejas: ${images:-nada}. Caché de más de una semana: ${cache:-nada}."

used_pct="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
free_h="$(df -h --output=avail / 2>/dev/null | tail -1 | tr -d ' ')"
if [ -n "$used_pct" ] && [ "$used_pct" -ge 90 ]; then
  printf '\033[1;31m[limpieza]\033[0m ⚠ El disco está al %s %% (quedan %s). Borrá los PST ya importados (Importar PST → tacho) o revisá "du -sh /var/lib/docker/volumes/*".\n' "$used_pct" "$free_h"
else
  log "Disco al ${used_pct:-?} % (quedan ${free_h:-?})."
fi
exit 0
