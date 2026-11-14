# Ligas Unidas (proyecto FOBAL)

Plataforma multi-liga de fútbol. Marca: Elemen7 es la casa matriz; Ligas Unidas es el producto público.
Sitio: https://ligasunidas.vercel.app · Panel: `/panel` · Pendientes: `PENDIENTES.md` · Modelo de datos: `MODELO_DATOS.md`.

## Estructura
- `sitio/`: el sitio y el panel (HTML + JS sin build; supabase-js por CDN). Es lo único que se publica.
  - `app.js` (sitio público), `panel.js` (panel de administración), `styles.css`, `config.js` (URL y clave pública de Supabase), `vercel.json`.
  - Rutas: `/ligas`, `/<slug-liga>/{fixture,posiciones,copa,goleadores,suspendidos,campeonatos,archivo,institucional}`, `/panel`.
  - Servidor local: `sitio/servir.ps1` (configurado en `.claude/launch.json`, puerto 8080).
- `supabase_migracion_0NN_*.sql`: historial de la base (aplicadas en orden; están a mano, no en el formato de la CLI).
- `supabase/functions/usuarios/`: Edge Function para crear y gestionar usuarios (solo superadmin).
- `demo5_actual.html`: maqueta original (Liga de Fútbol Rural); solo referencia.
- `publicar/` y `ligasunidas-sitio.zip` ya no hacen falta (se generaban con `empaquetar_sitio.ps1`; no se versionan).

## Cómo se publica
Repo privado `elemen7dev/ligas-unidas`, rama `main`. Vercel (proyecto `ligasunidas`, Root Directory `sitio`) publica solo en cada push a `main`.
Los datos (resultados, torneos, clubes) viven en Supabase (ref `ccmkohhgcjzimakqsznl`) y se ven al instante, sin publicar.

## Reglas de trabajo
- Después de cada cambio: commit + push, pero SIEMPRE pidiendo confirmación antes (un push a `main` publica en producción). Mostrar archivos tocados y el mensaje de commit propuesto.
- No proponer otro alojamiento que Vercel ni migrar a Firebase: ya está decidido (Vercel + Supabase).
- No crear dominios ni cobros sin que el dueño lo pida.
- Nunca escribir contraseñas: el dueño inicia sesión él (panel, Supabase, Vercel).
- Migraciones nuevas: siguiente número correlativo; probarlas con rollback; mantener RLS en toda tabla nueva.
- Los archivos con claves reales (`.env*`) no se suben nunca. La clave de `config.js` es la pública (publishable), pensada para el navegador.

## Reglas de negocio vigentes (resumen)
- Tabla ordenada por PTS, DIF, GF y nombre del club (los criterios de desempate reales están pendientes de definir).
- La tabla de liga solo cuenta partidos de tipo `liga`. Copa Desafío = final entre líderes de Ronda 1 y Ronda 2; el campeón del torneo es aparte.
- Suspensión automática por amarillas (`reglas.amarillas_para_suspension`); las rojas se cargan a mano.
- Torneos en borrador no son públicos. Un torneo finalizado queda en el Archivo; solo superadmin lo reabre.
- Una liga puede tener varios torneos en curso: la pestaña "Otros campeonatos" aparece sola y `?torneo=<id>` elige cuál ver.

## Entorno (Windows)
- Git, GitHub CLI y Node están instalados pero pueden no estar en el PATH de una terminal ya abierta: usar `C:\Program Files\Git\cmd\git.exe`, `C:\Program Files\GitHub CLI\gh.exe` o refrescar `$env:Path`.
- Vercel CLI: `vercel` desde `publicar/` (o cualquier carpeta vinculada con `vercel link`).
