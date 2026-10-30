// Datos del colaborador guardados SOLO en su celular para prellenar el formulario la próxima vez.
const CLAVE = 'pausas.perfil.v1';

export function leerPerfil() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) ?? null;
  } catch {
    return null;
  }
}

export function guardarPerfil(perfil) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(perfil));
  } catch {
    /* modo privado o almacenamiento bloqueado: el formulario sigue funcionando */
  }
}

// Copia de las listas del formulario (empresas, sedes, cargos) para poder abrirlo con mala señal.
const CLAVE_CATALOGO = 'pausas.catalogo.v1';

export function guardarCatalogo(token, datos) {
  try {
    localStorage.setItem(`${CLAVE_CATALOGO}.${token}`, JSON.stringify(datos));
  } catch {
    /* sin almacenamiento */
  }
}

export function leerCatalogo(token) {
  try {
    return JSON.parse(localStorage.getItem(`${CLAVE_CATALOGO}.${token}`)) ?? null;
  } catch {
    return null;
  }
}

export function borrarPerfil() {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento */
  }
}
