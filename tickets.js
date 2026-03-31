// ═══════════════════════════════════════════════════════════════════════════
//  TICKETFLOW — Role-Based Ticket Management
//  Roles: admin | technician | user
// ═══════════════════════════════════════════════════════════════════════════

// ── EMAILJS NOTIFICATION CONFIG ─────────────────────────────────────────────
// EmailJS sends email alerts when a ticket is raised — no backend needed.
// Paste your keys below after completing the setup steps.
const EJS = {
  publicKey:   'YOUR_PUBLIC_KEY',    // EmailJS → Account → Public Key
  serviceId:   'YOUR_SERVICE_ID',    // EmailJS → Email Services → Service ID
  templateId:  'YOUR_TEMPLATE_ID',   // EmailJS → Email Templates → Template ID
};

async function sendEmailAlert(ticket) {
  if (EJS.publicKey === 'YOUR_PUBLIC_KEY') return; // skip until configured
  try {
    await emailjs.send(EJS.serviceId, EJS.templateId, {
      ticket_id:    ticket.id,
      ticket_title: ticket.title,
      priority:     ticket.priority.toUpperCase(),
      category:     ticket.category,
      description:  ticket.description,
      raised_by:    getUserName(ticket.raisedBy),
      client:       getClientName(ticket.clientId),
      status:       'Open',
      time:         new Date().toLocaleString(),
    }, EJS.publicKey);
    console.log('Email notification sent');
  } catch (e) {
    console.warn('Email notification failed:', e);
  }
}

// ── STORAGE KEYS ────────────────────────────────────────────────────────────
const K = {
  users:      'tf_users',
  tickets:    'tf_tickets',
  categories: 'tf_categories',
  clients:    'tf_clients',
  session:    'tf_session',
};

// ── DEFAULT SEED DATA ────────────────────────────────────────────────────────
function seedData() {
  if (!ls(K.clients)) {
    save(K.clients, []);
  }
  if (!ls(K.users)) {
    save(K.users, [
      { id:'u1', username:'admin@fixentra.in', password:'admin123', name:'Admin', role:'admin', clientId:'', mustChangePassword:false },
    ]);
  }
  // Migrate existing data: add missing fields
  const users = ls(K.users) || [];
  let migrated = false;
  users.forEach(u => {
    if (u.mustChangePassword === undefined) { u.mustChangePassword = false; migrated = true; }
  });
  if (migrated) save(K.users, users);

  const clients = ls(K.clients) || [];
  let cMigrated = false;
  clients.forEach(c => {
    if (c.domain === undefined) { c.domain = ''; cMigrated = true; }
  });
  if (cMigrated) save(K.clients, clients);
  if (!ls(K.categories)) {
    save(K.categories, [
      { id:'c1', name:'Bug',              color:'#ef4444' },
      { id:'c2', name:'Feature Request',  color:'#6c47ff' },
      { id:'c3', name:'Support',          color:'#3b82f6' },
      { id:'c4', name:'Design',           color:'#ec4899' },
      { id:'c5', name:'Performance',      color:'#f59e0b' },
      { id:'c6', name:'Security',         color:'#22c55e' },
    ]);
  }
  if (!ls(K.tickets)) {
    save(K.tickets, []);
  }
}

function ago(days) { return new Date(Date.now() - 86400000 * days).toISOString(); }

