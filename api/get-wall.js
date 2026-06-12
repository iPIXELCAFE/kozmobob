/* ── /api/get-wall
   GET ?tier=9|33|66|99   (omit for all tiers)
   Returns { tiers: { 9: [...], 33: [...], 66: [...], 99: [...] } }
*/

const CORS = {
  'Access-Control-Allow-Origin':  'https://www.kozmobob.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const TIERS = [9, 33, 66, 99];

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) return res.status(200).json({ tiers: {} });

  async function kv(...args) {
    const r = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return (await r.json()).result;
  }

  try {
    const tiers = {};
    for (const t of TIERS) {
      const raw = await kv('LRANGE', '369:wall:' + t, 0, 49);
      tiers[t] = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    }
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ tiers });
  } catch (err) {
    console.error('get-wall error:', err);
    return res.status(200).json({ tiers: {} });
  }
};
