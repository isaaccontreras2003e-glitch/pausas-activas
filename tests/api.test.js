import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { crearApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { abrirDb } from '../server/db.js';

let servidor;
let base;
let db;
let cookie;
let token;
const ids = {};

async function api(ruta, { method = 'GET', body, conCookie = true } = {}) {
  const res = await fetch(base + ruta, {
    method,
    headers: { 'Content-Type': 'application/json', ...(conCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const tipo = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, datos: tipo.includes('json') ? await res.json() : await res.arrayBuffer() };
}

const registro = (extra = {}) => ({
  token,
  nombre: '  maría   PÉREZ gómez ',
  cedula: '1045123456',
  empresa_id: ids.empresa,
  sede_id: ids.sede,
  cargo_id: ids.cargo,
  acepta: true,
  realizo_pausa: true,
  hora_pausa: horaBogota(-5),
  ...extra,
});

/** 'HH:MM' de ahora en Bogotá, desplazado en minutos. */
function horaBogota(minutos = 0) {
  return new Date(Date.now() - 5 * 3_600_000 + minutos * 60_000).toISOString().slice(11, 16);
}

before(async () => {
  db = abrirDb(':memory:');
  db.prepare("INSERT INTO usuarios_admin (email, nombre, rol, password_hash) VALUES ('admin@test.co', 'Admin', 'admin', ?)").run(hashPassword('ClaveSegura1'));
  servidor = crearApp({ db, puerto: 0 }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  db.close();
});

describe('primer uso: crear cuenta de administrador', () => {
  test('sin usuarios pide crear la cuenta y la crea solo una vez', async () => {
    const dbVacia = abrirDb(':memory:');
    const srv = crearApp({ db: dbVacia, puerto: 0 }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    const url = `http://127.0.0.1:${srv.address().port}`;
    const post = (body) =>
      fetch(`${url}/api/auth/crear-cuenta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const estado = await fetch(`${url}/api/auth/estado`).then((r) => r.json());
      assert.equal(estado.requiere_cuenta, true);
      const corta = await post({ nombre: 'Ana', email: 'ana@imes.co', password: '123', organizacion: 'IMES' });
      assert.equal(corta.status, 422);
      const ok = await post({ nombre: 'Ana Pérez', email: 'Ana@IMES.co', password: 'ClaveSegura9', organizacion: 'Grupo IMES' });
      assert.equal(ok.status, 201);
      const cookieNueva = ok.headers.get('set-cookie').split(';')[0];
      const me = await fetch(`${url}/api/auth/me`, { headers: { Cookie: cookieNueva } }).then((r) => r.json());
      assert.equal(me.email, 'ana@imes.co');
      assert.equal(me.rol, 'admin');
      assert.equal(dbVacia.prepare("SELECT valor FROM configuracion WHERE clave = 'organizacion'").get().valor, 'Grupo IMES');
      // Desde el equipo servidor se pueden crear más administradores (sin cambiar la organización)...
      const segunda = await post({ nombre: 'Luis Gómez', email: 'luis@imes.co', password: 'ClaveSegura9', organizacion: 'Otra' });
      assert.equal(segunda.status, 201);
      assert.equal(dbVacia.prepare("SELECT valor FROM configuracion WHERE clave = 'organizacion'").get().valor, 'Grupo IMES');
      // ...pero no con un correo repetido.
      const repetida = await post({ nombre: 'Ana Otra', email: 'ana@imes.co', password: 'ClaveSegura9' });
      assert.equal(repetida.status, 409);
      // Desde otro equipo o el enlace público (proxy que reenvía la IP real) no se permite.
      const remota = await fetch(`${url}/api/auth/crear-cuenta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '181.50.10.20' },
        body: JSON.stringify({ nombre: 'Intruso Externo', email: 'x@x.co', password: 'ClaveSegura9' }),
      });
      assert.equal(remota.status, 403);
    } finally {
      srv.close();
      dbVacia.close();
    }
  });
});

describe('autenticación', () => {
  test('rechaza credenciales incorrectas', async () => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.co', password: 'mala' } });
    assert.equal(r.status, 401);
  });

  test('protege las rutas de administración', async () => {
    const r = await api('/api/admin/resumen', { conCookie: false });
    assert.equal(r.status, 401);
  });

  test('inicia sesión y devuelve el usuario', async () => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: 'ADMIN@test.co', password: 'ClaveSegura1' } });
    assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0];
    const me = await api('/api/auth/me');
    assert.equal(me.datos.rol, 'admin');
  });
});

