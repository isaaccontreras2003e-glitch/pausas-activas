import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FranjaLogos } from '../components/Logos.jsx';
import { Alerta, Boton, Campo, Entrada, Spinner, claseBoton, claseEntrada } from '../components/ui.jsx';
import { api } from '../lib/api.js';

export const REGLA_PASSWORD = 'Mínimo 10 caracteres, con al menos una letra y un número.';

/**
 * Primer uso y cuentas de administrador.
 * - En el equipo servidor: crear cuenta (siempre) o importar los datos del PC anterior (sistema nuevo).
 * - En la nube (Render): lo mismo, pero solo con la clave de configuración que el dueño ve en Render.
 */
export default function CrearCuenta() {
  const [estado, setEstado] = useState(null);
  const [modo, setModo] = useState('importar');

  useEffect(() => {
    api('/api/auth/estado').then(setEstado);
  }, []);

  if (!estado) {
    return (
      <div className="grid min-h-dvh place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  const primera = estado.requiere_cuenta;
  const conClave = !estado.es_este_equipo && primera && estado.permite_clave;
  const puede = estado.es_este_equipo || conClave;
  const verImportar = primera && modo === 'importar';

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <FranjaLogos alto="h-11" className="mb-5" />
          <h1 className="text-2xl font-bold tracking-tight">{primera ? 'Configuración inicial' : 'Crear cuenta de administrador'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {primera
              ? 'Es el primer uso del sistema. Trae los datos del PC anterior o empieza con una cuenta nueva.'
              : 'Crea una cuenta de administrador con acceso total al panel de SST.'}
          </p>
        </div>

        {!puede ? (
          <div className="space-y-4">
            <Alerta tipo="aviso">
              {primera ? (
                <>
                  Por seguridad, la configuración inicial solo se puede hacer desde el computador donde está instalado el sistema. Abre{' '}
                  <strong>http://localhost:3000/admin</strong> en ese equipo.
                </>
              ) : (
                <>
                  Por seguridad, las cuentas nuevas no se pueden crear desde aquí. Pídele a un administrador que te la cree en el panel, en{' '}
                  <strong>Usuarios → Nuevo usuario</strong>.
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
          <div className="space-y-4">
            {primera && (
              <div className="grid grid-cols-2 rounded-lg bg-slate-200/70 p-1 text-sm font-semibold" role="tablist">
                {[
                  ['importar', 'Importar datos del PC anterior'],
                  ['crear', 'Crear cuenta nueva'],
                ].map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    role="tab"
                    aria-selected={modo === valor}
                    onClick={() => setModo(valor)}
                    className={`rounded-md px-3 py-2 ${modo === valor ? 'bg-white text-marca-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            )}
            {verImportar ? <FormImportar conClave={conClave} /> : <FormCrear primera={primera} conClave={conClave} />}
          </div>
        )}
      </div>
    </div>
  );
}

function CampoClave({ valor, onCambio, error }) {
  return (
    <Campo
      etiqueta="Clave de configuración"
      requerido
      error={error}
      ayuda="Es el valor de CLAVE_CONFIGURACION en Vercel → tu proyecto → Settings → Environment Variables."
      htmlFor="cc-clave"
    >
      <Entrada id="cc-clave" type="password" value={valor} onChange={(e) => onCambio(e.target.value)} autoComplete="off" error={error} />
    </Campo>
  );
}

function FormCrear({ primera, conClave }) {
  const [f, setF] = useState({ nombre: '', email: '', password: '', confirmar: '', organizacion: '', clave: '' });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
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
    if (conClave && !f.clave.trim()) errs.clave_configuracion = 'Escribe la clave de configuración.';
    setErrores(errs);
    if (Object.keys(errs).length) return;
    setGuardando(true);
    try {
      await api('/api/auth/crear-cuenta', {
        method: 'POST',
        body: { nombre: f.nombre, email: f.email, password: f.password, organizacion: f.organizacion, clave_configuracion: f.clave.trim() || undefined },
      });
      location.assign('/admin');
    } catch (err) {
      setErrores({ ...err.detalles, general: err.message });
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={crear} noValidate className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {conClave && <CampoClave valor={f.clave} onCambio={(v) => setF({ ...f, clave: v })} error={errores.clave_configuracion} />}
      <Campo etiqueta="Tu nombre completo" requerido error={errores.nombre} htmlFor="cc-nombre">
        <Entrada id="cc-nombre" value={f.nombre} onChange={set('nombre')} autoComplete="name" error={errores.nombre} />
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
  );
}

/** Sube el archivo .cifrado (EXPORTAR-DATOS.bat del PC anterior) y su contraseña. */
function FormImportar({ conClave }) {
  const [archivo, setArchivo] = useState(null);
  const [password, setPassword] = useState('');
  const [clave, setClave] = useState('');
  const [errores, setErrores] = useState({});
  const [estado, setEstado] = useState('formulario');

  const leer = (file) =>
    new Promise((ok, falla) => {
      const lector = new FileReader();
      lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
      lector.onerror = falla;
      lector.readAsDataURL(file);
    });

  const importar = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!archivo) errs.archivo = 'Elige el archivo .cifrado.';
    if (!password) errs.password = 'Escribe la contraseña del archivo.';
    if (conClave && !clave.trim()) errs.clave_configuracion = 'Escribe la clave de configuración.';
    setErrores(errs);
    if (Object.keys(errs).length) return;
    setEstado('enviando');
    try {
      await api('/api/auth/importar-datos', {
        method: 'POST',
        body: { archivo_base64: await leer(archivo), password, clave_configuracion: clave.trim() || undefined },
        timeout: 120_000,
      });
      setEstado('reiniciando');
      // El servidor se reinicia para cargar los datos; cuando vuelve, se va al inicio de sesión.
      const esperar = async () => {
        try {
          const r = await fetch('/api/auth/estado', { cache: 'no-store' });
          if (r.ok && !(await r.json()).requiere_cuenta) return location.assign('/admin/login');
        } catch {
          /* todavía reiniciando */
        }
        setTimeout(esperar, 2000);
      };
      setTimeout(esperar, 3000);
    } catch (err) {
      setErrores({ ...err.detalles, general: err.message });
      setEstado('formulario');
    }
  };

  if (estado === 'reiniciando') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <Spinner className="size-8 text-marca-700" />
        <p className="font-semibold">Datos importados. Cargándolos…</p>
        <p className="text-sm text-slate-500">En unos segundos podrás ingresar con tus cuentas de siempre.</p>
      </div>
    );
  }

  return (
    <form onSubmit={importar} noValidate className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-600">
        En el PC anterior, ejecuta <strong>EXPORTAR-DATOS.bat</strong>: crea en el Escritorio un archivo <strong>.cifrado</strong> con usuarios, empresas, sedes,
        cargos y registros. Súbelo aquí con su contraseña.
      </p>
      {conClave && <CampoClave valor={clave} onCambio={setClave} error={errores.clave_configuracion} />}
      <Campo etiqueta="Archivo de datos (.cifrado)" requerido error={errores.archivo}>
        <input
          type="file"
          accept=".cifrado"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setErrores((x) => ({ ...x, archivo: undefined }));
          }}
          className={`${claseEntrada} file:mr-3 file:rounded-md file:border-0 file:bg-marca-50 file:px-3 file:py-1 file:font-semibold file:text-marca-800`}
        />
      </Campo>
      <Campo etiqueta="Contraseña del archivo" requerido error={errores.password} htmlFor="cc-imp-pass">
        <Entrada id="cc-imp-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" error={errores.password} />
      </Campo>
      {errores.general && <Alerta tipo="error">{errores.general}</Alerta>}
      <Boton type="submit" cargando={estado === 'enviando'} className="w-full">
        Importar datos
      </Boton>
    </form>
  );
}
