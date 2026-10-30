import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  cookieSesion,
  crearSesion,
  hashPassword,
  requiereSesion,
  usuarioDeSesion,
  validarPassword,
  verificarPassword,
  verificarPasswordDeUsuario,
} from './auth.js';
import { descifrar } from './cifrado.js';
import { CONFIG_POR_DEFECTO, TOKEN_PRINCIPAL, leerConfig, transaccion } from './db.js';
import { importarBase } from './importar-base.js';
import { importarCargos, plantillaCargos } from './importar-cargos.js';
import { esUrlLocal, urlBaseDetectada, urlBasePublica } from './red.js';
import { construirFiltro, exportarCsv, exportarXlsx, listarRegistros, resumen } from './reportes.js';
import { auditar, crearBloqueoCuentas } from './seguridad.js';
import { ErrorApp, entero, hoyBogota, limitador, textoOpcional, textoRequerido, tokenCorto } from './util.js';

const GESTION = ['admin', 'sst'];
const ROLES = ['admin', 'sst', 'consulta'];

export function rutasAuth({ db }) {
  const r = Router();
  const limiteLogin = limitador({ ventanaMs: 15 * 60_000, maximo: 20, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
  const bloqueo = crearBloqueoCuentas(db);

  r.post('/login', limiteLogin, async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 150);
    await bloqueo.verificar(email);
    const usuario = await db.prepare('SELECT * FROM usuarios_admin WHERE email = ? AND activo = 1').get(email);
    if (!verificarPasswordDeUsuario(usuario, String(req.body?.password ?? '').slice(0, 200))) {
      const bloqueada = await bloqueo.fallo(email);
      await auditar(db, req, 'Inicio de sesión fallido', `${email}${bloqueada ? ' (cuenta bloqueada 15 min)' : ''}`);
      throw new ErrorApp(401, 'CREDENCIALES', 'Correo o contraseña incorrectos.');
    }
    await bloqueo.exito(email);
    res.setHeader('Set-Cookie', cookieSesion(req, await crearSesion(db, usuario.id)));
    await auditar(db, { ip: req.ip, usuario }, 'Inicio de sesión');
    res.json({ ok: true });
  });

  // ───────── Primera cuenta de administrador (sistema recién instalado o reiniciado) ─────────
  const hayUsuarios = async () => !!(await db.prepare('SELECT 1 AS ok FROM usuarios_admin LIMIT 1').get());
  const esEsteEquipo = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);

  // En la nube nadie está "frente al servidor": la primera configuración exige la clave CLAVE_CONFIGURACION,
  // que solo ve el dueño en el panel del servicio en la nube. Sin esa clave nadie puede adueñarse del sistema.
  const claveConfiguracionValida = (valor) => {
    const esperada = process.env.CLAVE_CONFIGURACION ?? '';
    if (esperada.length < 16 || !valor) return false;
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(h(valor), h(esperada));
  };

  r.get('/estado', async (req, res) => {
    res.json({
      requiere_cuenta: !(await hayUsuarios()),
      es_este_equipo: esEsteEquipo(req),
      permite_clave: (process.env.CLAVE_CONFIGURACION ?? '').length >= 16,
    });
  });

  // Crear cuenta de administrador: desde el equipo servidor, o la primera cuenta con la clave de configuración.
  // Desde el enlace público cualquiera podría hacerse administrador; ahí las cuentas las crea un administrador en Usuarios.
  r.post('/crear-cuenta', limiteLogin, async (req, res) => {
    const primera = !(await hayUsuarios());
    const b = req.body ?? {};
    if (!esEsteEquipo(req) && !(primera && claveConfiguracionValida(b.clave_configuracion))) {
      throw new ErrorApp(
        403,
        'SOLO_ESTE_EQUIPO',
        primera
          ? 'Para crear la primera cuenta se necesita la clave de configuración (variable CLAVE_CONFIGURACION del servidor).'
          : 'Las cuentas nuevas las crea un administrador en el panel (Usuarios).',
      );
    }
    const email = textoRequerido(b.email, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorApp(422, 'VALIDACION', 'Correo inválido.', { email: 'Escribe un correo válido.' });
    if (await db.prepare('SELECT 1 AS ok FROM usuarios_admin WHERE email = ?').get(email)) {
      throw new ErrorApp(409, 'CORREO_EXISTE', 'Ya existe una cuenta con ese correo. Ingresa con ella.', { email: 'Ya existe una cuenta con este correo.' });
    }
    const nombre = textoRequerido(b.nombre, 'nombre');
    const password = validarPassword(b.password);
    const organizacion = primera ? textoRequerido(b.organizacion, 'organizacion', 120) : null;
    const id = await transaccion(db, async (tx) => {
      if (organizacion) await tx.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'organizacion'").run(organizacion);
      const fila = await tx
        .prepare("INSERT INTO usuarios_admin (email, nombre, rol, password_hash) VALUES (?, ?, 'admin', ?) RETURNING id")
        .get(email, nombre, hashPassword(password));
      return fila.id;
    });
    res.setHeader('Set-Cookie', cookieSesion(req, await crearSesion(db, id)));
    await auditar(db, { ip: req.ip, usuario: { id, email } }, primera ? 'Creó la primera cuenta de administrador' : 'Creó cuenta de administrador (desde el equipo servidor)', email);
    res.status(201).json({ ok: true });
  });

  // Importar los datos del PC anterior (archivo .cifrado de EXPORTAR-DATOS.bat) en un sistema recién instalado.
  r.post('/importar-datos', limiteLogin, async (req, res) => {
    if (await hayUsuarios()) throw new ErrorApp(409, 'YA_CONFIGURADO', 'Este sistema ya tiene datos y cuentas. La importación solo se permite en un sistema nuevo.');
    const b = req.body ?? {};
    if (!esEsteEquipo(req) && !claveConfiguracionValida(b.clave_configuracion)) {
      throw new ErrorApp(403, 'CLAVE_INVALIDA', 'La clave de configuración no es correcta.', { clave_configuracion: 'Clave incorrecta.' });
    }
    let datos;
    try {
      datos = descifrar(Buffer.from(String(b.archivo_base64 ?? ''), 'base64'), String(b.password ?? ''));
    } catch (e) {
      throw new ErrorApp(422, 'PAQUETE_INVALIDO', e.message, { password: e.message });
    }
    const resultado = await importarBase(db, datos);
    console.log(`  Datos importados desde otro equipo: ${resultado.registros} registros, ${resultado.usuarios} cuentas.`);
    res.json({ ok: true, ...resultado });
  });

  r.post('/logout', async (req, res) => {
    const usuario = await usuarioDeSesion(db, req);
    if (usuario) {
      await db.prepare('DELETE FROM sesiones WHERE token = ?').run(usuario.token);
      await auditar(db, { ip: req.ip, usuario }, 'Cierre de sesión');
    }
    res.setHeader('Set-Cookie', cookieSesion(req, '', 0));
    res.json({ ok: true });
  });

  r.get('/me', requiereSesion(db), (req, res) => {
    const { token, ...usuario } = req.usuario;
    res.json(usuario);
  });

  r.put('/password', requiereSesion(db), async (req, res) => {
    const { password_hash } = await db.prepare('SELECT password_hash FROM usuarios_admin WHERE id = ?').get(req.usuario.id);
    if (!verificarPassword(req.body?.actual ?? '', password_hash)) {
      throw new ErrorApp(422, 'VALIDACION', 'La contraseña actual no es correcta.', { actual: 'Contraseña incorrecta.' });
    }
    const nueva = validarPassword(req.body?.nueva);
    await db.prepare('UPDATE usuarios_admin SET password_hash = ? WHERE id = ?').run(hashPassword(nueva), req.usuario.id);
    await db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?').run(req.usuario.id, req.usuario.token);
    await auditar(db, req, 'Cambió su contraseña');
    res.json({ ok: true });
  });

  return r;
}

