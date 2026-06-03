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

  /* ── Name pools by zodiac sign ── */
  const NAME_POOLS = {
    boy: {
      Aries:       ['Axel','Hunter','Ryder','Zane','Brayden'],
      Taurus:      ['Oliver','Mason','Finn','Jasper','Cole'],
      Gemini:      ['Dylan','Miles','Flynn','Eli','Nolan'],
      Cancer:      ['Lucas','Noah','Emmett','Owen','Luca'],
      Leo:         ['Sebastian','Leo','Roman','Marcus','Xavier'],
      Virgo:       ['Ethan','Adrian','Declan','Wesley','Aaron'],
      Libra:       ['Julian','Theo','Blake','Gavin','Ivan'],
      Scorpio:     ['Silas','Knox','Tristan','Phoenix','Zach'],
      Sagittarius: ['Sawyer','Hudson','Nash','Carter','Logan'],
      Capricorn:   ['James','Elijah','Aiden','Isaiah','Colton'],
      Aquarius:    ['Kai','Oscar','Hayes','Quinn','Nathaniel'],
      Pisces:      ['Ezra','Liam','Jaxon','Grayson','Jackson'],
    },
    girl: {
      Aries:       ['Scarlett','Ruby','Piper','Sadie','Skylar'],
      Taurus:      ['Ivy','Isla','Gemma','Vera','Willow'],
      Gemini:      ['Zoe','Ellie','Lexi','Paige','Claire'],
      Cancer:      ['Luna','Nora','Hazel','Leah','Naomi'],
      Leo:         ['Charlotte','Stella','Bella','Grace','Audrey'],
      Virgo:       ['Amelia','Tessa','Freya','Sierra','Jade'],
      Libra:       ['Sophia','Violet','Penelope','Elena','Kylie'],
      Scorpio:     ['Nova','Wren','Zara','Maya','Yasmine'],
      Sagittarius: ['Harper','Riley','Autumn','Savannah','Brooklyn'],
      Capricorn:   ['Olivia','Emma','Isabella','Evelyn','Chloe'],
      Aquarius:    ['Aria','Quinn','Uma','Sloane','Indigo'],
      Pisces:      ['Ava','Mia','Zoey','Layla','Aurora'],
    },
    neutral: {
      Aries:       ['Phoenix','Ryder','Sloane','Scout','Shiloh'],
      Taurus:      ['Rowan','Sage','Wren','Ellis','Marlowe'],
      Gemini:      ['Quinn','Emery','Finley','Drew','Cameron'],
      Cancer:      ['River','Eden','Haven','Ocean','Sutton'],
      Leo:         ['Logan','Blake','Parker','Tatum','Milan'],
      Virgo:       ['Avery','Morgan','Reese','Grey','Lane'],
      Libra:       ['Jordan','Riley','Taylor','Peyton','Kendall'],
      Scorpio:     ['Nova','Winter','Zen','Indigo','Remi'],
      Sagittarius: ['Skylar','Harper','Frankie','Jesse','Jaden'],
      Capricorn:   ['Morgan','Avery','Blake','Cameron','Ellis'],
      Aquarius:    ['Kai','Quinn','Indigo','Zen','Nova'],
      Pisces:      ['Eden','River','Sage','Rowan','Wren'],
    }
  };

  /* ── Pick name deterministically from Sun + Moon signs ── */
  const poolKey = gender === 'boy' ? 'boy' : gender === 'girl' ? 'girl' : 'neutral';
  const sunSign  = serverPlanets.Sun;
  const moonSign = serverPlanets.Moon;
  const marsSign = serverPlanets.Mars;

  const pool = NAME_POOLS[poolKey];
  const sunPool  = pool[sunSign]  || pool['Aries'];
  const moonPool = pool[moonSign] || pool['Cancer'];
  const marsPool = pool[marsSign] || pool['Scorpio'];

  /* Use the day-of-month as a secondary seed for variety within the same month */
  const dayOfMonth = parseInt(dateStr.split('-')[2], 10) || 1;
  const pickedName = sunPool[dayOfMonth % sunPool.length];
  const secondName = moonPool[(dayOfMonth + 2) % moonPool.length];
  const thirdName  = marsPool[(dayOfMonth + 4) % marsPool.length];

  const namesToExplain = count === 1 ? [pickedName]
                       : count === 5 ? [pickedName, secondName, thirdName, sunPool[(dayOfMonth+1)%sunPool.length], moonPool[(dayOfMonth+3)%moonPool.length]]
                       : [pickedName, secondName, thirdName];

  const planetStr2 = `Sun in ${sunSign}, Moon in ${moonSign}, Mars in ${marsSign}, Venus in ${serverPlanets.Venus}, Jupiter in ${serverPlanets.Jupiter}`;

  const systemPrompt = `You are KozmoBob, a mystical cosmic oracle. You write short poetic explanations for baby names chosen by the stars.
Never use markdown. Never use asterisks. Respond ONLY with valid JSON.`;

  const userPrompt = `A baby is due on ${dateStr}${cityNote}.
Planetary positions: ${planetStr2}.
Gender: ${genderLabel}.

The stars have already chosen these name(s): ${namesToExplain.join(', ')}.

For each name write 1-2 sentences explaining WHY the planets chose it — reference the specific signs above.
Be poetic, cosmic, and specific to these planets.

Respond ONLY with this JSON, no extra text:
{
  "names": [
    { "name": "EXACT NAME AS GIVEN", "reason": "cosmic explanation" }
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
