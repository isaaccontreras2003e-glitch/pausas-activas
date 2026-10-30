export class ErrorApi extends Error {
  constructor(status, datos) {
    super(datos?.mensaje || 'Ocurrió un error. Intenta de nuevo.');
    this.status = status;
    this.codigo = datos?.codigo;
    this.detalles = datos?.detalles ?? {};
  }
}

export async function api(ruta, { method = 'GET', body, timeout } = {}) {
  let res;
  try {
    res = await fetch(ruta, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      // Con señal muy mala, mejor abandonar a tiempo y reintentar que dejar a la persona esperando.
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
  } catch {
    throw new ErrorApi(0, { codigo: 'SIN_CONEXION', mensaje: 'No hay conexión a internet. Revisa tu señal e intenta de nuevo.' });
  }
  // Sin conexión, Cloudflare o el navegador pueden responder con páginas de error que no son de este sistema.
  if ([502, 503, 504, 530].includes(res.status)) {
    throw new ErrorApi(0, { codigo: 'SIN_CONEXION', mensaje: 'El servidor no está disponible en este momento.' });
  }
  const datos = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && ruta.startsWith('/api/admin')) {
      const volver = encodeURIComponent(location.pathname + location.search);
      location.assign(`/admin/login?volver=${volver}`);
    }
    throw new ErrorApi(res.status, datos);
  }
  return datos;
}

/** Objeto → query string, omitiendo valores vacíos. */
export function qs(obj) {
  return new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
}
