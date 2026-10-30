// Cifrado de archivos para el traslado entre PCs: AES-256-GCM con clave derivada de una contraseña (scrypt).
// Formato: "PAQR1" | sal (16) | iv (12) | etiqueta (16) | datos cifrados.
import crypto from 'node:crypto';
import readline from 'node:readline';

const MAGIA = Buffer.from('PAQR1');
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function cifrar(datos, password) {
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const clave = crypto.scryptSync(password, sal, 32, PARAMS);
  const c = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([MAGIA, sal, iv, c.getAuthTag(), cuerpo]);
}

/** Lanza error si la contraseña es incorrecta o el archivo fue alterado. */
export function descifrar(archivo, password) {
  if (!archivo.subarray(0, 5).equals(MAGIA)) throw new Error('El archivo no es un paquete de Pausas Activas QR.');
  const sal = archivo.subarray(5, 21);
  const iv = archivo.subarray(21, 33);
  const etiqueta = archivo.subarray(33, 49);
  const clave = crypto.scryptSync(password, sal, 32, PARAMS);
  const d = crypto.createDecipheriv('aes-256-gcm', clave, iv);
  d.setAuthTag(etiqueta);
  try {
    return Buffer.concat([d.update(archivo.subarray(49)), d.final()]);
  } catch {
    throw new Error('Contraseña incorrecta.');
  }
}

// Un solo lector para todas las preguntas: si se crea uno por pregunta, el segundo puede perder lo escrito.
let lector = null;
const esperando = [];
const sobrantes = [];

/** Pide un texto por consola sin mostrarlo en pantalla. */
export function preguntarOculto(pregunta) {
  if (!lector) {
    lector = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    lector._writeToOutput = () => {}; // lo que se escribe no aparece en pantalla
    lector.on('line', (bruta) => {
      // Sin caracteres invisibles (BOM, espacios al pegar): exportar e importar limpian igual la contraseña.
      const linea = bruta.replace(/^﻿/, '').trim();
      process.stdout.write('\n');
      const resolver = esperando.shift();
      if (resolver) resolver(linea);
      else sobrantes.push(linea);
    });
  }
  process.stdout.write(pregunta);
  if (sobrantes.length) {
    process.stdout.write('\n');
    return Promise.resolve(sobrantes.shift());
  }
  return new Promise((resolver) => esperando.push(resolver));
}

export function cerrarPreguntas() {
  lector?.close();
  lector = null;
}
