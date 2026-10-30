// En el PC nuevo: descifra la base de datos que vino en el paquete (si la hay) antes del primer arranque.
// Lo ejecuta ACTIVAR-SISTEMA.bat. Si no hay paquete o ya se importó, no hace nada.
import { RAIZ } from './entorno.js';
import fs from 'node:fs';
import path from 'node:path';
import { descifrar, preguntarOculto } from './cifrado.js';

const dirCifrados = path.join(RAIZ, 'datos-cifrados');
const cifrada = path.join(dirCifrados, 'pausas.db.cifrado');
const destino = path.join(RAIZ, 'data', 'pausas.db');

if (!fs.existsSync(cifrada)) process.exit(0);
if (fs.existsSync(destino)) {
  console.log('Este PC ya tiene datos del sistema; no se importó el paquete para no sobrescribirlos.');
  process.exit(0);
}

console.log('Se encontró la base de datos cifrada que viene del otro PC.');
const archivo = fs.readFileSync(cifrada);
for (let intento = 1; intento <= 3; intento++) {
  const password = await preguntarOculto('Contraseña del paquete: ');
  try {
    const datos = descifrar(archivo, password);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, datos);
    const env = path.join(dirCifrados, '.env.cifrado');
    if (fs.existsSync(env) && !fs.existsSync(path.join(RAIZ, '.env'))) fs.writeFileSync(path.join(RAIZ, '.env'), descifrar(fs.readFileSync(env), password));
    // Ya no hace falta la copia cifrada: se borra para no dejar datos sueltos.
    fs.rmSync(dirCifrados, { recursive: true, force: true });
    console.log('Datos importados correctamente.\n');
    process.exit(0);
  } catch (e) {
    console.log(`${e.message}${intento < 3 ? ' Intenta de nuevo.' : ''}`);
  }
}
console.log('No se pudo abrir el paquete. Verifica la contraseña con quien te lo envió y vuelve a ejecutar ACTIVAR-SISTEMA.bat.');
process.exit(1);
