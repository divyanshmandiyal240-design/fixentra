// ═══════════════════════════════════════════════════════════════════
//  Fixentra — Secure API Proxy (Cloudflare Worker)
//  Handles: Gemini AI  |  Razorpay Orders & Verification
//
//  Secrets (set via: wrangler secret put <NAME>):
//    GEMINI_API_KEY       — from aistudio.google.com
//    RAZORPAY_KEY_ID      — from razorpay.com dashboard
//    RAZORPAY_KEY_SECRET  — from razorpay.com dashboard
//
//  Setup:
//  1. npm install -g wrangler
//  2. wrangler login
//  3. wrangler secret put GEMINI_API_KEY
//  4. wrangler secret put RAZORPAY_KEY_ID
//  5. wrangler secret put RAZORPAY_KEY_SECRET
//  6. wrangler deploy
//  7. Paste the Worker URL into:
//       chatbot.js  → WORKER_URL
//       tickets.js  → RZP.workerUrl
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://fixentra.in',
  'https://www.fixentra.in',
  'https://divyanshmandiyal240-design.github.io',
  'http://localhost',
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

    const url      = new URL(request.url);
    const pathname = url.pathname;

    try {
      // ── ROUTE: Gemini AI (/  or  /ai) ────────────────────────────
      if (pathname === '/' || pathname === '/ai') {
        const body   = await request.json();
        const apiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
        );
        const data = await apiRes.json();
        return new Response(JSON.stringify(data), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      // ── ROUTE: Create Razorpay Order (/razorpay/order) ────────────
      if (pathname === '/razorpay/order') {
        const { amount, currency = 'INR', receipt } = await request.json();
        const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Basic ${credentials}`,
          },
          body: JSON.stringify({ amount, currency, receipt }),
        });
        const order = await res.json();
        return new Response(JSON.stringify(order), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      // ── ROUTE: Verify Razorpay Payment (/razorpay/verify) ─────────
      if (pathname === '/razorpay/verify') {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json();
        const body    = `${razorpay_order_id}|${razorpay_payment_id}`;
        const encoder = new TextEncoder();
        const keyData = encoder.encode(env.RAZORPAY_KEY_SECRET);
        const msgData = encoder.encode(body);
        const cryptoKey = await crypto.subtle.importKey(
          'raw', keyData, { name:'HMAC', hash:'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
        const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
        const success = hex === razorpay_signature;
        return new Response(JSON.stringify({ success }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404, headers: cors });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy error', detail: err.message }), {
        status:  500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
