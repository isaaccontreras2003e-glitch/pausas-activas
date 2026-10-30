import crypto from 'node:crypto';

export class ErrorApp extends Error {
  constructor(status, codigo, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// Colombia no tiene horario de verano: UTC-5 todo el año.
const OFFSET_BOGOTA = '-05:00';
const MS_OFFSET = 5 * 3600 * 1000;

export const ahoraIso = () => new Date().toISOString();

export const hoyBogota = () => new Date(Date.now() - MS_OFFSET).toISOString().slice(0, 10);

/** Minutos transcurridos del día en Bogotá (0–1439). */
export function minutosBogota() {
  const d = new Date(Date.now() - MS_OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** '2026-10-29' | '2026-10-29T10:30' (hora Bogotá) -> ISO UTC. `fin` hace el límite inclusivo. */
export function bogotaAUtc(valor, fin = false) {
  const s = String(valor ?? '').trim();
  let iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = `${s}T${fin ? '23:59:59.999' : '00:00:00.000'}${OFFSET_BOGOTA}`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) iso = `${s}:${fin ? '59.999' : '00.000'}${OFFSET_BOGOTA}`;
  else throw new ErrorApp(400, 'FECHA_INVALIDA', `Fecha inválida: "${s}"`);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new ErrorApp(400, 'FECHA_INVALIDA', `Fecha inválida: "${s}"`);
  return d.toISOString();
}

/** ISO UTC -> 'YYYY-MM-DD HH:mm:ss' en hora Bogotá (para exportes). */
export function utcABogota(iso) {
  return new Date(new Date(iso).getTime() - MS_OFFSET).toISOString().replace('T', ' ').slice(0, 19);
}

export function normalizarNombre(nombre) {
  return String(nombre ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-CO')
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'));
}

export const RE_NOMBRE = /^\p{L}[\p{L}\s'.-]*$/u;
export const RE_CEDULA = /^\d{5,15}$/;

export function validarRegistro(d) {
  const errores = {};
  const nombre = String(d.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) errores.nombre = 'Escribe tu nombre completo.';
  else if (nombre.length < 5 || nombre.length > 150) errores.nombre = 'El nombre debe tener entre 5 y 150 caracteres.';
  else if (!RE_NOMBRE.test(nombre)) errores.nombre = 'El nombre solo puede contener letras y espacios.';
  else if (nombre.split(' ').length < 2) errores.nombre = 'Escribe al menos un nombre y un apellido.';

  const cedula = String(d.cedula ?? '').trim();
  if (!cedula) errores.cedula = 'Escribe tu número de cédula.';
  else if (!RE_CEDULA.test(cedula)) errores.cedula = 'La cédula debe tener entre 5 y 15 números, sin puntos ni espacios.';

  if (!entero(d.empresa_id)) errores.empresa_id = 'Selecciona tu empresa.';
  if (!entero(d.sede_id)) errores.sede_id = 'Selecciona tu sede.';
  if (!entero(d.cargo_id)) errores.cargo_id = 'Selecciona tu cargo.';

  if (typeof d.realizo_pausa !== 'boolean') errores.realizo_pausa = 'Indica si realizaste la pausa activa.';
  else if (d.realizo_pausa) {
    const hora = String(d.hora_pausa ?? '');
    const m = hora.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) errores.hora_pausa = 'Indica a qué hora realizaste la pausa.';
    else if (Number(m[1]) * 60 + Number(m[2]) > minutosBogota() + 10) errores.hora_pausa = 'La hora no puede ser posterior a la hora actual.';
  } else if (d.motivo_no != null && String(d.motivo_no).length > 200) errores.motivo_no = 'El motivo es demasiado largo.';
  if (d.acepta !== true) errores.acepta = 'Debes autorizar el tratamiento de datos para registrarte.';
  return errores;
}

export function entero(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function enmascararCedula(cedula) {
  const s = String(cedula ?? '');
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
}

// Sin caracteres ambiguos (0/o, 1/l/i) para que el enlace se pueda dictar o copiar a mano.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
export function tokenCorto(largo = 8) {
  const bytes = crypto.randomBytes(largo);
  let t = '';
  for (const b of bytes) t += ALFABETO[b % ALFABETO.length];
  return t;
}

export function textoOpcional(v, max = 200) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

export function textoRequerido(v, campo, max = 150) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new ErrorApp(422, 'VALIDACION', `El campo "${campo}" es obligatorio.`, { [campo]: 'Obligatorio.' });
  return s.slice(0, max);
}

/** Limitador en memoria por IP (suficiente para una sola instancia). */
export function limitador({ ventanaMs, maximo, mensaje }) {
  const golpes = new Map();
  setInterval(() => {
    const limite = Date.now() - ventanaMs;
    for (const [ip, lista] of golpes) {
      const vigentes = lista.filter((t) => t > limite);
      if (vigentes.length) golpes.set(ip, vigentes);
      else golpes.delete(ip);
    }
  }, ventanaMs).unref();

  return (req, res, next) => {
    const ip = req.ip ?? 'desconocida';
    const ahora = Date.now();
    const lista = (golpes.get(ip) ?? []).filter((t) => t > ahora - ventanaMs);
    lista.push(ahora);
    golpes.set(ip, lista);
    if (lista.length > maximo) throw new ErrorApp(429, 'DEMASIADAS_SOLICITUDES', mensaje);
    next();
  };
}
