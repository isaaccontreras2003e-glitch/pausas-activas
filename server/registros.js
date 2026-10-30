import { leerConfig, transaccion } from './db.js';
import { ErrorApp, ahoraIso, entero, normalizarNombre, validarRegistro } from './util.js';

export const SELECT_REGISTRO = `
  SELECT r.id, r.registrado_en, r.nombre_snapshot AS nombre, r.cedula_snapshot AS cedula,
         r.empresa_id, e.nombre AS empresa,
         r.sede_id, s.nombre AS sede,
         r.cargo_id, c.nombre AS cargo,
         r.punto_qr_id, p.descripcion AS punto,
         r.realizo_pausa, r.hora_pausa, r.motivo_no
    FROM registros_pausa r
    JOIN empresas e ON e.id = r.empresa_id
    JOIN sedes s    ON s.id = r.sede_id
    JOIN cargos c   ON c.id = r.cargo_id
    LEFT JOIN puntos_qr p ON p.id = r.punto_qr_id`;

export function obtenerRegistro(db, id) {
  return db.prepare(`${SELECT_REGISTRO} WHERE r.id = ?`).get(id);
}

/** Catálogos activos que necesita el formulario público. */
export function catalogosPublicos(db) {
  return {
    empresas: db.prepare('SELECT id, nombre FROM empresas WHERE activo = 1 ORDER BY nombre').all(),
    sedes: db.prepare("SELECT id, nombre, ciudad FROM sedes WHERE activo = 1 ORDER BY nombre, ciudad").all(),
    empresa_sede: db
      .prepare(
        `SELECT es.empresa_id, es.sede_id FROM empresa_sede es
           JOIN empresas e ON e.id = es.empresa_id AND e.activo = 1
           JOIN sedes s ON s.id = es.sede_id AND s.activo = 1`,
      )
      .all(),
    cargos: db.prepare('SELECT id, nombre, area FROM cargos WHERE activo = 1 ORDER BY nombre').all(),
    empresa_cargo: db
      .prepare('SELECT ec.empresa_id, ec.cargo_id FROM empresa_cargo ec JOIN cargos c ON c.id = ec.cargo_id AND c.activo = 1')
      .all(),
  };
}

export function obtenerPuntoPublico(db, token) {
  const punto = db
    .prepare(
      `SELECT p.id, p.token, p.descripcion,
              CASE WHEN s.activo = 1 THEN p.sede_id END AS sede_id,
              CASE WHEN s.activo = 1 THEN s.nombre END AS sede_nombre
         FROM puntos_qr p
         LEFT JOIN sedes s ON s.id = p.sede_id
        WHERE p.token = ? AND p.activo = 1`,
    )
    .get(String(token ?? ''));
  if (!punto) throw new ErrorApp(404, 'QR_INVALIDO', 'Este código QR no está activo. Avisa al equipo de SST.');
  return punto;
}

/**
 * Único punto de escritura del formulario público.
 * Valida QR, catálogos y relación empresa–sede, y bloquea registros repetidos dentro de la ventana configurada.
 */
export function registrarPausa(db, datos, userAgent) {
  const errores = validarRegistro(datos);
  if (Object.keys(errores).length) throw new ErrorApp(422, 'VALIDACION', 'Revisa los datos del formulario.', errores);

  const punto = obtenerPuntoPublico(db, datos.token);
  const empresaId = entero(datos.empresa_id);
  const sedeId = entero(datos.sede_id);
  const cargoId = entero(datos.cargo_id);

  if (!db.prepare('SELECT 1 FROM cargos WHERE id = ? AND activo = 1').get(cargoId)) {
    throw new ErrorApp(422, 'CARGO_INVALIDO', 'El cargo seleccionado ya no está disponible.', { cargo_id: 'Selecciona un cargo de la lista.' });
  }
  const empresaTieneCargos = db.prepare('SELECT 1 FROM empresa_cargo WHERE empresa_id = ? LIMIT 1').get(empresaId);
  if (empresaTieneCargos && !db.prepare('SELECT 1 FROM empresa_cargo WHERE empresa_id = ? AND cargo_id = ?').get(empresaId, cargoId)) {
    throw new ErrorApp(422, 'CARGO_INVALIDO', 'El cargo no pertenece a la empresa seleccionada.', { cargo_id: 'Selecciona un cargo de tu empresa.' });
  }
  const sedeValida = db
    .prepare(
      `SELECT 1 FROM empresa_sede es
         JOIN empresas e ON e.id = es.empresa_id AND e.activo = 1
         JOIN sedes s ON s.id = es.sede_id AND s.activo = 1
        WHERE es.empresa_id = ? AND es.sede_id = ?`,
    )
    .get(empresaId, sedeId);
  if (!sedeValida) {
    throw new ErrorApp(422, 'SEDE_EMPRESA_INVALIDA', 'La sede no pertenece a la empresa seleccionada.', {
      sede_id: 'Selecciona una sede de la empresa elegida.',
    });
  }

  const nombre = normalizarNombre(datos.nombre);
  const cedula = String(datos.cedula).trim();
  const realizo = datos.realizo_pausa === true;
  const horaPausa = realizo ? datos.hora_pausa : null;
  const motivo = realizo ? null : String(datos.motivo_no ?? '').trim().slice(0, 200) || null;
  const ventanaMin = Math.max(0, Number(leerConfig(db).ventana_antiduplicado_min) || 0);

  const id = transaccion(db, () => {
    const ahora = ahoraIso();
    const { id: colaboradorId } = db
      .prepare(
        `INSERT INTO colaboradores (cedula, nombre_completo, creado_en, actualizado_en) VALUES (?, ?, ?, ?)
         ON CONFLICT (cedula) DO UPDATE SET nombre_completo = excluded.nombre_completo, actualizado_en = excluded.actualizado_en
         RETURNING id`,
      )
      .get(cedula, nombre, ahora, ahora);

    if (ventanaMin > 0) {
      const limite = new Date(Date.now() - ventanaMin * 60_000).toISOString();
      const previo = db
        .prepare('SELECT registrado_en FROM registros_pausa WHERE colaborador_id = ? AND registrado_en > ? ORDER BY registrado_en DESC LIMIT 1')
        .get(colaboradorId, limite);
      if (previo) {
        const hora = new Date(previo.registrado_en).toLocaleTimeString('es-CO', {
          timeZone: 'America/Bogota',
          hour: 'numeric',
          minute: '2-digit',
        });
        throw new ErrorApp(
          409,
          'YA_REGISTRADO',
          `Ya enviaste tu registro hace poco (${hora}). Podrás enviar otro cuando pasen ${ventanaMin} minutos.`,
          { registrado_en: previo.registrado_en },
        );
      }
    }

    return db
      .prepare(
        `INSERT INTO registros_pausa
           (colaborador_id, empresa_id, sede_id, cargo_id, punto_qr_id, nombre_snapshot, cedula_snapshot, registrado_en, user_agent,
            realizo_pausa, hora_pausa, motivo_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        colaboradorId, empresaId, sedeId, cargoId, punto.id, nombre, cedula, ahora, String(userAgent ?? '').slice(0, 300),
        realizo ? 1 : 0, horaPausa, motivo,
      ).id;
  });

  return obtenerRegistro(db, id);
}
