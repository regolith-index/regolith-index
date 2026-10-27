// Contact / takedown form relay. The recipient address lives only in the
// CONTACT_EMAIL env var and is never sent to the browser. Delivery via FormSubmit.
const { rateLimit, clientIp } = require('./_lib');

const clip = (v, n) => String(v || '').replace(/\r/g, '').trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const to = process.env.CONTACT_EMAIL;
  if (!to) return res.status(503).json({ error: 'The contact form is not configured yet.' });

  const rl = rateLimit('c:' + clientIp(req), { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return res.status(429).json({ error: 'Too many messages — please try again later.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot: silently drop bots

  const name = clip(b.name, 120), email = clip(b.email, 200), message = clip(b.message, 4000);
  const topic = ['Correction', 'Removal request', 'Copyright / takedown', 'Other'].includes(b.topic) ? b.topic : 'Other';
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please fill in name, a valid email and a message.' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'regolith-index.vercel.app';
  try {
    const r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://' + host, Referer: 'https://' + host + '/' },
      body: JSON.stringify({ name, email, topic, message, _subject: `[Regolith Index] ${topic} — ${name}`, _replyto: email, _template: 'table', _captcha: 'false' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) === 'false') {
      console.error('formsubmit', r.status, j);
      return res.status(502).json({ error: 'Sending failed. Please try again later.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Sending failed. Please try again later.' });
  }
};
