const { load, search, rateLimit, clientIp } = require('./_lib');

module.exports = async (req, res) => {
  const rl = rateLimit('s:' + clientIp(req), { max: 120, windowMs: 60_000 });
  if (!rl.ok) return res.status(429).json({ error: 'Too many requests — slow down a little.' });

  const url = new URL(req.url, 'http://x');
  const p = Object.fromEntries(url.searchParams);
  const q = String(p.q || '').slice(0, 200);
  const limit = Math.min(500, Math.max(1, parseInt(p.limit || '200', 10) || 200));
  let rows;
  try { rows = await load(req); } catch (e) { console.error(e); return res.status(503).json({ error: 'Data temporarily unavailable.' }); }
  const out = search(rows, { q, category: p.category, conference: p.conference, yearFrom: p.from, yearTo: p.to, limit });

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(out);
};
