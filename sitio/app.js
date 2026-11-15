// Ligas Unidas — sitio público. Sin dependencias de build: HTML + JS de módulo.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, WHATSAPP_CONTACTO, WHATSAPP_TEXTO } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const $app = document.getElementById('app');
const RESERVADOS = ['panel', 'ligas', 'api', 'admin', 'login', 'auth', 'static', 'assets'];
const TZ = 'America/Argentina/Buenos_Aires';

/* ---------- utilidades ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlSegura = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const colorSeguro = (c, defecto) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : defecto);
const STOP = ['de', 'del', 'la', 'el', 'los', 'las', 'y'];

function siglaClub(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return p[0].slice(0, 3).toUpperCase();
  const u = p.length > 2 ? p.filter((w) => !STOP.includes(w.toLowerCase())) : p;
  return u.map((w) => (/^\d/.test(w) ? w : w[0])).join('').slice(0, 3).toUpperCase();
}
function inicialesLiga(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter((w) => w.length > 2 || /^\d/.test(w));
  return p.map((w) => w[0]).join('').slice(0, 3).toUpperCase() || '?';
}
function escudo(club, tam = 'm') {
  const u = urlSegura(club?.escudo_url);
  const cuerpo = u ? `<img src="${esc(u)}" alt="" loading="lazy">` : esc(siglaClub(club?.nombre));
  return `<span class="escudo ${tam}" aria-hidden="true">${cuerpo}</span>`;
}
function fmtFecha(iso) {
  if (!iso) return 'Horario a confirmar';
  return new Date(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
function unir(lista) {
  if (lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];
}
const ordenTabla = (a, b) => b.pts - a.pts || b.dif - a.dif || b.gf - a.gf || String(a.club).localeCompare(String(b.club), 'es');

const _memo = new Map();
async function memo(clave, fn, ttl = 60000) {
  const hit = _memo.get(clave);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  _memo.set(clave, { t: Date.now(), v });
  return v;
}
async function traerTodo(construir) {
  const salida = [];
  const paso = 1000;
  for (let d = 0; ; d += paso) {
    const { data, error } = await construir(d, d + paso - 1);
    if (error) throw error;
    salida.push(...data);
    if (data.length < paso) break;
  }
  return salida;
}

/* ---------- datos ---------- */
function cargarLiga(slug) {
  return memo('liga:' + slug, async () => {
    // Las cuatro consultas salen a la vez (se filtra por el slug de la liga con un join), en vez de esperar primero a la liga.
    const [l, t, c, sp] = await Promise.all([
      sb.from('ligas').select('*').eq('slug', slug).maybeSingle(),
      sb.from('torneos').select('id,nombre,anio,formato,vueltas,estado,reglas,copa_desafio,cerrado_en,categorias(id,nombre,orden),ligas!inner(slug)').eq('ligas.slug', slug).order('anio', { ascending: false }),
      sb.from('clubes').select('id,nombre,nombre_corto,escudo_url,ligas!inner(slug)').eq('ligas.slug', slug).order('nombre'),
      sb.from('sponsors').select('id,nombre,logo_url,link,nivel,orden,ligas!inner(slug)').eq('ligas.slug', slug).order('orden'),
    ]);
    if (l.error) throw l.error;
    const liga = l.data;
    if (!liga) return null;
    if (t.error) throw t.error;
    if (c.error) throw c.error;
    const torneos = t.data;
    const actual = torneos.find((x) => x.estado === 'en_curso') || torneos.find((x) => x.estado === 'finalizado') || torneos[0] || null;
    let resumen = null;
    if (actual && actual.estado === 'finalizado') {
      const r = await sb.from('torneos').select('resumen').eq('id', actual.id).maybeSingle();
      resumen = r.data?.resumen || null;
    }
    const cats = ((actual && actual.categorias) || []).slice().sort((a, b) => a.orden - b.orden);
    return { liga, torneos, clubes: c.data, sponsors: sp.error ? [] : sp.data, actual, resumen, cats, finalizados: torneos.filter((x) => x.estado === 'finalizado'), encurso: torneos.filter((x) => x.estado === 'en_curso') };
  });
}
function cargarPartidos(torneoId) {
  return memo('partidos:' + torneoId, () => traerTodo((d, h) =>
    sb.from('partidos')
      .select('id,categoria_id,tipo,ronda,jornada,fecha_hora,cancha,estado,goles_local,goles_visitante,nota,ajuste_ganador_equipo_id,ajuste_motivo,local:local_equipo_id(club_id,clubes(nombre,escudo_url)),visita:visitante_equipo_id(club_id,clubes(nombre,escudo_url))')
      .eq('torneo_id', torneoId).order('ronda').order('jornada').order('fecha_hora', { nullsFirst: false }).range(d, h)));
}
function cargarPosiciones(torneoId) {
  return memo('pos:' + torneoId, () => traerTodo((d, h) => sb.from('posiciones').select('*').eq('torneo_id', torneoId).range(d, h)));
}

/* ---------- router ---------- */
function parsear() {
  const seg = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(location.search);
  if (seg.length === 0 || seg[0] === 'ligas') return { nombre: 'ligas' };
  if (seg[0] === 'panel') return { nombre: 'panel', seg: seg.slice(1), q };
  if (RESERVADOS.includes(seg[0])) return { nombre: '404' };
  return { nombre: 'liga', slug: seg[0], seccion: seg[1] || 'inicio', extra: seg[2], cat: q.get('cat'), torneo: q.get('torneo') };
}
function ir(url) {
  history.pushState({}, '', url);
  dibujar();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  _foco = true;   // al cambiar de página, el foco pasa al contenido (teclado y lectores de pantalla)
  ir(a.getAttribute('href'));
  window.scrollTo(0, 0);
});
let _foco = false;
window.addEventListener('popstate', dibujar);

let _gen = 0;
async function dibujar() {
  const mi = ++_gen;
  const r = parsear();
  try {
    let vista;
    if (r.nombre === 'ligas') vista = await vistaDirectorio();
    else if (r.nombre === 'panel') vista = await (await import('/panel.js')).vistaPanel(r.seg, r.q, { ir, redibujar: dibujar });
    else if (r.nombre === 'liga') vista = await vistaLiga(r);
    else vista = vistaNoEncontrada();
    if (mi !== _gen) return;
    ponerRobots(r.nombre === 'panel');
    document.title = vista.titulo;
    ponerMeta(vista.descripcion);
    $app.innerHTML = vista.html;
    if (vista.despues) vista.despues();
    iniciarRotacion();
    iniciarNav();
    animarEntrada($app);
    if (_foco) { _foco = false; document.getElementById('contenido')?.focus({ preventScroll: true }); }
  } catch (err) {
    if (mi !== _gen) return;
    console.error(err);
    document.title = 'Ligas Unidas';
    $app.innerHTML = `<div class="pagina">${cabeceraLigas()}<main class="principal" id="contenido" tabindex="-1"><div class="contenedor"><div class="vacio"><strong>No pudimos cargar los datos.</strong><br>Revisá tu conexión e intentá de nuevo en unos minutos.</div></div></main></div>`;
  }
}

