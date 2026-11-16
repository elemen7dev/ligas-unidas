-- Ligas Unidas — migración 024: un torneo solo se finaliza pasando por cerrar_torneo()
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
-- Origen: Informe de auditoría técnica del 15/11/2026 (H-04).
-- Antes: el trigger solo exigía que `resumen` no fuera nulo, así que un administrador de liga podía hacer
-- UPDATE torneos SET estado = 'finalizado', resumen = '{"x":1}' y publicar un archivo falso (y, al quedar
-- finalizado, solo el superadmin podía corregirlo).
-- Ahora: cerrar_torneo() marca la transacción con el torneo que está cerrando y el trigger exige esa marca.
-- La marca vale solo dentro de la transacción (set_config con is_local = true) y los clientes de la API
-- no pueden ejecutar set_config; solo pueden llamar funciones del esquema public.
-- Sin sesión de usuario (migraciones, editor SQL) no se exige la marca, como en el resto de las protecciones.

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

  -- NUEVO: marca de la transacción para que el trigger acepte esta finalización (y solo esta)
  perform set_config('app.cerrando_torneo', p_torneo::text, true);
  update public.torneos set estado = 'finalizado', cerrado_en = now(), resumen = v_res where id = p_torneo;
  perform set_config('app.cerrando_torneo', '', true);   -- la marca no sobrevive al cierre dentro de la misma transacción
  return v_res;
end $$;
revoke all on function public.cerrar_torneo(uuid, boolean) from public, anon;
grant execute on function public.cerrar_torneo(uuid, boolean) to authenticated;

create or replace function private.proteger_torneo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' and new.estado = 'finalizado'
     and (tg_op = 'INSERT' or old.estado <> 'finalizado') then
    if new.resumen is null then
      raise exception 'Para finalizar un torneo usá cerrar_torneo()';
    end if;
    -- con sesión de usuario, la finalización solo es válida si la hizo cerrar_torneo() sobre este mismo torneo
    if (select auth.uid()) is not null
       and coalesce(current_setting('app.cerrando_torneo', true), '') <> new.id::text then
      raise exception 'Para finalizar un torneo usá cerrar_torneo()' using errcode = '42501';
    end if;
  end if;
  if tg_op in ('UPDATE','DELETE') and old.estado = 'finalizado'
     and (select auth.uid()) is not null and not private.es_superadmin() then
    raise exception 'El torneo está finalizado: solo el superadmin puede modificarlo'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.proteger_torneo() from public, anon, authenticated;
-- (el trigger a_proteger_torneo de la migración 005 ya apunta a esta función)
