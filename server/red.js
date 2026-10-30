import os from 'node:os';
import { leerConfig } from './db.js';

/** Primera IPv4 de red local (192.168.x, 10.x, 172.16-31.x), útil para probar desde celulares en el mismo Wi-Fi. */
export function ipLocal() {
  const candidatas = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
    .filter((ip) => !ip.startsWith('169.254.'));
  return (
    candidatas.find((ip) => ip.startsWith('192.168.')) ??
    candidatas.find((ip) => ip.startsWith('10.')) ??
    candidatas.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ??
    candidatas[0] ??
    'localhost'
  );
}

export function urlBaseDetectada(puerto) {
  return `http://${ipLocal()}:${puerto}`;
}

/** URL que se codifica en los QR: la configurada por el administrador o, si no hay, la de red local. */
export function urlBasePublica(db, puerto) {
  const configurada = (leerConfig(db).base_url ?? '').trim().replace(/\/+$/, '');
  return configurada || urlBaseDetectada(puerto);
}

/** true si la URL solo funciona dentro de la red de la oficina (o en este mismo equipo). */
export function esUrlLocal(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}
