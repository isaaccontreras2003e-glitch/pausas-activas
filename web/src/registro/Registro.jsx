import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FranjaLogos, LogoEmpresa, ordenarEmpresas } from '../components/Logos.jsx';
import SelectorBuscable from '../components/SelectorBuscable.jsx';
import { Alerta, Boton, Campo, Entrada, Icono, Seleccion, Spinner } from '../components/ui.jsx';
import { ErrorApi, api } from '../lib/api.js';
import { fechaLarga, hora, horaLegible } from '../lib/formato.js';
import { enviarPendientes, guardarPendiente, hayPendientes } from './cola.js';
import { borrarPerfil, guardarCatalogo, guardarPerfil, leerCatalogo, leerPerfil } from './perfil.js';

const RE_NOMBRE = /^\p{L}[\p{L}\s'.-]*$/u;

/** Igual que en el servidor: "  maría   PÉREZ " → "María Pérez". */
const normalizarNombre = (s) =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-CO')
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'));
const VACIO = { nombre: '', cedula: '', empresa_id: '', sede_id: '', cargo_id: '', acepta: false, realizo_pausa: null, hora_pausa: '', motivo_no: '' };

export const MOTIVOS_NO = [
  'Carga laboral / no tuve tiempo',
  'Estaba en reunión o fuera de mi puesto',
  'No me enteré de la pausa',
  'Por salud, incapacidad o restricción médica',
  'Otro motivo',
];

/** 'HH:MM' de ahora en Bogotá. */
const horaActual = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(11, 16);
const aMinutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Datos que se recuerdan en el celular (no las respuestas de la pausa). */
const datosPersonales = ({ nombre, cedula, empresa_id, sede_id, cargo_id, acepta }) => ({ nombre, cedula, empresa_id, sede_id, cargo_id, acepta });

function validarPausa(f) {
  const e = {};
  if (f.realizo_pausa === null) e.realizo_pausa = 'Indica si realizaste la pausa activa.';
  else if (f.realizo_pausa) {
    if (!/^\d{2}:\d{2}$/.test(f.hora_pausa)) e.hora_pausa = 'Indica a qué hora la realizaste.';
    else if (aMinutos(f.hora_pausa) > aMinutos(horaActual()) + 10) e.hora_pausa = 'La hora no puede ser posterior a la hora actual.';
  }
  return e;
}

const validar = (f) => ({ ...validarPersonales(f), ...validarPausa(f) });

function validarPersonales(f) {
  const e = {};
  const nombre = f.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre) e.nombre = 'Escribe tu nombre completo.';
  else if (nombre.length < 5) e.nombre = 'El nombre es muy corto.';
  else if (!RE_NOMBRE.test(nombre)) e.nombre = 'El nombre solo puede contener letras y espacios.';
  else if (nombre.split(' ').length < 2) e.nombre = 'Escribe al menos un nombre y un apellido.';
  if (!f.cedula) e.cedula = 'Escribe tu número de cédula.';
  else if (!/^\d{5,15}$/.test(f.cedula)) e.cedula = 'La cédula debe tener entre 5 y 15 números.';
  if (!f.empresa_id) e.empresa_id = 'Selecciona tu empresa.';
  if (!f.sede_id) e.sede_id = 'Selecciona tu sede.';
  if (!f.cargo_id) e.cargo_id = 'Selecciona tu cargo.';
  if (!f.acepta) e.acepta = 'Debes autorizar el tratamiento de datos para registrarte.';
  return e;
}

const sedesDe = (datos, empresaId) =>
  empresaId ? datos.sedes.filter((s) => datos.empresa_sede.some((v) => v.empresa_id === empresaId && v.sede_id === s.id)) : [];

/** Cargos de la empresa elegida (si la empresa no tiene cargos asignados, todos). */
function cargosDe(datos, empresaId) {
  if (!empresaId) return [];
  const ids = new Set(datos.empresa_cargo.filter((v) => v.empresa_id === empresaId).map((v) => v.cargo_id));
  return ids.size ? datos.cargos.filter((c) => ids.has(c.id)) : datos.cargos;
}

