/* ── /api/complete-tier
   POST { deviceId, name, tier }   tier = 9 | 33 | 66 | 99
   Saves completer to Redis list: 369:wall:{tier}
   Each entry: { name, completedAt, tier }
   Max 200 per tier (LTRIM)
*/

const CORS = {
  'Access-Control-Allow-Origin':  'https://www.kozmobob.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const VALID_TIERS = [9, 33, 66, 99];
const MAX_PER_TIER = 200;

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { deviceId, name, tier } = req.body || {};
  if (!deviceId || !VALID_TIERS.includes(Number(tier))) {
    return res.status(400).json({ error: 'invalid params' });
  }

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: 'no kv' });

  async function kv(...args) {
    const r = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return (await r.json()).result;
  }

  try {
    const key = '369:wall:' + tier;
    const entry = JSON.stringify({
      name: (name || 'ANONYMOUS').toUpperCase().slice(0, 30),
      completedAt: new Date().toISOString(),
      tier: Number(tier),
    });
    /* prepend so newest is first */
    await kv('LPUSH', key, entry);
    await kv('LTRIM', key, 0, MAX_PER_TIER - 1);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('complete-tier error:', err);
    return res.status(500).json({ error: 'server error' });
  }
};
