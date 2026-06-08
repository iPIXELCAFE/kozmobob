/* ── KozmoBob — Get Readings from Vercel KV ──
   GET /api/get-readings?deviceId=xxx
   Env: KV_REST_API_URL, KV_REST_API_TOKEN
*/

const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
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
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
    });
    const data = await res2.json();
    const readings = data.result ? JSON.parse(data.result) : [];
    return res.status(200).json({ readings });
  } catch(e) {
    return res.status(500).json({ error: 'KV error', readings: [] });
  }
};
