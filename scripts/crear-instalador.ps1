# Crea Instalar-PausasActivasQR.exe en el Escritorio: un solo archivo con el programa, el motor (Node.js),
# el túnel a internet y los datos CIFRADOS. Lo ejecuta CREAR-INSTALADOR.bat.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$nodo = (Get-Command node).Source
$build = Join-Path $env:TEMP ('pausas-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$app = Join-Path $build 'PausasActivasQR'
$ie = Join-Path $build 'ie'
New-Item -ItemType Directory -Force $ie | Out-Null

try {
  # 1. Programa + datos cifrados (pide la contraseña del paquete).
  & $nodo --disable-warning=ExperimentalWarning (Join-Path $raiz 'server\exportar.js') --carpeta $app
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $app 'datos-cifrados'))) { throw 'No se pudo preparar el paquete.' }

  # 2. Solo las librerías necesarias para funcionar (sin las de desarrollo).
  Write-Host 'Copiando componentes...'
  & robocopy (Join-Path $raiz 'node_modules') (Join-Path $app 'node_modules') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  Push-Location $app
  try { & npm prune --omit=dev --no-audit --no-fund 2>&1 | Out-Null } finally { Pop-Location }

  # 3. El motor: así el PC de destino no necesita tener Node.js instalado.
  New-Item -ItemType Directory -Force (Join-Path $app 'runtime') | Out-Null
  Copy-Item $nodo (Join-Path $app 'runtime\node.exe')

  # 4. Un solo .zip con todo, más el script de instalación.
  Write-Host 'Comprimiendo...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($app, (Join-Path $ie 'paquete.zip'), [System.IO.Compression.CompressionLevel]::Optimal, $true)
  Copy-Item (Join-Path $raiz 'scripts\instalador\instalar.ps1'), (Join-Path $raiz 'scripts\instalador\instalar.cmd') $ie

  # 5. Ejecutable autoextraíble con IExpress (incluido en Windows).
  Write-Host 'Creando el instalador .exe (puede tardar unos minutos)...'
  $exe = Join-Path $build 'Instalar-PausasActivasQR.exe'
  $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=¿Instalar Pausas Activas QR en este equipo?
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Pausas Activas QR
AppLaunched=cmd /c instalar.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="paquete.zip"
FILE1="instalar.ps1"
FILE2="instalar.cmd"
[SourceFiles]
SourceFiles0=$ie\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@
  $rutaSed = Join-Path $build 'instalador.sed'
  [IO.File]::WriteAllText($rutaSed, $sed, [Text.Encoding]::Default)
  $p = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\iexpress.exe') -ArgumentList '/N', '/Q', $rutaSed -Wait -PassThru
  if (-not (Test-Path $exe)) { throw "IExpress no generó el instalador (código $($p.ExitCode))." }

  $escritorio = [Environment]::GetFolderPath('Desktop')
  $final = Join-Path $escritorio 'Instalar-PausasActivasQR.exe'
  Move-Item $exe $final -Force
  Write-Host ''
  Write-Host "LISTO: $final  ($([math]::Round((Get-Item $final).Length / 1MB)) MB)"
  Write-Host ''
  Write-Host 'Envíaselo a la administradora (USB, Google Drive, OneDrive o correo con enlace).'
  Write-Host 'Dile la contraseña del paquete POR OTRO MEDIO (en persona o por llamada).'
} finally {
  if (Test-Path $build) { Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue }
}
