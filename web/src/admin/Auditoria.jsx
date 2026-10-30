import { useEffect, useMemo, useState } from 'react';
import { Icono, Insignia, Spinner, Tarjeta, Vacio, claseEntrada } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fechaHora, quitarTildes } from '../lib/formato.js';

/** Registro de auditoría: inicios de sesión (también los fallidos), cambios y exportaciones. */
export default function Auditoria() {
  const [filas, setFilas] = useState(null);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    api('/api/admin/auditoria').then(setFilas);
  }, []);

  const visibles = useMemo(() => {
    const t = quitarTildes(busqueda.trim());
    return (filas ?? []).filter((f) => !t || quitarTildes(`${f.accion} ${f.detalle ?? ''} ${f.usuario_email ?? ''} ${f.ip ?? ''}`).includes(t));
  }, [filas, busqueda]);

  const fallidos24h = (filas ?? []).filter((f) => f.accion === 'Inicio de sesión fallido' && Date.now() - new Date(f.fecha).getTime() < 86_400_000).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoría</h1>
        <p className="text-sm text-slate-500">
          Quién entró al panel, qué cambió y desde qué dirección IP. Sirve para detectar accesos no autorizados. Muestra los últimos 1.000 eventos.
        </p>
      </div>

      {fallidos24h >= 5 && (
        <div className="flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <Icono nombre="alerta" className="mt-0.5 size-4 shrink-0" />
          <p>
            Hubo <strong>{fallidos24h} intentos de inicio de sesión fallidos</strong> en las últimas 24 horas. Si no fueron ustedes, cambien las contraseñas y revisen las
            IP de abajo.
          </p>
        </div>
      )}

      <Tarjeta
        cuerpo="p-0"
        titulo={filas ? `${visibles.length} eventos` : 'Eventos'}
        acciones={
          <div className="relative w-full sm:w-72">
            <Icono nombre="buscar" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar acción, usuario o IP" className={`${claseEntrada} pl-9`} />
          </div>
        }
      >
        {!filas ? (
          <div className="grid h-32 place-items-center text-marca-700">
            <Spinner />
          </div>
        ) : !visibles.length ? (
          <Vacio titulo="Sin eventos" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Usuario</th>
                  <th className="px-4 py-2 font-medium">Acción</th>
                  <th className="px-4 py-2 font-medium">Detalle</th>
                  <th className="px-4 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{fechaHora(f.fecha)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{f.usuario_email ?? '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {f.accion === 'Inicio de sesión fallido' ? <Insignia color="rojo">{f.accion}</Insignia> : f.accion}
                    </td>
                    <td className="max-w-md truncate px-4 py-2 text-slate-600" title={f.detalle}>
                      {f.detalle || '—'}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-500 tabular-nums">{f.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
