import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Tarjeta, Vacio } from '../components/ui.jsx';
import { etiquetaPeriodo, etiquetaPeriodoLarga, numero } from '../lib/formato.js';

// Una sola serie por gráfica → un solo color de marca; la identidad la da la etiqueta del eje.
export const porcentaje = (parte, total) => (total ? `${Math.round((parte / total) * 100)} %` : '—');

const COLOR = '#2a72c0';
const COLOR_HOVER = '#1f5fa8';
const TINTA = '#475569';
const REJILLA = '#e2e8f0';

function Globo({ active, payload, titulo }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
      <p className="mb-1 font-semibold">{titulo(d)}</p>
      {d.si === undefined ? (
        <p>
          <span className="text-slate-300">Pausas realizadas:</span> {numero(d.registros)}
        </p>
      ) : (
        <>
          <p>
            <span className="text-slate-300">Realizaron la pausa:</span> {numero(d.si)}
          </p>
          <p>
            <span className="text-slate-300">No la realizaron:</span> {numero(d.no)}
          </p>
          <p>
            <span className="text-slate-300">Cumplimiento:</span> {porcentaje(d.si, d.registros)}
          </p>
        </>
      )}
      {d.personas !== undefined && (
        <p>
          <span className="text-slate-300">Personas únicas:</span> {numero(d.personas)}
        </p>
      )}
    </div>
  );
}

function TablaDatos({ filas, columna }) {
  const conRespuestas = filas[0]?.si !== undefined;
  return (
    <div className="max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
          <tr>
            <th className="py-2 font-medium">{columna}</th>
            {conRespuestas ? (
              <>
                <th className="py-2 text-right font-medium">Sí</th>
                <th className="py-2 text-right font-medium">No</th>
                <th className="py-2 text-right font-medium">Cumpl.</th>
              </>
            ) : (
              <th className="py-2 text-right font-medium">Pausas</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((f) => (
            <tr key={f.id ?? f.etiqueta}>
              <td className="py-1.5 pr-2">{f.etiqueta}</td>
              {conRespuestas ? (
                <>
                  <td className="py-1.5 text-right tabular-nums">{numero(f.si)}</td>
                  <td className="py-1.5 text-right text-slate-500 tabular-nums">{numero(f.no)}</td>
                  <td className="py-1.5 text-right text-slate-500 tabular-nums">{porcentaje(f.si, f.registros)}</td>
                </>
              ) : (
                <td className="py-1.5 text-right tabular-nums">{numero(f.registros)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectorVista({ vista, onCambio }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
      {['Gráfica', 'Tabla'].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onCambio(v)}
          className={`rounded-md px-2.5 py-1 ${vista === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

const truncar = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Etiqueta del eje en una sola línea (Recharts parte el texto si no); el nombre completo queda en el globo. */
function EtiquetaEje({ x, y, payload }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={TINTA} fontSize={12}>
      {truncar(payload.value, 24)}
      <title>{payload.value}</title>
    </text>
  );
}

/** Barras horizontales por categoría (sede, cargo, empresa), ordenadas de mayor a menor. */
export function BarrasCategoria({ titulo, filas, columna, maximo = 10 }) {
  const [vista, setVista] = useState('Gráfica');
  const visibles = filas.slice(0, maximo);
  const resto = filas.length - visibles.length;
  return (
    <Tarjeta titulo={titulo} acciones={filas.length > 0 && <SelectorVista vista={vista} onCambio={setVista} />}>
      {!filas.length ? (
        <Vacio titulo="Sin registros en este período" icono="monitor" />
      ) : vista === 'Tabla' ? (
        <TablaDatos filas={filas} columna={columna} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={visibles.length * 34 + 16}>
            <BarChart data={visibles} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="etiqueta"
                width={160}
                tickLine={false}
                axisLine={false}
                tick={<EtiquetaEje />}
              />
              <Tooltip cursor={{ fill: '#f1f5f9' }} content={<Globo titulo={(d) => d.etiqueta} />} />
              <Bar dataKey="si" fill={COLOR} radius={[0, 4, 4, 0]} maxBarSize={22} activeBar={{ fill: COLOR_HOVER }} isAnimationActive={false}>
                <LabelList dataKey="si" position="right" fill={TINTA} fontSize={12} formatter={numero} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {resto > 0 && (
            <button type="button" onClick={() => setVista('Tabla')} className="mt-2 text-xs font-semibold text-marca-700 hover:underline">
              Ver los {resto} restantes en la tabla
            </button>
          )}
        </>
      )}
    </Tarjeta>
  );
}

/** Registros por hora, día o mes. */
export function SerieTiempo({ serie, granularidad }) {
  const [vista, setVista] = useState('Gráfica');
  const titulo = {
    hora: 'Pausas realizadas por hora (hora indicada por el colaborador)',
    dia: 'Pausas realizadas por día',
    mes: 'Pausas realizadas por mes',
  }[granularidad];
  const filas = serie.map((s) => ({ ...s, etiqueta: etiquetaPeriodoLarga(s.periodo, granularidad) }));
  // En el día, ocultamos la madrugada vacía para que la jornada ocupe el ancho.
  let datos = filas;
  if (granularidad === 'hora' && filas.length === 24) {
    const conDatos = filas.map((f, i) => (f.registros ? i : -1)).filter((i) => i >= 0);
    const ini = Math.min(6, ...conDatos);
    const fin = Math.max(18, ...conDatos);
    datos = filas.slice(ini, fin + 1);
  }
  const total = serie.reduce((s, x) => s + x.registros, 0);
  return (
    <Tarjeta titulo={titulo} acciones={<SelectorVista vista={vista} onCambio={setVista} />}>
      {vista === 'Tabla' ? (
        <TablaDatos filas={filas.filter((f) => f.registros)} columna="Período" />
      ) : !total ? (
        <Vacio titulo="Aún no hay pausas realizadas en este período" icono="monitor">
          Cuando los colaboradores escaneen el QR, aparecerán aquí al instante.
        </Vacio>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={datos} margin={{ top: 16, right: 8, bottom: 0, left: -16 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke={REJILLA} />
            <XAxis
              dataKey="periodo"
              tickFormatter={(p) => etiquetaPeriodo(p, granularidad)}
              tickLine={false}
              axisLine={{ stroke: REJILLA }}
              tick={{ fill: TINTA, fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: TINTA, fontSize: 11 }} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} content={<Globo titulo={(d) => d.etiqueta} />} />
            <Bar dataKey="registros" fill={COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} activeBar={{ fill: COLOR_HOVER }} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Tarjeta>
  );
}
