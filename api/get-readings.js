var ALLOWED_ORIGINS = [
  'https://kozmobob.com','https://www.kozmobob.com',
  'https://kosmobob.com','https://www.kosmobob.com',
];

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  var url   = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  var deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

  var cleanId = String(deviceId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  if (!cleanId) return res.status(400).json({ error: 'Invalid deviceId' });

  var key = 'rdg:' + cleanId;
  console.log('get-readings key=' + key);

  try {
    var r = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LRANGE', key, 0, -1]]),
    });
    var txt = await r.text();
    console.log('get-readings upstash status=' + r.status + ' body=' + txt.slice(0, 300));
    if (!r.ok) return res.status(500).json({ error: 'KV error: ' + r.status });

    var data   = JSON.parse(txt);
    var raw    = (data[0] && data[0].result) || [];
    var items  = raw.map(function(x) { try { return JSON.parse(x); } catch(e) { return null; } }).filter(Boolean);

    console.log('get-readings found ' + items.length + ' items');
    return res.status(200).json({ readings: items });
  } catch(err) {
    console.error('get-readings ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
