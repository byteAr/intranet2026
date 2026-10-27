@echo off
  :loop
  echo [%date% %time%] Starting mail-bridge... >> C:\intranet2026\mail-bridge\bridge.log 2>&1
  node C:\intranet2026\mail-bridge\index.js >> C:\intranet2026\mail-bridge\bridge.log 2>&1
  echo [%date% %time%] Process exited. Restarting in 20 seconds... >> C:\intranet2026\mail-bridge\bridge.log 2>&1
  timeout /t 20 /nobreak
  goto loop