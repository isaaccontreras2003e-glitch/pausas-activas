# Instalador de Pausas Activas QR (va dentro de Instalar-PausasActivasQR.exe).
# Instala en la carpeta del usuario (no requiere permisos de administrador), conserva los datos si ya
# estaba instalado, crea accesos directos y deja el sistema funcionando en segundo plano.
param(
  [string]$Paquete,
  # Solo para pruebas: copia los archivos a otra carpeta, sin accesos directos ni activar el sistema.
  [string]$SoloCopiarEn
)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Instalando Pausas Activas QR'
$destino = if ($SoloCopiarEn) { $SoloCopiarEn } else { Join-Path $env:LOCALAPPDATA 'PausasActivasQR' }

Write-Host ''
Write-Host '  ==============================================='
Write-Host '   Instalando Pausas Activas QR (FOCA - VIU - IMES)'
Write-Host '  ==============================================='
Write-Host ''

try {
  # Si ya estaba instalado, se detiene antes de actualizar. Sus datos (carpeta data) no se tocan.
  if (Test-Path (Join-Path $destino 'server\detener.js')) {
    Write-Host '  Deteniendo la versión anterior...'
    & (Join-Path $destino 'runtime\node.exe') --disable-warning=ExperimentalWarning (Join-Path $destino 'server\detener.js') | Out-Null
  }

  Write-Host '  Copiando archivos (puede tardar un minuto)...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  # Nombre corto: Windows limita la longitud de las rutas y los componentes tienen carpetas profundas.
  $tmp = Join-Path $env:TEMP ('pqr' + [guid]::NewGuid().ToString('N').Substring(0, 6))
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Paquete, $tmp)
  New-Item -ItemType Directory -Force $destino | Out-Null
  # /XD data: nunca se sobrescriben los datos de una instalación existente.
  & robocopy (Join-Path $tmp 'PausasActivasQR') $destino /E /XD data /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos (robocopy $LASTEXITCODE)." }
  Remove-Item $tmp -Recurse -Force
  if ($SoloCopiarEn) { Write-Host "  (prueba) Archivos copiados en $destino"; exit 0 }

  # Accesos directos en el menú Inicio.
  $shell = New-Object -ComObject WScript.Shell
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Pausas Activas QR'
  New-Item -ItemType Directory -Force $menu | Out-Null
  $panel = $shell.CreateShortcut((Join-Path $menu 'Panel Pausas Activas.url'))
  $panel.TargetPath = 'http://localhost:3000/admin'
  $panel.Save()
  foreach ($par in @(@('Encender o reiniciar el sistema', 'ACTIVAR-SISTEMA.bat'), @('Detener el sistema', 'DETENER-SISTEMA.bat'), @('Ver enlace y QR del día', 'ENLACE-ACTUAL.txt'), @('Carpeta del sistema', ''))) {
    $l = $shell.CreateShortcut((Join-Path $menu "$($par[0]).lnk"))
    $l.TargetPath = if ($par[1]) { Join-Path $destino $par[1] } else { $destino }
    $l.WorkingDirectory = $destino
    $l.Save()
  }

  Write-Host '  Archivos instalados en:' $destino
  Write-Host ''
} catch {
  Write-Host ''
  Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Toma una foto de esta pantalla y envíala a quien te pasó el instalador.'
  Read-Host '  Presiona Enter para cerrar'
  exit 1
}

# Primer arranque: si trae datos cifrados pide la contraseña del paquete; luego deja todo en segundo plano.
& cmd.exe /c "`"$(Join-Path $destino 'ACTIVAR-SISTEMA.bat')`""
