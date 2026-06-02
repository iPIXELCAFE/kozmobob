/* ── KozmoBob — Save Reading to Vercel KV ──
   POST /api/save-reading
   Body: { deviceId, sign, mode, lines[], timestamp }
   Env:  KV_REST_API_URL, KV_REST_API_TOKEN  (auto-added when you connect KV in Vercel dashboard)
*/

const MAX_READINGS = 50; /* max saved per device */

async function kv(url, token, ...args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin?.includes('kozmobob.com') ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  const { deviceId, sign, mode, lines, timestamp } = req.body || {};
  if (!deviceId || !lines?.length) return res.status(400).json({ error: 'Missing fields' });

  const key = `readings:${deviceId}`;

  /* Fetch existing readings */
  let readings = [];
  try {
    const raw = await kv(url, token, 'GET', key);
    if (raw) readings = JSON.parse(raw);
  } catch(e) { readings = []; }

  /* Prepend new reading, cap at MAX */
  const entry = {
    id:        Date.now().toString(36),
    timestamp: timestamp || Date.now(),
    sign:      String(sign || 'unknown').slice(0, 30),
    mode:      String(mode || 'oracle').slice(0, 20),
    lines:     (lines || []).map(l => String(l).slice(0, 600)).slice(0, 60),
  };
  readings.unshift(entry);
  if (readings.length > MAX_READINGS) readings = readings.slice(0, MAX_READINGS);

  /* Save back — 90 day TTL */
  await kv(url, token, 'SET', key, JSON.stringify(readings), 'EX', 60 * 60 * 24 * 90);

  return res.status(200).json({ ok: true, id: entry.id });
};
