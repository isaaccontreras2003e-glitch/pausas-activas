# Sistema QR de Registro de Pausas Activas — Propuesta Técnica

> Versión 1.0 · 2026-10-29
> Alcance: registro de asistencia a pausas activas mediante QR, dashboard en tiempo real para SST, gestión de parámetros y exportación de reportes.
>
> **Nota de implementación (v1):** se construyó con la variante *on‑premise* de la sección 1.3, es decir, Node.js + Express + SQLite integrado + Server‑Sent Events para el tiempo real, con React + Tailwind en el frontend. Así funciona sin cuentas externas ni Docker. El modelo de datos y las reglas son los de esta propuesta. Se agregaron dos cosas: el QR "general" (sin sede) para envíos por WhatsApp/correo y el kit de envío. Migrar a PostgreSQL/Supabase sigue siendo posible si el volumen lo exige.

---

## 0. Resumen ejecutivo

| Decisión | Recomendación | Motivo |
|---|---|---|
| Base de datos + backend | **Supabase** (PostgreSQL gestionado + Realtime + Auth + Row Level Security) | Elimina la necesidad de escribir y operar un servidor propio. Trae tiempo real nativo y SQL completo para los consolidados. |
| Frontend | **React + Vite + TypeScript + Tailwind CSS** | Rápido de construir. Un solo proyecto sirve el formulario móvil y el panel administrativo. |
| Gráficas | **Recharts** | Ligera y suficiente para barras, tortas y series de tiempo. |
| Exportación | **SheetJS (xlsx)** en el navegador; Edge Function para volúmenes grandes | Sin servidor adicional para el caso normal. |
| Hosting | **Vercel** o **Netlify** (frontend) + Supabase Cloud | Despliegue con `git push`, HTTPS automático y CDN. |

**Tiempo estimado hasta producción (MVP): 4–5 semanas** con 1 desarrollador full‑stack.

---

## 1. Arquitectura recomendada

### 1.1 Diagrama lógico

```
 ┌────────────────┐   escanea    ┌──────────────────────────────┐
 │  Colaborador   │ ───────────► │  QR físico (punto de pausa)  │
 │  (celular)     │              │  https://pausas.app/r/{token}│
 └───────┬────────┘              └──────────────────────────────┘
         │ HTTPS
         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  Frontend React (Vercel CDN)                                 │
 │   • /r/:token   → Formulario móvil (público)                 │
 │   • /admin/*    → Dashboard SST (requiere login)             │
 └───────┬──────────────────────────────────────┬───────────────┘
         │ RPC: registrar_pausa()               │ SELECT / Realtime
         ▼                                      ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  Supabase                                                    │
 │   • PostgreSQL (tablas, vistas, funciones, RLS)              │
 │   • Realtime (canal sobre registros_pausa)                   │
 │   • Auth (usuarios administradores / SST)                    │
 │   • Edge Functions (exportes masivos, opcional)              │
 └──────────────────────────────────────────────────────────────┘
```

### 1.2 Por qué Supabase y no un backend propio

- **Tiempo real sin infraestructura extra**: el dashboard se suscribe a los `INSERT` de `registros_pausa`. No hay que montar WebSockets.
- **Seguridad declarativa**: con Row Level Security, el formulario público **solo** puede ejecutar la función `registrar_pausa()`. No puede leer ni modificar tablas.
- **SQL real**: los consolidados por sede, cargo y empresa son vistas y funciones SQL. Son rápidos, se indexan y se prueban fácilmente.
- **Costo**: el plan gratuito cubre el piloto. El plan Pro (≈ USD 25/mes) cubre miles de registros diarios.

### 1.3 Alternativa *on‑premise*

Si la política de TI exige alojar todo en servidores propios, se usa **la misma arquitectura** con piezas autogestionadas:

| Pieza | Equivalente on‑prem |
|---|---|
| Supabase | PostgreSQL 16 + **Node.js (NestJS/Fastify)** o **Python (FastAPI)** |
| Realtime | Socket.IO o Server‑Sent Events, con `LISTEN/NOTIFY` de PostgreSQL |
| Auth | JWT + bcrypt, o Keycloak si ya existe un directorio corporativo |
| Hosting | Docker Compose (nginx + api + postgres) |

