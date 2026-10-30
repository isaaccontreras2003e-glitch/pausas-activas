import ExcelJS from 'exceljs';
import { SELECT_REGISTRO } from './registros.js';
import { neutralizarFormula } from './seguridad.js';
import { ErrorApp, bogotaAUtc, enmascararCedula, entero, hoyBogota, utcABogota } from './util.js';

/**
 * Traduce los filtros de la URL a una condición SQL sobre `registros_pausa r`.
 * Un usuario limitado a una empresa siempre queda filtrado por ella, pida lo que pida.
 */
export function construirFiltro(q, usuario) {
  const hoy = hoyBogota();
  const desdeLocal = String(q.desde || hoy);
  const hastaLocal = String(q.hasta || hoy);
  const desde = bogotaAUtc(desdeLocal);
  const hasta = bogotaAUtc(hastaLocal, true);
  if (desde > hasta) throw new ErrorApp(400, 'RANGO_INVALIDO', 'La fecha inicial es posterior a la final.');

  const cond = ['r.registrado_en >= :desde', 'r.registrado_en <= :hasta'];
  const params = { desde, hasta };
  const empresaId = usuario?.empresa_id ?? entero(q.empresa_id);
  const filtros = { empresa_id: empresaId, sede_id: entero(q.sede_id), cargo_id: entero(q.cargo_id), punto_qr_id: entero(q.punto_id) };
  for (const [campo, valor] of Object.entries(filtros)) {
    if (valor) {
      cond.push(`r.${campo} = :${campo}`);
      params[campo] = valor;
    }
  }
  if (q.realizo === 'si' || q.realizo === 'no') cond.push(`r.realizo_pausa = ${q.realizo === 'si' ? 1 : 0}`);
  const texto = String(q.q ?? '').trim();
  if (texto) {
    cond.push('(r.nombre_snapshot LIKE :texto OR r.cedula_snapshot LIKE :texto)');
    params.texto = `%${texto}%`;
  }
  return { sql: cond.join(' AND '), params, desde, hasta, desdeLocal, hastaLocal };
}

function agrupar(db, filtro, columnaId, join, etiqueta) {
  return db
    .prepare(
      `SELECT ${columnaId} AS id, ${etiqueta} AS etiqueta, COUNT(*) AS registros,
              SUM(r.realizo_pausa) AS si, COUNT(*) - SUM(r.realizo_pausa) AS no,
              COUNT(DISTINCT r.colaborador_id) AS personas
         FROM registros_pausa r ${join}
        WHERE ${filtro.sql}
        GROUP BY ${columnaId}
        ORDER BY si DESC, registros DESC, etiqueta`,
    )
    .all(filtro.params);
}

/** Cubetas de la serie de tiempo: por hora (≤ 2 días), por día (≤ 92 días) o por mes. */
function granularidad(filtro) {
  const horas = (new Date(filtro.hasta) - new Date(filtro.desde)) / 3_600_000;
  if (horas <= 48) return 'hora';
  if (horas <= 92 * 24) return 'dia';
  return 'mes';
}

const FORMATO_CUBETA = { hora: '%Y-%m-%d %H:00', dia: '%Y-%m-%d', mes: '%Y-%m' };

