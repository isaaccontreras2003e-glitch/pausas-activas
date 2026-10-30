// Carga datos de ejemplo para revisar el sistema: npm run demo
// Uso: npm run demo            → agrega catálogos y ~2 semanas de registros ficticios
//      npm run demo -- --solo-catalogos
import { RAIZ as raiz } from './entorno.js';
import path from 'node:path';
import { abrirDb, transaccion } from './db.js';
import { tokenCorto } from './util.js';

const db = abrirDb(process.env.DB_PATH || path.join(raiz, 'data', 'pausas.db'));
const soloCatalogos = process.argv.includes('--solo-catalogos');

if (db.prepare('SELECT 1 FROM registros_pausa LIMIT 1').get() && !soloCatalogos) {
  console.log('La base de datos ya tiene registros. No se cargaron datos de demostración.');
  process.exit(0);
}

const EMPRESAS = [
  ['Empresa Demo S.A.S.', '900123456-1'],
  ['Servicios Demo Ltda.', '901987654-2'],
];
const SEDES = [
  ['Sede Principal', 'Barranquilla', [0, 1]],
  ['Sede Norte', 'Barranquilla', [0]],
  ['Centro de Distribución', 'Soledad', [0, 1]],
  ['Sede Cartagena', 'Cartagena', [1]],
];
const CARGOS = [
  ['ADM-01', 'Auxiliar administrativo', 'Administrativo'],
  ['ADM-02', 'Auxiliar de facturación', 'Administrativo'],
  ['ADM-03', 'Analista contable', 'Administrativo'],
  ['ADM-04', 'Coordinador de talento humano', 'Administrativo'],
  ['ADM-05', 'Recepcionista', 'Administrativo'],
  ['COM-01', 'Asesor comercial', 'Comercial'],
  ['COM-02', 'Ejecutivo de cuenta', 'Comercial'],
  ['OPE-01', 'Operario de bodega', 'Operativo'],
  ['OPE-02', 'Auxiliar de logística', 'Operativo'],
  ['OPE-03', 'Conductor', 'Operativo'],
  ['OPE-04', 'Montacarguista', 'Operativo'],
  ['SST-01', 'Profesional SST', 'Seguridad y Salud'],
  ['TIC-01', 'Desarrollador de software', 'Tecnología'],
  ['TIC-02', 'Técnico de soporte', 'Tecnología'],
  ['GER-01', 'Gerente de sede', 'Dirección'],
];
const NOMBRES = ['María', 'José', 'Ana', 'Luis', 'Carmen', 'Carlos', 'Laura', 'Andrés', 'Paola', 'Jorge', 'Diana', 'Miguel', 'Sandra', 'Juan', 'Natalia', 'Pedro', 'Valentina', 'Camilo', 'Daniela', 'Óscar'];
const APELLIDOS = ['Pérez', 'Gómez', 'Rodríguez', 'Martínez', 'Herrera', 'Díaz', 'Castro', 'Ramírez', 'Torres', 'Vargas', 'Rojas', 'Moreno', 'Jiménez', 'Ortiz', 'Mendoza', 'Barrios', 'Polo', 'De La Hoz'];

let semilla = 7;
const azar = () => ((semilla = (semilla * 16807) % 2147483647) - 1) / 2147483646;
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];

