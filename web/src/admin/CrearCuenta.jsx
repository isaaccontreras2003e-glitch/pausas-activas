import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FranjaLogos } from '../components/Logos.jsx';
import { Alerta, Boton, Campo, Entrada, Spinner, claseBoton } from '../components/ui.jsx';
import { api } from '../lib/api.js';

export const REGLA_PASSWORD = 'Mínimo 10 caracteres, con al menos una letra y un número.';

/**
 * Crear cuenta de administrador. La primera vez es obligatoria (sistema sin usuarios); después sigue disponible
 * desde el equipo servidor para crear más administradores.
 */
export default function CrearCuenta() {
  const [estado, setEstado] = useState(null);
  const [f, setF] = useState({ nombre: '', email: '', password: '', confirmar: '', organizacion: '' });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api('/api/auth/estado').then(setEstado);
  }, []);
  const primera = estado?.requiere_cuenta;

  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setErrores((x) => ({ ...x, [k]: undefined, general: undefined }));
  };

  const crear = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!f.nombre.trim()) errs.nombre = 'Escribe tu nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = 'Escribe un correo válido.';
    if (f.password.length < 10 || !/\p{L}/u.test(f.password) || !/\d/.test(f.password)) errs.password = REGLA_PASSWORD;
    else if (f.password !== f.confirmar) errs.confirmar = 'Las contraseñas no coinciden.';
    if (primera && !f.organizacion.trim()) errs.organizacion = 'Escribe el nombre de la organización.';
    setErrores(errs);
    if (Object.keys(errs).length) return;
    setGuardando(true);
    try {
      await api('/api/auth/crear-cuenta', { method: 'POST', body: { nombre: f.nombre, email: f.email, password: f.password, organizacion: f.organizacion } });
      location.assign('/admin');
    } catch (err) {
      setErrores({ ...err.detalles, general: err.message });
      setGuardando(false);
    }
  };

  if (!estado) {
    return (
      <div className="grid min-h-dvh place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <FranjaLogos alto="h-11" className="mb-5" />
          <h1 className="text-2xl font-bold tracking-tight">Crear cuenta de administrador</h1>
          <p className="mt-1 text-sm text-slate-500">
            {primera
              ? 'Es el primer uso del sistema. Esta cuenta tendrá acceso total al panel de SST; después podrás crear más usuarios.'
              : 'Crea una cuenta de administrador con acceso total al panel de SST.'}
          </p>
        </div>

        {!estado.es_este_equipo ? (
          <div className="space-y-4">
            <Alerta tipo="aviso">
              {primera ? (
                <>
                  Por seguridad, la primera cuenta solo se puede crear desde el computador donde está instalado el sistema. Abre{' '}
                  <strong>http://localhost:3000/admin</strong> en ese equipo.
                </>
              ) : (
                <>
                  Por seguridad, las cuentas nuevas no se pueden crear desde otros computadores. Pídele a un administrador que te la cree en el panel, en{' '}
                  <strong>Usuarios → Nuevo usuario</strong>, o créala desde el computador donde está instalado el sistema.
                </>
              )}
            </Alerta>
            {!primera && (
              <Link to="/admin/login" className={`${claseBoton('secundario')} w-full`}>
                Volver a ingresar
              </Link>
            )}
          </div>
        ) : (
          <form onSubmit={crear} noValidate className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <Campo etiqueta="Tu nombre completo" requerido error={errores.nombre} htmlFor="cc-nombre">
              <Entrada id="cc-nombre" value={f.nombre} onChange={set('nombre')} autoComplete="name" autoFocus error={errores.nombre} />
            </Campo>
            <Campo etiqueta="Correo (será tu usuario)" requerido error={errores.email} htmlFor="cc-email">
              <Entrada id="cc-email" type="email" value={f.email} onChange={set('email')} autoComplete="username" error={errores.email} />
            </Campo>
            <Campo etiqueta="Contraseña" requerido error={errores.password} ayuda={REGLA_PASSWORD} htmlFor="cc-pass">
              <Entrada id="cc-pass" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" error={errores.password} />
            </Campo>
            <Campo etiqueta="Confirmar contraseña" requerido error={errores.confirmar} htmlFor="cc-conf">
              <Entrada id="cc-conf" type="password" value={f.confirmar} onChange={set('confirmar')} autoComplete="new-password" error={errores.confirmar} />
            </Campo>
            {primera && (
              <Campo
                etiqueta="Nombre de la organización"
                requerido
                error={errores.organizacion}
                ayuda="Aparece en el formulario, el afiche y los reportes. Se puede cambiar en Configuración."
                htmlFor="cc-org"
              >
                <Entrada id="cc-org" value={f.organizacion} onChange={set('organizacion')} placeholder="Ej.: Grupo IMES" error={errores.organizacion} />
              </Campo>
            )}
            {errores.general && <Alerta tipo="error">{errores.general}</Alerta>}
            <Boton type="submit" cargando={guardando} className="w-full">
              Crear cuenta e ingresar
            </Boton>
            {!primera && (
              <p className="text-center text-sm text-slate-500">
                ¿Ya tienes cuenta?{' '}
                <Link to="/admin/login" className="font-semibold text-marca-700 hover:underline">
                  Ingresar
                </Link>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
