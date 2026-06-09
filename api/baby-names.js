/* -- KozmoBob Baby Names API -- Vercel Serverless Function -- */
const { GIRL_NAMES, BOY_NAMES, NEUTRAL_NAMES } = require('./names');

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 15;
const ipMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) { ipMap.set(ip, { count: 1, start: now }); return false; }
  entry.count++; ipMap.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

const ALLOWED_ORIGINS = [
  'https://kozmobob.com',
  'https://www.kozmobob.com',
  'https://kosmobob.com',
  'https://www.kosmobob.com',
];

function getPlanetaryPositions(dateStr, timeStr) {
  const ZODIAC = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo',
                  'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
  const toSign = d => ZODIAC[Math.floor(((d%360)+360)%360 / 30)];
  const toRad  = d => d * Math.PI / 180;
  const toDeg  = r => r * 180 / Math.PI;

  let dt;
  if (dateStr) {
    dt = timeStr ? new Date(`${dateStr}T${timeStr}:00`) : new Date(`${dateStr}T12:00:00`);
  } else {
    dt = new Date();
  }

  const y = dt.getUTCFullYear(), m = dt.getUTCMonth()+1, d = dt.getUTCDate();
  const h = dt.getUTCHours() + dt.getUTCMinutes()/60;
  const JD = 367*y - Math.floor(7*(y+Math.floor((m+9)/12))/4)
           + Math.floor(275*m/9) + d + 1721013.5 + h/24;
  const T = (JD - 2451545.0) / 36525;
  const D = JD - 2451545;

  const L0  = 280.46646 + 36000.76983*T;
  const M0r = toRad(357.52911 + 35999.05029*T - 0.0001537*T*T);
  const C   = (1.914602 - 0.004817*T)*Math.sin(M0r)
            + (0.019993 - 0.000101*T)*Math.sin(2*M0r)
            + 0.000289*Math.sin(3*M0r);
  const sunLon  = ((L0 + C) % 360 + 360) % 360;
  const earthLon= ((sunLon + 180) % 360 + 360) % 360;

  const Mm = 134.9634 + 477198.8676*T;
  const Dm = 297.8502 + 445267.1115*T;
  const Om = 125.0445 -   1934.1363*T;
  const moonLon = ((218.3165 + 481267.8813*T
    + 6.2888*Math.sin(toRad(Mm))
    + 1.2740*Math.sin(toRad(2*Dm - Mm))
    + 0.6583*Math.sin(toRad(2*Dm))
    + 0.2136*Math.sin(toRad(2*Mm))
    - 0.1851*Math.sin(toRad(Om))
    - 0.1143*Math.sin(toRad(2*Dm - 2*Mm))
    + 0.0588*Math.sin(toRad(2*Dm + Mm))) % 360 + 360) % 360;

  const hLon = (rate, epoch) => ((epoch + rate*D) % 360 + 360) % 360;
  const mercHL = hLon(4.09234, 84.457);
  const venHL  = hLon(1.60214, 181.979);
  const marsHL = hLon(0.52403, 355.433);
  const jupHL  = hLon(0.08309, 34.351);
  const satHL  = hLon(0.03346, 50.077);

  const geo = (L_p, r_p) => {
    const lp = toRad(L_p), le = toRad(earthLon);
    return ((toDeg(Math.atan2(r_p*Math.sin(lp) - Math.sin(le),
                              r_p*Math.cos(lp) - Math.cos(le))) % 360) + 360) % 360;
  };

  const angSep = (a, b) => Math.abs((((a-b)%360)+540)%360 - 180);
  const mercGeo = geo(mercHL, 0.387);
  const venGeo  = geo(venHL,  0.723);
  const marsGeo = geo(marsHL, 1.524);
  const jupGeo  = geo(jupHL,  5.203);
  const satGeo  = geo(satHL,  9.537);

  return {
    Sun:     toSign(sunLon),
    Moon:    toSign(moonLon),
    Mercury: toSign(mercGeo) + (angSep(mercGeo, sunLon) < 28 ? ' (Rx)' : ''),
    Venus:   toSign(venGeo)  + (angSep(venGeo,  sunLon) < 30 ? ' (Rx)' : ''),
    Mars:    toSign(marsGeo),
    Jupiter: toSign(jupGeo),
    Saturn:  toSign(satGeo),
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  const { planets, gender, city, date, count = 3 } = req.body || {};
  if (!planets || !gender || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  /* Recompute accurate planets server-side to prevent spoofing */
  const [dateStr, timeStr] = date.split('T');
  const serverPlanets = getPlanetaryPositions(dateStr, timeStr || null);
  const planetStr = Object.entries(serverPlanets).map(([p,s])=>`${p} in ${s}`).join(', ');

  const genderLabel = gender === 'boy' ? 'boy' : gender === 'girl' ? 'girl' : 'gender-neutral';
  const cityNote = city ? ` born in ${city}` : '';

  /* ── Pick names deterministically from the database ── */
  const pool = gender === 'boy' ? BOY_NAMES : gender === 'girl' ? GIRL_NAMES : NEUTRAL_NAMES;

  /* Build a unique index from the date + planet combo so every date gives different results */
  const dateParts = dateStr.split('-');
  const y = parseInt(dateParts[0], 10);
  const m = parseInt(dateParts[1], 10);
  const d = parseInt(dateParts[2], 10);

  /* Map each planet sign to a number 0-11 */
  const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
  const signIdx = s => SIGNS.indexOf(s) >= 0 ? SIGNS.indexOf(s) : 0;

  const sunIdx  = signIdx(serverPlanets.Sun);
  const moonIdx = signIdx(serverPlanets.Moon);
  const marsIdx = signIdx(serverPlanets.Mars);

  /* Combine date + planet values into a spread-out index */
  const base = (y * 366 + m * 31 + d + sunIdx * 57 + moonIdx * 31 + marsIdx * 13) % pool.length;

  /* Pick `count` names spread evenly through the list from that base point */
  const step = Math.floor(pool.length / (count + 1));
  const pickedNames = [];
  for (let i = 0; i < count; i++) {
    pickedNames.push(pool[(base + i * step) % pool.length]);
  }

  /* ── Zodiac sign for this baby ── */
  const ZODIAC_DATA = {
    Aries:       { symbol: '♈', dates: 'Mar 21 – Apr 19', trait: 'bold, fearless, and born to lead' },
    Taurus:      { symbol: '♉', dates: 'Apr 20 – May 20', trait: 'grounded, loyal, and deeply loving' },
    Gemini:      { symbol: '♊', dates: 'May 21 – Jun 20', trait: 'curious, quick, and endlessly charming' },
    Cancer:      { symbol: '♋', dates: 'Jun 21 – Jul 22', trait: 'intuitive, nurturing, and deeply feeling' },
    Leo:         { symbol: '♌', dates: 'Jul 23 – Aug 22', trait: 'radiant, generous, and born to shine' },
    Virgo:       { symbol: '♍', dates: 'Aug 23 – Sep 22', trait: 'intelligent, devoted, and quietly powerful' },
    Libra:       { symbol: '♎', dates: 'Sep 23 – Oct 22', trait: 'graceful, loving, and naturally balanced' },
    Scorpio:     { symbol: '♏', dates: 'Oct 23 – Nov 21', trait: 'intense, loyal, and fiercely protective' },
    Sagittarius: { symbol: '♐', dates: 'Nov 22 – Dec 21', trait: 'adventurous, honest, and full of wonder' },
    Capricorn:   { symbol: '♑', dates: 'Dec 22 – Jan 19', trait: 'determined, wise, and built to achieve' },
    Aquarius:    { symbol: '♒', dates: 'Jan 20 – Feb 18', trait: 'visionary, unique, and ahead of their time' },
    Pisces:      { symbol: '♓', dates: 'Feb 19 – Mar 20', trait: 'dreamy, compassionate, and deeply soulful' },
  };
  const babyZodiac = ZODIAC_DATA[serverPlanets.Sun] || ZODIAC_DATA['Aries'];

  const systemPrompt = `You are KozmoBob, a mystical cosmic oracle writing for expectant parents.
Your tone is warm, emotional, and deeply personal — like you are speaking directly to the parents about their specific child.
Write as if this name was placed in the stars the moment this baby was conceived.
Make parents feel the magic. Make them want to share it.
Never use markdown. Never use asterisks. Respond ONLY with valid JSON.`;

  const userPrompt = `A baby is due on ${dateStr}${cityNote}.
The sky at this baby's birth: ${planetStr}.
This baby will be a ${serverPlanets.Sun} — ${babyZodiac.trait}.
Gender: ${genderLabel}.

The stars have held these name(s) for this exact soul: ${pickedNames.join(', ')}.

For each name write 2-3 warm, emotional sentences that feel personal and magical.
Speak to the parents directly. Reference the baby's ${serverPlanets.Sun} Sun and specific planets.
Make them feel like this name was always meant for their child.

Respond ONLY with this JSON, no extra text:
{
  "names": [
    { "name": "EXACT NAME", "reason": "warm emotional cosmic explanation for the parents" }
  ]
}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 1.1,
        max_tokens: 600,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'AI unavailable' });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '{}';

    /* Strip any markdown code fences */
    const cleaned = raw.replace(/```json\s*/gi,'').replace(/```/g,'').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.names || !Array.isArray(parsed.names)) {
      return res.status(502).json({ error: 'Unexpected AI response' });
    }

    return res.status(200).json({
      names: parsed.names.slice(0, count),
      planets: serverPlanets,
      zodiac: {
        sign: serverPlanets.Sun,
        symbol: babyZodiac.symbol,
        dates: babyZodiac.dates,
        trait: babyZodiac.trait,
      },
    });

  } catch (err) {
    console.error('Baby names error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
