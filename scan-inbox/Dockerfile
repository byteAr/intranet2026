# Bandeja de escaneo: las impresoras dejan acá lo que escanean, por carpeta de
# red (Samba, SMB2/3) o por FTP (las que no soportan SMB moderno). Cada oficina
# tiene su carpeta y su usuario; la intranet (backend) toma los archivos.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends samba vsftpd \
 && rm -rf /var/lib/apt/lists/* \
 && echo /usr/sbin/nologin >> /etc/shells \
 && mkdir -p /var/run/vsftpd/empty /inbox

COPY smb.conf /etc/samba/smb.conf
COPY vsftpd.conf /etc/vsftpd.conf
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh /etc/samba/smb.conf /etc/vsftpd.conf && chmod +x /entrypoint.sh

EXPOSE 445 21 30000-30009
ENTRYPOINT ["/entrypoint.sh"]
