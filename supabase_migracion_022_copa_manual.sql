-- Ligas Unidas — migración 022: la Copa se carga a mano (varios partidos por categoría)
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
--
-- Antes: una sola final automática (líder de Ronda 1 vs líder de Ronda 2), con índice único por categoría.
-- Ahora: la Copa se carga a mano al terminar el torneo, con semifinales y final.
-- Convención de los partidos de Copa (tipo = 'copa'): ronda 1 = semifinal, ronda 2 = final.
-- Si un partido termina empatado, el ganador por penales va en ajuste_ganador_equipo_id (sin cambios).

-- 1. Se puede cargar más de un partido de Copa por categoría
drop index if exists public.partidos_copa_unica;

-- 2. La vista toma como "final" el partido de Copa de mayor ronda (la final), no uno cualquiera.
--    Mismas columnas que antes; solo cambia el orden del último subselect.
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
  where p.categoria_id = ca.id and p.tipo = 'copa'
  order by p.ronda desc, p.jornada desc, p.fecha_hora desc nulls last limit 1) cp on true;