El modelo de datos y la interfaz no cambian. Solo cambia la capa de acceso.

---

## 2. Modelo de base de datos

### 2.1 Diagrama entidad‑relación

```
 empresas 1───* empresa_sede *───1 sedes 1───* puntos_qr
    │                                │              │
    │                                │              │
    └──────────┐      cargos         │              │
               │        │            │              │
               ▼        ▼            ▼              ▼
             ┌────────────────────────────────────────┐
             │            registros_pausa              │
             │  colaborador_id → colaboradores         │
             └────────────────────────────────────────┘

 perfiles_admin (1:1 con auth.users) ─ rol: admin | sst | consulta
```

### 2.2 Decisiones de diseño

1. **`colaboradores` separado de `registros_pausa`**: la cédula identifica a la persona una sola vez. Los registros guardan además una **copia (snapshot)** del nombre, el cargo, la sede y la empresa en el momento del registro. Así, si alguien cambia de cargo, los reportes históricos no se alteran.
2. **Catálogos con borrado lógico (`activo`)**: un cargo o una sede desactivados desaparecen del desplegable, pero los registros antiguos conservan su referencia.
3. **`empresa_sede` (muchos a muchos)**: una sede física puede ser compartida por varias razones sociales. El desplegable de sedes se filtra según la empresa elegida.
4. **`puntos_qr`**: cada QR físico tiene un token propio. Esto permite saber **dónde** se escaneó, preseleccionar la sede, desactivar un QR comprometido y generar estadísticas por punto.
5. **Antiduplicados**: no se acepta otro registro de la misma cédula dentro de una ventana configurable (por defecto 30 minutos).
6. **Zona horaria**: se guarda en `timestamptz` (UTC) y se presenta en `America/Bogota`.

### 2.3 DDL (PostgreSQL / Supabase)

```sql
-- ============ CATÁLOGOS ============
create table empresas (
  id          bigint generated always as identity primary key,
  nit         varchar(20) unique,
  nombre      varchar(150) not null unique,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table sedes (
  id          bigint generated always as identity primary key,
  nombre      varchar(120) not null,
  ciudad      varchar(80),
  direccion   varchar(200),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (nombre, ciudad)
);

create table empresa_sede (
  empresa_id  bigint references empresas(id) on delete cascade,
  sede_id     bigint references sedes(id)    on delete cascade,
  primary key (empresa_id, sede_id)
);

create table cargos (
  id          bigint generated always as identity primary key,
  codigo      varchar(30) unique,          -- opcional, para cruzar con nómina
  nombre      varchar(120) not null unique,
  area        varchar(80),                 -- agrupador opcional (Administrativo, Operativo…)
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table puntos_qr (
  id          bigint generated always as identity primary key,
  token       varchar(32) not null unique default encode(gen_random_bytes(12), 'hex'),
  sede_id     bigint not null references sedes(id),
  descripcion varchar(120) not null,       -- "Piso 3 – Cafetería"
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- ============ PERSONAS Y REGISTROS ============
create table colaboradores (
  id              bigint generated always as identity primary key,
  cedula          varchar(15) not null unique check (cedula ~ '^[0-9]{5,15}$'),
  nombre_completo varchar(150) not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create table registros_pausa (
  id               bigint generated always as identity primary key,
  colaborador_id   bigint not null references colaboradores(id),
  empresa_id       bigint not null references empresas(id),
  sede_id          bigint not null references sedes(id),
  cargo_id         bigint not null references cargos(id),
  punto_qr_id      bigint references puntos_qr(id),
  -- snapshot para reportes históricos fieles
  nombre_snapshot  varchar(150) not null,
  cedula_snapshot  varchar(15)  not null,
  registrado_en    timestamptz  not null default now(),
  user_agent       varchar(300),
  acepta_tratamiento_datos boolean not null default true
);

create index ix_reg_fecha        on registros_pausa (registrado_en desc);
create index ix_reg_sede_fecha   on registros_pausa (sede_id, registrado_en);
create index ix_reg_cargo_fecha  on registros_pausa (cargo_id, registrado_en);
create index ix_reg_emp_fecha    on registros_pausa (empresa_id, registrado_en);
create index ix_reg_colab_fecha  on registros_pausa (colaborador_id, registrado_en desc);

-- ============ ADMINISTRADORES ============
create table perfiles_admin (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nombre    varchar(150) not null,
  rol       varchar(20)  not null check (rol in ('admin','sst','consulta')),
  empresa_id bigint references empresas(id)   -- null = ve todas las empresas
);

create table configuracion (
  clave  varchar(50) primary key,
  valor  text not null
);
insert into configuracion values ('ventana_antiduplicado_min', '30');
```

