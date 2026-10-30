import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { rutasAdmin, rutasAuth } from './rutas-admin.js';
import { rutasPublicas } from './rutas-publicas.js';
import { cabecerasSeguridad, mismoOrigen } from './seguridad.js';
import { crearCanal } from './tiempo-real.js';
import { ErrorApp } from './util.js';

export function crearApp({ db, dirEstatico, puerto, rutaDb, alImportarDatos }) {
  const app = express();
  const canal = crearCanal();

  app.disable('x-powered-by');
  // Detrás de un proxy (Render, nginx…) para obtener la IP real del colaborador.
  // TRUST_PROXY=1 confía en un salto (el proxy de Render); por defecto solo en este mismo equipo (túnel).
  const confianza = process.env.TRUST_PROXY;
  app.set('trust proxy', confianza ? (/^\d+$/.test(confianza) ? Number(confianza) : confianza) : 'loopback');
  app.use(cabecerasSeguridad);
  // Peticiones pequeñas en todo el sistema; solo la importación de cargos (Excel) y de datos admiten más.
  app.use('/api/admin/cargos/importar', express.json({ limit: '8mb' }));
  app.use('/api/auth/importar-datos', express.json({ limit: '50mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', mismoOrigen(db, puerto));

  app.get('/api/salud', (req, res) => res.json({ ok: true }));
  app.use('/api/public', rutasPublicas({ db, canal }));
  app.use('/api/auth', rutasAuth({ db, rutaDb, alImportarDatos }));
  app.use('/api/admin', rutasAdmin({ db, canal, puerto }));
  app.use('/api', () => {
    throw new ErrorApp(404, 'NO_ENCONTRADO', 'Ruta no encontrada.');
  });

  // Aplicación web compilada (npm run build). Cualquier otra ruta devuelve index.html (SPA).
  const indice = dirEstatico && path.join(dirEstatico, 'index.html');
  if (indice && fs.existsSync(indice)) {
    app.use(
      express.static(dirEstatico, {
        index: false,
        maxAge: '7d',
        immutable: true,
        // El service worker debe revisarse siempre, o los celulares se quedarían con una versión vieja.
        setHeaders: (res, ruta) => {
          if (ruta.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indice);
    });
  } else {
    app.get('/', (req, res) =>
      res.type('text').send('La aplicación web no está compilada. Ejecuta "npm run build" o usa "npm run dev".'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErrorApp) {
      return res.status(err.status).json({ codigo: err.codigo, mensaje: err.message, detalles: err.detalles });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ codigo: 'JSON_INVALIDO', mensaje: 'Solicitud mal formada.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ codigo: 'MUY_GRANDE', mensaje: 'La solicitud es demasiado grande.' });
    if (/UNIQUE constraint failed/i.test(err.message ?? '')) {
      return res.status(409).json({ codigo: 'DUPLICADO', mensaje: 'Ya existe un elemento con ese nombre o código.' });
    }
    console.error(err);
    res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

  return app;
}
