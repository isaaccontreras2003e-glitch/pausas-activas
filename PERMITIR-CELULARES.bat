@echo off
chcp 65001 >nul
title Permitir celulares - Pausas Activas QR

rem Necesita permisos de administrador: si no los tiene, se vuelve a abrir pidiendolos.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)

echo Abriendo el puerto 3000 en el Firewall de Windows,
echo solo para equipos y celulares de la MISMA red local...
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'Pausas Activas QR' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'Pausas Activas QR' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -RemoteAddress LocalSubnet -Profile Any | Out-Null"

if errorlevel 1 (
  echo.
  echo No se pudo crear la regla. Pide ayuda al area de sistemas para permitir
  echo conexiones entrantes TCP al puerto 3000 en este equipo.
) else (
  echo.
  echo Listo. Los celulares conectados al mismo Wi-Fi ya pueden abrir el QR.
  echo Solo necesitas hacer esto una vez.
)
echo.
pause
