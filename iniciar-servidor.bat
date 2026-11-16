@echo off
chcp 65001 >nul
title Melting - Gestao de Nao Conformidades (servidor)
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Python nao encontrado neste computador.
  echo  Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
python server.py %*
pause
