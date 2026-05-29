/* ── KozmoBob AI — Vercel Serverless Function ──
   Route: POST /api/bob
   Env:   GROQ_API_KEY  (set in Vercel dashboard → Settings → Environment Variables)
   Free:  Groq free tier — no credit card, 14,400 req/day
*/

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  const { question = '', sign = 'gemini', mode = 'oracle' } = req.body || {};

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

  const signContext = SIGN_CONTEXT[sign.toLowerCase()] || '';

  const systemPrompt = mode === 'tarot'
    ? `You are KozmoBob — a brutally honest, deeply perceptive mystical oracle. You see what others miss.
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Not shorter. Make them land.
- Sound like a psychic who actually knows — not a horoscope. Be SPECIFIC to what they asked.
- Speak directly to the person. Use "you" not "one".
- No astrology cliches. No "the universe", no "energy", no "manifest".
- The final line must be so specific and true it feels personal. Make them feel seen.
- Never start two consecutive lines with the same word.`
    : `You are KozmoBob — a brutally honest, deeply perceptive oracle. The person asking is ${sign} (${signContext}).
RULES (non-negotiable):
- Write exactly 4 lines. Each line stands alone. No bullet points, no numbers.
- Each line must be 10-20 words. Not shorter. Make them land.
- Respond DIRECTLY to what they asked. Not generic advice — speak to their specific situation.
- Sound like you already know their life. You are revealing, not guessing.
- No astrology cliches. No "the universe", no "energy", no "manifest", no "journey".
- Use their sign traits subtly — never name the sign.
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
          { role: 'user', content: question || 'What do I need to know right now?' },
        ],
        max_tokens: 220,
        temperature: 0.95,
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
