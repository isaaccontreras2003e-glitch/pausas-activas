@echo off
chcp 65001 >nul
title Detener Pausas Activas QR
cd /d "%~dp0"
rem Instalado con el instalador: usa el motor incluido (no hace falta tener Node.js instalado).
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
node --disable-warning=ExperimentalWarning server\detener.js
echo.
echo Volvera a encenderse solo la proxima vez que inicies sesion en Windows.
echo Para encenderlo ya mismo, usa ACTIVAR-SISTEMA.bat.
echo.
pause
