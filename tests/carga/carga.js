// Prueba de carga: simula a muchos colaboradores registrando su pausa al mismo tiempo.
//
// Uso:
//   npm run carga -- --url http://localhost:3000 --token <token-del-qr> --total 1000 --segundos 120
//
// Importante:
//  - Ejecútala contra una base de datos de PRUEBA: crea registros ficticios (cédulas 9xxxxxxxxx).
//  - Desde un solo equipo todas las solicitudes salen de la misma IP; arranca el servidor con
//    LIMITE_REGISTROS_POR_MINUTO_IP=100000 para que el limitador no las bloquee.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/)),
);
const URL_BASE = (args.url ?? 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = args.token;
const TOTAL = Number(args.total ?? 1000);
const SEGUNDOS = Number(args.segundos ?? 120);

if (!TOKEN) {
  console.error('Falta --token. Cópialo del enlace de un QR: .../r/<token>');
  process.exit(1);
}

const catalogo = await fetch(`${URL_BASE}/api/public/punto/${TOKEN}`).then((r) => r.json());
if (!catalogo.empresa_sede?.length || !catalogo.cargos?.length) {
  console.error('El QR no es válido o faltan empresas/sedes/cargos activos.', catalogo.mensaje ?? '');
  process.exit(1);
}

const tiempos = [];
const estados = {};
const base = 9_000_000_000 + Math.floor(Math.random() * 900_000_000);
const intervalo = (SEGUNDOS * 1000) / TOTAL;
const inicio = performance.now();

async function registrar(i) {
  const v = catalogo.empresa_sede[i % catalogo.empresa_sede.length];
  const cuerpo = {
    token: TOKEN,
    nombre: `Prueba Carga ${String.fromCharCode(65 + (i % 26))}`,
    cedula: String(base + i),
    empresa_id: v.empresa_id,
    sede_id: v.sede_id,
    cargo_id: catalogo.cargos[i % catalogo.cargos.length].id,
    acepta: true,
  };
  const t0 = performance.now();
  try {
    const r = await fetch(`${URL_BASE}/api/public/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    await r.arrayBuffer();
    estados[r.status] = (estados[r.status] ?? 0) + 1;
  } catch {
    estados.red = (estados.red ?? 0) + 1;
  }
  tiempos.push(performance.now() - t0);
}

console.log(`Enviando ${TOTAL} registros en ${SEGUNDOS} s (≈ ${(TOTAL / SEGUNDOS).toFixed(1)}/s) a ${URL_BASE} …`);
const pendientes = [];
for (let i = 0; i < TOTAL; i++) {
  const espera = inicio + i * intervalo - performance.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  pendientes.push(registrar(i));
}
await Promise.all(pendientes);

tiempos.sort((a, b) => a - b);
const pct = (p) => tiempos[Math.min(tiempos.length - 1, Math.floor((p / 100) * tiempos.length))].toFixed(0);
const exitosos = estados[201] ?? 0;
const fallidos = TOTAL - exitosos;
console.log('\nResultado');
console.log(`  Duración total:   ${((performance.now() - inicio) / 1000).toFixed(1)} s`);
console.log(`  Exitosos (201):   ${exitosos}`);
console.log(`  Fallidos:         ${fallidos} ${fallidos ? JSON.stringify(estados) : ''}`);
console.log(`  Tiempo respuesta: p50 ${pct(50)} ms · p95 ${pct(95)} ms · p99 ${pct(99)} ms · máx ${tiempos.at(-1).toFixed(0)} ms`);
const ok = Number(pct(95)) < 800 && fallidos / TOTAL < 0.01;
console.log(`\n  Meta (p95 < 800 ms y < 1 % de errores): ${ok ? 'CUMPLE' : 'NO CUMPLE'}`);
process.exit(ok ? 0 : 1);
