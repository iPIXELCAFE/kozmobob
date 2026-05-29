/* ── KozmoBob AI — Vercel Serverless Function ──
   Route: POST /api/bob
   Env:   GROQ_API_KEY  (set in Vercel dashboard → Settings → Environment Variables)
   Free:  Groq free tier — no credit card, 14,400 req/day
*/

export default async function handler(req, res) {
  /* Only allow POST */
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  const { question = '', sign = 'gemini', mode = 'oracle' } = req.body || {};

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

  const signContext = SIGN_CONTEXT[sign.toLowerCase()] || '';

  const systemPrompt = mode === 'tarot'
    ? `You are KozmoBob, a mystical tarot oracle. You speak with authority, depth, and mystery.
Rules:
- Respond in exactly 4 lines. Each line is a separate, complete thought.
- Never use bullet points, numbers, or headers.
- Speak as if you already know the answer — you are revealing, not guessing.
- Be specific. No generic platitudes.
- Use short, powerful sentences. Maximum 15 words per line.
- Do not mention "tarot" or "cards" unless directly relevant.
- Never start a line with "I" more than once.
- End with something that lands hard.`
    : `You are KozmoBob, a mystical oracle. The user is ${sign}${signContext ? ` (${signContext})` : ''}.
Rules:
- Respond in exactly 4 lines. Each line is a separate, complete thought.
- Never use bullet points, numbers, or headers.
- Speak as if you already know — you are revealing truth, not advising.
- Be specific to their sign and question. No generic horoscope language.
- Use short, powerful sentences. Maximum 15 words per line.
- The last line should land like a gut punch — something they'll remember.
- Never start a line with "I" more than once.`;

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
          { role: 'user',   content: question || 'What does the universe want me to know right now?' },
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
