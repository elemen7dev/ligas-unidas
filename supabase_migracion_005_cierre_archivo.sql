-- Ligas Unidas — migración 005: cierre y archivo de torneos
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

-- 1. Columnas de archivo -----------------------------------------------------
alter table public.torneos add column cerrado_en timestamptz;
alter table public.torneos add column resumen jsonb;

-- 2. Posiciones: solo cuentan los partidos de liga (la Copa Desafío no suma a la tabla)
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
  where p.tipo = 'liga' and (p.estado = 'jugado' or p.ajuste_ganador_equipo_id is not null)
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

-- 3. Cerrar torneo: guarda una foto fija (campeón, tabla final, goleadores) -----------
-- security invoker: se aplica la RLS de quien llama. Solo admin de la liga o superadmin.
create or replace function public.cerrar_torneo(p_torneo uuid, p_forzar boolean default false)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_t public.torneos;
  v_pend int;
  r record;
  v_cats jsonb := '[]'::jsonb;
  v_tabla jsonb; v_gol jsonb; v_camp jsonb; v_emp boolean;
  v_res jsonb;
begin
  select * into v_t from public.torneos where id = p_torneo;
  if not found then raise exception 'Torneo no encontrado'; end if;
  if not private.puede_admin(v_t.liga_id) then
    raise exception 'Sin permiso para cerrar este torneo' using errcode = '42501';
  end if;
  if v_t.estado = 'finalizado' then raise exception 'El torneo ya está finalizado'; end if;

  select count(*) into v_pend from public.partidos
   where torneo_id = p_torneo and estado in ('pendiente','suspendido','postergado')
     and ajuste_ganador_equipo_id is null;
  if v_pend > 0 and not p_forzar then
    raise exception 'Quedan % partidos sin jugar. Para cerrar igual, usá p_forzar = true.', v_pend;
  end if;

  for r in select id, nombre from public.categorias where torneo_id = p_torneo order by orden loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'pos', t.rn, 'club', t.club, 'escudo_url', t.escudo_url, 'pj', t.pj, 'g', t.g, 'e', t.e,
             'p', t.p, 'gf', t.gf, 'gc', t.gc, 'dif', t.dif, 'pts', t.pts) order by t.rn), '[]'::jsonb)
      into v_tabla
      from (select row_number() over (order by po.pts desc, po.dif desc, po.gf desc, po.club) as rn, po.*
              from public.posiciones po where po.categoria_id = r.id) t;

    v_camp := case when jsonb_array_length(v_tabla) > 0 and (v_tabla->0->>'pj')::int > 0
              then jsonb_build_object('club', v_tabla->0->'club', 'escudo_url', v_tabla->0->'escudo_url', 'pts', v_tabla->0->'pts')
              end;
    v_emp := jsonb_array_length(v_tabla) > 1
             and v_tabla->0->>'pts' = v_tabla->1->>'pts'
             and v_tabla->0->>'dif' = v_tabla->1->>'dif'
             and v_tabla->0->>'gf'  = v_tabla->1->>'gf';

    select coalesce(jsonb_agg(jsonb_build_object('jugador', g.nombre || ' ' || g.apellido, 'club', g.club, 'goles', g.goles)
                              order by g.goles desc, g.apellido), '[]'::jsonb)
      into v_gol
      from (select j.nombre, j.apellido, c.nombre as club, count(*) as goles
              from public.eventos_partido e
              join public.partidos p on p.id = e.partido_id
              join public.jugadores j on j.id = e.jugador_id
              join public.equipos eq on eq.id = e.equipo_id
              join public.clubes c on c.id = eq.club_id
             where p.categoria_id = r.id and e.tipo = 'gol'
             group by j.id, j.nombre, j.apellido, c.nombre
             order by count(*) desc, j.apellido
             limit 20) g;

    v_cats := v_cats || jsonb_build_array(jsonb_build_object(
      'nombre', r.nombre, 'campeon', v_camp, 'empate_en_la_cima', v_emp,
      'tabla', v_tabla, 'goleadores', v_gol));
  end loop;

  v_res := jsonb_build_object(
    'cerrado_en', now(), 'forzado', p_forzar, 'partidos_sin_jugar', v_pend,
    'torneo', jsonb_build_object('nombre', v_t.nombre, 'anio', v_t.anio, 'modalidad', v_t.modalidad,
                                 'vueltas', v_t.vueltas, 'reglas', v_t.reglas),
    'categorias', v_cats);

  update public.torneos set estado = 'finalizado', cerrado_en = now(), resumen = v_res where id = p_torneo;
  return v_res;
