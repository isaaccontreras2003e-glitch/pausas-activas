// Detiene el sistema que corre en segundo plano (servicio, servidor y túnel).
import { RAIZ } from './entorno.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const archivoPid = path.join(RAIZ, 'data', 'servicio.pid');
let detenido = false;

if (fs.existsSync(archivoPid)) {
  const pid = Number(fs.readFileSync(archivoPid, 'utf8'));
  try {
    // /T cierra también los procesos hijos: el servidor y cloudflared.
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    detenido = true;
  } catch {
    /* el proceso ya no existía */
  }
  fs.rmSync(archivoPid, { force: true });
}

// Copias iniciadas a mano (ventana negra) o restos de un cierre brusco.
try {
  const salida = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const puerto = Number(process.env.PORT || 3000);
  for (const linea of salida.split('\n')) {
    const m = linea.trim().match(new RegExp(`^TCP\\s+\\S+:${puerto}\\s+\\S+\\s+LISTENING\\s+(\\d+)$`));
    if (m) {
      execSync(`taskkill /PID ${m[1]} /T /F`, { stdio: 'ignore' });
      detenido = true;
    }
  }
} catch {
  /* sin netstat o sin permisos: no hay más que hacer */
}
try {
  execSync('taskkill /IM cloudflared.exe /F', { stdio: 'ignore' });
} catch {
  /* no estaba corriendo */
}
fs.rmSync(path.join(RAIZ, 'ENLACE-ACTUAL.txt'), { force: true });
fs.rmSync(path.join(RAIZ, 'QR-DEL-DIA.png'), { force: true });

console.log(detenido ? 'Sistema detenido. El QR no funcionará hasta que lo actives de nuevo.' : 'El sistema no estaba encendido.');
