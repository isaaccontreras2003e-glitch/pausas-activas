import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProveedorAvisos, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import Afiche from './Afiche.jsx';
import Auditoria from './Auditoria.jsx';
import { Cargos, Empresas, Sedes } from './Catalogos.jsx';
import Configuracion from './Configuracion.jsx';
import CrearCuenta from './CrearCuenta.jsx';
import Layout from './Layout.jsx';
import Login from './Login.jsx';
import Monitor from './Monitor.jsx';
import PuntosQR from './PuntosQR.jsx';
import Registros from './Registros.jsx';
import Usuarios from './Usuarios.jsx';

const ContextoAdmin = createContext(null);
export const useAdmin = () => useContext(ContextoAdmin);

export const puedeGestionar = (usuario) => ['admin', 'sst'].includes(usuario?.rol);

export default function AdminApp() {
  return (
    <ProveedorAvisos>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="crear-cuenta" element={<CrearCuenta />} />
        <Route path="*" element={<ZonaPrivada />} />
      </Routes>
    </ProveedorAvisos>
  );
}

function ZonaPrivada() {
  const ubicacion = useLocation();
  const [usuario, setUsuario] = useState(undefined);
  const [catalogos, setCatalogos] = useState(null);

  const recargarCatalogos = useCallback(() => api('/api/admin/catalogos').then(setCatalogos), []);

  useEffect(() => {
    api('/api/auth/me')
      .then((u) => {
        setUsuario(u);
        return recargarCatalogos();
      })
      .catch(() => setUsuario(null));
  }, [recargarCatalogos]);

  if (usuario === null) return <Navigate to={`/admin/login?volver=${encodeURIComponent(ubicacion.pathname + ubicacion.search)}`} replace />;
  if (!usuario || !catalogos) {
    return (
      <div className="grid min-h-dvh place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  const gestion = puedeGestionar(usuario);
  const admin = usuario.rol === 'admin';
  return (
    <ContextoAdmin.Provider value={{ usuario, catalogos, recargarCatalogos }}>
      <Routes>
        <Route path="qr/:id/afiche" element={<Afiche />} />
        <Route element={<Layout />}>
          <Route index element={<Monitor />} />
          <Route path="registros" element={<Registros />} />
          <Route path="qr" element={<PuntosQR />} />
          {gestion && <Route path="cargos" element={<Cargos />} />}
          {gestion && <Route path="sedes" element={<Sedes />} />}
          {gestion && <Route path="empresas" element={<Empresas />} />}
          {admin && <Route path="usuarios" element={<Usuarios />} />}
          {admin && <Route path="configuracion" element={<Configuracion />} />}
          {admin && <Route path="auditoria" element={<Auditoria />} />}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </ContextoAdmin.Provider>
  );
}
