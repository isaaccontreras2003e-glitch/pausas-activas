// Acceso a la base de datos con la misma interfaz (asíncrona) para dos destinos:
//  - Archivo local SQLite (node:sqlite): este PC y el instalador.
//  - Turso / libSQL en la nube (https:// o libsql://): despliegue en Vercel.
//
// Uso:  const fila = await db.prepare('SELECT … WHERE id = ?').get(id)
//       await db.transaccion(async (tx) => { await tx.prepare('INSERT …').run(…) })
// Los parámetros pueden ser posicionales (?, ?) o con nombre (:nombre) pasando un objeto { nombre }.

const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
const normalizar = (params) => (params.length === 1 && esObjetoPlano(params[0]) ? params[0] : params);

/** Base remota en Turso/libSQL. */
class BaseRemota {
  constructor(cliente) {
    this.cliente = cliente;
    this.local = false;
  }

  static async conectar(url, authToken) {
    // Cliente "web": solo usa fetch, sin binarios nativos (ideal para Vercel).
    const { createClient } = await import('@libsql/client/web');
    return new BaseRemota(createClient({ url, authToken }));
  }

  async #ejecutar(ejecutor, sql, params) {
    const r = await ejecutor.execute({ sql, args: normalizar(params) });
    const filas = r.rows.map((fila) => Object.fromEntries(r.columns.map((c, i) => [c, fila[i]])));
    return { filas, cambios: r.rowsAffected };
  }

  vista(ejecutor = this.cliente) {
    return {
      prepare: (sql) => ({
        get: async (...p) => (await this.#ejecutar(ejecutor, sql, p)).filas[0],
        all: async (...p) => (await this.#ejecutar(ejecutor, sql, p)).filas,
        run: async (...p) => ({ changes: (await this.#ejecutar(ejecutor, sql, p)).cambios }),
      }),
    };
  }

  prepare(sql) {
    return this.vista().prepare(sql);
  }

  async exec(sql) {
    await this.cliente.executeMultiple(sql);
  }

  async transaccion(fn) {
    const tx = await this.cliente.transaction('write');
    try {
      const resultado = await fn({ ...this.vista(tx), local: false });
      await tx.commit();
      return resultado;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    } finally {
      tx.close();
    }
  }

  /** Muchas sentencias en pocos viajes de red (bloques de 400; cada bloque es atómico). */
  async lote(sentencias) {
    for (let i = 0; i < sentencias.length; i += 400) {
      await this.cliente.batch(sentencias.slice(i, i + 400).map((s) => ({ sql: s.sql, args: s.args ?? [] })), 'write');
    }
  }

  async cerrar() {
    this.cliente.close();
  }
}

/** Archivo local con node:sqlite (síncrono por dentro). Las escrituras se ponen en fila para que una
 *  transacción no se mezcle con otras solicitudes mientras espera. */
class BaseLocal {
  constructor(db, ruta) {
    this.db = db;
    this.ruta = ruta;
    this.local = true;
    this.cola = Promise.resolve();
  }

  static async conectar(ruta) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(ruta);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    return new BaseLocal(db, ruta);
  }

  #enFila(fn) {
    const resultado = this.cola.then(fn);
    this.cola = resultado.catch(() => {});
    return resultado;
  }

  #directa() {
    const db = this.db;
    const p = (params) => {
      const n = normalizar(params);
      return Array.isArray(n) ? n : [n];
    };
    return {
      prepare: (sql) => ({
        get: async (...params) => db.prepare(sql).get(...p(params)),
        all: async (...params) => db.prepare(sql).all(...p(params)),
        run: async (...params) => {
          const r = db.prepare(sql).run(...p(params));
          return { changes: Number(r.changes) };
        },
      }),
    };
  }

  prepare(sql) {
    const directa = this.#directa().prepare(sql);
    // Una sentencia que devuelve filas (SELECT o … RETURNING) solo lee si es SELECT; las demás escriben.
    const escribe = !/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
    return {
      get: (...p) => (escribe ? this.#enFila(() => directa.get(...p)) : directa.get(...p)),
      all: (...p) => (escribe ? this.#enFila(() => directa.all(...p)) : directa.all(...p)),
      run: (...p) => this.#enFila(() => directa.run(...p)),
    };
  }

  async exec(sql) {
    return this.#enFila(() => this.db.exec(sql));
  }

  transaccion(fn) {
    return this.#enFila(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = await fn({ ...this.#directa(), local: true });
        this.db.exec('COMMIT');
        return resultado;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
  }

  /** Muchas sentencias en una sola transacción. */
  lote(sentencias) {
    return this.#enFila(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const s of sentencias) this.db.prepare(s.sql).run(...(s.args ?? []));
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
  }

  /** Copia consistente del archivo (respaldos). Solo existe en modo local. */
  async copiarA(destino) {
    return this.#enFila(() => this.db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`));
  }

  async cerrar() {
    await this.cola;
    this.db.close();
  }
}

/** `destino`: ruta de archivo (o ':memory:') para local, o URL https:// / libsql:// de Turso. */
export async function conectar(destino, authToken) {
  if (/^(libsql|https?|wss?):\/\//i.test(destino)) return BaseRemota.conectar(destino, authToken);
  // Pruebas: PAUSAS_PRUEBA_LIBSQL=1 usa el mismo conector de Turso (libSQL) sobre un archivo local,
  // para validar el camino de la nube sin una cuenta de Turso.
  if (process.env.PAUSAS_PRUEBA_LIBSQL) {
    const { createClient } = await import('@libsql/client');
    const { default: os } = await import('node:os');
    const archivo = destino === ':memory:' ? `${os.tmpdir()}/libsql-prueba-${process.pid}-${Math.random().toString(36).slice(2)}.db` : destino;
    return new BaseRemota(createClient({ url: `file:${archivo.replaceAll('\\', '/')}` }));
  }
  return BaseLocal.conectar(destino);
}
