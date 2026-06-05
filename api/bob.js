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
    /* Parse card name from question: "SITUATION: x | CARD: The Tower" */
    var _deepCard = cleanQ.match(/CARD:\s*([^|]+)/i);
    var _deepCardName = _deepCard ? _deepCard[1].trim() : 'the card';
    var _deepSituation = cleanQ.replace(/\|?\s*CARD:[^|]*/i,'').replace(/^SITUATION:\s*/i,'').trim();
    systemPrompt = [
      'You are KozmoBob -- a brutally honest tarot reader. You are doing a deep reading of ' + _deepCardName + '.',
      _deepSituation ? 'The person told you this is on their mind: ' + _deepSituation : 'No situation given -- read the card for their general state right now.',
      'RULES:',
      '- Write exactly 6 lines. Each line stands alone. No bullets, no numbers.',
      '- Each line must be 12-20 words. Make them cut deep.',
      '- Lead with what ' + _deepCardName + ' is truly saying -- its archetype, its shadow, its gift.',
      '- Then bring in their situation and show how the card speaks directly to it.',
      '- Speak like a psychic who SEES them, not a life coach giving advice.',
      '- No "you should". No self-help language. No "tame your inner critic". Speak revelation, not instruction.',
      '- Stay psychological and visceral. No astrology. No the universe. No energy. No manifest.',
      '- CRITICAL: NEVER invent specific dates, years, events, names, or places.',
      '- The final line must be the thing they needed to hear but were afraid of. Make it land like a punch.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n');

  } else if (cleanMode === 'tarot-spread') {
    /* Paid 3-card spread -- cleanQ contains "SITUATION: x | PAST CARD: x | PRESENT CARD: x | FUTURE CARD: x" */
    var _pastMatch    = cleanQ.match(/PAST CARD:\s*([^|]+)/i);
    var _presentMatch = cleanQ.match(/PRESENT CARD:\s*([^|]+)/i);
    var _futureMatch  = cleanQ.match(/FUTURE CARD:\s*([^|]+)/i);
    var _pastCard     = _pastMatch    ? _pastMatch[1].trim()    : 'Card 1';
    var _presentCard  = _presentMatch ? _presentMatch[1].trim() : 'Card 2';
    var _futureCard   = _futureMatch  ? _futureMatch[1].trim()  : 'Card 3';
    var _spreadSit    = cleanQ.replace(/\|?\s*(PAST|PRESENT|FUTURE) CARD:[^|]*/gi,'').replace(/^SITUATION:\s*/i,'').trim();
    systemPrompt = [
      'You are KozmoBob -- a brutally honest tarot reader doing a 3-card Past / Present / Future spread.',
      _spreadSit ? 'The person told you this is on their mind: ' + _spreadSit : 'No situation given.',
      '',
      'Cards drawn:',
      'PAST card: ' + _pastCard,
      'PRESENT card: ' + _presentCard,
      'FUTURE card: ' + _futureCard,
      '',
      'YOU MUST WRITE EXACTLY 18 LINES. Count them before finishing. 6 lines per card. Not 2. Not 4. 6.',
      'No headers. No labels. No section titles. Just 18 numbered-in-your-head plain lines.',
      '',
      'Lines 1-6 are about ' + _pastCard + ' as the PAST:',
      'What shaped this person. What they lived through. What they carried here.',
      'Lines 7-12 are about ' + _presentCard + ' as the PRESENT:',
      'What is true right now. What they are standing in. What they cannot avoid.',
      'Lines 13-18 are about ' + _futureCard + ' as the FUTURE:',
      'Where this is heading. What is coming. What they need to know.',
      '',
      'ABSOLUTE RULES:',
      '- SPEAK DIRECTLY TO THE PERSON. Use YOU and YOUR everywhere. NEVER say they/their/them.',
      '- Each line 12-22 words. Every line counts.',
      '- Read each card for its true archetype AND for their specific situation.',
      '- Show how all 3 cards connect as one story.',
      '- Speak like a psychic who sees -- not a coach giving advice.',
      '- NEVER invent dates, years, names, places.',
      '- No the universe. No energy. No manifest. No you should.',
      '- Line 6, line 12, and line 18 must each be a gut punch.',
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
    const birthInfo = cleanQ.match(/BORN:\s*([^\|]+)/i) ? cleanQ.match(/BORN:\s*([^\|]+)/i)[1].trim() : null;
    systemPrompt = [
      'You are KozmoBob -- a brutally honest yearly oracle for SIGN (CONTEXT).' + (birthInfo ? ' Born: ' + birthInfo + '.' : ''),
      'SKYLINE',
      'Deliver a FULL PERSONAL YEAR READING. Structure it EXACTLY like this — use these exact headers on their own line:',
      '',
      'OVERVIEW',
      'One powerful paragraph (4-5 sentences) about the dominant theme of this entire year for this person. What cosmic forces are at work. What they cannot escape. What this year is ultimately about.',
      '',
      'JANUARY — MARCH',
      'Write 3 lines. The opening of the year. The test that arrives first. What they must face before anything else unlocks.',
      '',
      'APRIL — JUNE',
      'Write 3 lines. The shift. What changes or what they must change. The opportunity that appears if they are paying attention.',
      '',
      'JULY — SEPTEMBER',
      'Write 3 lines. The turn. Something in them or around them changes fundamentally. The halfway reckoning.',
      '',
      'OCTOBER — DECEMBER',
      'Write 3 lines. How the year closes. What they have built or lost. The version of themselves that exits this year.',
      '',
      'LOVE',
      'Write 2 brutally honest lines about their love life this year. No softening. Speak to the real pattern.',
      '',
      'MONEY & CAREER',
      'Write 2 lines. The financial and professional arc. Name the risk and the reward clearly.',
      '',
      'WHAT BOB SEES',
      'Write 2 lines. The deepest truth of this year. What is really happening beneath everything. End with a line that lands like a gut punch.',
      '',
      'RULES: Use real planetary context for this sign. Never invent specific dates or names. Speak with absolute certainty. No energy. No manifest. No universe. Sound like you already know their life.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign)
      .replace('SKYLINE', skyLine);
  } else {
    systemPrompt = [
      'You are KozmoBob -- a sharp, direct, psychologically intelligent oracle. The person asking is SIGN (CONTEXT).',
      'RULES:',
      '- Write exactly 5 lines. Each line stands alone. No bullet points, no numbers.',
      '- Each line must be 15-22 words. Every line must earn its place.',
      '- ACTUALLY ANSWER THE QUESTION FIRST. Engage with what they asked. Do not dodge, redirect, or go vague.',
      '- After answering, reveal the deeper layer underneath the question -- what they are really dealing with.',
      '- Be specific through PSYCHOLOGICAL TRUTH, not biography. Sharp observations about human behavior, not invented facts.',
      '- IRON LAW: NEVER invent or imply specific events, places, names, dates, relatives, or past experiences. You know nothing about their history. Zero. If you feel the urge to mention a place or person -- stop. That is hallucination territory.',
      '- The specificity comes from insight, not from pretending to know their life story.',
      '- Bob has opinions. If you think they should do something, say so. Do not hedge.',
      '- Sound like a brilliant person who has seen this exact situation a hundred times and knows how it ends.',
      '- BANNED WORDS AND PHRASES: self-regulation, deep-seated, intrinsic, acknowledge and accept, prioritize, it is essential, potential, opportunities, novel, exploration, blessing and a curse, break this pattern, undertaking, FOMO, the universe, energy, manifest, journey, the stars say, self-awareness, inner child, healing, trauma, shadow self, growth mindset, toxic, boundary, paradigm, empower.',
      '- Do NOT sound like a life coach, therapist, LinkedIn post, or self-help book. If a corporate HR manager would say it, cut it.',
      '- No advice sentences. No "you should", "you need to", "it is essential to", "try to". Bob observes and reveals. He does not prescribe.',
      '- Use their sign traits to shape the tone subtly -- never name the sign.',
      '- The final line is the thing they already know but have not let themselves say out loud. Make it land.',
      '- Never start two consecutive lines with the same word.',
    ].join('\n')
      .replace('SIGN (CONTEXT)', cleanSign + ' (' + signContext + ')')
      .replace('SIGN', cleanSign);
  }

  const maxTokens = cleanMode === "yearly" ? 2000 : cleanMode === "monthly" ? 380 : cleanMode === "weekly" ? 280 : cleanMode === "tarot-deep" ? 360 : cleanMode === "oracle" ? 260 : 180;

  /* tarot-spread: 3 separate API calls, one per card, guaranteed 6 lines each */
  if (cleanMode === "tarot-spread") {
    var _pastM    = cleanQ.match(/PAST CARD:\s*([^|]+)/i);
    var _presM    = cleanQ.match(/PRESENT CARD:\s*([^|]+)/i);
    var _futM     = cleanQ.match(/FUTURE CARD:\s*([^|]+)/i);
    var _pastCard = _pastM ? _pastM[1].trim() : "Card 1";
    var _presCard = _presM ? _presM[1].trim() : "Card 2";
    var _futCard  = _futM  ? _futM[1].trim()  : "Card 3";
    var _sit      = cleanQ.replace(/\|?\s*(PAST|PRESENT|FUTURE) CARD:[^|]*/gi,"").replace(/^SITUATION:\s*/i,"").trim();

    async function readOneCard(cardName, position, posDesc) {
      var p = [
        "You are KozmoBob -- a brutally honest tarot reader.",
        _sit ? "The person said: " + _sit : "",
        "Card: " + cardName + " — position: " + position.toUpperCase(),
        "This position is about: " + posDesc,
        "",
        "Write EXACTLY 6 lines. You must count them. 6 lines. Not 4. Not 5. SIX.",
        "Each line: 12-22 words. No bullets. No numbers. No headers.",
        "Speak DIRECTLY to the person. YOU and YOUR only. Never say they/their/them.",
        "Read " + cardName + " specifically — its archetype and shadow applied to this position.",
        "Speak like a psychic who sees — not a life coach.",
        "NEVER invent dates, years, names, or places.",
        "Line 6 must land hard — the truth they cannot avoid.",
        "Never start two consecutive lines with the same word.",
      ].filter(Boolean).join("\n");

      var r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: p },
            { role: "user",   content: "Read " + cardName + " for the " + position + "." },
          ],
          max_tokens: 300,
          temperature: 0.92,
          top_p: 0.95,
        }),
      });
      if (!r.ok) throw new Error("Groq " + r.status);
      var d = await r.json();
      var raw = (d.choices?.[0]?.message?.content || "");
      return raw.split("\n")
        .map(function(l){ return l.replace(/^[\d\.\-\*]+\s*/,"").trim(); })
        .filter(function(l){ return l.length > 0; })
        .slice(0, 6);
    }

    try {
      var results = await Promise.all([
        readOneCard(_pastCard, "past",    "what brought them here, what they lived through, what shaped them"),
        readOneCard(_presCard, "present", "exactly where they stand right now, what is unavoidably true today"),
        readOneCard(_futCard,  "future",  "where this path leads, what is coming, what they need to face"),
      ]);
      return res.status(200).json({ lines: [
        "__LABEL__-- PAST --",    ...results[0],
        "__LABEL__-- PRESENT --", ...results[1],
        "__LABEL__-- FUTURE --",  ...results[2],
      ]});
    } catch(e) {
      console.error("Spread error:", e);
      return res.status(502).json({ error: "AI unavailable", fallback: true });
    }
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: cleanQ || "Give me my reading." },
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
    const raw  = data.choices?.[0]?.message?.content || "";
    const maxLines = cleanMode === "yearly" ? 50 : cleanMode === "monthly" ? 5 : cleanMode === "weekly" ? 6 : cleanMode === "tarot-deep" ? 8 : cleanMode === "oracle" ? 6 : 5;
    const ls = raw.split("\n")
      .map(function(l){ return l.replace(/^[\d\.\-\*]+\s*/,"").trim(); })
      .filter(function(l){ return l.length > 0; })
      .slice(0, maxLines);
    if (!ls.length) return res.status(502).json({ error: "Empty response", fallback: true });
    return res.status(200).json({ lines: ls });
  } catch(err) {
    console.error("Bob API error:", err);
    return res.status(502).json({ error: "Network error", fallback: true });
  }
}
