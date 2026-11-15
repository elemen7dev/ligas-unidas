# Ligas Unidas — pendientes (actualizado 2026-11-07)

Sitio: https://ligasunidas.vercel.app · Panel: /panel · Supabase ref `ccmkohhgcjzimakqsznl`

## Para retomar
1. **Logo de Liga Bolívar**: lo guardado es un recorte mío. Si quieren la imagen original completa, subirla desde Mi liga (destildar "Recortar márgenes vacíos"). Revisar cómo se ven los logos de las 3 ligas con el nuevo estilo cuadrado.
2. **No pude reproducir** el problema de "no puedo cambiar el logo de una liga creada". Si vuelve a pasar, anotar qué mensaje aparece.
3. **Torneo ficticio de prueba** (wizard "Nuevo torneo"): confirmar que el sorteo al azar funciona bien en pantalla y borrar el torneo de prueba si quedó creado.
4. **Fixture de Liga Bolívar**: falta que lo pasen. El wizard solo arma el fixture al crear el torneo (no hay pantalla para agregar partidos a un torneo existente). Plan: borrar el borrador y recrearlo con el wizard (ahora se puede sortear).
5. **Criterios de desempate**: hoy se ordena por PTS, DIF, GF y nombre del club. Definir los criterios reales.
6. **Protección de claves filtradas** (Supabase → Auth): puede no estar disponible en el plan gratuito. Es la única advertencia que queda en el revisor de seguridad.
7. **Nombres abreviados de clubes** a completar: "Atlético U" y "D. Pirovano".
8. **Términos de Vercel Hobby** (uso no comercial): revisar si aplica a este proyecto.

9. **Dos tablas a la vista en el inicio (importante, pedido el 2026-11-15)**: en torneos de dos rondas hay que mostrar juntas (a) la tabla general, que suma los puntos y demás de ambas rondas, y (b) la tabla de la ronda que se está jugando (Ronda 1 o Ronda 2). Hoy solo hay una tabla. Hacerlo después de cerrar la carga del Torneo Romagnoli (ver `RESULTADOS_RONDA2_ROMAGNOLI.md`).
10. **Copa Desafío del Romagnoli**: cargar a mano desde el panel (Fixture > Copa Desafío, y los resultados y penales en Resultados). Ya no es automática: el sitio muestra "a confirmar" hasta que se cargue. Fue de 4 equipos con semifinales (11/10/2026) y finales (25/10/2026). Primera: semis La 14 1-1 Unión es Fuerza (3-2 en penales) y Veterano 3-0 Agrario; final Unión es Fuerza 2-1 Veterano. Segunda: semis La 14 1-1 Unión es Fuerza (3-2 en penales) e Ibarra 2-1 La 8; final La 14 1-0 Ibarra. (Resuelto con la migración 022: ya se permiten varios partidos de Copa por categoría.)

## Opcionales
- Volver a procesar los 23 escudos existentes con "Encajar dentro del círculo".
- Agregar recorte manual al diálogo "Ajustar logo" (para logos con fondo de color).
- Borrar la columna `torneos.modalidad` (ya no se usa en la interfaz).
- Si aparece dominio propio: actualizar `ORIGENES` en la Edge Function `usuarios`.

## Auditoría técnica (2026-11-15)
- Aplicada la migración 023 (H-01 integridad entre entidades, H-02 lista blanca del cargador, H-05 amarillas al borrar partidos). Pruebas en `supabase_pruebas_023.sql`.
- Pendiente: H-03 (mover `debe_cambiar_clave` a `app_metadata` en la Edge Function `usuarios`), H-04 (revisar quién puede hacer UPDATE en `torneos` en la base viva), M-04 (procedimiento para reconstruir la base; `config.toml` apunta a un `seed.sql` que no existe), actualizar `MODELO_DATOS.md` (rol `dueno` → `superadmin`).

## Hecho hoy
- "Modalidad" eliminada de la interfaz y de las consultas.
- Sorteo al azar del fixture ("Armar y sortear al azar" y "Volver a sortear" por categoría).
- Logo de liga mostrado completo (cuadrado, más grande) en encabezado y listado.
- Todo desplegado en Vercel.
