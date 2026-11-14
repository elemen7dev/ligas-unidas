-- Ligas Unidas — migración 020: sello de última actualización en partidos
-- El sitio público muestra "Última actualización" con el máximo de este campo.
-- Las filas existentes quedan con la fecha de esta migración.
alter table public.partidos add column actualizado_en timestamptz not null default now();

create or replace function private.partidos_sello() returns trigger
language plpgsql set search_path = '' as $$
begin new.actualizado_en := now(); return new; end $$;

create trigger partidos_sello before update on public.partidos
  for each row
  when (old.estado is distinct from new.estado
     or old.goles_local is distinct from new.goles_local
     or old.goles_visitante is distinct from new.goles_visitante
     or old.fecha_hora is distinct from new.fecha_hora
     or old.ajuste_ganador_equipo_id is distinct from new.ajuste_ganador_equipo_id)
  execute function private.partidos_sello();
