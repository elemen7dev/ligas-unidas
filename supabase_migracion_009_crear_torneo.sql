-- Ligas Unidas — migración 009: crear un torneo completo (categorías, equipos y fixture) en una transacción
-- Proyecto Supabase: ligasunidas (ccmkohhgcjzimakqsznl)
--
-- p_torneo:     {"nombre","anio","modalidad","vueltas","estado","copa_desafio",
--                "puntos_victoria","puntos_empate","puntos_derrota","amarillas_para_suspension"}
-- p_categorias: [{"nombre","clubes":[club_id,...],"partidos":[{"ronda","jornada","local":club_id,"visitante":club_id}]}]
-- security invoker: se aplica la RLS de quien llama. Solo admin de la liga o superadmin.
create or replace function public.crear_torneo(p_liga uuid, p_torneo jsonb, p_categorias jsonb)
returns uuid
language plpgsql set search_path = ''
as $$
declare
  v_t uuid; v_cat jsonb; v_idx int := 0; v_cat_id uuid; v_nombre_cat text;
  v_club text; v_eq uuid; v_equipos jsonb; v_p jsonb; v_lc text; v_vc text;
  v_estado public.estado_torneo;
begin
  if not private.puede_admin(p_liga) then
    raise exception 'Sin permiso para crear torneos en esta liga' using errcode = '42501';
  end if;
  if coalesce(trim(p_torneo->>'nombre'), '') = '' then raise exception 'El torneo necesita un nombre'; end if;
  v_estado := coalesce(p_torneo->>'estado', 'borrador')::public.estado_torneo;
  if v_estado = 'finalizado' then raise exception 'Un torneo nuevo no puede crearse finalizado'; end if;
  if jsonb_typeof(p_categorias) is distinct from 'array' or jsonb_array_length(p_categorias) = 0 then
    raise exception 'Agregá al menos una categoría';
  end if;

  insert into public.torneos (liga_id, nombre, anio, modalidad, vueltas, estado, copa_desafio, reglas)
  values (p_liga, trim(p_torneo->>'nombre'), (p_torneo->>'anio')::int,
          coalesce(nullif(trim(p_torneo->>'modalidad'), ''), 'Fútbol 11'),
          coalesce((p_torneo->>'vueltas')::int, 2), v_estado,
          coalesce((p_torneo->>'copa_desafio')::boolean, false),
          jsonb_build_object(
            'puntos_victoria', coalesce((p_torneo->>'puntos_victoria')::int, 3),
            'puntos_empate', coalesce((p_torneo->>'puntos_empate')::int, 1),
            'puntos_derrota', coalesce((p_torneo->>'puntos_derrota')::int, 0),
            'amarillas_para_suspension', coalesce((p_torneo->>'amarillas_para_suspension')::int, 4),
            'columnas_tabla', jsonb_build_array('PJ','G','E','P','GF','GC','DIF','PTS')))
  returning id into v_t;

  for v_cat in select * from jsonb_array_elements(p_categorias) loop
    v_idx := v_idx + 1;
    v_nombre_cat := trim(coalesce(v_cat->>'nombre', ''));
    if v_nombre_cat = '' then raise exception 'Todas las categorías necesitan nombre'; end if;
    if jsonb_array_length(coalesce(v_cat->'clubes', '[]'::jsonb)) < 2 then
      raise exception 'La categoría % necesita al menos 2 clubes', v_nombre_cat;
    end if;
    insert into public.categorias (liga_id, torneo_id, nombre, orden) values (p_liga, v_t, v_nombre_cat, v_idx)
    returning id into v_cat_id;

    v_equipos := '{}'::jsonb;
    for v_club in select jsonb_array_elements_text(v_cat->'clubes') loop
      if not exists (select 1 from public.clubes where id = v_club::uuid and liga_id = p_liga) then
        raise exception 'Un club no pertenece a esta liga';
      end if;
      insert into public.equipos (liga_id, torneo_id, categoria_id, club_id) values (p_liga, v_t, v_cat_id, v_club::uuid)
      returning id into v_eq;
      v_equipos := v_equipos || jsonb_build_object(v_club, v_eq);
    end loop;

    for v_p in select * from jsonb_array_elements(coalesce(v_cat->'partidos', '[]'::jsonb)) loop
      v_lc := v_p->>'local'; v_vc := v_p->>'visitante';
      if v_lc is null or v_vc is null or v_lc = v_vc then
        raise exception 'Hay un partido sin equipos válidos en la categoría %', v_nombre_cat;
      end if;
      if not (v_equipos ? v_lc and v_equipos ? v_vc) then
        raise exception 'El fixture de % usa un club que no está en la categoría', v_nombre_cat;
      end if;
      insert into public.partidos (liga_id, torneo_id, categoria_id, tipo, ronda, jornada, local_equipo_id, visitante_equipo_id)
      values (p_liga, v_t, v_cat_id, 'liga', (v_p->>'ronda')::int, (v_p->>'jornada')::int,
              (v_equipos->>v_lc)::uuid, (v_equipos->>v_vc)::uuid);
    end loop;

    if exists (
      select 1 from (
        select ronda, jornada, local_equipo_id as eq from public.partidos where categoria_id = v_cat_id
        union all
        select ronda, jornada, visitante_equipo_id from public.partidos where categoria_id = v_cat_id
      ) x group by ronda, jornada, eq having count(*) > 1
    ) then
      raise exception 'En la categoría % un club juega dos veces en la misma fecha', v_nombre_cat;
    end if;
  end loop;

  return v_t;
end $$;

revoke all on function public.crear_torneo(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_torneo(uuid, jsonb, jsonb) to authenticated;
