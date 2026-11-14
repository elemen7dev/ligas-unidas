-- Ligas Unidas — migración 013: sponsors con niveles, vigencia y conteo de clics
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

-- 1. Campos nuevos y validaciones
alter table public.sponsors add column nivel text not null default 'colaborador'
  check (nivel in ('presentador', 'oficial', 'colaborador'));
alter table public.sponsors add column vigente_desde date;
alter table public.sponsors add column vigente_hasta date;
alter table public.sponsors add constraint sponsors_vigencia_ok
  check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde);
alter table public.sponsors add constraint sponsors_link_http check (link is null or link ~* '^https?://');
alter table public.sponsors add constraint sponsors_logo_http check (logo_url is null or logo_url ~* '^https?://');
alter table public.sponsors add constraint sponsors_nombre_ok check (char_length(btrim(nombre)) between 1 and 80);
create index sponsors_liga_idx on public.sponsors (liga_id, nivel, orden);

-- 2. Hoy en Argentina (la vigencia se mide por fecha local, no por UTC)
create or replace function private.hoy_ar() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

create or replace function private.sponsor_visible(p_sponsor uuid, p_liga uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.sponsors s join public.ligas l on l.id = s.liga_id
  where s.id = p_sponsor and s.liga_id = p_liga and s.activo and l.estado = 'publicada'
    and (s.vigente_desde is null or s.vigente_desde <= private.hoy_ar())
    and (s.vigente_hasta is null or s.vigente_hasta >= private.hoy_ar())); $$;

revoke all on function private.hoy_ar() from public;
revoke all on function private.sponsor_visible(uuid, uuid) from public;
grant execute on function private.hoy_ar() to authenticated, anon;
grant execute on function private.sponsor_visible(uuid, uuid) to authenticated, anon;

-- 3. El público solo ve sponsors activos, vigentes y de ligas publicadas; el equipo de la liga ve todos
drop policy sponsors_lectura on public.sponsors;
create policy sponsors_lectura on public.sponsors for select
  using ((private.liga_publicada(liga_id) and activo
          and (vigente_desde is null or vigente_desde <= private.hoy_ar())
          and (vigente_hasta is null or vigente_hasta >= private.hoy_ar()))
         or private.puede_cargar(liga_id));

-- 4. Clics: un renglón por clic. Cualquiera puede registrar un clic en un sponsor visible; solo el admin los lee.
--    Sin cookies ni datos personales: solo sponsor, liga y momento.
create table public.sponsor_clics (
  id bigint generated always as identity primary key,
  liga_id uuid not null references public.ligas(id) on delete cascade,
  sponsor_id uuid not null references public.sponsors(id) on delete cascade,
  creado_en timestamptz not null default now()
);
create index sponsor_clics_sponsor_idx on public.sponsor_clics (sponsor_id, creado_en);
alter table public.sponsor_clics enable row level security;
create policy sponsor_clics_inserta on public.sponsor_clics for insert to anon, authenticated
  with check (private.sponsor_visible(sponsor_id, liga_id));
create policy sponsor_clics_lee on public.sponsor_clics for select to authenticated
  using (private.puede_admin(liga_id));

create or replace view public.sponsors_estadisticas with (security_invoker = true) as
select s.id as sponsor_id, s.liga_id,
       (count(c.id) filter (where c.creado_en >= (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')) at time zone 'America/Argentina/Buenos_Aires'))::int as clics_mes,
       count(c.id)::int as clics_total
from public.sponsors s
left join public.sponsor_clics c on c.sponsor_id = s.id
group by s.id, s.liga_id;
