import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Fechas en UTC con formato ISO (2026-10-29T15:02:11.123Z). Se presentan en hora de Bogotá.
const AHORA = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS empresas (
  id         INTEGER PRIMARY KEY,
  nit        TEXT UNIQUE,
  nombre     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT ${AHORA}
);

CREATE TABLE IF NOT EXISTS sedes (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT NOT NULL COLLATE NOCASE,
  ciudad     TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  direccion  TEXT,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT ${AHORA},
  UNIQUE (nombre, ciudad)
);

CREATE TABLE IF NOT EXISTS empresa_sede (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sede_id    INTEGER NOT NULL REFERENCES sedes(id)    ON DELETE CASCADE,
  PRIMARY KEY (empresa_id, sede_id)
);

CREATE TABLE IF NOT EXISTS cargos (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT UNIQUE,
  nombre     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  area       TEXT,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT ${AHORA}
);

-- Cargos de cada empresa. El formulario muestra solo los cargos de la empresa elegida;
-- si una empresa no tiene cargos asignados, ve el listado completo.
CREATE TABLE IF NOT EXISTS empresa_cargo (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cargo_id   INTEGER NOT NULL REFERENCES cargos(id)   ON DELETE CASCADE,
  PRIMARY KEY (empresa_id, cargo_id)
);

-- Cada QR impreso o enviado es un punto. sede_id NULL = QR general (sin sede preseleccionada).
CREATE TABLE IF NOT EXISTS puntos_qr (
  id          INTEGER PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  sede_id     INTEGER REFERENCES sedes(id),
  descripcion TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL DEFAULT ${AHORA}
);

CREATE TABLE IF NOT EXISTS colaboradores (
  id              INTEGER PRIMARY KEY,
  cedula          TEXT NOT NULL UNIQUE,
  nombre_completo TEXT NOT NULL,
  creado_en       TEXT NOT NULL DEFAULT ${AHORA},
  actualizado_en  TEXT NOT NULL DEFAULT ${AHORA}
);

-- nombre/cedula se copian (snapshot) para que los reportes históricos no cambien.
CREATE TABLE IF NOT EXISTS registros_pausa (
  id               INTEGER PRIMARY KEY,
  colaborador_id   INTEGER NOT NULL REFERENCES colaboradores(id),
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id),
  sede_id          INTEGER NOT NULL REFERENCES sedes(id),
  cargo_id         INTEGER NOT NULL REFERENCES cargos(id),
  punto_qr_id      INTEGER REFERENCES puntos_qr(id),
  nombre_snapshot  TEXT NOT NULL,
  cedula_snapshot  TEXT NOT NULL,
  registrado_en    TEXT NOT NULL DEFAULT ${AHORA},
  user_agent       TEXT,
  acepta_tratamiento_datos INTEGER NOT NULL DEFAULT 1,
  -- Respuesta del colaborador: si hizo la pausa, a qué hora (HH:MM, hora Bogotá, mismo día del registro) o por qué no.
  realizo_pausa    INTEGER NOT NULL DEFAULT 1,
  hora_pausa       TEXT,
  motivo_no        TEXT
);
CREATE INDEX IF NOT EXISTS ix_reg_fecha       ON registros_pausa (registrado_en);
CREATE INDEX IF NOT EXISTS ix_reg_sede_fecha  ON registros_pausa (sede_id, registrado_en);
CREATE INDEX IF NOT EXISTS ix_reg_cargo_fecha ON registros_pausa (cargo_id, registrado_en);
CREATE INDEX IF NOT EXISTS ix_reg_emp_fecha   ON registros_pausa (empresa_id, registrado_en);
CREATE INDEX IF NOT EXISTS ix_reg_punto_fecha ON registros_pausa (punto_qr_id, registrado_en);
CREATE INDEX IF NOT EXISTS ix_reg_colab_fecha ON registros_pausa (colaborador_id, registrado_en);

CREATE TABLE IF NOT EXISTS usuarios_admin (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin','sst','consulta')),
  empresa_id    INTEGER REFERENCES empresas(id),
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT ${AHORA}
);

