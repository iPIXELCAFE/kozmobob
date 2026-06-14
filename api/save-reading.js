/* -- KozmoBob -- Save Reading to Vercel KV --
   POST /api/save-reading
   Body: { deviceId, sign, mode, lines[], timestamp }
   Env:  KV_REST_API_URL, KV_REST_API_TOKEN
*/

const MAX_READINGS   = 50;
const RATE_LIMIT_MAX = 20;

const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
  'https://kosmobob.com',
  'https://www.kosmobob.com',
];

/* POST to /<COMMAND> with body [arg1, arg2, ...] -- Upstash REST format */
async function kv(url, token, command) {
  var args = Array.prototype.slice.call(arguments, 3);
  var res = await fetch(url + '/' + command, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  var data = await res.json();
  return data.result;
}

async function isRateLimited(url, token, deviceId) {
  try {
    var key = 'ratelimit:save:' + deviceId;
    var count = await kv(url, token, 'INCR', key);
    if (count === 1) { await kv(url, token, 'EXPIRE', key, 3600); }
    return count > RATE_LIMIT_MAX;
  } catch(e) { return false; }
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(204).end(); }
  if (req.method !== 'POST') { return res.status(405).end(); }

  var url   = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) { return res.status(500).json({ error: 'KV not configured' }); }

  var body = req.body || {};
  var deviceId  = body.deviceId;
  var sign      = body.sign;
  var mode      = body.mode;
  var lines     = body.lines;
  var timestamp = body.timestamp;

  if (!deviceId || !lines || !lines.length) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  var cleanDeviceId = String(deviceId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  if (!cleanDeviceId) { return res.status(400).json({ error: 'Invalid deviceId' }); }

  if (await isRateLimited(url, token, cleanDeviceId)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  var key = 'readings:' + cleanDeviceId;

  try {
    var id    = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    var entry = JSON.stringify({ id: id, sign: sign, mode: mode, lines: lines, timestamp: timestamp || Date.now() });

    await kv(url, token, 'LPUSH', key, entry);
    await kv(url, token, 'LTRIM', key, 0, MAX_READINGS - 1);

    return res.status(200).json({ ok: true });
  } catch(err) {
    console.error('save-reading error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
};
