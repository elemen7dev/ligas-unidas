// Devuelve index.html con el título, la descripción y la vista previa (Open Graph) de cada liga.
// Sirve para que WhatsApp, Google y las redes muestren el nombre de la liga al compartir un enlace
// (esos servicios no ejecutan el JavaScript del sitio). Si algo falla, se entrega el index.html común.
const fs = require('fs');
const path = require('path');

const SB = 'https://ccmkohhgcjzimakqsznl.supabase.co';
const KEY = 'sb_publishable_zAd2niHJcyHdeXwutYBHmA_UROmvtKF';   // clave pública (la misma de config.js)
const ORIGEN = 'https://ligasunidas.vercel.app';
const RESERVADOS = ['panel', 'ligas', 'api', 'admin', 'login', 'auth', 'static', 'assets'];
const SECCIONES = { fixture: 'Fixture', posiciones: 'Posiciones', copa: 'Copa', goleadores: 'Goleadores', suspendidos: 'Suspendidos', archivo: 'Archivo', institucional: 'Institucional' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function leerHtml(req) {
  try { return fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); } catch (e) { /* se prueba por red */ }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const r = await fetch(`https://${host}/index.html`);
  if (!r.ok) throw new Error('index.html no disponible');
  return r.text();
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = String(q.slug || '');
  const seccion = String(q.seccion || '');
  const extra = String(q.extra || '');

  let html;
  try { html = await leerHtml(req); } catch (e) { res.statusCode = 500; res.end('Error'); return; }

  let status = 200;
  let titulo = null;
  let descripcion = null;
  const ruta = '/' + [slug, seccion, extra].filter(Boolean).join('/');

  if (slug === 'panel') {
    html = html.replace('</head>', () => '<meta name="robots" content="noindex, nofollow">\n</head>');
  } else if (slug && !RESERVADOS.includes(slug) && /^[a-z0-9-]{1,60}$/.test(slug)) {
    try {
      const r = await fetch(`${SB}/rest/v1/ligas?select=nombre,zona&slug=eq.${encodeURIComponent(slug)}`, { headers: { apikey: KEY, Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]) {
          const { nombre, zona } = d[0];
          const sec = SECCIONES[seccion];
          titulo = `${sec ? sec + ' · ' : ''}${nombre} · Ligas Unidas`;
          descripcion = `${sec || 'Resultados'} de ${nombre}${zona ? ' (' + zona + ')' : ''}: resultados, tablas de posiciones, goleadores y fixture, actualizados después de cada fecha.`;
        } else {
          status = 404;   // la liga no existe o no está publicada
        }
      }
    } catch (e) { /* sin datos: queda la versión común */ }
  }

  if (titulo) {
    html = html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(titulo)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(descripcion)}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${esc(titulo)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, () => `<meta property="og:description" content="${esc(descripcion)}">`);
  }
  if (slug !== 'panel') {
    const canonica = ORIGEN + (ruta === '/' ? '' : ruta);
    html = html.replace('</head>', () => `<link rel="canonical" href="${esc(canonica)}">\n<meta property="og:url" content="${esc(canonica)}">\n</head>`);
  }

  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  res.end(html);
};
