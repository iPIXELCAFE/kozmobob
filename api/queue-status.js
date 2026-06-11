/* ══════════════════════════════════════════════════════════════
   /api/queue-status — returns billboard queue count + wait time
   Reads from Upstash Redis key: billboard:queue (JSON array)
   Each entry: { deviceId, hours, priority, bookedAt }
   ══════════════════════════════════════════════════════════════ */

const CORS = {
  'Access-Control-Allow-Origin':  'https://www.kozmobob.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    if (!KV_URL || !KV_TOKEN) {
      return res.status(200).json({ count: 0, wait_hours: 0 });
    }

    /* Page-specific queue: ?page=369 for 369 inventory, default = oracle */
    const page     = (req.query?.page === '369') ? '369' : 'oracle';
    const queueKey = page === '369' ? 'billboard:queue:369' : 'billboard:queue';

    /* Fetch the queue list from Redis */
    const r = await fetch(`${KV_URL}/get/${queueKey}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await r.json();
    const raw  = data.result;

    let queue = [];
    if (raw) {
      try { queue = JSON.parse(raw); } catch(e) { queue = []; }
    }
    if (!Array.isArray(queue)) queue = [];

    /* Total hours already booked ahead (each entry has a .hours field) */
    const totalHours = queue.reduce((sum, entry) => sum + (entry.hours || 1), 0);

    return res.status(200).json({
      count:      queue.length,
      wait_hours: totalHours,
    });
  } catch (err) {
    console.error('queue-status error:', err);
    return res.status(200).json({ count: 0, wait_hours: 0 });
  }
};
