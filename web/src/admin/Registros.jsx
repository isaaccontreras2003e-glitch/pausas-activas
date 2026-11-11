import { useEffect, useState } from "react";
import {
  Alerta,
  Boton,
  Icono,
  Modal,
  Spinner,
  Tarjeta,
  Vacio,
  claseEntrada,
  useAviso,
} from "../components/ui.jsx";
import { api, qs } from "../lib/api.js";
import { fecha, hora, numero } from "../lib/formato.js";
import Filtros, { filtrosHoy } from "./Filtros.jsx";
import { RespuestaPausa } from "./Monitor.jsx";
import { puedeGestionar, useAdmin } from "./AdminApp.jsx";

export default function Registros() {
  const [filtros, setFiltros] = useState(filtrosHoy);
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const { usuario } = useAdmin();
  const avisar = useAviso();
  const puedeBorrar = puedeGestionar(usuario);
  const [marcados, setMarcados] = useState(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  // Espera a que el usuario deje de escribir antes de buscar.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => setPagina(1), [filtros, busqueda]);
  useEffect(() => setMarcados(new Set()), [filtros, busqueda, pagina]);

  useEffect(() => {
    setCargando(true);
    api(
      `/api/admin/registros?${qs({ ...filtros, q: busqueda, pagina, tamano: 50 })}`,
    )
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch(setError)
      .finally(() => setCargando(false));
  }, [filtros, busqueda, pagina, recarga]);

  const alternar = (id) =>
    setMarcados((m) => {
      const n = new Set(m);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const todosMarcados =
    !!datos?.filas.length && datos.filas.every((f) => marcados.has(f.id));
  const alternarTodos = () =>
    setMarcados(
      todosMarcados ? new Set() : new Set(datos.filas.map((f) => f.id)),
    );

  const eliminar = async () => {
    setBorrando(true);
    try {
      const r = await api("/api/admin/registros", {
        method: "DELETE",
        body: { ids: [...marcados] },
      });
      avisar(`${r.eliminados} registro(s) eliminado(s)`);
      setConfirmar(false);
      setMarcados(new Set());
      setRecarga((n) => n + 1);
    } catch (e) {
      setError(e);
      setConfirmar(false);
    } finally {
      setBorrando(false);
    }
  };

  const exportar = (tipo, formato) => {
    location.assign(
      `/api/admin/exportar?${qs({ ...filtros, q: busqueda, tipo, formato })}`,
    );
  };

  const paginas = datos
    ? Math.max(1, Math.ceil(datos.total / datos.tamano))
    : 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Registros y reportes
        </h1>
        <p className="text-sm text-slate-500">
          Consulta el detalle y descarga los reportes en Excel o CSV con los
          filtros aplicados.
        </p>
      </div>

      <Filtros valor={filtros} onCambio={setFiltros} />

      <Tarjeta titulo="Descargar reportes">
        <div className="grid gap-3 sm:grid-cols-2">
          <OpcionExportar
            titulo="Consolidado"
            descripcion="Quiénes realizaron y quiénes no la pausa, con % de cumplimiento por sede, cargo, empresa y período, más una hoja con el detalle."
            onExcel={() => exportar("consolidado", "xlsx")}
            onCsv={() => exportar("consolidado", "csv")}
          />
          <OpcionExportar
            titulo="Detallado"
            descripcion="Una fila por persona: fecha, nombre, cédula, empresa, sede, cargo, si realizó la pausa, la hora y el motivo si no la hizo."
            onExcel={() => exportar("detallado", "xlsx")}
            onCsv={() => exportar("detallado", "csv")}
          />
        </div>
      </Tarjeta>

      <Tarjeta
        titulo={datos ? `${numero(datos.total)} registros` : "Registros"}
        cuerpo="p-0"
        acciones={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {puedeBorrar && marcados.size > 0 && (
              <Boton
                variante="peligro"
                tamano="sm"
                onClick={() => setConfirmar(true)}
              >
                <Icono nombre="basura" className="size-4" /> Eliminar (
                {marcados.size})
              </Boton>
            )}
            <div className="relative w-full sm:w-72">
              <Icono
                nombre="buscar"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              />
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar por nombre o cédula"
                className={`${claseEntrada} pl-9`}
              />
            </div>
          </div>
        }
      >
        {error && (
          <Alerta tipo="error" className="m-4">
            {error.message}
          </Alerta>
        )}
        {!datos ? (
          <div className="grid h-40 place-items-center text-marca-700">
            <Spinner />
          </div>
        ) : !datos.filas.length ? (
          <Vacio titulo="No hay registros con estos filtros">
            Prueba con otro rango de fechas o quita algún filtro.
          </Vacio>
        ) : (
          <div
            className={`overflow-x-auto transition-opacity ${cargando ? "opacity-60" : ""}`}
          >
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  {puedeBorrar && (
                    <th className="w-10 px-4 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-marca-700"
                        checked={todosMarcados}
                        onChange={alternarTodos}
                        aria-label="Seleccionar todos"
                      />
                    </th>
                  )}
                  {[
                    "Fecha",
                    "Envío",
                    "Nombre",
                    "¿Realizó la pausa?",
                    "Cédula",
                    "Empresa",
                    "Sede",
                    "Cargo",
                    "Punto QR",
                  ].map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2 font-medium whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {datos.filas.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    {puedeBorrar && (
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-marca-700"
                          checked={marcados.has(f.id)}
                          onChange={() => alternar(f.id)}
                          aria-label={`Seleccionar ${f.nombre}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      {fecha(f.registrado_en)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      {hora(f.registrado_en)}
                    </td>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {f.nombre}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <RespuestaPausa fila={f} />
                    </td>
                    <td className="px-4 py-2 text-slate-600 tabular-nums">
                      {f.cedula}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                      {f.empresa}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                      {f.sede}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                      {f.cargo}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                      {f.punto ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {datos && paginas > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">
              Página {datos.pagina} de {paginas}
            </span>
            <div className="flex gap-2">
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </Boton>
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={pagina >= paginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </Boton>
            </div>
          </div>
        )}
      </Tarjeta>

      <Modal
        abierto={confirmar}
        titulo="Eliminar registros"
        onCerrar={() => setConfirmar(false)}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <Boton variante="peligro" onClick={eliminar} cargando={borrando}>
              Sí, eliminar
            </Boton>
          </>
        }
      >
        <p className="text-sm">
          Vas a eliminar <strong>{marcados.size}</strong> registro(s) de forma
          permanente. Esta acción no se puede deshacer y desaparecerán de los
          reportes.
        </p>
      </Modal>
    </div>
  );
}

function OpcionExportar({ titulo, descripcion, onExcel, onCsv }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg p-4 ring-1 ring-slate-200">
      <div>
        <p className="font-semibold">{titulo}</p>
        <p className="text-sm text-slate-500">{descripcion}</p>
      </div>
      <div className="flex gap-2">
        <Boton tamano="sm" onClick={onExcel}>
          <Icono nombre="descargar" className="size-4" /> Excel (.xlsx)
        </Boton>
        <Boton tamano="sm" variante="secundario" onClick={onCsv}>
          <Icono nombre="descargar" className="size-4" /> CSV
        </Boton>
      </div>
    </div>
  );
}
