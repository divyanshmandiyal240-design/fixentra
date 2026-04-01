// ═══════════════════════════════════════════════════════════════════
//  Fixentra — Gemini AI Proxy (Cloudflare Worker)
//  API key stays server-side, never exposed to the browser.
//
//  Setup:
//  1. npm install -g wrangler
//  2. wrangler login
//  3. wrangler secret put GEMINI_API_KEY   ← paste your key when prompted
//  4. wrangler deploy
//  5. Copy the worker URL into chatbot.js → WORKER_URL
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://fixentra.in',
  'https://www.fixentra.in',
  'https://divyanshmandiyal240-design.github.io',
  'http://localhost',          // local dev
  'http://127.0.0.1',
];

export default {
  async fetch(request, env) {
    const origin        = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const cors = {
      'Access-Control-Allow-Origin':  allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    try {
      const body   = await request.json();
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        }
      );
      const data = await apiRes.json();
      return new Response(JSON.stringify(data), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy error' }), {
        status:  500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