function cubetas(filtro, gran) {
  const lista = [];
  // Recorremos en "hora Bogotá" desplazando las fechas UTC 5 horas atrás.
  const cursor = new Date(new Date(filtro.desde).getTime() - 5 * 3_600_000);
  const fin = new Date(new Date(filtro.hasta).getTime() - 5 * 3_600_000);
  if (gran === 'hora') cursor.setUTCMinutes(0, 0, 0);
  else cursor.setUTCHours(0, 0, 0, 0);
  if (gran === 'mes') cursor.setUTCDate(1);
  while (cursor <= fin && lista.length < 2000) {
    const iso = cursor.toISOString();
    lista.push(gran === 'hora' ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00` : gran === 'dia' ? iso.slice(0, 10) : iso.slice(0, 7));
    if (gran === 'hora') cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (gran === 'dia') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return lista;
}

export async function resumen(db, filtro, usuario) {
  // Mismo filtro, desplazado al período inmediatamente anterior de igual duración.
  const duracion = new Date(filtro.hasta) - new Date(filtro.desde) + 1;
  // Pausas realizadas en el tiempo. Por hora se usa la hora que declaró el colaborador, no la del envío.
  const gran = granularidad(filtro);
  const expresionPeriodo =
    gran === 'hora'
      ? "strftime('%Y-%m-%d', r.registrado_en, '-5 hours') || ' ' || substr(COALESCE(r.hora_pausa, strftime('%H:%M', r.registrado_en, '-5 hours')), 1, 2) || ':00'"
      : `strftime('${FORMATO_CUBETA[gran]}', r.registrado_en, '-5 hours')`;
  const empresaFija = usuario?.empresa_id;

  // Todas las consultas a la vez: con la base en la nube cada una tarda un viaje de red.
  const [totales, anterior, filasSerie, sedesActivas, porSede, porCargo, porEmpresa, porPunto, ultimos] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS registros, COALESCE(SUM(r.realizo_pausa), 0) AS si,
                COUNT(DISTINCT CASE WHEN r.realizo_pausa = 1 THEN r.colaborador_id END) AS personas,
                MAX(r.registrado_en) AS ultimo
           FROM registros_pausa r WHERE ${filtro.sql}`,
      )
      .get(filtro.params),
    db.prepare(`SELECT COALESCE(SUM(r.realizo_pausa), 0) AS si FROM registros_pausa r WHERE ${filtro.sql}`).get({
      ...filtro.params,
      desde: new Date(new Date(filtro.desde).getTime() - duracion).toISOString(),
      hasta: new Date(new Date(filtro.hasta).getTime() - duracion).toISOString(),
    }),
    db
      .prepare(
        `SELECT ${expresionPeriodo} AS periodo, COUNT(*) AS registros
           FROM registros_pausa r WHERE ${filtro.sql} AND r.realizo_pausa = 1 GROUP BY periodo`,
      )
      .all(filtro.params),
    (empresaFija
      ? db.prepare('SELECT COUNT(*) AS n FROM sedes s JOIN empresa_sede es ON es.sede_id = s.id WHERE s.activo = 1 AND es.empresa_id = ?').get(empresaFija)
      : db.prepare('SELECT COUNT(*) AS n FROM sedes WHERE activo = 1').get()
    ).then((f) => f.n),
    agrupar(db, filtro, 'r.sede_id', 'JOIN sedes s ON s.id = r.sede_id', "s.nombre || CASE WHEN s.ciudad <> '' THEN ' (' || s.ciudad || ')' ELSE '' END"),
    agrupar(db, filtro, 'r.cargo_id', 'JOIN cargos c ON c.id = r.cargo_id', 'c.nombre'),
    agrupar(db, filtro, 'r.empresa_id', 'JOIN empresas e ON e.id = r.empresa_id', 'e.nombre'),
    // Incluye puntos activos sin registros: así se detectan QR dañados o mal ubicados.
    db
      .prepare(
        `SELECT p.id, p.descripcion AS etiqueta, s.nombre AS sede, p.activo,
                COUNT(r.id) AS registros, COALESCE(SUM(r.realizo_pausa), 0) AS si,
                COUNT(r.id) - COALESCE(SUM(r.realizo_pausa), 0) AS no, COUNT(DISTINCT r.colaborador_id) AS personas
           FROM puntos_qr p
           LEFT JOIN sedes s ON s.id = p.sede_id
           LEFT JOIN registros_pausa r ON r.punto_qr_id = p.id AND ${filtro.sql}
          WHERE p.activo = 1 OR r.id IS NOT NULL
          GROUP BY p.id
          ORDER BY registros DESC, etiqueta`,
      )
      .all(filtro.params),
    db
      .prepare(`${SELECT_REGISTRO} WHERE ${filtro.sql} ORDER BY r.registrado_en DESC LIMIT 50`)
      .all(filtro.params)
      .then((filas) => filas.map((f) => protegerFila(f, usuario))),
  ]);

  const conteos = new Map(filasSerie.map((f) => [f.periodo, f.registros]));
  const serie = cubetas(filtro, gran).map((periodo) => ({ periodo, registros: conteos.get(periodo) ?? 0 }));

  return {
    filtro: { desde: filtro.desdeLocal, hasta: filtro.hastaLocal },
    kpis: {
      registros: totales.registros,
      si: totales.si,
      no: totales.registros - totales.si,
      personas: totales.personas,
      si_periodo_anterior: anterior.si,
      sedes_con_registros: porSede.filter((s) => s.si > 0).length,
      sedes_activas: sedesActivas,
      ultimo_registro: totales.ultimo,
    },
    granularidad: gran,
    serie,
    por_sede: porSede,
    por_cargo: porCargo,
    por_empresa: porEmpresa,
    por_punto: porPunto,
    ultimos,
  };
}

