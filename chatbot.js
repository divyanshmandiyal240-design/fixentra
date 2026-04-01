// ═══════════════════════════════════════════════════════════════════
//  Fixentra AI Chatbot — powered by Gemini via Cloudflare Worker
//
//  After deploying the Cloudflare Worker, replace YOUR_WORKER_URL below
//  with the URL shown by: wrangler deploy
//  e.g. https://fixentra-ai-proxy.YOUR-SUBDOMAIN.workers.dev
// ═══════════════════════════════════════════════════════════════════

const WORKER_URL = 'YOUR_WORKER_URL';   // ← paste your Cloudflare Worker URL here

// ── CONTEXT ──────────────────────────────────────────────────────────────────
const IS_TICKETS_PAGE = window.location.pathname.toLowerCase().includes('tickets');

const SYSTEM_PROMPT = `You are Fixi, a friendly and knowledgeable AI assistant for Fixentra IT Solution — a full-service IT company based in India.

## About Fixentra
- Services: Remote IT Support (24/7), Hardware Sale & Purchase, Cybersecurity Consulting, Website Development, AI Development, Custom Software Solutions, Licensed Software Sales (Microsoft, Adobe, antivirus, ERP)
- Contact: +91 99159 99043 | info@fixentra.in | WhatsApp: wa.me/919915999043
- Business Hours: Mon–Sat 9:00 AM – 7:00 PM (emergency support available 24/7)
- 500+ clients served, 8+ years experience, 99% uptime SLA
- Pan-India service, on-site & remote support

## Your job
1. Answer questions about Fixentra's services clearly and helpfully
2. Help visitors decide which service they need based on their problem
3. Guide users to raise a support ticket for IT issues — ${IS_TICKETS_PAGE ? 'tell them to click "Raise Ticket" in the left sidebar' : 'direct them to the Support Portal at tickets.html on this site'}
4. Answer common IT FAQs: passwords, network issues, slow computers, software errors, virus/malware, printer problems, email setup, etc.
5. For pricing, always say "Contact us for a custom quote" — never guess prices
6. If you cannot help, suggest: call +91 99159 99043 or email info@fixentra.in

## Rules
- Keep replies concise (3–5 sentences max unless a list is needed)
- Be warm and professional — no cold corporate tone
- Never make up facts about Fixentra
- If asked something unrelated to IT or Fixentra, politely redirect`;

const INITIAL_SUGGESTIONS = IS_TICKETS_PAGE
  ? ['How do I raise a ticket?', 'My internet is down', 'I have a virus', 'Contact support']
  : ['What services do you offer?', 'I need IT support', 'Get a quote', 'Cybersecurity help'];

// ── STATE ─────────────────────────────────────────────────────────────────────
let history  = [];
let isOpen   = false;
let isBusy   = false;