export function rutasAdmin({ db, canal, puerto }) {
  const r = Router();
  r.use(requiereSesion(db));

  // Toda acción que cambia datos queda en la auditoría (nunca se guardan contraseñas).
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const b = req.body ?? {};
      const objeto = b.nombre ?? b.descripcion ?? b.email ?? b.nombre_archivo ?? '';
      const extra = b.activo === false ? ' (desactivado)' : b.activo === true ? ' (activado)' : b.password ? ' (con cambio de contraseña)' : '';
      auditar(db, req, describirAccion(req.method, req.path), `${objeto}${extra}`);
    });
    next();
  });

  r.get('/auditoria', requiereSesion(db, ['admin']), async (req, res) => {
    res.json(await db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 1000').all());
  });

  const gestion = requiereSesion(db, GESTION);
  const soloAdmin = requiereSesion(db, ['admin']);
  const urlDePunto = (base, token) => `${base}${token === TOKEN_PRINCIPAL ? '/pausas' : `/r/${token}`}`;
  const urlPunto = async (token) => urlDePunto(await urlBasePublica(db, puerto), token);
  const noEsPrincipal = (punto) => {
    if (punto.token === TOKEN_PRINCIPAL) {
      throw new ErrorApp(409, 'QR_FIJO', 'El QR principal es fijo: no se puede regenerar, desactivar ni eliminar, para que los afiches y mensajes enviados sigan funcionando.');
    }
    return punto;
  };

  // ───────── Dashboard y reportes ─────────
  r.get('/resumen', async (req, res) => {
    res.json(await resumen(db, construirFiltro(req.query, req.usuario), req.usuario));
  });

  r.get('/registros', async (req, res) => {
    const filtro = construirFiltro(req.query, req.usuario);
    res.json(await listarRegistros(db, filtro, req.usuario, { pagina: req.query.pagina, tamano: req.query.tamano }));
  });

  r.get('/exportar', async (req, res) => {
    const filtro = construirFiltro(req.query, req.usuario);
    const tipo = req.query.tipo === 'consolidado' ? 'consolidado' : 'detallado';
    const nombre = `pausas-activas_${tipo}_${filtro.desdeLocal.slice(0, 10)}_a_${filtro.hastaLocal.slice(0, 10)}`;
    await auditar(db, req, 'Exportó reporte', `${tipo} ${req.query.formato === 'csv' ? 'CSV' : 'Excel'} · ${filtro.desdeLocal} a ${filtro.hastaLocal}`);
    if (req.query.formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
      return res.send(await exportarCsv(db, filtro, req.usuario, tipo));
    }
    const buffer = await exportarXlsx(db, filtro, req.usuario, tipo, (await leerConfig(db)).organizacion);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(buffer);
  });

  r.get('/stream', (req, res) => canal.suscribir(req, res));

  // ───────── Catálogos (incluye inactivos, para gestión y filtros) ─────────
  r.get('/catalogos', async (req, res) => {
    const [vinculos, vinculosCargo, empresas, sedes, cargos, puntos, base] = await Promise.all([
      db.prepare('SELECT empresa_id, sede_id FROM empresa_sede').all(),
      db.prepare('SELECT empresa_id, cargo_id FROM empresa_cargo').all(),
      db.prepare('SELECT e.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.empresa_id = e.id) AS registros FROM empresas e ORDER BY e.nombre').all(),
      db.prepare('SELECT s.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.sede_id = s.id) AS registros FROM sedes s ORDER BY s.nombre, s.ciudad').all(),
      db.prepare('SELECT c.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.cargo_id = c.id) AS registros FROM cargos c ORDER BY c.nombre').all(),
      db
        .prepare(
          `SELECT p.*, s.nombre AS sede_nombre,
                  (SELECT COUNT(*) FROM registros_pausa r WHERE r.punto_qr_id = p.id) AS registros,
                  (SELECT MAX(registrado_en) FROM registros_pausa r WHERE r.punto_qr_id = p.id) AS ultimo_registro
             FROM puntos_qr p LEFT JOIN sedes s ON s.id = p.sede_id
            ORDER BY p.token = '${TOKEN_PRINCIPAL}' DESC, p.activo DESC, s.nombre, p.descripcion`,
        )
        .all(),
      urlBasePublica(db, puerto),
    ]);
    const empresasDeSede = (id) => vinculos.filter((v) => v.sede_id === id).map((v) => v.empresa_id);
    const empresasPorCargo = new Map();
    for (const v of vinculosCargo) empresasPorCargo.set(v.cargo_id, [...(empresasPorCargo.get(v.cargo_id) ?? []), v.empresa_id]);
    res.json({
      empresas,
      sedes: sedes.map((s) => ({ ...s, empresa_ids: empresasDeSede(s.id) })),
      cargos: cargos.map((c) => ({ ...c, empresa_ids: empresasPorCargo.get(c.id) ?? [] })),
      puntos: puntos.map((p) => ({ ...p, principal: p.token === TOKEN_PRINCIPAL, url: urlDePunto(base, p.token) })),
    });
  });

  // Empresas
  r.post('/empresas', gestion, async (req, res) => {
    const nombre = textoRequerido(req.body?.nombre, 'nombre');
    const { id } = await db.prepare('INSERT INTO empresas (nombre, nit) VALUES (?, ?) RETURNING id').get(nombre, textoOpcional(req.body?.nit, 20));
    res.status(201).json({ id });
  });
  r.put('/empresas/:id', gestion, async (req, res) => {
    const actual = await buscar(db, 'empresas', req.params.id);
    const b = req.body ?? {};
    await db.prepare('UPDATE empresas SET nombre = ?, nit = ?, activo = ? WHERE id = ?').run(
      b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre') : actual.nombre,
      b.nit !== undefined ? textoOpcional(b.nit, 20) : actual.nit,
      b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
      actual.id,
    );
    res.json({ ok: true });
  });
  r.delete('/empresas/:id', gestion, async (req, res) => borrar(db, 'empresas', req.params.id, res));

  // Sedes (con las empresas que operan en ellas)
  const guardarVinculos = async (tx, sedeId, empresaIds) => {
    if (!Array.isArray(empresaIds)) return;
    await tx.prepare('DELETE FROM empresa_sede WHERE sede_id = ?').run(sedeId);
    for (const e of empresaIds.map(entero).filter(Boolean)) {
      await tx.prepare('INSERT OR IGNORE INTO empresa_sede (empresa_id, sede_id) VALUES (?, ?)').run(e, sedeId);
    }
  };
  r.post('/sedes', gestion, async (req, res) => {
    const b = req.body ?? {};
    if (!Array.isArray(b.empresa_ids) || !b.empresa_ids.length) {
      throw new ErrorApp(422, 'VALIDACION', 'Selecciona al menos una empresa que opere en esta sede.', { empresa_ids: 'Obligatorio.' });
    }
    const id = await transaccion(db, async (tx) => {
      const { id } = await tx
        .prepare('INSERT INTO sedes (nombre, ciudad, direccion) VALUES (?, ?, ?) RETURNING id')
        .get(textoRequerido(b.nombre, 'nombre', 120), textoOpcional(b.ciudad, 80) ?? '', textoOpcional(b.direccion));
      await guardarVinculos(tx, id, b.empresa_ids);
      return id;
    });
    res.status(201).json({ id });
  });
  r.put('/sedes/:id', gestion, async (req, res) => {
    const actual = await buscar(db, 'sedes', req.params.id);
    const b = req.body ?? {};
    if (Array.isArray(b.empresa_ids) && !b.empresa_ids.length) {
      throw new ErrorApp(422, 'VALIDACION', 'Selecciona al menos una empresa que opere en esta sede.', { empresa_ids: 'Obligatorio.' });
    }
    await transaccion(db, async (tx) => {
      await tx.prepare('UPDATE sedes SET nombre = ?, ciudad = ?, direccion = ?, activo = ? WHERE id = ?').run(
        b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre', 120) : actual.nombre,
        b.ciudad !== undefined ? (textoOpcional(b.ciudad, 80) ?? '') : actual.ciudad,
        b.direccion !== undefined ? textoOpcional(b.direccion) : actual.direccion,
        b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
        actual.id,
      );
      await guardarVinculos(tx, actual.id, b.empresa_ids);
    });
    res.json({ ok: true });
  });
  r.delete('/sedes/:id', gestion, async (req, res) => borrar(db, 'sedes', req.params.id, res));

  // Cargos
  const guardarEmpresasCargo = async (tx, cargoId, empresaIds) => {
    if (!Array.isArray(empresaIds)) return;
    await tx.prepare('DELETE FROM empresa_cargo WHERE cargo_id = ?').run(cargoId);
    for (const e of empresaIds.map(entero).filter(Boolean)) {
      await tx.prepare('INSERT OR IGNORE INTO empresa_cargo (empresa_id, cargo_id) VALUES (?, ?)').run(e, cargoId);
    }
  };
  r.post('/cargos', gestion, async (req, res) => {
    const b = req.body ?? {};
    const id = await transaccion(db, async (tx) => {
      const { id } = await tx
        .prepare('INSERT INTO cargos (nombre, codigo, area) VALUES (?, ?, ?) RETURNING id')
        .get(textoRequerido(b.nombre, 'nombre', 120), textoOpcional(b.codigo, 30), textoOpcional(b.area, 80));
      await guardarEmpresasCargo(tx, id, b.empresa_ids);
      return id;
    });
    res.status(201).json({ id });
  });
  r.put('/cargos/:id', gestion, async (req, res) => {
    const actual = await buscar(db, 'cargos', req.params.id);
    const b = req.body ?? {};
    await transaccion(db, async (tx) => {
      await tx.prepare('UPDATE cargos SET nombre = ?, codigo = ?, area = ?, activo = ? WHERE id = ?').run(
        b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre', 120) : actual.nombre,
        b.codigo !== undefined ? textoOpcional(b.codigo, 30) : actual.codigo,
        b.area !== undefined ? textoOpcional(b.area, 80) : actual.area,
        b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
        actual.id,
      );
      await guardarEmpresasCargo(tx, actual.id, b.empresa_ids);
    });
    res.json({ ok: true });
  });
  r.delete('/cargos/:id', gestion, async (req, res) => borrar(db, 'cargos', req.params.id, res));
  r.post('/cargos/importar', gestion, async (req, res) => res.json(await importarCargos(db, req.body ?? {})));
  r.get('/cargos/plantilla', async (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-cargos.xlsx"');
    res.send(await plantillaCargos());
  });

  // Puntos QR
  const validarSedePunto = async (valor) => {
    const sedeId = entero(valor);
    if (sedeId) await buscar(db, 'sedes', sedeId);
    return sedeId;
  };
  r.post('/puntos', gestion, async (req, res) => {
    const b = req.body ?? {};
    const sedeId = await validarSedePunto(b.sede_id);
    const { id } = await db
      .prepare('INSERT INTO puntos_qr (token, sede_id, descripcion) VALUES (?, ?, ?) RETURNING id')
      .get(tokenCorto(), sedeId, textoRequerido(b.descripcion, 'descripcion', 120));
    res.status(201).json({ id });
  });
  r.put('/puntos/:id', gestion, async (req, res) => {
    const actual = await buscar(db, 'puntos_qr', req.params.id);
    const b = req.body ?? {};
    if (b.activo === false) noEsPrincipal(actual);
    await db.prepare('UPDATE puntos_qr SET descripcion = ?, sede_id = ?, activo = ? WHERE id = ?').run(
      b.descripcion !== undefined ? textoRequerido(b.descripcion, 'descripcion', 120) : actual.descripcion,
      b.sede_id !== undefined ? await validarSedePunto(b.sede_id) : actual.sede_id,
      b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
      actual.id,
    );
    res.json({ ok: true });
  });
  r.post('/puntos/:id/regenerar', gestion, async (req, res) => {
    const actual = noEsPrincipal(await buscar(db, 'puntos_qr', req.params.id));
    const token = tokenCorto();
    await db.prepare('UPDATE puntos_qr SET token = ? WHERE id = ?').run(token, actual.id);
    res.json({ token, url: await urlPunto(token) });
  });
  r.delete('/puntos/:id', gestion, async (req, res) => {
    noEsPrincipal(await buscar(db, 'puntos_qr', req.params.id));
    await borrar(db, 'puntos_qr', req.params.id, res);
  });

  r.get('/puntos/:id/qr.:formato', async (req, res) => {
    const punto = await buscar(db, 'puntos_qr', req.params.id);
    const url = await urlPunto(punto.token);
    const opciones = { errorCorrectionLevel: 'Q', margin: 2, color: { dark: '#0f172a', light: '#ffffff' } };
    if (req.params.formato === 'svg') {
      res.type('image/svg+xml').send(await QRCode.toString(url, { ...opciones, type: 'svg' }));
    } else {
      const ancho = Math.min(Math.max(entero(req.query.ancho) ?? 1024, 256), 4096);
      const nombre = `QR-${punto.descripcion.replace(/[^\p{L}\d]+/gu, '-')}.png`;
      if (req.query.descargar) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.type('image/png').send(await QRCode.toBuffer(url, { ...opciones, width: ancho }));
    }
  });

  r.get('/puntos/:id/kit', async (req, res) => {
    const [punto, config] = await Promise.all([
      db.prepare('SELECT p.*, s.nombre AS sede_nombre FROM puntos_qr p LEFT JOIN sedes s ON s.id = p.sede_id WHERE p.id = ?').get(entero(req.params.id)),
      leerConfig(db),
    ]);
    if (!punto) throw new ErrorApp(404, 'NO_ENCONTRADO', 'El punto QR no existe.');
    const url = await urlPunto(punto.token);
    res.json({
      punto: { ...punto, principal: punto.token === TOKEN_PRINCIPAL },
      url,
      url_es_local: esUrlLocal(url),
      enlace_tipo: config.enlace_tipo ?? null,
      qr_actualizado_en: config.qr_actualizado_en ?? null,
      organizacion: config.organizacion,
      mensaje: config.mensaje_invitacion
        .replaceAll('{organizacion}', config.organizacion)
        .replaceAll('{enlace}', url)
        .replaceAll('{punto}', punto.descripcion)
        .replaceAll('{sede}', punto.sede_nombre ?? ''),
    });
  });

  // ───────── Usuarios (solo admin) ─────────
  r.get('/usuarios', soloAdmin, async (req, res) => {
    res.json(
      await db
        .prepare(
          `SELECT u.id, u.email, u.nombre, u.rol, u.empresa_id, u.activo, u.creado_en, e.nombre AS empresa_nombre
             FROM usuarios_admin u LEFT JOIN empresas e ON e.id = u.empresa_id ORDER BY u.nombre`,
        )
        .all(),
    );
  });
  r.post('/usuarios', soloAdmin, async (req, res) => {
    const b = req.body ?? {};
    const email = textoRequerido(b.email, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorApp(422, 'VALIDACION', 'Correo inválido.', { email: 'Correo inválido.' });
    if (!ROLES.includes(b.rol)) throw new ErrorApp(422, 'VALIDACION', 'Rol inválido.', { rol: 'Rol inválido.' });
    const { id } = await db
      .prepare('INSERT INTO usuarios_admin (email, nombre, rol, empresa_id, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(email, textoRequerido(b.nombre, 'nombre'), b.rol, entero(b.empresa_id), hashPassword(validarPassword(b.password)));
    res.status(201).json({ id });
  });
  r.put('/usuarios/:id', soloAdmin, async (req, res) => {
    const actual = await buscar(db, 'usuarios_admin', req.params.id);
    const b = req.body ?? {};
    const rol = b.rol ?? actual.rol;
    const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo;
    if (!ROLES.includes(rol)) throw new ErrorApp(422, 'VALIDACION', 'Rol inválido.', { rol: 'Rol inválido.' });
    if (actual.rol === 'admin' && (rol !== 'admin' || !activo)) {
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM usuarios_admin WHERE rol = 'admin' AND activo = 1 AND id <> ?").get(actual.id);
      if (!n) throw new ErrorApp(409, 'ULTIMO_ADMIN', 'Debe quedar al menos un administrador activo.');
    }
    const nuevaClave = b.password ? hashPassword(validarPassword(b.password)) : null;
    await db.prepare('UPDATE usuarios_admin SET nombre = ?, rol = ?, empresa_id = ?, activo = ? WHERE id = ?').run(
      b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre') : actual.nombre,
      rol,
      b.empresa_id !== undefined ? entero(b.empresa_id) : actual.empresa_id,
      activo,
      actual.id,
    );
    if (nuevaClave) await db.prepare('UPDATE usuarios_admin SET password_hash = ? WHERE id = ?').run(nuevaClave, actual.id);
    if (nuevaClave || !activo) await db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(actual.id);
    res.json({ ok: true });
  });

  // ───────── Configuración ─────────
  r.get('/config', async (req, res) => {
    const [config, efectiva] = await Promise.all([leerConfig(db), urlBasePublica(db, puerto)]);
    res.json({ ...config, base_url_detectada: urlBaseDetectada(puerto), base_url_efectiva: efectiva, hoy: hoyBogota() });
  });
  r.put('/config', soloAdmin, async (req, res) => {
    const b = req.body ?? {};
    // Se valida todo antes de guardar nada.
    const cambios = [];
    for (const clave of Object.keys(CONFIG_POR_DEFECTO)) {
      if (b[clave] === undefined) continue;
      let valor = String(b[clave]).trim();
      if (clave === 'ventana_antiduplicado_min') {
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 0 || n > 1440) throw new ErrorApp(422, 'VALIDACION', 'La ventana debe ser un número entre 0 y 1440 minutos.');
        valor = String(n);
      }
      if (clave === 'base_url' && valor) {
        if (!/^https?:\/\/[^\s/]+/i.test(valor)) throw new ErrorApp(422, 'VALIDACION', 'La URL debe empezar por http:// o https://');
        valor = valor.replace(/\/+$/, '');
      }
      if (clave === 'organizacion' && !valor) throw new ErrorApp(422, 'VALIDACION', 'El nombre de la organización es obligatorio.');
      if (clave === 'hora_renovacion_qr' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) {
        throw new ErrorApp(422, 'VALIDACION', 'La hora de renovación del QR debe tener el formato HH:MM (por ejemplo 05:30).');
      }
      cambios.push([valor || (clave === 'base_url' ? '' : CONFIG_POR_DEFECTO[clave]), clave]);
    }
    await transaccion(db, async (tx) => {
      for (const [valor, clave] of cambios) await tx.prepare('UPDATE configuracion SET valor = ? WHERE clave = ?').run(valor, clave);
    });
    res.json({ ok: true });
  });

  return r;
}

const RECURSOS = { empresas: 'empresa', sedes: 'sede', cargos: 'cargo', puntos: 'QR', usuarios: 'usuario', config: 'configuración' };

function describirAccion(metodo, ruta) {
  if (ruta === '/cargos/importar') return 'Importó cargos';
  if (/^\/puntos\/\d+\/regenerar$/.test(ruta)) return 'Generó un código QR nuevo';
  const recurso = RECURSOS[ruta.split('/')[1]] ?? ruta;
  const verbo = { POST: 'Creó', PUT: 'Modificó', DELETE: 'Eliminó' }[metodo] ?? metodo;
  return `${verbo} ${recurso}`;
}

const TABLAS = new Set(['empresas', 'sedes', 'cargos', 'puntos_qr', 'usuarios_admin']);

async function buscar(db, tabla, id) {
  if (!TABLAS.has(tabla)) throw new Error(`Tabla no permitida: ${tabla}`);
  const fila = await db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(entero(id));
  if (!fila) throw new ErrorApp(404, 'NO_ENCONTRADO', 'El elemento no existe.');
  return fila;
}

// Qué impide borrar cada cosa y qué vínculos se limpian con ella. Se verifica en el código (no solo con las
// llaves foráneas de la base), porque en la nube esas restricciones pueden no estar activas.
const REFERENCIAS = {
  empresas: { usos: ['registros_pausa.empresa_id', 'usuarios_admin.empresa_id'], vinculos: ['empresa_sede.empresa_id', 'empresa_cargo.empresa_id'] },
  sedes: { usos: ['registros_pausa.sede_id', 'puntos_qr.sede_id'], vinculos: ['empresa_sede.sede_id'] },
  cargos: { usos: ['registros_pausa.cargo_id'], vinculos: ['empresa_cargo.cargo_id'] },
  puntos_qr: { usos: ['registros_pausa.punto_qr_id'], vinculos: [] },
};

/** Borra solo si nada lo referencia; si tiene historial, se debe desactivar. */
async function borrar(db, tabla, id, res) {
  const fila = await buscar(db, tabla, id);
  const { usos, vinculos } = REFERENCIAS[tabla];
  for (const uso of usos) {
    const [t, c] = uso.split('.');
    if (await db.prepare(`SELECT 1 AS ok FROM ${t} WHERE ${c} = ? LIMIT 1`).get(fila.id)) {
      throw new ErrorApp(409, 'EN_USO', 'No se puede eliminar porque tiene registros asociados. Desactívalo para ocultarlo del formulario.');
    }
  }
  await transaccion(db, async (tx) => {
    for (const vinculo of vinculos) {
      const [t, c] = vinculo.split('.');
      await tx.prepare(`DELETE FROM ${t} WHERE ${c} = ?`).run(fila.id);
    }
    await tx.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(fila.id);
  });
  res.json({ ok: true });
}
