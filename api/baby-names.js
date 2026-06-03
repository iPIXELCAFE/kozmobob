/* -- KozmoBob Baby Names API -- Vercel Serverless Function -- */

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

  const boyNames = `Liam, Noah, Oliver, Elijah, James, Aiden, Lucas, Mason, Ethan, Logan, Sebastian, Jackson, Carter, Owen, Wyatt, Hunter, Grayson, Julian, Ezra, Hudson, Nolan, Eli, Aaron, Isaiah, Adrian, Colton, Brayden, Declan, Finn, Jaxon, Kai, Leo, Miles, Nathaniel, Oscar, Roman, Sawyer, Theo, Xavier, Zane, Axel, Blake, Cole, Dylan, Emmett, Flynn, Gavin, Hayes, Ivan, Jasper, Knox, Luca, Marcus, Nash, Phoenix, Quinn, Ryder, Silas, Tristan, Wesley, Zach`;

  const girlNames = `Olivia, Emma, Sophia, Ava, Isabella, Mia, Luna, Charlotte, Amelia, Harper, Evelyn, Aria, Scarlett, Lily, Chloe, Aurora, Zoey, Stella, Nora, Hazel, Elena, Violet, Maya, Layla, Penelope, Riley, Zoe, Naomi, Leah, Savannah, Brooklyn, Bella, Claire, Skylar, Ivy, Isla, Grace, Ellie, Audrey, Piper, Ruby, Sadie, Willow, Autumn, Elara, Freya, Gemma, Jade, Kylie, Lexi, Nova, Paige, Quinn, Sierra, Tessa, Uma, Vera, Wren, Xena, Yasmine, Zara`;

  const neutralNames = `Riley, Avery, Jordan, Morgan, Quinn, Rowan, Sage, Skylar, Phoenix, River, Eden, Emery, Finley, Harper, Indigo, Jaden, Kendall, Logan, Milan, Nova, Parker, Reese, Sloane, Taylor, Wren, Blake, Cameron, Drew, Ellis, Frankie, Grey, Haven, Jesse, Kai, Lane, Marlowe, Ocean, Peyton, Remi, Scout, Shiloh, Sutton, Tatum, Winter, Zen`;

  const nameList = genderLabel === 'boy' ? boyNames : genderLabel === 'girl' ? girlNames : neutralNames;

  const systemPrompt = `You are KozmoBob, a cosmic oracle. You pick baby names from a provided list based on planetary energy.
You MUST only choose names from the list given. No exceptions. No invented names. No ancient names.
Never use markdown. Never use asterisks. Respond ONLY with valid JSON.`;

  const userPrompt = `A baby is due on ${dateStr}${cityNote}.
Planetary positions for this date: ${planetStr}.
Gender preference: ${genderLabel}.

Choose exactly ${count} name(s) from THIS LIST ONLY:
${nameList}

Pick the name(s) whose energy best matches the dominant planets and signs above.
Different dates have different planets — pick different names each time based on the actual planetary energy.
For each name explain in 1-2 sentences which planet and sign chose it and why the energy matches.

Respond ONLY with this JSON, no extra text:
{
  "names": [
    { "name": "NAME FROM LIST ONLY", "reason": "which planet/sign and why" }
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
        temperature: 0.85,
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
    });

  } catch (err) {
    console.error('Baby names error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
