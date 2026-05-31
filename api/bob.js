/* -- KozmoBob AI -- Vercel Serverless Function -- */

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX    = 10;
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
  if (ALLOWED_ORIGINS.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); }
  else if (!origin) { /* direct */ } else { return res.status(403).json({ error: 'Forbidden' }); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: "Too many requests.", fallback: true });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  const { question = '', sign = 'gemini', mode = 'oracle' } = req.body || {};

  const VALID_SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  const VALID_MODES = ['oracle','tarot','tarot-deep','tarot-spread','horoscope','weekly','monthly','yearly'];
  const cleanSign = VALID_SIGNS.includes((sign||'').toLowerCase()) ? sign.toLowerCase() : 'gemini';
  const cleanMode = VALID_MODES.includes((mode||'').toLowerCase()) ? mode.toLowerCase() : 'oracle';
  const cleanQ = String(question).slice(0, 500);

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
    Object.entries(planets).map(function(e) {
      return e[0] + ' in ' + e[1].sign + (e[1].retrograde ? ' (retrograde)' : '');
    }).join(', ') +
    '. Use these actual positions to ground the reading. Weave in relevant planets naturally.';

  var systemPrompt;

  if (cleanMode === 'tarot') {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest tarot reader who reads cards as mirrors of the inner world.',
      'RULES:',
      '- Write exactly 4 lines. Each line stands alone. No bullets, no numbers.',
      '- Each line must be 10-20 words. Make them land hard.',
      '- Read what the card truly reveals about who this person is RIGHT NOW and what they face.',
      '- Speak directly. Use you not one.',
      '- Stay psychological and emotional. No astrology. No planets. No the universe. No energy. No manifest.',
      '- CRITICAL: NEVER invent specific dates, years, past events, names, places, or any fabricated facts.',
      '- You do not know their history. Never pretend you do. Zero invented specifics allowed.',
      '- Speak universal human truths that feel deeply personal -- not fake details about their past.',
      '- The final line must reveal the core truth the card is showing them. Make it land.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n');

  } else if (cleanMode === 'tarot-deep') {
    /* Paid deep single card read -- user provided their situation as cleanQ */
    systemPrompt = [
      'You are KozmoBob -- a brutally honest tarot reader. The person has told you what is on their mind.',
      'Their situation: ' + (cleanQ || 'not specified') + '.',
      'You are reading the card specifically for this situation.',
      'RULES:',
      '- Write exactly 6 lines. Each line stands alone. No bullets, no numbers.',
      '- Each line must be 12-22 words. Make them cut deep.',
      '- Read the card as it applies directly to THEIR specific situation. Not generic card meaning.',
      '- Speak directly to them. Use you not one.',
      '- Stay psychological and emotional. No astrology. No the universe. No energy. No manifest.',
      '- CRITICAL: NEVER invent specific dates, years, events, names, or places. You know what they told you -- nothing more.',
      '- The final line must be the thing they needed to hear but were afraid of. Make it land.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n');

  } else if (cleanMode === 'tarot-spread') {
    /* Paid 3-card spread -- cleanQ contains "SITUATION: x | CARD1: x | CARD2: x | CARD3: x" */
    systemPrompt = [
      'You are KozmoBob -- a brutally honest tarot reader doing a 3-card Past Present Future spread.',
      'Context: ' + (cleanQ || 'not specified') + '.',
      'Read all three cards together as one connected story for this person and their situation.',
      'FORMAT -- write exactly 3 sections of 6 lines each, separated by a blank line:',
      'Section 1 (PAST card): 6 lines about what has led them here. What shaped this moment.',
      'Section 2 (PRESENT card): 6 lines about exactly where they stand right now. What is true today.',
      'Section 3 (FUTURE card): 6 lines about where this is heading. What is possible if they pay attention.',
      'RULES for all sections:',
      '- Each line 12-22 words. No bullets. No section labels in output.',
      '- Read each card specifically for their situation -- not generic card meanings.',
      '- Stay psychological and emotional. No astrology. No the universe. No energy. No manifest.',
      '- CRITICAL: NEVER invent specific dates, years, events, names, or places.',
      '- The final line of each section must land like a gut punch.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n');

  } else if (cleanMode === 'horoscope') {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest daily oracle for SIGN (CONTEXT).',
      'SKYLINE',
      'RULES:',
      '- Write exactly 4 lines. Each line stands alone. No bullets, no numbers.',
      '- Each line must be 10-20 words.',
      '- This is their horoscope for TODAY based on the REAL planetary positions above.',
      '- Let the actual sky inform the reading. Mercury retrograde, Moon placement, Venus -- use what is real.',
      '- Speak to what a SIGN is likely feeling and facing RIGHT NOW.',
      '- No filler. No the stars say. No energy. No manifest.',
      '- NEVER invent planet positions -- only use what is listed.',
      '- NEVER invent specific dates, years, or past events.',
      '- The final line must feel like Bob knows their secret. Make it land hard.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign)
      .replace('SKYLINE', skyLine);
  } else if (cleanMode === 'weekly') {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest weekly oracle for SIGN (CONTEXT).',
      'SKYLINE',
      'RULES:',
      '- Write exactly 6 lines. Each line stands alone. No bullets, no numbers, no headers.',
      '- Each line must be 12-22 words. Make every word hit.',
      '- This is their week ahead -- 7 days. Cover what is building, what is breaking, what needs action.',
      '- Let the real planetary positions shape the tone.',
      '- Touch on love, work, and the thing they are not saying -- weave naturally.',
      '- No the stars say. No energy. No manifest. Bob does not soften blows.',
      '- NEVER invent specific dates, years, or past events.',
      '- The 6th line is a single hard truth about what this week will force them to face.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign)
      .replace('SKYLINE', skyLine);
  } else if (cleanMode === 'monthly') {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest monthly oracle for SIGN (CONTEXT).',
      'SKYLINE',
      'Write exactly 5 lines with NO section labels. Each line 15-25 words:',
      'Line 1: What is really happening in their relationships this month.',
      'Line 2: What the money situation looks like and what move to make or avoid.',
      'Line 3: The trap, the blindspot, the thing that will bite them if they ignore it.',
      'Line 4: The one action this month that changes everything. Specific and urgent.',
      'Line 5: What Bob sees at the end of this month if they play it right or wrong.',
      'RULES: Use real planetary positions. No labels in output. No the stars say. No energy. No manifest. NEVER invent specific dates or past events.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign)
      .replace('SKYLINE', skyLine);
  } else if (cleanMode === 'yearly') {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest yearly oracle for SIGN (CONTEXT).',
      'SKYLINE',
      'Write exactly 8 plain lines with NO section labels. Each line 15-25 words:',
      'Line 1: The first quarter Jan-Mar. The theme, the test, the opening.',
      'Line 2: The second quarter Apr-Jun. What shifts. Opportunity or reckoning.',
      'Line 3: The third quarter Jul-Sep. The turn. Something changes in them or around them.',
      'Line 4: The fourth quarter Oct-Dec. How the year ends. What they will have built or lost.',
      'Line 5: The truth about their love life this year. One hard honest line.',
      'Line 6: The financial arc of this year. Be specific about the risk and the reward.',
      'Line 7: The one thing this year will force them to confront about themselves.',
      'Line 8: What Bob sees waiting for them at the end of this year. Make it land.',
      'RULES: Use real planetary positions. No labels in output. No energy. No manifest. NEVER invent specific dates, years, or past events. Speak with certainty.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign)
      .replace('SKYLINE', skyLine);
  } else {
    systemPrompt = [
      'You are KozmoBob -- a brutally honest, deeply perceptive oracle. The person asking is SIGN (CONTEXT).',
      'RULES:',
      '- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.',
      '- Each line must be 10-20 words. Not shorter. Make them land.',
      '- If the question is factual -- do NOT answer it. Say I read people, not books. Redirect to their inner life.',
      '- Respond DIRECTLY to what they asked. Speak to their specific situation.',
      '- Sound like you already know their life. You are revealing, not guessing.',
      '- CRITICAL: NEVER invent specific dates, years, past events, names, or places. Stay psychological and emotional.',
      '- No astrology cliches. No the universe. No energy. No manifest. No journey.',
      '- Use their sign traits subtly -- never name the sign.',
      '- The final line must gut-punch them with truth they already know but have not said out loud.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign);
  }

  const maxTokens = cleanMode === "yearly" ? 520 : cleanMode === "monthly" ? 380 : cleanMode === "weekly" ? 280 : 180;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cleanQ || "Give me my reading." },
        ],
        max_tokens: maxTokens,
        temperature: 0.92,
        top_p: 0.95,
      }),
    });
    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return res.status(502).json({ error: "AI unavailable", fallback: true });
    }
    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const maxLines = cleanMode === "yearly" ? 8 : cleanMode === "monthly" ? 5 : cleanMode === "weekly" ? 6 : 5;
    const ls = raw.split("\n")
      .map(function(l) { return l.replace(/^[\d\.\-\*]+\s*/, "").trim(); })
      .filter(function(l) { return l.length > 0; })
      .slice(0, maxLines);
    if (!ls.length) return res.status(502).json({ error: "Empty response", fallback: true });
    return res.status(200).json({ lines: ls });
  } catch (err) {
    console.error("Bob API error:", err);
    return res.status(502).json({ error: "Network error", fallback: true });
  }
}