end $$;

-- 4. Reabrir torneo: solo superadmin ------------------------------------------------
create or replace function public.reabrir_torneo(p_torneo uuid)
returns void
language plpgsql set search_path = ''
as $$
begin
  if not private.es_superadmin() then
    raise exception 'Solo el superadmin puede reabrir un torneo' using errcode = '42501';
  end if;
  update public.torneos set estado = 'en_curso', cerrado_en = null, resumen = null
   where id = p_torneo and estado = 'finalizado';
  if not found then raise exception 'El torneo no existe o no está finalizado'; end if;
end $$;

revoke all on function public.cerrar_torneo(uuid, boolean) from public, anon;
revoke all on function public.reabrir_torneo(uuid) from public, anon;
grant execute on function public.cerrar_torneo(uuid, boolean) to authenticated;
grant execute on function public.reabrir_torneo(uuid) to authenticated;

-- 5. Bloqueo del historial ----------------------------------------------------------
-- En un torneo finalizado solo el superadmin modifica partidos, goles, suspensiones,
-- categorías, equipos y planteles. (Sin sesión de usuario, p. ej. migraciones, no se bloquea.)
create or replace function private.bloquear_torneo_cerrado() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb; v_torneo uuid; v_estado public.estado_torneo;
begin
  if (select auth.uid()) is null or private.es_superadmin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  foreach v_row in array array[
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end]
  loop
    continue when v_row is null;
    if tg_table_name = 'eventos_partido' then
      select p.torneo_id into v_torneo from public.partidos p where p.id = (v_row->>'partido_id')::uuid;
    else
      v_torneo := (v_row->>'torneo_id')::uuid;
    end if;
    select estado into v_estado from public.torneos where id = v_torneo;
    if v_estado = 'finalizado' then
      raise exception 'El torneo está finalizado: solo el superadmin puede modificar su historial'
        using errcode = '42501';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.bloquear_torneo_cerrado() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['partidos','eventos_partido','suspensiones','categorias','equipos','planteles']
  loop
    execute format('create trigger %I before insert or update or delete on public.%I
                    for each row execute function private.bloquear_torneo_cerrado()', 'a_bloqueo_' || t, t);
  end loop;
end $$;

-- Sobre el torneo mismo: no se finaliza sin pasar por cerrar_torneo (debe traer resumen)
-- y, una vez finalizado, solo el superadmin lo modifica, reabre o borra.
create or replace function private.proteger_torneo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' and new.estado = 'finalizado'
     and (tg_op = 'INSERT' or old.estado <> 'finalizado') and new.resumen is null then
    raise exception 'Para finalizar un torneo usá cerrar_torneo()';
  end if;
  if tg_op in ('UPDATE','DELETE') and old.estado = 'finalizado'
     and (select auth.uid()) is not null and not private.es_superadmin() then
    raise exception 'El torneo está finalizado: solo el superadmin puede modificarlo'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.proteger_torneo() from public, anon, authenticated;
create trigger a_proteger_torneo before insert or update or delete on public.torneos
  for each row execute function private.proteger_torneo();

-- 6. Archivo público: torneos finalizados de ligas publicadas (la RLS filtra) -----------
create or replace view public.torneos_archivo with (security_invoker = true) as
select t.id as torneo_id, t.liga_id, l.slug as liga_slug, l.nombre as liga_nombre,
       t.nombre, t.anio, t.modalidad, t.cerrado_en, t.resumen
from public.torneos t
join public.ligas l on l.id = t.liga_id
where t.estado = 'finalizado';
