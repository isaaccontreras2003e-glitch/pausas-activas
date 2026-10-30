@echo off
chcp 65001 >nul
title Crear instalador de Pausas Activas QR
cd /d "%~dp0"
echo Se creara en el Escritorio el archivo Instalar-PausasActivasQR.exe para instalar el
echo sistema en otro PC, con todos los datos CIFRADOS con una contrasena que vas a elegir.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\crear-instalador.ps1"
echo.
pause
