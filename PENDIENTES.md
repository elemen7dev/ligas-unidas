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

## Opcionales
- Volver a procesar los 23 escudos existentes con "Encajar dentro del círculo".
- Agregar recorte manual al diálogo "Ajustar logo" (para logos con fondo de color).
- Borrar la columna `torneos.modalidad` (ya no se usa en la interfaz).
- Si aparece dominio propio: actualizar `ORIGENES` en la Edge Function `usuarios`.

## Hecho hoy
- "Modalidad" eliminada de la interfaz y de las consultas.
- Sorteo al azar del fixture ("Armar y sortear al azar" y "Volver a sortear" por categoría).
- Logo de liga mostrado completo (cuadrado, más grande) en encabezado y listado.
- Todo desplegado en Vercel.
