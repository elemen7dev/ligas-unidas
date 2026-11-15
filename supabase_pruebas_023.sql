-- Pruebas de la migración 023 (integridad, lista blanca del cargador, amarillas al borrar partido).
-- Pegar en el editor SQL de Supabase. Todo corre dentro de una transacción que termina en ROLLBACK: no queda nada.
-- Cada prueba avisa con NOTICE "OK ..."; si algo falla, el script se detiene con un error que dice cuál.

-- ===== 0. Chequeo de datos existentes (solo lectura; correr ANTES de aplicar la 023) ==================
-- Todas deberían devolver 0 filas. Si devuelven algo, hay datos cruzados que habría que corregir a mano.
select 'partido con torneo de otra liga' as problema, p.id from public.partidos p
  join public.torneos t on t.id = p.torneo_id where t.liga_id <> p.liga_id
union all
select 'partido con categoria de otro torneo/liga', p.id from public.partidos p
  join public.categorias c on c.id = p.categoria_id where c.torneo_id <> p.torneo_id or c.liga_id <> p.liga_id
union all
select 'partido con equipo local fuera de su categoria', p.id from public.partidos p
  join public.equipos e on e.id = p.local_equipo_id
 where e.categoria_id <> p.categoria_id or e.torneo_id <> p.torneo_id or e.liga_id <> p.liga_id
union all
select 'partido con equipo visitante fuera de su categoria', p.id from public.partidos p
  join public.equipos e on e.id = p.visitante_equipo_id
 where e.categoria_id <> p.categoria_id or e.torneo_id <> p.torneo_id or e.liga_id <> p.liga_id
union all
select 'ajuste_ganador que no juega el partido', p.id from public.partidos p
 where p.ajuste_ganador_equipo_id is not null
   and p.ajuste_ganador_equipo_id not in (p.local_equipo_id, p.visitante_equipo_id)
union all
select 'evento de otra liga que su partido', e.id from public.eventos_partido e
  join public.partidos p on p.id = e.partido_id where p.liga_id <> e.liga_id
union all
select 'evento con equipo que no juega el partido', e.id from public.eventos_partido e
  join public.partidos p on p.id = e.partido_id
 where e.equipo_id not in (p.local_equipo_id, p.visitante_equipo_id)
union all
select 'evento con jugador de otra liga', e.id from public.eventos_partido e
  join public.jugadores j on j.id = e.jugador_id where j.liga_id <> e.liga_id;

-- ===== Pruebas (después de aplicar la 023, dentro de la misma transacción) ==========================
begin;

-- Para probar antes de aplicar a producción: pegar acá el contenido de supabase_migracion_023_integridad_cargador.sql

do $$
declare
  la uuid := gen_random_uuid(); lb uuid := gen_random_uuid();
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid();
  ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid();
  cl1 uuid := gen_random_uuid(); cl2 uuid := gen_random_uuid(); cl3 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); eb uuid := gen_random_uuid();
  j1 uuid := gen_random_uuid(); jb uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  pa uuid; p2 uuid; n int; ok boolean;