/** Valores iniciales: lo guardado en el celular, la sede del QR y autoselección cuando hay una sola opción. */
function formularioInicial(datos) {
  const perfil = leerPerfil() ?? {};
  const existe = (lista, id) => lista.some((x) => x.id === id);
  const f = { ...VACIO, nombre: perfil.nombre ?? '', cedula: perfil.cedula ?? '', acepta: perfil.acepta === true };

  const sedeQr = datos.punto.sede_id;
  const empresasDeSedeQr = sedeQr ? datos.empresa_sede.filter((v) => v.sede_id === sedeQr).map((v) => v.empresa_id) : [];
  if (existe(datos.empresas, perfil.empresa_id) && (!sedeQr || empresasDeSedeQr.includes(perfil.empresa_id))) f.empresa_id = perfil.empresa_id;
  else if (empresasDeSedeQr.length === 1) f.empresa_id = empresasDeSedeQr[0];
  else if (datos.empresas.length === 1) f.empresa_id = datos.empresas[0].id;

  const sedes = sedesDe(datos, f.empresa_id);
  if (sedeQr && existe(sedes, sedeQr)) f.sede_id = sedeQr;
  else if (existe(sedes, perfil.sede_id)) f.sede_id = perfil.sede_id;
  else if (sedes.length === 1) f.sede_id = sedes[0].id;

  if (existe(cargosDe(datos, f.empresa_id), perfil.cargo_id)) f.cargo_id = perfil.cargo_id;
  return f;
}

