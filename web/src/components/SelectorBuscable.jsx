import { useEffect, useMemo, useRef, useState } from 'react';
import { quitarTildes } from '../lib/formato.js';
import { Icono, claseEntrada } from './ui.jsx';

/**
 * Lista desplegable con buscador, restrictiva: solo permite valores del catálogo.
 * En el celular se abre a pantalla completa para que el teclado no tape las opciones.
 */
export default function SelectorBuscable({ id, opciones, valor, onCambio, placeholder = 'Selecciona…', titulo, error, deshabilitado = false }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const refBuscar = useRef(null);
  const seleccionada = opciones.find((o) => o.value === valor);

  const filtradas = useMemo(() => {
    const t = quitarTildes(texto.trim());
    if (!t) return opciones;
    const palabras = t.split(/\s+/);
    return opciones.filter((o) => {
      const base = quitarTildes(`${o.label} ${o.detalle ?? ''}`);
      return palabras.every((p) => base.includes(p));
    });
  }, [opciones, texto]);

  useEffect(() => {
    if (!abierto) return;
    setTexto('');
    const t = setTimeout(() => refBuscar.current?.focus(), 50);
    const alTeclear = (e) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('keydown', alTeclear);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = '';
    };
  }, [abierto]);

  const elegir = (o) => {
    onCambio(o.value);
    setAbierto(false);
  };

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setAbierto(true)}
        disabled={deshabilitado}
        aria-haspopup="listbox"
        aria-invalid={!!error}
        className={`${claseEntrada} flex min-h-12 items-center justify-between gap-2 text-left ${error ? 'ring-red-400' : ''}`}
      >
        <span className={seleccionada ? 'text-slate-900' : 'text-slate-400'}>{seleccionada?.label ?? placeholder}</span>
        <Icono nombre="abajo" className="size-4 shrink-0 text-slate-500" />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && setAbierto(false)}>
          <div role="dialog" aria-modal="true" aria-label={titulo} className="animar-aparecer flex w-full flex-col bg-white sm:max-h-[80vh] sm:max-w-md sm:rounded-2xl sm:shadow-xl">
            <div className="flex items-center gap-2 border-b border-slate-200 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="relative flex-1">
                <Icono nombre="buscar" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={refBuscar}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={`Buscar ${titulo?.toLowerCase() ?? ''}…`}
                  className={`${claseEntrada} h-12 pl-9`}
                  enterKeyHint="search"
                  onKeyDown={(e) => e.key === 'Enter' && filtradas.length === 1 && elegir(filtradas[0])}
                />
              </div>
              <button type="button" onClick={() => setAbierto(false)} className="h-12 rounded-lg px-3 text-sm font-semibold text-marca-700 hover:bg-marca-50">
                Cancelar
              </button>
            </div>
            <ul role="listbox" className="flex-1 overflow-y-auto overscroll-contain py-1">
              {filtradas.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === valor}
                    onClick={() => elegir(o)}
                    className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50 active:bg-slate-100 ${o.value === valor ? 'bg-marca-50' : ''}`}
                  >
                    <span>
                      <span className="block text-base sm:text-sm">{o.label}</span>
                      {o.detalle && <span className="block text-xs text-slate-500">{o.detalle}</span>}
                    </span>
                    {o.value === valor && <Icono nombre="check" className="size-5 shrink-0 text-marca-700" />}
                  </button>
                </li>
              ))}
              {!filtradas.length && (
                <li className="px-4 py-8 text-center text-sm text-slate-500">
                  No encontramos «{texto}». Si tu cargo no aparece, avisa al equipo de SST.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
