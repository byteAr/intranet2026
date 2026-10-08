#!/bin/bash
# Bandeja de escaneo. La intranet escribe /config/accounts.conf (una línea por
# oficina: usuario <TAB> contraseña <TAB> carpeta); acá se crean los usuarios
# del sistema y de Samba, una carpeta compartida por oficina, y se recarga.
set -u

ACCOUNTS=/config/accounts.conf
SHARES=/etc/samba/shares.conf
LAST=""

: > "$SHARES"
grep -q '^pasv_address=' /etc/vsftpd.conf || echo "pasv_address=${SCAN_PUBLIC_IP:-10.98.40.24}" >> /etc/vsftpd.conf

sync_accounts() {
  [ -f "$ACCOUNTS" ] || return 0
  local sum
  sum=$(md5sum "$ACCOUNTS" | cut -d' ' -f1)
  [ "$sum" = "$LAST" ] && return 0

  local new wanted user pass folder
  new=$(mktemp)
  wanted=" "
  while IFS=$'\t' read -r user pass folder; do
    # Solo usuarios de la bandeja y carpetas simples (las genera la intranet).
    [[ "$user" =~ ^esc-[a-z0-9-]+$ ]] || continue
    [[ "$folder" =~ ^[a-z0-9-]+$ ]] || continue
    [ -n "$pass" ] || continue
    wanted+="$user "
    mkdir -p "/inbox/$folder"
    id "$user" >/dev/null 2>&1 || useradd -M -d "/inbox/$folder" -s /usr/sbin/nologin "$user"
    usermod -d "/inbox/$folder" "$user" 2>/dev/null
    echo "$user:$pass" | chpasswd
    printf '%s\n%s\n' "$pass" "$pass" | smbpasswd -s -a "$user" >/dev/null
    chown "$user" "/inbox/$folder"
    chmod 0777 "/inbox/$folder"
    cat >> "$new" <<EOF
[escaneo-$folder]
   path = /inbox/$folder
   valid users = $user
   read only = no
   browseable = no
EOF
  done < "$ACCOUNTS"

  # Oficinas que ya no están: se les quita el acceso (la carpeta queda).
  for user in $(getent passwd | cut -d: -f1 | grep '^esc-' || true); do
    case "$wanted" in
      *" $user "*) ;;
      *) smbpasswd -x "$user" >/dev/null 2>&1; userdel "$user" 2>/dev/null ;;
    esac
  done

  mv "$new" "$SHARES"
  chmod 0644 "$SHARES"
  smbcontrol smbd reload-config >/dev/null 2>&1 || true
  LAST="$sum"
  echo "[escaneo] cuentas actualizadas:$wanted"
}

sync_accounts

# Cada 15 s: cuentas nuevas o contraseñas cambiadas desde la intranet, y que el FTP siga vivo.
(
  while true; do
    sleep 15
    sync_accounts
  done
) &

touch /var/log/vsftpd.log
tail -F /var/log/vsftpd.log 2>/dev/null | sed -u 's/^/[ftp] /' &

(
  while true; do
    /usr/sbin/vsftpd /etc/vsftpd.conf
    echo "[escaneo] vsftpd terminó; se reinicia en 5 s"
    sleep 5
  done
) &

exec smbd --foreground --debug-stdout --no-process-group
