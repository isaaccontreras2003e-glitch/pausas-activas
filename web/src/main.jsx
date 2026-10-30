import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui.jsx';
import './index.css';
import Registro, { SinCodigo } from './registro/Registro.jsx';

// El panel administrativo (con gráficas) se carga aparte: el formulario móvil queda liviano.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

const Cargando = () => (
  <div className="grid min-h-dvh place-items-center text-marca-700">
    <Spinner className="size-8" />
  </div>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* QR fijo principal: enlace corto que nunca cambia */}
        <Route path="/pausas" element={<Registro token="principal" />} />
        <Route path="/r/:token" element={<Registro />} />
        <Route path="/r" element={<SinCodigo />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<Cargando />}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
