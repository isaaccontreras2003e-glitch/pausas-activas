import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alerta, Boton, Campo, Entrada, Icono, Insignia, Modal, Seleccion, Spinner, Vacio, claseBoton, claseEntrada, useAviso } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { compartirImagen, copiar, esUrlLocal, puedeCompartirArchivos } from '../lib/compartir.js';
import { fecha, fechaLarga, haceCuanto, hora, horaLegible, numero } from '../lib/formato.js';
import { puedeGestionar, useAdmin } from './AdminApp.jsx';

export default function PuntosQR() {
  const { usuario, catalogos, recargarCatalogos } = useAdmin();
  const avisar = useAviso();
  const gestion = puedeGestionar(usuario);
  const [edicion, setEdicion] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [kit, setKit] = useState(null);
  const [aRegenerar, setARegenerar] = useState(null);

  const puntos = catalogos.puntos;
  const principal = puntos.find((p) => p.principal);
  const otros = puntos.filter((p) => !p.principal);
  const urlLocal = puntos.some((p) => esUrlLocal(p.url));
  const baseActual = principal?.url.replace(/\/pausas$/, '');

  const guardar = async () => {
    setGuardando(true);
    try {
      const cuerpo = { descripcion: edicion.descripcion, sede_id: edicion.sede_id || null };
      if (edicion.id) await api(`/api/admin/puntos/${edicion.id}`, { method: 'PUT', body: cuerpo });
      else await api('/api/admin/puntos', { method: 'POST', body: cuerpo });
      await recargarCatalogos();
      avisar(edicion.id ? 'Cambios guardados' : 'Código QR creado');
      setEdicion(null);
    } catch (e) {
      setErrores({ ...e.detalles, general: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (p) => {
    await api(`/api/admin/puntos/${p.id}`, { method: 'PUT', body: { activo: !p.activo } });
    await recargarCatalogos();
    avisar(p.activo ? 'QR desactivado: quien lo escanee verá un aviso' : 'QR activado');
  };

  const regenerar = async () => {
    try {
      await api(`/api/admin/puntos/${aRegenerar.id}/regenerar`, { method: 'POST' });
      await recargarCatalogos();
      avisar('Se generó un código nuevo. Reimprime y reenvía este QR.');
    } catch (e) {
      avisar(e.message, 'error');
    } finally {
      setARegenerar(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Código QR</h1>
        <p className="text-sm text-slate-500">Un solo QR para todos los colaboradores y todas las sedes. Lleva directo al formulario de pausas activas.</p>
      </div>

      {urlLocal && (
        <Alerta tipo="aviso">
          <p className="font-semibold">Estos QR apuntan a {baseActual}</p>
          <p className="mt-1">
            Esa dirección solo funciona en celulares conectados al <strong>Wi-Fi de la oficina</strong> y mientras este equipo esté encendido con el sistema
            corriendo. Sirve para pruebas. Antes de imprimir o enviar los QR a los colaboradores, publica el sistema en un servidor con dominio (por ejemplo,{' '}
            <em>https://pausas.tuempresa.com</em>) y regístralo en{' '}
            {usuario.rol === 'admin' ? (
              <Link to="/admin/configuracion" className="font-semibold underline">
                Configuración → URL pública
              </Link>
            ) : (
              'Configuración → URL pública (pídeselo a un administrador)'
            )}
            . Los QR se actualizan solos.
          </p>
        </Alerta>
      )}

      {principal && <QrPrincipal punto={principal} onKit={() => setKit(principal)} />}

      <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">QR adicionales por lugar (opcional)</h2>
          <p className="max-w-3xl text-sm text-slate-500">
            Solo si quieres saber desde qué lugar se registra cada persona. Cada uno lleva al mismo formulario, con la sede ya seleccionada.
          </p>
        </div>
        {gestion && (
          <Boton
            variante="secundario"
            onClick={() => {
              setErrores({});
              setEdicion({ descripcion: '', sede_id: '' });
            }}
          >
            <Icono nombre="mas" className="size-4" /> Agregar QR por lugar
          </Boton>
        )}
      </div>

      {!otros.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No hay QR adicionales. Con el QR principal es suficiente.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {otros.map((p) => (
            <article key={p.id} className={`flex flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${p.activo ? '' : 'opacity-60'}`}>
              <div className="flex gap-4 p-4">
                <img src={`/api/admin/puntos/${p.id}/qr.svg?t=${p.token}`} alt={`Código QR de ${p.descripcion}`} className="size-24 shrink-0 rounded-lg ring-1 ring-slate-200" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{p.descripcion}</h2>
                  <p className="text-sm text-slate-500">{p.sede_nombre ?? 'General · sin sede preseleccionada'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.activo ? <Insignia color="verde">Activo</Insignia> : <Insignia>Inactivo</Insignia>}
                    <Insignia color="marca">{numero(p.registros)} registros</Insignia>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Último uso: {haceCuanto(p.ultimo_registro)}</p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-slate-100 p-2">
                <Boton tamano="sm" onClick={() => setKit(p)} disabled={!p.activo}>
                  <Icono nombre="enviar" className="size-4" /> Kit de envío
                </Boton>
                <Boton tamano="sm" variante="fantasma" onClick={() => window.open(`/admin/qr/${p.id}/afiche`, '_blank')} disabled={!p.activo}>
                  <Icono nombre="imprimir" className="size-4" /> Afiche
                </Boton>
                {gestion && (
                  <div className="ml-auto flex">
                    <Boton
                      tamano="sm"
                      variante="fantasma"
                      aria-label="Editar"
                      onClick={() => {
                        setErrores({});
                        setEdicion({ ...p, sede_id: p.sede_id ?? '' });
                      }}
                    >
                      <Icono nombre="lapiz" className="size-4" />
                    </Boton>
                    <Boton tamano="sm" variante="fantasma" aria-label="Generar código nuevo" onClick={() => setARegenerar(p)}>
                      <Icono nombre="recargar" className="size-4" />
                    </Boton>
                    <Boton tamano="sm" variante="fantasma" aria-label={p.activo ? 'Desactivar' : 'Activar'} onClick={() => alternar(p)}>
                      <Icono nombre={p.activo ? 'pausa' : 'reproducir'} className="size-4" />
                    </Boton>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        abierto={!!edicion}
        titulo={edicion?.id ? 'Editar código QR' : 'Nuevo código QR'}
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
          <div className="space-y-4">
            <Campo etiqueta="Descripción" requerido error={errores.descripcion} ayuda="Se muestra en el formulario y en los reportes." htmlFor="p-desc">
              <Entrada
                id="p-desc"
                value={edicion.descripcion}
                onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })}
                maxLength={120}
                placeholder="Ej.: Piso 3 – Cafetería"
              />
            </Campo>
            <Campo
              etiqueta="Sede preseleccionada"
              ayuda="Si el QR estará pegado en una sede, elígela para ahorrar un paso. Para un enlace que enviarás a todos, deja «General»."
              htmlFor="p-sede"
            >
              <Seleccion id="p-sede" value={edicion.sede_id} onChange={(e) => setEdicion({ ...edicion, sede_id: Number(e.target.value) || '' })}>
                <option value="">General (el colaborador elige su sede)</option>
                {catalogos.sedes
                  .filter((s) => s.activo || s.id === edicion.sede_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.ciudad ? ` – ${s.ciudad}` : ''}
                    </option>
                  ))}
              </Seleccion>
            </Campo>
            {errores.general && <Alerta tipo="error">{errores.general}</Alerta>}
          </div>
        )}
      </Modal>

      <Modal
        abierto={!!aRegenerar}
        titulo="Generar un código nuevo"
        onCerrar={() => setARegenerar(null)}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setARegenerar(null)}>
              Cancelar
            </Boton>
            <Boton variante="peligro" onClick={regenerar}>
              Generar código nuevo
            </Boton>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          El QR y el enlace actuales de <strong>{aRegenerar?.descripcion}</strong> dejarán de funcionar de inmediato. Úsalo si el código se compartió por fuera de la
          empresa o se está usando de forma indebida. Tendrás que reimprimir el afiche y reenviar el enlace. Los registros anteriores se conservan.
        </p>
      </Modal>

      <KitEnvio punto={kit} onCerrar={() => setKit(null)} />
    </div>
  );
}

function QrPrincipal({ punto, onKit }) {
  const avisar = useAviso();
  const [config, setConfig] = useState(null);
  useEffect(() => {
    api('/api/admin/config').then(setConfig).catch(() => {});
  }, [punto.token, punto.url]);
  const delDia = config?.enlace_tipo === 'temporal';
  const generado = config?.qr_actualizado_en ? new Date(config.qr_actualizado_en) : null;
  const esDeHoy = generado && fecha(generado.toISOString()) === fecha(new Date().toISOString());
  const nombrePng = delDia && generado ? `QR-pausas-activas-${generado.toISOString().slice(0, 10)}.png` : 'QR-pausas-activas.png';
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-2 ring-marca-200">
      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:p-6">
        <img
          src={`/api/admin/puntos/${punto.id}/qr.svg?t=${punto.token}`}
          alt="QR principal de pausas activas"
          className="mx-auto size-52 rounded-xl ring-1 ring-slate-200 sm:mx-0"
        />
        <div className="min-w-0 space-y-3">
          {delDia ? (
            <Insignia color={esDeHoy ? 'verde' : 'ambar'}>
              <Icono nombre="check" className="size-3" /> QR del día · <span className="first-letter:uppercase">{generado && fechaLarga(generado.toISOString())}</span>
            </Insignia>
          ) : config?.enlace_tipo === 'fijo' ? (
            <Insignia color="marca">
              <Icono nombre="check" className="size-3" /> QR fijo · nunca cambia
            </Insignia>
          ) : null}
          <h2 className="text-xl font-bold">{delDia ? 'QR del día de pausas activas' : 'QR principal de pausas activas'}</h2>
          {delDia && (
            <Alerta tipo={esDeHoy ? 'info' : 'aviso'}>
              Generado a las <strong>{hora(generado.toISOString())}</strong> (se renueva solo cada día a las{' '}
              <strong>{horaLegible(config.hora_renovacion_qr)}</strong>). Envía a los colaboradores <strong>el QR de hoy</strong>. Si el internet se cae durante el
              día, se genera uno nuevo y aparece aquí; vuelve a enviarlo. También queda como imagen <strong>QR-DEL-DIA.png</strong> en la carpeta del sistema.
            </Alerta>
          )}
          <p className="text-sm text-slate-600">
            Al escanearlo, el colaborador ve sus datos personales (nombre, cédula, empresa, sede y cargo) y responde{' '}
            <strong>si realizó la pausa activa y a qué hora</strong>. Desde la segunda vez, su celular recuerda los datos y solo responde la pausa.
          </p>
          <div className="flex max-w-xl gap-2">
            <input readOnly value={punto.url} className={`${claseEntrada} font-mono text-sm`} onFocus={(e) => e.target.select()} />
            <Boton
              variante="secundario"
              aria-label="Copiar enlace"
              onClick={() =>
                copiar(punto.url)
                  .then(() => avisar('Enlace copiado'))
                  .catch(() => avisar('No se pudo copiar', 'error'))
              }
            >
              <Icono nombre="copiar" className="size-4" />
            </Boton>
          </div>
          <p className="text-xs text-slate-500">
            {numero(punto.registros)} registros · último uso: {haceCuanto(punto.ultimo_registro)}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Boton onClick={onKit}>
              <Icono nombre="enviar" className="size-4" /> Enviar con indicaciones
            </Boton>
            <Boton variante="secundario" onClick={() => window.open(`/admin/qr/${punto.id}/afiche`, '_blank')}>
              <Icono nombre="imprimir" className="size-4" /> Afiche para imprimir
            </Boton>
            <a href={`/api/admin/puntos/${punto.id}/qr.png?ancho=1024&descargar=1`} download={nombrePng} className={claseBoton('secundario')}>
              <Icono nombre="descargar" className="size-4" /> Descargar imagen
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function KitEnvio({ punto, onCerrar }) {
  const avisar = useAviso();
  const [kit, setKit] = useState(null);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    setKit(null);
    if (!punto) return;
    api(`/api/admin/puntos/${punto.id}/kit`).then((k) => {
      setKit(k);
      setMensaje(k.mensaje);
    });
  }, [punto]);

  const copiarTexto = async (texto, que) => {
    try {
      await copiar(texto);
      avisar(`${que} copiado`);
    } catch {
      avisar('No se pudo copiar. Selecciona el texto y cópialo manualmente.', 'error');
    }
  };

  const urlPng = punto && `/api/admin/puntos/${punto.id}/qr.png?ancho=1024`;
  const nombrePng = punto && `QR-${punto.descripcion.replace(/[^\p{L}\d]+/gu, '-')}.png`;

  const compartir = async () => {
    try {
      const ok = await compartirImagen(urlPng, nombrePng, mensaje);
      if (!ok) avisar('Este navegador no permite compartir imágenes. Descarga el PNG y adjúntalo.', 'error');
    } catch (e) {
      if (e.name !== 'AbortError') avisar('No se pudo compartir.', 'error');
    }
  };

  return (
    <Modal abierto={!!punto} titulo={`Kit de envío · ${punto?.descripcion ?? ''}`} onCerrar={onCerrar} ancho="max-w-3xl">
      {!kit ? (
        <div className="grid h-40 place-items-center text-marca-700">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <img src={`/api/admin/puntos/${punto.id}/qr.svg?t=${punto.token}`} alt="Código QR" className="w-full rounded-xl ring-1 ring-slate-200" />
            <a href={`${urlPng}&descargar=1`} download={nombrePng} className={`${claseBoton('secundario')} w-full`}>
              <Icono nombre="descargar" className="size-4" /> Descargar imagen
            </a>
            <Boton variante="secundario" className="w-full" onClick={() => window.open(`/admin/qr/${punto.id}/afiche`, '_blank')}>
              <Icono nombre="imprimir" className="size-4" /> Afiche para imprimir
            </Boton>
            {puedeCompartirArchivos() && (
              <Boton variante="secundario" className="w-full" onClick={compartir}>
                <Icono nombre="enviar" className="size-4" /> Compartir imagen y mensaje
              </Boton>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {kit.url_es_local && (
              <Alerta tipo="aviso">Este enlace solo abre en el Wi-Fi de la oficina. Configura la URL pública antes de enviarlo a los colaboradores.</Alerta>
            )}
            <Campo etiqueta="Enlace directo">
              <div className="flex gap-2">
                <input readOnly value={kit.url} className={`${claseEntrada} font-mono text-sm`} onFocus={(e) => e.target.select()} />
                <Boton variante="secundario" onClick={() => copiarTexto(kit.url, 'Enlace')} aria-label="Copiar enlace">
                  <Icono nombre="copiar" className="size-4" />
                </Boton>
              </div>
            </Campo>
            <Campo etiqueta="Mensaje con las indicaciones" ayuda="Puedes ajustarlo antes de enviarlo. El texto por defecto se cambia en Configuración.">
              <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={11} className={`${claseEntrada} text-sm leading-relaxed`} />
            </Campo>
            <div className="flex flex-wrap gap-2">
              <Boton onClick={() => copiarTexto(mensaje, 'Mensaje')}>
                <Icono nombre="copiar" className="size-4" /> Copiar mensaje
              </Boton>
              <a href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer" className={claseBoton('secundario')}>
                <Icono nombre="enviar" className="size-4" /> WhatsApp
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Pausas Activas – ${kit.organizacion}`)}&body=${encodeURIComponent(mensaje.replace(/\*/g, ''))}`}
                className={claseBoton('secundario')}
              >
                <Icono nombre="correo" className="size-4" /> Correo
              </a>
            </div>
            <Alerta tipo="info">
              <strong>Importante al enviar por celular:</strong> quien recibe el mensaje en su teléfono no puede escanear un QR que está en su propia pantalla. Por eso el
              mensaje incluye el <strong>enlace directo</strong>, que basta con tocar. La imagen QR sirve para afiches, pantallas, TV o presentaciones.
            </Alerta>
          </div>
        </div>
      )}
    </Modal>
  );
}