### 2.4 Función pública de registro (único punto de escritura)

```sql
create or replace function registrar_pausa(
  p_token text, p_cedula text, p_nombre text,
  p_empresa_id bigint, p_sede_id bigint, p_cargo_id bigint,
  p_user_agent text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_punto   puntos_qr%rowtype;
  v_colab   bigint;
  v_ventana int;
  v_reg     registros_pausa%rowtype;
begin
  -- 1. QR válido y activo
  select * into v_punto from puntos_qr where token = p_token and activo;
  if not found then raise exception 'QR_INVALIDO'; end if;

  -- 2. Catálogos activos y relación empresa–sede válida
  if not exists (select 1 from cargos where id = p_cargo_id and activo) then
    raise exception 'CARGO_INVALIDO'; end if;
  if not exists (select 1 from empresa_sede es join sedes s on s.id = es.sede_id
                 join empresas e on e.id = es.empresa_id
                 where es.empresa_id = p_empresa_id and es.sede_id = p_sede_id
                   and s.activo and e.activo) then
    raise exception 'SEDE_EMPRESA_INVALIDA'; end if;

  -- 3. Normalizar y crear/actualizar colaborador
  p_nombre := initcap(trim(regexp_replace(p_nombre, '\s+', ' ', 'g')));
  insert into colaboradores (cedula, nombre_completo)
  values (p_cedula, p_nombre)
  on conflict (cedula) do update
     set nombre_completo = excluded.nombre_completo, actualizado_en = now()
  returning id into v_colab;

  -- 4. Antiduplicado (bloqueo por colaborador para evitar dobles toques)
  perform pg_advisory_xact_lock(v_colab);
  select valor::int into v_ventana from configuracion where clave = 'ventana_antiduplicado_min';
  if exists (select 1 from registros_pausa
             where colaborador_id = v_colab
               and registrado_en > now() - make_interval(mins => v_ventana)) then
    raise exception 'YA_REGISTRADO';
  end if;

  -- 5. Insertar
  insert into registros_pausa (colaborador_id, empresa_id, sede_id, cargo_id, punto_qr_id,
                               nombre_snapshot, cedula_snapshot, user_agent)
  values (v_colab, p_empresa_id, p_sede_id, p_cargo_id, v_punto.id,
          p_nombre, p_cedula, left(p_user_agent, 300))
  returning * into v_reg;

  return json_build_object('id', v_reg.id, 'registrado_en', v_reg.registrado_en);
end $$;

grant execute on function registrar_pausa to anon;
```

### 2.5 Seguridad (RLS)

```sql
alter table registros_pausa enable row level security;
alter table colaboradores   enable row level security;
-- (igual para todas las tablas)

-- Público (anon): solo lee catálogos activos para llenar los desplegables
create policy cat_publico on cargos   for select to anon using (activo);
create policy cat_publico on empresas for select to anon using (activo);
create policy cat_publico on sedes    for select to anon using (activo);
create policy cat_publico on empresa_sede for select to anon using (true);
-- anon NO tiene políticas sobre registros_pausa ni colaboradores → no puede leerlas

-- Administradores autenticados: lectura filtrada por empresa si aplica
create policy admin_lee on registros_pausa for select to authenticated
using (exists (select 1 from perfiles_admin p
               where p.user_id = auth.uid()
                 and (p.empresa_id is null or p.empresa_id = registros_pausa.empresa_id)));

-- Solo rol 'admin' gestiona catálogos
create policy admin_gestiona on cargos for all to authenticated
using      (exists (select 1 from perfiles_admin where user_id = auth.uid() and rol = 'admin'))
with check (exists (select 1 from perfiles_admin where user_id = auth.uid() and rol = 'admin'));
-- (replicar para empresas, sedes, empresa_sede, puntos_qr)
```

