#!/bin/bash
# import-pst-from-drive.sh — Descarga PSTs de Google Drive e importa año por año
#
# Uso:
#   ADMIN_USER=mlopez ADMIN_PASS=xxx bash scripts/import-pst-from-drive.sh
#
# Variables de entorno requeridas:
#   ADMIN_USER   — usuario con rol TICOM
#   ADMIN_PASS   — contraseña
#   BACKEND_URL  — URL del backend (default: http://localhost:3001)

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
  echo "Error: ADMIN_USER y ADMIN_PASS son requeridos"
  echo "Uso: ADMIN_USER=usuario ADMIN_PASS=contraseña bash $0"
  exit 1
fi

# ─── Obtener JWT ────────────────────────────────────────────────────────────

echo "Obteniendo token JWT..."
TOKEN=$(curl -s -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "Error: no se pudo obtener el token JWT. Verificá usuario y contraseña."
  exit 1
fi
echo "Token obtenido OK"

# ─── Detectar path del volumen Docker ───────────────────────────────────────

PST_VOLUME=$(docker volume inspect intranet2026_mail_pst --format '{{.Mountpoint}}' 2>/dev/null || echo "")
if [ -z "$PST_VOLUME" ]; then
  PST_VOLUME=$(docker volume inspect pac_mail_pst --format '{{.Mountpoint}}' 2>/dev/null || echo "")
fi
if [ -z "$PST_VOLUME" ]; then
  echo "Error: no se encontró el volumen Docker del PST"
  echo "Verificá con: docker volume ls | grep pst"
  exit 1
fi
echo "Volumen PST: $PST_VOLUME"

# ─── Función: esperar que termine el import en curso ────────────────────────

wait_for_import() {
  local filename="$1"
  echo "  Esperando que termine el import de $filename..."
  while true; do
    STATUS=$(curl -s "$BACKEND_URL/api/mail/admin/pst/history" \
      -H "Authorization: Bearer $TOKEN" | \
      python3 -c "
import sys,json
data=json.load(sys.stdin)
if not data: print('unknown'); exit()
# buscar el log de este archivo
for item in reversed(data):
    if item.get('filename','') == '$filename':
        print(item.get('status','unknown'))
        exit()
print('unknown')
")
    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
      echo "  Estado final: $STATUS"
      break
    fi
    echo "  Estado: $STATUS — esperando 30s..."
    sleep 30
  done
}

# ─── Función: importar un PST ───────────────────────────────────────────────

import_pst() {
  local local_path="$1"
  local filename
  filename=$(basename "$local_path")
  # Sanitizar nombre (igual que multer en el backend)
  local safe_filename
  safe_filename=$(echo "$filename" | sed 's/[^a-zA-Z0-9._-]/_/g')

  echo "  Copiando $filename → $PST_VOLUME/$safe_filename"
  cp "$local_path" "$PST_VOLUME/$safe_filename"

  echo "  Iniciando import de $safe_filename..."
  RESULT=$(curl -s -X POST "$BACKEND_URL/api/mail/admin/pst/import/$safe_filename" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json")
  echo "  Respuesta: $RESULT"

  wait_for_import "$safe_filename"

  echo "  Limpiando $PST_VOLUME/$safe_filename..."
  rm -f "$PST_VOLUME/$safe_filename"
}

# ─── Años y sus IDs de carpeta en Drive ─────────────────────────────────────

declare -A YEAR_IDS
YEAR_IDS[2011]="1OthnG2bvWdZku7TErwKHihOoP-IF1XwG"
YEAR_IDS[2012]="1aOMswFZkit1GAD-n_lFIC9IgTOUwVeni"
YEAR_IDS[2013]="1pZUHo_RK2wjcudSo6KYG4zD8WWRuf001"
YEAR_IDS[2014]="1VdNqfnlMhVv1poo4HEDyYrw79U1ZL1aw"
YEAR_IDS[2015]="1HSLV_c3PJVVe9Ka1DwfJcOVYndFKbntU"

TMPDIR_BASE="/tmp/pst-drive-import"
mkdir -p "$TMPDIR_BASE"

# ─── Loop principal ──────────────────────────────────────────────────────────

for year in 2011 2012 2013 2014 2015; do
  ID="${YEAR_IDS[$year]}"
  TMPDIR="$TMPDIR_BASE/$year"
  mkdir -p "$TMPDIR"

  echo ""
  echo "════════════════════════════════════════"
  echo " AÑO $year"
  echo "════════════════════════════════════════"

  echo "Descargando PSTs desde Drive..."
  rclone copy gdrive: "$TMPDIR" \
    --drive-root-folder-id="$ID" \
    --include "**.pst" \
    --progress

  PST_COUNT=$(find "$TMPDIR" -name "*.pst" -o -name "*.PST" | wc -l)
  echo "PSTs descargados: $PST_COUNT"

  if [ "$PST_COUNT" -eq 0 ]; then
    echo "No se encontraron PSTs para AÑO $year, saltando..."
    continue
  fi

  # Importar de a uno
  find "$TMPDIR" \( -name "*.pst" -o -name "*.PST" \) | sort | while read -r pst_file; do
    echo ""
    echo "  → $(basename "$pst_file")"
    import_pst "$pst_file"
    rm -f "$pst_file"
  done

  echo "AÑO $year completado."
  rmdir "$TMPDIR" 2>/dev/null || true
done

echo ""
echo "════════════════════════════════════════"
echo " Importación completa"
echo "════════════════════════════════════════"
