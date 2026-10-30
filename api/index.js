// Entrada del servidor en Vercel: todas las rutas /api/* llegan aquí (ver vercel.json).
// La página (dist/) la sirve directamente la red de Vercel.
import { crearApp } from '../server/app.js';
import { prepararDb } from '../server/preparar.js';

let app;

function obtenerApp() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('Falta TURSO_DATABASE_URL: en Vercel la base de datos debe estar en Turso (ver README).');
  }
  // Una sola conexión por instancia; se reutiliza entre solicitudes.
  app ??= prepararDb().then((db) => crearApp({ db, puerto: 443 }));
  return app;
}

export default async function handler(req, res) {
  try {
    (await obtenerApp())(req, res);
  } catch (e) {
    app = undefined; // se reintenta en la próxima solicitud
    console.error(e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        codigo: 'SIN_BASE_DE_DATOS',
        mensaje: 'El sistema no pudo conectarse a la base de datos. Revisa en Vercel las variables TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.',
      }),
    );
  }
}