/* ---------- piezas comunes ---------- */
const LOGO_SVG = '<svg width="44" height="44" viewBox="0 0 72 72" role="img" aria-label="Logo Ligas Unidas"><circle cx="26" cy="30" r="20" fill="none" stroke="#FFFFFF" stroke-width="6"/><circle cx="46" cy="30" r="20" fill="none" stroke="#0B3D2A" stroke-width="6"/><circle cx="36" cy="46" r="20" fill="none" stroke="#C6F135" stroke-width="6"/></svg>';
// Cabecera de marca: en el directorio es el primer apartado; en el resto de la web lleva de vuelta al inicio (/ligas).
function cabeceraLigas() {
  return `<div class="cabecera cab-ligas"><div class="contenedor"><a class="marca" href="/ligas" data-link aria-label="Ligas Unidas: volver al inicio">${LOGO_SVG}<span class="marca-nombre">Ligas Unidas</span></a></div></div>`;
}
const pie = () => pieHome();
const WA = String(WHATSAPP_CONTACTO || '').replace(/\D/g, '');
// Acceso directo a WhatsApp de Elemen7; sin número configurado queda como texto simple.
const enlaceWA = (html, clase = '') => (WA
  ? `<a class="${clase}" href="https://wa.me/${WA}" target="_blank" rel="noopener">${html}</a>`
  : `<span class="${clase}">${html}</span>`);
function pieHome() {
  const contacto = WA
    ? `<span>Contacto ${enlaceWA('Elemen7', 'elemen7')}: ${enlaceWA(esc(WHATSAPP_TEXTO || WHATSAPP_CONTACTO))}</span>`
    : '';
  return `<footer class="pie"><div class="contenedor">${contacto}<span>Ligas Unidas es un producto de Elemen7. Todos los derechos reservados.</span></div></footer>`;
}
function vistaNoEncontrada() {
  return {
    titulo: 'No encontrada · Ligas Unidas',
    html: `<div class="pagina">${cabeceraLigas()}<main class="principal" id="contenido" tabindex="-1"><div class="contenedor"><h1 class="titulo-seccion">No encontramos esa página</h1><div class="vacio">La liga no existe o todavía no está publicada.<br><a href="/ligas" data-link>Ver todas las ligas</a></div></div></main>${pie()}</div>`,
  };
}
const DESC_GENERAL = 'Resultados, tablas y goleadores de las ligas de fútbol de la región.';
function ponerMeta(descripcion) {
  const d = descripcion || DESC_GENERAL;
  const fija = (sel, crear, atributo, valor) => {
    let m = document.querySelector(sel);
    if (!m) { m = crear(); document.head.appendChild(m); }
    m.setAttribute(atributo, valor);
  };
  fija('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', d);
  fija('meta[property="og:title"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m; }, 'content', document.title);
  fija('meta[property="og:description"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:description'); return m; }, 'content', d);
  fija('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', location.origin + location.pathname.replace(/\/$/, ''));
}
function ponerRobots(noindex) {
  let m = document.querySelector('meta[name="robots"]');
  if (noindex) {
    if (!m) { m = document.createElement('meta'); m.name = 'robots'; document.head.appendChild(m); }
    m.content = 'noindex, nofollow';
  } else if (m) m.remove();
}

/* ---------- directorio ---------- */
async function vistaDirectorio() {
  const { data, error } = await sb.from('ligas')
    .select('slug,nombre,zona,logo_url,color_primario,torneos(id,nombre,anio,estado,categorias(nombre,orden)),clubes(nombre,nombre_corto,localidad)')
    .order('nombre');
  if (error) throw error;
  const ligas = data || [];

  // búsqueda ampliada: sin tildes ni mayúsculas, por liga, zona, torneo, año, categoría y equipo
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const textoBusqueda = (l) => norm([
    l.nombre, l.slug, l.zona,
    ...(l.torneos || []).flatMap((t) => [t.nombre, t.anio, ...(t.categorias || []).map((c) => c.nombre)]),
    ...(l.clubes || []).flatMap((c) => [c.nombre, c.nombre_corto, c.localidad]),
  ].filter((x) => x != null && x !== '').join(' '));

  const tarjeta = (l) => {
    const ts = l.torneos || [];
    const t = ts.find((x) => x.estado === 'en_curso') || ts.slice().sort((a, b) => b.anio - a.anio)[0];
    const color = colorSeguro(l.color_primario, '#0B3D2A');
    const logo = urlSegura(l.logo_url) ? `<img src="${esc(urlSegura(l.logo_url))}" alt="">` : esc(inicialesLiga(l.nombre));
    return `<a class="liga-card" href="/${encodeURIComponent(l.slug)}" data-link data-buscar="${esc(textoBusqueda(l))}">
      <div class="liga-card-cab" style="background:${color}"><span class="marca-logo" style="color:${color}">${logo}</span><strong>${esc(l.nombre)}</strong></div>
      <div class="liga-card-cuerpo"><span class="sub">${esc(t ? t.nombre + (t.anio ? ' · ' + t.anio : '') : (l.zona || 'Próximamente'))}</span>
      <span class="entrar">Entrar a la liga →</span></div></a>`;
  };

  const html = `<div class="pagina">
    ${cabeceraLigas()}
    <div class="directorio-hero"><div class="contenedor">
      <span class="etiqueta lima" style="align-self:flex-start">Elegí tu liga</span>
      <h1>Todas las ligas.<br>Un lugar.</h1>
      <p>Resultados, tablas y goleadores, actualizados después de cada fecha.</p>
      <div class="buscador"><label for="buscar" class="solo-lectores">Buscar liga</label>
        <input id="buscar" type="search" placeholder="Buscar liga o equipo" autocomplete="off" aria-describedby="ayuda-buscar"></div>
      <p id="ayuda-buscar" class="ayuda-buscar">También busca por zona, torneo o categoría.</p>
    </div></div>
    <main class="principal" id="contenido" tabindex="-1"><div class="contenedor">
      <h2 class="titulo-seccion">Ligas publicadas</h2>
      ${ligas.length ? `<div class="rejilla" id="rejilla">${ligas.map(tarjeta).join('')}
        <div class="caja-vacia"><strong>¿Tu liga no está?</strong><span>${enlaceWA('Escribinos', 'enlace-wa')} y la sumamos a la plataforma.</span></div></div>
        <p class="vacio" id="sin-resultados" hidden>No encontramos ligas con esa búsqueda.</p>`
        : '<div class="vacio">Todavía no hay ligas publicadas.</div>'}
    </div></main>
    ${pie()}</div>`;

  return {
    titulo: 'Ligas Unidas · Resultados de las ligas de la región',
    html,
    despues() {
      const inp = document.getElementById('buscar');
      if (!inp) return;
      inp.addEventListener('input', () => {
        const palabras = norm(inp.value).split(/\s+/).filter(Boolean);
        let visibles = 0;
        document.querySelectorAll('#rejilla .liga-card').forEach((a) => {
          const ok = palabras.every((p) => a.dataset.buscar.includes(p));
          a.hidden = !ok;
          if (ok) visibles++;
        });
        const s = document.getElementById('sin-resultados');
        if (s) s.hidden = visibles > 0;
      });
    },
  };
}

