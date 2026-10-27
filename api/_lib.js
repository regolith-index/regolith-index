// Shared server-side helpers. Files prefixed with "_" are not exposed as routes.
// Data is produced by the build step (scripts/build-data.js) and served as a static
// file; functions load it once per warm instance from the deployment itself.
let RAW = null, ROWS = null, loading = null;

// ---- Compliance: the ONE function that caps any text leaving the server. ----
// Every code path that emits extracted/source text must go through this.
const SNIPPET_MAX_CHARS = 300;
function capSnippet(text) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  // at most 2 sentences
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [clean];
  let out = sentences.slice(0, 2).join('').trim();
  if (out.length > SNIPPET_MAX_CHARS) out = out.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd() + '…';
  return out;
}

function expandUrl(u) {
  if (!u) return '';
  const p = { '~': 'https://isruinfo.com/public/docs/', '^': 'https://www.lpi.usra.edu/meetings/' }[u[0]];
  const full = p ? p + u.slice(1) : u;
  return encodeURI(full).replace(/%25([0-9A-F]{2})/gi, '%$1');
}

async function load(req) {
  if (ROWS) return ROWS;
  if (!loading) {
    loading = (async () => {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
      const r = await fetch(`${proto}://${host}/data/index-data.json`);
      if (!r.ok) throw new Error('data fetch failed: ' + r.status);
      RAW = await r.json();
      ROWS = RAW.rows.map((row, i) => {
        const [ci, author, title, url, cat] = row;
        const [conference, year] = RAW.confs[ci];
        return { id: i, conference, year, author, title, url: expandUrl(url), category: RAW.cats[cat] };
      });
      return ROWS;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Domain synonym groups — terminology in this field drifts a lot across 25 years.
const SYN_GROUPS = [
  ['moon', 'lunar', 'selene'],
  ['solar', 'photovoltaic', 'pv', 'sunlight'],
  ['water', 'ice', 'h2o', 'volatile', 'volatiles', 'hydrogen'],
  ['oxygen', 'o2', 'oxide'],
  ['asteroid', 'asteroids', 'nea', 'neo', 'small body', 'small bodies'],
  ['mars', 'martian'],
  ['mining', 'excavation', 'excavator', 'dig', 'digging', 'miner'],
  ['construction', 'building', 'infrastructure', 'additive', '3d printing', 'sintering'],
  ['economics', 'economic', 'business', 'commercial', 'market', 'cost'],
  ['law', 'legal', 'policy', 'governance', 'treaty', 'rights'],
  ['propellant', 'fuel', 'depot', 'refueling'],
  ['power', 'energy', 'electricity'],
  ['prospecting', 'exploration', 'survey', 'mapping'],
  ['isru', 'in-situ', 'in situ', 'resource utilization'],
  ['metal', 'metals', 'iron', 'aluminum', 'titanium'],
  ['robot', 'robotic', 'robotics', 'rover', 'autonomous'],
];
const SYN = new Map();
for (const g of SYN_GROUPS) for (const t of g) SYN.set(t, g);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termVariants(term) {
  const g = SYN.get(term) || [term];
  const all = new Set([term, ...g]);
  if (term.length > 3 && term.endsWith('s')) all.add(term.slice(0, -1));
  return [...all];
}

function search(ROWS, { q = '', category, conference, yearFrom, yearTo, limit = 200 }) {
  const qn = norm(q).trim();
  const terms = qn ? qn.split(/[^a-z0-9\-]+/).filter((t) => t.length > 1).slice(0, 8) : [];
  const mk = (v) => new RegExp('(^|[^a-z0-9])' + escapeRe(v), 'i');
  const groups = terms.map((t) => ({ exact: mk(t), vs: termVariants(t).map(mk) }));

  let pool = ROWS;
  if (category) pool = pool.filter((r) => r.category === category);
  if (conference) pool = pool.filter((r) => r.conference === conference);
  if (yearFrom) pool = pool.filter((r) => r.year >= +yearFrom);
  if (yearTo) pool = pool.filter((r) => r.year <= +yearTo);

  if (!terms.length) {
    return { mode: 'browse', total: pool.length, results: pool.slice(0, limit), expanded: [] };
  }

  const scoreRow = (r) => {
    const t = norm(r.title), a = norm(r.author), meta = norm(r.category + ' ' + r.conference);
    let matched = 0, score = 0;
    groups.forEach(({ exact, vs }) => {
      let hit = false;
      if (exact.test(t)) { score += 3; hit = true; }
      else if (vs.some((re) => re.test(t))) { score += 2; hit = true; }
      if (vs.some((re) => re.test(a))) { score += 3; hit = true; }
      if (!hit && vs.some((re) => re.test(meta))) { score += 1; hit = true; }
      if (hit) matched++;
    });
    return { matched, score };
  };

  const scored = pool.map((r) => ({ r, ...scoreRow(r) })).filter((x) => x.matched > 0);
  const full = scored.filter((x) => x.matched === groups.length);
  let mode = 'all-terms', chosen = full;
  if (!full.length) { mode = 'partial'; chosen = scored; }
  chosen.sort((a, b) => b.matched - a.matched || b.score - a.score || b.r.year - a.r.year);
  return {
    mode,
    total: chosen.length,
    expanded: terms.map((t) => ({ term: t, variants: termVariants(t) })),
    results: chosen.slice(0, limit).map((x) => ({ ...x.r, partial: x.matched < groups.length })),
  };
}

// ---- Best-effort per-IP rate limiter (per warm instance). ----
// For hard guarantees across instances, back this with Upstash/Vercel KV.
const buckets = new Map();
function rateLimit(ip, { max, windowMs }) {
  const now = Date.now();
  const b = buckets.get(ip) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  return { ok: b.n <= max, remaining: Math.max(0, max - b.n), reset: b.reset };
}
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

module.exports = { load, search, capSnippet, rateLimit, clientIp, SNIPPET_MAX_CHARS };
