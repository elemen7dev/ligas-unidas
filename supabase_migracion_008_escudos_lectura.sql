-- Ligas Unidas — migración 008: política de lectura en el bucket de escudos
-- Supabase Storage necesita poder "ver" un objeto para borrarlo o reemplazarlo.
-- La lectura pública por URL no cambia (el bucket es público); esto solo habilita
-- al administrador de la liga a listar y gestionar los archivos de su carpeta.
create policy escudos_lee on storage.objects for select to authenticated
  using (bucket_id = 'escudos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.puede_admin(((storage.foldername(name))[1])::uuid) else false end);
