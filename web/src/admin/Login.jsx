import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FranjaLogos } from '../components/Logos.jsx';
import { Alerta, Boton, Campo, Entrada } from '../components/ui.jsx';
import { api } from '../lib/api.js';

export default function Login() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  // Sistema sin usuarios: primero hay que crear la cuenta de administrador.
  useEffect(() => {
    api('/api/auth/estado')
      .then((e) => e.requiere_cuenta && navegar('/admin/crear-cuenta', { replace: true }))
      .catch(() => {});
  }, [navegar]);

  const ingresar = async (e) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      const volver = params.get('volver');
      navegar(volver?.startsWith('/admin') && !volver.startsWith('/admin/login') ? volver : '/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 space-y-4 text-center">
          <FranjaLogos alto="h-11" />
          <div>
            <p className="text-lg leading-tight font-bold">Pausas Activas</p>
            <p className="text-sm text-slate-500">Panel de Seguridad y Salud en el Trabajo</p>
          </div>
        </div>
        <form onSubmit={ingresar} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <Campo etiqueta="Correo" htmlFor="email">
            <Entrada id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Campo>
          <Campo etiqueta="Contraseña" htmlFor="password">
            <Entrada id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Campo>
          {error && <Alerta tipo="error">{error}</Alerta>}
          <Boton type="submit" cargando={cargando} className="w-full">
            Ingresar
          </Boton>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          ¿No tienes cuenta?{' '}
          <Link to="/admin/crear-cuenta" className="font-semibold text-marca-700 hover:underline">
            Crear cuenta de administrador
          </Link>
        </p>
      </div>
    </div>
  );
}
