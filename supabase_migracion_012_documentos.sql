-- Ligas Unidas — migración 012: documentos descargables (buena fe, fichajes) e institucional
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

alter table public.documentos add column nombre text;
alter table public.documentos add constraint documentos_url_http check (archivo_url ~* '^https?://');
alter table public.documentos add constraint documentos_nombre_largo check (nombre is null or char_length(nombre) <= 200);
create index documentos_liga_idx on public.documentos (liga_id, tipo, subido_en desc);

alter table public.institucional add constraint institucional_titulo_ok check (char_length(btrim(titulo)) between 1 and 120);
alter table public.institucional add constraint institucional_contenido_largo check (char_length(contenido) <= 20000);

-- Bucket público de documentos: hasta 5 MB; solo PDF, Word, Excel e imágenes (nada ejecutable).
-- Ruta: <liga_id>/<archivo>. Lectura pública por URL; gestión solo del administrador de esa liga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', true, 5242880, array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy documentos_escribe on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
create policy documentos_actualiza on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
create policy documentos_borra on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
create policy documentos_lee on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