export function protegerFila(fila, usuario) {
  return usuario?.rol === 'consulta' ? { ...fila, cedula: enmascararCedula(fila.cedula) } : fila;
}

export async function listarRegistros(db, filtro, usuario, { pagina = 1, tamano = 50 } = {}) {
  const tam = Math.min(Math.max(entero(tamano) ?? 50, 10), 500);
  const pag = Math.max(entero(pagina) ?? 1, 1);
  const [{ total }, filas] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM registros_pausa r WHERE ${filtro.sql}`).get(filtro.params),
    db.prepare(`${SELECT_REGISTRO} WHERE ${filtro.sql} ORDER BY r.registrado_en DESC LIMIT ${tam} OFFSET ${(pag - 1) * tam}`).all(filtro.params),
  ]);
  return { total, pagina: pag, tamano: tam, filas: filas.map((f) => protegerFila(f, usuario)) };
}

// ───────────────────────── Exportación ─────────────────────────

const COLUMNAS_DETALLE = [
  { header: 'Fecha', key: 'fecha', width: 12 },
  { header: 'Nombre completo', key: 'nombre', width: 34 },
  { header: 'Cédula', key: 'cedula', width: 15 },
  { header: 'Empresa', key: 'empresa', width: 26 },
  { header: 'Sede', key: 'sede', width: 22 },
  { header: 'Cargo', key: 'cargo', width: 30 },
  { header: '¿Realizó la pausa activa?', key: 'realizo', width: 14 },
  { header: 'Hora de la pausa', key: 'hora_pausa', width: 14 },
  { header: 'Motivo (si no la realizó)', key: 'motivo', width: 34 },
  { header: 'Hora de envío', key: 'hora', width: 12 },
  { header: 'Punto QR', key: 'punto', width: 24 },
];

async function filasDetalle(db, filtro, usuario) {
  return (await db.prepare(`${SELECT_REGISTRO} WHERE ${filtro.sql} ORDER BY r.registrado_en`).all(filtro.params)).map((f) => {
      const [fecha, hora] = utcABogota(f.registrado_en).split(' ');
      return {
        ...protegerFila(f, usuario),
        fecha,
        hora: hora.slice(0, 5),
        realizo: f.realizo_pausa ? 'Sí' : 'No',
        hora_pausa: f.hora_pausa ?? '',
        motivo: f.motivo_no ?? '',
        punto: f.punto ?? '',
      };
  });
}

function estilizarHoja(hoja) {
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5FA8' } };
  encabezado.alignment = { vertical: 'middle' };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  if (hoja.rowCount > 1) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
}

function hojaConsolidado(libro, nombre, filas, titulo) {
  const hoja = libro.addWorksheet(nombre);
  hoja.columns = [
    { header: titulo, key: 'etiqueta', width: 36 },
    { header: 'Realizaron la pausa', key: 'si', width: 18 },
    { header: 'No la realizaron', key: 'no', width: 16 },
    { header: 'Total respuestas', key: 'registros', width: 16 },
    { header: '% cumplimiento', key: 'porcentaje', width: 15 },
    { header: 'Personas únicas', key: 'personas', width: 16 },
  ];
  const conPorcentaje = (f) => ({ ...f, porcentaje: f.registros ? f.si / f.registros : null });
  hoja.addRows(filas.map(conPorcentaje));
  const suma = (k) => filas.reduce((s, f) => s + f[k], 0);
  const filaTotal = hoja.addRow(conPorcentaje({ etiqueta: 'TOTAL', si: suma('si'), no: suma('no'), registros: suma('registros') }));
  hoja.getColumn('porcentaje').numFmt = '0%';
  filaTotal.font = { bold: true };
  estilizarHoja(hoja);
}

export async function exportarXlsx(db, filtro, usuario, tipo, organizacion) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Pausas Activas QR';
  libro.created = new Date();

  if (tipo === 'consolidado') {
    const r = await resumen(db, filtro, usuario);
    const portada = libro.addWorksheet('Resumen');
    portada.columns = [{ width: 32 }, { width: 40 }];
    portada.addRows([
      [`Reporte de pausas activas – ${organizacion}`],
      [],
      ['Desde', filtro.desdeLocal.replace('T', ' ')],
      ['Hasta', filtro.hastaLocal.replace('T', ' ')],
      ['Generado', utcABogota(new Date().toISOString())],
      ['Generado por', usuario?.nombre ?? ''],
      [],
      ['Total respuestas', r.kpis.registros],
      ['Realizaron la pausa activa', r.kpis.si],
      ['No la realizaron', r.kpis.no],
      ['% de cumplimiento', r.kpis.registros ? `${Math.round((r.kpis.si / r.kpis.registros) * 100)} %` : '—'],
      ['Personas únicas que la realizaron', r.kpis.personas],
      ['Pausas realizadas en el período anterior', r.kpis.si_periodo_anterior],
      ['Sedes con participación', `${r.kpis.sedes_con_registros} de ${r.kpis.sedes_activas}`],
    ]);
    portada.getRow(1).font = { bold: true, size: 14 };
    for (let n = 8; n <= 14; n++) portada.getRow(n).getCell(1).font = { bold: true };

    hojaConsolidado(libro, 'Por sede', r.por_sede, 'Sede');
    hojaConsolidado(libro, 'Por cargo', r.por_cargo, 'Cargo');
    hojaConsolidado(libro, 'Por empresa', r.por_empresa, 'Empresa');
    hojaConsolidado(
      libro,
      'Por punto QR',
      r.por_punto.map((p) => ({ ...p, etiqueta: p.sede ? `${p.etiqueta} – ${p.sede}` : p.etiqueta })),
      'Punto QR',
    );
    const serie = libro.addWorksheet('Por período');
    serie.columns = [
      { header: r.granularidad === 'hora' ? 'Hora de la pausa' : r.granularidad === 'dia' ? 'Día' : 'Mes', key: 'periodo', width: 20 },
      { header: 'Pausas realizadas', key: 'registros', width: 18 },
    ];
    serie.addRows(r.serie);
    estilizarHoja(serie);
  }

  const detalle = libro.addWorksheet('Detalle');
  detalle.columns = COLUMNAS_DETALLE;
  detalle.addRows(await filasDetalle(db, filtro, usuario));
  estilizarHoja(detalle);

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** CSV con «;» y BOM UTF-8 para que Excel en español lo abra con tildes y columnas correctas. */
export async function exportarCsv(db, filtro, usuario, tipo) {
  const celda = (v) => {
    const s = typeof v === 'number' ? String(v) : neutralizarFormula(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [];
  if (tipo === 'consolidado') {
    const r = await resumen(db, filtro, usuario);
    lineas.push(['Dimensión', 'Valor', 'Realizaron la pausa', 'No la realizaron', 'Total respuestas', 'Personas únicas'].join(';'));
    const bloques = [
      ['Sede', r.por_sede],
      ['Cargo', r.por_cargo],
      ['Empresa', r.por_empresa],
      ['Punto QR', r.por_punto],
    ];
    for (const [dim, filas] of bloques) {
      for (const f of filas) lineas.push([dim, f.etiqueta, f.si, f.no, f.registros, f.personas].map(celda).join(';'));
    }
  } else {
    lineas.push(COLUMNAS_DETALLE.map((c) => c.header).join(';'));
    for (const f of await filasDetalle(db, filtro, usuario)) lineas.push(COLUMNAS_DETALLE.map((c) => celda(f[c.key])).join(';'));
  }
  return '﻿' + lineas.join('\r\n') + '\r\n';
}
