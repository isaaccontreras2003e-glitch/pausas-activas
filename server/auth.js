import crypto from 'node:crypto';
import { ErrorApp, ahoraIso } from './util.js';

const DURACION_SESION_MS = 12 * 3600 * 1000;
export const COOKIE = 'pausas_sid';

export function hashPassword(password) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

export function verificarPassword(password, almacenado) {
  const [sal, hash] = String(almacenado).split(':');
  if (!sal || !hash) return false;
  const calculado = crypto.scryptSync(String(password), sal, 64);
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

// Para correos que no existen se calcula igual un hash: así el tiempo de respuesta no revela qué cuentas existen.
const HASH_SEÑUELO = hashPassword(crypto.randomBytes(16).toString('hex'));
export function verificarPasswordDeUsuario(usuario, password) {
  const ok = verificarPassword(password, usuario?.password_hash ?? HASH_SEÑUELO);
  return Boolean(usuario) && ok;
}

export const REGLA_PASSWORD = 'Mínimo 10 caracteres, con al menos una letra y un número.';

export function validarPassword(password) {
  const p = String(password ?? '');
  if (p.length < 10 || !/\p{L}/u.test(p) || !/\d/.test(p)) {
    throw new ErrorApp(422, 'VALIDACION', `Contraseña débil. ${REGLA_PASSWORD}`, { password: REGLA_PASSWORD });
  }
  if (p.length > 200) throw new ErrorApp(422, 'VALIDACION', 'La contraseña es demasiado larga.', { password: 'Máximo 200 caracteres.' });
  return p;
}

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function crearSesion(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DURACION_SESION_MS).toISOString();
  db.prepare('DELETE FROM sesiones WHERE expira_en < ?').run(ahoraIso());
  db.prepare('INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, ?)').run(hashToken(token), usuarioId, expira);
  return token;
}

export function cookieSesion(req, token, maxAgeSeg = DURACION_SESION_MS / 1000) {
  const seguro = req.secure || req.get('x-forwarded-proto') === 'https';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`;
}

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

/** Devuelve el usuario de la cookie de sesión. `token` en el resultado es el hash guardado en la base. */
export function usuarioDeSesion(db, req) {
  const cookie = leerCookie(req, COOKIE);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
  const token = hashToken(cookie);
  const usuario = db
    .prepare(
      `SELECT u.id, u.email, u.nombre, u.rol, u.empresa_id, e.nombre AS empresa_nombre
         FROM sesiones s
         JOIN usuarios_admin u ON u.id = s.usuario_id
         LEFT JOIN empresas e ON e.id = u.empresa_id
        WHERE s.token = ? AND s.expira_en > ? AND u.activo = 1`,
    )
    .get(token, ahoraIso());
  return usuario ? { ...usuario, token } : null;
}

/** Middleware: exige sesión y, opcionalmente, uno de los roles indicados. */
export function requiereSesion(db, roles = null) {
  return (req, res, next) => {
    const usuario = usuarioDeSesion(db, req);
    if (!usuario) throw new ErrorApp(401, 'NO_AUTENTICADO', 'Tu sesión expiró. Ingresa de nuevo.');
    if (roles && !roles.includes(usuario.rol)) throw new ErrorApp(403, 'SIN_PERMISO', 'No tienes permiso para esta acción.');
    req.usuario = usuario;
    next();
  };
}
