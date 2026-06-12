/* ── KozmoBob — Get Readings from Vercel KV ──
   GET /api/get-readings?deviceId=xxx
   Env: KV_REST_API_URL, KV_REST_API_TOKEN
*/

const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
  'https://kosmobob.com',
  'https://www.kosmobob.com',
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

  /* Sanitize deviceId */
  const cleanDeviceId = String(deviceId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  if (!cleanDeviceId) return res.status(400).json({ error: 'Invalid deviceId' });

  const key = `readings:${cleanDeviceId}`;

  try {
    const r = await fetch(`${url}/lrange/${key}/0/-1`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      const text = await r.text();
      console.error('KV error:', r.status, text);
      return res.status(500).json({ error: 'KV fetch failed' });
    }

    const data = await r.json();
    const items = (data.result || []).map(item => {
      try { return JSON.parse(item); } catch(e) { return null; }
    }).filter(Boolean);

    return res.status(200).json({ readings: items });
  } catch (err) {
    console.error('get-readings error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
};