// ── STORAGE HELPERS ──────────────────────────────────────────────────────────
function ls(key)        { try { return JSON.parse(localStorage.getItem(key)); } catch{ return null; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function getUsers()      { return ls(K.users)      || []; }
function getTickets()    { return ls(K.tickets)    || []; }
function getCategories() { return ls(K.categories) || []; }
function getClients()    { return ls(K.clients)    || []; }
function getSession()    { return ls(K.session); }

// ── PORTAL DETECTION ─────────────────────────────────────────────────────────
// Reads ?client=CLIENT_ID from the URL.
// If present, this page is a client portal — restrict login to that client only.
const portalClientId = new URLSearchParams(window.location.search).get('client') || null;

// ── APP STATE ────────────────────────────────────────────────────────────────
let currentUser   = null;
let currentView   = '';
let filterStatus  = 'all';
let filterPriority= 'all';
let filterClient  = 'all';
let searchQuery   = '';
let editingTicketId = null;
let editingUserId   = null;
let selectedPriority = 'medium';
let selectedCatColor = '#6c47ff';
let currentModalTicketId = null;

// ── UTILS ────────────────────────────────────────────────────────────────────
function esc(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function genId(prefix='TF') { return prefix + '-' + String(Date.now()).slice(-6); }
function pColor(p) { return {critical:'#ef4444',high:'#f97316',medium:'#f59e0b',low:'#22c55e'}[p]||'#888'; }
function statusLabel(s) { return {'open':'Open','in-progress':'In Progress','closed':'Closed'}[s]||s; }
function roleCap(r='') { return r.charAt(0).toUpperCase()+r.slice(1); }

function getUserName(uid) {
  const u = getUsers().find(x => x.id === uid);
  return u ? u.name : uid ? '(deleted)' : '—';
}

function getClientName(cid) {
  const c = getClients().find(x => x.id === cid);
  return c ? c.name : cid ? '(deleted)' : '—';
}

function getClientColor(cid) {
  const c = getClients().find(x => x.id === cid);
  return c ? c.color : '#555';
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ── PERMISSIONS ──────────────────────────────────────────────────────────────
// What each role can do:
// user       → raise tickets, view own tickets
// technician → view all tickets, update status on assigned tickets
// admin      → full access: all tickets, assign, manage users & categories

const CAN = {
  createTicket:   () => ['user','admin'].includes(currentUser.role),
  viewAllTickets: () => ['admin','technician'].includes(currentUser.role),
  updateStatus:   (t) => currentUser.role === 'admin' || (currentUser.role === 'technician' && t.assignedTo === currentUser.id),
  assignTicket:   () => currentUser.role === 'admin',
  editTicket:     (t) => currentUser.role === 'admin' || t.raisedBy === currentUser.id,
  deleteTicket:   () => currentUser.role === 'admin',
  manageUsers:    () => currentUser.role === 'admin',
  manageCategories:()=> currentUser.role === 'admin',
  manageClients:  () => currentUser.role === 'admin',
};

// ── NAVIGATION CONFIG ────────────────────────────────────────────────────────
function navItems() {
  const base = [
    { view:'dashboard', icon:dashIcon, label:'Dashboard' },
    { view:'tickets',   icon:ticketIcon, label: currentUser.role==='user'?'My Tickets':'All Tickets', badge:true },
  ];
  if (CAN.createTicket()) base.push({ view:'create', icon:plusIcon, label:'Raise Ticket' });
  if (CAN.manageUsers())       base.push({ view:'users',      icon:usersIcon,   label:'Manage Users' });
  if (CAN.manageClients())     base.push({ view:'clients',    icon:clientIcon,  label:'Clients' });
  if (CAN.manageCategories())  base.push({ view:'categories', icon:tagIcon,     label:'Categories' });
  return base;
}

// ── SVG ICONS ────────────────────────────────────────────────────────────────
const dashIcon   = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const ticketIcon = `<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>`;
const plusIcon   = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
const usersIcon  = `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`;
const tagIcon    = `<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
const clientIcon = `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>`;

// ── LOGIN ────────────────────────────────────────────────────────────────────
function initLogin() {
  // Apply portal branding if ?client= is in the URL
  if (portalClientId) {
    const client = getClients().find(c => c.id === portalClientId);
    if (client) {
      // Show client banner
      const banner = document.getElementById('portal-banner');
      banner.style.display = 'flex';
      banner.style.borderColor = client.color + '44';
      banner.style.background  = client.color + '18';
      document.getElementById('portal-dot').style.background  = client.color;
      document.getElementById('portal-name').textContent       = client.name;
      document.getElementById('portal-name').style.color       = client.color;
      // Update heading
      document.getElementById('login-heading').textContent    = `Welcome, ${client.name}`;
      document.getElementById('login-subheading').textContent = 'Sign in to raise and track your tickets';
      // Update sign-in button color
      document.getElementById('login-btn').style.background   = client.color;
      // Hide demo accounts (security — don't expose other creds)
      document.getElementById('demo-accounts').style.display  = 'none';
    } else {
      // Invalid client ID in URL
      document.getElementById('login-error').textContent = 'Invalid client portal link.';
    }
  }

  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const uname = document.getElementById('login-user').value.trim().toLowerCase();
    const pass  = document.getElementById('login-pass').value;
    let user = getUsers().find(u => u.username.toLowerCase() === uname && u.password === pass);

    if (!user) {
      document.getElementById('login-error').textContent = 'Invalid email or password.';
      return;
    }

    // On a client portal — only allow users belonging to that client
    if (portalClientId && user.role !== 'admin' && user.clientId !== portalClientId) {
      document.getElementById('login-error').textContent = 'You are not authorised for this portal.';
      return;
    }

    document.getElementById('login-error').textContent = '';

    if (user.mustChangePassword) {
      showChangePasswordScreen(user);
    } else {
      save(K.session, { id: user.id });
      bootApp(user);
    }
  });

  document.getElementById('pw-toggle').addEventListener('click', () => {
    const inp = document.getElementById('login-pass');
    const btn = document.getElementById('pw-toggle');
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
    else { inp.type = 'password'; btn.textContent = 'Show'; }
  });

  document.querySelectorAll('.demo-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.getElementById('login-user').value = pill.dataset.u || '';
      document.getElementById('login-pass').value = pill.dataset.p || '';
    });
  });
}

// ── CHANGE PASSWORD SCREEN ───────────────────────────────────────────────────
let pendingUser = null;

function showChangePasswordScreen(user) {
  pendingUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('change-pass-screen').style.display = 'flex';
}

document.getElementById('change-pass-form').addEventListener('submit', e => {
  e.preventDefault();
  const newPass  = document.getElementById('cp-new').value;
  const confirm  = document.getElementById('cp-confirm').value;
  const errEl    = document.getElementById('cp-error');
  if (newPass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (newPass !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === pendingUser.id);
  users[idx]  = { ...users[idx], password: newPass, mustChangePassword: false };
  save(K.users, users);
  const updatedUser = users[idx];
  save(K.session, { id: updatedUser.id });
  document.getElementById('change-pass-screen').style.display = 'none';
  pendingUser = null;
  bootApp(updatedUser);
});

// ── BOOT APP ─────────────────────────────────────────────────────────────────
function bootApp(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Sidebar user info
  document.getElementById('sidebar-avatar').textContent = user.name.slice(0,2).toUpperCase();
  document.getElementById('sidebar-name').textContent   = user.name;
  document.getElementById('sidebar-role').textContent   = roleCap(user.role);

  const rb = document.getElementById('role-badge');
  rb.textContent  = roleCap(user.role);
  rb.className    = 'role-badge ' + user.role;

  const rtag = document.getElementById('topbar-role-tag');
  rtag.textContent = roleCap(user.role);
  rtag.className   = 'topbar-role-tag ' + user.role;

  // Build sidebar nav
  buildNav();

  // Default view
  switchView('dashboard');
}

function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = navItems().map(item => `
    <a href="#" class="nav-item" data-view="${item.view}">
      ${item.icon}
      ${esc(item.label)}
      ${item.badge ? `<span class="nav-badge" id="nav-count">0</span>` : ''}
    </a>
  `).join('');
  nav.querySelectorAll('[data-view]').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); })
  );
}

// ── LOGOUT ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(K.session);
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
});

// ── VIEW SWITCHING ───────────────────────────────────────────────────────────
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const viewEl = document.getElementById('view-' + name);
  if (!viewEl) return;
  viewEl.classList.add('active');
  document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  currentView = name;

  if (name === 'dashboard')   renderDashboard();
  if (name === 'tickets')     renderTickets();
  if (name === 'create')      setupForm();
  if (name === 'users')       renderUsers();
  if (name === 'clients')     renderClients();
  if (name === 'categories')  renderCategories();

  document.getElementById('sidebar').classList.remove('open');
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────
function myTickets() {
  const all = getTickets();
  if (currentUser.role === 'user') return all.filter(t => t.raisedBy === currentUser.id);
  if (currentUser.role === 'technician') return all.filter(t => t.assignedTo === currentUser.id);
  return all;
}

function renderDashboard() {
  const tickets = myTickets();
  document.getElementById('dash-subtitle').textContent =
    currentUser.role === 'user'       ? 'Your submitted tickets' :
    currentUser.role === 'technician' ? 'Tickets assigned to you' :
    'All tickets across the system';

  document.getElementById('stat-total').textContent    = tickets.length;
  document.getElementById('stat-open').textContent     = tickets.filter(t=>t.status==='open').length;
  document.getElementById('stat-progress').textContent = tickets.filter(t=>t.status==='in-progress').length;
  document.getElementById('stat-closed').textContent   = tickets.filter(t=>t.status==='closed').length;

  const navC = document.getElementById('nav-count');
  if (navC) navC.textContent = getTickets().filter(t =>
    currentUser.role === 'user' ? t.raisedBy === currentUser.id :
    currentUser.role === 'technician' ? t.assignedTo === currentUser.id : true
  ).length;

  // Recent
  const recentEl = document.getElementById('recent-list');
  const recent = [...tickets].reverse().slice(0,5);
  recentEl.innerHTML = recent.length ? recent.map(t => `
    <div class="recent-item" onclick="openModal('${t.id}')">
      <div class="recent-dot" style="background:${pColor(t.priority)}"></div>
      <div class="recent-info">
        <div class="recent-title">${esc(t.title)}</div>
        <div class="recent-meta">${t.id} · ${fmtDate(t.createdAt)}</div>
      </div>
      <span class="badge badge-${t.status}">${statusLabel(t.status)}</span>
    </div>
  `).join('') : '<p style="color:var(--gray);font-size:.875rem;padding:.5rem 0">No tickets yet.</p>';

  // Chart: by client for admin/tech, by priority for user
  const chartEl = document.getElementById('chart-bars');
  if (currentUser.role === 'admin') {
    const clients = getClients();
    const maxC = Math.max(...clients.map(cl => tickets.filter(t=>t.clientId===cl.id).length), 1);
    chartEl.innerHTML = clients.map(cl => {
      const c = tickets.filter(t=>t.clientId===cl.id).length;
      return `<div class="chart-bar-row">
        <div class="chart-label" style="width:80px;font-size:.75rem">${esc(cl.name.split(' ')[0])}</div>
        <div class="chart-track"><div class="chart-fill" style="width:${Math.round(c/maxC*100)}%;background:${cl.color}"></div></div>
        <div class="chart-count" style="color:${cl.color}">${c}</div>
      </div>`;
    }).join('');
    document.querySelector('.priority-chart .section-header h2').textContent = 'By Client';
  } else {
    const priorities = ['critical','high','medium','low'];
    const maxC = Math.max(...priorities.map(p => tickets.filter(t=>t.priority===p).length), 1);
    chartEl.innerHTML = priorities.map(p => {
      const c = tickets.filter(t=>t.priority===p).length;
      return `<div class="chart-bar-row">
        <div class="chart-label">${p.charAt(0).toUpperCase()+p.slice(1)}</div>
        <div class="chart-track"><div class="chart-fill" style="width:${Math.round(c/maxC*100)}%;background:${pColor(p)}"></div></div>
        <div class="chart-count" style="color:${pColor(p)}">${c}</div>
      </div>`;
    }).join('');
    document.querySelector('.priority-chart .section-header h2').textContent = 'By Priority';
  }
}

// ── TICKETS TABLE ────────────────────────────────────────────────────────────
function filteredTickets() {
  return myTickets().filter(t => {
    const sOk = filterStatus === 'all' || t.status === filterStatus;
    const pOk = filterPriority === 'all' || t.priority === filterPriority;
    const cOk = filterClient === 'all' || t.clientId === filterClient;
    const qOk = !searchQuery || t.title.toLowerCase().includes(searchQuery) || t.id.toLowerCase().includes(searchQuery);
    return sOk && pOk && cOk && qOk;
  });
}

function renderTickets() {
  const h = document.getElementById('tickets-heading');
  h.textContent = currentUser.role === 'user' ? 'My Tickets' :
                  currentUser.role === 'technician' ? 'Assigned Tickets' : 'All Tickets';

  const newBtn = document.getElementById('new-ticket-btn');
  newBtn.style.display = CAN.createTicket() ? 'inline-flex' : 'none';

  // Client filter — admin only
  const clientFilterEl = document.getElementById('client-filter');
  if (currentUser.role === 'admin') {
    clientFilterEl.style.display = 'block';
    clientFilterEl.innerHTML = '<option value="all">All Clients</option>' +
      getClients().map(c => `<option value="${c.id}" ${filterClient===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  } else {
    clientFilterEl.style.display = 'none';
  }

  const tbody = document.getElementById('tickets-tbody');
  const empty = document.getElementById('empty-state');
  const list  = filteredTickets().slice().reverse();

  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    document.getElementById('empty-create-btn').style.display = CAN.createTicket() ? 'inline-flex' : 'none';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = list.map(t => `
      <tr onclick="openModal('${t.id}')">
        <td><span class="ticket-id">${t.id}</span></td>
        <td><span class="ticket-title-cell">${esc(t.title)}</span></td>
        <td><span class="badge badge-${t.priority}">${t.priority.charAt(0).toUpperCase()+t.priority.slice(1)}</span></td>
        <td><span class="badge badge-${t.status}">${statusLabel(t.status)}</span></td>
        <td style="color:var(--gray);font-size:.78rem">${esc(t.category)}</td>
        <td><span style="display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;font-weight:600;color:${getClientColor(t.clientId)}">
          <span style="width:7px;height:7px;border-radius:50%;background:${getClientColor(t.clientId)};flex-shrink:0"></span>
          ${esc(getClientName(t.clientId))}
        </span></td>
        <td style="color:var(--gray);font-size:.78rem">${getUserName(t.raisedBy)}</td>
        <td style="color:var(--gray);font-size:.78rem">${getUserName(t.assignedTo)||'Unassigned'}</td>
        <td style="color:var(--gray);font-size:.78rem">${fmtDate(t.createdAt)}</td>
        <td onclick="event.stopPropagation()">
          <div class="action-btns">
            ${CAN.editTicket(t)   ? `<button class="btn-icon" onclick="startEditTicket('${t.id}')">Edit</button>` : ''}
            ${CAN.deleteTicket(t) ? `<button class="btn-icon del" onclick="confirmDelete('${t.id}')">Delete</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }
}

// ── TICKET MODAL ─────────────────────────────────────────────────────────────
function openModal(id) {
  const t = getTickets().find(x => x.id === id);
  if (!t) return;
  currentModalTicketId = id;

  document.getElementById('modal-id').textContent    = t.id;
  document.getElementById('modal-title').textContent = t.title;
  document.getElementById('modal-desc').textContent  = t.description;
  document.getElementById('modal-cat').textContent    = t.category;
  const clientEl = document.getElementById('modal-client');
  clientEl.textContent = getClientName(t.clientId);
  clientEl.style.color = getClientColor(t.clientId);
  document.getElementById('modal-raised').textContent   = getUserName(t.raisedBy);
  document.getElementById('modal-assignee').textContent = getUserName(t.assignedTo) || 'Unassigned';
  document.getElementById('modal-date').textContent  = fmtDate(t.createdAt);

  const mp = document.getElementById('modal-priority');
  mp.className = 'badge badge-'+t.priority;
  mp.textContent = t.priority.charAt(0).toUpperCase()+t.priority.slice(1);

  const ms = document.getElementById('modal-status');
  ms.className = 'badge badge-'+t.status;
  ms.textContent = statusLabel(t.status);

  // Status update (tech on own tickets, admin always)
  const statusSec = document.getElementById('status-section');
  if (CAN.updateStatus(t)) {
    statusSec.style.display = 'block';
    document.querySelectorAll('.status-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.status === t.status)
    );
  } else {
    statusSec.style.display = 'none';
  }

  // Assign dropdown (admin only)
  const assignSec = document.getElementById('assign-section');
  if (CAN.assignTicket()) {
    assignSec.style.display = 'block';
    const sel = document.getElementById('modal-assign-select');
    const techs = getUsers().filter(u => u.role === 'technician');
    sel.innerHTML = `<option value="">Unassigned</option>` +
      techs.map(u => `<option value="${u.id}" ${t.assignedTo===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  } else {
    assignSec.style.display = 'none';
  }

  // Footer buttons
  document.getElementById('modal-delete').style.display = CAN.deleteTicket(t) ? 'inline-flex' : 'none';
  document.getElementById('modal-edit').style.display   = CAN.editTicket(t)   ? 'inline-flex' : 'none';

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  currentModalTicketId = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

document.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentModalTicketId) return;
    const tickets = getTickets();
    const idx = tickets.findIndex(t => t.id === currentModalTicketId);
    if (idx === -1) return;
    tickets[idx].status = btn.dataset.status;
    save(K.tickets, tickets);
    openModal(currentModalTicketId);
    if (currentView === 'tickets') renderTickets();
    showToast('Status updated', 'info');
  });
});

document.getElementById('modal-assign-btn').addEventListener('click', () => {
  if (!currentModalTicketId) return;
  const tickets = getTickets();
  const idx = tickets.findIndex(t => t.id === currentModalTicketId);
  const sel = document.getElementById('modal-assign-select').value;
  tickets[idx].assignedTo = sel;
  save(K.tickets, tickets);
  openModal(currentModalTicketId);
  if (currentView === 'tickets') renderTickets();
  showToast('Ticket assigned', 'info');
});

document.getElementById('modal-delete').addEventListener('click', () => {
  if (currentModalTicketId) confirmDelete(currentModalTicketId);
});
document.getElementById('modal-edit').addEventListener('click', () => {
  if (currentModalTicketId) startEditTicket(currentModalTicketId);
});

// ── CREATE / EDIT TICKET ─────────────────────────────────────────────────────
function setupForm() {
  document.getElementById('form-title').textContent  = editingTicketId ? 'Edit Ticket'   : 'Raise a Ticket';
  document.getElementById('submit-btn').textContent  = editingTicketId ? 'Save Changes'  : 'Submit Ticket';

  // Populate categories
  const catSel = document.getElementById('f-category');
  catSel.innerHTML = '<option value="">Select category</option>' +
    getCategories().map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');

  // Assign-to group (admin only)
  const ag = document.getElementById('assign-group');
  if (CAN.assignTicket()) {
    ag.style.display = 'block';
    const asel = document.getElementById('f-assignee');
    asel.innerHTML = '<option value="">Unassigned</option>' +
      getUsers().filter(u=>u.role==='technician').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  } else {
    ag.style.display = 'none';
  }

  if (!editingTicketId) {
    document.getElementById('ticket-form').reset();
    selectedPriority = 'medium';
    refreshPrioBtns();
    return;
  }

  const t = getTickets().find(x => x.id === editingTicketId);
  if (!t) return;
  document.getElementById('f-title').value    = t.title;
  document.getElementById('f-desc').value     = t.description;
  catSel.value                                 = t.category;
  if (CAN.assignTicket()) document.getElementById('f-assignee').value = t.assignedTo || '';
  selectedPriority = t.priority;
  refreshPrioBtns();
}

function refreshPrioBtns() {
  document.querySelectorAll('.prio-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === selectedPriority)
  );
}

document.getElementById('priority-selector').addEventListener('click', e => {
  const btn = e.target.closest('.prio-btn');
  if (!btn) return;
  selectedPriority = btn.dataset.value;
  refreshPrioBtns();
});

document.getElementById('ticket-form').addEventListener('submit', e => {
  e.preventDefault();
  const title    = document.getElementById('f-title').value.trim();
  const desc     = document.getElementById('f-desc').value.trim();
  const category = document.getElementById('f-category').value;
  const assignee = CAN.assignTicket() ? document.getElementById('f-assignee').value : '';

  const tickets = getTickets();
  if (editingTicketId) {
    const idx = tickets.findIndex(t => t.id === editingTicketId);
    tickets[idx] = { ...tickets[idx], title, description:desc, category, priority:selectedPriority,
                     ...(CAN.assignTicket() && { assignedTo: assignee }) };
    save(K.tickets, tickets);
    editingTicketId = null;
    showToast('Ticket updated');
  } else {
    const newTicket = { id:genId(), title, description:desc, category, priority:selectedPriority,
                        status:'open', raisedBy:currentUser.id, assignedTo:assignee,
                        clientId: currentUser.clientId || '',
                        createdAt:new Date().toISOString() };
    tickets.push(newTicket);
    save(K.tickets, tickets);
    sendEmailAlert(newTicket);
    showToast('Ticket submitted!');
  }
  editingTicketId = null;
  switchView('tickets');
});

document.getElementById('cancel-form').addEventListener('click', () => {
  editingTicketId = null; switchView('tickets');
});

function startEditTicket(id) {
  editingTicketId = id;
  closeModal();
  switchView('create');
}

function confirmDelete(id) {
  if (!confirm('Permanently delete this ticket?')) return;
  const tickets = getTickets().filter(t => t.id !== id);
  save(K.tickets, tickets);
  closeModal();
  if (currentView === 'tickets') renderTickets();
  if (currentView === 'dashboard') renderDashboard();
  showToast('Ticket deleted', 'error');
}

// ── FILTERS ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    filterStatus = btn.dataset.filter;
    renderTickets();
  });
});
document.getElementById('priority-filter').addEventListener('change', e => {
  filterPriority = e.target.value; renderTickets();
});
document.getElementById('client-filter').addEventListener('change', e => {
  filterClient = e.target.value; renderTickets();
});
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase().trim();
  if (currentView === 'tickets') renderTickets();
});

// ── USER MANAGEMENT (Admin) ───────────────────────────────────────────────────
function renderUsers() {
  const users = getUsers();
  const tickets = getTickets();
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = users.map(u => {
    const count = tickets.filter(t => t.raisedBy === u.id || t.assignedTo === u.id).length;
    const isSelf = u.id === currentUser.id;
    const client = getClients().find(c=>c.id===u.clientId);
    return `<tr>
      <td style="font-family:monospace;font-size:.82rem">${esc(u.username)}</td>
      <td style="font-weight:500">${esc(u.name)}</td>
      <td><span class="role-tag ${u.role}">${roleCap(u.role)}</span></td>
      <td>${client ? `<span style="display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;color:${client.color}">
        <span style="width:7px;height:7px;border-radius:50%;background:${client.color}"></span>${esc(client.name)}</span>` : '<span style="color:var(--gray)">—</span>'}</td>
      <td style="color:var(--gray)">${count}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" onclick="openEditUser('${u.id}')">Edit</button>
          ${!isSelf ? `<button class="btn-icon" onclick="resetUserPassword('${u.id}')">Reset Password</button>` : ''}
          ${!isSelf ? `<button class="btn-icon del" onclick="deleteUser('${u.id}')">Remove</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Add user modal
function populateClientDropdown(selectedId='') {
  const sel = document.getElementById('uf-client');
  sel.innerHTML = '<option value="">No Client</option>' +
    getClients().map(c => `<option value="${c.id}" ${selectedId===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
}

document.getElementById('open-add-user').addEventListener('click', () => {
  editingUserId = null;
  document.getElementById('user-modal-title').textContent = 'Add User';
  document.getElementById('user-submit-btn').textContent  = 'Add User';
  document.getElementById('user-form').reset();
  document.getElementById('pw-req').style.display = 'inline';
  document.getElementById('uf-domain-hint').textContent = '';
  document.getElementById('uf-domain-hint').style.color = '';
  populateClientDropdown();
  document.getElementById('user-modal-overlay').classList.add('open');
});

// Auto-detect client from email domain
document.getElementById('uf-username').addEventListener('input', e => {
  const email  = e.target.value.trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  const hint   = document.getElementById('uf-domain-hint');
  const sel    = document.getElementById('uf-client');
  if (domain) {
    const match = getClients().find(c => c.domain && c.domain.toLowerCase() === domain);
    if (match) {
      hint.textContent = '✓ Auto-linked to: ' + match.name;
      hint.style.color = match.color;
      sel.value = match.id;
    } else {
      hint.textContent = 'No client matches this domain — assign manually below';
      hint.style.color = 'var(--gray)';
    }
  } else {
    hint.textContent = '';
  }
});

function openEditUser(id) {
  const u = getUsers().find(x=>x.id===id);
  if (!u) return;
  editingUserId = id;
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('user-submit-btn').textContent  = 'Save Changes';
  document.getElementById('uf-username').value = u.username;
  document.getElementById('uf-name').value     = u.name;
  document.getElementById('uf-pass').value     = '';
  document.getElementById('uf-role').value     = u.role;
  document.getElementById('pw-req').style.display = 'none';
  populateClientDropdown(u.clientId || '');
  // Show domain hint
  const domain = u.username.includes('@') ? u.username.split('@')[1] : '';
  const hint   = document.getElementById('uf-domain-hint');
  const match  = domain ? getClients().find(c => c.domain && c.domain.toLowerCase() === domain) : null;
  hint.textContent = match ? '✓ Linked to: ' + match.name : '';
  hint.style.color = match ? match.color : '';
  document.getElementById('user-modal-overlay').classList.add('open');
}

document.getElementById('user-form').addEventListener('submit', e => {
  e.preventDefault();
  const username = document.getElementById('uf-username').value.trim().toLowerCase();
  const name     = document.getElementById('uf-name').value.trim();
  const pass     = document.getElementById('uf-pass').value;
  const role     = document.getElementById('uf-role').value;
  const clientId = document.getElementById('uf-client').value;
  const users    = getUsers();

  if (editingUserId) {
    const idx = users.findIndex(u=>u.id===editingUserId);
    users[idx] = { ...users[idx], username, name, role, clientId, ...(pass && { password: pass }) };
    // Update session if editing self
    if (editingUserId === currentUser.id) { currentUser = users[idx]; bootApp(currentUser); }
    save(K.users, users);
    showToast('User updated');
  } else {
    if (!pass || pass.length < 6) { alert('Password must be at least 6 characters.'); return; }
    if (users.find(u=>u.username.toLowerCase()===username)) { alert('Email already exists.'); return; }
    users.push({ id:'u'+Date.now(), username, name, password:pass, role, clientId, mustChangePassword:true });
    save(K.users, users);
    showToast('User added — they must set a new password on first login');
  }
  closeUserModal();
  renderUsers();
});

function deleteUser(id) {
  if (id === currentUser.id) { showToast('Cannot delete yourself', 'error'); return; }
  if (!confirm('Remove this user? Their tickets will remain.')) return;
  save(K.users, getUsers().filter(u=>u.id!==id));
  renderUsers();
  showToast('User removed', 'error');
}

function closeUserModal() {
  document.getElementById('user-modal-overlay').classList.remove('open');
  editingUserId = null;
}
document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
document.getElementById('user-modal-cancel').addEventListener('click', closeUserModal);
document.getElementById('user-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('user-modal-overlay')) closeUserModal();
});

// ── OTP / PASSWORD RESET (Admin) ─────────────────────────────────────────────
function genOTP() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length: 10}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function resetUserPassword(id) {
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx < 0) return;
  const otp = genOTP();
  users[idx] = { ...users[idx], password: otp, mustChangePassword: true };
  save(K.users, users);
  // Show OTP modal
  document.getElementById('otp-email').textContent = users[idx].username;
  document.getElementById('otp-value').textContent = otp;
  document.getElementById('otp-copy-btn').textContent = 'Copy OTP';
  document.getElementById('otp-modal-overlay').classList.add('open');
}

function copyOTP() {
  const otp = document.getElementById('otp-value').textContent;
  navigator.clipboard.writeText(otp).then(() => {
    const btn = document.getElementById('otp-copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy OTP'; }, 2000);
  });
}

// ── CLIENT MANAGEMENT (Admin) ─────────────────────────────────────────────────
function getPortalUrl(clientId) {
  const base = window.location.href.split('?')[0];
  return `${base}?client=${clientId}`;
}

function renderClients() {
  const clients = getClients();
  const tickets = getTickets();
  const users   = getUsers();
  const grid    = document.getElementById('client-grid');

  if (!clients.length) {
    grid.innerHTML = '<div class="client-table-wrap"><p style="padding:2rem;color:var(--gray);font-size:.875rem">No clients yet. Click "+ Add Client" to create one.</p></div>';
    return;
  }

  grid.innerHTML = `
    <div class="client-table-wrap">
      <table class="client-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Users</th>
            <th>Tickets</th>
            <th>Portal Link</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(c => {
            const ticketCount = tickets.filter(t=>t.clientId===c.id).length;
            const userCount   = users.filter(u=>u.clientId===c.id).length;
            const openCount   = tickets.filter(t=>t.clientId===c.id && t.status==='open').length;
            const portalUrl   = getPortalUrl(c.id);
            return `<tr>
              <td>
                <div class="client-name-cell">
                  <div class="client-color-badge" style="background:${c.color}"></div>
                  <span style="font-weight:600">${esc(c.name)}</span>
                </div>
              </td>
              <td style="color:var(--gray);font-size:.85rem">${userCount}</td>
              <td style="font-size:.85rem">
                <span style="color:var(--gray)">${ticketCount} total</span>
                ${openCount ? `<span style="color:#ff7070;margin-left:.5rem">${openCount} open</span>` : ''}
              </td>
              <td>
                <div class="client-link-cell">
                  <input class="client-link-input" type="text" value="${esc(portalUrl)}" readonly
                    onclick="this.select()" title="Click to select, then copy"/>
                  <button class="copy-btn" id="copy-${c.id}" onclick="copyPortalUrl('${c.id}','${esc(portalUrl)}')">Copy</button>
                  <a href="${esc(portalUrl)}" target="_blank" class="btn-icon" style="text-decoration:none;white-space:nowrap">Open ↗</a>
                </div>
              </td>
              <td>
                <div class="action-btns">
                  <button class="btn-icon" onclick="openEditClient('${c.id}')">Edit</button>
                  <button class="btn-icon del" onclick="deleteClient('${c.id}')">Delete</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function copyPortalUrl(clientId, url) {
  const btn = document.getElementById('copy-' + clientId);
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

let selectedClientColor = '#6c47ff';

document.getElementById('open-add-client').addEventListener('click', () => {
  document.getElementById('edit-client-id').value = '';
  document.getElementById('clf-name').value   = '';
  document.getElementById('clf-domain').value = '';
  document.getElementById('client-modal-title').textContent = 'Add Client';
  document.getElementById('client-submit-btn').textContent  = 'Add Client';
  document.getElementById('clf-link-group').style.display  = 'none';
  document.getElementById('clf-link').value = '';
  selectedClientColor = '#6c47ff';
  document.querySelectorAll('#client-color-options .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === '#6c47ff')
  );
  document.getElementById('client-modal-overlay').classList.add('open');
});

function openEditClient(id) {
  const c = getClients().find(x=>x.id===id);
  if (!c) return;
  document.getElementById('edit-client-id').value = id;
  document.getElementById('clf-name').value   = c.name;
  document.getElementById('clf-domain').value = c.domain || '';
  document.getElementById('client-modal-title').textContent = 'Edit Client';
  document.getElementById('client-submit-btn').textContent  = 'Save Changes';
  selectedClientColor = c.color;
  document.querySelectorAll('#client-color-options .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === c.color)
  );
  // Always show portal link when editing
  document.getElementById('clf-link').value = getPortalUrl(id);
  document.getElementById('clf-link-group').style.display = 'block';
  document.getElementById('client-modal-overlay').classList.add('open');
}

document.getElementById('client-color-options').addEventListener('click', e => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  selectedClientColor = dot.dataset.color;
  document.querySelectorAll('#client-color-options .color-dot').forEach(d =>
    d.classList.toggle('active', d === dot)
  );
});

document.getElementById('client-form').addEventListener('submit', e => {
  e.preventDefault();
  const name    = document.getElementById('clf-name').value.trim();
  const domain  = document.getElementById('clf-domain').value.trim().toLowerCase().replace(/^@/, '');
  const editId  = document.getElementById('edit-client-id').value;
  const clients = getClients();
  let savedId   = editId;

  if (editId) {
    const idx = clients.findIndex(c=>c.id===editId);
    clients[idx] = { ...clients[idx], name, color: selectedClientColor, domain };
    showToast('Client updated');
  } else {
    if (clients.find(c=>c.name.toLowerCase()===name.toLowerCase())) { alert('Client already exists.'); return; }
    savedId = 'cl' + Date.now();
    clients.push({ id: savedId, name, color: selectedClientColor, domain });
    showToast('Client added — copy the portal link below!', 'info');
  }

  save(K.clients, clients);
  renderClients();

  // Show portal link inside the modal
  const portalUrl = getPortalUrl(savedId);
  document.getElementById('clf-link').value = portalUrl;
  document.getElementById('clf-link-group').style.display = 'block';
  document.getElementById('client-submit-btn').textContent = 'Save Changes';
  document.getElementById('edit-client-id').value = savedId;
  document.getElementById('client-modal-title').textContent = 'Client Saved ✓';
});

function deleteClient(id) {
  const ticketCount = getTickets().filter(t=>t.clientId===id).length;
  const userCount   = getUsers().filter(u=>u.clientId===id).length;
  if (ticketCount || userCount) {
    if (!confirm(`This client has ${userCount} user(s) and ${ticketCount} ticket(s). Delete anyway?`)) return;
  } else {
    if (!confirm('Delete this client?')) return;
  }
  save(K.clients, getClients().filter(c=>c.id!==id));
  renderClients();
  showToast('Client deleted', 'error');
}

function copyModalLink() {
  const url = document.getElementById('clf-link').value;
  const btn = document.getElementById('clf-copy-btn');
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

function closeClientModal() { document.getElementById('client-modal-overlay').classList.remove('open'); }
document.getElementById('client-modal-close').addEventListener('click', closeClientModal);
document.getElementById('client-modal-cancel').addEventListener('click', closeClientModal);
document.getElementById('client-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('client-modal-overlay')) closeClientModal();
});

// ── CATEGORY MANAGEMENT (Admin) ───────────────────────────────────────────────
function renderCategories() {
  const cats    = getCategories();
  const tickets = getTickets();
  const grid    = document.getElementById('cat-grid');
  grid.innerHTML = cats.map(c => {
    const count = tickets.filter(t=>t.category===c.name).length;
    return `<div class="cat-card">
      <div class="cat-left">
        <div class="cat-dot" style="background:${c.color}"></div>
        <div>
          <div class="cat-name">${esc(c.name)}</div>
          <div class="cat-count">${count} ticket${count!==1?'s':''}</div>
        </div>
      </div>
      <button class="cat-del" onclick="deleteCategory('${c.id}')" title="Delete">×</button>
    </div>`;
  }).join('');
}

document.getElementById('open-add-cat').addEventListener('click', () => {
  document.getElementById('cf-name').value = '';
  selectedCatColor = '#6c47ff';
  document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color==='#6c47ff'));
  document.getElementById('cat-modal-overlay').classList.add('open');
});

document.getElementById('color-options').addEventListener('click', e => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  selectedCatColor = dot.dataset.color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d===dot));
});

