@echo off
chcp 65001 >nul
title Activar Pausas Activas QR
cd /d "%~dp0"
rem Instalado con el instalador: usa el motor incluido (no hace falta tener Node.js instalado).
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js en este equipo.
  echo Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando componentes por primera vez, espera unos minutos...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist dist\index.html (
  echo Preparando la aplicacion web...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

rem En un PC nuevo: descifra los datos que vienen del otro PC (pide la contrasena del paquete).
node --disable-warning=ExperimentalWarning server\importar.js
if errorlevel 1 ( pause & exit /b 1 )

rem Apaga cualquier copia anterior (ventanas negras, reinicios a medias) antes de dejar la definitiva.
node --disable-warning=ExperimentalWarning server\detener.js >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\activar.ps1"

echo.
echo  ===================================================================
echo   El sistema quedo funcionando EN SEGUNDO PLANO.
echo   - Ya puedes CERRAR esta ventana: el QR sigue funcionando.
echo   - Arranca solo cada vez que inicies sesion en este PC.
echo   - El enlace vigente esta siempre en ENLACE-ACTUAL.txt y en el
echo     panel, en "Codigo QR".
echo   - Para apagarlo: DETENER-SISTEMA.bat
echo  ===================================================================
echo.
pause
