-- Ligas Unidas — migración 021: los goles cargados deben coincidir con el marcador
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
--
-- Reglas (valen también para el superadmin):
--  1. Solo se cargan goles (gol / gol en contra) en un partido "Jugado" con marcador.
--  2. Los goles de un equipo no pueden superar los que figuran en el marcador para ese equipo
--     (si el marcador es 1-0, no se puede cargar ningún gol al visitante ni un segundo gol al local).
--  3. No se puede bajar el marcador por debajo de los goles ya cargados, ni dejar de marcar
--     el partido como "Jugado" mientras tenga goles cargados.
-- En eventos_partido, equipo_id es el equipo al que se le suma el gol (también en goles en contra).

create or replace function private.validar_goles_evento() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.partidos%rowtype;
  v_max int; v_actual int;
begin
  if new.tipo not in ('gol', 'gol_en_contra') then return new; end if;

  select * into p from public.partidos where id = new.partido_id for update;   -- serializa cargas simultáneas
  if not found then raise exception 'El partido no existe'; end if;
  if new.equipo_id is distinct from p.local_equipo_id and new.equipo_id is distinct from p.visitante_equipo_id then
    raise exception 'El equipo del gol no juega este partido';
  end if;
  if p.estado <> 'jugado' or p.goles_local is null or p.goles_visitante is null then
    raise exception 'Primero guardá el resultado del partido como Jugado y recién después cargá los goles.';
  end if;

  v_max := case when new.equipo_id = p.local_equipo_id then p.goles_local else p.goles_visitante end;
  select count(*) into v_actual from public.eventos_partido e
   where e.partido_id = new.partido_id and e.equipo_id = new.equipo_id
     and e.tipo in ('gol', 'gol_en_contra')
     and (tg_op = 'INSERT' or e.id <> new.id);
  if v_actual + 1 > v_max then
    raise exception 'El marcador le asigna % gol(es) a este equipo y ya hay % cargado(s). Corregí el resultado o quitá un gol antes de agregar otro.', v_max, v_actual;
  end if;
  return new;
end $$;
revoke all on function private.validar_goles_evento() from public, anon, authenticated;

create trigger b_validar_goles before insert or update on public.eventos_partido
  for each row execute function private.validar_goles_evento();

create or replace function private.validar_marcador_partido() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_l int; v_v int;
begin
  select count(*) filter (where e.equipo_id = new.local_equipo_id),
         count(*) filter (where e.equipo_id = new.visitante_equipo_id)
    into v_l, v_v
    from public.eventos_partido e
   where e.partido_id = new.id and e.tipo in ('gol', 'gol_en_contra');
  if v_l + v_v = 0 then return new; end if;

  if new.estado <> 'jugado' then
    raise exception 'El partido tiene % gol(es) cargado(s). Quitalos en "Goles y tarjetas" antes de cambiar su estado.', v_l + v_v;
  end if;
  if v_l > coalesce(new.goles_local, 0) or v_v > coalesce(new.goles_visitante, 0) then
    raise exception 'Hay goles cargados (% - %) que superan el marcador (% - %). Quitá goles en "Goles y tarjetas" antes de bajar el resultado.',
      v_l, v_v, coalesce(new.goles_local, 0), coalesce(new.goles_visitante, 0);
  end if;
  return new;
end $$;
revoke all on function private.validar_marcador_partido() from public, anon, authenticated;

create trigger b_validar_marcador before update on public.partidos
  for each row
  when (old.estado is distinct from new.estado
        or old.goles_local is distinct from new.goles_local
        or old.goles_visitante is distinct from new.goles_visitante)
  execute function private.validar_marcador_partido();
