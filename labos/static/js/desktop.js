/* Window manager + desktop shell. Apps register themselves in window.APPS (apps.js). */
const $ = (s, r = document) => r.querySelector(s);
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
                               body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) location.href = '/login';
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
};

/* ---- Icons (inline SVG) ---- */
const ICON = {
  word:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/>',
  sheet:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  ide:'<path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12"/>',
  term:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10l3 2-3 2M12 15h4"/>',
  files:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  settings:'<path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  admin:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  logout:'<path d="M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h4M15 8l4 4-4 4M19 12H9"/>' };
const svg = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[id] || ICON.files}</svg>`;
const tile = id => `<span class="tile" data-app="${id}">${svg(id)}</span>`;
let CTX = 'files';   // app that is currently launching (gives its window the right icon)

const WM = (() => {
  let z = 10, n = 0; const wins = new Map();
  const desktop = $('#desktop'), tasks = $('#tasks');

  function focus(w) {
    wins.forEach(o => { o.el.classList.remove('active'); o.btn.classList.remove('active'); });
    w.el.classList.remove('min'); w.el.classList.add('active'); w.btn.classList.add('active');
    w.el.style.zIndex = ++z;
  }
  function minimize(w) { w.el.classList.add('min'); w.el.classList.remove('active'); w.btn.classList.remove('active'); }
  function close(w) { w.onClose && w.onClose(); w.el.remove(); w.btn.remove(); wins.delete(w.id); }

  function open({ title, width = 720, height = 480, onClose }) {
    const id = ++n, el = document.createElement('div'), app = CTX;
    el.className = 'win';
    const off = (id % 8) * 28;
    Object.assign(el.style, { left: 90 + off + 'px', top: 30 + off + 'px',
      width: Math.min(width, innerWidth - 20) + 'px', height: Math.min(height, innerHeight - 100) + 'px' });
    el.innerHTML = `<div class="win-head"><span class="win-ico">${svg(app)}</span><div class="win-title"></div>
      <button class="win-btn min" title="Minimize">&#8211;</button>
      <button class="win-btn max" title="Maximize">&#9633;</button>
      <button class="win-btn close" title="Close">&#10005;</button></div>
      <div class="win-body"></div><div class="grip"></div>`;
    const btn = document.createElement('button'); btn.className = 'task open'; btn.innerHTML = svg(app);
    const w = { id, el, btn, body: $('.win-body', el), onClose,
      setTitle(t) { $('.win-title', el).textContent = t; btn.title = t; } };
    w.setTitle(title); w.close = () => close(w);
    desktop.appendChild(el); tasks.appendChild(btn); wins.set(id, w);

    el.addEventListener('pointerdown', () => focus(w), true);
    btn.onclick = () => (el.classList.contains('min') || !el.classList.contains('active')) ? focus(w) : minimize(w);
    $('.min', el).onclick = () => minimize(w);
    $('.close', el).onclick = () => close(w);
    const toggleMax = () => el.classList.toggle('max');
    $('.max', el).onclick = toggleMax;
    $('.win-head', el).ondblclick = e => { if (!e.target.closest('button')) toggleMax(); };

    // Drag (header) and resize (grip) share one pointer-tracking helper.
    const track = (startEvt, onMove) => {
      startEvt.preventDefault(); document.body.classList.add('dragging');
      const move = e => onMove(e), up = () => {
        document.body.classList.remove('dragging');
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    $('.win-head', el).addEventListener('pointerdown', e => {
      if (e.target.closest('button') || el.classList.contains('max')) return;
      const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
      track(e, m => {
        el.style.left = Math.min(Math.max(m.clientX - dx, -el.offsetWidth + 80), innerWidth - 80) + 'px';
        el.style.top = Math.min(Math.max(m.clientY - dy, 0), desktop.clientHeight - 36) + 'px';
      });
    });
    $('.grip', el).addEventListener('pointerdown', e => {
      const w0 = el.offsetWidth, h0 = el.offsetHeight, x0 = e.clientX, y0 = e.clientY;
      track(e, m => {
        el.style.width = Math.max(280, w0 + m.clientX - x0) + 'px';
        el.style.height = Math.max(160, h0 + m.clientY - y0) + 'px';
      });
    });
    focus(w); return w;
  }
  return { open, focus, minimize };
})();

/* ---- Theme (Light / Dark / Match system), accent color, wallpaper ---- */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t) {
  const root = document.documentElement;
  root.dataset.themePref = t || 'light';
  root.dataset.theme = t === 'system' ? (darkMQ.matches ? 'dark' : 'light') : (t || 'light');
}
darkMQ.addEventListener('change', () => {
  if (document.documentElement.dataset.themePref === 'system') applyTheme('system'); });

const ACCENTS = ['#2f5bea', '#7a5af8', '#0f9d8f', '#1f9d6b', '#e0592a', '#d6457a'];   // first one = default
const WALLPAPERS = {
  aurora:   { name: 'Aurora',   l: ['#cfdcff', '#d6efe4'], d: ['#1a2a5c', '#0f3a35'] },
  sunset:   { name: 'Sunset',   l: ['#ffd9c7', '#ffeab8'], d: ['#4a2234', '#3d2c12'] },
  ocean:    { name: 'Ocean',    l: ['#bfe6f2', '#c9d7ff'], d: ['#0c3550', '#17254f'] },
  forest:   { name: 'Forest',   l: ['#cdeccd', '#e6f2c4'], d: ['#123a24', '#263a12'] },
  lavender: { name: 'Lavender', l: ['#e3d4ff', '#ffd6ec'], d: ['#2f1f5a', '#4a1f3d'] },
  slate:    { name: 'Slate',    l: ['#e4e8ef', '#dde2ea'], d: ['#161b25', '#12161e'] } };
const readable = hex => {            // white or dark text, whichever is easier to read on this color
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#10141c' : '#ffffff'; };
function applyPrefs(p = {}) {
  let s = document.getElementById('user-prefs');
  if (!s) { s = document.createElement('style'); s.id = 'user-prefs'; document.head.appendChild(s); }
  const a = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : null, wp = WALLPAPERS[p.wallpaper];
  let css = '';
  if (a) css += `:root{--accent:${a};--accent-soft:color-mix(in srgb,${a} 14%,var(--surface));--accent-text:${readable(a)};--grid:color-mix(in srgb,${a} 7%,transparent)}
    [data-theme="dark"]{--accent:color-mix(in srgb,${a} 78%,#fff);--accent-soft:color-mix(in srgb,${a} 24%,var(--surface));--accent-text:#0c1018;--grid:color-mix(in srgb,${a} 9%,transparent)}`;
  if (wp) css += `:root{--w1:${wp.l[0]};--w2:${wp.l[1]}}
    [data-theme="dark"]{--w1:${wp.d[0]};--w2:${wp.d[1]}}`;
  s.textContent = css;
}

/* ---- Auto sign-out when idle ---- */
(() => {
  const s = document.createElement('style');
  s.textContent = `
    #idle-dlg{position:fixed;inset:0;z-index:200000;display:grid;place-items:center;background:rgba(10,15,25,.45);backdrop-filter:blur(3px)}
    .idle-box{width:360px;max-width:calc(100% - 32px);padding:24px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh-lg)}
    .idle-box h3{margin:0 0 8px;font-size:18px}.idle-box p{margin:0 0 18px;color:var(--muted);line-height:1.5}
    .idle-box .row{display:flex;gap:8px}`;
  document.head.appendChild(s);
})();
let idleT = null, countT = null, idleMs = 0, lastBump = 0;
function startIdle() {
  clearTimeout(idleT); clearInterval(countT);
  document.getElementById('idle-dlg')?.remove();
  idleMs = (+(LAB.prefs && LAB.prefs.idle) || 0) * 60000;
  if (idleMs) idleT = setTimeout(showIdleWarning, idleMs);
}
function bumpIdle() {
  if (!idleMs || document.getElementById('idle-dlg')) return;
  const now = Date.now(); if (now - lastBump < 1000) return;
  lastBump = now; clearTimeout(idleT); idleT = setTimeout(showIdleWarning, idleMs);
}
function showIdleWarning() {
  if (document.getElementById('idle-dlg')) return;
  let left = 30;
  const d = document.createElement('div'); d.id = 'idle-dlg';
  d.innerHTML = `<div class="idle-box"><h3>Still there?</h3>
    <p>You will be signed out in <b id="idle-n">30</b> seconds because there has been no activity.</p>
    <div class="row"><button class="primary" id="idle-stay">Stay signed in</button><button id="idle-out">Sign out now</button></div></div>`;
  document.body.appendChild(d);
  countT = setInterval(() => { left--; document.getElementById('idle-n').textContent = left; if (left <= 0) location.href = '/logout'; }, 1000);
  document.getElementById('idle-stay').onclick = () => { clearInterval(countT); d.remove(); startIdle(); };
  document.getElementById('idle-out').onclick = () => { location.href = '/logout'; };
}
['pointerdown', 'keydown', 'wheel', 'pointermove', 'touchstart'].forEach(ev =>
  addEventListener(ev, bumpIdle, { passive: true, capture: true }));

function buildShell() {
  const list = Object.values(APPS);
  list.forEach(a => { const go = a.launch.bind(a); a.launch = (...x) => { CTX = a.id; return go(...x); }; });

  $('#icons').innerHTML = list.map(a => `<div class="icon" tabindex="0" data-app="${a.id}">${tile(a.id)}<span>${a.name}</span></div>`).join('');
  const launchFrom = e => { const i = e.target.closest('.icon'); i && APPS[i.dataset.app].launch(); };
  $('#icons').addEventListener('dblclick', launchFrom);
  $('#icons').addEventListener('keydown', e => { if (e.key === 'Enter') launchFrom(e); });

  const initial = LAB.user[0].toUpperCase();
  $('#who-av').textContent = initial; $('#who-name').textContent = LAB.user;
  $('#start-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/></svg>';

  const menu = $('#start-menu');
  menu.innerHTML = `<div class="sm-head"><span class="avatar">${initial}</span><div><b>${LAB.user}</b><small>${LAB.admin ? 'Administrator' : 'Student'}</small></div></div>
    <div class="sm-grid">${list.map(a => `<button class="sm-app" data-app="${a.id}">${tile(a.id)}${a.name}</button>`).join('')}</div>
    <div class="sm-foot">${LAB.admin ? `<button data-go="/admin">${svg('admin')}Admin panel</button>` : ''}<button data-go="/logout">${svg('logout')}Sign out</button></div>`;
  menu.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) location.href = b.dataset.go; else APPS[b.dataset.app].launch();
    menu.classList.remove('show');
  };
  $('#start-btn').onclick = e => { e.stopPropagation(); menu.classList.toggle('show'); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#start-menu, #start-btn')) menu.classList.remove('show'); });

  const tick = () => {
    const d = new Date(), h = d.getHours();
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#clock').textContent = t; $('#hero-time').textContent = t;
    $('#hero-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('#hero-hi').textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${LAB.user}`;
  };
  tick(); setInterval(tick, 15000);

  api('/api/me').then(d => {
    applyTheme(d.theme);
    if (d.announcements.length) {
      const b = $('#banner'); b.hidden = false;
      b.innerHTML = `<button class="x" aria-label="Dismiss">&#10005;</button><b>Lab announcements</b>` +
        d.announcements.map(m => `<div>${m.replace(/</g, '&lt;')}</div>`).join('');
      $('.x', b).onclick = () => b.hidden = true;
    }
  });
}
applyTheme(LAB.theme);
applyPrefs(LAB.prefs);
window.addEventListener('DOMContentLoaded', () => { if (typeof APPS !== 'undefined') buildShell(); startIdle(); });
