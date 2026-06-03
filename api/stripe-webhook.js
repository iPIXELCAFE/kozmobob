const Stripe = require('stripe');
const { Redis } = require('@upstash/redis');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

/* Disable Vercel's default body parsing — Stripe needs raw body for sig verification */
module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { product, ...meta } = session.metadata || {};

    try {
      await handlePurchase(product, meta, session);
    } catch (err) {
      console.error('handlePurchase error:', err);
      return res.status(500).json({ error: 'Failed to process purchase' });
    }
  }

  res.status(200).json({ received: true });
};

async function handlePurchase(product, meta, session) {
  const sessionId = session.id;
  const now = Date.now();

  switch (product) {
    case 'reading-weekly':
    case 'reading-monthly':
    case 'reading-yearly': {
      /* Grant access token for this reading mode, keyed by Stripe session ID */
      const mode = product.replace('reading-', '');
      await redis.set(`paid:${sessionId}`, JSON.stringify({ mode, grantedAt: now }), { ex: 86400 }); /* 24hr window */
      break;
    }

    case 'tarot-deep': {
      await redis.set(`paid:${sessionId}`, JSON.stringify({ mode: 'tarot-deep', grantedAt: now }), { ex: 86400 });
      break;
    }

    case 'personal-message': {
      /* Store message in KV — live for 1 hour, permanent star entry */
      const { message, emoji, deviceId, url } = meta;
      const msgData = { message, emoji, deviceId, url, paidAt: now, sessionId };

      /* Live billboard slot — expires in 1 hour */
      await redis.set('billboard:live', JSON.stringify(msgData), { ex: 3600 });

      /* Permanent stars page entry */
      await redis.lpush('stars:messages', JSON.stringify({ ...msgData, type: 'personal' }));
      break;
    }

    case 'billboard-community':
    case 'billboard-premium': {
      const { message, emoji, deviceId, url, hours = 1 } = meta;
      const type = product === 'billboard-premium' ? 'premium' : 'community';
      const msgData = { message, emoji, deviceId, url, type, paidAt: now, sessionId };

      await redis.set(`billboard:${type}:live`, JSON.stringify(msgData), { ex: parseInt(hours) * 3600 });

      /* Also log to stars */
      await redis.lpush('stars:messages', JSON.stringify({ ...msgData }));
      break;
    }

    case 'starmap': {
      await redis.set(`paid:${sessionId}`, JSON.stringify({ mode: 'starmap', grantedAt: now }), { ex: 86400 });
      break;
    }

    case 'baby-star': {
      const { name, message, gender, px, py, pz } = meta;
      /* Load existing stars, append new one, save back */
      const existing = await redis.get('baby:stars');
      const stars = existing ? JSON.parse(existing) : [];
      stars.push({
        name: name || '',
        message: message || '',
        gender: gender || 'neutral',
        px: parseFloat(px) || 0,
        py: parseFloat(py) || 0.5,
        pz: parseFloat(pz) || 0,
        addedAt: now,
        sessionId,
      });
      await redis.set('baby:stars', JSON.stringify(stars));
      break;
    }

    default:
      console.warn('Unknown product in webhook:', product);
  }
}
