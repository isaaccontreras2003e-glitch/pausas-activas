import { useEffect, useState } from 'react';
import { Alerta, Boton, Campo, Entrada, Spinner, Tarjeta, claseEntrada, useAviso } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { esUrlLocal } from '../lib/compartir.js';
import { useAdmin } from './AdminApp.jsx';

const CAMPOS = ['organizacion', 'ventana_antiduplicado_min', 'base_url', 'hora_renovacion_qr', 'mensaje_invitacion', 'texto_tratamiento_datos', 'mensaje_exito'];

export default function Configuracion() {
  const { recargarCatalogos } = useAdmin();
  const avisar = useAviso();
  const [config, setConfig] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () =>
    api('/api/admin/config').then((c) => {
      setConfig(c);
      setF(Object.fromEntries(CAMPOS.map((k) => [k, c[k] ?? ''])));
    });
  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await api('/api/admin/config', { method: 'PUT', body: f });
      await Promise.all([cargar(), recargarCatalogos()]);
      avisar('Configuración guardada');
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!f) {
    return (
      <div className="grid h-64 place-items-center text-marca-700">
        <Spinner className="size-8" />
      </div>
    );
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const efectiva = f.base_url.trim() || config.base_url_detectada;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-slate-500">Datos generales, dirección de los QR y textos que ven los colaboradores.</p>
      </div>

      <Tarjeta titulo="General">
        <div className="space-y-4">
          <Campo etiqueta="Nombre de la organización" requerido ayuda="Aparece en el formulario, los afiches, los mensajes y los reportes." htmlFor="cfg-org">
            <Entrada id="cfg-org" value={f.organizacion} onChange={set('organizacion')} maxLength={120} />
          </Campo>
          <Campo
            etiqueta="Tiempo mínimo entre registros de una misma persona (minutos)"
            ayuda="Evita registros dobles por tocar dos veces o reenviar. Usa 0 para desactivar. Si hay una pausa en la mañana y otra en la tarde, 60–120 min funciona bien."
            htmlFor="cfg-ventana"
          >
            <Entrada id="cfg-ventana" type="number" min={0} max={1440} value={f.ventana_antiduplicado_min} onChange={set('ventana_antiduplicado_min')} className="max-w-32" />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta titulo="URL pública de los códigos QR">
        <div className="space-y-4">
          {config.enlace_tipo === 'temporal' && (
            <>
              <Alerta tipo="info">
                El sistema está publicado con un <strong>enlace temporal de internet</strong>, que se renueva como <strong>QR del día</strong>. La URL de abajo
                se actualiza sola; no hace falta escribirla.
              </Alerta>
              <Campo
                etiqueta="Hora de renovación diaria del QR"
                ayuda="Cada día a esta hora se genera el QR del día. Elige una hora antes de la jornada (por ejemplo, 05:30)."
                htmlFor="cfg-renovacion"
              >
                <Entrada id="cfg-renovacion" type="time" value={f.hora_renovacion_qr} onChange={set('hora_renovacion_qr')} className="max-w-40" />
              </Campo>
            </>
          )}
          <p className="text-sm text-slate-600">
            Es la dirección que queda dentro de cada QR y en los enlaces que envías. Debe ser accesible desde los celulares de los colaboradores, idealmente con{' '}
            <strong>https</strong> y un dominio de la empresa.
          </p>
          <Campo etiqueta="URL pública" ayuda={`Vacía = se usa la dirección de red local detectada: ${config.base_url_detectada}`} htmlFor="cfg-url">
            <Entrada id="cfg-url" value={f.base_url} onChange={set('base_url')} placeholder="https://pausas.tuempresa.com" inputMode="url" />
          </Campo>
          <div className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            Los QR apuntarán a: <code className="font-semibold break-all">{efectiva.replace(/\/+$/, '')}/r/…</code>
          </div>
          {esUrlLocal(efectiva) ? (
            <Alerta tipo="aviso">
              Esta dirección solo funciona dentro de la red de la oficina y mientras este equipo tenga el sistema encendido. Úsala para pruebas; para el envío
              definitivo publica el sistema en un servidor (ver README).
            </Alerta>
          ) : (
            <Alerta tipo="exito">Dirección pública. Los QR funcionarán desde cualquier red con internet.</Alerta>
          )}
          <p className="text-xs text-slate-500">
            Al cambiar la URL, todos los QR se actualizan automáticamente. Los afiches ya impresos con la dirección anterior dejarán de funcionar si esa dirección se apaga.
          </p>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Textos para los colaboradores">
        <div className="space-y-4">
          <Campo
            etiqueta="Mensaje de invitación (WhatsApp / correo)"
            ayuda="Variables disponibles: {organizacion}, {enlace}, {punto}, {sede}. En WhatsApp, el texto entre *asteriscos* sale en negrita."
            htmlFor="cfg-inv"
          >
            <textarea id="cfg-inv" rows={12} value={f.mensaje_invitacion} onChange={set('mensaje_invitacion')} className={`${claseEntrada} text-sm leading-relaxed`} />
          </Campo>
          <Campo etiqueta="Autorización de tratamiento de datos (Ley 1581 de 2012)" ayuda="Variable: {organizacion}. Revísalo con el área jurídica." htmlFor="cfg-datos">
            <textarea id="cfg-datos" rows={5} value={f.texto_tratamiento_datos} onChange={set('texto_tratamiento_datos')} className={`${claseEntrada} text-sm`} />
          </Campo>
          <Campo etiqueta="Mensaje después de registrarse" htmlFor="cfg-exito">
            <Entrada id="cfg-exito" value={f.mensaje_exito} onChange={set('mensaje_exito')} maxLength={200} />
          </Campo>
        </div>
      </Tarjeta>

      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="sticky bottom-4 flex justify-end">
        <Boton onClick={guardar} cargando={guardando} className="shadow-lg">
          Guardar configuración
        </Boton>
      </div>
    </div>
  );
}
