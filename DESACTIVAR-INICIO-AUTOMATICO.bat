@echo off
chcp 65001 >nul
title Desactivar inicio automatico - Pausas Activas QR
cd /d "%~dp0"
rem Instalado con el instalador: usa el motor incluido (no hace falta tener Node.js instalado).
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Pausas Activas QR.lnk" >nul 2>nul
node --disable-warning=ExperimentalWarning server\detener.js
echo.
echo Listo: el sistema esta apagado y ya NO arrancara solo al iniciar Windows.
echo Para volver a dejarlo permanente, usa ACTIVAR-SISTEMA.bat.
echo.
pause
