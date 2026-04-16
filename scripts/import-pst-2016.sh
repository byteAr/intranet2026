#!/bin/bash
# Importa el PST de 2016 que ya está en el volumen Docker

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
ADMIN_USER="${ADMIN_USER:-mlopez}"
ADMIN_PASS="${ADMIN_PASS:-Margen.2}"

echo "Obteniendo token JWT..."
TOKEN=$(curl -s -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "Error: no se pudo obtener el token JWT"
  exit 1
fi
echo "Token OK"

# El filename tal como está en el volumen
FILENAME="Año 2016.pst"
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FILENAME'))")

echo "Iniciando import de: $FILENAME"
RESULT=$(curl -s -X POST "$BACKEND_URL/api/mail/admin/pst/import/$ENCODED" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")
echo "Respuesta: $RESULT"

echo ""
echo "Monitoreando estado..."
while true; do
  STATUS=$(curl -s "$BACKEND_URL/api/mail/admin/pst/history" \
    -H "Authorization: Bearer $TOKEN" | \
    python3 -c "
import sys,json
data=json.load(sys.stdin)
for item in reversed(data):
    if 'Ao 2016' in item.get('filename','') or '2016' in item.get('filename',''):
        print(item.get('status','unknown'), item.get('inserted',0), item.get('totalProcessed',0))
        exit()
print('not found')
")
  echo "  Estado: $STATUS"
  if echo "$STATUS" | grep -q "completed\|failed"; then
    break
  fi
  sleep 30
done
