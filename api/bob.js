/* ── KozmoBob AI — Vercel Serverless Function ──
   Route: POST /api/bob
   Env:   GROQ_API_KEY  (set in Vercel dashboard → Settings → Environment Variables)
   Free:  Groq free tier — no credit card, 14,400 req/day
*/

/* ── Rate limiting (in-memory, resets on cold start) ── */
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX    = 10;         // max requests per IP per window
const ipMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) {
    // window expired — reset
    ipMap.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count++;
  ipMap.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

/* ── Allowed origins ── */
const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
];

module.exports = async function handler(req, res) {
  /* CORS — only allow our own domain */
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // direct server-to-server or same-origin — allow
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  /* Preflight */
  if (req.method === 'OPTIONS') return res.status(204).end();

  /* Only allow POST */
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* Rate limit by IP */
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Slow down.', fallback: true });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  const { question = '', sign = 'gemini', mode = 'oracle' } = req.body || {};

  /* Input validation */
  const VALID_SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  const VALID_MODES = ['oracle','tarot','horoscope'];
  const cleanSign   = VALID_SIGNS.includes((sign||'').toLowerCase()) ? sign.toLowerCase() : 'gemini';
  const cleanMode   = VALID_MODES.includes((mode||'').toLowerCase()) ? mode.toLowerCase() : 'oracle';
  const cleanQ      = String(question).slice(0, 500); // cap at 500 chars

  /* ── System prompt — Bob's voice and rules ── */
  const SIGN_CONTEXT = {
    aries:'ruled by Mars, fire sign, bold and impulsive',
    taurus:'ruled by Venus, earth sign, grounded and sensual',
    gemini:'ruled by Mercury, air sign, dual-natured and quick',
    cancer:'ruled by the Moon, water sign, intuitive and protective',
    leo:'ruled by the Sun, fire sign, magnetic and proud',
    virgo:'ruled by Mercury, earth sign, precise and analytical',
    libra:'ruled by Venus, air sign, balanced and beauty-seeking',
    scorpio:'ruled by Pluto, water sign, intense and transformative',
    sagittarius:'ruled by Jupiter, fire sign, adventurous and honest',
    capricorn:'ruled by Saturn, earth sign, disciplined and ambitious',
    aquarius:'ruled by Uranus, air sign, visionary and unconventional',
    pisces:'ruled by Neptune, water sign, dreamy and empathetic',
  };

  const signContext = SIGN_CONTEXT[cleanSign] || '';

  const systemPrompt = cleanMode === 'tarot'
    ? `You are KozmoBob — a brutally honest, deeply perceptive mystical oracle. You see what others miss.
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Not shorter. Make them land.
- Sound like a psychic who actually knows — not a horoscope. Be SPECIFIC to what they asked.
- Speak directly to the person. Use "you" not "one".
- No astrology clichés. No "the universe", no "energy", no "manifest".
- The final line must be so specific and true it feels personal. Make them feel seen.
- Never start two consecutive lines with the same word.`
  : cleanMode === 'horoscope'
    ? `You are KozmoBob — a brutally honest daily oracle for ${cleanSign} (${signContext}).
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Make every word count.
- This is their horoscope for TODAY. Make it feel urgent and current.
- Speak to what a ${cleanSign} is likely feeling and facing RIGHT NOW in their life.
- No generic astrology. No "the stars say". No "energy". No "manifest".
- NEVER invent specific details — no fake places, people, or events. Stay psychological and emotional.
- The final line must feel like Bob knows their secret. Make it land hard.
- Never start two consecutive lines with the same word.`
    : `You are KozmoBob — a brutally honest, deeply perceptive oracle. The person asking is ${cleanSign} (${signContext}).
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Not shorter. Make them land.
- If the question is factual (history, geography, science, math, news) — do NOT answer it. Instead say something like "I read people, not books. Ask me something about you." and redirect to their inner life.
- Respond DIRECTLY to what they asked. Not generic advice — speak to their specific situation.
- Sound like you already know their life. You are revealing, not guessing.
- NEVER invent specific details — no fake places, no fake people, no fake events. Stay psychological and emotional.
- No astrology clichés. No "the universe", no "energy", no "manifest", no "journey".
- Use their sign's traits subtly — never name the sign.
- The final line must gut-punch them with truth they already know but haven't said out loud.
- Never start two consecutive lines with the same word.`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: cleanQ || 'What does the universe want me to know right now?' },
        ],
        max_tokens: 180,
        temperature: 0.92,
        top_p: 0.95,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'AI unavailable', fallback: true });
    }

    const data = await groqRes.json();
    const raw  = data.choices?.[0]?.message?.content || '';

    /* Split into lines, clean up, ensure 4 non-empty lines */
    const lines = raw
      .split('\n')
      .map(l => l.replace(/^[\d\.\-\*]+\s*/, '').trim())
      .filter(l => l.length > 0)
      .slice(0, 5);

    if (!lines.length) {
      return res.status(502).json({ error: 'Empty response', fallback: true });
    }

    return res.status(200).json({ lines });

  } catch (err) {
    console.error('Bob API error:', err);
    return res.status(502).json({ error: 'Network error', fallback: true });
  }
}
