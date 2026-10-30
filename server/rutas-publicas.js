import { Router } from 'express';
import { leerConfig } from './db.js';
import { catalogosPublicos, obtenerPuntoPublico, registrarPausa } from './registros.js';
import { limitador } from './util.js';

export function rutasPublicas({ db, canal }) {
  const r = Router();
  const limiteRegistro = limitador({
    ventanaMs: 60_000,
    // Varias personas pueden compartir la IP pública del Wi-Fi de la empresa.
    maximo: Number(process.env.LIMITE_REGISTROS_POR_MINUTO_IP || 300),
    mensaje: 'Hay demasiados registros desde esta red. Espera un minuto e intenta de nuevo.',
  });

  r.get('/punto/:token', (req, res) => {
    const punto = obtenerPuntoPublico(db, req.params.token);
    const config = leerConfig(db);
    res.json({
      punto,
      ...catalogosPublicos(db),
      config: {
        organizacion: config.organizacion,
        texto_tratamiento_datos: config.texto_tratamiento_datos.replaceAll('{organizacion}', config.organizacion),
        mensaje_exito: config.mensaje_exito,
        ventana_antiduplicado_min: Number(config.ventana_antiduplicado_min) || 0,
      },
    });
  });

  r.post('/registro', limiteRegistro, (req, res) => {
    const registro = registrarPausa(db, req.body ?? {}, req.get('user-agent'));
    canal.emitir(registro);
    res.status(201).json({
      id: registro.id,
      registrado_en: registro.registrado_en,
      nombre: registro.nombre,
      empresa: registro.empresa,
      sede: registro.sede,
      cargo: registro.cargo,
      realizo_pausa: !!registro.realizo_pausa,
      hora_pausa: registro.hora_pausa,
    });
  });

  return r;
}
