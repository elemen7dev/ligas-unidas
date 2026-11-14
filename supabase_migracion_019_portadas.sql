-- Ligas Unidas — migración 019: portada editable del Inicio (por torneo y categoría)
-- Sin fila = el sitio arma la portada automática (líder, campeón, "arranca el torneo").
create table public.portadas (
  id uuid primary key default gen_random_uuid(),
  liga_id uuid not null references public.ligas(id) on delete cascade,
  torneo_id uuid not null references public.torneos(id) on delete cascade,
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  etiqueta text check (etiqueta is null or char_length(etiqueta) <= 60),
  titular text not null check (char_length(btrim(titular)) between 1 and 120),
  bajada text check (bajada is null or char_length(bajada) <= 300),
  actualizado_en timestamptz not null default now(),
  unique (torneo_id, categoria_id)
);
create index portadas_liga_idx on public.portadas (liga_id);
alter table public.portadas enable row level security;

create policy portadas_lectura on public.portadas for select
  using (private.torneo_visible(torneo_id) or private.puede_cargar(liga_id));
create policy portadas_alta on public.portadas for insert to authenticated
  with check (private.puede_admin(liga_id)
    and exists (select 1 from public.torneos t where t.id = portadas.torneo_id and t.liga_id = portadas.liga_id)
    and exists (select 1 from public.categorias c where c.id = portadas.categoria_id and c.torneo_id = portadas.torneo_id));
create policy portadas_edicion on public.portadas for update to authenticated
  using (private.puede_admin(liga_id))
  with check (private.puede_admin(liga_id)
    and exists (select 1 from public.torneos t where t.id = portadas.torneo_id and t.liga_id = portadas.liga_id)
    and exists (select 1 from public.categorias c where c.id = portadas.categoria_id and c.torneo_id = portadas.torneo_id));
create policy portadas_baja on public.portadas for delete to authenticated
  using (private.puede_admin(liga_id));

create or replace function private.portadas_sello() returns trigger
language plpgsql set search_path = '' as $$
begin new.actualizado_en := now(); return new; end $$;
create trigger portadas_sello before update on public.portadas
  for each row execute function private.portadas_sello();

