// Build step: pull the public source sheet as CSV, normalize it, assign themes,
// and write data/index-data.json. Runs on Vercel before the site is served.
// Local test: node scripts/build-data.js path/to/sheet.csv
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.SHEET_ID || '1idzXPMbHx8XiOvvJSeNKJ8VGVogLLcVzhMhB-0Buu8A';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const MIN_ROWS = 900; // refuse to publish a truncated dataset

function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cleanText = (s) => clean(s).replace(/\\/g, '').replace(/"/g, '”');

const CATS = [
  ['Asteroids & Small Bodies', /asteroid|\bneas?\b|\bneos?\b|small bod|phobos|deimos|meteorit|carbonaceous|psyche|comet/i],
  ['Mars ISRU', /\bmars\b|martian|moxie/i],
  ['Policy, Law & Governance', /\blaws?\b|legal|policy|policies|treaty|governance|\brights?\b|regulat|property|accords|international coop|ethic|licens|jurisdic|\bact\b|partnership|consortium|public sector|private sector|workers|safety/i],
  ['Economics & Business', /econom|business|market|commerc|invest|financ|\bcosts?\b|profit|pric|venture|entrepreneur|capital|revenue|company|companies/i],
  ['Water & Volatiles', /water|\bice\b|icy|volatile|hydrogen|h2o|hydrat|permanently shadow|\bpsrs?\b|cold trap/i],
  ['Oxygen & Metal Extraction', /oxygen|reduction|electroly|molten|carbotherm|metal|\biron\b|alumin|titanium|silicon|extract|beneficiat|smelt|refin|chlorin|fluorin|ilmenite|pyroly|separation|reactor|processing|synthesis|combustion|co2|carbon dioxide|rwgs|sabatier|materials handling/i],
  ['Construction & Manufacturing', /construct|manufactur|\b3d\b|additive|print|sinter|brick|concrete|cement|habitat|landing pad|berm|\broads?\b|structur|fabricat|assembl|\bisam\b|glass|basalt|\bmelt|casting/i],
  ['Excavation & Mining Systems', /excavat|mining|\bminers?\b|drill|bucket|\bdig|rover|robot|trench|conveyor|pneumatic|haul|bulldoz|autonom|teleop|tunnel|boring|regolith handling/i],
  ['Prospecting & Resource Mapping', /prospect|explor|mapping|\bmaps?\b|survey|spectro|neutron|radar|remote sens|assay|detect|reconnaiss|characteriz|ground truth|geolog|mineral|resource estimat|reserve|seismic|topograph|camera|imag|illuminat|terrain|crater|sounding|resource assess/i],
  ['Energy & Power', /power|energy|solar|photovolta|nuclear|fission|thermal storage|batter|fuel cell|electric|helium-3|he-3|fusion/i],
  ['Propellant & Space Logistics', /propellant|depot|refuel|cislunar|logistic|transport|lander|launch|\btugs?\b|lagrange|orbit|delta-v|mass driver|tether/i],
  ['Simulants & Geotechnics', /simulant|jsc-?1|geotechn|regolith propert|\bdust|particle|trafficab|cohesion|bearing|\bsoils?\b|granular|compaction|abrasion|electrostatic|regolith|agglutinat|gravity|weathering|analog/i],
  ['Architecture & Strategy', /architect|strategy|roadmap|campaign|program|mission|\bplan|overview|vision|future|outpost|\bbases?\b|settlement|infrastructure|demonstrat|pathfind|artemis|\bnasa\b|\besa\b|jaxa|\bisru\b|industr|economy/i],
];
const NAMES = CATS.map((c) => c[0]).concat('General');
function categorize(title) {
  for (let i = 0; i < CATS.length; i++) {
    const [n, re] = CATS[i];
    if (re.test(title) && !(n === 'Mars ISRU' && /lunar|moon/i.test(title))) return i;
  }
  return CATS.length;
}
const PREFIX = { '~': 'https://isruinfo.com/public/docs/', '^': 'https://www.lpi.usra.edu/meetings/' };
function shortUrl(u) {
  let s = clean(u).replace(/\.zipp$/, '.zip');
  for (const [k, p] of Object.entries(PREFIX)) if (s.startsWith(p)) { s = k + s.slice(p.length); break; }
  return s.replace(/%20/g, ' ');
}

async function main() {
  let text;
  if (process.argv[2]) text = fs.readFileSync(process.argv[2], 'utf8');
  else {
    const r = await fetch(CSV_URL, { redirect: 'follow' });
    text = await r.text();
    if (!r.ok || /<html/i.test(text.slice(0, 500))) {
      throw new Error(`Could not fetch source sheet (HTTP ${r.status}). Is it shared as "Anyone with the link can view"?`);
    }
  }
  const table = parseCSV(text.replace(/^﻿/, ''));
  const confs = [], rows = [];
  for (const r of table.slice(1)) {
    const [a, author, title, url] = r;
    if (clean(a) && !clean(author)) {
      const h = clean(a);
      const y = h.match(/(\d{4})/), rn = h.match(/SRR\s*([IVX]+)/);
      if (!y || !rn) continue;
      confs.push([`SRR ${rn[1]}` + (/PTMSS/.test(h) ? ' / PTMSS' : ''), +y[1]]);
      continue;
    }
    if (!clean(author) && !clean(title)) continue;
    if (!confs.length) continue;
    const t = cleanText(title);
    rows.push([confs.length - 1, cleanText(author), t, shortUrl(url), categorize(t)]);
  }
  if (rows.length < MIN_ROWS) throw new Error(`Only ${rows.length} rows parsed — refusing to publish.`);
  const out = '{"prefix":' + JSON.stringify(PREFIX) + ',"cats":' + JSON.stringify(NAMES) + ',"confs":' + JSON.stringify(confs) +
    ',"rows":[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]}\n';
  const dest = path.join(__dirname, '..', 'data', 'index-data.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  console.log(`index-data.json: ${rows.length} presentations, ${confs.length} conferences`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