-- Quién hizo qué en el panel (inicios de sesión, cambios, exportaciones) y desde qué IP.
CREATE TABLE IF NOT EXISTS auditoria (
  id            INTEGER PRIMARY KEY,
  fecha         TEXT NOT NULL DEFAULT ${AHORA},
  usuario_id    INTEGER,
  usuario_email TEXT,
  accion        TEXT NOT NULL,
  detalle       TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS ix_auditoria_fecha ON auditoria (fecha);

-- token = SHA-256 del valor de la cookie: si alguien copia la base de datos, no puede usar las sesiones.
CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  expira_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`;

const PASOS_INVITACION =
  '2️⃣ Escribe tu nombre completo y tu número de cédula.\n' +
  '3️⃣ Elige tu empresa, sede y cargo.\n' +
  '4️⃣ Responde si realizaste la pausa activa y a qué hora.\n';

/** El QR fijo principal: se crea solo, no se puede regenerar ni borrar, y su enlace es corto (/pausas). */
export const TOKEN_PRINCIPAL = 'principal';

export const CONFIG_POR_DEFECTO = {
  organizacion: 'Mi Empresa',
  ventana_antiduplicado_min: '30',
  base_url: '',
  // Hora (Bogotá) a la que se genera el QR del día cuando el enlace es temporal.
  hora_renovacion_qr: '05:30',
  texto_tratamiento_datos:
    'Autorizo a {organizacion} a tratar mis datos personales (nombre, número de documento, empresa, sede y cargo) ' +
    'con la finalidad de registrar y medir mi participación en el programa de pausas activas del Sistema de Gestión ' +
    'de Seguridad y Salud en el Trabajo, conforme a la Ley 1581 de 2012. Puedo conocer, actualizar y rectificar mis ' +
    'datos comunicándome con el área de SST.',
  mensaje_exito: '¡Gracias por cuidarte! Tu participación quedó registrada.',
  mensaje_invitacion:
    '🧘 *Pausas Activas – {organizacion}*\n\n' +
    '¡Hola! Es momento de cuidar tu cuerpo. Registra tu participación así:\n\n' +
    '1️⃣ Abre este enlace: {enlace}\n' +
    '     (si ves el código QR en una pantalla o afiche, también puedes escanearlo con la cámara)\n' +
    PASOS_INVITACION +
    '5️⃣ Toca *Enviar registro* y espera el mensaje de confirmación ✅\n\n' +
    'Tus datos quedan guardados en tu celular: la próxima vez solo tendrás que tocar el botón.\n\n' +
    'Equipo de Seguridad y Salud en el Trabajo',
};

export function abrirDb(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(ESQUEMA);
  migrar(db);
  const insertar = db.prepare('INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)');
  for (const [clave, valor] of Object.entries(CONFIG_POR_DEFECTO)) insertar.run(clave, valor);
  db.prepare("INSERT OR IGNORE INTO puntos_qr (token, sede_id, descripcion) VALUES (?, NULL, 'QR principal')").run(TOKEN_PRINCIPAL);
  return db;
}

/** Cambios sobre bases de datos creadas con versiones anteriores. Cada paso es idempotente. */
function migrar(db) {
  const columnas = new Set(db.prepare('PRAGMA table_info(registros_pausa)').all().map((c) => c.name));
  if (!columnas.has('realizo_pausa')) {
    transaccion(db, () => {
      db.exec('ALTER TABLE registros_pausa ADD COLUMN realizo_pausa INTEGER NOT NULL DEFAULT 1');
      db.exec('ALTER TABLE registros_pausa ADD COLUMN hora_pausa TEXT');
      db.exec('ALTER TABLE registros_pausa ADD COLUMN motivo_no TEXT');
      // Los registros anteriores eran todos "sí": la hora de la pausa es la hora del registro.
      db.exec("UPDATE registros_pausa SET hora_pausa = strftime('%H:%M', registrado_en, '-5 hours')");
      // Si el mensaje de invitación no se había personalizado, se actualiza con el paso nuevo.
      const anterior = '2️⃣ Escribe tu nombre completo y tu número de cédula.\n3️⃣ Elige tu empresa, sede y cargo.\n4️⃣ Toca *Registrar pausa activa* y espera el mensaje de confirmación ✅';
      const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'mensaje_invitacion'").get();
      if (fila?.valor.includes(anterior)) {
        db.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'mensaje_invitacion'").run(
          fila.valor.replace(anterior, `${PASOS_INVITACION}5️⃣ Toca *Enviar registro* y espera el mensaje de confirmación ✅`),
        );
      }
    });
  }
}

export function transaccion(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Valores internos (no editables desde Configuración), p. ej. cuándo se generó el QR del día. */
export function guardarValor(db, clave, valor) {
  db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor').run(clave, String(valor));
}

export function leerConfig(db) {
  const filas = db.prepare('SELECT clave, valor FROM configuracion').all();
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}