export default function Registro({ token: tokenFijo }) {
  const params = useParams();
  const token = tokenFijo ?? params.token;
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [modoRapido, setModoRapido] = useState(false);
  const [sinSenal, setSinSenal] = useState(false);

  const usarDatos = (d) => {
    setDatos(d);
    const inicial = formularioInicial(d);
    setForm(inicial);
    setModoRapido(Object.keys(validarPersonales(inicial)).length === 0);
  };

  const cargar = () => {
    setErrorCarga(null);
    api(`/api/public/punto/${encodeURIComponent(token)}`, { timeout: 15_000 })
      .then((d) => {
        guardarCatalogo(token, d);
        setSinSenal(false);
        usarDatos(d);
      })
      .catch((e) => {
        // Sin señal: se usa la copia de la última vez para que la persona pueda llenar el formulario igual.
        const copia = e.codigo === 'SIN_CONEXION' ? leerCatalogo(token) : null;
        if (copia) {
          setSinSenal(true);
          usarDatos(copia);
        } else setErrorCarga(e);
      });
  };
  useEffect(cargar, [token]);

  // Copia del formulario en el celular para abrirlo con mala señal (solo en https o en este PC).
  useEffect(() => {
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  // Reenvío automático de lo que quedó guardado sin señal: al abrir, al volver la conexión y cada 20 s.
  useEffect(() => {
    const intentar = async () => {
      if (!hayPendientes()) return;
      const entregados = await enviarPendientes();
      if (entregados && !hayPendientes()) {
        setSinSenal(false);
        setResultado((r) => (r?.tipo === 'pendiente' ? { ...r, tipo: 'entregado' } : r));
      }
    };
    intentar();
    window.addEventListener('online', intentar);
    const t = setInterval(intentar, 20_000);
    return () => {
      window.removeEventListener('online', intentar);
      clearInterval(t);
    };
  }, []);

  const sedes = useMemo(() => (datos ? sedesDe(datos, form.empresa_id) : []), [datos, form.empresa_id]);
  const opcionesCargo = useMemo(
    () => (datos ? cargosDe(datos, form.empresa_id) : []).map((c) => ({ value: c.id, label: c.nombre, detalle: c.area })),
    [datos, form.empresa_id],
  );
  const nombreDe = (lista, id) => lista?.find((x) => x.id === id)?.nombre ?? '';

  const cambiar = (campo, valor) => {
    setForm((f) => {
      const nuevo = { ...f, [campo]: valor };
      if (campo === 'realizo_pausa' && valor && !f.hora_pausa) nuevo.hora_pausa = horaActual();
      if (campo === 'empresa_id') {
        if (!cargosDe(datos, valor).some((c) => c.id === f.cargo_id)) nuevo.cargo_id = '';
        const disponibles = sedesDe(datos, valor);
        if (!disponibles.some((s) => s.id === f.sede_id)) {
          nuevo.sede_id = disponibles.some((s) => s.id === datos.punto.sede_id) ? datos.punto.sede_id : disponibles.length === 1 ? disponibles[0].id : '';
        }
      }
      return nuevo;
    });
    setErrores((e) => ({ ...e, [campo]: undefined }));
  };

  const enviar = async (e) => {
    e?.preventDefault();
    setErrorEnvio(null);
    const errs = validar(form);
    setErrores(errs);
    if (Object.keys(errs).length) {
      // En modo rápido solo se sale al formulario completo si el problema está en los datos personales.
      if (Object.keys(validarPersonales(form)).length) setModoRapido(false);
      setTimeout(() => document.getElementById(`campo-${Object.keys(errs)[0]}`)?.focus(), 0);
      return;
    }
    setEnviando(true);
    try {
      const cuerpo = {
        token,
        ...form,
        nombre: form.nombre.trim(),
        hora_pausa: form.realizo_pausa ? form.hora_pausa : null,
        motivo_no: form.realizo_pausa ? null : form.motivo_no || null,
      };
      let r;
      try {
        r = await api('/api/public/registro', { method: 'POST', body: cuerpo, timeout: 15_000 });
      } catch (err) {
        if (err.codigo !== 'SIN_CONEXION') throw err;
        // Sin señal: el registro queda guardado en el celular y se envía solo cuando vuelva la conexión.
        guardarPendiente(cuerpo);
        guardarPerfil({ ...datosPersonales(form), nombre: normalizarNombre(form.nombre) });
        setResultado({ tipo: 'pendiente', nombre: normalizarNombre(form.nombre), hora_pausa: cuerpo.hora_pausa, realizo_pausa: form.realizo_pausa });
        return;
      }
      guardarPerfil({ ...datosPersonales(form), nombre: r.nombre });
      setResultado({ tipo: 'exito', ...r });
    } catch (err) {
      if (err.codigo === 'YA_REGISTRADO') {
        guardarPerfil({ ...datosPersonales(form), nombre: normalizarNombre(form.nombre) });
        setResultado({ tipo: 'repetido', mensaje: err.message });
      } else if (err.codigo === 'QR_INVALIDO') {
        setErrorCarga(err);
      } else if (err.status === 422) {
        setErrores(err.detalles ?? {});
        setModoRapido(false);
        setErrorEnvio(err.message);
        // Un cargo o sede pudo desactivarse: recargamos catálogos sin perder lo escrito.
        api(`/api/public/punto/${encodeURIComponent(token)}`).then(setDatos).catch(() => {});
      } else {
        setErrorEnvio(err instanceof ErrorApi ? err.message : 'Ocurrió un error. Intenta de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const otraPersona = () => {
    borrarPerfil();
    const inicial = formularioInicial(datos);
    setForm({ ...inicial, nombre: '', cedula: '', cargo_id: '', acepta: false });
    setErrores({});
    setResultado(null);
    setModoRapido(false);
    window.scrollTo(0, 0);
  };

  if (errorCarga) return <PantallaError error={errorCarga} onReintentar={cargar} />;
  if (!datos) {
    return (
      <div className="grid min-h-dvh place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <Encabezado organizacion={datos.config.organizacion} punto={token === 'principal' ? null : datos.punto} />
      <main className="relative mx-auto -mt-10 max-w-md px-4 pb-10">
        {sinSenal && !resultado && (
          <Alerta tipo="aviso" className="mb-3 shadow-lg">
            Estás con poca señal o sin internet. Puedes llenar el formulario igual: si no se puede enviar, quedará guardado en tu celular y se enviará solo.
          </Alerta>
        )}
        {resultado ? (
          <Resultado resultado={resultado} mensajeExito={datos.config.mensaje_exito} onOtraPersona={otraPersona} />
        ) : modoRapido ? (
          <TarjetaRapida
            form={form}
            empresa={nombreDe(datos.empresas, form.empresa_id)}
            sede={nombreDe(sedes, form.sede_id)}
            cargo={nombreDe(datos.cargos, form.cargo_id)}
            enviando={enviando}
            error={errorEnvio}
            errores={errores}
            cambiar={cambiar}
            onRegistrar={enviar}
            onEditar={() => setModoRapido(false)}
            onOtraPersona={otraPersona}
          />
        ) : (
          <form onSubmit={enviar} noValidate className="animar-aparecer space-y-5 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-slate-200">
            <div>
              <h1 className="text-lg font-bold">Registra tu pausa activa</h1>
              <p className="text-sm text-slate-500">Toma menos de un minuto. Los campos con * son obligatorios.</p>
            </div>

            <Campo etiqueta="Nombre completo" requerido error={errores.nombre} htmlFor="campo-nombre">
              <Entrada
                id="campo-nombre"
                value={form.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                placeholder="Ej.: María Pérez Gómez"
                maxLength={150}
                className="h-12"
                error={errores.nombre}
              />
            </Campo>

            <Campo etiqueta="Número de cédula" requerido error={errores.cedula} ayuda="Solo números, sin puntos ni espacios." htmlFor="campo-cedula">
              <Entrada
                id="campo-cedula"
                value={form.cedula}
                onChange={(e) => cambiar('cedula', e.target.value.replace(/\D/g, '').slice(0, 15))}
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="Ej.: 1045123456"
                className="h-12 tracking-wide"
                error={errores.cedula}
              />
            </Campo>

            <div>
              <p id="etiqueta-empresa" className="mb-1.5 block text-sm font-medium text-slate-700">
                ¿En qué empresa trabajas? <span className="text-red-600">*</span>
              </p>
              <SelectorEmpresa empresas={datos.empresas} valor={form.empresa_id} onCambio={(v) => cambiar('empresa_id', v)} error={errores.empresa_id} />
              {errores.empresa_id && (
                <p className="mt-1.5 text-sm text-red-600" role="alert">
                  {errores.empresa_id}
                </p>
              )}
            </div>

            <Campo
              etiqueta="Sede"
              requerido
              error={errores.sede_id}
              ayuda={!form.empresa_id ? 'Primero selecciona la empresa.' : undefined}
              htmlFor="campo-sede_id"
            >
              {form.empresa_id && !sedes.length && (
                <Alerta tipo="aviso" className="mb-2">
                  Tu empresa todavía no tiene sedes configuradas, por eso aún no puedes registrarte. Avisa al equipo de SST.
                </Alerta>
              )}
              <Seleccion
                id="campo-sede_id"
                value={form.sede_id}
                onChange={(e) => cambiar('sede_id', Number(e.target.value) || '')}
                disabled={!form.empresa_id}
                className="h-12"
                error={errores.sede_id}
              >
                <option value="">Selecciona tu sede…</option>
                {sedes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                    {x.ciudad ? ` – ${x.ciudad}` : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo
              etiqueta="Cargo"
              requerido
              error={errores.cargo_id}
              ayuda={!form.empresa_id ? 'Primero selecciona la empresa.' : undefined}
              htmlFor="campo-cargo_id"
            >
              <SelectorBuscable
                id="campo-cargo_id"
                titulo="Cargo"
                opciones={opcionesCargo}
                valor={form.cargo_id}
                onCambio={(v) => cambiar('cargo_id', v)}
                placeholder="Busca y selecciona tu cargo…"
                deshabilitado={!form.empresa_id}
                error={errores.cargo_id}
              />
            </Campo>

            <PreguntasPausa form={form} errores={errores} cambiar={cambiar} />

            <Consentimiento texto={datos.config.texto_tratamiento_datos} valor={form.acepta} onCambio={(v) => cambiar('acepta', v)} error={errores.acepta} />

            {errorEnvio && <Alerta tipo="error">{errorEnvio}</Alerta>}

            <Boton type="submit" tamano="lg" cargando={enviando} className="w-full text-lg">
              {enviando ? 'Enviando…' : 'Enviar registro'}
            </Boton>
          </form>
        )}
      </main>
    </div>
  );
}

/** La empresa se elige tocando su logo. */
function SelectorEmpresa({ empresas, valor, onCambio, error }) {
  return (
    <div
      id="campo-empresa_id"
      tabIndex={-1}
      role="radiogroup"
      aria-labelledby="etiqueta-empresa"
      className={`grid gap-2.5 ${empresas.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
    >
      {ordenarEmpresas(empresas).map((e) => {
        const activa = valor === e.id;
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={activa}
            aria-label={e.nombre}
            onClick={() => onCambio(e.id)}
            className={`relative flex h-20 items-center justify-center rounded-xl bg-white p-2.5 ring-2 transition-all ring-inset ${
              activa ? 'shadow-md ring-marca-600' : error ? 'ring-red-300' : 'ring-slate-200 hover:ring-slate-300'
            }`}
          >
            <LogoEmpresa nombre={e.nombre} alto="max-h-12" className="max-w-full" />
            {activa && (
              <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-marca-600 text-white shadow">
                <Icono nombre="check" className="size-4" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Encabezado({ organizacion, punto }) {
  return (
    <header>
      <div className="border-b border-slate-200 bg-white pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <FranjaLogos alto="h-9" className="mx-auto max-w-md px-4" />
      </div>
      <div className="bg-marca-700 text-white">
      <div className="mx-auto max-w-md px-5 pt-5 pb-16">
      <p className="text-2xl leading-tight font-bold">Pausas Activas</p>
      {punto ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-marca-50">
          <Icono nombre="ubicacion" className="size-4 shrink-0" />
          <span className="truncate">
            {punto.descripcion}
            {punto.sede_nombre ? ` · ${punto.sede_nombre}` : ''}
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-marca-50">Registro diario de pausas activas</p>
      )}
      </div>
      </div>
    </header>
  );
}

/** "¿Realizaste la pausa activa?" Sí/No + hora (si sí) o motivo opcional (si no). */
function PreguntasPausa({ form, errores, cambiar }) {
  const opcion = (valor, texto, icono) => {
    const activo = form.realizo_pausa === valor;
    const color = valor ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-slate-700 text-white ring-slate-700';
    return (
      <button
        type="button"
        role="radio"
        aria-checked={activo}
        onClick={() => cambiar('realizo_pausa', valor)}
        className={`flex h-14 items-center justify-center gap-2 rounded-xl text-base font-semibold ring-2 ring-inset transition-colors ${activo ? color : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
      >
        <Icono nombre={icono} className="size-5" />
        {texto}
      </button>
    );
  };

  return (
    <fieldset className="space-y-4 rounded-xl bg-marca-50/60 p-4 ring-1 ring-marca-100">
      <legend className="sr-only">Pausa activa</legend>
      <div>
        <p id="pregunta-realizo" className="mb-2 text-base font-semibold text-slate-900">
          ¿Realizaste la pausa activa? <span className="text-red-600">*</span>
        </p>
        <div id="campo-realizo_pausa" tabIndex={-1} role="radiogroup" aria-labelledby="pregunta-realizo" className="grid grid-cols-2 gap-3">
          {opcion(true, 'Sí', 'check')}
          {opcion(false, 'No', 'x')}
        </div>
        {errores.realizo_pausa && (
          <p className="mt-1.5 text-sm text-red-600" role="alert">
            {errores.realizo_pausa}
          </p>
        )}
      </div>

      {form.realizo_pausa === true && (
        <Campo etiqueta="¿A qué hora la realizaste?" requerido error={errores.hora_pausa} ayuda="Pusimos la hora actual; cámbiala si la hiciste antes." htmlFor="campo-hora_pausa">
          <Entrada
            id="campo-hora_pausa"
            type="time"
            value={form.hora_pausa}
            max={horaActual()}
            onChange={(e) => cambiar('hora_pausa', e.target.value)}
            className="h-12 text-lg"
            error={errores.hora_pausa}
          />
        </Campo>
      )}

      {form.realizo_pausa === false && (
        <Campo etiqueta="¿Por qué no la realizaste? (opcional)" htmlFor="campo-motivo_no">
          <Seleccion id="campo-motivo_no" value={form.motivo_no} onChange={(e) => cambiar('motivo_no', e.target.value)} className="h-12">
            <option value="">Prefiero no decirlo</option>
            {MOTIVOS_NO.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Seleccion>
        </Campo>
      )}
    </fieldset>
  );
}

function Consentimiento({ texto, valor, onCambio, error }) {
  const [verMas, setVerMas] = useState(false);
  return (
    <div>
      <label className={`flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-inset ${error ? 'bg-red-50 ring-red-300' : 'bg-slate-50 ring-slate-200'}`}>
        <input
          id="campo-acepta"
          type="checkbox"
          checked={valor}
          onChange={(e) => onCambio(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-marca-700"
        />
        <span className="text-sm text-slate-700">
          Autorizo el tratamiento de mis datos personales para el programa de pausas activas.{' '}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setVerMas((v) => !v);
            }}
            className="font-semibold text-marca-700 underline underline-offset-2"
          >
            {verMas ? 'Ocultar' : 'Leer más'}
          </button>
          {verMas && <span className="mt-2 block text-xs leading-relaxed text-slate-600">{texto}</span>}
        </span>
      </label>
      {error && (
        <p className="mt-1.5 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TarjetaRapida({ form, empresa, sede, cargo, enviando, error, errores, cambiar, onRegistrar, onEditar, onOtraPersona }) {
  const primerNombre = normalizarNombre(form.nombre).split(' ')[0];
  return (
    <div className="animar-aparecer space-y-5 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-slate-200">
      <div>
        <h1 className="text-xl font-bold">¡Hola, {primerNombre}! 👋</h1>
        <p className="text-sm text-slate-500">Tus datos ya están guardados. Solo responde sobre tu pausa activa.</p>
      </div>
      <PreguntasPausa form={form} errores={errores} cambiar={cambiar} />
      <dl className="divide-y divide-slate-100 rounded-lg bg-slate-50 px-4 text-sm ring-1 ring-slate-200">
        {[
          ['Nombre', normalizarNombre(form.nombre)],
          ['Cédula', form.cedula],
          ['Empresa', empresa],
          ['Sede', sede],
          ['Cargo', cargo],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium text-slate-900">{k === 'Empresa' ? <LogoEmpresa nombre={v} alto="h-7" /> : v}</dd>
          </div>
        ))}
      </dl>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <Boton tamano="lg" cargando={enviando} onClick={onRegistrar} className="w-full text-lg">
        {enviando ? 'Enviando…' : 'Enviar registro'}
      </Boton>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onEditar} className="py-2 font-semibold text-marca-700">
          Cambiar mis datos
        </button>
        <button type="button" onClick={onOtraPersona} className="py-2 font-semibold text-slate-500">
          No soy {primerNombre}
        </button>
      </div>
    </div>
  );
}

function Resultado({ resultado, mensajeExito, onOtraPersona }) {
  if (resultado.tipo === 'pendiente' || resultado.tipo === 'entregado') {
    const entregado = resultado.tipo === 'entregado';
    return (
      <div className="animar-aparecer rounded-2xl bg-white p-6 text-center shadow-lg ring-1 ring-slate-200" role="status" aria-live="polite">
        <div className={`animar-escala mx-auto mb-4 grid size-20 place-items-center rounded-full ${entregado ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
          {entregado ? <Icono nombre="check" className="size-10" /> : <Spinner className="size-9" />}
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{entregado ? '¡Registro enviado!' : 'Registro guardado en tu celular'}</h1>
        <p className="mt-1 text-lg font-medium text-slate-700">{resultado.nombre}</p>
        {resultado.realizo_pausa && (
          <p className="mt-2 text-slate-600">
            Pausa activa a las <strong>{horaLegible(resultado.hora_pausa)}</strong>
          </p>
        )}
        <p className={`mt-5 rounded-lg p-3 text-sm ${entregado ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          {entregado
            ? 'Volvió la conexión y tu registro ya llegó. ¡Gracias por cuidarte! 💪'
            : 'No hay señal en este momento, pero tu registro NO se perdió: se enviará solo apenas vuelva la conexión. Si puedes, deja esta página abierta unos minutos; si la cierras, se enviará la próxima vez que abras el QR.'}
        </p>
      </div>
    );
  }
  const exito = resultado.tipo === 'exito';
  return (
    <div className="animar-aparecer rounded-2xl bg-white p-6 text-center shadow-lg ring-1 ring-slate-200" role="status">
      <div className={`animar-escala mx-auto mb-4 grid size-20 place-items-center rounded-full ${exito ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
        {exito ? (
          <svg viewBox="0 0 24 24" className="size-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path className="check-trazo" d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        ) : (
          <Icono nombre="info" className="size-10" />
        )}
      </div>
      {exito && resultado.realizo_pausa ? (
        <>
          <h1 className="text-2xl font-bold text-slate-900">¡Registro exitoso!</h1>
          <p className="mt-1 text-lg font-medium text-slate-700">{resultado.nombre}</p>
          <p className="mt-4 text-sm text-slate-500">Pausa activa realizada a las</p>
          <p className="text-3xl font-bold tracking-tight text-marca-700">{horaLegible(resultado.hora_pausa)}</p>
          <p className="text-sm text-slate-500 first-letter:uppercase">{fechaLarga(resultado.registrado_en)}</p>
          <p className="mt-3 text-sm text-slate-600">
            {resultado.sede} · {resultado.cargo}
          </p>
          <p className="mt-5 rounded-lg bg-marca-50 p-3 text-sm font-medium text-marca-900">{mensajeExito} 💪</p>
        </>
      ) : exito ? (
        <>
          <h1 className="text-2xl font-bold text-slate-900">Respuesta registrada</h1>
          <p className="mt-1 text-lg font-medium text-slate-700">{resultado.nombre}</p>
          <p className="mt-1 text-sm text-slate-500">
            {fechaLarga(resultado.registrado_en)} · {hora(resultado.registrado_en)}
          </p>
          <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
            Gracias por contarnos. Unos minutos de pausa activa ayudan a prevenir dolores y lesiones. ¡Te esperamos en la próxima!
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-900">Ya estás registrado</h1>
          <p className="mt-2 text-slate-600">{resultado.mensaje}</p>
        </>
      )}
      <p className="mt-6 text-xs text-slate-400">Ya puedes cerrar esta página.</p>
      <button type="button" onClick={onOtraPersona} className="mt-2 py-2 text-sm font-semibold text-marca-700">
        Registrar a otra persona en este celular
      </button>
    </div>
  );
}

function PantallaError({ error, onReintentar }) {
  const qrInvalido = error.codigo === 'QR_INVALIDO';
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-amber-100 text-amber-600">
          <Icono nombre={qrInvalido ? 'qr' : 'alerta'} className="size-8" />
        </div>
        <h1 className="text-xl font-bold">{qrInvalido ? 'Código QR no válido' : 'No pudimos cargar el formulario'}</h1>
        <p className="mt-2 text-slate-600">{error.message}</p>
        {!qrInvalido && (
          <Boton className="mt-6" onClick={onReintentar}>
            <Icono nombre="recargar" className="size-4" /> Reintentar
          </Boton>
        )}
      </div>
    </div>
  );
}

export function SinCodigo() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-marca-100 text-marca-700">
          <Icono nombre="qr" className="size-8" />
        </div>
        <h1 className="text-xl font-bold">Escanea el código QR</h1>
        <p className="mt-2 text-slate-600">Para registrar tu pausa activa, escanea el código QR del afiche o abre el enlace que te envió el equipo de SST.</p>
      </div>
    </div>
  );
}
