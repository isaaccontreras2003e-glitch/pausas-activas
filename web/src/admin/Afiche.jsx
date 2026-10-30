import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alerta, Boton, Icono, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { FranjaLogos } from '../components/Logos.jsx';
import { fechaLarga } from '../lib/formato.js';

const PASOS = [
  ['Abre la cámara de tu celular y apunta a este código.', 'qr'],
  ['Toca el enlace que aparece en la pantalla.', 'enlace'],
  ['Escribe tus datos y responde si realizaste la pausa activa y a qué hora.', 'lapiz'],
  ['Toca «Enviar registro» y espera la confirmación.', 'check'],
];

/** Afiche tamaño carta listo para imprimir o guardar como PDF desde el navegador. */
export default function Afiche() {
  const { id } = useParams();
  const [kit, setKit] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/api/admin/puntos/${id}/kit`).then(setKit).catch(setError);
  }, [id]);

  useEffect(() => {
    if (kit) document.title = `Afiche QR – ${kit.punto.descripcion}`;
  }, [kit]);

  if (error) return <Alerta tipo="error" className="m-6">{error.message}</Alerta>;
  if (!kit) {
    return (
      <div className="grid min-h-dvh place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-200 py-6 print:bg-white print:py-0">
      <style>{'@page { size: letter; margin: 0; }'}</style>
      <div className="no-imprimir mx-auto mb-4 flex max-w-[216mm] flex-wrap items-center justify-between gap-3 px-4">
        <p className="text-sm text-slate-600">Usa «Imprimir» y elige tu impresora o «Guardar como PDF». Recomendado: papel carta, sin márgenes, laminado.</p>
        <Boton onClick={() => window.print()}>
          <Icono nombre="imprimir" className="size-4" /> Imprimir / PDF
        </Boton>
      </div>
      {kit.url_es_local && (
        <div className="no-imprimir mx-auto mb-4 max-w-[216mm] px-4">
          <Alerta tipo="aviso">Este QR apunta a una dirección de red local ({kit.url}). Solo funcionará en el Wi-Fi de la oficina.</Alerta>
        </div>
      )}

      <article className="mx-auto flex h-[279mm] w-[216mm] flex-col overflow-hidden bg-white shadow-xl print:shadow-none" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
        <div className="px-[14mm] pt-[9mm] pb-[6mm]">
          <FranjaLogos alto="h-[17mm]" gap="gap-[12mm]" />
        </div>
        <header className="bg-marca-700 px-[16mm] pt-[8mm] pb-[8mm] text-center text-white">
          <h1 className="text-[38pt] leading-none font-extrabold">¡Es hora de tu</h1>
          <h1 className="text-[38pt] leading-tight font-extrabold">pausa activa!</h1>
          <p className="mt-2 text-[14pt] text-marca-50">Cuida tu cuerpo y registra tu participación</p>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center px-[16mm]">
          <div className="rounded-3xl bg-white p-[5mm] ring-[1.5mm] ring-marca-700">
            <img src={`/api/admin/puntos/${kit.punto.id}/qr.svg?t=${kit.punto.token}`} alt="Código QR" className="size-[72mm]" />
          </div>
          <p className="mt-[5mm] text-[14pt] font-semibold text-slate-800">Escanéame con la cámara de tu celular</p>

          <ol className="mt-[8mm] grid w-full grid-cols-2 gap-x-[8mm] gap-y-[5mm]">
            {PASOS.map(([texto, icono], i) => (
              <li key={texto} className="flex items-start gap-[3mm]">
                <span className="grid size-[11mm] shrink-0 place-items-center rounded-full bg-marca-700 text-[15pt] font-bold text-white">{i + 1}</span>
                <span className="pt-[1mm] text-[12.5pt] leading-snug text-slate-800">
                  <Icono nombre={icono} className="mr-1 mb-0.5 inline size-[5mm] text-marca-700" />
                  {texto}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <footer className="mt-auto border-t-[1mm] border-marca-700 bg-slate-50 px-[16mm] py-[7mm] text-center">
          <p className="text-[11pt] text-slate-600">¿No puedes escanear? Escribe esta dirección en tu navegador:</p>
          <p className="mt-1 font-mono text-[15pt] font-bold break-all text-slate-900">{kit.url.replace(/^https?:\/\//, '')}</p>
          {kit.enlace_tipo === 'temporal' && kit.qr_actualizado_en && (
            <p className="mt-3 inline-block rounded-full bg-marca-700 px-4 py-1 text-[11pt] font-semibold text-white first-letter:uppercase">
              QR válido el {fechaLarga(kit.qr_actualizado_en)}
            </p>
          )}
          <p className="mt-3 text-[10pt] text-slate-500">
            {!kit.punto.principal && `${kit.punto.descripcion}${kit.punto.sede_nombre ? ` · ${kit.punto.sede_nombre}` : ''} · `}
            Seguridad y Salud en el Trabajo
          </p>
        </footer>
      </article>
    </div>
  );
}
