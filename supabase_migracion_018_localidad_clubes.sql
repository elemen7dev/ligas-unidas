-- Ligas Unidas — migración 018: localidad del club (una liga puede reunir clubes de varias localidades)
alter table public.clubes add column localidad text;
alter table public.clubes add constraint clubes_localidad_largo check (localidad is null or char_length(localidad) <= 60);