### 2.6 Consolidados (vista + función con filtros)

```sql
create or replace function consolidado(
  p_desde timestamptz, p_hasta timestamptz,
  p_dimension text,                         -- 'sede' | 'cargo' | 'empresa'
  p_empresa_id bigint default null, p_sede_id bigint default null, p_cargo_id bigint default null
) returns table (etiqueta text, registros bigint, personas_unicas bigint)
language sql stable as $$
  select case p_dimension
           when 'sede'    then s.nombre
           when 'cargo'   then c.nombre
           when 'empresa' then e.nombre end,
         count(*),
         count(distinct r.colaborador_id)
  from registros_pausa r
  join sedes s    on s.id = r.sede_id
  join cargos c   on c.id = r.cargo_id
  join empresas e on e.id = r.empresa_id
  where r.registrado_en between p_desde and p_hasta
    and (p_empresa_id is null or r.empresa_id = p_empresa_id)
    and (p_sede_id    is null or r.sede_id    = p_sede_id)
    and (p_cargo_id   is null or r.cargo_id   = p_cargo_id)
  group by 1
  order by 2 desc;
$$;
```

> La función respeta RLS porque se ejecuta como `security invoker` (comportamiento por defecto). Cada administrador ve solo lo que su perfil le permite.

---

## 3. Diseño de interfaz (UI/UX)

### 3.1 Principios

- **Mobile‑first, menos de 30 segundos por registro.** Se toca, se llena y se envía.
- **Recordar al colaborador**: tras el primer registro se guardan cédula, nombre, empresa, sede y cargo en el `localStorage` del celular. Desde la segunda vez, el formulario aparece **prellenado** y basta con tocar "Registrar".
- **Sede preseleccionada desde el QR**: el token del QR ya indica la sede. El campo sigue siendo editable.
- Campos grandes (altura ≥ 48 px), `inputmode="numeric"` para la cédula y `font-size ≥ 16px` para que iOS no haga zoom.
- Accesibilidad: contraste AA, etiquetas visibles (no solo *placeholder*) y errores debajo de cada campo.

### 3.2 Formulario móvil

```
┌─────────────────────────────┐
│  [logo]   Pausas Activas    │
│  📍 Sede Centro · Piso 3     │  ← viene del QR
├─────────────────────────────┤
│  Nombre completo *          │
│  ┌───────────────────────┐  │
│  │ María Pérez Gómez     │  │
│  └───────────────────────┘  │
│  Cédula *                   │
│  ┌───────────────────────┐  │
│  │ 1045XXXXXX            │  │  teclado numérico
│  └───────────────────────┘  │
│  Empresa *                  │
│  ┌───────────────────── ▾┐  │
│  │ Empresa A S.A.S.      │  │
│  └───────────────────────┘  │
│  Sede *                     │
│  ┌───────────────────── ▾┐  │  filtrada por empresa
│  │ Sede Centro           │  │
│  └───────────────────────┘  │
│  Cargo *                    │
│  ┌───────────────────── ▾┐  │  lista con buscador
│  │ 🔍 Auxiliar de factu… │  │  (solo valores del catálogo)
│  └───────────────────────┘  │
│  ☑ Autorizo el tratamiento  │
│    de mis datos (Ley 1581)  │
│                             │
│ ┌─────────────────────────┐ │
│ │  REGISTRAR PAUSA ACTIVA │ │  botón fijo inferior
│ └─────────────────────────┘ │
└─────────────────────────────┘

        ── tras enviar ──

┌─────────────────────────────┐
│            ✔                │
│   ¡Registro exitoso!        │
│   María Pérez Gómez         │
│   29/10/2026 · 10:02 a. m.  │
│   Sede Centro               │
│                             │
│   ¡Gracias por cuidarte! 💪 │
└─────────────────────────────┘
```

