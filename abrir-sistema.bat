@echo off
rem Liga o servidor sem janela (se ainda nao estiver ligado) e abre o sistema no navegador.
cd /d "%~dp0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "" wscript.exe "%~dp0iniciar-servidor-oculto.vbs"
  powershell -NoProfile -Command "for ($i = 0; $i -lt 20 -and -not (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }"
)
start "" "http://localhost:8080"
