// Mantiene el sistema encendido en segundo plano, sin ventana: si el servidor o el túnel se caen, los vuelve a
// arrancar. Lo lanza scripts/iniciar-oculto.vbs (al iniciar sesión en Windows) y se detiene con DETENER-SISTEMA.bat.
import { RAIZ } from './entorno.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dirDatos = path.join(RAIZ, 'data');
const dirLogs = path.join(dirDatos, 'logs');
export const ARCHIVO_PID = path.join(dirDatos, 'servicio.pid');
fs.mkdirSync(dirLogs, { recursive: true });

// Una sola copia a la vez.
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidPrevio = Number(fs.existsSync(ARCHIVO_PID) ? fs.readFileSync(ARCHIVO_PID, 'utf8') : 0);
if (pidPrevio && pidPrevio !== process.pid && vivo(pidPrevio)) process.exit(0);
fs.writeFileSync(ARCHIVO_PID, String(process.pid));

const rutaLog = path.join(dirLogs, 'sistema.log');
if (fs.existsSync(rutaLog) && fs.statSync(rutaLog).size > 5 * 1024 * 1024) fs.renameSync(rutaLog, `${rutaLog}.anterior`);
const log = fs.createWriteStream(rutaLog, { flags: 'a' });
const escribir = (texto) => {
  const sello = new Date(Date.now() - 5 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  for (const linea of String(texto).split('\n')) if (linea.trim()) log.write(`[${sello}] ${linea}\n`);
};

let reinicios = 0;
function arrancar() {
  escribir('Iniciando el sistema...');
  const inicio = Date.now();
  const hijo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(RAIZ, 'server', 'index.js'), '--internet'], {
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  hijo.stdout.on('data', escribir);
  hijo.stderr.on('data', escribir);
  hijo.on('exit', (codigo) => {
    // Si estuvo estable más de 5 minutos, la cuenta de fallos vuelve a cero.
    reinicios = Date.now() - inicio > 5 * 60_000 ? 1 : reinicios + 1;
    const espera = Math.min(60, 5 * reinicios);
    escribir(`El sistema se detuvo (código ${codigo}). Se reinicia en ${espera} s.`);
    setTimeout(arrancar, espera * 1000);
  });
}

process.on('exit', () => {
  try {
    if (fs.readFileSync(ARCHIVO_PID, 'utf8') === String(process.pid)) fs.rmSync(ARCHIVO_PID);
  } catch {
    /* ya no existe */
  }
});
arrancar();
