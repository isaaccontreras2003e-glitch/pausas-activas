// Registros que no se pudieron enviar por falta de señal: quedan en el celular y se reenvían solos.
import { api } from '../lib/api.js';

const CLAVE = 'pausas.pendientes.v1';

function leer() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) ?? [];
  } catch {
    return [];
  }
}

function escribir(lista) {
  try {
    if (lista.length) localStorage.setItem(CLAVE, JSON.stringify(lista));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* almacenamiento bloqueado: no hay más que hacer */
  }
}

export const hayPendientes = () => leer().length > 0;

export function guardarPendiente(cuerpo) {
  escribir([...leer().filter((p) => p.cedula !== cuerpo.cedula), { ...cuerpo, guardado_en: new Date().toISOString() }]);
}

let enviando = false;

/** Intenta enviar lo pendiente. Devuelve cuántos se entregaron. Lo que sigue sin señal se queda para después. */
export async function enviarPendientes() {
  if (enviando) return 0;
  const lista = leer();
  if (!lista.length) return 0;
  enviando = true;
  const quedan = [];
  let entregados = 0;
  try {
    for (const p of lista) {
      const { guardado_en, ...cuerpo } = p;
      try {
        await api('/api/public/registro', { method: 'POST', body: cuerpo, timeout: 15_000 });
        entregados++;
      } catch (e) {
        if (e.codigo === 'YA_REGISTRADO') entregados++; // ya había llegado (se perdió solo la respuesta)
        else if (e.codigo === 'SIN_CONEXION' || e.status === 429) quedan.push(p);
        // Otros errores (datos ya no válidos): se descarta para no reintentar para siempre.
      }
    }
  } finally {
    escribir(quedan);
    enviando = false;
  }
  return entregados;
}
