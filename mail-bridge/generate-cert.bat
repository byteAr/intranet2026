@echo off
REM Genera certificado TLS autofirmado para el mail-bridge
REM Requiere OpenSSL (incluido con Git for Windows)

set OPENSSL="C:\Program Files\Git\usr\bin\openssl.exe"
set CERT_DIR=%~dp0certs

if not exist "%CERT_DIR%" mkdir "%CERT_DIR%"

echo Generando clave privada y certificado autofirmado...

%OPENSSL% req -x509 -newkey rsa:2048 -keyout "%CERT_DIR%\bridge.key" -out "%CERT_DIR%\bridge.crt" -days 3650 -nodes -subj "/CN=172.21.36.104/O=Intranet Mail Bridge/C=AR" -addext "subjectAltName=IP:172.21.36.104"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Certificado generado exitosamente en:
    echo   %CERT_DIR%\bridge.crt
    echo   %CERT_DIR%\bridge.key
    echo.
    echo Valido por 10 anos.
) else (
    echo ERROR: No se pudo generar el certificado.
    echo Verificar que Git este instalado en C:\Program Files\Git\
)

pause
