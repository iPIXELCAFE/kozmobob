/* ── KozmoBob — Get Readings from Vercel KV ──
   GET /api/get-readings?deviceId=xxx
   Env: KV_REST_API_URL, KV_REST_API_TOKEN
*/

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin?.includes('kozmobob.com') ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

  const key = `readings:${deviceId}`;

  try {
    const res2 = await fetch(`${url}`, {
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
