// Prepara el paquete para instalar el sistema en otro PC: un .zip en el Escritorio con el programa y
// la base de datos CIFRADA con una contraseña. Lo ejecuta EXPORTAR-PARA-OTRO-PC.bat.
import { RAIZ } from './entorno.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cerrarPreguntas, cifrar, preguntarOculto } from './cifrado.js';

// --carpeta <dir>: solo arma la carpeta del paquete en <dir> (la usa CREAR-INSTALADOR.bat), sin comprimir.
const iCarpeta = process.argv.indexOf('--carpeta');
const carpetaInstalador = iCarpeta >= 0 ? path.resolve(process.argv[iCarpeta + 1]) : null;

const rutaDb = path.resolve(process.env.DB_PATH || path.join(RAIZ, 'data', 'pausas.db'));
if (!fs.existsSync(rutaDb)) {
  console.error('No hay base de datos para exportar.');
  process.exit(1);
}

console.log('La base de datos (registros, cédulas, usuarios) viajará CIFRADA.');
console.log('Elige una contraseña para el paquete: mínimo 10 caracteres. Se la dirás a la persona que lo instale');
console.log('POR OTRO MEDIO (en persona o por llamada), nunca en el mismo correo o chat donde envíes el archivo.\n');
let password;
for (;;) {
  password = await preguntarOculto('Contraseña del paquete: ');
  if (password.length < 10) {
    console.log('Debe tener al menos 10 caracteres.\n');
    continue;
  }
  if ((await preguntarOculto('Repite la contraseña:    ')) !== password) {
    console.log('No coinciden. Intenta de nuevo.\n');
    continue;
  }
  break;
}
cerrarPreguntas();

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'pausas-export-'));
const destino = carpetaInstalador ?? path.join(temporal, 'PausasActivasQR');
try {
  // Copia consistente de la base aunque el sistema esté funcionando.
  const copia = path.join(temporal, 'copia.db');
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  db.exec(`VACUUM INTO '${copia.replaceAll("'", "''")}'`);
  db.close();
  const limpia = new DatabaseSync(copia);
  // Las sesiones abiertas no viajan: en el PC nuevo todos inician sesión otra vez.
  limpia.exec("DELETE FROM sesiones; UPDATE configuracion SET valor = '' WHERE clave = 'base_url';");
  limpia.close();

  const incluir = ['server', 'web', 'scripts', 'datos', 'dist', 'tests', 'package.json', 'package-lock.json', 'vite.config.js', 'README.md', '.env.example', '.gitignore'];
  for (const nombre of [...incluir, ...fs.readdirSync(RAIZ).filter((f) => f.endsWith('.bat'))]) {
    const origen = path.join(RAIZ, nombre);
    if (fs.existsSync(origen)) fs.cpSync(origen, path.join(destino, nombre), { recursive: true });
  }
  const cloudflared = path.join(RAIZ, 'herramientas', 'cloudflared.exe');
  if (fs.existsSync(cloudflared)) fs.cpSync(cloudflared, path.join(destino, 'herramientas', 'cloudflared.exe'));

  const dirCifrados = path.join(destino, 'datos-cifrados');
  fs.mkdirSync(dirCifrados, { recursive: true });
  console.log('\nCifrando la base de datos...');
  fs.writeFileSync(path.join(dirCifrados, 'pausas.db.cifrado'), cifrar(fs.readFileSync(copia), password));
  const env = path.join(RAIZ, '.env');
  if (fs.existsSync(env)) fs.writeFileSync(path.join(dirCifrados, '.env.cifrado'), cifrar(fs.readFileSync(env), password));
  fs.writeFileSync(
    path.join(destino, 'LEEME-PRIMERO.txt'),
    carpetaInstalador
      ? [
          'PAUSAS ACTIVAS QR - instalado con el instalador',
          '',
          'El sistema funciona en segundo plano y arranca solo al iniciar sesión en Windows.',
          'Panel (enlace FIJO en este PC):  http://localhost:3000/admin',
          'También: acceso directo "Panel Pausas Activas" en el Escritorio y en el menú Inicio.',
          'QR del día: panel > Código QR, o la imagen QR-DEL-DIA.png de esta carpeta.',
          '',
          'Para que funcione siempre: PC encendido, sesión de Windows iniciada y con internet.',
          'Para alejarte usa Windows + L (bloquear). No lo suspendas ni cierres la sesión.',
        ].join('\r\n')
      : [
      'INSTALAR PAUSAS ACTIVAS QR EN ESTE PC',
      '',
      '1. Instala Node.js (versión LTS) desde https://nodejs.org  (siguiente, siguiente, finalizar).',
      '2. Copia esta carpeta "PausasActivasQR" al Escritorio (o a Documentos).',
      '3. Abre la carpeta y haz doble clic en ACTIVAR-SISTEMA.bat.',
      '4. Escribe la contraseña del paquete cuando la pida (te la dieron por otro medio).',
      '5. Al terminar se abre el panel. Ingresa con tu correo y contraseña de administrador.',
      '   Si aún no tienes cuenta: en este PC toca "Crear cuenta de administrador".',
      '',
      'Desde ese momento el sistema funciona en segundo plano y arranca solo al iniciar sesión.',
      'Tu enlace FIJO para entrar al panel en este PC es:  http://localhost:3000/admin',
      '(también queda el acceso directo "Panel Pausas Activas" en el Escritorio).',
      'El QR del día está en el panel > Código QR y en la imagen QR-DEL-DIA.png de esta carpeta.',
      '',
      'Para que funcione siempre: deja este PC encendido, con la sesión de Windows iniciada y con internet.',
      'Para alejarte usa Windows + L (bloquear). No lo suspendas ni cierres la sesión.',
      '',
      'IMPORTANTE: en el PC anterior ejecuten DESACTIVAR-INICIO-AUTOMATICO.bat. Si los dos PCs',
      'quedan encendidos con el sistema, habría dos QR distintos y los registros quedarían repartidos.',
    ].join('\r\n'),
  );

  if (carpetaInstalador) {
    console.log('Carpeta del paquete lista.');
    process.exitCode = 0;
  } else {
  const fecha = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  // El Escritorio real (puede estar redirigido a OneDrive).
  const escritorio = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"]).toString().trim() || os.homedir();
  const zip = path.join(escritorio, `PausasActivasQR-para-otro-PC_${fecha}.zip`);
  console.log('Comprimiendo el paquete (puede tardar un minuto)...');
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${destino.replaceAll("'", "''")}' -DestinationPath '${zip.replaceAll("'", "''")}' -Force`], {
    stdio: 'inherit',
  });
  console.log(`\nLISTO. Paquete creado en el Escritorio:\n  ${zip}\n`);
  console.log('Pásalo al otro PC (USB, carpeta compartida o correo). Los datos van cifrados.');
  console.log('Dile la contraseña a la persona POR OTRO MEDIO.');
  console.log('Cuando el otro PC ya funcione, ejecuta aquí DESACTIVAR-INICIO-AUTOMATICO.bat.');
  }
} finally {
  fs.rmSync(temporal, { recursive: true, force: true });
}
