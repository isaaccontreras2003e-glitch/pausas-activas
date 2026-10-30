import { Router } from 'express';
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
import { auditar, crearBloqueoCuentas } from './seguridad.js';
import { CONFIG_POR_DEFECTO, TOKEN_PRINCIPAL, leerConfig, transaccion } from './db.js';
import { importarCargos, plantillaCargos } from './importar-cargos.js';
import { esUrlLocal, urlBaseDetectada, urlBasePublica } from './red.js';
import { construirFiltro, exportarCsv, exportarXlsx, listarRegistros, resumen } from './reportes.js';
import { ErrorApp, entero, hoyBogota, limitador, textoOpcional, textoRequerido, tokenCorto } from './util.js';

const GESTION = ['admin', 'sst'];
const ROLES = ['admin', 'sst', 'consulta'];

export function rutasAuth({ db }) {
  const r = Router();
  const limiteLogin = limitador({ ventanaMs: 15 * 60_000, maximo: 20, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
  const bloqueo = crearBloqueoCuentas();

  r.post('/login', limiteLogin, (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 150);
    bloqueo.verificar(email);
    const usuario = db.prepare('SELECT * FROM usuarios_admin WHERE email = ? AND activo = 1').get(email);
    if (!verificarPasswordDeUsuario(usuario, String(req.body?.password ?? '').slice(0, 200))) {
      const bloqueada = bloqueo.fallo(email);
      auditar(db, req, 'Inicio de sesión fallido', `${email}${bloqueada ? ' (cuenta bloqueada 15 min)' : ''}`);
      throw new ErrorApp(401, 'CREDENCIALES', 'Correo o contraseña incorrectos.');
    }
    bloqueo.exito(email);
    res.setHeader('Set-Cookie', cookieSesion(req, crearSesion(db, usuario.id)));
    auditar(db, { ip: req.ip, usuario }, 'Inicio de sesión');
    res.json({ ok: true });
  });

  // ───────── Primera cuenta de administrador (sistema recién instalado o reiniciado) ─────────
  const hayUsuarios = () => !!db.prepare('SELECT 1 FROM usuarios_admin LIMIT 1').get();
  const esEsteEquipo = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);

  r.get('/estado', (req, res) => {
    res.json({ requiere_cuenta: !hayUsuarios(), es_este_equipo: esEsteEquipo(req) });
  });

  // Crear cuenta de administrador: siempre disponible, pero SOLO desde el equipo servidor. Desde el enlace
  // público cualquiera podría hacerse administrador; ahí las cuentas las crea un administrador en Usuarios.
  r.post('/crear-cuenta', limiteLogin, (req, res) => {
    const primera = !hayUsuarios();
    if (!esEsteEquipo(req)) {
      throw new ErrorApp(
        403,
        'SOLO_ESTE_EQUIPO',
        primera
          ? 'La cuenta de administrador inicial solo se puede crear desde el computador donde está instalado el sistema.'
          : 'Las cuentas nuevas se crean desde el computador del sistema, o las crea un administrador en el panel (Usuarios).',
      );
    }
    const b = req.body ?? {};
    const email = textoRequerido(b.email, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorApp(422, 'VALIDACION', 'Correo inválido.', { email: 'Escribe un correo válido.' });
    if (db.prepare('SELECT 1 FROM usuarios_admin WHERE email = ?').get(email)) {
      throw new ErrorApp(409, 'CORREO_EXISTE', 'Ya existe una cuenta con ese correo. Ingresa con ella.', { email: 'Ya existe una cuenta con este correo.' });
    }
    const nombre = textoRequerido(b.nombre, 'nombre');
    const password = validarPassword(b.password);
    const organizacion = primera ? textoRequerido(b.organizacion, 'organizacion', 120) : null;
    const id = transaccion(db, () => {
      if (organizacion) db.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'organizacion'").run(organizacion);
      return db
        .prepare("INSERT INTO usuarios_admin (email, nombre, rol, password_hash) VALUES (?, ?, 'admin', ?) RETURNING id")
        .get(email, nombre, hashPassword(password)).id;
    });
    res.setHeader('Set-Cookie', cookieSesion(req, crearSesion(db, id)));
    auditar(db, { ip: req.ip, usuario: { id, email } }, primera ? 'Creó la primera cuenta de administrador' : 'Creó cuenta de administrador (desde el equipo servidor)', email);
    res.status(201).json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    const usuario = usuarioDeSesion(db, req);
    if (usuario) {
      db.prepare('DELETE FROM sesiones WHERE token = ?').run(usuario.token);
      auditar(db, { ip: req.ip, usuario }, 'Cierre de sesión');
    }
    res.setHeader('Set-Cookie', cookieSesion(req, '', 0));
    res.json({ ok: true });
  });

  r.get('/me', requiereSesion(db), (req, res) => {
    const { token, ...usuario } = req.usuario;
    res.json(usuario);
  });

  r.put('/password', requiereSesion(db), (req, res) => {
    const { password_hash } = db.prepare('SELECT password_hash FROM usuarios_admin WHERE id = ?').get(req.usuario.id);
    if (!verificarPassword(req.body?.actual ?? '', password_hash)) {
      throw new ErrorApp(422, 'VALIDACION', 'La contraseña actual no es correcta.', { actual: 'Contraseña incorrecta.' });
    }
    const nueva = validarPassword(req.body?.nueva);
    db.prepare('UPDATE usuarios_admin SET password_hash = ? WHERE id = ?').run(hashPassword(nueva), req.usuario.id);
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?').run(req.usuario.id, req.usuario.token);
    auditar(db, req, 'Cambió su contraseña');
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

  r.get('/auditoria', requiereSesion(db, ['admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 1000').all());
  });

  const gestion = requiereSesion(db, GESTION);
  const soloAdmin = requiereSesion(db, ['admin']);
  const urlPunto = (token) => `${urlBasePublica(db, puerto)}${token === TOKEN_PRINCIPAL ? '/pausas' : `/r/${token}`}`;
  const noEsPrincipal = (punto) => {
    if (punto.token === TOKEN_PRINCIPAL) {
      throw new ErrorApp(409, 'QR_FIJO', 'El QR principal es fijo: no se puede regenerar, desactivar ni eliminar, para que los afiches y mensajes enviados sigan funcionando.');
    }
    return punto;
  };

  // ───────── Dashboard y reportes ─────────
  r.get('/resumen', (req, res) => {
    res.json(resumen(db, construirFiltro(req.query, req.usuario), req.usuario));
  });

  r.get('/registros', (req, res) => {
    const filtro = construirFiltro(req.query, req.usuario);
    res.json(listarRegistros(db, filtro, req.usuario, { pagina: req.query.pagina, tamano: req.query.tamano }));
  });

  r.get('/exportar', async (req, res) => {
    const filtro = construirFiltro(req.query, req.usuario);
    const tipo = req.query.tipo === 'consolidado' ? 'consolidado' : 'detallado';
    const nombre = `pausas-activas_${tipo}_${filtro.desdeLocal.slice(0, 10)}_a_${filtro.hastaLocal.slice(0, 10)}`;
    auditar(db, req, 'Exportó reporte', `${tipo} ${req.query.formato === 'csv' ? 'CSV' : 'Excel'} · ${filtro.desdeLocal} a ${filtro.hastaLocal}`);
    if (req.query.formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
      return res.send(exportarCsv(db, filtro, req.usuario, tipo));
    }
    const buffer = await exportarXlsx(db, filtro, req.usuario, tipo, leerConfig(db).organizacion);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(buffer);
  });

  r.get('/stream', (req, res) => canal.suscribir(req, res));

  // ───────── Catálogos (incluye inactivos, para gestión y filtros) ─────────
  r.get('/catalogos', (req, res) => {
    const vinculos = db.prepare('SELECT empresa_id, sede_id FROM empresa_sede').all();
    const empresasDeSede = (id) => vinculos.filter((v) => v.sede_id === id).map((v) => v.empresa_id);
    const empresasPorCargo = new Map();
    for (const v of db.prepare('SELECT empresa_id, cargo_id FROM empresa_cargo').all()) {
      empresasPorCargo.set(v.cargo_id, [...(empresasPorCargo.get(v.cargo_id) ?? []), v.empresa_id]);
    }
    res.json({
      empresas: db
        .prepare('SELECT e.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.empresa_id = e.id) AS registros FROM empresas e ORDER BY e.nombre')
        .all(),
      sedes: db
        .prepare('SELECT s.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.sede_id = s.id) AS registros FROM sedes s ORDER BY s.nombre, s.ciudad')
        .all()
        .map((s) => ({ ...s, empresa_ids: empresasDeSede(s.id) })),
      cargos: db
        .prepare('SELECT c.*, (SELECT COUNT(*) FROM registros_pausa r WHERE r.cargo_id = c.id) AS registros FROM cargos c ORDER BY c.nombre')
        .all()
        .map((c) => ({ ...c, empresa_ids: empresasPorCargo.get(c.id) ?? [] })),
      puntos: db
        .prepare(
          `SELECT p.*, s.nombre AS sede_nombre,
                  (SELECT COUNT(*) FROM registros_pausa r WHERE r.punto_qr_id = p.id) AS registros,
                  (SELECT MAX(registrado_en) FROM registros_pausa r WHERE r.punto_qr_id = p.id) AS ultimo_registro
             FROM puntos_qr p LEFT JOIN sedes s ON s.id = p.sede_id
            ORDER BY p.token = '${TOKEN_PRINCIPAL}' DESC, p.activo DESC, s.nombre, p.descripcion`,
        )
        .all()
        .map((p) => ({ ...p, principal: p.token === TOKEN_PRINCIPAL, url: urlPunto(p.token) })),
    });
  });

  // Empresas
  r.post('/empresas', gestion, (req, res) => {
    const nombre = textoRequerido(req.body?.nombre, 'nombre');
    const { id } = db.prepare('INSERT INTO empresas (nombre, nit) VALUES (?, ?) RETURNING id').get(nombre, textoOpcional(req.body?.nit, 20));
    res.status(201).json({ id });
  });
  r.put('/empresas/:id', gestion, (req, res) => {
    const actual = buscar(db, 'empresas', req.params.id);
    const b = req.body ?? {};
    db.prepare('UPDATE empresas SET nombre = ?, nit = ?, activo = ? WHERE id = ?').run(
      b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre') : actual.nombre,
      b.nit !== undefined ? textoOpcional(b.nit, 20) : actual.nit,
      b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
      actual.id,
    );
    res.json({ ok: true });
  });
  r.delete('/empresas/:id', gestion, (req, res) => borrar(db, 'empresas', req.params.id, res));

  // Sedes (con las empresas que operan en ellas)
  const guardarVinculos = (sedeId, empresaIds) => {
    if (!Array.isArray(empresaIds)) return;
    db.prepare('DELETE FROM empresa_sede WHERE sede_id = ?').run(sedeId);
    const insertar = db.prepare('INSERT OR IGNORE INTO empresa_sede (empresa_id, sede_id) VALUES (?, ?)');
    for (const e of empresaIds.map(entero).filter(Boolean)) insertar.run(e, sedeId);
  };
  r.post('/sedes', gestion, (req, res) => {
    const b = req.body ?? {};
    if (!Array.isArray(b.empresa_ids) || !b.empresa_ids.length) {
      throw new ErrorApp(422, 'VALIDACION', 'Selecciona al menos una empresa que opere en esta sede.', { empresa_ids: 'Obligatorio.' });
    }
    const id = transaccion(db, () => {
      const { id } = db
        .prepare('INSERT INTO sedes (nombre, ciudad, direccion) VALUES (?, ?, ?) RETURNING id')
        .get(textoRequerido(b.nombre, 'nombre', 120), textoOpcional(b.ciudad, 80) ?? '', textoOpcional(b.direccion));
      guardarVinculos(id, b.empresa_ids);
      return id;
    });
    res.status(201).json({ id });
  });
  r.put('/sedes/:id', gestion, (req, res) => {
    const actual = buscar(db, 'sedes', req.params.id);
    const b = req.body ?? {};
    if (Array.isArray(b.empresa_ids) && !b.empresa_ids.length) {
      throw new ErrorApp(422, 'VALIDACION', 'Selecciona al menos una empresa que opere en esta sede.', { empresa_ids: 'Obligatorio.' });
    }
    transaccion(db, () => {
      db.prepare('UPDATE sedes SET nombre = ?, ciudad = ?, direccion = ?, activo = ? WHERE id = ?').run(
        b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre', 120) : actual.nombre,
        b.ciudad !== undefined ? (textoOpcional(b.ciudad, 80) ?? '') : actual.ciudad,
        b.direccion !== undefined ? textoOpcional(b.direccion) : actual.direccion,
        b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
        actual.id,
      );
      guardarVinculos(actual.id, b.empresa_ids);
    });
    res.json({ ok: true });
  });
  r.delete('/sedes/:id', gestion, (req, res) => borrar(db, 'sedes', req.params.id, res));

  // Cargos
  const guardarEmpresasCargo = (cargoId, empresaIds) => {
    if (!Array.isArray(empresaIds)) return;
    db.prepare('DELETE FROM empresa_cargo WHERE cargo_id = ?').run(cargoId);
    const insertar = db.prepare('INSERT OR IGNORE INTO empresa_cargo (empresa_id, cargo_id) VALUES (?, ?)');
    for (const e of empresaIds.map(entero).filter(Boolean)) insertar.run(e, cargoId);
  };
  r.post('/cargos', gestion, (req, res) => {
    const b = req.body ?? {};
    const id = transaccion(db, () => {
      const { id } = db
        .prepare('INSERT INTO cargos (nombre, codigo, area) VALUES (?, ?, ?) RETURNING id')
        .get(textoRequerido(b.nombre, 'nombre', 120), textoOpcional(b.codigo, 30), textoOpcional(b.area, 80));
      guardarEmpresasCargo(id, b.empresa_ids);
      return id;
    });
    res.status(201).json({ id });
  });
  r.put('/cargos/:id', gestion, (req, res) => {
    const actual = buscar(db, 'cargos', req.params.id);
    const b = req.body ?? {};
    transaccion(db, () => {
      db.prepare('UPDATE cargos SET nombre = ?, codigo = ?, area = ?, activo = ? WHERE id = ?').run(
        b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre', 120) : actual.nombre,
        b.codigo !== undefined ? textoOpcional(b.codigo, 30) : actual.codigo,
        b.area !== undefined ? textoOpcional(b.area, 80) : actual.area,
        b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
        actual.id,
      );
      guardarEmpresasCargo(actual.id, b.empresa_ids);
    });
    res.json({ ok: true });
  });
  r.delete('/cargos/:id', gestion, (req, res) => borrar(db, 'cargos', req.params.id, res));
  r.post('/cargos/importar', gestion, async (req, res) => res.json(await importarCargos(db, req.body ?? {})));
  r.get('/cargos/plantilla', async (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-cargos.xlsx"');
    res.send(await plantillaCargos());
  });

  // Puntos QR
  const validarSedePunto = (valor) => {
    const sedeId = entero(valor);
    if (sedeId) buscar(db, 'sedes', sedeId);
    return sedeId;
  };
  r.post('/puntos', gestion, (req, res) => {
    const b = req.body ?? {};
    const { id } = db
      .prepare('INSERT INTO puntos_qr (token, sede_id, descripcion) VALUES (?, ?, ?) RETURNING id')
      .get(tokenCorto(), validarSedePunto(b.sede_id), textoRequerido(b.descripcion, 'descripcion', 120));
    res.status(201).json({ id });
  });
  r.put('/puntos/:id', gestion, (req, res) => {
    const actual = buscar(db, 'puntos_qr', req.params.id);
    const b = req.body ?? {};
    if (b.activo === false) noEsPrincipal(actual);
    db.prepare('UPDATE puntos_qr SET descripcion = ?, sede_id = ?, activo = ? WHERE id = ?').run(
      b.descripcion !== undefined ? textoRequerido(b.descripcion, 'descripcion', 120) : actual.descripcion,
      b.sede_id !== undefined ? validarSedePunto(b.sede_id) : actual.sede_id,
      b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo,
      actual.id,
    );
    res.json({ ok: true });
  });
  r.post('/puntos/:id/regenerar', gestion, (req, res) => {
    const actual = noEsPrincipal(buscar(db, 'puntos_qr', req.params.id));
    const token = tokenCorto();
    db.prepare('UPDATE puntos_qr SET token = ? WHERE id = ?').run(token, actual.id);
    res.json({ token, url: urlPunto(token) });
  });
  r.delete('/puntos/:id', gestion, (req, res) => {
    noEsPrincipal(buscar(db, 'puntos_qr', req.params.id));
    borrar(db, 'puntos_qr', req.params.id, res);
  });

  r.get('/puntos/:id/qr.:formato', async (req, res) => {
    const punto = buscar(db, 'puntos_qr', req.params.id);
    const url = urlPunto(punto.token);
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

  r.get('/puntos/:id/kit', (req, res) => {
    const punto = db
      .prepare('SELECT p.*, s.nombre AS sede_nombre FROM puntos_qr p LEFT JOIN sedes s ON s.id = p.sede_id WHERE p.id = ?')
      .get(entero(req.params.id));
    if (!punto) throw new ErrorApp(404, 'NO_ENCONTRADO', 'El punto QR no existe.');
    const config = leerConfig(db);
    const url = urlPunto(punto.token);
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
  r.get('/usuarios', soloAdmin, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.id, u.email, u.nombre, u.rol, u.empresa_id, u.activo, u.creado_en, e.nombre AS empresa_nombre
             FROM usuarios_admin u LEFT JOIN empresas e ON e.id = u.empresa_id ORDER BY u.nombre`,
        )
        .all(),
    );
  });
  r.post('/usuarios', soloAdmin, (req, res) => {
    const b = req.body ?? {};
    const email = textoRequerido(b.email, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorApp(422, 'VALIDACION', 'Correo inválido.', { email: 'Correo inválido.' });
    if (!ROLES.includes(b.rol)) throw new ErrorApp(422, 'VALIDACION', 'Rol inválido.', { rol: 'Rol inválido.' });
    const { id } = db
      .prepare('INSERT INTO usuarios_admin (email, nombre, rol, empresa_id, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(email, textoRequerido(b.nombre, 'nombre'), b.rol, entero(b.empresa_id), hashPassword(validarPassword(b.password)));
    res.status(201).json({ id });
  });
  r.put('/usuarios/:id', soloAdmin, (req, res) => {
    const actual = buscar(db, 'usuarios_admin', req.params.id);
    const b = req.body ?? {};
    const rol = b.rol ?? actual.rol;
    const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo;
    if (!ROLES.includes(rol)) throw new ErrorApp(422, 'VALIDACION', 'Rol inválido.', { rol: 'Rol inválido.' });
    if (actual.rol === 'admin' && (rol !== 'admin' || !activo)) {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM usuarios_admin WHERE rol = 'admin' AND activo = 1 AND id <> ?").get(actual.id);
      if (!n) throw new ErrorApp(409, 'ULTIMO_ADMIN', 'Debe quedar al menos un administrador activo.');
    }
    db.prepare('UPDATE usuarios_admin SET nombre = ?, rol = ?, empresa_id = ?, activo = ? WHERE id = ?').run(
      b.nombre !== undefined ? textoRequerido(b.nombre, 'nombre') : actual.nombre,
      rol,
      b.empresa_id !== undefined ? entero(b.empresa_id) : actual.empresa_id,
      activo,
      actual.id,
    );
    if (b.password) db.prepare('UPDATE usuarios_admin SET password_hash = ? WHERE id = ?').run(hashPassword(validarPassword(b.password)), actual.id);
    if (b.password || !activo) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(actual.id);
    res.json({ ok: true });
  });

  // ───────── Configuración ─────────
  r.get('/config', (req, res) => {
    const config = leerConfig(db);
    res.json({ ...config, base_url_detectada: urlBaseDetectada(puerto), base_url_efectiva: urlBasePublica(db, puerto), hoy: hoyBogota() });
  });
  r.put('/config', soloAdmin, (req, res) => {
    const b = req.body ?? {};
    const guardar = db.prepare('UPDATE configuracion SET valor = ? WHERE clave = ?');
    transaccion(db, () => {
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
        guardar.run(valor || (clave === 'base_url' ? '' : CONFIG_POR_DEFECTO[clave]), clave);
      }
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

function buscar(db, tabla, id) {
  if (!TABLAS.has(tabla)) throw new Error(`Tabla no permitida: ${tabla}`);
  const fila = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(entero(id));
  if (!fila) throw new ErrorApp(404, 'NO_ENCONTRADO', 'El elemento no existe.');
  return fila;
}

/** Borra solo si nada lo referencia; si tiene historial, se debe desactivar. */
function borrar(db, tabla, id, res) {
  const fila = buscar(db, tabla, id);
  try {
    db.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(fila.id);
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) {
      throw new ErrorApp(409, 'EN_USO', 'No se puede eliminar porque tiene registros asociados. Desactívalo para ocultarlo del formulario.');
    }
    throw e;
  }
  res.json({ ok: true });
}
