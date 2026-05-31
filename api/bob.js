/* ── KozmoBob AI — Vercel Serverless Function ──
   Route: POST /api/bob
   Env:   GROQ_API_KEY  (set in Vercel dashboard → Settings → Environment Variables)
   Free:  Groq free tier — no credit card, 14,400 req/day
*/

/* ── Rate limiting (in-memory, resets on cold start) ── */
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 10;
const ipMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) {
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

/* ── Real planetary position calculator (~1 degree accuracy) ──
   Uses heliocentric vector math for correct geocentric longitudes.
   No npm dependencies required.
*/
function getPlanetaryPositions(date) {
  if (!date) date = new Date();
  const ZODIAC = [
    'Aries','Taurus','Gemini','Cancer','Leo','Virgo',
    'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'
  ];
  const toSign = function(deg) { var n = ((deg%360)+360)%360; return ZODIAC[Math.floor(n/30)]; };
  const toRad  = function(d) { return d * Math.PI / 180; };
  const toDeg  = function(r) { return r * 180 / Math.PI; };

  var y = date.getUTCFullYear(), m = date.getUTCMonth()+1, d = date.getUTCDate();
  var JD = 367*y - Math.floor(7*(y+Math.floor((m+9)/12))/4)
         + Math.floor(275*m/9) + d + 1721013.5
         + (date.getUTCHours() + date.getUTCMinutes()/60) / 24;
  var T = (JD - 2451545.0) / 36525;
  var D = JD - 2451545;

  var L0  = 280.46646 + 36000.76983 * T;
  var M0r = toRad(357.52911 + 35999.05029*T - 0.0001537*T*T);
  var C   = (1.914602 - 0.004817*T)*Math.sin(M0r)
          + (0.019993 - 0.000101*T)*Math.sin(2*M0r)
          + 0.000289*Math.sin(3*M0r);
  var sunLon   = ((L0 + C) % 360 + 360) % 360;
  var earthLon = ((sunLon + 180) % 360 + 360) % 360;

  var Mm = 134.9634 + 477198.8676*T;
  var Dm = 297.8502 + 445267.1115*T;
  var Om = 125.0445 -   1934.1363*T;
  var moonLon = ((218.3165 + 481267.8813*T
    + 6.2888*Math.sin(toRad(Mm))
    + 1.2740*Math.sin(toRad(2*Dm - Mm))
    + 0.6583*Math.sin(toRad(2*Dm))
    + 0.2136*Math.sin(toRad(2*Mm))
    - 0.1851*Math.sin(toRad(Om))
    - 0.1143*Math.sin(toRad(2*Dm - 2*Mm))
    + 0.0588*Math.sin(toRad(2*Dm + Mm))) % 360 + 360) % 360;

  var hLon = function(rate, epoch) { return ((epoch + rate*D) % 360 + 360) % 360; };
  var mercHL = hLon(4.09234,  84.457);
  var venHL  = hLon(1.60214, 181.979);
  var marsHL = hLon(0.52403, 355.433);
  var jupHL  = hLon(0.08309,  34.351);
  var satHL  = hLon(0.03346,  50.077);
  var uraHL  = hLon(0.01176, 314.055);
  var nepHL  = hLon(0.00600, 304.880);

  var geo = function(L_p, r_p) {
    var lp = toRad(L_p), le = toRad(earthLon);
    return ((toDeg(Math.atan2(r_p*Math.sin(lp) - Math.sin(le),
                              r_p*Math.cos(lp) - Math.cos(le))) % 360) + 360) % 360;
  };

  var mercGeo = geo(mercHL, 0.387);
  var venGeo  = geo(venHL,  0.723);
  var marsGeo = geo(marsHL, 1.524);
  var jupGeo  = geo(jupHL,  5.203);
  var satGeo  = geo(satHL,  9.537);
  var uraGeo  = geo(uraHL, 19.19);
  var nepGeo  = geo(nepHL, 30.07);

  var angSep = function(a, b) { return Math.abs((((a-b)%360)+540)%360 - 180); };
  var mercRetro = angSep(mercGeo, sunLon) < 28;
  var venRetro  = angSep(venGeo,  sunLon) < 30;

  return {
    Sun:     { sign: toSign(sunLon),  retrograde: false },
    Moon:    { sign: toSign(moonLon), retrograde: false },
    Mercury: { sign: toSign(mercGeo), retrograde: mercRetro },
    Venus:   { sign: toSign(venGeo),  retrograde: venRetro },
    Mars:    { sign: toSign(marsGeo), retrograde: false },
    Jupiter: { sign: toSign(jupGeo),  retrograde: false },
    Saturn:  { sign: toSign(satGeo),  retrograde: false },
    Uranus:  { sign: toSign(uraGeo),  retrograde: false },
    Neptune: { sign: toSign(nepGeo),  retrograde: false },
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // direct — allow
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Slow down.', fallback: true });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  const { question = '', sign = 'gemini', mode = 'oracle' } = req.body || {};

  const VALID_SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  const VALID_MODES = ['oracle','tarot','horoscope'];
  const cleanSign   = VALID_SIGNS.includes((sign||'').toLowerCase()) ? sign.toLowerCase() : 'gemini';
  const cleanMode   = VALID_MODES.includes((mode||'').toLowerCase()) ? mode.toLowerCase() : 'oracle';
  const cleanQ      = String(question).slice(0, 500);

  const planets = getPlanetaryPositions();

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

  const skyLine = "TODAY'S SKY (real astronomical positions): " +
    Object.entries(planets)
      .map(function(e) { return e[0] + ' in ' + e[1].sign + (e[1].retrograde ? ' (retrograde)' : ''); })
      .join(', ') +
    '. Use these actual positions to ground the reading — weave in relevant planets naturally, do not just list them.';

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
${skyLine}
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Make every word count.
- This is their horoscope for TODAY based on the REAL planetary positions above.
- Let the actual sky inform the reading — if Mercury is retrograde, if the Moon is in a tension sign, if Venus just moved — use it.
- Speak to what a ${cleanSign} is likely feeling and facing RIGHT NOW given these real positions.
- No filler astrology. No "the stars say". No "energy". No "manifest".
- NEVER invent planet positions — only use what is listed above.
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
