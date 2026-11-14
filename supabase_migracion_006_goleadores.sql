-- Ligas Unidas — migración 006: vista de goleadores (calculada, no guardada)
-- Solo goles a favor: los goles en contra no suman al jugador.
-- security_invoker: respeta la RLS de quien consulta (el público solo ve ligas publicadas).
create or replace view public.goleadores with (security_invoker = true) as
select p.liga_id, p.torneo_id, p.categoria_id,
       j.id as jugador_id, j.nombre, j.apellido,
       c.id as club_id, c.nombre as club,
       count(*)::int as goles
from public.eventos_partido e
join public.partidos p on p.id = e.partido_id
join public.jugadores j on j.id = e.jugador_id
join public.equipos eq on eq.id = e.equipo_id
join public.clubes c on c.id = eq.club_id
where e.tipo = 'gol'
group by p.liga_id, p.torneo_id, p.categoria_id, j.id, j.nombre, j.apellido, c.id, c.nombre;