document.getElementById('cat-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('cf-name').value.trim();
  const cats = getCategories();
  if (cats.find(c=>c.name.toLowerCase()===name.toLowerCase())) { alert('Category already exists.'); return; }
  cats.push({ id:'c'+Date.now(), name, color:selectedCatColor });
  save(K.categories, cats);
  closeCatModal();
  renderCategories();
  showToast('Category added');
});

function deleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  save(K.categories, getCategories().filter(c=>c.id!==id));
  renderCategories();
  showToast('Category deleted', 'error');
}

function closeCatModal() { document.getElementById('cat-modal-overlay').classList.remove('open'); }
document.getElementById('cat-modal-close').addEventListener('click', closeCatModal);
document.getElementById('cat-modal-cancel').addEventListener('click', closeCatModal);
document.getElementById('cat-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('cat-modal-overlay')) closeCatModal();
});

// ── MISC ─────────────────────────────────────────────────────────────────────
document.getElementById('new-ticket-btn').addEventListener('click', () => {
  editingTicketId = null; switchView('create');
});
document.getElementById('empty-create-btn').addEventListener('click', () => {
  editingTicketId = null; switchView('create');
});
document.getElementById('menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.querySelectorAll('[data-view]').forEach(el => {
  if (el.classList.contains('view-all')) {
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); });
  }
});

// ── INIT ─────────────────────────────────────────────────────────────────────
seedData();
initLogin();

// Resume session if already logged in
const session = getSession();
if (session) {
  const user = getUsers().find(u => u.id === session.id);
  if (user) {
    if (user.mustChangePassword) {
      showChangePasswordScreen(user);
    } else {
      bootApp(user);
    }
  }
}