describe('catálogos y puntos QR', () => {
  test('crea empresa, sede, cargo y punto', async () => {
    ids.empresa = (await api('/api/admin/empresas', { method: 'POST', body: { nombre: 'Empresa A', nit: '900' } })).datos.id;
    ids.otraEmpresa = (await api('/api/admin/empresas', { method: 'POST', body: { nombre: 'Empresa B' } })).datos.id;
    ids.sede = (await api('/api/admin/sedes', { method: 'POST', body: { nombre: 'Centro', ciudad: 'Barranquilla', empresa_ids: [ids.empresa] } })).datos.id;
    ids.cargo = (await api('/api/admin/cargos', { method: 'POST', body: { nombre: 'Auxiliar', codigo: 'A1' } })).datos.id;
    ids.punto = (await api('/api/admin/puntos', { method: 'POST', body: { descripcion: 'Cafetería', sede_id: ids.sede } })).datos.id;
    const cat = await api('/api/admin/catalogos');
    const punto = cat.datos.puntos.find((p) => p.id === ids.punto);
    token = punto.token;
    assert.match(token, /^[a-z2-9]{8}$/);
    assert.match(punto.url, new RegExp(`/r/${token}$`));
    assert.deepEqual(cat.datos.sedes[0].empresa_ids, [ids.empresa]);
  });

  test('existe un QR principal fijo con enlace corto que no se puede regenerar ni desactivar', async () => {
    const cat = await api('/api/admin/catalogos');
    const principal = cat.datos.puntos[0];
    assert.equal(principal.principal, true);
    assert.match(principal.url, /\/pausas$/);
    ids.principal = principal.id;
    assert.equal((await api(`/api/admin/puntos/${principal.id}/regenerar`, { method: 'POST' })).datos.codigo, 'QR_FIJO');
    assert.equal((await api(`/api/admin/puntos/${principal.id}`, { method: 'PUT', body: { activo: false } })).status, 409);
    assert.equal((await api(`/api/admin/puntos/${principal.id}`, { method: 'DELETE' })).status, 409);
    const publico = await api('/api/public/punto/principal', { conCookie: false });
    assert.equal(publico.status, 200);
    assert.equal(publico.datos.punto.sede_id, null);
  });

  test('no permite nombres de cargo duplicados', async () => {
    const r = await api('/api/admin/cargos', { method: 'POST', body: { nombre: 'auxiliar' } });
    assert.equal(r.status, 409);
  });

  test('genera el QR en PNG y SVG', async () => {
    const png = await api(`/api/admin/puntos/${ids.punto}/qr.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    const svg = await api(`/api/admin/puntos/${ids.punto}/qr.svg`);
    assert.match(Buffer.from(svg.datos).toString(), /<svg/);
  });

  test('el kit de envío incluye el enlace dentro del mensaje', async () => {
    const r = await api(`/api/admin/puntos/${ids.punto}/kit`);
    assert.ok(r.datos.mensaje.includes(r.datos.url));
  });

  test('importa cargos desde CSV con vista previa y aplicación', async () => {
    const csv = 'codigo;nombre;area\nA1;Auxiliar;Admin\nB2;Operario de bodega;Operativo\n;;\nC3;;X\n';
    const body = { nombre_archivo: 'cargos.csv', archivo_base64: Buffer.from(csv).toString('base64') };
    const vista = await api('/api/admin/cargos/importar', { method: 'POST', body });
    assert.equal(vista.datos.nuevos.length, 1);
    assert.equal(vista.datos.actualizados.length, 1);
    assert.equal(vista.datos.errores.length, 1);
    await api('/api/admin/cargos/importar', { method: 'POST', body: { ...body, aplicar: true } });
    const cat = await api('/api/admin/catalogos');
    assert.equal(cat.datos.cargos.length, 2);
  });
});

describe('formulario público', () => {
  test('entrega catálogos activos y la sede del QR', async () => {
    const r = await api(`/api/public/punto/${token}`, { conCookie: false });
    assert.equal(r.status, 200);
    assert.equal(r.datos.punto.sede_id, ids.sede);
    assert.equal(r.datos.cargos.length, 2);
    assert.ok(r.datos.config.texto_tratamiento_datos.length > 20);
  });

  test('QR inexistente devuelve 404', async () => {
    const r = await api('/api/public/punto/noexiste', { conCookie: false });
    assert.equal(r.datos.codigo, 'QR_INVALIDO');
  });

  test('valida los campos', async () => {
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ nombre: 'Ana', cedula: '12.345', acepta: false }) });
    assert.equal(r.status, 422);
    assert.ok(r.datos.detalles.nombre && r.datos.detalles.cedula && r.datos.detalles.acepta);
  });

  test('rechaza una sede que no pertenece a la empresa', async () => {
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ empresa_id: ids.otraEmpresa }) });
    assert.equal(r.datos.codigo, 'SEDE_EMPRESA_INVALIDA');
  });

  test('exige indicar si realizó la pausa y, si la hizo, la hora', async () => {
    const sinRespuesta = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ realizo_pausa: undefined }) });
    assert.ok(sinRespuesta.datos.detalles.realizo_pausa);
    const sinHora = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ hora_pausa: '' }) });
    assert.ok(sinHora.datos.detalles.hora_pausa);
    const futura = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ hora_pausa: horaBogota(60) }) });
    // Cerca de medianoche la hora "futura" da la vuelta al día anterior y es válida; solo se verifica el resto del día.
    if (horaBogota(60) > horaBogota()) assert.ok(futura.datos.detalles.hora_pausa);
  });

  test('registra y normaliza el nombre', async () => {
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro() });
    assert.equal(r.status, 201);
    assert.equal(r.datos.nombre, 'María Pérez Gómez');
    assert.equal(r.datos.sede, 'Centro');
    assert.equal(r.datos.realizo_pausa, true);
    assert.equal(r.datos.hora_pausa, horaBogota(-5));
  });

  test('registra que NO realizó la pausa, con motivo y sin hora', async () => {
    const r = await api('/api/public/registro', {
      method: 'POST',
      conCookie: false,
      body: registro({ cedula: '44444444', nombre: 'Ana Ruiz', realizo_pausa: false, hora_pausa: '10:00', motivo_no: 'Carga laboral' }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.datos.realizo_pausa, false);
    assert.equal(r.datos.hora_pausa, null);
  });

  test('bloquea el registro repetido dentro de la ventana', async () => {
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro() });
    assert.equal(r.status, 409);
    assert.equal(r.datos.codigo, 'YA_REGISTRADO');
  });

  test('solo acepta cargos de la empresa elegida', async () => {
    const { datos } = await api('/api/admin/cargos', { method: 'POST', body: { nombre: 'Cargo solo de B', empresa_ids: [ids.otraEmpresa] } });
    await api(`/api/admin/cargos/${ids.cargo}`, { method: 'PUT', body: { empresa_ids: [ids.empresa] } });
    const publico = await api(`/api/public/punto/${token}`, { conCookie: false });
    assert.ok(publico.datos.empresa_cargo.some((v) => v.empresa_id === ids.otraEmpresa && v.cargo_id === datos.id));
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ cedula: '55555555', cargo_id: datos.id }) });
    assert.equal(r.datos.codigo, 'CARGO_INVALIDO');
    const cat = await api('/api/admin/catalogos');
    assert.deepEqual(cat.datos.cargos.find((c) => c.id === ids.cargo).empresa_ids, [ids.empresa]);
  });

  test('un cargo desactivado ya no se acepta', async () => {
    await api(`/api/admin/cargos/${ids.cargo}`, { method: 'PUT', body: { activo: false } });
    const r = await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ cedula: '22222222' }) });
    assert.equal(r.datos.codigo, 'CARGO_INVALIDO');
    await api(`/api/admin/cargos/${ids.cargo}`, { method: 'PUT', body: { activo: true } });
  });
});

describe('reportes', () => {
  test('el resumen consolida por sede, cargo, empresa y punto', async () => {
    await api('/api/public/registro', { method: 'POST', conCookie: false, body: registro({ cedula: '33333333', nombre: 'Luis Díaz' }) });
    const r = await api('/api/admin/resumen');
    assert.equal(r.datos.kpis.registros, 3);
    assert.equal(r.datos.kpis.si, 2);
    assert.equal(r.datos.kpis.no, 1);
    assert.equal(r.datos.kpis.personas, 2);
    assert.equal(r.datos.por_sede[0].si, 2);
    assert.equal(r.datos.por_sede[0].no, 1);
    assert.equal(r.datos.por_punto.find((p) => p.id === ids.punto).registros, 3);
    assert.equal(r.datos.granularidad, 'hora');
    assert.equal(r.datos.serie.length, 24);
    // La serie cuenta solo las pausas realizadas.
    assert.equal(r.datos.serie.reduce((s, x) => s + x.registros, 0), 2);
    const soloNo = await api('/api/admin/registros?realizo=no');
    assert.equal(soloNo.datos.total, 1);
    assert.equal(soloNo.datos.filas[0].motivo_no, 'Carga laboral');
  });

  test('filtra por texto y pagina', async () => {
    const r = await api('/api/admin/registros?q=luis');
    assert.equal(r.datos.total, 1);
  });

  test('exporta CSV con BOM y separador punto y coma', async () => {
    const r = await api('/api/admin/exportar?formato=csv');
    const texto = Buffer.from(r.datos).toString('utf8');
    assert.ok(texto.startsWith('﻿Fecha;Nombre completo;Cédula;Empresa;Sede;Cargo;¿Realizó la pausa activa?;Hora de la pausa'));
    assert.equal(texto.trim().split('\r\n').length, 4);
    assert.match(texto, /;No;;Carga laboral;/);
  });

  test('exporta XLSX consolidado', async () => {
    const r = await api('/api/admin/exportar?formato=xlsx&tipo=consolidado');
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(r.datos).subarray(0, 2).toString(), 'PK');
  });

  test('el rol consulta ve la cédula enmascarada', async () => {
    await api('/api/admin/usuarios', { method: 'POST', body: { email: 'ver@test.co', nombre: 'Lector', rol: 'consulta', password: 'ClaveSegura2' } });
    const login = await api('/api/auth/login', { method: 'POST', conCookie: false, body: { email: 'ver@test.co', password: 'ClaveSegura2' } });
    const cookieConsulta = login.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${base}/api/admin/registros`, { headers: { Cookie: cookieConsulta } });
    const datos = await res.json();
    assert.match(datos.filas[0].cedula, /\*/);
    const crear = await fetch(`${base}/api/admin/cargos`, {
      method: 'POST',
      headers: { Cookie: cookieConsulta, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'X' }),
    });
    assert.equal(crear.status, 403);
  });

  test('el CSV neutraliza textos que Excel ejecutaría como fórmula', async () => {
    await api('/api/public/registro', {
      method: 'POST',
      conCookie: false,
      body: registro({ cedula: '66666666', nombre: 'Eva Mora', realizo_pausa: false, hora_pausa: null, motivo_no: '=HYPERLINK("http://malo")' }),
    });
    const texto = Buffer.from((await api('/api/admin/exportar?formato=csv')).datos).toString('utf8');
    assert.ok(texto.includes(`'=HYPERLINK`));
    assert.ok(!/;=HYPERLINK/.test(texto));
  });

  test('no se puede borrar una sede con registros', async () => {
    const r = await api(`/api/admin/sedes/${ids.sede}`, { method: 'DELETE' });
    assert.equal(r.status, 409);
  });
});

