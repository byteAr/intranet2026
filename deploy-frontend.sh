#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$SCRIPT_DIR/frontend"
DIST="$FRONTEND/dist/frontend/browser"
CONTAINER="pac_frontend"
NGINX_HTML="/usr/share/nginx/html"

echo "▶ Building Angular..."
cd "$FRONTEND"
npx ng build

echo "▶ Copying files to container..."
# Remove old files and copy fresh to avoid stale chunks
docker exec "$CONTAINER" sh -c "find $NGINX_HTML -maxdepth 1 -not -name 'nginx*' -not -path $NGINX_HTML -delete 2>/dev/null; true"
docker cp "$DIST/." "$CONTAINER:$NGINX_HTML/"

# If docker cp created a browser/ subdir (Windows Git Bash quirk), flatten it
docker exec "$CONTAINER" sh -c "
  if [ -d $NGINX_HTML/browser ]; then
    cp -r $NGINX_HTML/browser/. $NGINX_HTML/
    rm -rf $NGINX_HTML/browser
  fi
"

echo "▶ Reloading nginx config..."
docker exec "$CONTAINER" nginx -s reload

echo "✓ Deploy complete — http://localhost:4200"
