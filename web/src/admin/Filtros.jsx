import { useMemo } from 'react';
import { Seleccion, claseEntrada } from '../components/ui.jsx';
import { diaBogota } from '../lib/formato.js';
import { useAdmin } from './AdminApp.jsx';

export const filtrosHoy = () => ({ desde: `${diaBogota()}T00:00`, hasta: `${diaBogota()}T23:59`, empresa_id: '', sede_id: '', cargo_id: '', realizo: '' });

const PRESETS = [
  { texto: 'Hoy', rango: () => [diaBogota(), diaBogota()] },
  { texto: 'Ayer', rango: () => [diaBogota(-1), diaBogota(-1)] },
  { texto: '7 días', rango: () => [diaBogota(-6), diaBogota()] },
  { texto: '30 días', rango: () => [diaBogota(-29), diaBogota()] },
  { texto: 'Este mes', rango: () => [`${diaBogota().slice(0, 7)}-01`, diaBogota()] },
];

/** Barra de filtros en una sola fila: rango de fecha/hora + empresa, sede y cargo. */
export default function Filtros({ valor, onCambio, children }) {
  const { usuario, catalogos } = useAdmin();
  const set = (cambios) => onCambio({ ...valor, ...cambios });

  const sedes = useMemo(
    () => (valor.empresa_id ? catalogos.sedes.filter((s) => s.empresa_ids.includes(Number(valor.empresa_id))) : catalogos.sedes),
    [catalogos.sedes, valor.empresa_id],
  );

  const presetActivo = PRESETS.find((p) => {
    const [d, h] = p.rango();
    return valor.desde === `${d}T00:00` && valor.hasta === `${h}T23:59`;
  });

  return (
    <div className="space-y-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.texto}
            type="button"
            onClick={() => {
              const [d, h] = p.rango();
              set({ desde: `${d}T00:00`, hasta: `${h}T23:59` });
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium ${presetActivo === p ? 'bg-marca-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {p.texto}
          </button>
        ))}
        {children && <div className="ml-auto flex flex-wrap gap-2">{children}</div>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Desde</span>
          <input type="datetime-local" className={claseEntrada} value={valor.desde} max={valor.hasta} onChange={(e) => e.target.value && set({ desde: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Hasta</span>
          <input type="datetime-local" className={claseEntrada} value={valor.hasta} min={valor.desde} onChange={(e) => e.target.value && set({ hasta: e.target.value })} />
        </label>
        {!usuario.empresa_id && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Empresa</span>
            <Seleccion value={valor.empresa_id} onChange={(e) => set({ empresa_id: e.target.value, sede_id: '' })}>
              <option value="">Todas</option>
              {catalogos.empresas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </Seleccion>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Sede</span>
          <Seleccion value={valor.sede_id} onChange={(e) => set({ sede_id: e.target.value })}>
            <option value="">Todas</option>
            {sedes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
                {x.ciudad ? ` – ${x.ciudad}` : ''}
              </option>
            ))}
          </Seleccion>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Cargo</span>
          <Seleccion value={valor.cargo_id} onChange={(e) => set({ cargo_id: e.target.value })}>
            <option value="">Todos</option>
            {catalogos.cargos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </Seleccion>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">¿Realizó la pausa?</span>
          <Seleccion value={valor.realizo} onChange={(e) => set({ realizo: e.target.value })}>
            <option value="">Todas las respuestas</option>
            <option value="si">Sí la realizaron</option>
            <option value="no">No la realizaron</option>
          </Seleccion>
        </label>
      </div>
    </div>
  );
}