/* ---------- sponsors ---------- */
const logoSponsor = (s, tam) => {
  const u = urlSegura(s.logo_url);
  return `<span class="sp-logo ${tam}" aria-hidden="true">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : esc(siglaClub(s.nombre))}</span>`;
};
function envolverSponsor(s, L, clase, contenido) {
  const u = urlSegura(s.link);
  return u
    ? `<a class="${clase}" href="${esc(u)}" target="_blank" rel="sponsored noopener noreferrer" data-sponsor="${esc(s.id)}" data-liga="${esc(L.liga.id)}">${contenido}<span class="solo-lectores"> (abre en una pestaña nueva)</span></a>`
    : `<div class="${clase}">${contenido}</div>`;
}
const sponsorsDe = (L, nivel) => (L.sponsors || []).filter((s) => s.nivel === nivel);
function lineaPresentador(L, enTarjeta) {
  const s = sponsorsDe(L, 'presentador')[0];
  if (!s) return '';
  return `<div class="presenta${enTarjeta ? ' en-tarjeta' : ''}"><span>Tabla presentada por</span>${envolverSponsor(s, L, 'presenta-enlace', `${logoSponsor(s, 's')}<b>${esc(s.nombre)}</b>`)}</div>`;
}
function tarjetaApoyo(L) {
  const lista = sponsorsDe(L, 'colaborador');
  if (!lista.length) return '';
  return `<div class="tarjeta"><div class="tarjeta-titulo verde"><span>Con el apoyo de</span><span style="font-weight:500;font-size:11px;font-family:var(--texto);text-transform:none;letter-spacing:0">Publicidad</span></div>
    <div class="sp-apoyo">${lista.map((s) => envolverSponsor(s, L, 'sp-apoyo-item', `${logoSponsor(s, 'l')}<span>${esc(s.nombre)}</span>`)).join('')}</div></div>`;
}
function franjaOficiales(L) {
  const lista = sponsorsDe(L, 'oficial');
  if (!lista.length) return '';
  return `<section class="sp-franja" data-rota aria-label="Auspiciantes oficiales"><div class="contenedor">
    <div class="sp-cab"><span class="etiqueta">Auspiciantes oficiales</span><span class="sp-pub">Publicidad</span></div>
    <div class="sp-grid">${lista.map((s) => envolverSponsor(s, L, 'sp-item', `${logoSponsor(s, 'm')}<strong>${esc(s.nombre)}</strong>`)).join('')}</div>
    <div class="sp-puntos"></div></div></section>`;
}
// Clics: un renglón por clic (sin cookies ni datos personales). Si falla, no se avisa ni se frena la navegación.
const _clicsRecientes = new Map();
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-sponsor]');
  if (!a) return;
  const id = a.dataset.sponsor, ahora = Date.now();
  if (ahora - (_clicsRecientes.get(id) || 0) < 2000) return;
  _clicsRecientes.set(id, ahora);
  Promise.resolve(sb.from('sponsor_clics').insert({ sponsor_id: id, liga_id: a.dataset.liga })).catch(() => {});
});
// Rotación de la franja: grupos de 4 cada 5 s; se pausa con el mouse o el foco y no rota si el usuario pidió menos movimiento.
let _rot = null;
function iniciarRotacion() {
  if (_rot) { clearInterval(_rot); _rot = null; }
  const cont = document.querySelector('[data-rota]');
  if (!cont) return;
  const items = [...cont.querySelectorAll('.sp-item')];
  if (items.length <= 4) return;
  const grupos = Math.ceil(items.length / 4), puntos = cont.querySelector('.sp-puntos');
  let g = 0, pausa = false;
  const pintar = () => {
    items.forEach((it, i) => { it.hidden = Math.floor(i / 4) !== g; });
    puntos.innerHTML = Array.from({ length: grupos }, (_, k) => `<button type="button" class="sp-punto" data-g="${k}" aria-label="Mostrar grupo ${k + 1} de ${grupos}"${k === g ? ' aria-current="true"' : ''}></button>`).join('');
  };
  pintar();
  puntos.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { g = +b.dataset.g; pintar(); } });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cont.addEventListener('mouseenter', () => { pausa = true; });
  cont.addEventListener('mouseleave', () => { pausa = false; });
  cont.addEventListener('focusin', () => { pausa = true; });
  cont.addEventListener('focusout', () => { pausa = false; });
  _rot = setInterval(() => { if (pausa || document.hidden) return; g = (g + 1) % grupos; pintar(); }, 5000);
}

// Aparición al hacer scroll: los bloques entran escalonados al verse. Sin IntersectionObserver o con "menos movimiento", no se anima nada.
const _selEntrada = '.portada,.tarjeta,.liga-card,.archivo-card,.caja-vacia,.fx-fecha,details.acordeon,.copa-cruce,.estado-torneo,.tabla tbody tr,.partido';
let _obsEntrada = null;
function animarEntrada(raiz) {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!_obsEntrada) {
    _obsEntrada = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      _obsEntrada.unobserve(el);
      el.classList.add('visto');
      // al terminar, se quita la clase para no pisar las transiciones de hover del elemento
      const limpiar = (ev) => { if (ev.propertyName !== 'transform') return; el.removeEventListener('transitionend', limpiar); el.classList.remove('rev', 'visto'); el.style.removeProperty('--i'); };
      el.addEventListener('transitionend', limpiar);
    }), { threshold: 0.06, rootMargin: '0px 0px -24px 0px' });
  }
  raiz.querySelectorAll(_selEntrada).forEach((el) => {
    if (el.classList.contains('rev')) return;
    const i = [...el.parentElement.children].indexOf(el);
    el.style.setProperty('--i', Math.min(i, 8));
    el.classList.add('rev');
    _obsEntrada.observe(el);
  });
}

// Menú de la liga en móvil: centra la sección activa y muestra un degradado donde hay más pestañas para deslizar.
function iniciarNav() {
  document.querySelectorAll('.nav').forEach((nav) => {
    const marcar = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      nav.classList.toggle('mas-izq', nav.scrollLeft > 4);
      nav.classList.toggle('mas-der', nav.scrollLeft < max - 4);
    };
    const act = nav.querySelector('[aria-current="page"]');
    if (act) nav.scrollLeft = act.offsetLeft - (nav.clientWidth - act.offsetWidth) / 2;
    nav.addEventListener('scroll', marcar, { passive: true });
    marcar();
  });
}
const glosario = () => '<p class="glosario"><b>PTS</b> puntos · <b>PJ</b> partidos jugados · <b>G</b> ganados · <b>E</b> empatados · <b>P</b> perdidos · <b>GF</b> goles a favor · <b>GC</b> goles en contra · <b>DIF</b> diferencia de gol</p>';
const fmtDia = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

/* ---------- sitio de liga ---------- */
const SECCIONES = [['inicio', 'Inicio'], ['fixture', 'Fixture'], ['posiciones', 'Posiciones'], ['copa', 'Copa'], ['goleadores', 'Goleadores'], ['suspendidos', 'Suspendidos'], ['campeonatos', 'Otros campeonatos'], ['archivo', 'Archivo'], ['institucional', 'Institucional']];
const CON_CATEGORIA = ['inicio', 'fixture', 'posiciones', 'copa', 'goleadores'];
const COLS = { PJ: 'pj', G: 'g', E: 'e', P: 'p', GF: 'gf', GC: 'gc', DIF: 'dif', PTS: 'pts' };

