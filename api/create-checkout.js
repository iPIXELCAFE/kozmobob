const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* Price map — all one-time purchases */
const PRICES = {
  'reading-weekly':   { amount: 199,   name: 'Weekly Reading' },
  'reading-monthly':  { amount: 499,   name: 'Monthly Reading' },
  'reading-yearly':   { amount: 2499,  name: 'Yearly Reading' },
  'tarot-deep':       { amount: 99,    name: 'Tarot Deep Read' },
  'personal-message': { amount: 1999,  name: 'Personal Billboard Message' },
  'billboard-community': { amountPerHour: 5500,  name: 'Community Billboard' },
  'billboard-premium':   { amountPerHour: 25000, name: 'Premium Billboard' },
  'starmap':          { amount: 999,   name: 'Star Map' },
  'baby-star':        { amount: 99,    name: 'Baby Star in the Sky' },
};

const ALLOWED_ORIGINS = ['https://kozmobob.com', 'https://www.kozmobob.com', 'https://kosmobob.com', 'https://www.kosmobob.com'];

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { product, metadata = {} } = req.body || {};

  const price = PRICES[product];
  if (!price) return res.status(400).json({ error: 'Unknown product: ' + product });

  /* Dynamic billboard pricing: $55/hr community, $250/hr premium, +$9.99 priority */
  let unitAmount  = price.amount;
  let productName = price.name;
  if (price.amountPerHour) {
    const hours    = Math.min(24, Math.max(1, parseInt(metadata.hours, 10) || 1));
    const priority = metadata.priority === 1 || metadata.priority === '1';
    unitAmount  = price.amountPerHour * hours + (priority ? 999 : 0);
    productName = price.name + ' · ' + hours + (hours === 1 ? ' hour' : ' hours') + (priority ? ' + Priority Jump' : '');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: u
