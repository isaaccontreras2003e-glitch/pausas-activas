const ZONA = 'America/Bogota';

export const numero = (n) => new Intl.NumberFormat('es-CO').format(n ?? 0);

export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });

export const fecha = (iso) =>
  new Date(iso).toLocaleDateString('es-CO', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });

export const fechaLarga = (iso) =>
  new Date(iso).toLocaleDateString('es-CO', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });

export const fechaHora = (iso) => `${fecha(iso)} ${hora(iso)}`;

/** '14:05' → '2:05 p. m.' */
export function horaLegible(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return '—';
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return fecha(iso);
}

/** 'YYYY-MM-DD' de hoy en Bogotá (más/menos días). */
export function diaBogota(desplazamientoDias = 0) {
  return new Date(Date.now() - 5 * 3_600_000 + desplazamientoDias * 86_400_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DDTHH:mm' (hora Bogotá) → milisegundos UTC. */
export const localAMs = (s, fin = false) => new Date(`${s}${s.length === 10 ? (fin ? 'T23:59' : 'T00:00') : ''}:${fin ? '59.999' : '00'}-05:00`).getTime();

/** Etiqueta corta para el eje de la serie de tiempo. */
export function etiquetaPeriodo(periodo, granularidad) {
  if (granularidad === 'hora') return periodo.slice(11, 13) + 'h';
  if (granularidad === 'dia') return `${periodo.slice(8, 10)}/${periodo.slice(5, 7)}`;
  const [a, m] = periodo.split('-');
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}

export function etiquetaPeriodoLarga(periodo, granularidad) {
  if (granularidad === 'hora') {
    const h = Number(periodo.slice(11, 13));
    return `${periodo.slice(8, 10)}/${periodo.slice(5, 7)} · ${h}:00 – ${h}:59`;
  }
  if (granularidad === 'dia') return new Date(`${periodo}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });
  return etiquetaPeriodo(periodo, granularidad);
}

export const quitarTildes = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
