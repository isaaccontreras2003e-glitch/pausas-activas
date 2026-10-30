@echo off
chcp 65001 >nul
title Exportar Pausas Activas QR para otro PC
cd /d "%~dp0"
rem Instalado con el instalador: usa el motor incluido (no hace falta tener Node.js instalado).
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
echo Se creara en el Escritorio un paquete .zip para instalar el sistema en otro PC,
echo con todos los datos CIFRADOS con una contrasena que vas a elegir.
echo.
node --disable-warning=ExperimentalWarning server\exportar.js
echo.
pause
