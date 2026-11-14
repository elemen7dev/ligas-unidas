-- Ligas Unidas — migración 017: el cargador solo carga resultados; no crea, borra ni reordena partidos
-- Antes la política "partidos_carga" le daba al cargador permiso total sobre partidos (crear, borrar y cambiar cualquier campo).
-- Ahora: ver y actualizar (solo campos de resultado) = cargador; crear y borrar = administrador de la liga.

drop policy partidos_carga on public.partidos;
create policy partidos_actualiza on public.partidos for update to authenticated
  using (private.puede_cargar(liga_id)) with check (private.puede_cargar(liga_id));
create policy partidos_inserta on public.partidos for insert to authenticated
  with check (private.puede_admin(liga_id));
create policy partidos_borra on public.partidos for delete to authenticated
  using (private.puede_admin(liga_id));

-- El cargador puede cambiar: estado, goles, fecha y hora, cancha, árbitros, notas. No puede mover equipos, ronda, fecha del
-- fixture, categoría ni torneo, ni aplicar sanciones administrativas. Excepción: en la final de la Copa, quien carga el
-- resultado define el ganador por penales (ajuste_ganador_equipo_id / ajuste_motivo).
create or replace function private.restringir_cargador() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.puede_admin(old.liga_id) then
    if new.liga_id is distinct from old.liga_id or new.torneo_id is distinct from old.torneo_id
       or new.categoria_id is distinct from old.categoria_id or new.tipo is distinct from old.tipo
       or new.ronda is distinct from old.ronda or new.jornada is distinct from old.jornada
       or new.local_equipo_id is distinct from old.local_equipo_id or new.visitante_equipo_id is distinct from old.visitante_equipo_id
       or new.ajuste_anula_goles is distinct from old.ajuste_anula_goles
       or (old.tipo <> 'copa' and (new.ajuste_ganador_equipo_id is distinct from old.ajuste_ganador_equipo_id
                                   or new.ajuste_motivo is distinct from old.ajuste_motivo)) then
      raise exception 'El cargador solo puede cargar resultados, fecha, cancha, árbitros y notas del partido' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.restringir_cargador() from public, anon, authenticated;
create trigger a_restringir_cargador before update on public.partidos
  for each row execute function private.restringir_cargador();
