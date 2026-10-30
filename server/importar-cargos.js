import ExcelJS from 'exceljs';
import { transaccion } from './db.js';
import { ErrorApp } from './util.js';

const sinTildes = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();

function textoCelda(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.text ?? v.result ?? v.richText?.map((t) => t.text).join('') ?? '');
  return String(v);
}

function parsearCsv(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lineas[0]?.match(/;/g)?.length ?? 0) >= (lineas[0]?.match(/,/g)?.length ?? 0) ? ';' : ',';
  return lineas.map((l) => {
    const celdas = [];
    let actual = '';
    let comillas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (comillas) {
        if (c === '"' && l[i + 1] === '"') (actual += '"'), i++;
        else if (c === '"') comillas = false;
        else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) celdas.push(actual), (actual = '');
      else actual += c;
    }
    celdas.push(actual);
    return celdas;
  });
}

async function leerMatriz(nombreArchivo, base64) {
  const buffer = Buffer.from(String(base64 ?? ''), 'base64');
  if (!buffer.length) throw new ErrorApp(400, 'ARCHIVO_VACIO', 'El archivo está vacío.');
  if (/\.csv$|\.txt$/i.test(nombreArchivo)) return parsearCsv(buffer.toString('utf8'));
  if (/\.xlsx$/i.test(nombreArchivo)) {
    const libro = new ExcelJS.Workbook();
    try {
      await libro.xlsx.load(buffer);
    } catch {
      throw new ErrorApp(400, 'ARCHIVO_INVALIDO', 'No se pudo leer el archivo de Excel. Guárdalo como .xlsx e intenta de nuevo.');
    }
    const hoja = libro.worksheets[0];
    const matriz = [];
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      const valores = [];
      for (let c = 1; c <= hoja.columnCount; c++) valores.push(textoCelda(fila.getCell(c).value));
      matriz.push(valores);
    });
    return matriz;
  }
  throw new ErrorApp(400, 'FORMATO_NO_SOPORTADO', 'Usa un archivo .xlsx o .csv.');
}

/**
 * Columnas esperadas (la fila 1 son encabezados): nombre (obligatoria), codigo, area.
 * Empareja por código si existe; si no, por nombre (sin distinguir mayúsculas).
 */
export async function importarCargos(db, { nombre_archivo, archivo_base64, aplicar, empresa_ids }) {
  const empresas = (Array.isArray(empresa_ids) ? empresa_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const matriz = await leerMatriz(String(nombre_archivo ?? ''), archivo_base64);
  if (matriz.length < 2) throw new ErrorApp(400, 'SIN_FILAS', 'El archivo no tiene filas debajo de los encabezados.');

  const encabezados = matriz[0].map(sinTildes);
  const col = (...nombres) => encabezados.findIndex((h) => nombres.includes(h));
  const iNombre = col('nombre', 'cargo', 'nombre del cargo', 'nombre cargo');
  const iCodigo = col('codigo', 'cod', 'codigo cargo');
  const iArea = col('area', 'area / proceso', 'proceso', 'dependencia');
  if (iNombre < 0) throw new ErrorApp(400, 'SIN_COLUMNA_NOMBRE', 'No se encontró la columna "nombre" en la primera fila.');

  const existentesPorCodigo = new Map();
  const existentesPorNombre = new Map();
  for (const c of await db.prepare('SELECT id, codigo, nombre, area, activo FROM cargos').all()) {
    if (c.codigo) existentesPorCodigo.set(sinTildes(c.codigo), c);
    existentesPorNombre.set(c.nombre.toLowerCase(), c);
  }

  const resultado = { nuevos: [], actualizados: [], sin_cambios: [], errores: [] };
  const vistos = new Set();
  matriz.slice(1).forEach((fila, i) => {
    const numFila = i + 2;
    const nombre = String(fila[iNombre] ?? '').trim().replace(/\s+/g, ' ');
    const codigo = iCodigo >= 0 ? String(fila[iCodigo] ?? '').trim() || null : null;
    const area = iArea >= 0 ? String(fila[iArea] ?? '').trim() || null : null;
    if (!nombre && !codigo && !area) return;
    if (!nombre) return resultado.errores.push({ fila: numFila, motivo: 'Falta el nombre del cargo.' });
    if (nombre.length > 120) return resultado.errores.push({ fila: numFila, motivo: 'El nombre supera 120 caracteres.' });
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) return resultado.errores.push({ fila: numFila, motivo: `"${nombre}" está repetido en el archivo.` });
    vistos.add(clave);

    const existente = (codigo && existentesPorCodigo.get(sinTildes(codigo))) || existentesPorNombre.get(clave);
    const item = { fila: numFila, nombre, codigo, area };
    if (!existente) resultado.nuevos.push(item);
    else if (existente.nombre !== nombre || (existente.codigo ?? null) !== codigo || (existente.area ?? null) !== area || !existente.activo)
      resultado.actualizados.push({ ...item, id: existente.id, antes: { nombre: existente.nombre, codigo: existente.codigo, area: existente.area, activo: existente.activo } });
    else resultado.sin_cambios.push({ ...item, id: existente.id });
  });

  if (aplicar === true) {
    await transaccion(db, async (tx) => {
      const insertar = tx.prepare('INSERT INTO cargos (nombre, codigo, area) VALUES (?, ?, ?) RETURNING id');
      const actualizar = tx.prepare('UPDATE cargos SET nombre = ?, codigo = ?, area = ?, activo = 1 WHERE id = ?');
      // Los cargos del archivo se asignan (sin quitar asignaciones previas) a las empresas elegidas.
      const vincular = tx.prepare('INSERT OR IGNORE INTO empresa_cargo (empresa_id, cargo_id) VALUES (?, ?)');
      const ids = [];
      for (const c of resultado.nuevos) ids.push((await insertar.get(c.nombre, c.codigo, c.area)).id);
      for (const c of resultado.actualizados) {
        await actualizar.run(c.nombre, c.codigo, c.area, c.id);
        ids.push(c.id);
      }
      for (const c of resultado.sin_cambios) ids.push(c.id);
      for (const e of empresas) for (const id of ids) await vincular.run(e, id);
    });
    resultado.aplicado = true;
  }
  return resultado;
}

export async function plantillaCargos() {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Cargos');
  hoja.columns = [
    { header: 'codigo', key: 'codigo', width: 12 },
    { header: 'nombre', key: 'nombre', width: 40 },
    { header: 'area', key: 'area', width: 24 },
  ];
  hoja.addRows([
    { codigo: 'C-001', nombre: 'Auxiliar administrativo', area: 'Administrativo' },
    { codigo: 'C-002', nombre: 'Operario de producción', area: 'Operativo' },
  ]);
  hoja.getRow(1).font = { bold: true };
  return Buffer.from(await libro.xlsx.writeBuffer());
}