transaccion(db, () => {
  const idEmpresa = EMPRESAS.map(([nombre, nit]) => {
    db.prepare('INSERT OR IGNORE INTO empresas (nombre, nit) VALUES (?, ?)').run(nombre, nit);
    return db.prepare('SELECT id FROM empresas WHERE nombre = ?').get(nombre).id;
  });
  const idSede = SEDES.map(([nombre, ciudad, empresas]) => {
    db.prepare('INSERT OR IGNORE INTO sedes (nombre, ciudad) VALUES (?, ?)').run(nombre, ciudad);
    const id = db.prepare('SELECT id FROM sedes WHERE nombre = ? AND ciudad = ?').get(nombre, ciudad).id;
    for (const e of empresas) db.prepare('INSERT OR IGNORE INTO empresa_sede (empresa_id, sede_id) VALUES (?, ?)').run(idEmpresa[e], id);
    return id;
  });
  const idCargo = CARGOS.map(([codigo, nombre, area]) => {
    db.prepare('INSERT OR IGNORE INTO cargos (codigo, nombre, area) VALUES (?, ?, ?)').run(codigo, nombre, area);
    return db.prepare('SELECT id FROM cargos WHERE nombre = ?').get(nombre).id;
  });

  const puntos = [
    [idSede[0], 'Piso 1 – Recepción'],
    [idSede[0], 'Piso 3 – Cafetería'],
    [idSede[1], 'Sala de descanso'],
    [idSede[2], 'Bodega – Zona de cargue'],
    [idSede[3], 'Oficina principal'],
  ];
  // El QR principal (fijo) lo crea abrirDb; aquí solo se agregan QR opcionales por lugar.
  if (!db.prepare("SELECT 1 FROM puntos_qr WHERE token <> 'principal' LIMIT 1").get()) {
    for (const [sede, desc] of puntos) db.prepare('INSERT INTO puntos_qr (token, sede_id, descripcion) VALUES (?, ?, ?)').run(tokenCorto(), sede, desc);
  }
  console.log(`Catálogos listos: ${EMPRESAS.length} empresas, ${SEDES.length} sedes, ${CARGOS.length} cargos, QR principal + ${puntos.length} QR por lugar.`);
  if (soloCatalogos) return;

  const vinculos = db.prepare('SELECT empresa_id, sede_id FROM empresa_sede').all();
  const puntosBd = db.prepare('SELECT id, sede_id FROM puntos_qr').all();
  const personas = Array.from({ length: 90 }, (_, i) => {
    const v = elegir(vinculos);
    const nombre = `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
    const cedula = String(1_000_000_000 + Math.floor(azar() * 99_000_000) + i);
    const { id } = db
      .prepare('INSERT INTO colaboradores (cedula, nombre_completo) VALUES (?, ?) ON CONFLICT (cedula) DO UPDATE SET nombre_completo = excluded.nombre_completo RETURNING id')
      .get(cedula, nombre);
    // Distribuye cargos de forma desigual: hay más operativos y auxiliares que gerentes.
    const cargo = idCargo[Math.min(Math.floor(azar() ** 1.6 * idCargo.length), idCargo.length - 1)];
    return { id, nombre, cedula, empresa: v.empresa_id, sede: v.sede_id, cargo, constancia: 0.35 + azar() * 0.6 };
  });

  const insertar = db.prepare(
    `INSERT INTO registros_pausa (colaborador_id, empresa_id, sede_id, cargo_id, punto_qr_id, nombre_snapshot, cedula_snapshot, registrado_en, user_agent,
                                  realizo_pausa, hora_pausa, motivo_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?)`,
  );
  const MOTIVOS = ['Carga laboral / no tuve tiempo', 'Estaba en reunión o fuera de mi puesto', 'No me enteré de la pausa', null];
  const ahora = Date.now();
  let total = 0;
  for (let dia = 20; dia >= 0; dia--) {
    const base = new Date(ahora - dia * 86_400_000);
    const fecha = new Date(base.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
    const diaSemana = new Date(`${fecha}T12:00:00-05:00`).getUTCDay();
    if (diaSemana === 0 || diaSemana === 6) continue;
    for (const horaPausa of [10, 15]) {
      for (const p of personas) {
        if (azar() > p.constancia) continue;
        const minuto = Math.floor(azar() * 25);
        const iso = new Date(`${fecha}T${String(horaPausa).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:${String(Math.floor(azar() * 60)).padStart(2, '0')}-05:00`);
        if (iso.getTime() > ahora) continue;
        const candidatos = puntosBd.filter((x) => x.sede_id === p.sede);
        const punto = candidatos.length && azar() > 0.4 ? elegir(candidatos).id : puntosBd.find((x) => x.sede_id === null)?.id;
        // ~12 % responde que no la hizo; quien la hizo declara una hora unos minutos antes de enviar.
        const realizo = azar() > 0.12;
        const hora = new Date(iso.getTime() - 5 * 3_600_000 - Math.floor(azar() * 8) * 60_000).toISOString().slice(11, 16);
        insertar.run(p.id, p.empresa, p.sede, p.cargo, punto ?? null, p.nombre, p.cedula, iso.toISOString(), realizo ? 1 : 0, realizo ? hora : null, realizo ? null : elegir(MOTIVOS));
        total++;
      }
    }
  }
  console.log(`Se crearon ${personas.length} colaboradores y ${total} respuestas de ejemplo.`);
});

db.close();
