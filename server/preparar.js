// Abre la base y deja listo lo que el sistema necesita al arrancar. Lo usan el servidor de Windows (index.js)
// y la función de Vercel (api/index.js).
import path from 'node:path';
import { hashPassword } from './auth.js';
import { abrirDb, guardarValor, leerConfig } from './db.js';
import { RAIZ } from './entorno.js';
import { urlNube } from './red.js';

/** Base de datos: Turso si hay TURSO_DATABASE_URL; si no, el archivo local (DB_PATH o data/pausas.db). */
export function destinoDb() {
  if (process.env.TURSO_DATABASE_URL) return { destino: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN };
  return { destino: path.resolve(process.env.DB_PATH || path.join(RAIZ, 'data', 'pausas.db')) };
}

export async function prepararDb({ conInternet = false } = {}) {
  const { destino, token } = destinoDb();
  const db = await abrirDb(destino, token);

  // Instalaciones automatizadas: primera cuenta desde variables de entorno.
  if (!(await db.prepare('SELECT 1 AS ok FROM usuarios_admin LIMIT 1').get()) && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await db
      .prepare("INSERT INTO usuarios_admin (email, nombre, rol, password_hash) VALUES (?, 'Administrador', 'admin', ?)")
      .run(process.env.ADMIN_EMAIL.toLowerCase(), hashPassword(process.env.ADMIN_PASSWORD));
    console.log(`  Usuario administrador creado desde variables de entorno: ${process.env.ADMIN_EMAIL}`);
  }

  if (!conInternet) {
    // Un enlace de túnel de un arranque anterior ya no existe.
    await db.prepare("UPDATE configuracion SET valor = '' WHERE clave = 'base_url' AND valor LIKE '%.trycloudflare.com%'").run();
    // En la nube la dirección es fija: el QR nunca cambia.
    if (urlNube()) {
      const config = await leerConfig(db);
      if (config.enlace_tipo !== 'fijo') await guardarValor(db, 'enlace_tipo', 'fijo');
      if (!config.qr_actualizado_en) await guardarValor(db, 'qr_actualizado_en', new Date().toISOString());
    }
  }
  return db;
}
