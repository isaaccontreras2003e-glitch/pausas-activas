@echo off
chcp 65001 >nul
title Exportar datos de Pausas Activas QR
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
echo Se creara en el Escritorio un archivo .cifrado con todos los datos (usuarios, empresas,
echo sedes, cargos y registros), protegido con una contrasena que vas a elegir.
echo Sirve para cargarlos en el sistema en la nube (Render) con "Importar datos del PC anterior".
echo.
node --disable-warning=ExperimentalWarning server\exportar.js --solo-datos
echo.
pause
