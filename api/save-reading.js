var MAX_READINGS = 50;
var RATE_LIMIT_MAX = 20;
var ALLOWED_ORIGINS = [
  'https://kozmobob.com','https://www.kozmobob.com',
  'https://kosmobob.com','https://www.kosmobob.com',
];

async function upstash(url, token, command, args) {
  var r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify([[command].concat(args)]),
  });
  var txt = await r.text();
  console.log('upstash', command, r.status, txt.slice(0, 200));
  if (!r.ok) throw new Error('Upstash ' + command + ' failed: ' + r.status + ' ' + txt);
  var data = JSON.parse(txt);
  return data[0] && data[0].result;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  var url   = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  var body = req.body || {};
  var deviceId = body.deviceId, sign = body.sign, mode = body.mode;
  var lines = body.lines, timestamp = body.timestamp;

  if (!deviceId || !lines || !lines.length)
    return res.status(400).json({ error: 'Missing fields' });

  var cleanId = String(deviceId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  if (!cleanId) return res.status(400).json({ error: 'Invalid deviceId' });

  console.log('save-reading deviceId=' + cleanId + ' lines=' + lines.length);

  var key = 'rdg:' + cleanId;
  try {
    var id    = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    var entry = JSON.stringify({ id: id, sign: sign, mode: mode, lines: lines, timestamp: timestamp || Date.now() });

    var pushed = await upstash(url, token, 'LPUSH', [key, entry]);
    console.log('LPUSH result:', pushed);
    await upstash(url, token, 'LTRIM', [key, 0, MAX_READINGS - 1]);

    return res.status(200).json({ ok: true, count: pushed });
  } catch(err) {
    console.error('save-reading ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
