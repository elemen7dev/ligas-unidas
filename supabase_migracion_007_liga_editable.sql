-- Ligas Unidas — migración 007: el administrador edita la marca de su liga; validaciones de imágenes y colores
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)

-- 1. El admin_liga puede actualizar su liga, pero no sus campos de plataforma
create policy ligas_admin_edita on public.ligas for update to authenticated
  using (private.puede_admin(id)) with check (private.puede_admin(id));

create or replace function private.proteger_liga() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.es_superadmin() then
    if new.id is distinct from old.id
       or new.slug is distinct from old.slug
       or new.estado is distinct from old.estado
       or new.plan is distinct from old.plan
       or new.vencimiento is distinct from old.vencimiento then
      raise exception 'Solo el superadmin puede cambiar la dirección web, el estado, el plan o el vencimiento de la liga'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.proteger_liga() from public, anon, authenticated;
create trigger a_proteger_liga before update on public.ligas
  for each row execute function private.proteger_liga();

-- 2. Validaciones: las imágenes deben ser URLs http(s) y los colores hexadecimales de 6 dígitos
alter table public.ligas
  add constraint ligas_logo_url_http check (logo_url is null or logo_url ~* '^https?://'),
  add constraint ligas_color1_hex check (color_primario is null or color_primario ~ '^#[0-9a-fA-F]{6}$'),
  add constraint ligas_color2_hex check (color_secundario is null or color_secundario ~ '^#[0-9a-fA-F]{6}$');
alter table public.clubes
  add constraint clubes_escudo_url_http check (escudo_url is null or escudo_url ~* '^https?://'),
  add constraint clubes_color1_hex check (color1 is null or color1 ~ '^#[0-9a-fA-F]{6}$'),
  add constraint clubes_color2_hex check (color2 is null or color2 ~ '^#[0-9a-fA-F]{6}$');
