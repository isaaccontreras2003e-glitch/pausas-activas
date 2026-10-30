/** Copia texto al portapapeles. En http:// (red local) el API moderno no existe, así que hay respaldo. */
export async function copiar(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('No se pudo copiar');
}

export const esUrlLocal = (url) => {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h.startsWith('127.') || h.startsWith('192.168.') || h.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch {
    return true;
  }
};

/** Comparte imagen + texto con la hoja nativa del celular (WhatsApp, Telegram, correo…), si el navegador lo permite. */
export async function compartirImagen(urlImagen, nombreArchivo, texto) {
  const blob = await (await fetch(urlImagen, { credentials: 'same-origin' })).blob();
  const archivo = new File([blob], nombreArchivo, { type: blob.type });
  if (!navigator.canShare?.({ files: [archivo] })) return false;
  await navigator.share({ files: [archivo], text: texto });
  return true;
}

export const puedeCompartirArchivos = () => typeof navigator.canShare === 'function' && window.isSecureContext;
