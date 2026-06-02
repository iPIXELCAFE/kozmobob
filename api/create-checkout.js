const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* Price map — all one-time purchases */
const PRICES = {
  'reading-weekly':   { amount: 199,   name: 'Weekly Reading' },
  'reading-monthly':  { amount: 499,   name: 'Monthly Reading' },
  'reading-yearly':   { amount: 999,   name: 'Yearly Reading' },
  'tarot-deep':       { amount: 99,    name: 'Tarot Deep Read' },
  'personal-message': { amount: 1999,  name: 'Personal Billboard Message' },
  'billboard-community': { amount: 5500,  name: 'Community Billboard (1hr)' },
  'billboard-premium':   { amount: 25000, name: 'Premium Billboard (1hr)' },
  'starmap':          { amount: 999,   name: 'Star Map' },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://kozmobob.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { product, metadata = {} } = req.body || {};

  const price = PRICES[product];
  if (!price) return res.status(400).json({ error: 'Unknown product: ' + product });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: price.amount,
          product_data: { name: price.name },
        },
        quantity: 1,
      }],
      metadata: { product, ...metadata },
      success_url: `https://kozmobob.com/?payment=success&product=${product}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `https://kozmobob.com/?payment=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