function seccionesVisibles(L) {
  const act = L.liga.secciones_activas || [];
  // La pestaña Copa aparece sola cuando el torneo actual tiene Copa Desafío; Archivo, cuando hay torneos finalizados.
  return SECCIONES.filter(([k]) => k === 'inicio' || (k === 'archivo' ? L.finalizados.length > 0 : k === 'campeonatos' ? L.encurso.length > 1 : k === 'copa' ? !!L.actual?.copa_desafio : act.includes(k)));
}

// Query string que conserva el torneo elegido (si la liga tiene varios en curso) y la categoría.
function consulta(L, cat) {
  const p = new URLSearchParams();
  if (L.encurso && L.encurso.length > 1 && L.actual) p.set('torneo', L.actual.id);
  if (cat && L.cats.length > 1) p.set('cat', cat.nombre);
  const s = p.toString();
  return s ? '?' + s : '';
}

function marco(L, sec, cat, cuerpo, antes = '') {
  const base = '/' + encodeURIComponent(L.liga.slug);
  const q = consulta(L, cat);
  const nav = seccionesVisibles(L).map(([k, nombre]) => {
    const href = base + (k === 'inicio' ? '' : '/' + k) + (CON_CATEGORIA.includes(k) ? q : '');
    return `<a href="${href}" data-link${sec === k ? ' aria-current="page"' : ''}>${nombre}</a>`;
  }).join('');
  const c1 = colorSeguro(L.liga.color_primario, '#0A7F4F');
  const c2 = colorSeguro(L.liga.color_secundario, '#0B3D2A');
  const logo = urlSegura(L.liga.logo_url) ? `<img src="${esc(urlSegura(L.liga.logo_url))}" alt="">` : esc(inicialesLiga(L.liga.nombre));
  return `<div class="pagina" style="--c1:${c1};--c2:${c2}">
    ${cabeceraLigas()}
    <header class="cabecera"><div class="contenedor">
      <a class="marca" href="${base}${q}" data-link><span class="marca-logo">${logo}</span><span class="marca-nombre">${esc(L.liga.nombre)}</span></a>
      <nav class="nav" aria-label="Secciones de la liga">${nav}</nav>
    </div></header>
    ${antes}
    <main class="principal" id="contenido" tabindex="-1"><div class="contenedor">${cuerpo}</div></main>
    ${franjaOficiales(L)}
    ${pie()}</div>`;
}

function selectorCategoria(L, sec, cat) {
  if (L.cats.length < 2) return '';
  const base = '/' + encodeURIComponent(L.liga.slug) + (sec === 'inicio' ? '' : '/' + sec);
  return `<div class="pildoras" role="group" aria-label="Categoría">${L.cats.map((c) =>
    `<a class="pildora" href="${base}${consulta(L, c).replace(/^\?/, '?')}" data-link aria-current="${c.id === cat.id}">${esc(c.nombre)}</a>`).join('')}</div>`;
}

async function vistaLiga(r) {
  let L = await cargarLiga(r.slug);
  if (!L) return vistaNoEncontrada();
  // Si la liga tiene varios torneos en curso, ?torneo=<id> elige cuál mostrar.
  const elegido = r.torneo && L.encurso.find((x) => x.id === r.torneo);
  if (elegido && elegido.id !== L.actual?.id) {
    L = { ...L, actual: elegido, resumen: null, cats: (elegido.categorias || []).slice().sort((a, b) => a.orden - b.orden) };
  }
  const visibles = seccionesVisibles(L).map(([k]) => k);
  const sec = visibles.includes(r.seccion) ? r.seccion : null;
  if (!sec) return vistaNoEncontrada();
  const cat = L.cats.find((c) => c.nombre === r.cat) || L.cats[0] || null;
  const titulo = (s) => `${s} · ${L.liga.nombre}`;
  let v;
  if (sec === 'inicio') v = await seccionInicio(L, cat);
  else if (sec === 'fixture') v = await seccionFixture(L, cat);
  else if (sec === 'posiciones') v = await seccionPosiciones(L, cat);
  else if (sec === 'copa') v = await seccionCopa(L, cat);
  else if (sec === 'goleadores') v = await seccionGoleadores(L, cat);
  else if (sec === 'suspendidos') v = await seccionSuspendidos(L);
  else if (sec === 'campeonatos') v = seccionCampeonatos(L);
  else if (sec === 'archivo') v = await seccionArchivo(L, r.extra);
  else v = await seccionInstitucional(L);
  return { titulo: titulo(v.titulo), descripcion: `${v.titulo === 'Inicio' ? 'Resultados' : v.titulo} de ${L.liga.nombre}${L.liga.zona ? ' (' + L.liga.zona + ')' : ''}: resultados, tablas de posiciones, goleadores y fixture, actualizados después de cada fecha.`, html: v.html, despues: v.despues };
}

function sinTorneo(L, sec, titulo) {
  return { titulo, html: marco(L, sec, null, `<h1 class="titulo-seccion">${esc(titulo)}</h1><div class="vacio">Esta liga todavía no tiene un torneo cargado.</div>`) };
}

