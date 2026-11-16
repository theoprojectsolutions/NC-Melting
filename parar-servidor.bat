@echo off
title Parar servidor - Melting NC
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "if ($p) { Stop-Process -Id $p -Force; Write-Host ''; Write-Host '  Servidor parado. O sistema esta fora do ar.' -ForegroundColor Yellow; Write-Host '  Para ligar de novo: abrir-sistema.bat' }" ^
  "else { Write-Host ''; Write-Host '  O servidor nao estava rodando.' }"
echo.
pause
