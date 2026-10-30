import { leerConfig } from './db.js';
import { ErrorApp } from './util.js';

/**
 * Cabeceras de seguridad para todas las respuestas:
 * - CSP: el navegador solo ejecuta scripts de este mismo sitio (frena XSS e inyección de scripts de terceros).
 * - frame-ancestors/X-Frame-Options: nadie puede incrustar el panel en otra página (clickjacking).
 * - HSTS: si se entró por https, el navegador no vuelve a aceptar http.
 */
export function cabecerasSeguridad(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // React y las gráficas usan estilos en línea (atributo style); no ejecutan código.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Protección CSRF: una petición que modifica datos solo se acepta si viene de este mismo sitio.
 * Un sitio malicioso abierto en el navegador del administrador no puede borrar ni cambiar nada en su nombre.
 */
export function mismoOrigen(db, puerto) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origen = req.get('origin') || req.get('referer');
    // Sin Origin ni Referer no es un navegador (scripts, pruebas): la sesión por cookie igual es obligatoria.
    if (!origen) return next();
    let hostOrigen;
    try {
      hostOrigen = new URL(origen).host.toLowerCase();
    } catch {
      throw new ErrorApp(403, 'ORIGEN_INVALIDO', 'Solicitud rechazada por seguridad.');
    }
    const permitidos = new Set(
      [req.get('host'), req.get('x-forwarded-host'), `localhost:${puerto}`, `127.0.0.1:${puerto}`]
        .filter(Boolean)
        .map((h) => h.toLowerCase()),
    );
    try {
      const base = leerConfig(db).base_url;
      if (base) permitidos.add(new URL(base).host.toLowerCase());
    } catch {
      /* base_url vacía o inválida */
    }
    if (!permitidos.has(hostOrigen)) throw new ErrorApp(403, 'ORIGEN_INVALIDO', 'Solicitud rechazada por seguridad.');
    next();
  };
}

/**
 * Bloqueo por cuenta: tras 5 contraseñas incorrectas seguidas para un mismo correo, esa cuenta queda bloqueada
 * 15 minutos (aunque el atacante cambie de IP). Complementa el límite por IP.
 */
export function crearBloqueoCuentas({ maximo = 5, minutos = 15 } = {}) {
  const fallos = new Map();
  return {
    verificar(email) {
      const f = fallos.get(email);
      if (f?.hasta && f.hasta > Date.now()) {
        const resto = Math.ceil((f.hasta - Date.now()) / 60_000);
        throw new ErrorApp(429, 'CUENTA_BLOQUEADA', `Demasiados intentos fallidos. Por seguridad, esta cuenta está bloqueada ${resto} min.`);
      }
    },
    fallo(email) {
      const f = fallos.get(email) ?? { n: 0 };
      f.n += 1;
      if (f.n >= maximo) {
        f.hasta = Date.now() + minutos * 60_000;
        f.n = 0;
      }
      fallos.set(email, f);
      return f.hasta && f.hasta > Date.now();
    },
    exito(email) {
      fallos.delete(email);
    },
  };
}

/** Celdas de CSV/Excel: un texto que empieza por = + - @ podría ejecutarse como fórmula al abrir el archivo. */
export function neutralizarFormula(valor) {
  const s = String(valor ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Registro de auditoría: quién hizo qué y desde dónde. */
export function auditar(db, req, accion, detalle = '') {
  try {
    db.prepare('INSERT INTO auditoria (usuario_id, usuario_email, accion, detalle, ip) VALUES (?, ?, ?, ?, ?)').run(
      req.usuario?.id ?? null,
      req.usuario?.email ?? null,
      accion,
      String(detalle).slice(0, 500),
      String(req.ip ?? '').slice(0, 60),
    );
  } catch (e) {
    console.error(`  No se pudo registrar en auditoría: ${e.message}`);
  }
}
