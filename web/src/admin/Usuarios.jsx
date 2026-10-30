import { useCallback, useEffect, useState } from 'react';
import { Alerta, Boton, Campo, Entrada, Icono, Insignia, Modal, Seleccion, Spinner, Tarjeta, useAviso } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAdmin } from './AdminApp.jsx';

const ROLES = {
  admin: { nombre: 'Administrador', descripcion: 'Todo: parámetros, QR, reportes, usuarios y configuración.' },
  sst: { nombre: 'SST', descripcion: 'Monitor, reportes, QR y parámetros (cargos, sedes, empresas).' },
  consulta: { nombre: 'Consulta', descripcion: 'Solo ve el monitor y los reportes, con la cédula parcialmente oculta.' },
};

export default function Usuarios() {
  const { usuario: yo, catalogos } = useAdmin();
  const avisar = useAviso();
  const [usuarios, setUsuarios] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => api('/api/admin/usuarios').then(setUsuarios), []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const cuerpo = { nombre: edicion.nombre, rol: edicion.rol, empresa_id: edicion.empresa_id || null, activo: edicion.activo };
      if (edicion.password) cuerpo.password = edicion.password;
      if (edicion.id) await api(`/api/admin/usuarios/${edicion.id}`, { method: 'PUT', body: cuerpo });
      else await api('/api/admin/usuarios', { method: 'POST', body: { ...cuerpo, email: edicion.email } });
      await cargar();
      avisar(edicion.id ? 'Usuario actualizado' : 'Usuario creado');
      setEdicion(null);
    } catch (e) {
      setErrores({ ...e.detalles, general: e.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios del panel</h1>
          <p className="text-sm text-slate-500">Personas que pueden ingresar al panel administrativo. Los colaboradores no necesitan usuario.</p>
        </div>
        <Boton
          onClick={() => {
            setErrores({});
            setEdicion({ email: '', nombre: '', rol: 'sst', empresa_id: '', password: '', activo: true });
          }}
        >
          <Icono nombre="mas" className="size-4" /> Nuevo usuario
        </Boton>
      </div>

      <Tarjeta cuerpo="p-0">
        {!usuarios ? (
          <div className="grid h-32 place-items-center text-marca-700">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Nombre</th>
                  <th className="px-4 py-2 font-medium">Correo</th>
                  <th className="px-4 py-2 font-medium">Rol</th>
                  <th className="px-4 py-2 font-medium">Empresa</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 font-medium">
                      {u.nombre} {u.id === yo.id && <Insignia color="marca">Tú</Insignia>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                    <td className="px-4 py-2.5">{ROLES[u.rol].nombre}</td>
                    <td className="px-4 py-2.5 text-slate-600">{u.empresa_nombre ?? 'Todas'}</td>
                    <td className="px-4 py-2.5">{u.activo ? <Insignia color="verde">Activo</Insignia> : <Insignia>Inactivo</Insignia>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        onClick={() => {
                          setErrores({});
                          setEdicion({ ...u, empresa_id: u.empresa_id ?? '', password: '', activo: !!u.activo });
                        }}
                      >
                        <Icono nombre="lapiz" className="size-4" /> Editar
                      </Boton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Modal
        abierto={!!edicion}
        titulo={edicion?.id ? 'Editar usuario' : 'Nuevo usuario'}
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
            <Campo etiqueta="Nombre" requerido error={errores.nombre} htmlFor="u-nombre">
              <Entrada id="u-nombre" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Correo" requerido error={errores.email} htmlFor="u-email">
              <Entrada id="u-email" type="email" value={edicion.email} disabled={!!edicion.id} onChange={(e) => setEdicion({ ...edicion, email: e.target.value })} />
            </Campo>
            <Campo etiqueta="Rol" error={errores.rol} ayuda={ROLES[edicion.rol]?.descripcion} htmlFor="u-rol">
              <Seleccion id="u-rol" value={edicion.rol} onChange={(e) => setEdicion({ ...edicion, rol: e.target.value })}>
                {Object.entries(ROLES).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Empresa" ayuda="Si eliges una, el usuario solo verá los registros de esa empresa." htmlFor="u-empresa">
              <Seleccion id="u-empresa" value={edicion.empresa_id} onChange={(e) => setEdicion({ ...edicion, empresa_id: Number(e.target.value) || '' })}>
                <option value="">Todas las empresas</option>
                {catalogos.empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo
              etiqueta={edicion.id ? 'Nueva contraseña' : 'Contraseña'}
              requerido={!edicion.id}
              error={errores.password}
              ayuda={
                edicion.id
                  ? 'Déjala vacía para no cambiarla. Mínimo 10 caracteres, con letras y números.'
                  : 'Mínimo 10 caracteres, con letras y números. Compártela de forma segura y pide que la cambie al ingresar.'
              }
              htmlFor="u-pass"
            >
              <Entrada id="u-pass" type="password" autoComplete="new-password" value={edicion.password} onChange={(e) => setEdicion({ ...edicion, password: e.target.value })} />
            </Campo>
            {edicion.id && edicion.id !== yo.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-marca-700" checked={edicion.activo} onChange={(e) => setEdicion({ ...edicion, activo: e.target.checked })} />
                Usuario activo (puede ingresar)
              </label>
            )}
            {errores.general && <Alerta tipo="error">{errores.general}</Alerta>}
          </div>
        )}
      </Modal>
    </div>
  );
}
