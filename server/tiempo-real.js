import { enmascararCedula } from './util.js';

/** Canal Server-Sent Events: el dashboard recibe cada registro nuevo al instante. */
export function crearCanal() {
  const clientes = new Set();

  setInterval(() => {
    for (const { res } of clientes) res.write(': latido\n\n');
  }, 25_000).unref();

  return {
    suscribir(req, res) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write('retry: 3000\n\n');
      const cliente = { res, usuario: req.usuario };
      clientes.add(cliente);
      req.on('close', () => clientes.delete(cliente));
    },

    emitir(registro) {
      for (const { res, usuario } of clientes) {
        if (usuario.empresa_id && usuario.empresa_id !== registro.empresa_id) continue;
        const visible = usuario.rol === 'consulta' ? { ...registro, cedula: enmascararCedula(registro.cedula) } : registro;
        res.write(`event: registro\ndata: ${JSON.stringify(visible)}\n\n`);
      }
    },

    get conectados() {
      return clientes.size;
    },
  };
}
