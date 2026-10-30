import { RAIZ as raiz } from './entorno.js';
import fs from 'node:fs';
import path from 'node:path';
import { crearApp } from './app.js';
import { hashPassword } from './auth.js';
import QRCode from 'qrcode';
import { abrirDb, guardarValor, leerConfig } from './db.js';
import { esUrlLocal, urlBaseDetectada, urlBasePublica } from './red.js';
import { abrirTunel } from './tunel.js';
import { hoyBogota } from './util.js';

const PUERTO = Number(process.env.PORT || 3000);
const db = abrirDb(process.env.DB_PATH || path.join(raiz, 'data', 'pausas.db'));

// Sin usuarios, el panel muestra la pantalla "Crear cuenta de administrador" (solo desde este equipo).
// Para instalaciones automatizadas se puede crear desde .env con ADMIN_EMAIL y ADMIN_PASSWORD.
if (!db.prepare('SELECT 1 FROM usuarios_admin LIMIT 1').get()) {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    db.prepare("INSERT INTO usuarios_admin (email, nombre, rol, password_hash) VALUES (?, 'Administrador', 'admin', ?)").run(
      process.env.ADMIN_EMAIL,
      hashPassword(process.env.ADMIN_PASSWORD),
    );
    console.log(`\n  Usuario administrador creado desde .env: ${process.env.ADMIN_EMAIL}\n`);
  } else {
    console.log(`\n  PRIMER USO: abre http://localhost:${PUERTO}/admin en ESTE equipo para crear tu cuenta de administrador.\n`);
  }
}

const app = crearApp({ db, dirEstatico: path.join(raiz, 'dist'), puerto: PUERTO });

const conInternet = process.argv.includes('--internet');

// Un enlace de túnel de un arranque anterior ya no existe: sin --internet se vuelve a la dirección local.
if (!conInternet) db.prepare("UPDATE configuracion SET valor = '' WHERE clave = 'base_url' AND valor LIKE '%.trycloudflare.com%'").run();

const servidor = app.listen(PUERTO, '0.0.0.0', () => {
  if (conInternet) {
    console.log('  Pausas Activas QR en marcha. Abriendo enlace público a internet, espera unos segundos...');
    const tunel = abrirTunel(PUERTO, (url, fijo) => publicarQrDelDia(url, fijo));
    // Con enlace temporal, el QR se renueva cada día a la hora configurada: ese es el "QR del día".
    if (tunel && !tunel.fijo) setInterval(() => revisarRenovacionDiaria(tunel), 30_000).unref();
    return;
  }
  const publica = urlBasePublica(db, PUERTO);
  console.log('  Pausas Activas QR en marcha');
  console.log(`  - Panel de SST:              http://localhost:${PUERTO}/admin`);
  console.log(`  - Formulario (lo abre el QR): ${publica}/pausas`);
  if (esUrlLocal(publica)) {
    console.log('    AVISO: esa URL solo funciona en la red Wi-Fi de la oficina. Para enviar QR a personas fuera de ella,');
    console.log('    publica el sistema en un servidor con dominio y configúralo en Configuración > URL pública.');
    console.log('    Si los celulares no abren el QR, ejecuta una vez PERMITIR-CELULARES.bat (Firewall de Windows).');
  }
});

// Copia de seguridad diaria de la base de datos (se conservan 30 días). VACUUM INTO hace una copia
// consistente aunque el sistema esté recibiendo registros en ese momento.
const DIR_RESPALDOS = path.join(raiz, 'data', 'respaldos', 'diarios');
function respaldoDiario() {
  try {
    fs.mkdirSync(DIR_RESPALDOS, { recursive: true });
    const destino = path.join(DIR_RESPALDOS, `pausas-${hoyBogota()}.db`);
    if (!fs.existsSync(destino)) {
      db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
      console.log(`  Copia de seguridad diaria guardada: ${path.basename(destino)}`);
    }
    const limite = Date.now() - 30 * 86_400_000;
    for (const archivo of fs.readdirSync(DIR_RESPALDOS)) {
      const ruta = path.join(DIR_RESPALDOS, archivo);
      if (fs.statSync(ruta).mtimeMs < limite) fs.rmSync(ruta);
    }
  } catch (e) {
    console.error(`  No se pudo hacer la copia de seguridad diaria: ${e.message}`);
  }
}
if (!process.env.DB_PATH?.includes(':memory:')) {
  respaldoDiario();
  setInterval(respaldoDiario, 60 * 60_000).unref();
}

