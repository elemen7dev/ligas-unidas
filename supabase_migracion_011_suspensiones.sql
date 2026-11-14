-- Ligas Unidas — migración 011: suspensiones con fechas cumplidas, suspensión automática por amarillas y vistas
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

-- 1. Fechas cumplidas: restantes = fechas - cumplidas
alter table public.suspensiones add column cumplidas int not null default 0;
alter table public.suspensiones add constraint suspensiones_cumplidas_rango check (cumplidas >= 0 and cumplidas <= fechas);
-- una sola suspensión automática por jugador y torneo (se va ajustando)
create unique index suspensiones_auto_unica on public.suspensiones (jugador_id, torneo_id) where origen = 'automatica';
create index suspensiones_jugador_idx on public.suspensiones (jugador_id);

-- 2. Suspensión automática: cada N amarillas (reglas.amarillas_para_suspension) en un torneo suman 1 fecha.
--    Se recalcula al cargar, cambiar o quitar una amarilla, así que corregir un error también corrige la suspensión.
create or replace function private.sincronizar_amarillas(p_jugador uuid, p_torneo uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_umbral int; v_liga uuid; v_n int; v_exp int;
begin
  select coalesce((reglas->>'amarillas_para_suspension')::int, 0), liga_id into v_umbral, v_liga
    from public.torneos where id = p_torneo;
  if v_umbral is null or v_umbral <= 0 then return; end if;
  select count(*) into v_n
    from public.eventos_partido e join public.partidos p on p.id = e.partido_id
   where e.jugador_id = p_jugador and p.torneo_id = p_torneo and e.tipo = 'amarilla';
  v_exp := v_n / v_umbral;
  if v_exp = 0 then
    delete from public.suspensiones where jugador_id = p_jugador and torneo_id = p_torneo and origen = 'automatica';
  else
    insert into public.suspensiones (liga_id, torneo_id, jugador_id, fechas, motivo, origen)
    values (v_liga, p_torneo, p_jugador, v_exp, 'Acumulación de amarillas', 'automatica')
    on conflict (jugador_id, torneo_id) where origen = 'automatica'
    do update set fechas = excluded.fechas, cumplidas = least(public.suspensiones.cumplidas, excluded.fechas);
  end if;
end $$;

create or replace function private.trg_amarillas() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_torneo uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.tipo = 'amarilla' and old.jugador_id is not null then
    select torneo_id into v_torneo from public.partidos where id = old.partido_id;
    if v_torneo is not null then perform private.sincronizar_amarillas(old.jugador_id, v_torneo); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.tipo = 'amarilla' and new.jugador_id is not null then
    select torneo_id into v_torneo from public.partidos where id = new.partido_id;
    if v_torneo is not null then perform private.sincronizar_amarillas(new.jugador_id, v_torneo); end if;
  end if;
  return null;
end $$;
revoke all on function private.sincronizar_amarillas(uuid, uuid) from public, anon, authenticated;
revoke all on function private.trg_amarillas() from public, anon, authenticated;
create trigger z_sync_amarillas after insert or update or delete on public.eventos_partido
  for each row execute function private.trg_amarillas();

-- 3. Vistas (security_invoker: respetan la RLS de quien consulta)
create or replace view public.suspendidos with (security_invoker = true) as
select s.id as suspension_id, s.liga_id, s.torneo_id, s.jugador_id, j.nombre, j.apellido,
       pl.club, pl.categoria, s.fechas, s.cumplidas, s.fechas - s.cumplidas as restantes, s.motivo, s.origen
from public.suspensiones s
join public.jugadores j on j.id = s.jugador_id
left join lateral (
  select c.nombre as club, ca.nombre as categoria
  from public.planteles p join public.clubes c on c.id = p.club_id
  left join public.categorias ca on ca.id = p.categoria_id
  where p.jugador_id = s.jugador_id and p.torneo_id = s.torneo_id
  order by ca.orden nulls last limit 1) pl on true
where s.fechas > s.cumplidas;

create or replace view public.tarjetas with (security_invoker = true) as
select p.liga_id, p.torneo_id, p.categoria_id, ca.nombre as categoria,
       j.id as jugador_id, j.nombre, j.apellido, c.nombre as club,
       (count(*) filter (where e.tipo = 'amarilla'))::int as amarillas,
       (count(*) filter (where e.tipo = 'roja'))::int as rojas
from public.eventos_partido e
join public.partidos p on p.id = e.partido_id
join public.categorias ca on ca.id = p.categoria_id
join public.jugadores j on j.id = e.jugador_id
join public.equipos eq on eq.id = e.equipo_id
join public.clubes c on c.id = eq.club_id
where e.tipo in ('amarilla', 'roja')
group by p.liga_id, p.torneo_id, p.categoria_id, ca.nombre, j.id, j.nombre, j.apellido, c.nombre;
