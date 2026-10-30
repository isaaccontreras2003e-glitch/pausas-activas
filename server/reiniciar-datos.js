// Borra TODOS los datos (registros, colaboradores, catálogos, usuarios y configuración) y deja el
// sistema como recién instalado. Antes guarda una copia de respaldo en data/respaldos/.
//
// Uso (con el sistema APAGADO):
//   npm run reiniciar -- --confirmar
//   npm run reiniciar -- --confirmar --empresas "IMES,VIU,FOCA" --cargos IMES=datos/cargos-imes.csv --cargos FOCA=datos/cargos-foca.csv
//   (opcional: crea esas empresas y carga la lista de cargos de cada una)
import { RAIZ } from './entorno.js';
import fs from 'node:fs';
import path from 'node:path';
import { abrirDb } from './db.js';
import { importarCargos } from './importar-cargos.js';

const args = process.argv.slice(2);
if (!args.includes('--confirmar')) {
  console.log('Esto BORRA todos los datos del sistema. Para continuar ejecuta: npm run reiniciar -- --confirmar');
  process.exit(1);
}

const ruta = path.resolve(process.env.DB_PATH || path.join(RAIZ, 'data', 'pausas.db'));
const archivos = [ruta, `${ruta}-wal`, `${ruta}-shm`];

if (fs.existsSync(ruta)) {
  const sello = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const carpeta = path.join(path.dirname(ruta), 'respaldos', `antes-de-reiniciar_${sello}`);
  fs.mkdirSync(carpeta, { recursive: true });
  try {
    for (const a of archivos) if (fs.existsSync(a)) fs.copyFileSync(a, path.join(carpeta, path.basename(a)));
    for (const a of archivos) if (fs.existsSync(a)) fs.rmSync(a);
  } catch (e) {
    if (['EBUSY', 'EPERM'].includes(e.code)) {
      console.error('La base de datos está en uso. Cierra la ventana del sistema (INICIAR-...) y vuelve a intentarlo.');
      process.exit(1);
    }
    throw e;
  }
  console.log(`Respaldo guardado en: ${carpeta}`);
}

const db = await abrirDb(ruta);
console.log('Datos borrados. El sistema quedó como recién instalado (solo existe el QR principal fijo).');

const iEmpresas = args.indexOf('--empresas');
if (iEmpresas >= 0) {
  const nombres = String(args[iEmpresas + 1] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  for (const n of nombres) await db.prepare('INSERT OR IGNORE INTO empresas (nombre) VALUES (?)').run(n);
  console.log(`Empresas creadas: ${nombres.join(', ')}.`);
}

// --cargos EMPRESA=archivo.csv (se puede repetir, una vez por empresa)
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--cargos') continue;
  const [empresa, archivoRel] = String(args[i + 1] ?? '').split('=');
  const archivo = path.resolve(archivoRel ?? '');
  const fila = await db.prepare('SELECT id FROM empresas WHERE nombre = ?').get(empresa.trim());
  if (!fila) {
    console.error(`La empresa "${empresa}" no existe; inclúyela en --empresas.`);
    process.exit(1);
  }
  const r = await importarCargos(db, {
    nombre_archivo: archivo,
    archivo_base64: fs.readFileSync(archivo).toString('base64'),
    aplicar: true,
    empresa_ids: [fila.id],
  });
  const total = r.nuevos.length + r.actualizados.length + r.sin_cambios.length;
  console.log(`Cargos de ${empresa}: ${total} (${r.nuevos.length} nuevos, ${total - r.nuevos.length} compartidos con otra empresa)${r.errores.length ? `, ${r.errores.length} filas con error` : ''}.`);
}
await db.cerrar();
console.log('Abre el sistema y entra a http://localhost:3000/admin en este equipo para crear tu cuenta de administrador.');
