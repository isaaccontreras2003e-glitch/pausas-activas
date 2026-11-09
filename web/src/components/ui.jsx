import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

const VARIANTES = {
  primario: 'bg-marca-700 text-white hover:bg-marca-800 active:bg-marca-900 disabled:bg-slate-300',
  secundario: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400',
  peligro: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-slate-300',
  fantasma: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400',
};
const TAMANOS = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-14 px-6 text-base gap-2',
};

/** Clases de botón, también para enlaces <a> que deben verse como botón. */
export const claseBoton = (variante = 'primario', tamano = 'md') =>
  `inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-600 disabled:cursor-not-allowed ${VARIANTES[variante]} ${TAMANOS[tamano]}`;

export function Boton({ variante = 'primario', tamano = 'md', cargando = false, className = '', children, disabled, ...props }) {
  return (
    <button type="button" disabled={disabled || cargando} className={`${claseBoton(variante, tamano)} ${className}`} {...props}>
      {cargando && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export const claseEntrada =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-marca-600 disabled:bg-slate-100 sm:text-sm';

export function Campo({ etiqueta, error, ayuda, children, requerido, htmlFor, className = '' }) {
  return (
    <div className={className}>
      {etiqueta && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
          {etiqueta}
          {requerido && <span className="text-red-600"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : (
        ayuda && <p className="mt-1.5 text-xs text-slate-500">{ayuda}</p>
      )}
    </div>
  );
}

export function Entrada({ error, className = '', ...props }) {
  return <input className={`${claseEntrada} ${error ? 'ring-red-400' : ''} ${className}`} aria-invalid={!!error} {...props} />;
}

/** Campo de contraseña con ojito para mostrar u ocultar lo escrito. Solo se usa al cambiar contraseñas. */
export function EntradaClave({ error, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Entrada type={visible ? 'text' : 'password'} error={error} className={`pr-10 ${className}`} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:text-marca-700"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <Icono nombre={visible ? 'ojoNo' : 'ojo'} className="size-5" />
      </button>
    </div>
  );
}

export function Seleccion({ error, className = '', children, ...props }) {
  return (
    <select className={`${claseEntrada} pr-8 ${error ? 'ring-red-400' : ''} ${className}`} aria-invalid={!!error} {...props}>
      {children}
    </select>
  );
}

export function Tarjeta({ titulo, acciones, children, className = '', cuerpo = 'p-4 sm:p-5' }) {
  return (
    <section className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
          {acciones}
        </header>
      )}
      <div className={cuerpo}>{children}</div>
    </section>
  );
}

const COLORES_INSIGNIA = {
  verde: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  gris: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ambar: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  rojo: 'bg-red-50 text-red-700 ring-red-600/20',
  marca: 'bg-marca-50 text-marca-800 ring-marca-600/20',
};

export function Insignia({ color = 'gris', children }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORES_INSIGNIA[color]}`}>{children}</span>;
}

export function Modal({ abierto, titulo, onCerrar, children, pie, ancho = 'max-w-lg' }) {
  const ref = useRef(null);
  const idTitulo = useId();
  // onCerrar suele ser una función nueva en cada render; se lee por ref para no reenfocar al escribir.
  const refCerrar = useRef(onCerrar);
  refCerrar.current = onCerrar;
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e) => e.key === 'Escape' && refCerrar.current?.();
    document.addEventListener('keydown', alTeclear);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = previo;
    };
  }, [abierto]);

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`animar-aparecer flex max-h-[92dvh] w-full ${ancho} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={idTitulo} className="text-base font-semibold">
            {titulo}
          </h2>
          <button type="button" onClick={onCerrar} className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <Icono nombre="x" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{pie}</footer>}
      </div>
    </div>
  );
}

export function Vacio({ titulo, children, icono = 'bandeja' }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
        <Icono nombre={icono} className="size-6" />
      </div>
      <p className="font-medium text-slate-700">{titulo}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alerta({ tipo = 'info', children, className = '' }) {
  const estilos = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    aviso: 'bg-amber-50 text-amber-900 ring-amber-200',
    error: 'bg-red-50 text-red-800 ring-red-200',
    exito: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  };
  const iconos = { info: 'info', aviso: 'alerta', error: 'alerta', exito: 'check' };
  return (
    <div className={`flex gap-3 rounded-lg p-3 text-sm ring-1 ring-inset ${estilos[tipo]} ${className}`} role={tipo === 'error' ? 'alert' : undefined}>
      <Icono nombre={iconos[tipo]} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ───────── Avisos flotantes (toasts) ─────────
const ContextoAvisos = createContext(() => {});
export const useAviso = () => useContext(ContextoAvisos);

export function ProveedorAvisos({ children }) {
  const [avisos, setAvisos] = useState([]);
  const avisar = useCallback((texto, tipo = 'exito') => {
    const id = Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {avisos.map((a) => (
          <div
            key={a.id}
            className={`animar-aparecer pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${a.tipo === 'error' ? 'bg-red-600' : 'bg-slate-900'}`}
          >
            <Icono nombre={a.tipo === 'error' ? 'alerta' : 'check'} className="size-4 shrink-0" />
            {a.texto}
          </div>
        ))}
      </div>
    </ContextoAvisos.Provider>
  );
}

// ───────── Íconos (trazos de 24px, estilo lineal) ─────────
const TRAZOS = {
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  bandeja: 'M22 12h-6l-2 3h-4l-2-3H2m20 0v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6m20 0-3.5-7h-13L2 12',
  monitor: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  maletin: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M3 7h18v13H3zM3 13h18',
  ubicacion: 'M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  edificio: 'M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3',
  usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  llave: 'M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM12 11v10m0-4h3m-3 3h2',
  mas: 'M12 5v14M5 12h14',
  lapiz: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  basura: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  descargar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  subir: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  buscar: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  copiar: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  imprimir: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  enviar: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  correo: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 2-10 7L2 6',
  recargar: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  enlace: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  flecha: 'M9 18l6-6-6-6',
  abajo: 'M6 9l6 6 6-6',
  pausa: 'M10 9v6m4-6v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  reproducir: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM10 8l6 4-6 4z',
  ojo: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ojoNo: 'M17.9 17.9A10.7 10.7 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 4.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20',
};

export function Icono({ nombre, className = 'size-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
