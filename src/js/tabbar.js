// Touch navigation dock.
//
// Anatomy:   [ Home  Library  Search  Settings ]  ( + )
//            └──────── glass pill ────────────┘  └ action orb
//
// Design decisions:
//  - Destinations live in the pill; Create is an *action*, so it sits apart as its own orb (same glass
//    material and height, so the two read as one family). It's on the right, under the thumb.
//  - Every tab is labelled: icon-only bars make people guess. When the dock condenses on scroll the
//    labels fold away and the icons recentre.
//  - Glyphs are drawn for this bar (24px grid, 1.75 stroke) with a filled twin for the active state,
//    crossfaded, so selection reads from shape as well as colour.
//  - The selection lens is a critically-damped spring (not CSS timing). It stretches with velocity, and
//    the pill's rim catches a light that tracks it (--lx).
//  - Press and drag across the pill to scrub between tabs; the lens follows your finger and lifts.
//  - Honors Reduce motion (lens jumps, no stretch, no rim light travel).
import { h } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';
// o = outline (rest), f = filled (active). Paths share geometry so the crossfade doesn't jump.
const GLYPHS = {
  home: {
    o: '<path d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5H15v-5a1.25 1.25 0 0 0-1.25-1.25h-3.5A1.25 1.25 0 0 0 9 15.5v5H5.5A1.5 1.5 0 0 1 4 19z"/>',
    f: '<path fill="currentColor" d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5H15v-5a1.25 1.25 0 0 0-1.25-1.25h-3.5A1.25 1.25 0 0 0 9 15.5v5H5.5A1.5 1.5 0 0 1 4 19z"/>',
  },
  library: { // a stack of cards: it's a flashcard library
    o: '<rect x="3.5" y="7.5" width="13.5" height="12.5" rx="2.5"/><path d="M7.5 4.25h10.25A2.75 2.75 0 0 1 20.5 7v9.25"/>',
    f: '<rect x="3.5" y="7.5" width="13.5" height="12.5" rx="2.5" fill="currentColor"/><path d="M7.5 4.25h10.25A2.75 2.75 0 0 1 20.5 7v9.25"/>',
  },
  search: {
    o: '<circle cx="11" cy="11" r="6.25"/><path d="m15.6 15.6 4.4 4.4"/>',
    f: '<circle cx="11" cy="11" r="6.25" fill="currentColor" fill-opacity=".22"/><path d="m15.6 15.6 4.4 4.4" stroke-width="2.25"/>',
  },
  settings: { // sliders: Settings also holds stats and achievements, a gear undersells it
    o: '<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.25"/><circle cx="8.5" cy="17" r="2.25"/>',
    f: '<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.6" fill="currentColor"/><circle cx="8.5" cy="17" r="2.6" fill="currentColor"/>',
  },
  plus: { o: '<path d="M12 5.5v13M5.5 12h13"/>' },
};
function glyph(name) {
  const svg = document.createElementNS(NS, 'svg');
  Object.entries({ viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
    .forEach(([k, v]) => svg.setAttribute(k, v));
  const g = GLYPHS[name];
  svg.innerHTML = `<g class="o">${g.o}</g>${g.f ? `<g class="f">${g.f}</g>` : ''}`;
  return svg;
}

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' },
];

let st = null; // persistent state across re-renders

export function renderTabbar({ route, badge, onSelect }) {
  const bar = document.getElementById('tabbar'); if (!bar) return;
  document.getElementById('tab-search')?.remove(); // legacy floating search button
  if (!document.body.classList.contains('tabbar-mode')) { bar.innerHTML = ''; bar.classList.remove('dock'); st = null; return; }
  const activeId = route === 'library' || route === 'folder' || route === 'set' || route === 'edit' ? 'library'
    : route === 'settings' || route === 'stats' || route === 'achievements' ? 'settings'
    : route === 'browser' ? 'search' : route === 'home' ? 'home' : null;

  if (!st || !bar.contains(st.track)) build(bar);
  st.onSelect = onSelect;
  st.btns.forEach((b, id) => {
    const on = id === activeId;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const bd = st.badge, n = badge > 99 ? '99+' : String(badge || '');
  if (bd.textContent !== n) bd.textContent = n;
  bd.classList.toggle('show', !!badge);
  st.btns.get('home').setAttribute('aria-label', badge ? `Home, ${badge} cards due` : 'Home');
  if (st.active !== activeId) { st.active = activeId; if (activeId) pop(st.btns.get(activeId)); }
  requestAnimationFrame(() => moveLensTo(activeId, { instant: !st.ready }));
  st.ready = true;
}

function build(bar) {
  bar.innerHTML = ''; bar.className = 'tabbar dock';
  const lens = h('div', { class: 'dk-lens', 'aria-hidden': 'true' });
  const track = h('div', { class: 'dk-track' }, lens);
  const btns = new Map(); let badge = null;
  for (const t of TABS) {
    const ico = h('span', { class: 'dk-ico' }, glyph(t.id));
    if (t.id === 'home') { badge = h('span', { class: 'dk-badge', 'aria-hidden': 'true' }); ico.append(badge); }
    const b = h('button', { type: 'button', class: 'dk-item', 'data-id': t.id, 'aria-label': t.label },
      ico, h('span', { class: 'dk-lbl', 'aria-hidden': 'true' }, t.label));
    btns.set(t.id, b); track.append(b);
  }
  const pill = h('div', { class: 'dk-pill dk-glass' }, track);
  const orb = h('button', { type: 'button', class: 'dk-orb dk-glass', 'aria-label': 'Create', title: 'Create' },
    h('span', { class: 'dk-core' }, h('span', { class: 'dk-ico' }, glyph('plus'))));
  bar.append(pill, orb);
  st = { bar, pill, track, lens, btns, badge, orb, active: null, ready: false, onSelect: null,
    spring: { x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, raf: 0, last: 0 }, drag: null, mini: false };
  wirePointer(); wireOrb(); wireScroll();
}

// ---------- spring ----------
const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
function moveLensTo(id, { instant = false } = {}) {
  if (!st) return;
  const b = id && st.btns.get(id); const s = st.spring;
  if (!b) { st.lens.classList.add('gone'); st.pill.style.setProperty('--lx', '-200px'); return; }
  st.lens.classList.remove('gone');
  s.tx = b.offsetLeft; s.tw = b.offsetWidth; // layout units: unaffected by the dock's condense scale
  if (instant || reduced() || !s.w) { s.x = s.tx; s.w = s.tw; s.vx = s.vw = 0; paint(0); return; }
  kick();
}
function followX(clientX) { // drag: lens centre tracks the finger
  const s = st.spring, tr = st.track.getBoundingClientRect(); const k = tr.width / st.track.offsetWidth || 1; const w = s.tw || 72;
  const first = st.btns.get(TABS[0].id), last = st.btns.get(TABS[TABS.length - 1].id);
  s.tx = Math.max(first.offsetLeft, Math.min(last.offsetLeft + last.offsetWidth - w, (clientX - tr.left) / k - w / 2)); kick();
}
function kick() { if (!st.spring.raf) { st.spring.last = performance.now(); st.spring.raf = requestAnimationFrame(step); } }
function step(t) {
  if (!st) return;
  const s = st.spring; const dt = Math.min(0.032, (t - s.last) / 1000); s.last = t;
  const k = st.drag ? 560 : 360, c = st.drag ? 42 : 31; // stiffness / damping: a hair under critical = one soft settle
  for (const [p, v, tgt] of [['x', 'vx', 'tx'], ['w', 'vw', 'tw']]) { const a = -k * (s[p] - s[tgt]) - c * s[v]; s[v] += a * dt; s[p] += s[v] * dt; }
  paint(s.vx);
  if (Math.abs(s.x - s.tx) < 0.3 && Math.abs(s.vx) < 4 && Math.abs(s.w - s.tw) < 0.3 && !st.drag) { s.x = s.tx; s.w = s.tw; s.vx = s.vw = 0; paint(0); s.raf = 0; return; }
  s.raf = requestAnimationFrame(step);
}
function paint(v) {
  const s = st.spring; const stretch = reduced() ? 0 : Math.min(0.28, Math.abs(v) / 3000);
  const lift = st.drag ? 1.08 : 1;
  st.lens.style.width = s.w + 'px';
  st.lens.style.transform = `translate3d(${s.x}px,0,0) scale(${(1 + stretch) * lift}, ${(1 - stretch * 0.55) * lift})`;
  st.pill.style.setProperty('--lx', (s.x + s.w / 2).toFixed(1) + 'px'); // rim light rides above the lens
}
function pop(b) { if (!b || reduced()) return; const ic = b.querySelector('.dk-ico'); ic.classList.remove('pop'); void ic.offsetWidth; ic.classList.add('pop'); }
const haptic = () => { try { navigator.vibrate?.(6); } catch (e) { /* unsupported */ } };

// ---------- press, tap, scrub ----------
function itemAt(x) { for (const [id, b] of st.btns) { const r = b.getBoundingClientRect(); if (x >= r.left && x <= r.right) return id; } return null; }
function select(id) {
  haptic();
  if (id === st.active) { if (id !== 'search') document.getElementById('main')?.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); }
  else moveLensTo(id);
  st.onSelect?.(id);
}
function wirePointer() {
  const tr = st.track;
  tr.addEventListener('pointerdown', e => {
    const b = e.target.closest('.dk-item'); if (!b) return;
    if (st.mini) setMini(false);
    b.classList.add('press');
    st.drag = { id: e.pointerId, x0: e.clientX, moved: false, over: b.dataset.id }; tr.setPointerCapture(e.pointerId);
  });
  tr.addEventListener('pointermove', e => {
    const d = st.drag; if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 8) return;
    if (!d.moved) { d.moved = true; st.bar.classList.add('scrub'); st.btns.forEach(b => b.classList.remove('press')); }
    followX(e.clientX); const over = itemAt(e.clientX);
    if (over && over !== d.over) { d.over = over; haptic(); st.btns.forEach((b, id) => b.classList.toggle('hover', id === over)); }
  });
  const end = e => {
    const d = st.drag; st.btns.forEach(b => b.classList.remove('press', 'hover')); st.bar.classList.remove('scrub');
    if (!d) return;
    st.drag = null; if (e.type !== 'pointerup') { moveLensTo(st.active); return; }
    const id = d.moved ? itemAt(e.clientX) : d.over;
    if (id) select(id); else moveLensTo(st.active);
  };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  // Keyboard (Enter/Space synthesise a click with detail 0); pointer taps are handled above.
  tr.addEventListener('click', e => { const b = e.target.closest('.dk-item'); if (b && e.detail === 0) select(b.dataset.id); });
  addEventListener('resize', () => st && moveLensTo(st.active, { instant: true }));
}
function wireOrb() {
  const o = st.orb; const up = () => o.classList.remove('press');
  o.addEventListener('pointerdown', () => { if (st.mini) setMini(false); o.classList.add('press'); });
  o.addEventListener('pointerup', up); o.addEventListener('pointercancel', up); o.addEventListener('pointerleave', up);
  o.addEventListener('click', () => { haptic(); st.onSelect?.('create'); });
}

// ---------- condense on scroll ----------
function setMini(on) { if (!st || st.mini === on) return; st.mini = on; st.bar.classList.toggle('condensed', on); }
function wireScroll() {
  const main = document.getElementById('main'); if (!main || main.__dock) return; main.__dock = true;
  let last = 0, acc = 0, ticking = false;
  main.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; onScroll(); }); }, { passive: true });
  function onScroll() {
    const y = main.scrollTop, dy = y - last; last = y;
    if (y < 24) { acc = 0; setMini(false); return; }
    acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
    if (acc > 36) setMini(true); else if (acc < -28) setMini(false);
  }
  addEventListener('hashchange', () => { last = 0; acc = 0; setMini(false); });
}
