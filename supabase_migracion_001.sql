-- Ligas Unidas — migración 001 (BORRADOR PARA REVISIÓN, no aplicada)
-- Proyecto Supabase: ligasunidas (llgtnijfikacwtjurvly)
-- Basada en MODELO_DATOS.md

-- 0. Extensiones ---------------------------------------------------------
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists citext   with schema extensions;

-- 1. Tipos ---------------------------------------------------------------
create type public.estado_liga    as enum ('no_publicada', 'publicada');
create type public.rol_liga       as enum ('dueno', 'admin_liga', 'cargador');
create type public.estado_torneo  as enum ('borrador', 'en_curso', 'finalizado');
create type public.estado_partido as enum ('pendiente', 'jugado', 'suspendido', 'postergado');
create type public.tipo_partido   as enum ('liga', 'copa');
create type public.tipo_evento    as enum ('gol', 'gol_en_contra', 'amarilla', 'roja');

-- 2. Tablas --------------------------------------------------------------
create table public.ligas (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique,
  nombre text not null,
  zona text,
  contacto text,
  estado public.estado_liga not null default 'no_publicada',
  logo_url text,
  color_primario text,
  color_secundario text,
  secciones_activas text[] not null default array['fixture','posiciones','goleadores','suspendidos','institucional'],
  plan text,
  vencimiento date,
  creada_en timestamptz not null default now(),
  constraint slug_formato check (slug::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint slug_reservado check (slug::text not in ('panel','ligas','api','admin','login','auth','static','assets'))
);

create table public.membresias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  liga_id uuid references public.ligas(id) on delete cascade,
  rol public.rol_liga not null,
  creada_en timestamptz not null default now(),
  unique (usuario_id, liga_id, rol),
  constraint dueno_global check ((rol = 'dueno') = (liga_id is null))
);

create table public.torneos (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  nombre text not null,
  anio int not null,
  modalidad text not null default 'Fútbol 11',
  formato text not null default 'todos_contra_todos',
  vueltas int not null default 2 check (vueltas in (1, 2)),
  estado public.estado_torneo not null default 'borrador',
  reglas jsonb not null default '{"puntos_victoria":3,"puntos_empate":1,"puntos_derrota":0,"amarillas_para_suspension":4,"columnas_tabla":["PJ","G","E","P","GF","GC","DIF","PTS"]}',
  copa_desafio boolean not null default false,
  creado_en timestamptz not null default now()
);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  nombre text not null,
  orden int not null default 1,
  unique (torneo_id, nombre)
);

create table public.clubes (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  nombre text not null,
  nombre_corto text,
  escudo_url text,
  color1 text,
  color2 text,
  unique (liga_id, nombre)
);

create table public.equipos (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  club_id uuid not null references public.clubes(id) on delete cascade,
  unique (categoria_id, club_id)
);

create table public.jugadores (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  nombre text not null,
  apellido text not null,
  dni text,
  nacimiento date
);

create table public.planteles (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  jugador_id uuid not null references public.jugadores(id) on delete cascade,
  club_id uuid not null references public.clubes(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  categoria_id uuid references public.categorias(id) on delete set null,
  activo boolean not null default true
);

create table public.partidos (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  tipo public.tipo_partido not null default 'liga',
  ronda int not null default 1,
  jornada int not null,
  local_equipo_id uuid not null references public.equipos(id),
  visitante_equipo_id uuid not null references public.equipos(id),
  fecha_hora timestamptz,
  cancha text,
  estado public.estado_partido not null default 'pendiente',
  goles_local int,
  goles_visitante int,
  arbitro text,
  lineas text,
  nota text,
  ajuste_ganador_equipo_id uuid references public.equipos(id),
  ajuste_anula_goles boolean not null default false,
  ajuste_motivo text,
  constraint equipos_distintos check (local_equipo_id <> visitante_equipo_id)
);

create table public.eventos_partido (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  partido_id uuid not null references public.partidos(id) on delete cascade,
  equipo_id uuid not null references public.equipos(id),
  jugador_id uuid references public.jugadores(id),
  tipo public.tipo_evento not null,
  minuto int
);

create table public.suspensiones (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  jugador_id uuid not null references public.jugadores(id) on delete cascade,
  fechas int not null check (fechas > 0),
  motivo text,
  origen text not null default 'manual' check (origen in ('manual','automatica'))
);

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  nombre text not null,
  logo_url text,
  link text,
  orden int not null default 1,
  activo boolean not null default true
);