/** Deja el enlace nuevo en el panel, en ENLACE-ACTUAL.txt y como imagen QR-DEL-DIA.png (más un histórico por día). */
async function publicarQrDelDia(url, fijo) {
  db.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'base_url'").run(url);
  guardarValor(db, 'qr_actualizado_en', new Date().toISOString());
  guardarValor(db, 'enlace_tipo', fijo ? 'fijo' : 'temporal');

  const ahoraBogota = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const fecha = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hora = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
  const aviso = fijo
    ? 'Este enlace es FIJO: el QR impreso funciona siempre que este PC esté encendido.'
    : `QR DEL DÍA: se renueva automáticamente cada día a las ${leerConfig(db).hora_renovacion_qr}.\r\n` +
      'Envía a los colaboradores el QR o el enlace de HOY (imagen QR-DEL-DIA.png o el panel > Código QR).\r\n' +
      'Si el internet se cae durante el día, se genera uno nuevo y este archivo se actualiza.';
  fs.writeFileSync(
    path.join(raiz, 'ENLACE-ACTUAL.txt'),
    `PAUSAS ACTIVAS QR - ${fijo ? 'enlace fijo' : `QR del ${fecha}`} (generado a las ${hora})\r\n\r\n` +
      `Formulario para colaboradores (QR):\r\n${url}/pausas\r\n\r\n` +
      `Panel para administradores (desde cualquier PC):\r\n${url}/admin\r\n\r\n` +
      `Panel en este PC:\r\nhttp://localhost:${PUERTO}/admin\r\n\r\n${aviso}\r\n`,
  );

  try {
    const opciones = { width: 1024, margin: 2, errorCorrectionLevel: 'Q', color: { dark: '#0f172a', light: '#ffffff' } };
    await QRCode.toFile(path.join(raiz, 'QR-DEL-DIA.png'), `${url}/pausas`, opciones);
    const historico = path.join(raiz, 'data', 'qr-diarios');
    fs.mkdirSync(historico, { recursive: true });
    fs.copyFileSync(path.join(raiz, 'QR-DEL-DIA.png'), path.join(historico, `QR-${ahoraBogota.slice(0, 10)}_${ahoraBogota.slice(11, 16).replace(':', 'h')}.png`));
  } catch (e) {
    console.error(`  No se pudo guardar la imagen del QR: ${e.message}`);
  }
  console.log(`  LISTO. Formulario: ${url}/pausas   Panel: ${url}/admin   (${fijo ? 'enlace fijo' : 'QR del día'})`);
}

/** Si el QR vigente se generó antes de la hora de renovación de hoy, genera el QR del día. */
function revisarRenovacionDiaria(tunel) {
  const config = leerConfig(db);
  const [h, m] = (/^\d{2}:\d{2}$/.test(config.hora_renovacion_qr) ? config.hora_renovacion_qr : '05:30').split(':');
  const instante = new Date(`${hoyBogota()}T${h}:${m}:00-05:00`);
  const ultimo = new Date(config.qr_actualizado_en || 0);
  if (Date.now() >= instante.getTime() && ultimo < instante) {
    // Se marca de una vez para no repetir mientras el túnel nuevo se conecta.
    guardarValor(db, 'qr_actualizado_en', new Date().toISOString());
    tunel.reabrir(`Renovación diaria del QR (${config.hora_renovacion_qr})`);
  }
}

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  El sistema YA está encendido (el puerto ${PUERTO} está en uso).`);
    console.error(`  Abre http://localhost:${PUERTO}/admin. Para reiniciarlo usa DETENER-SISTEMA.bat y luego ACTIVAR-SISTEMA.bat.\n`);
    process.exit(1);
  }
  throw e;
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    db.close();
    process.exit(0);
  });
}
