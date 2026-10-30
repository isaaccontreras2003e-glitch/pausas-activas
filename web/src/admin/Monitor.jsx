import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alerta, Icono, Insignia, Spinner, Tarjeta, Vacio } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { haceCuanto, hora, horaLegible, localAMs, numero } from '../lib/formato.js';
import { useAdmin } from './AdminApp.jsx';
import Filtros, { filtrosHoy } from './Filtros.jsx';
import { LogoEmpresa, ordenarEmpresas } from '../components/Logos.jsx';
import { BarrasCategoria, SerieTiempo, porcentaje } from './Graficas.jsx';

/** ¿El registro que llegó en vivo cae dentro de los filtros que se están viendo? */
function coincide(reg, f) {
  const t = new Date(reg.registrado_en).getTime();
  if (t < localAMs(f.desde) || t > localAMs(f.hasta, true)) return false;
  if (f.realizo && (f.realizo === 'si') !== !!reg.realizo_pausa) return false;
  return ['empresa_id', 'sede_id', 'cargo_id'].every((k) => !f[k] || Number(f[k]) === reg[k]);
}

export default function Monitor() {
  const { catalogos } = useAdmin();
  const [filtros, setFiltros] = useState(filtrosHoy);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [conectado, setConectado] = useState(false);
  const [nuevos, setNuevos] = useState(() => new Set());
  const [, setTic] = useState(0);
  const refFiltros = useRef(filtros);
  const refTemporizador = useRef(null);
  refFiltros.current = filtros;

  const cargar = useCallback(
    () =>
      api(`/api/admin/resumen?${qs(refFiltros.current)}`)
        .then((d) => {
          setDatos(d);
          setError(null);
        })
        .catch(setError),
    [],
  );

  useEffect(() => {
    cargar();
  }, [filtros, cargar]);

  // Tiempo real: cada registro llega por SSE; se pinta al instante y los consolidados se recalculan con pausa.
  useEffect(() => {
    const fuente = new EventSource('/api/admin/stream');
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false);
    fuente.addEventListener('registro', (e) => {
      const reg = JSON.parse(e.data);
      if (!coincide(reg, refFiltros.current)) return;
      setDatos((d) =>
        d && {
          ...d,
          ultimos: [reg, ...d.ultimos.filter((x) => x.id !== reg.id)].slice(0, 50),
          kpis: {
            ...d.kpis,
            registros: d.kpis.registros + 1,
            si: d.kpis.si + (reg.realizo_pausa ? 1 : 0),
            no: d.kpis.no + (reg.realizo_pausa ? 0 : 1),
            ultimo_registro: reg.registrado_en,
          },
        },
      );
      setNuevos((s) => new Set(s).add(reg.id));
      clearTimeout(refTemporizador.current);
      refTemporizador.current = setTimeout(cargar, 1500);
    });
    const tic = setInterval(() => setTic((t) => t + 1), 15_000);
    const respaldo = setInterval(cargar, 60_000);
    return () => {
      fuente.close();
      clearInterval(tic);
      clearInterval(respaldo);
      clearTimeout(refTemporizador.current);
    };
  }, [cargar]);

  const enVivo = localAMs(filtros.hasta, true) >= Date.now();
  const sinCatalogos = !catalogos.empresas.length || !catalogos.sedes.length || !catalogos.cargos.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitor de pausas activas</h1>
          <p className="text-sm text-slate-500">Participación en tiempo real por sede, cargo y empresa.</p>
        </div>
        {enVivo ? (
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${conectado ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <span className="relative flex size-2.5">
              {conectado && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex size-2.5 rounded-full ${conectado ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </span>
            {conectado ? 'En vivo' : 'Reconectando…'}
          </span>
        ) : (
          <Insignia>Período histórico</Insignia>
        )}
      </div>

      {sinCatalogos && <PrimerosPasos catalogos={catalogos} />}

      <Filtros valor={filtros} onCambio={setFiltros} />

      {error && <Alerta tipo="error">{error.message}</Alerta>}
      {!datos ? (
        <div className="grid h-64 place-items-center text-marca-700">
          <Spinner className="size-8" />
        </div>
      ) : (
        <>
          <Indicadores kpis={datos.kpis} />
          <TarjetasEmpresas filas={datos.por_empresa} empresas={catalogos.empresas.filter((e) => e.activo)} filtro={filtros.empresa_id} onElegir={(id) => setFiltros((f) => ({ ...f, empresa_id: f.empresa_id === String(id) ? '' : String(id), sede_id: '' }))} />
          <SerieTiempo serie={datos.serie} granularidad={datos.granularidad} />
          <div className="grid gap-5 lg:grid-cols-2">
            <BarrasCategoria titulo="Realizaron la pausa · por sede" filas={datos.por_sede} columna="Sede" />
            <BarrasCategoria titulo="Realizaron la pausa · por cargo" filas={datos.por_cargo} columna="Cargo" />
            <PuntosQr filas={datos.por_punto} />
          </div>
          <EnVivo filas={datos.ultimos} nuevos={nuevos} />
        </>
      )}
    </div>
  );
}

function Indicadores({ kpis }) {
  const variacion = kpis.si_periodo_anterior ? Math.round(((kpis.si - kpis.si_periodo_anterior) / kpis.si_periodo_anterior) * 100) : null;
  const tarjetas = [
    {
      titulo: 'Realizaron la pausa',
      valor: numero(kpis.si),
      acento: 'text-emerald-700',
      nota:
        variacion === null ? (
          `${numero(kpis.personas)} personas distintas`
        ) : (
          <span className={variacion >= 0 ? 'text-emerald-700' : 'text-red-700'}>
            {variacion >= 0 ? '▲' : '▼'} {Math.abs(variacion)}% vs. período anterior ({numero(kpis.si_periodo_anterior)})
          </span>
        ),
    },
    {
      titulo: 'No la realizaron',
      valor: numero(kpis.no),
      nota: kpis.no ? 'Filtra por «No» para ver los motivos' : 'Nadie reportó que no la hizo',
    },
    {
      titulo: 'Cumplimiento',
      valor: porcentaje(kpis.si, kpis.registros),
      nota: `${numero(kpis.si)} de ${numero(kpis.registros)} respuestas · ${kpis.sedes_con_registros}/${kpis.sedes_activas} sedes`,
    },
    { titulo: 'Último registro', valor: kpis.ultimo_registro ? hora(kpis.ultimo_registro) : '—', nota: haceCuanto(kpis.ultimo_registro) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tarjetas.map((t) => (
        <div key={t.titulo} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-500">{t.titulo}</p>
          <p className={`mt-1 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl ${t.acento ?? ''}`}>{t.valor}</p>
          <p className="mt-1 text-xs text-slate-500">{t.nota}</p>
        </div>
      ))}
    </div>
  );
}

/** Una tarjeta por empresa, con su logo: tocarla filtra todo el monitor por esa empresa. */
function TarjetasEmpresas({ filas, empresas, filtro, onElegir }) {
  if (!empresas.length) return null;
  return (
    <div className={`grid gap-3 ${empresas.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
      {ordenarEmpresas(empresas).map((e) => {
        const f = filas.find((x) => x.id === e.id) ?? { si: 0, no: 0, registros: 0, personas: 0 };
        const activa = filtro === String(e.id);
        const pct = f.registros ? Math.round((f.si / f.registros) * 100) : null;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onElegir(e.id)}
            aria-pressed={activa}
            title={activa ? 'Quitar filtro de empresa' : `Ver solo ${e.nombre}`}
            className={`rounded-xl bg-white p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${activa ? 'ring-2 ring-marca-600' : 'ring-slate-200'}`}
          >
            <div className="flex h-14 items-center justify-center border-b border-slate-100 pb-3">
              <LogoEmpresa nombre={e.nombre} alto="max-h-11" className="max-w-[80%]" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">{numero(f.si)}</p>
                <p className="text-xs text-slate-500">Sí la hicieron</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-700 tabular-nums">{numero(f.no)}</p>
                <p className="text-xs text-slate-500">No la hicieron</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-marca-700 tabular-nums">{pct === null ? '—' : `${pct} %`}</p>
                <p className="text-xs text-slate-500">Cumplimiento</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full rounded-full bg-marca-600" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PuntosQr({ filas }) {
  const sinUso = filas.filter((f) => !f.registros).length;
  return (
    <Tarjeta titulo="Uso por punto QR" acciones={sinUso > 0 && <Insignia color="ambar">{sinUso} sin registros</Insignia>}>
      {!filas.length ? (
        <Vacio titulo="No hay puntos QR creados" icono="qr" />
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 font-medium">Punto</th>
                <th className="py-2 text-right font-medium">Sí</th>
                <th className="py-2 text-right font-medium">No</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="py-1.5 pr-2">
                    <span className="block">{f.etiqueta}</span>
                    <span className="block text-xs text-slate-500">{f.sede ?? 'Todas las sedes'}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{f.registros ? numero(f.si) : <Insignia color="ambar">0</Insignia>}</td>
                  <td className="py-1.5 text-right text-slate-500 tabular-nums">{f.registros ? numero(f.no) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

function EnVivo({ filas, nuevos }) {
  return (
    <Tarjeta
      titulo="Últimos registros"
      cuerpo="p-0"
      acciones={
        <Link to="/admin/registros" className="text-sm font-semibold text-marca-700 hover:underline">
          Ver todos →
        </Link>
      }
    >
      {!filas.length ? (
        <Vacio titulo="Sin registros todavía" icono="bandeja" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Envío</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">¿Realizó la pausa?</th>
                <th className="px-4 py-2 font-medium">Cédula</th>
                <th className="px-4 py-2 font-medium">Cargo</th>
                <th className="px-4 py-2 font-medium">Sede</th>
                <th className="px-4 py-2 font-medium">Empresa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.slice(0, 20).map((f) => (
                <tr key={f.id} className={nuevos.has(f.id) ? 'animar-resaltar' : ''}>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{hora(f.registrado_en)}</td>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    {f.nombre}
                    {nuevos.has(f.id) && (
                      <span className="ml-2 inline-flex">
                        <Insignia color="marca">Nuevo</Insignia>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <RespuestaPausa fila={f} />
                  </td>
                  <td className="px-4 py-2 text-slate-600 tabular-nums">{f.cedula}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">{f.cargo}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">{f.sede}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">{f.empresa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

/** «Sí · 10:05 a. m.» o «No» con el motivo como texto secundario. */
export function RespuestaPausa({ fila }) {
  return fila.realizo_pausa ? (
    <span className="inline-flex items-center gap-1.5">
      <Insignia color="verde">Sí</Insignia>
      <span className="tabular-nums">{horaLegible(fila.hora_pausa)}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <Insignia color="rojo">No</Insignia>
      {fila.motivo_no && <span className="max-w-56 truncate text-xs text-slate-500" title={fila.motivo_no}>{fila.motivo_no}</span>}
    </span>
  );
}

function PrimerosPasos({ catalogos }) {
  const pasos = [
    { hecho: catalogos.empresas.length > 0, texto: 'Crea las empresas', a: '/admin/empresas' },
    { hecho: catalogos.sedes.length > 0, texto: 'Crea las sedes y asígnales empresas', a: '/admin/sedes' },
    { hecho: catalogos.cargos.length > 0, texto: 'Carga el listado oficial de cargos', a: '/admin/cargos' },
    { hecho: false, texto: 'Imprime o envía el QR principal', a: '/admin/qr' },
  ];
  return (
    <Tarjeta titulo="Primeros pasos">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {pasos.map((p, i) => (
          <li key={p.a}>
            <Link to={p.a} className={`flex items-center gap-3 rounded-lg p-3 ring-1 ring-inset ${p.hecho ? 'bg-emerald-50 ring-emerald-200' : 'ring-slate-200 hover:bg-slate-50'}`}>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${p.hecho ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {p.hecho ? <Icono nombre="check" className="size-4" /> : i + 1}
              </span>
              <span className="text-sm font-medium">{p.texto}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Tarjeta>
  );
}