**Validaciones del cliente** (con Zod + React Hook Form; el servidor repite las mismas):

| Campo | Regla |
|---|---|
| Nombre | Obligatorio, 5–150 caracteres, solo letras y espacios, al menos 2 palabras |
| Cédula | Obligatoria, solo dígitos, 5–15 caracteres |
| Empresa / Sede / Cargo | Obligatorios. El valor debe existir en el catálogo; no se acepta texto libre |
| Tratamiento de datos | Casilla obligatoria |

**Mensajes de error del servidor** traducidos al usuario:

| Código | Mensaje |
|---|---|
| `YA_REGISTRADO` | "Ya registraste tu pausa activa hace menos de 30 minutos." |
| `QR_INVALIDO` | "Este código QR no está activo. Avisa al equipo de SST." |
| Sin conexión | "Sin conexión. Reintentaremos automáticamente." (cola local con reintento) |

### 3.3 Dashboard administrativo

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  Pausas Activas · SST          Empresa [Todas ▾]       👤 Ana (SST) ⏻  │
├────────────┬─────────────────────────────────────────────────────────────┤
│ ▸ Monitor  │ Filtros: [📅 29/10/2026 00:00 → 29/10/2026 23:59] [Sede ▾]   │
│   Reportes │          [Cargo ▾] [Aplicar]        [⬇ Excel] [⬇ CSV]       │
│   Cargos   ├─────────────────────────────────────────────────────────────┤
│   Sedes    │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│   Empresas │ │ Registros│ │ Personas │ │ Sedes    │ │ ● EN VIVO        │ │
│   QR       │ │   412    │ │  única   │ │ activas  │ │ último hace 8 s  │ │
│   Usuarios │ │ ▲12% vs  │ │   387    │ │  6 / 7   │ │                  │ │
│            │ │  ayer    │ │          │ │          │ │                  │ │
│            │ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
│            │ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│            │ │ Registros por hora (hoy)    │ │ Por sede                │ │
│            │ │  ▁▂▅█▃▁▁▂▆█▄▁               │ │ Centro    ████████ 180  │ │
│            │ │  8  9 10 11 …  15 16        │ │ Norte     █████    112  │ │
│            │ └─────────────────────────────┘ │ Bodega    ███       70  │ │
│            │ ┌─────────────────────────────┐ └─────────────────────────┘ │
│            │ │ Por cargo (top 10)          │ ┌─────────────────────────┐ │
│            │ │ Auxiliar     ███████  95    │ │ Por empresa             │ │
│            │ │ Analista     █████    70    │ │ Empresa A  ██████  260  │ │
│            │ └─────────────────────────────┘ │ Empresa B  ████    152  │ │
│            │                                 └─────────────────────────┘ │
│            │ Registros en vivo                              🔍 buscar    │
│            │ ┌──────┬───────────────┬──────────┬────────┬──────┬───────┐ │
│            │ │ Hora │ Nombre        │ Cédula   │ Cargo  │ Sede │Empresa│ │
│            │ ├──────┼───────────────┼──────────┼────────┼──────┼───────┤ │
│            │ │10:02 │ María Pérez ✨│ 1045…    │ Aux.   │Centro│ A     │ │ ← fila nueva
│            │ │10:01 │ Juan Ruiz     │ 7231…    │ Anal.  │Norte │ B     │ │   resaltada
│            │ └──────┴───────────────┴──────────┴────────┴──────┴───────┘ │
└────────────┴─────────────────────────────────────────────────────────────┘
```

**Pantallas de gestión de parámetros** (Cargos, Sedes, Empresas, QR):

```
┌─ Cargos ────────────────────────────────────────────────────────────────┐
│ [+ Nuevo cargo]  [⬆ Importar Excel/CSV]  [⬇ Plantilla]   🔍 buscar      │
├────────┬──────────────────────────┬───────────────┬────────┬────────────┤
│ Código │ Nombre                   │ Área          │ Estado │ Acciones   │
│ C-001  │ Auxiliar de facturación  │ Administrativo│ ● Activo│ ✎  ⏸     │
│ C-002  │ Operario de bodega       │ Operativo     │ ○ Inact.│ ✎  ▶     │
└────────┴──────────────────────────┴───────────────┴────────┴────────────┘
 Importar: vista previa → detecta duplicados/nuevos/cambios → confirmar.
