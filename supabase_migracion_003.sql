-- Ligas Unidas — migración 003: el rol 'dueno' pasa a llamarse 'superadmin'
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

alter type public.rol_liga rename value 'dueno' to 'superadmin';

-- es_dueno() -> es_superadmin(). Las políticas la referencian por OID, así que siguen funcionando.
alter function private.es_dueno() rename to es_superadmin;

create or replace function private.es_superadmin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.membresias m where m.usuario_id = (select auth.uid()) and m.rol = 'superadmin'); $$;

-- puede_admin tenía el nombre viejo escrito en su cuerpo
create or replace function private.puede_admin(p_liga uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.es_superadmin() or exists (select 1 from public.membresias m where m.usuario_id = (select auth.uid()) and m.liga_id = p_liga and m.rol = 'admin_liga'); $$;