/* Inicio */
async function seccionInicio(L, cat) {
  const t = L.actual;
  if (!t || !cat) return sinTorneo(L, 'inicio', 'Inicio');
  const [partidos, posAll, rManual, rAct] = await Promise.all([
    cargarPartidos(t.id), cargarPosiciones(t.id),
    sb.from('portadas').select('etiqueta,titular,bajada').eq('torneo_id', t.id).eq('categoria_id', cat.id).maybeSingle(),
    sb.from('partidos').select('actualizado_en').eq('torneo_id', t.id).order('actualizado_en', { ascending: false }).limit(1),
  ]);
  const pos = posAll.filter((p) => p.categoria_id === cat.id).sort(ordenTabla);
  const pc = partidos.filter((p) => p.categoria_id === cat.id && p.tipo === 'liga');
  const clave = (p) => p.ronda * 1000 + p.jornada;

  const jugados = pc.filter((p) => p.estado === 'jugado');
  const kUlt = jugados.length ? Math.max(...jugados.map(clave)) : null;
  const ultimos = kUlt === null ? [] : jugados.filter((p) => clave(p) === kUlt);
  const nomCorto = (x) => x?.clubes?.nombre || '';
  const franjaResultados = ultimos.length ? `<div class="franja"><div class="contenedor">
      <span class="etiqueta">Fecha ${ultimos[0].jornada}</span>
      <div class="tira">${ultimos.map((p) => `<span class="resultado">${esc(nomCorto(p.local))}<b>${p.goles_local}-${p.goles_visitante}</b>${esc(nomCorto(p.visita))}</span>`).join('')}</div>
    </div></div>` : '';
  const franjaClubes = L.clubes.length ? `<div class="franja"><div class="contenedor">
      <span class="rotulo">Clubes</span>
      <div class="escudos">${L.clubes.map((c) => `<span class="escudo-item" role="img" aria-label="${esc(c.nombre)}" title="${esc(c.nombre)}">${escudo(c, 'g')}</span>`).join('')}</div>
    </div></div>` : '';

  const jug = pos.filter((p) => p.pj > 0);
  const lider = jug[0];
  const resCat = t.estado === 'finalizado' && L.resumen ? (L.resumen.categorias || []).find((c) => c.nombre === cat.nombre) : null;
  // Con el fixture completo (todos los partidos de liga jugados o resueltos por sanción) la portada proclama al campeón.
  const fixtureCompleto = pc.length > 0 && pc.every((p) => p.estado === 'jugado' || p.ajuste_ganador_equipo_id);
  const filaCamp = (resCat && resCat.campeon && pos.find((p) => p.club === resCat.campeon.club)) || lider;
  const estadisticaDe = (f) => `Suma ${f.g} ${f.g === 1 ? 'victoria' : 'victorias'} y ${f.e} ${f.e === 1 ? 'empate' : 'empates'} en ${f.pj} partidos${f.p === 0 ? ' y terminó invicto' : ''}.`;
  let etiqueta = esc(cat.nombre), titular, bajada;
  if (filaCamp && (fixtureCompleto || (resCat && resCat.campeon))) {
    etiqueta += t.estado === 'finalizado' ? ' · Torneo finalizado' : ' · Fixture completo';
    const segundo = pos[1];
    const empatados = !resCat?.campeon && segundo && segundo.pts === lider.pts && segundo.dif === lider.dif && segundo.gf === lider.gf;
    if (empatados) {
      titular = `${esc(lider.club)} y ${esc(segundo.club)}<br>igualados en la cima`;
      bajada = `Ambos suman ${lider.pts} puntos, con la misma diferencia de gol y goles a favor. Se define por desempate.`;
    } else {
      titular = `${esc(filaCamp.club)}<br>se consagra campeón del torneo`;
      bajada = estadisticaDe(filaCamp);
    }
  } else if (lider) {
    const inv = lider.p === 0 ? ' y sigue invicto' : '';
    titular = `${esc(lider.club)} lidera<br>con ${lider.pts} puntos`;
    bajada = `Suma ${lider.g} ${lider.g === 1 ? 'victoria' : 'victorias'} y ${lider.e} ${lider.e === 1 ? 'empate' : 'empates'} en ${lider.pj} partidos${inv}.`;
  } else {
    titular = 'Arranca<br>el torneo';
    bajada = 'Todavía no se jugó ninguna fecha.';
  }

  const ataque = jug.slice().sort((a, b) => b.gf - a.gf || a.pj - b.pj)[0];
  const valla = jug.slice().sort((a, b) => a.gc - b.gc || a.pj - b.pj)[0];
  const datos = ataque && valla ? `<div class="datos">
      <div class="tarjeta pad"><span class="dato-rotulo">Mejor ataque</span><span class="dato-grande">${esc(ataque.club)}</span><span class="dato-detalle"><b>${ataque.gf}</b> goles en ${ataque.pj} partidos</span></div>
      <div class="tarjeta pad"><span class="dato-rotulo">Valla menos vencida</span><span class="dato-grande">${esc(valla.club)}</span><span class="dato-detalle"><b>${valla.gc}</b> goles en contra</span></div>
    </div>` : '';

  // Portada editada a mano desde el panel (si existe, reemplaza a la automática)
  const manual = rManual.data;
  const saltos = (s) => esc(s).replace(/\r?\n/g, '<br>');
  if (manual?.titular) {
    etiqueta = esc(manual.etiqueta || cat.nombre);
    titular = saltos(manual.titular);
    bajada = manual.bajada || '';
  }

  let proxima = '';
  if (t.estado === 'en_curso') {
    const pend = pc.filter((p) => p.estado === 'pendiente' && !p.ajuste_ganador_equipo_id);
    if (pend.length) {
      const k = Math.min(...pend.map(clave));
      const sig = pend.filter((p) => clave(p) === k);
      proxima = `<div class="tarjeta"><div class="tarjeta-titulo verde"><span>Próxima fecha · Fecha ${sig[0].jornada}</span></div>
        ${sig.map((p) => `<div class="proximo"><span class="l">${esc(nomCorto(p.local))}</span><span class="vs">vs</span><span class="v">${esc(nomCorto(p.visita))}</span></div>`).join('')}
        <div class="nota-pie">Fecha y horario a confirmar.</div></div>`;
    }
  }

  // Última actualización (si la columna aún no existe en la base, simplemente no se muestra)
  const act = rAct.data;
  const estadoTxt = t.estado === 'finalizado' ? 'Torneo finalizado' : jugados.length ? 'Torneo en curso' : 'Torneo en curso · todavía sin resultados';
  const nota = `<p class="estado-torneo"><strong>${esc(String(t.nombre).includes(String(t.anio)) ? t.nombre : `${t.nombre} ${t.anio}`)}</strong> · ${estadoTxt}${act?.[0]?.actualizado_en ? ` · Actualizado el ${fmtDia(act[0].actualizado_en)}` : ''}</p>`;
  const lateral = proxima + tarjetaApoyo(L);
  const cuerpo = `${L.cats.length > 1 ? `<div class="controles">${selectorCategoria(L, 'inicio', cat)}</div>` : ''}
    <section class="portada"><span class="etiqueta lima">${etiqueta}</span><h1>${titular}</h1>${bajada ? `<p>${esc(bajada)}</p>` : ''}</section>
    ${nota}
    <div class="inicio-dividido">
      <div class="inicio-tabla">
        ${lineaPresentador(L, false)}
        ${pos.length ? htmlTabla(pos, t.reglas?.columnas_tabla, true) + glosario() : '<div class="vacio">Todavía no hay equipos cargados.</div>'}
      </div>
      ${lateral ? `<div class="inicio-lateral">${lateral}</div>` : ''}
    </div>
    ${datos}`;
  return { titulo: 'Inicio', html: marco(L, 'inicio', cat, cuerpo, franjaResultados + franjaClubes) };
}

