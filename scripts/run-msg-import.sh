#!/bin/bash
# run-msg-import.sh — Importa archivos .msg año por año al backend
#
# Uso:
#   bash scripts/run-msg-import.sh
#
# Variables de entorno requeridas:
#   BRIDGE_SECRET  — mismo valor que MAIL_BRIDGE_SECRET en el backend
#   BACKEND_URL    — URL del backend (default: http://localhost:3001)

BRIDGE_SECRET="${BRIDGE_SECRET:-$(grep MAIL_BRIDGE_SECRET /usr/local/proyectos/intranet2026/.env | cut -d= -f2)}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
BASE_DIR="/usr/local/proyectos/intranet2026/storage/msg-import"
SCRIPT="/usr/local/proyectos/intranet2026/scripts/import-msg.js"

if [ -z "$BRIDGE_SECRET" ]; then
  echo "Error: BRIDGE_SECRET no está seteado"
  exit 1
fi

for year in 2018 2019 2020 2021 2022 2023 2024 2025; do
  DIR="$BASE_DIR/AÑO $year"
  if [ ! -d "$DIR" ]; then
    echo "=== AÑO $year — directorio no encontrado, saltando ==="
    continue
  fi
  echo ""
  echo "════════════════════════════════════════"
  echo " Importando AÑO $year"
  echo "════════════════════════════════════════"
  BRIDGE_SECRET="$BRIDGE_SECRET" BACKEND_URL="$BACKEND_URL" \
    node "$SCRIPT" "$DIR"
  echo "=== AÑO $year finalizado ==="
  sleep 5
done

echo ""
echo "════════════════════════════════════════"
echo " Importación .msg completa"
echo "════════════════════════════════════════"
