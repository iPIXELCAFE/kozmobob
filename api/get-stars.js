/* KozmoBob - Get Baby Stars from Upstash Redis */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(200).json({ stars: [] });

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', 'baby:stars']),
    });
    const data = await r.json();
    const stars = data.result ? JSON.parse(data.result) : [];
    return res.status(200).json({ stars });
  } catch(e) {
    return res.status(200).json({ stars: [] });
  }
};
