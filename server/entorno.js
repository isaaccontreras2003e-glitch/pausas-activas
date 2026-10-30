// Carga variables desde .env (si existe) antes que cualquier otro módulo del servidor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const archivo = path.join(RAIZ, '.env');
if (fs.existsSync(archivo)) process.loadEnvFile(archivo);
