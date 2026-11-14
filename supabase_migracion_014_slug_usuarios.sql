-- Ligas Unidas — migración 014: 'usuarios' pasa a ser una dirección reservada (el panel usa /panel/usuarios)
alter table public.ligas drop constraint slug_reservado;
alter table public.ligas add constraint slug_reservado
  check (slug::text not in ('panel','ligas','api','admin','login','auth','static','assets','usuarios'));