begin
  -- Datos de prueba: dos ligas, cada una con su torneo, categoría y equipos
  insert into public.ligas (id, slug, nombre) values (la, 'prueba-023-a', 'Prueba A'), (lb, 'prueba-023-b', 'Prueba B');
  insert into public.torneos (id, liga_id, nombre, anio, estado) values (ta, la, 'T A', 2026, 'en_curso'), (tb, lb, 'T B', 2026, 'en_curso');
  insert into public.categorias (id, liga_id, torneo_id, nombre) values (ca, la, ta, 'Primera'), (cb, lb, tb, 'Primera');
  insert into public.clubes (id, liga_id, nombre) values (cl1, la, 'Club 1'), (cl2, la, 'Club 2'), (cl3, lb, 'Club 3');
  insert into public.equipos (id, liga_id, torneo_id, categoria_id, club_id) values
    (e1, la, ta, ca, cl1), (e2, la, ta, ca, cl2), (eb, lb, tb, cb, cl3);
  insert into public.jugadores (id, liga_id, nombre, apellido) values (j1, la, 'Uno', 'A'), (jb, lb, 'Otro', 'B');

  -- H-01: partidos cruzados deben fallar
  begin insert into public.partidos (liga_id, torneo_id, categoria_id, jornada, local_equipo_id, visitante_equipo_id)
        values (la, tb, ca, 1, e1, e2); raise exception 'FALLO H-01: aceptó torneo de otra liga';
  exception when check_violation then raise notice 'OK H-01 torneo de otra liga rechazado'; end;
  begin insert into public.partidos (liga_id, torneo_id, categoria_id, jornada, local_equipo_id, visitante_equipo_id)
        values (la, ta, cb, 1, e1, e2); raise exception 'FALLO H-01: aceptó categoría de otro torneo';
  exception when check_violation then raise notice 'OK H-01 categoría de otro torneo rechazada'; end;
  begin insert into public.partidos (liga_id, torneo_id, categoria_id, jornada, local_equipo_id, visitante_equipo_id)
        values (la, ta, ca, 1, e1, eb); raise exception 'FALLO H-01: aceptó equipo de otra liga';
  exception when check_violation then raise notice 'OK H-01 equipo de otra liga rechazado'; end;

  -- partido válido
  insert into public.partidos (liga_id, torneo_id, categoria_id, jornada, local_equipo_id, visitante_equipo_id)
    values (la, ta, ca, 1, e1, e2) returning id into pa;
  raise notice 'OK H-01 partido válido aceptado';

  -- H-01: eventos cruzados deben fallar
  begin insert into public.eventos_partido (liga_id, partido_id, equipo_id, tipo) values (lb, pa, e1, 'amarilla');
        raise exception 'FALLO H-01: aceptó evento de otra liga';
  exception when check_violation then raise notice 'OK H-01 evento de otra liga rechazado'; end;
  begin insert into public.eventos_partido (liga_id, partido_id, equipo_id, tipo) values (la, pa, eb, 'amarilla');
        raise exception 'FALLO H-01: aceptó equipo ajeno al partido';
  exception when check_violation then raise notice 'OK H-01 equipo ajeno rechazado'; end;
  begin insert into public.eventos_partido (liga_id, partido_id, equipo_id, jugador_id, tipo) values (la, pa, e1, jb, 'amarilla');
        raise exception 'FALLO H-01: aceptó jugador de otra liga';
  exception when check_violation then raise notice 'OK H-01 jugador de otra liga rechazado'; end;

  -- H-05: 4 amarillas (umbral por defecto) en 4 partidos generan 1 fecha de suspensión; borrar un partido la recalcula
  insert into public.partidos (liga_id, torneo_id, categoria_id, jornada, local_equipo_id, visitante_equipo_id)
    values (la, ta, ca, 2, e1, e2) returning id into p2;
  insert into public.eventos_partido (liga_id, partido_id, equipo_id, jugador_id, tipo) values
    (la, pa, e1, j1, 'amarilla'), (la, pa, e1, j1, 'amarilla'), (la, p2, e1, j1, 'amarilla'), (la, p2, e1, j1, 'amarilla');
  select count(*) into n from public.suspensiones where jugador_id = j1 and torneo_id = ta and origen = 'automatica';
  if n <> 1 then raise exception 'FALLO H-05: no se generó la suspensión automática (hay %)', n; end if;
  delete from public.partidos where id = p2;
  select count(*) into n from public.suspensiones where jugador_id = j1 and torneo_id = ta and origen = 'automatica';
  if n <> 0 then raise exception 'FALLO H-05: al borrar el partido la suspensión automática no se recalculó'; end if;
  raise notice 'OK H-05 borrar un partido recalcula las amarillas';

  -- H-02: un cargador (con sesión simulada) solo puede cambiar los campos permitidos
  insert into auth.users (id, email) values (u, 'cargador-prueba-023@example.invalid');
  insert into public.membresias (usuario_id, liga_id, rol) values (u, la, 'cargador');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.partidos set cancha = 'Cancha 1', nota = 'ok' where id = pa;
  raise notice 'OK H-02 el cargador puede cambiar cancha y nota';

  begin update public.partidos set id = gen_random_uuid() where id = pa; raise exception 'FALLO H-02: cambió id';
  exception when insufficient_privilege then raise notice 'OK H-02 no puede cambiar id'; end;
  begin update public.partidos set actualizado_en = now() - interval '1 year' where id = pa; raise exception 'FALLO H-02: cambió actualizado_en';
  exception when insufficient_privilege then raise notice 'OK H-02 no puede cambiar actualizado_en'; end;
  begin update public.partidos set jornada = 9 where id = pa; raise exception 'FALLO H-02: cambió jornada';
  exception when insufficient_privilege then raise notice 'OK H-02 no puede cambiar jornada'; end;
  begin update public.partidos set ajuste_ganador_equipo_id = e1 where id = pa; raise exception 'FALLO H-02: cambió ajuste en partido de liga';
  exception when insufficient_privilege then raise notice 'OK H-02 no puede cambiar el ajuste en un partido de liga'; end;

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $$;

rollback;
