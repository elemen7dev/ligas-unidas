# Modelo de datos — Plataforma de ligas (diseño original; la implementación vigente está en las migraciones)

Diseño original, pensado neutral respecto del backend. La decisión ya está tomada: Supabase (PostgreSQL con reglas por fila) para datos, autenticación y archivos, y Vercel para el sitio.

Ejemplos que guían el diseño: **Liga de Fútbol Rural** (2 categorías, 9 equipos, ida y vuelta, Copa Desafío) y **Liga Bolívar** (Copa Centenario, Primera, 8 equipos, ida y vuelta, modalidad F11, escudos por club).

## 1. Jerarquía

```
plataforma
└── liga                      (Liga Bolívar)
    ├── clubes                (Balonpie, Bull Dog…)        persisten entre torneos
    ├── jugadores
    ├── sponsors · institucional · documentos
    └── torneo                (Copa Centenario 2026, F11)
        ├── categorias        (Primera, Segunda)
        │   └── equipos       (club inscripto en esa categoría)
        ├── partidos          (+ eventos: goles, tarjetas)
        └── suspensiones
```

Clave: **club ≠ equipo.** El club es permanente en la liga; el equipo es el club inscripto en una categoría de un torneo. Eso permite archivar torneos sin duplicar clubes.

## 2. Entidades

### Acceso
| Entidad | Campos principales |
|---|---|
| `usuarios` | id (auth), nombre, email |
| `membresias` | usuario_id, liga_id (null = global), rol: `superadmin` · `admin_liga` · `cargador` |

- `superadmin`: solo vos (antes se llamaba `dueno`; renombrado en la migración 003). Crea ligas, publica, ve todo.
- `admin_liga`: configura su liga, equipos, torneos, usuarios cargadores.
- `cargador`: solo carga resultados, goles, tarjetas y suspensiones.

### Liga
| Campo | Notas |
|---|---|
| id, `slug` | slug único; reservados: `panel`, `ligas`, `api`, `admin`, `login` |
| nombre, zona, contacto | |
| `estado` | `no_publicada` · `publicada` |
| marca | logo_url, color_primario, color_secundario |
| `secciones_activas` | fixture, posiciones, copa, goleadores, suspendidos, archivo, institucional, sponsors |
| plan, vencimiento | para cobro futuro |

### Torneo
| Campo | Notas |
|---|---|
| liga_id, nombre, anio | "Copa Centenario", 2026 |
| `modalidad` | F11, F7, F5… (texto libre con sugeridos) |
| `formato` | `todos_contra_todos` (único soportado al inicio) |
| `vueltas` | 1 o 2 (ida y vuelta) |
| `estado` | `borrador` · `en_curso` · `finalizado` (archivado) |
| `reglas` | puntos_victoria (3), puntos_empate (1), puntos_derrota (0), amarillas_para_suspension (4), criterios_desempate (orden), columnas_tabla (PTS, PJ, DG… configurable) |
| copa_desafio | si/no (final entre campeones de cada ronda) |

### Categorías y equipos
- `categorias`: torneo_id, nombre, orden.
- `clubes`: liga_id, nombre, nombre_corto, `escudo_url`, color1, color2.
- `equipos`: torneo_id, categoria_id, club_id.

### Jugadores (resuelve la duda de categoría)
- `jugadores`: liga_id, nombre, apellido, dni (opcional), nacimiento.
- `planteles`: jugador_id, club_id, torneo_id, `categoria_id` (**nullable**), estado.
  - `categoria_id` con valor = categoría fija (modelo actual).
  - `categoria_id` vacío = puede jugar en todas (modelo original).
  - Cada liga elige el modelo con un ajuste; no hay que decidirlo ahora.

### Partidos y eventos
| `partidos` | |
|---|---|
| torneo_id, categoria_id | |
| `tipo` | `liga` · `copa` |
| ronda (1/2), jornada (n) | |
| local_equipo_id, visitante_equipo_id | |
| fecha_hora, cancha | opcionales |
| `estado` | `pendiente` · `jugado` · `suspendido` · `postergado` |
| goles_local, goles_visitante | |
| arbitro, lineas, nota | |
| `ajuste_administrativo` | ganador, anula_goles, motivo (reemplaza sancionGanador / sancionAnulaGoles) |

| `eventos_partido` | |
|---|---|
| partido_id, equipo_id, jugador_id | |
| `tipo` | `gol` · `gol_en_contra` · `amarilla` · `roja` |
| minuto | opcional |

Los textos actuales ("Elián Ortíz x3 (Veterano)") pasan a eventos. Esto habilita goleadores y suspensiones automáticos (pendientes de la demo).

### Suspensiones
jugador_id, torneo_id, fechas, motivo, `origen` (`manual` · `automatica`).

### Contenido de la liga
- `sponsors`: liga_id, nombre, logo_url, link, orden, activo.
- `institucional`: liga_id, orden, titulo, contenido.
- `documentos`: liga_id, tipo (`fichajes`, `buena_fe`), archivo_url.

### Auditoría
`auditoria`: usuario_id, liga_id, entidad, entidad_id, accion, antes, despues, fecha. Protege contra errores del cargador.

## 3. Lo que se calcula (no se guarda)
- **Posiciones**: de partidos + reglas del torneo + ajustes administrativos (lógica actual de `calcStats`).
- **Goleadores**: contando eventos `gol` por jugador.
- **Tarjetas acumuladas**: contando amarillas contra `amarillas_para_suspension`.
- **Libres por fecha**: equipos sin partido en la jornada.

## 4. Reglas de acceso
- Público: lee una liga solo si `estado = publicada`. Nunca lee usuarios, auditoría ni borradores.
- `admin_liga` y `cargador`: solo escriben dentro de su `liga_id`. El `cargador` no toca configuración ni equipos.
- `superadmin`: todo.
- El `liga_id` se valida en el servidor (reglas de la base), nunca solo en la pantalla.

## 5. Imágenes
Subida de escudos y logos a almacenamiento (Supabase Storage), con límite de peso y tipo. Reemplaza el "se guarda en memoria del navegador" actual de Fichajes.

## 6. Migración de la demo
| Demo actual | Modelo nuevo |
|---|---|
| `config` | liga + torneo + reglas |
| `equipos` (nombre, zona, color) | clubes + equipos |
| `jugadores` | jugadores + planteles |
| `partidos` con textos | partidos + eventos_partido |
| `suspensiones`, `institucional` | iguales, con liga_id |
| `usuarios` admin/admin | usuarios + membresias con login real |
| Sponsors del banner | sponsors |

La liga rural sería la primera liga cargada (slug propuesto: `liga-rural`).

## 7. Decisiones abiertas
1. ~~Backend~~: decidido, Supabase + Vercel (no se migra a Firebase).
2. Dominio propio (hoy se usa ligasunidas.vercel.app).
3. Qué incluye cada plan y precio.
4. Fuera del alcance inicial: eliminación directa, grupos, generación automática de gráficos para redes, notificaciones.
