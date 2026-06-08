/* ── KozmoBob — Save Reading to Vercel KV ──
   POST /api/save-reading
   Body: { deviceId, sign, mode, lines[], timestamp }
   Env:  KV_REST_API_URL, KV_REST_API_TOKEN
*/

const MAX_READINGS   = 50;
const RATE_LIMIT_MAX = 20;  /* max saves per device per hour */

const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
];

async function kv(url, token, ...args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

async function isRateLimited(url, token, deviceId) {
  try {
    const key   = `ratelimit:save:${deviceId}`;
    const count = await kv(url, token, 'INCR', key);
    if (count === 1) await kv(url, token, 'EXPIRE', key, 3600); /* 1hr window */
    return count > RATE_LIMIT_MAX;
  } catch(e) { return false; } /* fail open — don't block if Redis hiccups */
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV not configured' });

  const { deviceId, sign, mode, lines, timestamp } = req.body || {};
  if (!deviceId || !lines?.length) return res.status(400).json({ error: 'Missing fields' });

  /* Sanitize deviceId — alphanumeric + hyphens only */
  const cleanDeviceId = String(deviceId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  if (!cleanDeviceId) return res.status(400).json({ error: 'Invalid deviceId' });

  if (await isRateLimited(url, token, cleanDeviceId))
    return res.status(429).json({ error: 'Too many requests' });

  const key = `readings:${cleanDeviceId}`;

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
