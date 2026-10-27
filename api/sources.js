// "Find other public sources" — server-side Claude + web search.
// The API key never leaves the server. Output: links + one-line notes, capped, labeled unverified.
const { load, capSnippet, rateLimit, clientIp } = require('./_lib');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const cache = new Map(); // per warm instance; swap for KV/Postgres for durability
const TTL = 30 * 24 * 3600 * 1000;
let dailyCount = 0, dayStamp = new Date().toISOString().slice(0, 10);
const DAILY_CAP = parseInt(process.env.SOURCES_DAILY_CAP || '300', 10);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'The source finder is not enabled on this deployment yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = parseInt(body && body.id, 10);
  let ROWS;
  try { ROWS = await load(req); } catch (e) { return res.status(503).json({ error: 'Data temporarily unavailable.' }); }
  const row = ROWS[id];
  if (!row) return res.status(400).json({ error: 'Unknown presentation id' });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return res.status(200).json({ ...hit.data, cached: true });

  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) { dayStamp = today; dailyCount = 0; }
  if (dailyCount >= DAILY_CAP) return res.status(429).json({ error: 'Daily lookup budget reached. Try again tomorrow.' });
  const rl = rateLimit('src:' + clientIp(req), { max: 6, windowMs: 10 * 60_000 });
  if (!rl.ok) return res.status(429).json({ error: 'Rate limit: max 6 lookups per 10 minutes.' });
  dailyCount++;

  const prompt = `Find publicly accessible versions or closely related public publications for this Space Resources Roundtable presentation:

Title: ${row.title}
Presenter(s): ${row.author}
Conference: ${row.conference} (${row.year})

Prefer: NASA Technical Reports Server (ntrs.nasa.gov), LPI/USRA abstracts (lpi.usra.edu, hou.usra.edu), arXiv, DOI landing pages, agency and university repositories, ResearchGate/Google Scholar pages only if nothing better.
Do not return the isruinfo.com page itself.
Return ONLY a JSON array (no prose) of up to 5 objects: {"title": string, "url": string, "note": one short sentence on how it relates (same work / earlier version / follow-up / same author, related topic)}.
If nothing credible is found, return [].`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('anthropic error', r.status, JSON.stringify(j).slice(0, 500));
      return res.status(502).json({ error: 'Upstream model error.' });
    }

    // Only accept URLs that the web search actually returned — no invented links.
    const seen = new Set();
    for (const b of j.content || []) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const x of b.content) if (x.url) seen.add(x.url.replace(/\/$/, ''));
      }
    }
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = text.match(/\[[\s\S]*\]/);
    let items = [];
    try { items = m ? JSON.parse(m[0]) : []; } catch { items = []; }
    const results = items
      .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url))
      .filter((x) => !/isruinfo\.com/i.test(x.url))
      .filter((x) => seen.has(x.url.replace(/\/$/, '')))
      .slice(0, 5)
      .map((x) => ({ title: capSnippet(x.title || x.url), url: x.url, note: capSnippet(x.note || '') }));

    const data = { id, results, verified: false, model: MODEL };
    cache.set(id, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    console.error('sources failure', e);
    return res.status(500).json({ error: 'Lookup failed.' });
  }
};