/* Fixture */
function htmlFixtureLista(L, partidos, pos, ronda, fecha) {
  let ps = partidos;
  if (ronda !== 'todas') ps = ps.filter((p) => String(p.ronda) === ronda);
  if (fecha !== 'todas') ps = ps.filter((p) => String(p.jornada) === fecha);
  if (!ps.length) return '<div class="vacio">No hay partidos para ese filtro.</div>';
  const grupos = new Map();
  ps.forEach((p) => {
    const k = `${p.tipo}-${p.ronda}-${p.jornada}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  });
  return [...grupos.values()].map((g) => {
    const p0 = g[0];
    const juegan = new Set(g.flatMap((p) => [p.local?.club_id, p.visita?.club_id]));
    const libres = pos.filter((x) => !juegan.has(x.club_id)).map((x) => x.club);
    const nombreGrupo = p0.tipo === 'copa' ? 'Copa · ' + `Fecha ${p0.jornada}` : `Ronda ${p0.ronda} · Fecha ${p0.jornada}`;
    return `<section class="tarjeta grupo"><div class="grupo-titulo${p0.ronda === 2 ? ' r2' : ''}"><span>${nombreGrupo}</span></div>
      ${g.map((p) => {
        const l = p.local?.clubes, v = p.visita?.clubes;
        const jugado = p.estado === 'jugado';
        const marc = jugado ? `<span class="marcador">${p.goles_local}-${p.goles_visitante}</span>`
          : `<span class="marcador pend">${p.estado === 'suspendido' ? 'Susp.' : p.estado === 'postergado' ? 'Post.' : 'vs'}</span>`;
        const meta = [fmtFecha(p.fecha_hora), p.cancha].filter(Boolean).join(' · ');
        const aviso = p.ajuste_ganador_equipo_id ? `<div class="partido-aviso"><strong>${esc(p.ajuste_motivo || 'Ajuste administrativo')}.</strong>${p.nota ? ' ' + esc(p.nota) : ''}</div>`
          : (p.nota ? `<div class="partido-aviso">${esc(p.nota)}</div>` : '');
        return `<div class="partido"><div class="partido-fila"><span class="eq l"><span>${esc(l?.nombre)}</span>${escudo(l)}</span>${marc}<span class="eq v">${escudo(v)}<span>${esc(v?.nombre)}</span></span></div>
          <div class="partido-meta">${esc(meta)}</div>${aviso}</div>`;
      }).join('')}
      ${libres.length && p0.tipo === 'liga' ? `<div class="libres">Libre: ${esc(libres.join(', '))}</div>` : ''}</section>`;
  }).join('');
}

async function seccionFixture(L, cat) {
  const t = L.actual;
  if (!t || !cat) return sinTorneo(L, 'fixture', 'Fixture');
  const [partidos, posAll] = await Promise.all([cargarPartidos(t.id), cargarPosiciones(t.id)]);
  const pc = partidos.filter((p) => p.categoria_id === cat.id);
  const pos = posAll.filter((p) => p.categoria_id === cat.id);
  const rondas = [...new Set(pc.map((p) => p.ronda))].sort();
  const optRondas = `<option value="todas">Todas las rondas</option>${rondas.map((r) => `<option value="${r}">Ronda ${r}</option>`).join('')}`;
  const opcionesFecha = (ronda) => {
    const js = [...new Set(pc.filter((p) => ronda === 'todas' || String(p.ronda) === ronda).map((p) => p.jornada))].sort((a, b) => a - b);
    return `<option value="todas">Todas las fechas</option>${js.map((j) => `<option value="${j}">Fecha ${j}</option>`).join('')}`;
  };
  // por defecto: la próxima fecha pendiente (o todas si el torneo terminó)
  const pend = pc.filter((p) => p.estado === 'pendiente' && p.tipo === 'liga');
  const sig = t.estado === 'en_curso' && pend.length ? pend.reduce((m, p) => (p.ronda * 1000 + p.jornada < m.ronda * 1000 + m.jornada ? p : m)) : null;
  const rondaIni = sig ? String(sig.ronda) : 'todas';
  const fechaIni = sig ? String(sig.jornada) : 'todas';

  const cuerpo = `<h1 class="titulo-seccion">Fixture</h1>
    <div class="controles">${selectorCategoria(L, 'fixture', cat)}
      <label class="solo-lectores" for="f-ronda">Ronda</label><select id="f-ronda">${optRondas}</select>
      <label class="solo-lectores" for="f-fecha">Fecha</label><select id="f-fecha">${opcionesFecha(rondaIni)}</select></div>
    <div id="f-lista">${htmlFixtureLista(L, pc, pos, rondaIni, fechaIni)}</div>`;
  return {
    titulo: 'Fixture',
    html: marco(L, 'fixture', cat, cuerpo),
    despues() {
      const sr = document.getElementById('f-ronda'), sf = document.getElementById('f-fecha'), lista = document.getElementById('f-lista');
      sr.value = rondaIni;
      sf.value = fechaIni;
      const pintar = () => { lista.innerHTML = htmlFixtureLista(L, pc, pos, sr.value, sf.value); animarEntrada(lista); };
      sr.addEventListener('change', () => { sf.innerHTML = opcionesFecha(sr.value); sf.value = 'todas'; pintar(); });
      sf.addEventListener('change', pintar);
    },
  };
}

/* Posiciones */
function htmlTabla(filas, columnas, ptsPrimero = false) {
  const cols = (columnas || []).filter((c) => COLS[c]);
  let usa = cols.length ? cols : Object.keys(COLS);
  if (ptsPrimero && usa.includes('PTS')) usa = ['PTS', ...usa.filter((c) => c !== 'PTS')];
  return `<div class="tarjeta"><div class="tabla-scroll"><table class="tabla tabla-pos">
    <caption class="solo-lectores">Tabla de posiciones</caption>
    <thead><tr><th scope="col">#</th><th scope="col" class="izq">Equipo</th>${usa.map((c) => `<th scope="col"${c === 'PTS' ? ' class="pts"' : ''}>${c}</th>`).join('')}</tr></thead>
    <tbody>${filas.map((f, i) => `<tr${i === 0 && f.pj > 0 ? ' class="lider"' : ''}><td>${f.pos ?? i + 1}</td>
      <td class="club izq"><span>${escudo({ nombre: f.club, escudo_url: f.escudo_url })}${esc(f.club)}</span></td>
      ${usa.map((c) => `<td${c === 'PTS' ? ' class="pts"' : ''}>${f[COLS[c]]}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

async function seccionPosiciones(L, cat) {
  const t = L.actual;
  if (!t || !cat) return sinTorneo(L, 'posiciones', 'Posiciones');
  const [posAll, partidos] = await Promise.all([cargarPosiciones(t.id), cargarPartidos(t.id)]);
  const pos = posAll.filter((p) => p.categoria_id === cat.id).sort(ordenTabla);
  const ajustes = partidos.filter((p) => p.categoria_id === cat.id && p.ajuste_ganador_equipo_id);
  const notas = ajustes.map((p) => `Ronda ${p.ronda}, Fecha ${p.jornada}: ${p.local?.clubes?.nombre} vs ${p.visita?.clubes?.nombre} — ${p.ajuste_motivo || 'ajuste administrativo'}.`);
  const cuerpo = `<h1 class="titulo-seccion">Posiciones</h1>
    <div class="controles">${selectorCategoria(L, 'posiciones', cat)}</div>
    ${t.estado === 'finalizado' ? `<p class="aviso">Torneo finalizado${L.resumen?.partidos_sin_jugar ? ` (se cerró con ${L.resumen.partidos_sin_jugar} partidos del calendario sin disputar; la tabla cuenta solo los jugados)` : ''}.</p>` : ''}
    ${lineaPresentador(L, false)}
    ${pos.length ? htmlTabla(pos, t.reglas?.columnas_tabla) + glosario() : '<div class="vacio">Todavía no hay equipos cargados.</div>'}
    ${notas.length ? `<p class="pie-tabla">${notas.map(esc).join('<br>')}</p>` : ''}`;
  return { titulo: 'Posiciones', html: marco(L, 'posiciones', cat, cuerpo) };
}

/* Goleadores */
function htmlGoleadores(filas) {
  if (!filas.length) return '<div class="vacio">Todavía no hay goles cargados.</div>';
  let ult = null, posAct = 0;
  const conPos = filas.map((f, i) => {
    if (f.goles !== ult) { posAct = i + 1; ult = f.goles; }
    return { ...f, pos: posAct };
  });
  return `<div class="tarjeta"><div class="tabla-scroll"><table class="tabla">
    <caption class="solo-lectores">Tabla de goleadores</caption>
    <thead><tr><th scope="col">#</th><th scope="col" class="izq">Jugador</th><th scope="col" class="izq">Equipo</th><th scope="col">Goles</th></tr></thead>
    <tbody>${conPos.map((f) => `<tr><td>${f.pos}</td><td class="club izq">${esc(f.jugador)}</td><td class="izq">${esc(f.club)}</td><td class="pts">${f.goles}</td></tr>`).join('')}</tbody></table></div></div>`;
}
async function seccionGoleadores(L, cat) {
  const t = L.actual;
  if (!t || !cat) return sinTorneo(L, 'goleadores', 'Goleadores');
  const filas = await memo(`gol:${t.id}:${cat.id}`, async () => {
    const { data, error } = await sb.from('goleadores').select('nombre,apellido,club,goles').eq('torneo_id', t.id).eq('categoria_id', cat.id)
      .order('goles', { ascending: false }).order('apellido').limit(100);
    if (error) throw error;
    return data.map((f) => ({ jugador: `${f.nombre} ${f.apellido}`.replace(/^\(s\/d\)\s*/, ''), club: f.club, goles: f.goles }));
  });
  const cuerpo = `<h1 class="titulo-seccion">Goleadores</h1><div class="controles">${selectorCategoria(L, 'goleadores', cat)}</div>${htmlGoleadores(filas)}`;
  return { titulo: 'Goleadores', html: marco(L, 'goleadores', cat, cuerpo) };
}

/* Suspendidos */
async function seccionSuspendidos(L) {
  const t = L.actual;
  const nom = (f) => `${f.nombre} ${f.apellido}`.replace(/^\(s\/d\)\s*/, '');
  const [sus, tar] = t ? await memo('susp:' + t.id, async () => {
    const [a, b] = await Promise.all([
      sb.from('suspendidos').select('nombre,apellido,club,categoria,restantes,fechas,motivo').eq('torneo_id', t.id).order('restantes', { ascending: false }),
      sb.from('tarjetas').select('nombre,apellido,club,categoria,amarillas,rojas').eq('torneo_id', t.id),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    return [a.data, b.data];
  }) : [[], []];
  const umbral = parseInt(t?.reglas?.amarillas_para_suspension, 10) || 0;
  const conTarjetas = tar.filter((x) => x.amarillas > 0 || x.rojas > 0).sort((a, b) => b.amarillas - a.amarillas || b.rojas - a.rojas).slice(0, 40);
  const tablaSus = sus.length
    ? `<div class="tarjeta"><div class="tabla-scroll"><table class="tabla"><caption class="solo-lectores">Jugadores suspendidos</caption>
        <thead><tr><th scope="col" class="izq">Jugador</th><th scope="col" class="izq">Equipo</th><th scope="col">Fechas pendientes</th><th scope="col" class="izq">Motivo</th></tr></thead>
        <tbody>${sus.map((f) => `<tr><td class="club izq">${esc(nom(f))}</td><td class="izq">${esc(f.club || '—')}${f.categoria ? ' · ' + esc(f.categoria) : ''}</td><td class="pts">${f.restantes}</td><td class="izq">${esc(f.motivo || '—')}</td></tr>`).join('')}</tbody></table></div></div>`
    : '<div class="vacio">No hay jugadores suspendidos.</div>';
  const tablaTar = conTarjetas.length
    ? `<div class="tarjeta"><div class="tabla-scroll"><table class="tabla"><caption class="solo-lectores">Tarjetas por jugador</caption>
        <thead><tr><th scope="col" class="izq">Jugador</th><th scope="col" class="izq">Equipo</th><th scope="col">Amarillas</th><th scope="col">Rojas</th></tr></thead>
        <tbody>${conTarjetas.map((f) => `<tr><td class="club izq">${esc(nom(f))}</td><td class="izq">${esc(f.club)} · ${esc(f.categoria)}</td><td class="pts">${f.amarillas}</td><td>${f.rojas}</td></tr>`).join('')}</tbody></table></div></div>
      ${umbral ? `<p class="pie-tabla">Cada ${umbral} amarillas acumuladas en el torneo suman 1 fecha de suspensión.</p>` : ''}`
    : '<div class="vacio">Todavía no hay tarjetas cargadas.</div>';
  const cuerpo = `<h1 class="titulo-seccion">Suspendidos</h1>${tablaSus}
    <h2 class="titulo-seccion" style="margin-top:32px;font-size:28px">Tarjetas</h2>${tablaTar}`;
  return { titulo: 'Suspendidos', html: marco(L, 'suspendidos', null, cuerpo) };
}

/* Institucional */
async function seccionInstitucional(L) {
  const [filas, docs] = await memo('inst:' + L.liga.id, async () => {
    const [a, b] = await Promise.all([
      sb.from('institucional').select('titulo,contenido,orden').eq('liga_id', L.liga.id).order('orden'),
      sb.from('documentos').select('tipo,archivo_url,nombre,subido_en').eq('liga_id', L.liga.id).order('subido_en', { ascending: false }),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    return [a.data, b.data];
  });
  const ultimo = (tipo) => docs.find((d) => d.tipo === tipo && urlSegura(d.archivo_url));
  const botonesDoc = [['buena_fe', 'Lista de Buena Fe'], ['fichajes', 'Fichajes']].map(([tipo, rotulo]) => {
    const d = ultimo(tipo);
    return d ? `<a class="btn" href="${esc(d.archivo_url)}" target="_blank" rel="noopener">${rotulo}<span class="solo-lectores"> (abre en una pestaña nueva)</span></a>` : '';
  }).join('');
  const tarjetaDocs = botonesDoc ? `<div class="tarjeta pad" style="margin-bottom:20px"><span class="dato-rotulo">Fichajes</span>
      <span class="dato-detalle">Descargá la documentación para fichar jugadores.</span><div class="acciones" style="margin-top:6px">${botonesDoc}</div></div>` : '';
  const conTexto = filas.filter((f) => String(f.contenido || '').trim());   // los bloques vacíos no se muestran
  const cuerpo = `<h1 class="titulo-seccion">Institucional</h1>${tarjetaDocs}` + (conTexto.length
    ? conTexto.map((f, i) => `<details class="acordeon"${i === 0 ? ' open' : ''}><summary>${esc(f.titulo)}</summary><div class="cuerpo">${esc(f.contenido)}</div></details>`).join('')
    : '<div class="vacio">Información institucional pendiente de carga.</div>');
  return { titulo: 'Institucional', html: marco(L, 'institucional', null, cuerpo) };
}

/* Copa Desafío: se carga a mano al terminar el torneo (semifinales y final).
   Mientras no haya partidos cargados, los duelos figuran "a confirmar". Ronda 1 = semifinal, ronda 2 = final. */
async function seccionCopa(L, cat) {
  const t = L.actual;
  if (!t || !cat) return sinTorneo(L, 'copa', 'Copa');
  const partidos = await cargarPartidos(t.id);
  const copa = partidos.filter((p) => p.categoria_id === cat.id && p.tipo === 'copa');

  const ganadorDe = (p) => {
    if (p.estado !== 'jugado') return null;
    if (p.goles_local > p.goles_visitante) return p.local?.clubes?.nombre;
    if (p.goles_local < p.goles_visitante) return p.visita?.clubes?.nombre;
    if (p.ajuste_ganador_equipo_id) return p.ajuste_ganador_equipo_id === p.local_equipo_id ? p.local?.clubes?.nombre : p.visita?.clubes?.nombre;
    return null;
  };
  const pendiente = (txt) => `<span style="color:var(--muted)">${txt}</span>`;
  const aConfirmar = () => `<div class="partido"><div class="partido-fila"><span class="eq l">${pendiente('A confirmar')}<span class="escudo g" aria-hidden="true">?</span></span>
      <span class="marcador pend">vs</span><span class="eq v"><span class="escudo g" aria-hidden="true">?</span>${pendiente('A confirmar')}</span></div></div>`;
  const filaCopa = (p, esFinal) => {
    const l = p.local?.clubes, v = p.visita?.clubes, jugado = p.estado === 'jugado';
    const gan = esFinal ? ganadorDe(p) : null;
    const penales = jugado && p.goles_local === p.goles_visitante && p.ajuste_ganador_equipo_id;
    const meta = [fmtFecha(p.fecha_hora), p.cancha].filter(Boolean).join(' · ');
    return `<div class="partido"><div class="partido-fila"><span class="eq l"><span>${esc(l?.nombre)}</span>${escudo(l)}</span>
        ${jugado ? `<span class="marcador">${p.goles_local}-${p.goles_visitante}</span>` : '<span class="marcador pend">vs</span>'}
        <span class="eq v">${escudo(v)}<span>${esc(v?.nombre)}</span></span></div>
        ${meta ? `<div class="partido-meta">${esc(meta)}</div>` : ''}
        ${penales && !esFinal ? `<div class="partido-aviso"><strong>Pasó por penales: ${esc(ganadorDe(p))}.</strong></div>` : ''}
        ${gan ? `<div class="partido-aviso" style="background:#E3F4EA;color:#0A5C38"><strong>Campeón de la Copa: ${esc(gan)}</strong>${penales ? ' (por penales)' : ''}</div>` : ''}
        ${p.nota ? `<div class="partido-aviso">${esc(p.nota)}</div>` : ''}</div>`;
  };
  const fase = (ronda, titulo, cantidad) => {
    const ps = copa.filter((p) => p.ronda === ronda).sort((a, b) => a.jornada - b.jornada);
    const cuerpo = ps.length ? ps.map((p) => filaCopa(p, ronda === 2)).join('') : Array.from({ length: cantidad }, aConfirmar).join('');
    return `<div class="tarjeta" style="margin-bottom:20px"><div class="tarjeta-titulo verde"><span>Copa · ${esc(cat.nombre)}</span><span>${titulo}</span></div>${cuerpo}</div>`;
  };

  const cuerpo = `<h1 class="titulo-seccion">Copa Desafío</h1><div class="controles">${selectorCategoria(L, 'copa', cat)}</div>
    ${copa.length ? '' : '<div class="aviso">Los cruces de la Copa Desafío se confirman una vez terminado el torneo.</div>'}
    ${fase(1, 'Semifinales', 2)}${fase(2, 'Final', 1)}`;
  return { titulo: 'Copa Desafío', html: marco(L, 'copa', cat, cuerpo) };
}

/* Otros campeonatos: todos los torneos en curso de la liga */
function seccionCampeonatos(L) {
  const base = '/' + encodeURIComponent(L.liga.slug);
  const cuerpo = `<h1 class="titulo-seccion">Otros campeonatos</h1>` + L.encurso.map((t) => {
    const cats = (t.categorias || []).slice().sort((a, b) => a.orden - b.orden).map((c) => `<span class="chip">${esc(c.nombre)}</span>`).join('');
    const actual = t.id === L.actual?.id;
    return `<a class="archivo-card" href="${base}?torneo=${encodeURIComponent(t.id)}" data-link><h3>${esc(String(t.nombre).includes(String(t.anio)) ? t.nombre : `${t.nombre} ${t.anio}`)}</h3>
      <div class="campeon-linea">${cats}</div><span class="entrar">${actual ? 'Estás viendo este torneo · ' : ''}Ver torneo →</span></a>`;
  }).join('');
  return { titulo: 'Otros campeonatos', html: marco(L, 'campeonatos', null, cuerpo) };
}

/* Archivo de torneos finalizados */
async function seccionArchivo(L, torneoId) {
  const lista = await memo('arch:' + L.liga.slug, async () => {
    const { data, error } = await sb.from('torneos_archivo').select('*').eq('liga_slug', L.liga.slug).order('cerrado_en', { ascending: false });
    if (error) throw error;
    return data;
  });
  const base = '/' + encodeURIComponent(L.liga.slug) + '/archivo';
  const det = torneoId ? lista.find((x) => x.torneo_id === torneoId) : null;

  if (det) {
    const res = det.resumen || {};
    const cats = (res.categorias || []).map((c) => `<section style="margin-bottom:28px">
        <h2 class="titulo-seccion">${esc(c.nombre)}</h2>
        ${c.campeon ? `<p class="campeon-linea"><span class="etiqueta lima">Campeón</span><strong>${esc(c.campeon.club)}</strong> con ${c.campeon.pts} puntos${c.empate_en_la_cima ? ' · <em>empate en la cima: definir por criterio de desempate</em>' : ''}</p>` : ''}
        ${c.copa ? `<p class="campeon-linea" style="margin-top:8px"><span class="etiqueta">Copa Desafío</span><span>Líder Ronda 1: <strong>${esc(c.copa.lider_ronda1 || '—')}</strong> · Líder Ronda 2: <strong>${esc(c.copa.lider_ronda2 || '—')}</strong>${c.copa.final ? ` · Final: ${esc(c.copa.final.local)} ${c.copa.final.goles_local ?? '-'}-${c.copa.final.goles_visitante ?? '-'} ${esc(c.copa.final.visitante)}${c.copa.final.por_penales ? ' (penales)' : ''}` : ''}${c.copa.campeon_copa ? ` · <strong>Campeón de la Copa: ${esc(c.copa.campeon_copa)}</strong>` : ''}</span></p>` : ''}
        ${htmlTabla(c.tabla || [], res.torneo?.reglas?.columnas_tabla)}
        <h3 style="font-family:var(--display);font-size:24px;text-transform:uppercase;margin:20px 0 10px">Goleadores</h3>
        ${htmlGoleadores((c.goleadores || []).map((g) => ({ jugador: g.jugador, club: g.club, goles: g.goles })))}</section>`).join('');
    const cuerpo = `<p><a href="${base}" data-link style="font-weight:600;color:var(--c1)">← Volver al archivo</a></p>
      <h1 class="titulo-seccion">${esc(det.nombre)} · ${det.anio}</h1>
      ${res.forzado && res.partidos_sin_jugar ? `<p class="aviso">Torneo cerrado con ${res.partidos_sin_jugar} partidos del calendario sin disputar (por ejemplo, fechas que no llegaron a jugarse). Las tablas y goleadores cuentan solo los partidos jugados.</p>` : ''}${cats}`;
    return { titulo: `${det.nombre}`, html: marco(L, 'archivo', null, cuerpo) };
  }

  const cuerpo = `<h1 class="titulo-seccion">Archivo</h1>` + (lista.length
    ? lista.map((x) => {
      const camp = (x.resumen?.categorias || []).filter((c) => c.campeon).map((c) => `<span class="chip verde">${esc(c.nombre)}: ${esc(c.campeon.club)}</span>`).join('');
      return `<a class="archivo-card" href="${base}/${x.torneo_id}" data-link><h3>${esc(x.nombre)} · ${x.anio}</h3>
        <div class="campeon-linea">${camp || '<span class="chip">Sin campeón definido</span>'}</div><span class="entrar">Ver resultados finales →</span></a>`;
    }).join('')
    : '<div class="vacio">Todavía no hay torneos finalizados.</div>');
  return { titulo: 'Archivo', html: marco(L, 'archivo', null, cuerpo) };
}

dibujar();
