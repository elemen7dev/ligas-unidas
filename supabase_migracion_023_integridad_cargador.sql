-- Ligas Unidas — migración 023: integridad entre entidades, lista blanca del cargador y amarillas al borrar partidos
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
-- Origen: Informe de auditoría técnica del 15/11/2026 (H-01, H-02 y H-05).
-- Solo agrega y reemplaza triggers/funciones. No toca datos ni cambia tablas.
-- Antes de aplicar, correr los chequeos de datos existentes de supabase_pruebas_023.sql (sección 0).

-- 1. H-01: un partido y sus eventos deben ser de una misma liga, torneo y categoría ----------------
-- Las claves foráneas sueltas aceptaban, por ejemplo, un equipo de otra liga. Esto lo cierra (vale para todos los roles).
-- En un UPDATE que no toca esas columnas (p. ej. cargar un resultado) no se revalida nada.
create or replace function private.verificar_partido() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.liga_id = old.liga_id and new.torneo_id = old.torneo_id and new.categoria_id = old.categoria_id
     and new.local_equipo_id = old.local_equipo_id and new.visitante_equipo_id = old.visitante_equipo_id
     and new.ajuste_ganador_equipo_id is not distinct from old.ajuste_ganador_equipo_id then
    return new;
  end if;

  if not exists (select 1 from public.torneos t where t.id = new.torneo_id and t.liga_id = new.liga_id) then
    raise exception 'El torneo no es de la liga del partido' using errcode = '23514';
  end if;
  if not exists (select 1 from public.categorias c
                  where c.id = new.categoria_id and c.torneo_id = new.torneo_id and c.liga_id = new.liga_id) then
    raise exception 'La categoría no es del torneo y la liga del partido' using errcode = '23514';
  end if;
  if (select count(*) from public.equipos e
       where e.id in (new.local_equipo_id, new.visitante_equipo_id)
         and e.liga_id = new.liga_id and e.torneo_id = new.torneo_id and e.categoria_id = new.categoria_id) <> 2 then
    raise exception 'Los dos equipos deben ser de la categoría, el torneo y la liga del partido' using errcode = '23514';
  end if;
  if new.ajuste_ganador_equipo_id is not null
     and new.ajuste_ganador_equipo_id not in (new.local_equipo_id, new.visitante_equipo_id) then
    raise exception 'El ganador por ajuste debe ser uno de los dos equipos del partido' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.verificar_partido() from public, anon, authenticated;
create trigger a_verificar_partido before insert or update on public.partidos
  for each row execute function private.verificar_partido();

create or replace function private.verificar_evento() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p public.partidos%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.liga_id = old.liga_id and new.partido_id = old.partido_id and new.equipo_id = old.equipo_id
     and new.jugador_id is not distinct from old.jugador_id then
    return new;
  end if;

  select * into p from public.partidos where id = new.partido_id;
  if not found then raise exception 'El partido no existe' using errcode = '23514'; end if;
  if p.liga_id <> new.liga_id then
    raise exception 'El evento no es de la liga del partido' using errcode = '23514';
  end if;
  if new.equipo_id not in (p.local_equipo_id, p.visitante_equipo_id) then
    raise exception 'El equipo del evento no juega este partido' using errcode = '23514';
  end if;
  if new.jugador_id is not null
     and not exists (select 1 from public.jugadores j where j.id = new.jugador_id and j.liga_id = new.liga_id) then
    raise exception 'El jugador no es de la liga del partido' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.verificar_evento() from public, anon, authenticated;
create trigger a_verificar_evento before insert or update on public.eventos_partido
  for each row execute function private.verificar_evento();

-- 2. H-02: el cargador solo puede cambiar una lista positiva de campos ------------------------------
-- Antes se comparaban a mano los campos prohibidos; cualquier columna nueva (o id, actualizado_en) quedaba editable.
-- Ahora se compara la fila completa menos los campos permitidos: lo que no está en la lista, no se puede cambiar.
-- Permitidos: estado, goles, fecha y hora, cancha, árbitro, líneas y nota.
-- En un partido de Copa, además, ajuste_ganador_equipo_id y ajuste_motivo (ganador por penales).
create or replace function private.restringir_cargador() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_permitidos text[] := array['estado','goles_local','goles_visitante','fecha_hora','cancha','arbitro','lineas','nota'];
begin
  if (select auth.uid()) is not null and not private.puede_admin(old.liga_id) then
    if old.tipo = 'copa' then
      v_permitidos := v_permitidos || array['ajuste_ganador_equipo_id','ajuste_motivo'];
    end if;
    if (to_jsonb(new) - v_permitidos) is distinct from (to_jsonb(old) - v_permitidos) then
      raise exception 'El cargador solo puede cargar resultados, fecha, cancha, árbitros y notas del partido' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
-- (el trigger a_restringir_cargador de la migración 017 ya apunta a esta función)

-- 3. H-05: al borrar un partido, las amarillas deben recalcularse --------------------------------
-- Con el borrado en cascada, cuando se disparaba el recálculo el partido ya no existía y no se encontraba su torneo.
-- Se borran los eventos ANTES de borrar el partido, cuando el partido todavía existe.
create or replace function private.borrar_eventos_partido() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.eventos_partido where partido_id = old.id;
  return old;
end $$;
revoke all on function private.borrar_eventos_partido() from public, anon, authenticated;
create trigger b_borrar_eventos before delete on public.partidos
  for each row execute function private.borrar_eventos_partido();
