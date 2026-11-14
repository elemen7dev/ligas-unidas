-- Ligas Unidas — migración 010: los torneos en borrador no son públicos
-- Hasta ahora bastaba con que la liga estuviera publicada para leer cualquiera de sus torneos.
-- Ahora el público solo ve torneos que no estén en borrador (y de ligas publicadas).
-- El equipo de la liga (cargador, admin, superadmin) sigue viendo todo.

create or replace function private.torneo_visible(p_torneo uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.torneos t join public.ligas l on l.id = t.liga_id
                      where t.id = p_torneo and t.estado <> 'borrador' and l.estado = 'publicada'); $$;

create or replace function private.partido_visible(p_partido uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.partidos p where p.id = p_partido and private.torneo_visible(p.torneo_id)); $$;

revoke all on function private.torneo_visible(uuid) from public;
revoke all on function private.partido_visible(uuid) from public;
grant execute on function private.torneo_visible(uuid) to authenticated, anon;
grant execute on function private.partido_visible(uuid) to authenticated, anon;

drop policy torneos_lectura on public.torneos;
create policy torneos_lectura on public.torneos for select
  using ((private.liga_publicada(liga_id) and estado <> 'borrador') or private.puede_cargar(liga_id));

do $$
declare t text;
begin
  foreach t in array array['categorias','equipos','planteles','partidos','suspensiones']
  loop
    execute format('drop policy %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select using (private.torneo_visible(torneo_id) or private.puede_cargar(liga_id))', t || '_lectura', t);
  end loop;
end $$;

drop policy eventos_partido_lectura on public.eventos_partido;
create policy eventos_partido_lectura on public.eventos_partido for select
  using (private.partido_visible(partido_id) or private.puede_cargar(liga_id));
