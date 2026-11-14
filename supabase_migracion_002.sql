-- Ligas Unidas — migración 002: auditoría, posiciones, almacenamiento de escudos
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

-- 1. Auditoría ---------------------------------------------------------------
-- Se quita la FK de liga_id para que el historial sobreviva si se borra una liga
-- (y para que los borrados en cascada no choquen con el disparador).
alter table public.auditoria drop constraint if exists auditoria_liga_id_fkey;
create index if not exists auditoria_liga_fecha_idx on public.auditoria (liga_id, fecha desc);

create or replace function private.auditar() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_liga uuid;
begin
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_liga := case when tg_table_name = 'ligas' then (v_row->>'id')::uuid else (v_row->>'liga_id')::uuid end;
  insert into public.auditoria (liga_id, usuario_id, entidad, entidad_id, accion, antes, despues)
  values (
    v_liga,
    (select auth.uid()),
    tg_table_name,
    case when tg_table_name = 'auditoria' then null else (v_row->>'id')::uuid end,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

revoke all on function private.auditar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['ligas','membresias','torneos','categorias','clubes','equipos','jugadores',
                           'planteles','partidos','eventos_partido','suspensiones','sponsors',
                           'institucional','documentos']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.auditar()', 'auditar_' || t, t);
  end loop;
end $$;

-- 2. Posiciones (calculadas, no guardadas) ---------------------------------------
-- security_invoker: respeta la RLS de quien consulta (el público solo ve ligas publicadas).
-- Cuenta partidos 'jugado' y los que tengan ajuste administrativo con ganador.
-- ajuste_anula_goles: los goles del partido cuentan 0-0 para GF/GC.
create or replace view public.posiciones with (security_invoker = true) as
with base as (
  select p.liga_id, p.torneo_id, p.categoria_id,
         p.local_equipo_id as l, p.visitante_equipo_id as v,
         case when p.ajuste_anula_goles then 0 else coalesce(p.goles_local, 0) end as gl,
         case when p.ajuste_anula_goles then 0 else coalesce(p.goles_visitante, 0) end as gv,
         p.ajuste_ganador_equipo_id as gan,
         coalesce((t.reglas->>'puntos_victoria')::int, 3) as pv,
         coalesce((t.reglas->>'puntos_empate')::int, 1)   as pe,
         coalesce((t.reglas->>'puntos_derrota')::int, 0)  as pd
  from public.partidos p
  join public.torneos t on t.id = p.torneo_id
  where p.estado = 'jugado' or p.ajuste_ganador_equipo_id is not null
),
res as (
  select *,
    case when gan is not null then (case when gan = l then 'g' else 'p' end)
         when gl > gv then 'g' when gl < gv then 'p' else 'e' end as r_local
  from base
),
lados as (
  select l as equipo_id, gl as gf, gv as gc, r_local as r, pv, pe, pd from res
  union all
  select v, gv, gl,
         case r_local when 'g' then 'p' when 'p' then 'g' else 'e' end, pv, pe, pd from res
)
select e.liga_id, e.torneo_id, e.categoria_id, e.id as equipo_id,
       c.id as club_id, c.nombre as club, c.nombre_corto, c.escudo_url,
       count(x.r)::int                                   as pj,
       (count(*) filter (where x.r = 'g'))::int          as g,
       (count(*) filter (where x.r = 'e'))::int          as e,
       (count(*) filter (where x.r = 'p'))::int          as p,
       coalesce(sum(x.gf), 0)::int                       as gf,
       coalesce(sum(x.gc), 0)::int                       as gc,
       (coalesce(sum(x.gf), 0) - coalesce(sum(x.gc), 0))::int as dif,
       coalesce(sum(case x.r when 'g' then x.pv when 'e' then x.pe when 'p' then x.pd end), 0)::int as pts
from public.equipos e
join public.clubes c on c.id = e.club_id
left join lados x on x.equipo_id = e.id
group by e.id, c.id;

-- 3. Almacenamiento de escudos y logos -----------------------------------------
-- Convención de ruta: <liga_id>/<archivo>. Lectura pública por URL; escritura solo admin de esa liga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('escudos', 'escudos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy escudos_escribe on storage.objects for insert to authenticated
  with check (bucket_id = 'escudos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
create policy escudos_actualiza on storage.objects for update to authenticated
  using (bucket_id = 'escudos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
create policy escudos_borra on storage.objects for delete to authenticated
  using (bucket_id = 'escudos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
