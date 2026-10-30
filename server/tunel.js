import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from './entorno.js';

/**
 * Publica este servidor en internet con cloudflared, y lo reconecta si se cae.
 *
 * - Enlace FIJO (recomendado): con CLOUDFLARE_TUNNEL_TOKEN y URL_PUBLICA_FIJA en .env (túnel con nombre en un
 *   dominio de la empresa). El QR nunca cambia.
 * - Enlace TEMPORAL (sin configuración): https://xxxx.trycloudflare.com, que cambia cada vez que el túnel se reabre.
 *
 * `alObtenerUrl(url, fijo)` se llama cada vez que el túnel queda conectado, para actualizar los QR.
 */
export function abrirTunel(puerto, alObtenerUrl) {
  const ejecutable = path.join(RAIZ, 'herramientas', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!fs.existsSync(ejecutable)) {
    console.error(`\n  No se encontró ${ejecutable}.`);
    console.error('  Descárgalo de https://github.com/cloudflare/cloudflared/releases (cloudflared-windows-amd64.exe)');
    console.error('  y guárdalo como herramientas\\cloudflared.exe\n');
    return;
  }

  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
  const urlFija = process.env.URL_PUBLICA_FIJA?.trim().replace(/\/+$/, '');
  const fijo = Boolean(token && urlFija);
  // http2 viaja por el puerto 443 como cualquier página web; el protocolo por defecto (QUIC/UDP)
  // suele estar bloqueado en redes corporativas y el enlace responde "error 1033".
  const argumentos = fijo
    ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', token]
    : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${puerto}`];

  let proceso = null;
  let cerrando = false;
  let intentos = 0;
  let urlActual = null;
  let fallosSeguidos = 0;

  // Fuerza un túnel nuevo: el manejador de 'exit' lo vuelve a abrir.
  const reabrir = (motivo) => {
    if (!proceso || proceso.exitCode !== null) return;
    console.error(`  [vigilante] ${motivo}. Abriendo un enlace nuevo...`);
    urlActual = null;
    proceso.kill();
  };

  const abrir = () => {
    proceso = spawn(ejecutable, argumentos, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let conectado = false;
    let urlPendiente = fijo ? urlFija : null;
    const leer = (bloque) => {
      const texto = String(bloque);
      for (const linea of texto.split('\n')) if (/ ERR /.test(linea)) console.error(`  [túnel] ${linea.trim()}`);
      // Un enlace temporal vencido no se recupera solo: cloudflared reintenta para siempre con el enlace muerto.
      if (!fijo && /Tunnel not found/.test(texto)) reabrir('Cloudflare dio de baja el enlace temporal');
      urlPendiente ??= texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      // El enlace solo se anuncia cuando la conexión con Cloudflare ya quedó registrada.
      if (!conectado && urlPendiente && /Registered tunnel connection/.test(texto)) {
        conectado = true;
        intentos = 0;
        fallosSeguidos = 0;
        urlActual = urlPendiente;
        alObtenerUrl(urlPendiente, fijo);
      }
    };
    proceso.stdout.on('data', leer);
    proceso.stderr.on('data', leer);
    proceso.on('exit', (codigo) => {
      if (cerrando) return;
      intentos++;
      const espera = Math.min(60, 5 * intentos);
      console.error(`  El enlace a internet se cerró (código ${codigo}). Reconectando en ${espera} s...`);
      if (!fijo) console.error('  Al reconectar, el enlace temporal cambia: el panel y ENLACE-ACTUAL.txt mostrarán el nuevo.');
      setTimeout(abrir, espera * 1000);
    });
  };

  abrir();

  // Vigilante: cada minuto entra al formulario por el enlace público, como lo haría un celular.
  // Si falla 3 veces seguidas (≈3 min), reabre el túnel aunque cloudflared crea que sigue conectado.
  setInterval(async () => {
    if (!urlActual) return;
    try {
      const r = await fetch(`${urlActual}/api/salud`, { signal: AbortSignal.timeout(20_000), headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fallosSeguidos = 0;
    } catch (e) {
      fallosSeguidos++;
      console.error(`  [vigilante] El enlace público no responde (${fallosSeguidos}/3): ${e.message}`);
      if (fallosSeguidos >= 3) {
        fallosSeguidos = 0;
        reabrir('El enlace público dejó de responder');
      }
    }
  }, 60_000).unref();

  const cerrar = () => {
    cerrando = true;
    proceso?.kill();
  };
  for (const senal of ['SIGINT', 'SIGTERM', 'exit']) process.on(senal, cerrar);
  return { reabrir, fijo };
}
