-- Ligas Unidas — migración 015: datos personales de jugadores en tabla privada y carga en bloque
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
--
-- Privacidad: jugadores es legible por el público cuando la liga está publicada (la usan goleadores y suspendidos).
-- El DNI y la fecha de nacimiento (que pueden ser de menores) NO deben estar ahí: pasan a una tabla que solo lee
-- y escribe el administrador de la liga. (Al momento de esta migración no había ningún dato personal cargado.)

create table public.jugadores_datos (
  jugador_id uuid primary key references public.jugadores(id) on delete cascade,
  liga_id uuid not null references public.ligas(id) on delete cascade,
  dni text,
  nacimiento date,
  constraint jd_dni_formato check (dni is null or dni ~ '^[0-9]{6,9}$'),
  constraint jd_nacimiento_rango check (nacimiento is null or (nacimiento >= date '1930-01-01' and nacimiento <= date '2035-12-31'))
);
create unique index jd_dni_unico on public.jugadores_datos (liga_id, dni) where dni is not null;
alter table public.jugadores_datos enable row level security;
create policy jugadores_datos_admin on public.jugadores_datos for all to authenticated
  using (private.puede_admin(liga_id)) with check (private.puede_admin(liga_id));

alter table public.jugadores drop column dni;
alter table public.jugadores drop column nacimiento;
alter table public.jugadores add constraint jugadores_nombre_ok check (char_length(btrim(nombre)) between 1 and 60);
alter table public.jugadores add constraint jugadores_apellido_ok check (char_length(btrim(apellido)) between 1 and 60);

-- Un jugador está en un solo plantel por torneo.
create unique index planteles_jugador_torneo on public.planteles (jugador_id, torneo_id);
create index planteles_torneo_club_idx on public.planteles (torneo_id, club_id);

-- Integridad: jugador, club, torneo y categoría de un plantel deben pertenecer a la misma liga.
create or replace function private.verificar_plantel() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.jugadores j where j.id = new.jugador_id and j.liga_id = new.liga_id)
     or not exists (select 1 from public.clubes c where c.id = new.club_id and c.liga_id = new.liga_id)
     or not exists (select 1 from public.torneos t where t.id = new.torneo_id and t.liga_id = new.liga_id)
     or (new.categoria_id is not null and not exists (
          select 1 from public.categorias ca where ca.id = new.categoria_id and ca.torneo_id = new.torneo_id and ca.liga_id = new.liga_id)) then
    raise exception 'El jugador, el club, el torneo y la categoría deben ser de la misma liga' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.verificar_plantel() from public, anon, authenticated;
create trigger a_verificar_plantel before insert or update on public.planteles
  for each row execute function private.verificar_plantel();

-- Carga en bloque (también sirve para uno solo). Todo o nada.
-- p_jugadores: [{"nombre","apellido","dni"?,"nacimiento"?}]
create or replace function public.cargar_jugadores(p_liga uuid, p_torneo uuid, p_club uuid, p_categoria uuid, p_jugadores jsonb)
returns int
language plpgsql set search_path = ''
as $$
declare
  j jsonb; v_id uuid; n int := 0; v_nombre text; v_apellido text; v_dni text; v_nac date;
begin
  if not private.puede_admin(p_liga) then
    raise exception 'Sin permiso para cargar jugadores en esta liga' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clubes where id = p_club and liga_id = p_liga) then raise exception 'El club no es de esta liga'; end if;
  if not exists (select 1 from public.torneos where id = p_torneo and liga_id = p_liga) then raise exception 'El torneo no es de esta liga'; end if;
  if p_categoria is not null and not exists (select 1 from public.categorias where id = p_categoria and torneo_id = p_torneo) then
    raise exception 'La categoría no es de este torneo';
  end if;
  if jsonb_typeof(p_jugadores) is distinct from 'array' or jsonb_array_length(p_jugadores) = 0 then
    raise exception 'No hay jugadores para cargar';
  end if;
  if jsonb_array_length(p_jugadores) > 300 then raise exception 'Se pueden cargar hasta 300 jugadores por vez'; end if;

  for j in select * from jsonb_array_elements(p_jugadores) loop
    v_nombre := btrim(coalesce(j->>'nombre', '')); v_apellido := btrim(coalesce(j->>'apellido', ''));
    if v_nombre = '' or v_apellido = '' then raise exception 'Todos los jugadores necesitan nombre y apellido'; end if;
    v_dni := nullif(btrim(coalesce(j->>'dni', '')), '');
    v_nac := nullif(btrim(coalesce(j->>'nacimiento', '')), '')::date;
    insert into public.jugadores (liga_id, nombre, apellido) values (p_liga, v_nombre, v_apellido) returning id into v_id;
    if v_dni is not null or v_nac is not null then
      insert into public.jugadores_datos (jugador_id, liga_id, dni, nacimiento) values (v_id, p_liga, v_dni, v_nac);
    end if;
    insert into public.planteles (liga_id, jugador_id, club_id, torneo_id, categoria_id) values (p_liga, v_id, p_club, p_torneo, p_categoria);
    n := n + 1;
  end loop;
  return n;
exception
  when unique_violation then raise exception 'Hay un DNI repetido: ya está cargado en la liga o aparece dos veces en la lista';
  when check_violation then raise exception 'Algún dato no es válido: el DNI lleva de 6 a 9 números y la fecha de nacimiento debe ser razonable';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'Alguna fecha de nacimiento no es válida. Usá el formato AAAA-MM-DD';
end $$;
revoke all on function public.cargar_jugadores(uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.cargar_jugadores(uuid, uuid, uuid, uuid, jsonb) to authenticated;