// ── BUILD DOM ─────────────────────────────────────────────────────────────────
function buildChatbot() {
  // Inject toggle button
  const btn = document.createElement('button');
  btn.className = 'cb-btn';
  btn.id        = 'cb-btn';
  btn.title     = 'Chat with Fixi';
  btn.innerHTML = `
    <span class="cb-badge" id="cb-badge"></span>
    <svg class="ico-chat" viewBox="0 0 24 24" fill="white"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    <svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  `;

  // Inject chat window
  const win = document.createElement('div');
  win.className = 'cb-window hidden';
  win.id        = 'cb-window';
  win.innerHTML = `
    <div class="cb-header">
      <div class="cb-avatar">
        <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" fill="white" fill-opacity=".2"/><path d="M9.5 9a2.5 2.5 0 015 0" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="9" cy="12" r="1.2" fill="white"/><circle cx="15" cy="12" r="1.2" fill="white"/><path d="M9 15.5s1 1.5 3 1.5 3-1.5 3-1.5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
      </div>
      <div class="cb-hinfo">
        <div class="cb-hname">Fixi — Fixentra AI</div>
        <div class="cb-hstatus">Online &amp; ready to help</div>
      </div>
      <button class="cb-close" id="cb-close" title="Close">&times;</button>
    </div>
    <div class="cb-messages" id="cb-messages"></div>
    <div class="cb-suggestions" id="cb-suggestions"></div>
    <div class="cb-input-row">
      <input class="cb-input" id="cb-input" placeholder="Ask me anything…" autocomplete="off" maxlength="500"/>
      <button class="cb-send" id="cb-send" title="Send">
        <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="white"/></svg>
      </button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(win);

  btn.addEventListener('click', toggleChat);
  document.getElementById('cb-close').addEventListener('click', toggleChat);
  document.getElementById('cb-send').addEventListener('click', sendMessage);
  document.getElementById('cb-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Show greeting
  pushBot(`Hi there! 👋 I'm **Fixi**, Fixentra's AI assistant.\n\nI can help with IT support questions, explain our services, or guide you to raise a support ticket. What can I help you with today?`);
  renderSuggestions(INITIAL_SUGGESTIONS);
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────
function toggleChat() {
  isOpen = !isOpen;
  const win = document.getElementById('cb-window');
  const btn = document.getElementById('cb-btn');
  const badge = document.getElementById('cb-badge');

  win.classList.toggle('hidden', !isOpen);
  btn.classList.toggle('open', isOpen);
  badge.classList.remove('show');

  if (isOpen) {
    document.getElementById('cb-input').focus();
    scrollBottom();
  }
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────
function pushBot(text) {
  history.push({ role: 'model', parts: [{ text }] });
  renderMessages();
}

function renderMessages() {
  const el = document.getElementById('cb-messages');
  if (!el) return;
  el.innerHTML = history.map(m => {
    const isUser = m.role === 'user';
    const raw    = m.parts[0].text;
    const html   = raw
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    return `<div class="cb-msg ${isUser ? 'user' : 'bot'}">
      <div class="cb-bubble">${html}</div>
    </div>`;
  }).join('');
  scrollBottom();
}

function scrollBottom() {
  const el = document.getElementById('cb-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function showTyping() {
  const el = document.getElementById('cb-messages');
  const d  = document.createElement('div');
  d.className = 'cb-typing-wrap';
  d.id = 'cb-typing';
  d.innerHTML = `<div class="cb-typing"><div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div></div>`;
  el.appendChild(d);
  scrollBottom();
}

function hideTyping() {
  document.getElementById('cb-typing')?.remove();
}

function renderSuggestions(chips) {
  const el = document.getElementById('cb-suggestions');
  if (!el) return;
  el.innerHTML = chips.length
    ? chips.map(s => `<button class="cb-chip" onclick="cbChip(this,'${s.replace(/'/g,"\\'")}')">${s}</button>`).join('')
    : '';
}

function cbChip(btn, text) {
  renderSuggestions([]);
  document.getElementById('cb-input').value = text;
  sendMessage();
}

// ── SEND ──────────────────────────────────────────────────────────────────────
async function sendMessage() {
  if (isBusy) return;
  const input = document.getElementById('cb-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  renderSuggestions([]);
  history.push({ role: 'user', parts: [{ text }] });
  renderMessages();

  isBusy = true;
  document.getElementById('cb-send').disabled = true;
  showTyping();

  if (WORKER_URL === 'YOUR_WORKER_URL') {
    hideTyping();
    pushBot('The AI backend is not connected yet. Please contact us at **info@fixentra.in** or call **+91 99159 99043** and we\'ll be happy to help!');
    isBusy = false;
    document.getElementById('cb-send').disabled = false;
    return;
  }

  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: history,
        generationConfig: { maxOutputTokens: 450, temperature: 0.65 },
      }),
    });

    const data  = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Sorry, I didn\'t get a response. Please try again or contact us directly.';

    hideTyping();
    pushBot(reply);

    // After 2nd message, show contextual suggestions
    if (history.length === 4) {
      renderSuggestions(
        IS_TICKETS_PAGE
          ? ['Raise a ticket', 'Check ticket status', 'Speak to a human']
          : ['Contact support', 'Visit Support Portal', 'Get a quote']
      );
    }
  } catch {
    hideTyping();
    pushBot('I\'m having trouble connecting right now. Please reach us at **info@fixentra.in** or **+91 99159 99043**.');
  }

  isBusy = false;
  document.getElementById('cb-send').disabled = false;

  // Notify badge if window closed
  if (!isOpen) document.getElementById('cb-badge').classList.add('show');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildChatbot);
} else {
  buildChatbot();
}