```

- **QR**: lista de puntos por sede con botón **"Descargar QR (PNG/PDF para imprimir)"**. Genera un afiche A5 con logo, instrucciones y el QR. Incluye además la opción **"Regenerar token"** por si un QR se filtra.
- **Usuarios**: invitación por correo y asignación de rol (`admin`, `sst`, `consulta`) y empresa.

### 3.4 Implementación del tiempo real

```ts
// Dashboard: suscripción a inserciones
supabase
  .channel('registros')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'registros_pausa' },
      (payload) => {
        agregarFilaEnVivo(payload.new);       // tabla "en vivo"
        queryClient.invalidateQueries(['consolidados']); // con debounce de 3 s
      })
  .subscribe();
```

Los consolidados se recalculan con **debounce** para no saturar la base de datos cuando entran muchos registros a la vez. La tabla en vivo se actualiza al instante.

### 3.5 Exportación

| Reporte | Contenido | Formato |
|---|---|---|
| Detallado | Una fila por registro: fecha, hora, nombre, cédula, empresa, sede, cargo, punto QR | XLSX / CSV |
| Consolidado | Hojas "Por sede", "Por cargo", "Por empresa" y "Por día", con registros y personas únicas | XLSX (multi‑hoja) |

- Hasta unos 50.000 filas: se genera en el navegador con SheetJS.
- Por encima de eso: una Edge Function genera el archivo, lo sube a Storage y devuelve un enlace de descarga temporal.
- CSV con separador `;` y BOM UTF‑8, para que Excel en español lo abra con tildes y columnas correctas.

---

## 4. Plan de implementación

### Fase 0 — Definición (3 días)
- Validar con SST: catálogo inicial de cargos, sedes y empresas; ventana antiduplicado; ¿se permite registrar más de una pausa por jornada?
- Redactar el aviso de **tratamiento de datos personales (Ley 1581 de 2012)** junto con el área jurídica.
- Definir el dominio (ej. `pausas.empresa.com`) y la identidad visual.

### Fase 1 — Base de datos y seguridad (Semana 1)
- Crear el proyecto Supabase (separado para **dev** y **prod**).
- Escribir migraciones SQL versionadas (`supabase/migrations`): tablas, índices, funciones y RLS.
- Cargar datos semilla con los catálogos iniciales.
- **Pruebas de la función `registrar_pausa`** (pgTAP o scripts SQL): QR inválido, cargo inactivo, duplicado y combinación empresa–sede inválida.

### Fase 2 — Formulario móvil (Semana 2)
- Ruta `/r/:token`: carga de catálogos, preselección de sede, validación y envío.
- Memoria local del colaborador y pantalla de éxito.
- Manejo sin conexión: cola en `localStorage` con reintento.
- Pruebas en dispositivos reales: Android de gama baja, iPhone, Chrome y Safari.

### Fase 3 — Dashboard y gestión (Semanas 3–4)
- Login (correo y contraseña, o *magic link*) y control de roles.
- Monitor en vivo: KPIs, gráficas, tabla en tiempo real y filtros por fechas, horas, empresa, sede y cargo.
- CRUD de cargos, sedes, empresas y puntos QR, con importación masiva desde Excel.
- Generador de afiches QR imprimibles.
- Exportaciones XLSX y CSV.

### Fase 4 — Pruebas de carga y calidad (Semana 4)
Escenario crítico: **toda la empresa hace la pausa a la misma hora** (por ejemplo, 10:00 a. m.).

```js
// k6: 1.000 colaboradores registrando en 2 minutos
export const options = {
  scenarios: {
    pico_pausa: { executor: 'ramping-arrival-rate', startRate: 0, timeUnit: '1s',
      preAllocatedVUs: 200,
      stages: [{ target: 20, duration: '30s' }, { target: 20, duration: '90s' }] },
  },
  thresholds: { http_req_duration: ['p(95)<800'], http_req_failed: ['rate<0.01'] },
};
```

| Métrica | Meta |
|---|---|
| Tiempo de respuesta p95 del registro | < 800 ms |
| Errores | < 1 % |
| Latencia del dashboard (insert → pantalla) | < 3 s |
| Carga inicial del formulario en 4G | < 2 s (bundle < 150 KB gzip) |

También se ejecutan: pruebas E2E con Playwright (registro completo y flujo del admin), auditoría Lighthouse móvil (≥ 90) y una revisión de seguridad que confirme que `anon` no puede leer registros.

### Fase 5 — Piloto (1 semana)
- Desplegar en **una sede** con 2–3 puntos QR.
- Medir el tiempo promedio de registro, los errores y la retroalimentación de los colaboradores.
- Ajustar textos, orden de campos y catálogo de cargos.

### Fase 6 — Despliegue general de los QR
1. Crear en el panel un **punto QR por cada espacio** (sala, piso, cafetería).
2. Imprimir los afiches en material resistente (laminado o PVC), de al menos **8 × 8 cm**, con corrección de errores nivel **M o H**, ubicados a la altura de los ojos y con buena luz.
3. Incluir en el afiche una **URL corta de respaldo** para quien no pueda escanear.
4. Probar cada QR instalado con al menos dos celulares distintos.
5. Hacer una campaña interna: correo, pantalla en la intranet y demostración en la primera pausa.
6. Durante el primer mes, revisar a diario el panel "Puntos QR sin registros" para detectar códigos dañados o mal ubicados.

### Fase 7 — Operación
- Backups automáticos diarios (Supabase Pro) y una exportación mensual a almacenamiento corporativo.
- Política de retención: anonimizar o depurar registros con más de N años, según el área jurídica.
- Monitoreo con alertas de errores (Sentry) y de disponibilidad (UptimeRobot).

---

## 5. Estructura sugerida del repositorio

```
sistema_qr_asistencia_pausas_activas/
├── docs/
│   └── PROPUESTA_TECNICA.md
├── supabase/
│   ├── migrations/          # DDL, funciones, RLS (versionado)
│   ├── seed.sql             # catálogos iniciales
│   └── functions/
│       └── exportar/        # Edge Function para exportes grandes
├── web/
│   ├── src/
│   │   ├── features/
│   │   │   ├── registro/    # formulario móvil /r/:token
│   │   │   ├── dashboard/   # monitor, KPIs, gráficas
│   │   │   ├── catalogos/   # cargos, sedes, empresas, QR
│   │   │   └── reportes/    # filtros + exportación
│   │   ├── lib/supabase.ts
│   │   └── main.tsx
│   └── package.json
├── tests/
│   ├── e2e/                 # Playwright
│   └── carga/               # k6
└── README.md
```

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Registro fraudulento (alguien registra a un compañero, o fotografía el QR y lo usa desde casa) | Ventana antiduplicado; token por punto que se puede regenerar; (opcional) geolocalización que valide el radio de la sede; (opcional) QR dinámico en pantalla que rota cada 60 s |
| Mala conectividad en planta | Formulario muy liviano, cola de reintento sin conexión y Wi‑Fi para invitados en los puntos de pausa |
| Cargos escritos de forma distinta | Desplegable restrictivo alimentado solo desde el catálogo del administrador |
| Datos personales (cédula) | HTTPS, RLS, aviso de la Ley 1581, cédula enmascarada en el dashboard (`1045****89`) para el rol `consulta` |
| Pico de concurrencia | Una sola función SQL indexada, pruebas k6 previas y plan Pro con *connection pooling* |
