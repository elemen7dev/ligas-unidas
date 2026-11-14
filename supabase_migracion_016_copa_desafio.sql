-- Ligas Unidas — migración 016: Copa Desafío
-- Reglas (de la demo): la Copa es una final entre el líder de la Ronda 1 y el líder de la Ronda 2 de cada categoría.
-- El campeón del torneo es aparte: el que más puntos acumula en total (no depende de la Copa).
-- La final es un partido con tipo = 'copa'. Si empata, el ganador por penales se guarda en ajuste_ganador_equipo_id.

-- 1. Una sola final por categoría
create unique index partidos_copa_unica on public.partidos (categoria_id) where tipo = 'copa';

-- 2. Posiciones por ronda (misma lógica que "posiciones", separada por ronda)
create or replace view public.posiciones_ronda with (security_invoker = true) as
with base as (
  select p.liga_id, p.torneo_id, p.categoria_id, p.ronda,
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
  select ronda, l as equipo_id, gl as gf, gv as gc, r_local as r, pv, pe, pd from res
  union all
  select ronda, v, gv, gl, case r_local when 'g' then 'p' when 'p' then 'g' else 'e' end, pv, pe, pd from res
),
rondas as (select distinct torneo_id, ronda from public.partidos where tipo = 'liga')
select e.liga_id, e.torneo_id, e.categoria_id, rd.ronda, e.id as equipo_id,
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
join rondas rd on rd.torneo_id = e.torneo_id
left join lados x on x.equipo_id = e.id and x.ronda = rd.ronda
group by e.id, c.id, rd.ronda;

-- 3. Estado de la Copa por categoría (solo torneos con copa_desafio)
create or replace view public.copa_desafio with (security_invoker = true) as
select ca.liga_id, ca.torneo_id, ca.id as categoria_id, ca.nombre as categoria, ca.orden,
       l1.equipo_id as r1_equipo_id, l1.club as r1_club, l1.escudo_url as r1_escudo, l1.pts as r1_pts,
       l2.equipo_id as r2_equipo_id, l2.club as r2_club, l2.escudo_url as r2_escudo, l2.pts as r2_pts,
       (select count(*) from public.partidos p where p.categoria_id = ca.id and p.tipo = 'liga' and p.ronda = 1
          and p.estado <> 'jugado' and p.ajuste_ganador_equipo_id is null)::int as r1_pendientes,
       (select count(*) from public.partidos p where p.categoria_id = ca.id and p.tipo = 'liga' and p.ronda = 2
          and p.estado <> 'jugado' and p.ajuste_ganador_equipo_id is null)::int as r2_pendientes,
       cp.id as final_partido_id, cp.estado as final_estado, cp.goles_local as final_goles_local, cp.goles_visitante as final_goles_visitante,
       cp.fecha_hora as final_fecha_hora, cp.local_club as final_local, cp.visita_club as final_visitante,
       cp.local_escudo as final_local_escudo, cp.visita_escudo as final_visitante_escudo,
       cp.por_penales as final_por_penales, cp.ganador_club as final_ganador
from public.categorias ca
join public.torneos t on t.id = ca.torneo_id and t.copa_desafio
left join lateral (select pr.* from public.posiciones_ronda pr where pr.categoria_id = ca.id and pr.ronda = 1 and pr.pj > 0
                    order by pr.pts desc, pr.dif desc, pr.gf desc, pr.club limit 1) l1 on true
left join lateral (select pr.* from public.posiciones_ronda pr where pr.categoria_id = ca.id and pr.ronda = 2 and pr.pj > 0
                    order by pr.pts desc, pr.dif desc, pr.gf desc, pr.club limit 1) l2 on true
left join lateral (
  select p.id, p.estado, p.goles_local, p.goles_visitante, p.fecha_hora,
         cl.nombre as local_club, cl.escudo_url as local_escudo, cv.nombre as visita_club, cv.escudo_url as visita_escudo,
         (p.estado = 'jugado' and p.goles_local = p.goles_visitante and p.ajuste_ganador_equipo_id is not null) as por_penales,
         case when p.estado = 'jugado' then
           case when p.goles_local > p.goles_visitante then cl.nombre
                when p.goles_local < p.goles_visitante then cv.nombre
                when p.ajuste_ganador_equipo_id = p.local_equipo_id then cl.nombre
                when p.ajuste_ganador_equipo_id = p.visitante_equipo_id then cv.nombre end
         end as ganador_club
  from public.partidos p
  join public.equipos el on el.id = p.local_equipo_id join public.clubes cl on cl.id = el.club_id
  join public.equipos ev on ev.id = p.visitante_equipo_id join public.clubes cv on cv.id = ev.club_id
  where p.categoria_id = ca.id and p.tipo = 'copa' limit 1) cp on true;

-- 4. El cierre del torneo guarda también el resultado de la Copa (si el torneo la tiene)
create or replace function public.cerrar_torneo(p_torneo uuid, p_forzar boolean default false)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_t public.torneos;
  v_pend int;
  r record;
  v_cats jsonb := '[]'::jsonb;
  v_tabla jsonb; v_gol jsonb; v_camp jsonb; v_emp boolean; v_copa jsonb;
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

    v_copa := null;
    if v_t.copa_desafio then
      select jsonb_build_object(
               'lider_ronda1', c.r1_club, 'pts_ronda1', c.r1_pts, 'lider_ronda2', c.r2_club, 'pts_ronda2', c.r2_pts,
               'final', case when c.final_partido_id is null then null else jsonb_build_object(
                  'local', c.final_local, 'visitante', c.final_visitante, 'goles_local', c.final_goles_local,
                  'goles_visitante', c.final_goles_visitante, 'estado', c.final_estado, 'por_penales', c.final_por_penales,
                  'ganador', c.final_ganador) end,
               'campeon_copa', coalesce(c.final_ganador, case when c.r1_club is not null and c.r1_club = c.r2_club then c.r1_club end))
        into v_copa from public.copa_desafio c where c.categoria_id = r.id;
    end if;

    v_cats := v_cats || jsonb_build_array(jsonb_build_object(
      'nombre', r.nombre, 'campeon', v_camp, 'empate_en_la_cima', v_emp,
      'tabla', v_tabla, 'goleadores', v_gol, 'copa', v_copa));
  end loop;

  v_res := jsonb_build_object(
    'cerrado_en', now(), 'forzado', p_forzar, 'partidos_sin_jugar', v_pend,
    'torneo', jsonb_build_object('nombre', v_t.nombre, 'anio', v_t.anio, 'modalidad', v_t.modalidad,
                                 'vueltas', v_t.vueltas, 'reglas', v_t.reglas, 'copa_desafio', v_t.copa_desafio),
    'categorias', v_cats);

  update public.torneos set estado = 'finalizado', cerrado_en = now(), resumen = v_res where id = p_torneo;
  return v_res;
end $$;
revoke all on function public.cerrar_torneo(uuid, boolean) from public, anon;
grant execute on function public.cerrar_torneo(uuid, boolean) to authenticated;
