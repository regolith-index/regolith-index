const { load } = require('./_lib');
module.exports = async (req, res) => {
  let n = 0, ok = true;
  try { n = (await load(req)).length; } catch { ok = false; }
  res.status(ok ? 200 : 503).json({ ok, presentations: n, sourceFinder: Boolean(process.env.ANTHROPIC_API_KEY) });
};
