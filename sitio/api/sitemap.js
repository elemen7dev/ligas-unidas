// sitemap.xml con las ligas publicadas (la lista sale de la base, así que se actualiza sola).
const SB = 'https://ccmkohhgcjzimakqsznl.supabase.co';
const KEY = 'sb_publishable_zAd2niHJcyHdeXwutYBHmA_UROmvtKF';
const ORIGEN = 'https://ligasunidas.vercel.app';

module.exports = async (req, res) => {
  const urls = [ORIGEN + '/'];
  try {
    const r = await fetch(`${SB}/rest/v1/ligas?select=slug&estado=eq.publicada&order=slug`, { headers: { apikey: KEY, Accept: 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      for (const l of d) {
        if (!/^[a-z0-9-]{1,60}$/.test(l.slug)) continue;
        for (const s of ['', '/fixture', '/posiciones', '/goleadores']) urls.push(`${ORIGEN}/${l.slug}${s}`);
      }
    }
  } catch (e) { /* queda solo la portada */ }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + '\n</urlset>\n';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.end(xml);
};
