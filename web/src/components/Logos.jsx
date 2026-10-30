import { quitarTildes } from '../lib/formato.js';
// Los logos (SVG de pocos KB) quedan incrustados en el código de la página: escanear el QR hace menos peticiones,
// lo que importa cuando muchos celulares salen a internet por el mismo Wi-Fi. Para cambiar uno, reemplaza su .svg
// en web/src/assets/logos y vuelve a compilar (npm run build).
import foca from '../assets/logos/foca.svg?inline';
import imes from '../assets/logos/imes.svg?inline';
import viu from '../assets/logos/viu.svg?inline';

const LOGOS = {
  imes: { src: imes, alt: 'IMES' },
  viu: { src: viu, alt: 'VIU · Clínica Oftalmológica Internacional' },
  foca: { src: foca, alt: 'Fundación FOCA' },
};
const ORDEN = ['foca', 'viu', 'imes'];

/** Logo de una empresa por su nombre ("IMES", "Fundación FOCA"…), o null si no tiene. */
export function logoDeEmpresa(nombre) {
  const n = quitarTildes(nombre);
  const clave = Object.keys(LOGOS).find((k) => new RegExp(`\\b${k}\\b`).test(n));
  return clave ? LOGOS[clave] : null;
}

/** Ordena las empresas igual que la franja de logos (las que no tienen logo, al final). */
export function ordenarEmpresas(empresas) {
  const posicion = (e) => {
    const n = quitarTildes(e.nombre);
    const i = ORDEN.findIndex((k) => new RegExp(`\\b${k}\\b`).test(n));
    return i < 0 ? ORDEN.length : i;
  };
  return [...empresas].sort((a, b) => posicion(a) - posicion(b) || a.nombre.localeCompare(b.nombre));
}

/** Franja con los logos de las tres empresas. */
export function FranjaLogos({ alto = 'h-10', gap = 'gap-5 sm:gap-8', className = '' }) {
  return (
    <div className={`flex items-center justify-center ${gap} ${className}`}>
      {ORDEN.map((k) => (
        <img key={k} src={LOGOS[k].src} alt={LOGOS[k].alt} className={`${alto} w-auto max-w-[30%] object-contain`} />
      ))}
    </div>
  );
}

/** Logo de la empresa o, si no tiene, su nombre en texto. */
export function LogoEmpresa({ nombre, alto = 'h-8', className = '' }) {
  const logo = logoDeEmpresa(nombre);
  if (!logo) return <span className={`font-bold text-slate-800 ${className}`}>{nombre}</span>;
  return <img src={logo.src} alt={logo.alt} className={`${alto} w-auto object-contain ${className}`} />;
}
