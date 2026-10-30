import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { FranjaLogos } from '../components/Logos.jsx';
import { Boton, Campo, Entrada, Icono, Modal, useAviso } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { puedeGestionar, useAdmin } from './AdminApp.jsx';

const NOMBRE_ROL = { admin: 'Administrador', sst: 'SST', consulta: 'Consulta' };

export default function Layout() {
  const { usuario } = useAdmin();
  const [menuMovil, setMenuMovil] = useState(false);
  const [cambiarClave, setCambiarClave] = useState(false);
  const ubicacion = useLocation();
  useEffect(() => setMenuMovil(false), [ubicacion.pathname]);

  const gestion = puedeGestionar(usuario);
  const enlaces = [
    { a: '/admin', texto: 'Monitor', icono: 'monitor', fin: true },
    { a: '/admin/registros', texto: 'Registros y reportes', icono: 'lista' },
    { a: '/admin/qr', texto: 'Código QR', icono: 'qr' },
    gestion && { separador: 'Parámetros' },
    gestion && { a: '/admin/cargos', texto: 'Cargos', icono: 'maletin' },
    gestion && { a: '/admin/sedes', texto: 'Sedes', icono: 'ubicacion' },
    gestion && { a: '/admin/empresas', texto: 'Empresas', icono: 'edificio' },
    usuario.rol === 'admin' && { separador: 'Sistema' },
    usuario.rol === 'admin' && { a: '/admin/usuarios', texto: 'Usuarios', icono: 'usuarios' },
    usuario.rol === 'admin' && { a: '/admin/configuracion', texto: 'Configuración', icono: 'ajustes' },
    usuario.rol === 'admin' && { a: '/admin/auditoria', texto: 'Auditoría', icono: 'llave' },
  ].filter(Boolean);

  const salir = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.assign('/admin/login');
  };

  const navegacion = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      {enlaces.map((e, i) =>
        e.separador ? (
          <p key={i} className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {e.separador}
          </p>
        ) : (
          <NavLink
            key={e.a}
            to={e.a}
            end={e.fin}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-marca-50 text-marca-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`
            }
          >
            <Icono nombre={e.icono} className="size-5 shrink-0" />
            {e.texto}
          </NavLink>
        ),
      )}
    </nav>
  );

  const pieUsuario = (
    <div className="border-t border-slate-200 p-3">
      <div className="px-3 pb-2">
        <p className="truncate text-sm font-semibold">{usuario.nombre}</p>
        <p className="truncate text-xs text-slate-500">
          {NOMBRE_ROL[usuario.rol]}
          {usuario.empresa_nombre ? ` · ${usuario.empresa_nombre}` : ''}
        </p>
      </div>
      <button type="button" onClick={() => setCambiarClave(true)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
        <Icono nombre="llave" className="size-4" /> Cambiar contraseña
      </button>
      <button type="button" onClick={salir} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
        <Icono nombre="salir" className="size-4" /> Cerrar sesión
      </button>
    </div>
  );

  const marca = (
    <div className="space-y-3 border-b border-slate-100 px-5 py-5">
      <FranjaLogos alto="h-7" gap="gap-3" />
      <div className="text-center leading-tight">
        <p className="text-sm font-bold text-marca-800">Pausas Activas</p>
        <p className="text-xs text-slate-500">Panel de SST</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {marca}
        <div className="flex flex-1 flex-col overflow-y-auto">{navegacion}</div>
        {pieUsuario}
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setMenuMovil(true)} className="-ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Abrir menú">
          <Icono nombre="menu" />
        </button>
        <span className="text-sm font-bold text-marca-800">Pausas Activas</span>
        <FranjaLogos alto="h-6" gap="gap-3" className="ml-auto" />
      </header>

      {menuMovil && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuMovil(false)} />
          <aside className="animar-aparecer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            {marca}
            <div className="flex flex-1 flex-col overflow-y-auto">{navegacion}</div>
            {pieUsuario}
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <ModalClave abierto={cambiarClave} onCerrar={() => setCambiarClave(false)} />
    </div>
  );
}

function ModalClave({ abierto, onCerrar }) {
  const avisar = useAviso();
  const [f, setF] = useState({ actual: '', nueva: '', confirmar: '' });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (f.nueva !== f.confirmar) return setErrores({ confirmar: 'Las contraseñas no coinciden.' });
    setGuardando(true);
    try {
      await api('/api/auth/password', { method: 'PUT', body: { actual: f.actual, nueva: f.nueva } });
      avisar('Contraseña actualizada');
      setF({ actual: '', nueva: '', confirmar: '' });
      setErrores({});
      onCerrar();
    } catch (e) {
      setErrores({ ...e.detalles, general: e.detalles?.actual || e.detalles?.password ? undefined : e.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto={abierto}
      titulo="Cambiar contraseña"
      onCerrar={onCerrar}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} cargando={guardando}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        <Campo etiqueta="Contraseña actual" error={errores.actual} htmlFor="c-actual">
          <Entrada id="c-actual" type="password" autoComplete="current-password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} />
        </Campo>
        <Campo etiqueta="Nueva contraseña" error={errores.password} ayuda="Mínimo 10 caracteres, con al menos una letra y un número." htmlFor="c-nueva">
          <Entrada id="c-nueva" type="password" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} />
        </Campo>
        <Campo etiqueta="Confirmar nueva contraseña" error={errores.confirmar} htmlFor="c-confirmar">
          <Entrada id="c-confirmar" type="password" autoComplete="new-password" value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} />
        </Campo>
        {errores.general && <p className="text-sm text-red-600">{errores.general}</p>}
      </div>
    </Modal>
  );
}
