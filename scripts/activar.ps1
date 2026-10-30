# Deja Pausas Activas QR funcionando en segundo plano y con inicio automático al iniciar sesión en Windows.
# Lo ejecuta ACTIVAR-SISTEMA.bat.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = '"' + (Join-Path $raiz 'scripts\iniciar-oculto.vbs') + '"'

# 0. Protege los datos: solo este usuario de Windows, SYSTEM y los administradores del PC pueden abrir
#    la base de datos, las copias de seguridad y la configuración. Otros usuarios del PC no tienen acceso.
#    Los permisos se ponen SOLO en la carpeta; los archivos los heredan (las opciones de herencia no valen en archivos).
$datos = Join-Path $raiz 'data'
New-Item -ItemType Directory -Force $datos | Out-Null
$yo = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $datos /inheritance:r /grant:r "${yo}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q | Out-Null
if (Get-ChildItem $datos -Force) { & icacls (Join-Path $datos '*') /reset /T /C /Q | Out-Null }
# Verificación: si este usuario no puede leer y escribir, se deshace para no dejar el sistema sin acceso.
try {
  $prueba = Join-Path $datos '.prueba-acceso'
  Set-Content -Path $prueba -Value 'ok' -ErrorAction Stop
  if ((Get-Content $prueba -ErrorAction Stop) -ne 'ok') { throw 'lectura' }
  Remove-Item $prueba -Force
  if (Test-Path (Join-Path $datos 'pausas.db')) { [IO.File]::OpenRead((Join-Path $datos 'pausas.db')).Close() }
} catch {
  Write-Host '  No se pudieron aplicar los permisos de forma segura; se dejan los permisos normales.'
  & icacls $datos /reset /T /C /Q | Out-Null
}
$env_ = Join-Path $raiz '.env'
if (Test-Path $env_) { & icacls $env_ /inheritance:r /grant:r "${yo}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' /C /Q | Out-Null }

# 0b. Conectado a la corriente, el PC no se suspende ni hiberna solo: suspendido, el QR deja de funcionar.
#     (La pantalla sí puede apagarse; eso no afecta al sistema.)
& powercfg /change standby-timeout-ac 0 2>$null | Out-Null
& powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null

# 1. Acceso directo en la carpeta Inicio: arranca el sistema oculto cada vez que se inicia sesión.
$inicio = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Pausas Activas QR.lnk'))
$inicio.TargetPath = $wscript
$inicio.Arguments = $vbs
$inicio.WorkingDirectory = $raiz
$inicio.Description = 'Inicia Pausas Activas QR en segundo plano'
$inicio.Save()

# 2. Acceso directo al panel en el Escritorio.
$panel = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Panel Pausas Activas.url'))
$panel.TargetPath = 'http://localhost:3000/admin'
$panel.Save()

# 3. Arrancar ahora y esperar el enlace público.
Start-Process -FilePath $wscript -ArgumentList $vbs -WorkingDirectory $raiz
$archivo = Join-Path $raiz 'ENLACE-ACTUAL.txt'
Write-Host 'Encendiendo el sistema y conectando a internet' -NoNewline
for ($i = 0; $i -lt 60 -and -not (Test-Path $archivo); $i++) { Start-Sleep -Seconds 1; Write-Host '.' -NoNewline }
Write-Host ''
Write-Host ''
if (Test-Path $archivo) {
  Get-Content $archivo -Encoding UTF8 | ForEach-Object { Write-Host "  $_" }
  Start-Process 'http://localhost:3000/admin'
  exit 0
}
Write-Host '  El sistema arrancó, pero todavía no hay enlace a internet. Revisa la conexión del PC.'
Write-Host "  Detalle en: $raiz\data\logs\sistema.log"
exit 1
