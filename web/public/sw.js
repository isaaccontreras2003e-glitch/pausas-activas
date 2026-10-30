// Permite abrir el formulario del QR con señal mala o sin internet, usando la copia guardada en el celular.
// Solo actúa sobre el formulario (/pausas, /r/...) y sus archivos; el panel y la API pasan directo a la red.
const CACHE = 'pausas-formulario-v1';
const ESPERA_RED_MS = 6000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const clave of await caches.keys()) if (clave !== CACHE) await caches.delete(clave);
      await self.clients.claim();
    })(),
  );
});

const esFormulario = (url) => url.pathname === '/pausas' || url.pathname.startsWith('/r/');

/** Red primero (para tener siempre la versión nueva); si tarda o falla, la copia guardada. */
async function redPrimero(peticion) {
  const cache = await caches.open(CACHE);
  try {
    const respuesta = await Promise.race([
      fetch(peticion),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lenta')), ESPERA_RED_MS)),
    ]);
    if (respuesta.ok) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (e) {
    const copia = await cache.match(peticion);
    if (copia) return copia;
    throw e;
  }
}

/** Archivos con nombre único por versión (/assets/...): si ya están guardados, no hace falta la red. */
async function copiaPrimero(peticion) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(peticion);
  if (copia) return copia;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) cache.put(peticion, respuesta.clone());
  return respuesta;
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg') evento.respondWith(copiaPrimero(peticion));
  else if (peticion.mode === 'navigate' && esFormulario(url)) evento.respondWith(redPrimero(peticion));
});