describe('seguridad', () => {
  test('envía cabeceras de seguridad (CSP, anti-clickjacking, no-store en la API)', async () => {
    const r = await fetch(`${base}/api/salud`);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('rechaza cambios enviados desde otro sitio web (CSRF)', async () => {
    const r = await fetch(`${base}/api/admin/empresas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://sitio-malicioso.com' },
      body: JSON.stringify({ nombre: 'Hackeo' }),
    });
    assert.equal(r.status, 403);
    const mismo = await fetch(`${base}/api/admin/empresas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base },
      body: JSON.stringify({ nombre: 'Empresa Legítima' }),
    });
    assert.equal(mismo.status, 201);
  });

  test('la base de datos no guarda el valor real de la cookie de sesión', () => {
    const valor = cookie.split('=')[1];
    assert.equal(db.prepare('SELECT 1 FROM sesiones WHERE token = ?').get(valor), undefined);
  });

  test('exige contraseñas fuertes', async () => {
    const r = await api('/api/admin/usuarios', { method: 'POST', body: { email: 'debil@test.co', nombre: 'Débil', rol: 'sst', password: 'abcdefghij' } });
    assert.equal(r.status, 422);
  });

  test('registra las acciones en la auditoría', async () => {
    const r = await api('/api/admin/auditoria');
    const acciones = r.datos.map((a) => a.accion);
    assert.ok(acciones.includes('Inicio de sesión'));
    assert.ok(acciones.includes('Inicio de sesión fallido'));
    assert.ok(acciones.includes('Creó empresa'));
    assert.ok(!JSON.stringify(r.datos).includes('ClaveSegura'));
  });

  test('bloquea una cuenta tras 5 contraseñas incorrectas', async () => {
    await api('/api/admin/usuarios', { method: 'POST', body: { email: 'victima@test.co', nombre: 'Víctima', rol: 'sst', password: 'ClaveSegura77' } });
    const intento = (password) =>
      fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'victima@test.co', password }) });
    for (let i = 0; i < 5; i++) assert.equal((await intento('incorrecta1')).status, 401);
    // Ni con la contraseña correcta entra mientras dure el bloqueo.
    assert.equal((await intento('ClaveSegura77')).status, 429);
  });
});
