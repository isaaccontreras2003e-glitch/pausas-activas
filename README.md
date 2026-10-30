# Pausas Activas QR

Registro de asistencia a pausas activas mediante código QR, con monitor en tiempo real para el equipo de SST.

- **Colaboradores:** escanean el **QR fijo** (o tocan el enlace `…/pausas` recibido por WhatsApp/correo) y llenan:
  - sus datos personales: nombre, cédula, empresa, sede y cargo;
  - **¿Realizaste la pausa activa?** Sí / No;
  - si respondió Sí, **a qué hora** la realizó (viene puesta la hora actual y no acepta horas futuras); si respondió No, un motivo opcional.

  No instalan nada. El celular recuerda los datos personales, así que desde la segunda vez solo responden lo de la pausa.
- **SST / administradores:** monitor en vivo, consolidados por sede, cargo, empresa y punto QR, filtros por fecha y hora, exportación a Excel y CSV, gestión de cargos, sedes y empresas, y generación de QR con afiche imprimible y mensaje de invitación.

## Encender y apagar el sistema (doble clic)

| Archivo | Para qué |
|---|---|
| **ACTIVAR-SISTEMA.bat** | Se usa **una sola vez**. Deja el sistema funcionando **en segundo plano, sin ventanas**, con enlace público a internet (Cloudflare), y hace que **arranque solo** cada vez que se inicia sesión en este PC. También crea en el Escritorio el acceso directo **Panel Pausas Activas**. |
| **DETENER-SISTEMA.bat** | Apaga el sistema. Vuelve a encenderse solo en el próximo inicio de sesión, o con ACTIVAR-SISTEMA.bat. |
| **DESACTIVAR-INICIO-AUTOMATICO.bat** | Apaga el sistema y quita el arranque automático. |
| **PERMITIR-CELULARES.bat** | Opcional, se ejecuta una vez como administrador. Permite entrar por la red local (`http://IP-de-este-PC:3000`). |

- **Enlaces vigentes:** están en **ENLACE-ACTUAL.txt** y en el panel, en *Código QR*.
- **Si el servidor o la conexión fallan,** se recupera solo en segundos. El registro de lo que pasa queda en `data/logs/sistema.log`.
- **El QR funciona mientras este PC esté encendido, con sesión iniciada y con internet.** Si el PC se apaga o se suspende, el QR deja de responder hasta que vuelva a encenderse.
- **Enlace temporal vs. fijo:** sin configuración adicional, el enlace es `https://xxxx.trycloudflare.com` y **cambia** cada vez que el PC se reinicia o se cae la conexión. Para un **enlace y QR fijos** que nunca cambien, agrega en `.env` el túnel con nombre de un dominio de la empresa:
  ```
  CLOUDFLARE_TUNNEL_TOKEN=token-del-tunel-creado-en-Cloudflare-Zero-Trust
  URL_PUBLICA_FIJA=https://pausas.tuempresa.com
  ```
  En Cloudflare, el túnel debe apuntar a `http://localhost:3000`. Después ejecuta DETENER-SISTEMA.bat y ACTIVAR-SISTEMA.bat.

## Instalador para otro PC (recomendado)

1. En el PC actual: doble clic en **CREAR-INSTALADOR.bat** y elige una contraseña. Se crea en el Escritorio **Instalar-PausasActivasQR.exe** (≈70 MB): programa, motor Node.js incluido, túnel a internet y los datos **cifrados**.
2. Envíalo (USB, Google Drive, OneDrive…) y comunica la contraseña por otro medio.
3. En el otro PC: doble clic en el .exe → **Sí** → escribe la contraseña. No hace falta instalar Node.js ni tener permisos de administrador: se instala en `%LOCALAPPDATA%\PausasActivasQR`, crea accesos directos (Escritorio y menú Inicio) y queda funcionando en segundo plano.
   - Windows puede mostrar "Windows protegió su PC" porque el instalador no tiene firma comercial: **Más información → Ejecutar de todas formas**.
4. Panel en ese PC, enlace fijo: **http://localhost:3000/admin**. El QR del día sigue renovándose a las 5:30 a. m.
5. Para actualizar más adelante: genera un instalador nuevo y ejecútalo encima; **conserva los datos** del PC de destino.
6. En el PC anterior: **DESACTIVAR-INICIO-AUTOMATICO.bat**.

## Pasar el sistema a otro PC (alternativa con .zip)

1. En el PC actual: doble clic en **EXPORTAR-PARA-OTRO-PC.bat** y elige una contraseña (mínimo 10 caracteres). Se crea en el Escritorio `PausasActivasQR-para-otro-PC_FECHA.zip`, con el programa y la base de datos **cifrada (AES-256)**: sin la contraseña no se puede leer.
2. Pasa el .zip al otro PC (USB, carpeta compartida o correo). **La contraseña se comunica por otro medio** (en persona o por llamada).
3. En el PC nuevo: instala Node.js LTS, descomprime la carpeta, abre `LEEME-PRIMERO.txt` y haz doble clic en **ACTIVAR-SISTEMA.bat**. Pide la contraseña, importa los datos y deja el sistema funcionando.
4. La nueva administradora crea su cuenta en ese PC (**Crear cuenta de administrador**) o ingresa con una existente.
5. En el PC anterior: **DESACTIVAR-INICIO-AUTOMATICO.bat**, para que no haya dos sistemas con QR distintos.