create table public.institucional (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  orden int not null default 1,
  titulo text not null,
  contenido text not null default ''
);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  tipo text not null check (tipo in ('fichajes','buena_fe')),
  archivo_url text not null,
  subido_en timestamptz not null default now()
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  liga_id uuid references public.ligas(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  entidad text not null,
  entidad_id uuid,
  accion text not null,
  antes jsonb,
  despues jsonb,
  fecha timestamptz not null default now()
);

-- 3. Índices -------------------------------------------------------------
create index on public.membresias (usuario_id);
create index on public.membresias (liga_id);
create index on public.torneos (liga_id);
create index on public.categorias (torneo_id);
create index on public.clubes (liga_id);
create index on public.equipos (torneo_id, categoria_id);
create index on public.planteles (club_id, torneo_id);
create index on public.partidos (torneo_id, categoria_id, ronda, jornada);
create index on public.eventos_partido (partido_id);
create index on public.suspensiones (torneo_id);
create index on public.ligas using gin (nombre extensions.gin_trgm_ops);

-- 4. Funciones de acceso (esquema privado, no expuesto por la API) ----------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

create or replace function private.es_dueno() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.membresias m where m.usuario_id = (select auth.uid()) and m.rol = 'dueno'); $$;

create or replace function private.puede_admin(p_liga uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.es_dueno() or exists (select 1 from public.membresias m where m.usuario_id = (select auth.uid()) and m.liga_id = p_liga and m.rol = 'admin_liga'); $$;

create or replace function private.puede_cargar(p_liga uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.puede_admin(p_liga) or exists (select 1 from public.membresias m where m.usuario_id = (select auth.uid()) and m.liga_id = p_liga and m.rol = 'cargador'); $$;

create or replace function private.liga_publicada(p_liga uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ligas l where l.id = p_liga and l.estado = 'publicada'); $$;

grant execute on all functions in schema private to authenticated, anon;

-- 5. Seguridad por fila --------------------------------------------------
alter table public.ligas           enable row level security;
alter table public.membresias      enable row level security;
alter table public.torneos         enable row level security;
alter table public.categorias      enable row level security;
alter table public.clubes          enable row level security;
alter table public.equipos         enable row level security;
alter table public.jugadores       enable row level security;
alter table public.planteles       enable row level security;
alter table public.partidos        enable row level security;
alter table public.eventos_partido enable row level security;
alter table public.suspensiones    enable row level security;
alter table public.sponsors        enable row level security;
alter table public.institucional   enable row level security;
alter table public.documentos      enable row level security;
alter table public.auditoria       enable row level security;

-- ligas: el público ve las publicadas; solo el dueño crea, edita y borra
create policy ligas_lectura on public.ligas for select
  using (estado = 'publicada' or private.puede_cargar(id));
create policy ligas_dueno_escribe on public.ligas for all to authenticated
  using (private.es_dueno()) with check (private.es_dueno());

-- membresias: cada usuario ve las suyas; solo el dueño administra
create policy membresias_lectura on public.membresias for select to authenticated
  using (usuario_id = (select auth.uid()) or private.es_dueno());
create policy membresias_dueno_escribe on public.membresias for all to authenticated
  using (private.es_dueno()) with check (private.es_dueno());

-- tablas de contenido con liga_id: lectura pública si la liga está publicada;
-- escritura de admin_liga y dueño
do $$
declare t text;
begin
  foreach t in array array['torneos','categorias','clubes','equipos','jugadores','planteles',
                           'partidos','eventos_partido','suspensiones','sponsors','institucional','documentos']
  loop
    execute format('create policy %I on public.%I for select using (private.liga_publicada(liga_id) or private.puede_cargar(liga_id))', t || '_lectura', t);
    if t not in ('partidos','eventos_partido','suspensiones') then
      execute format('create policy %I on public.%I for all to authenticated using (private.puede_admin(liga_id)) with check (private.puede_admin(liga_id))', t || '_admin', t);
    else
      -- el cargador solo carga resultados, eventos y suspensiones
      execute format('create policy %I on public.%I for all to authenticated using (private.puede_cargar(liga_id)) with check (private.puede_cargar(liga_id))', t || '_carga', t);
    end if;
  end loop;
end $$;

-- auditoría: la leen admin y dueño; la escribe el sistema (disparadores, pendientes)
create policy auditoria_lectura on public.auditoria for select to authenticated
  using (private.puede_admin(liga_id));

-- Pendiente para migraciones siguientes: disparadores de auditoría, vista de posiciones,
-- almacenamiento de escudos y logos, alta del usuario dueño (Cristian).
