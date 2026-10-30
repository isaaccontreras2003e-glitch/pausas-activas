// Carga en la base actual (local o en la nube) los datos de otra base SQLite: la que viene descifrada del
// archivo .cifrado de EXPORTAR-DATOS.bat. Copia tabla por tabla solo las columnas que existen en ambas.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardarValor } from './db.js';
import { urlNube } from './red.js';
import { ErrorApp } from './util.js';

// En orden de dependencias. Las sesiones y los bloqueos de inicio de sesión no se copian.
const TABLAS = [
  'empresas',
  'sedes',
  'empresa_sede',
  'cargos',
  'empresa_cargo',
  'puntos_qr',
  'colaboradores',
  'registros_pausa',
  'auditoria',
  'configuracion',
  'usuarios_admin', // al final: si algo falla antes, el sistema sigue "nuevo" y se puede reintentar
];

export async function importarBase(db, datos) {
  if (!datos.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) {
    throw new ErrorApp(422, 'PAQUETE_INVALIDO', 'El archivo no contiene datos del sistema.');
  }
  const temporal = path.join(os.tmpdir(), `importar-${crypto.randomBytes(6).toString('hex')}.db`);
  fs.writeFileSync(temporal, datos);
  const { DatabaseSync } = await import('node:sqlite');
  let origen;
  try {
    try {
      origen = new DatabaseSync(temporal, { readOnly: true });
      const { n } = origen.prepare("SELECT COUNT(*) AS n FROM usuarios_admin WHERE rol = 'admin' AND activo = 1").get();
      if (!n) throw new Error('sin administradores');
    } catch {
      throw new ErrorApp(422, 'PAQUETE_INVALIDO', 'El archivo no contiene un sistema válido con administradores.');
    }

    const sentencias = [...TABLAS].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
    const conteo = {};
    for (const tabla of TABLAS) {
      const columnasOrigen = origen.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
      if (!columnasOrigen.length) continue;
      const columnasDestino = new Set((await db.prepare(`PRAGMA table_info(${tabla})`).all()).map((c) => c.name));
      const columnas = columnasOrigen.filter((c) => columnasDestino.has(c));
      const filas = origen.prepare(`SELECT ${columnas.join(', ')} FROM ${tabla}`).all();
      const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`;
      for (const f of filas) sentencias.push({ sql, args: columnas.map((c) => f[c]) });
      conteo[tabla] = filas.length;
    }
    await db.lote(sentencias);

    // La dirección de los QR la define el servidor donde quedan los datos, no el PC de origen.
    await guardarValor(db, 'base_url', '');
    if (urlNube()) await guardarValor(db, 'enlace_tipo', 'fijo');
    return { registros: conteo.registros_pausa ?? 0, usuarios: conteo.usuarios_admin ?? 0, cargos: conteo.cargos ?? 0, sedes: conteo.sedes ?? 0 };
  } finally {
    origen?.close();
    fs.rmSync(temporal, { force: true });
  }
}
