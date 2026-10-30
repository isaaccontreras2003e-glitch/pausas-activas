import { useMemo, useState } from 'react';
import { Alerta, Boton, Campo, Entrada, Icono, Insignia, Modal, Tarjeta, Vacio, claseEntrada, useAviso } from '../components/ui.jsx';
import { LogoEmpresa } from '../components/Logos.jsx';
import { api } from '../lib/api.js';
import { numero, quitarTildes } from '../lib/formato.js';
import { useAdmin } from './AdminApp.jsx';

/**
 * Página genérica de catálogo: tabla con búsqueda, crear/editar en modal, activar/desactivar y borrar
 * (solo si no tiene registros; si los tiene, se desactiva para conservar el historial).
 */
function Catalogo({ titulo, descripcion, clave, ruta, singular, tituloNuevo, columnas, campos, vacio, textoBusqueda, accionesExtra, nota }) {
  const { catalogos, recargarCatalogos } = useAdmin();
  const avisar = useAviso();
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(true);
  const [edicion, setEdicion] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState(null);

  const filas = useMemo(() => {
    const t = quitarTildes(busqueda.trim());
    return catalogos[clave].filter((f) => (verInactivos || f.activo) && (!t || quitarTildes(textoBusqueda(f)).includes(t)));
  }, [catalogos, clave, busqueda, verInactivos, textoBusqueda]);
  const activos = catalogos[clave].filter((f) => f.activo).length;

  const abrir = (fila) => {
    setErrores({});
    setEdicion(fila ? { ...fila } : Object.fromEntries(campos.map((c) => [c.nombre, c.inicial ?? ''])));
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const cuerpo = Object.fromEntries(campos.map((c) => [c.nombre, edicion[c.nombre]]));
      if (edicion.id) await api(`${ruta}/${edicion.id}`, { method: 'PUT', body: cuerpo });
      else await api(ruta, { method: 'POST', body: cuerpo });
      await recargarCatalogos();
      avisar(edicion.id ? 'Cambios guardados' : `Se agregó «${cuerpo.nombre}»`);
      setEdicion(null);
    } catch (e) {
      setErrores({ ...e.detalles, general: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (fila) => {
    try {
      await api(`${ruta}/${fila.id}`, { method: 'PUT', body: { activo: !fila.activo } });
      await recargarCatalogos();
      avisar(fila.activo ? `«${fila.nombre}» ya no aparece en el formulario` : `«${fila.nombre}» vuelve a aparecer en el formulario`);
    } catch (e) {
      avisar(e.message, 'error');
    }
  };

  const borrar = async () => {
    try {
      await api(`${ruta}/${aBorrar.id}`, { method: 'DELETE' });
      await recargarCatalogos();
      avisar(`Se eliminó «${aBorrar.nombre}»`);
    } catch (e) {
      avisar(e.message, 'error');
    } finally {
      setABorrar(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          <p className="text-sm text-slate-500">{descripcion}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {accionesExtra}
          <Boton onClick={() => abrir(null)}>
            <Icono nombre="mas" className="size-4" /> Nuevo
          </Boton>
        </div>
      </div>
      {nota}

      <Tarjeta
        cuerpo="p-0"
        titulo={`${numero(activos)} activos de ${numero(catalogos[clave].length)}`}
        acciones={
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} className="size-4 accent-marca-700" />
              Mostrar inactivos
            </label>
            <div className="relative w-full sm:w-64">
              <Icono nombre="buscar" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar…" className={`${claseEntrada} pl-9`} />
            </div>
          </div>
        }
      >
        {!filas.length ? (
          <Vacio titulo={catalogos[clave].length ? 'Sin resultados' : vacio}>{!catalogos[clave].length && 'Usa el botón «Nuevo» para agregar el primero.'}</Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  {columnas.map((c) => (
                    <th key={c.titulo} className="px-4 py-2 font-medium whitespace-nowrap">
                      {c.titulo}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">Registros</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((f) => (
                  <tr key={f.id} className={f.activo ? '' : 'bg-slate-50/60 text-slate-400'}>
                    {columnas.map((c) => (
                      <td key={c.titulo} className="px-4 py-2.5">
                        {c.valor(f)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(f.registros)}</td>
                    <td className="px-4 py-2.5">{f.activo ? <Insignia color="verde">Activo</Insignia> : <Insignia>Inactivo</Insignia>}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Boton variante="fantasma" tamano="sm" onClick={() => abrir(f)} aria-label={`Editar ${f.nombre}`}>
                          <Icono nombre="lapiz" className="size-4" />
                        </Boton>
                        <Boton variante="fantasma" tamano="sm" onClick={() => alternar(f)}>
                          {f.activo ? 'Desactivar' : 'Activar'}
                        </Boton>
                        {!f.registros && (
                          <Boton variante="fantasma" tamano="sm" onClick={() => setABorrar(f)} aria-label={`Eliminar ${f.nombre}`} className="text-red-600">
                            <Icono nombre="basura" className="size-4" />
                          </Boton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Modal
        abierto={!!edicion}
        titulo={edicion?.id ? `Editar ${singular.toLowerCase()}` : tituloNuevo}
        onCerrar={() => setEdicion(null)}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setEdicion(null)}>
              Cancelar
            </Boton>
            <Boton onClick={guardar} cargando={guardando}>
              Guardar
            </Boton>
          </>
        }
      >
        {edicion && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              guardar();
            }}
          >
            {campos.map((c) => (
              <Campo key={c.nombre} etiqueta={c.etiqueta} requerido={c.requerido} error={errores[c.nombre]} ayuda={c.ayuda} htmlFor={`f-${c.nombre}`}>
                {c.render ? (
                  c.render(edicion[c.nombre], (v) => setEdicion({ ...edicion, [c.nombre]: v }), catalogos)
                ) : (
                  <Entrada
                    id={`f-${c.nombre}`}
                    value={edicion[c.nombre] ?? ''}
                    onChange={(e) => setEdicion({ ...edicion, [c.nombre]: e.target.value })}
                    maxLength={c.max}
                    placeholder={c.placeholder}
                  />
                )}
              </Campo>
            ))}
            {errores.general && <Alerta tipo="error">{errores.general}</Alerta>}
            <button type="submit" hidden />
          </form>
        )}
      </Modal>

      <Modal
        abierto={!!aBorrar}
        titulo={`Eliminar ${singular.toLowerCase()}`}
        onCerrar={() => setABorrar(null)}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setABorrar(null)}>
              Cancelar
            </Boton>
            <Boton variante="peligro" onClick={borrar}>
              Eliminar
            </Boton>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          ¿Eliminar <strong>{aBorrar?.nombre}</strong>? Esta acción no se puede deshacer.
        </p>
      </Modal>
    </div>
  );
}

// ───────────────────────── Cargos ─────────────────────────
function InsigniasEmpresas({ ids, catalogos, vacio }) {
  if (!ids.length) return <span className="text-xs text-slate-400">{vacio}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Insignia key={id} color="marca">
          {catalogos.empresas.find((e) => e.id === id)?.nombre}
        </Insignia>
      ))}
    </div>
  );
}

export function Cargos() {
  const { catalogos } = useAdmin();
  const [importar, setImportar] = useState(false);
  const nombresEmpresas = (ids) => ids.map((id) => catalogos.empresas.find((e) => e.id === id)?.nombre ?? '').join(' ');
  return (
    <>
      <Catalogo
        titulo="Cargos"
        descripcion="Listado oficial de cargos por empresa. En el formulario, cada colaborador solo ve los cargos activos de la empresa que elige. Escribe el nombre de una empresa en el buscador para ver solo sus cargos."
        clave="cargos"
        ruta="/api/admin/cargos"
        singular="Cargo"
        tituloNuevo="Nuevo cargo"
        vacio="Aún no hay cargos"
        textoBusqueda={(f) => `${f.nombre} ${f.codigo ?? ''} ${f.area ?? ''} ${nombresEmpresas(f.empresa_ids)}`}
        columnas={[
          { titulo: 'Nombre', valor: (f) => <span className="font-medium">{f.nombre}</span> },
          { titulo: 'Empresas', valor: (f) => <InsigniasEmpresas ids={f.empresa_ids} catalogos={catalogos} vacio="Sin asignar" /> },
          { titulo: 'Código', valor: (f) => <span className="text-slate-500 tabular-nums">{f.codigo ?? '—'}</span> },
        ]}
        campos={[
          { nombre: 'nombre', etiqueta: 'Nombre del cargo', requerido: true, max: 120, placeholder: 'Ej.: Auxiliar de facturación' },
          {
            nombre: 'empresa_ids',
            etiqueta: 'Empresas que tienen este cargo',
            ayuda: 'El cargo solo aparece en el formulario para las empresas marcadas.',
            inicial: [],
            render: SelectorEmpresas,
          },
          { nombre: 'codigo', etiqueta: 'Código', max: 30, ayuda: 'Opcional. Útil para cruzar con nómina.' },
          { nombre: 'area', etiqueta: 'Área', max: 80, placeholder: 'Ej.: Administrativo' },
        ]}
        accionesExtra={
          <>
            <Boton variante="secundario" onClick={() => location.assign('/api/admin/cargos/plantilla')}>
              <Icono nombre="descargar" className="size-4" /> Plantilla
            </Boton>
            <Boton variante="secundario" onClick={() => setImportar(true)}>
              <Icono nombre="subir" className="size-4" /> Importar Excel / CSV
            </Boton>
          </>
        }
      />
      <ModalImportar abierto={importar} onCerrar={() => setImportar(false)} />
    </>
  );
}

function ModalImportar({ abierto, onCerrar }) {
  const { catalogos, recargarCatalogos } = useAdmin();
  const avisar = useAviso();
  const [archivo, setArchivo] = useState(null);
  const [empresaIds, setEmpresaIds] = useState([]);
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const cerrar = () => {
    setArchivo(null);
    setEmpresaIds([]);
    setVista(null);
    setError(null);
    onCerrar();
  };

  const leer = (file) =>
    new Promise((ok, falla) => {
      const lector = new FileReader();
      lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
      lector.onerror = falla;
      lector.readAsDataURL(file);
    });

  const enviar = async (aplicar) => {
    setError(null);
    setCargando(true);
    try {
      const archivo_base64 = await leer(archivo);
      const r = await api('/api/admin/cargos/importar', {
        method: 'POST',
        body: { nombre_archivo: archivo.name, archivo_base64, aplicar, empresa_ids: empresaIds },
      });
      if (aplicar) {
        await recargarCatalogos();
        avisar(`Importación lista: ${r.nuevos.length} nuevos, ${r.actualizados.length} actualizados`);
        cerrar();
      } else setVista(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  // Asignar cargos existentes a una empresa también es un cambio, aunque los nombres no cambien.
  const cambios = vista ? vista.nuevos.length + vista.actualizados.length + (empresaIds.length ? vista.sin_cambios.length : 0) : 0;

  return (
    <Modal
      abierto={abierto}
      titulo="Importar cargos"
      onCerrar={cerrar}
      ancho="max-w-2xl"
      pie={
        <>
          <Boton variante="secundario" onClick={cerrar}>
            Cancelar
          </Boton>
          {!vista ? (
            <Boton onClick={() => enviar(false)} disabled={!archivo} cargando={cargando}>
              Revisar archivo
            </Boton>
          ) : (
            <Boton onClick={() => enviar(true)} disabled={!cambios} cargando={cargando}>
              Aplicar {cambios} cambios
            </Boton>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sube un archivo <strong>.xlsx</strong> o <strong>.csv</strong> cuya primera fila tenga los encabezados <code className="rounded bg-slate-100 px-1">nombre</code>,{' '}
          <code className="rounded bg-slate-100 px-1">codigo</code> (opcional) y <code className="rounded bg-slate-100 px-1">area</code> (opcional). Los cargos que ya existen se
          actualizan; ninguno se borra.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv,.txt"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setVista(null);
            setError(null);
          }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-marca-50 file:px-4 file:py-2 file:font-semibold file:text-marca-800 hover:file:bg-marca-100"
        />
        <Campo etiqueta="Asignar estos cargos a la empresa" ayuda="Se agregan a las empresas marcadas sin quitar las asignaciones que ya tengan.">
          {SelectorEmpresas(empresaIds, setEmpresaIds, catalogos)}
        </Campo>
        {error && <Alerta tipo="error">{error}</Alerta>}
        {vista && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Nuevos', vista.nuevos.length, 'text-emerald-700'],
                ['Actualizados', vista.actualizados.length, 'text-sky-700'],
                ['Sin cambios', vista.sin_cambios.length, 'text-slate-600'],
                ['Con errores', vista.errores.length, 'text-red-700'],
              ].map(([t, n, c]) => (
                <div key={t} className="rounded-lg bg-slate-50 p-3 text-center ring-1 ring-slate-200">
                  <p className={`text-xl font-bold ${c}`}>{n}</p>
                  <p className="text-xs text-slate-500">{t}</p>
                </div>
              ))}
            </div>
            <ListaVista titulo="Nuevos" filas={vista.nuevos} detalle={(f) => [f.codigo, f.area].filter(Boolean).join(' · ')} />
            <ListaVista titulo="Actualizados" filas={vista.actualizados} detalle={(f) => (f.antes.activo ? `antes: ${f.antes.nombre}` : 'se reactivará')} />
            <ListaVista titulo="Errores" filas={vista.errores} detalle={(f) => f.motivo} etiqueta={(f) => `Fila ${f.fila}`} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function ListaVista({ titulo, filas, detalle, etiqueta = (f) => f.nombre }) {
  if (!filas.length) return null;
  return (
    <details className="rounded-lg ring-1 ring-slate-200" open={filas.length <= 8}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
        {titulo} ({filas.length})
      </summary>
      <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 text-sm">
        {filas.map((f) => (
          <li key={`${f.fila}-${etiqueta(f)}`} className="flex justify-between gap-3 px-3 py-1.5">
            <span>{etiqueta(f)}</span>
            <span className="text-right text-slate-500">{detalle(f)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ───────────────────────── Sedes ─────────────────────────
const textoSede = (f) => `${f.nombre} ${f.ciudad} ${f.direccion ?? ''}`;

function SelectorEmpresas(valor, cambiar, catalogos) {
  const seleccion = valor || [];
  if (!catalogos.empresas.length) return <Alerta tipo="aviso">Primero crea al menos una empresa.</Alerta>;
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg p-2 ring-1 ring-slate-200">
      {catalogos.empresas.map((e) => (
        <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
          <input
            type="checkbox"
            className="size-4 accent-marca-700"
            checked={seleccion.includes(e.id)}
            onChange={(ev) => cambiar(ev.target.checked ? [...seleccion, e.id] : seleccion.filter((x) => x !== e.id))}
          />
          {e.nombre}
          {!e.activo && <Insignia>Inactiva</Insignia>}
        </label>
      ))}
    </div>
  );
}

export function Sedes() {
  const { catalogos } = useAdmin();
  const nombreEmpresa = (id) => catalogos.empresas.find((e) => e.id === id)?.nombre;
  return (
    <Catalogo
      titulo="Sedes"
      descripcion="Ubicaciones u oficinas. Cada sede indica qué empresas operan en ella para filtrar el formulario."
      clave="sedes"
      ruta="/api/admin/sedes"
      singular="Sede"
      tituloNuevo="Nueva sede"
      vacio="Aún no hay sedes"
      textoBusqueda={textoSede}
      columnas={[
        { titulo: 'Nombre', valor: (f) => <span className="font-medium">{f.nombre}</span> },
        { titulo: 'Ciudad', valor: (f) => f.ciudad || '—' },
        {
          titulo: 'Empresas',
          valor: (f) => (
            <div className="flex flex-wrap gap-1">
              {f.empresa_ids.map((id) => (
                <Insignia key={id} color="marca">
                  {nombreEmpresa(id)}
                </Insignia>
              ))}
            </div>
          ),
        },
      ]}
      campos={[
        { nombre: 'nombre', etiqueta: 'Nombre de la sede', requerido: true, max: 120, placeholder: 'Ej.: Sede Principal' },
        { nombre: 'ciudad', etiqueta: 'Ciudad', max: 80 },
        { nombre: 'direccion', etiqueta: 'Dirección', max: 200 },
        {
          nombre: 'empresa_ids',
          etiqueta: 'Empresas que operan en esta sede',
          requerido: true,
          inicial: catalogos.empresas.length === 1 ? [catalogos.empresas[0].id] : [],
          render: SelectorEmpresas,
        },
      ]}
    />
  );
}

// ───────────────────────── Empresas ─────────────────────────
const textoEmpresa = (f) => `${f.nombre} ${f.nit ?? ''}`;

export function Empresas() {
  return (
    <Catalogo
      titulo="Empresas"
      descripcion="Razones sociales o filiales cuyos colaboradores participan en las pausas activas."
      clave="empresas"
      ruta="/api/admin/empresas"
      singular="Empresa"
      tituloNuevo="Nueva empresa"
      vacio="Aún no hay empresas"
      textoBusqueda={textoEmpresa}
      columnas={[
        { titulo: 'Logo', valor: (f) => <LogoEmpresa nombre={f.nombre} alto="h-8" className="max-w-36" /> },
        { titulo: 'Nombre', valor: (f) => <span className="font-medium">{f.nombre}</span> },
        { titulo: 'NIT', valor: (f) => <span className="tabular-nums">{f.nit ?? '—'}</span> },
      ]}
      campos={[
        { nombre: 'nombre', etiqueta: 'Razón social', requerido: true, max: 150 },
        { nombre: 'nit', etiqueta: 'NIT', max: 20, placeholder: 'Ej.: 900123456-1' },
      ]}
    />
  );
}