## Seguridad

| Amenaza | Defensa |
|---|---|
| Adivinar contraseñas | Límite de intentos por IP, bloqueo de la cuenta 15 min tras 5 fallos, contraseñas de mínimo 10 caracteres con letras y números, hash scrypt |
| Robo de sesión | Cookie `HttpOnly`, `SameSite`, `Secure` en https; sesiones de 12 h; en la base solo se guarda el hash del token |
| Ataques desde otros sitios (CSRF, clickjacking) | Verificación de origen en toda petición que modifica datos; `frame-ancestors 'none'` y `X-Frame-Options: DENY` |
| Inyección de código (XSS) / SQL | Política de contenido (CSP) que solo permite scripts propios; React escapa todo el texto; consultas SQL parametrizadas |
| Fórmulas maliciosas en Excel/CSV | Los textos que empiezan por `= + - @` se neutralizan al exportar |
| Crear administradores desde internet | La creación de cuentas solo funciona desde el PC servidor; desde el enlace público se rechaza |
| Acceso de otros usuarios del PC | La carpeta `data/` solo la pueden abrir el usuario de Windows que activó el sistema, SYSTEM y los administradores |
| Pérdida de datos | Copia de seguridad diaria automática en `data/respaldos/diarios/` (30 días) |
| Actividad sospechosa | Página **Auditoría**: inicios de sesión (también fallidos), cambios y exportaciones, con fecha, usuario e IP |
| Dependencias vulnerables | `npm audit`: 0 vulnerabilidades |

## Requisitos

- **Node.js 22.13 o superior** (probado con Node 24). No necesita una base de datos externa: usa SQLite integrado en un solo archivo (`data/pausas.db`).

## Puesta en marcha

```bash
npm install
npm run build        # compila la aplicación web
npm start            # inicia el servidor en http://localhost:3000
```

Abre **http://localhost:3000/admin** en el computador donde está instalado el sistema. La primera vez aparece **Crear cuenta de administrador**: escribe tu nombre, correo, contraseña y el nombre de la organización. Por seguridad, esta cuenta inicial solo se puede crear desde ese mismo equipo, no desde el enlace público ni desde otro computador. Los demás usuarios se crean después en *Usuarios*.

### Borrar todos los datos y empezar de cero

Con el sistema **apagado** (cierra la ventana negra):

```bash
npm run reiniciar -- --confirmar --empresas "IMES,VIU,FOCA" --cargos IMES=datos/cargos-imes.csv --cargos VIU=datos/cargos-viu.csv --cargos FOCA=datos/cargos-foca.csv
```

Antes de borrar se guarda un respaldo en `data/respaldos/`. Se eliminan los registros, colaboradores, catálogos, usuarios y configuración; el QR principal fijo se conserva igual. Al abrir el panel de nuevo se pide crear la cuenta de administrador.

### Cargos por empresa

Las listas oficiales están en `datos/` (`cargos-imes.csv`, `cargos-viu.csv`, `cargos-foca.csv`). En el formulario, cada colaborador solo ve los cargos de la empresa que elige. Un cargo con el mismo nombre en varias empresas (por ejemplo, GERENTE GENERAL) se guarda una vez y queda asignado a cada una. En *Cargos* se puede editar, asignar a empresas o importar más desde Excel/CSV.

### Datos de demostración (opcional)

```bash
npm run demo                      # catálogos de ejemplo + ~3 semanas de registros ficticios
npm run demo -- --solo-catalogos  # solo empresas, sedes, cargos y QR de ejemplo
```

`npm run demo` no hace nada si la base ya tiene registros. Para empezar de cero, detén el servidor y borra la carpeta `data/`.

### Desarrollo

```bash
npm run dev    # API con recarga automática (puerto 3000) + Vite (puerto 5173)
npm test       # pruebas de la API
```

## Primeros pasos en el panel

1. **Empresas:** crea las razones sociales.
2. **Sedes:** crea las sedes e indica qué empresas operan en cada una. El formulario solo muestra las sedes de la empresa elegida.
3. **Cargos:** créalos uno a uno o impórtalos desde Excel/CSV (botón *Plantilla*). La importación muestra una vista previa antes de aplicar.
4. **Código QR:** el **QR principal fijo** ya existe (enlace `…/pausas`). No se puede regenerar, desactivar ni borrar, para que lo impreso y lo enviado funcione siempre. Si quieres saber desde qué lugar se registra la gente, puedes agregar QR opcionales por lugar.
5. **Configuración:** nombre de la organización, URL pública, mensaje de invitación y texto de tratamiento de datos (Ley 1581).

## Enviar los QR a los colaboradores

En **Código QR → Enviar con indicaciones** (o *Kit de envío* en los QR por lugar) encontrarás:

- **Enlace directo** para copiar.
- **Mensaje con las indicaciones** paso a paso, editable, con botones para **WhatsApp**, **correo** o copiar.
- **Imagen PNG** del QR para pantallas, TV o presentaciones.
- **Afiche para imprimir** (tamaño carta): QR grande, 4 pasos ilustrados y la dirección escrita por si alguien no puede escanear. Se imprime o se guarda como PDF desde el navegador.

> **Al enviar por celular:** quien recibe el mensaje en su teléfono no puede escanear un QR que está en su propia pantalla. Por eso el mensaje incluye el **enlace directo**, que basta con tocar. El QR es para afiches y pantallas.

## ⚠ Antes de enviar los QR: publicar el sistema

Mientras el sistema corre en este equipo, los QR apuntan a una dirección de red local (por ejemplo `http://192.168.4.195:3000`). Esa dirección **solo funciona**:

- en celulares conectados al **mismo Wi-Fi** de la oficina, y
- mientras **este equipo esté encendido** con `npm start` corriendo.

Sirve para pruebas. Para que funcione desde cualquier red (datos móviles, otras sedes, casa):

1. Publica el sistema en un servidor accesible desde internet, de una de estas formas:
   - **Servidor de la empresa** (Windows o Linux) con Node.js, detrás de IIS/nginx con HTTPS, y un dominio como `pausas.tuempresa.com`.
   - **Servicio en la nube** con disco persistente (Render, Railway, una VM de Azure/AWS, etc.). Comando de inicio: `npm install && npm run build && npm start`. La carpeta `data/` debe estar en un disco persistente.
2. En **Configuración → URL pública** escribe esa dirección (`https://pausas.tuempresa.com`). Todos los QR y enlaces se actualizan solos.
3. Imprime y envía los QR **después** de este paso. Si cambias la URL más adelante, los afiches impresos con la dirección anterior dejan de funcionar.

Si el servidor está detrás de un proxy, define `TRUST_PROXY=1` en `.env`.

**Copia de seguridad:** toda la información está en `data/pausas.db` (y sus archivos `-wal` y `-shm`). Respáldala a diario.

### Probar desde un celular en la oficina

1. Conecta el celular al mismo Wi-Fi que este equipo.
2. Ejecuta `npm start`. Si Windows pregunta por el Firewall, permite el acceso en **redes privadas**.
3. Abre en el panel *Códigos QR → Kit de envío* y escanea el QR, o abre el enlace en el celular.

## Reglas del registro

- **Respuesta de la pausa:** cada registro guarda si la realizó (Sí/No), la hora indicada por el colaborador (formato HH:MM, del mismo día) y el motivo si no la hizo. El monitor y los reportes muestran quién la realizó, quién no y el **% de cumplimiento**. La gráfica por hora usa la hora indicada por el colaborador.
- **Antiduplicado:** una misma cédula no puede registrarse dos veces dentro de la ventana configurada (por defecto 30 minutos; se cambia en Configuración). La persona ve "Ya estás registrado".
- **Catálogos restrictivos:** empresa, sede y cargo solo aceptan valores activos del catálogo. Un cargo desactivado desaparece del formulario, pero los registros históricos se conservan.
- **Historial fiel:** cada registro guarda el nombre y la cédula del momento del registro.
- **Hora:** se guarda en UTC y se muestra en hora de Colombia (America/Bogota).
- **Elementos con registros:** no se pueden eliminar, solo desactivar.

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, incluidos usuarios y configuración |
| SST | Monitor, reportes, QR, cargos, sedes y empresas |
| Consulta | Ver el monitor y los reportes (con la cédula parcialmente oculta) |

Un usuario puede quedar limitado a **una empresa**: solo verá los registros de esa empresa.

## Prueba de carga

Simula a muchos colaboradores registrándose a la vez. Hazla **contra una base de datos de prueba**, porque crea registros ficticios:

```bash
# Terminal 1: servidor de prueba (PowerShell)
$env:DB_PATH="data/prueba-carga.db"; $env:PORT="3100"; $env:LIMITE_REGISTROS_POR_MINUTO_IP="100000"
npm run demo -- --solo-catalogos
npm start

# Terminal 2
npm run carga -- --url http://localhost:3100 --token <token-de-un-qr> --total 1000 --segundos 120
```

Resultado medido en este equipo con **1.000 registros en 20 s** (6 veces más exigente que la meta): 0 errores, p50 6 ms, p95 36 ms.

## Estructura

```
server/            API (Express + SQLite integrado de Node)
  db.js            esquema y configuración por defecto
  registros.js     registro público (validación, antiduplicado)
  reportes.js      consolidados, filtros, exportación XLSX/CSV
  rutas-*.js       endpoints públicos, de autenticación y de administración
  seed-demo.js     datos de demostración
web/src/
  registro/        formulario móvil (/r/:token)
  admin/           panel (/admin): monitor, reportes, QR, catálogos, usuarios, configuración
tests/             pruebas de la API y prueba de carga
docs/              propuesta técnica
```
