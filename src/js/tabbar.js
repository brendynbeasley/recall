// Touch navigation: a floating glass pill with a spring-physics selection lens.
//  - Lens is driven by a critically-damped spring (not CSS timing), and stretches along its direction of
//    travel / squashes vertically in proportion to velocity, so it feels like a liquid drop.
//  - Press and drag across the bar to scrub between tabs; the lens follows your finger and lifts.
//  - Scrolling down minimises the bar to the current tab + Create; scrolling up or tapping restores it.
//  - Honors Reduce motion (lens jumps, no squash/bounce).
import { h, svgIcon } from './utils.js';

const ITEMS = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'library', icon: 'library', label: 'Library' },
  { id: 'create', icon: 'plus', label: 'Create', primary: true },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

let st = null; // persistent state across re-renders

export function renderTabbar({ route, badge, onSelect }) {
  const bar = document.getElementById('tabbar'); if (!bar) return;
  document.getElementById('tab-search')?.remove(); // legacy floating search button
  if (!document.body.classList.contains('tabbar-mode')) { bar.innerHTML = ''; st = null; return; }
  const activeId = route === 'library' || route === 'folder' || route === 'set' || route === 'edit' ? 'library'
    : route === 'settings' || route === 'stats' || route === 'achievements' ? 'settings'
    : route === 'browser' ? 'search' : route === 'home' ? 'home' : null;

  if (!st || !bar.contains(st.track)) build(bar, onSelect);
  st.onSelect = onSelect;
  st.btns.forEach((b, id) => {
    b.classList.toggle('on', id === activeId);
    const bd = b.querySelector('.tb2-badge'); if (bd) { bd.textContent = badge > 99 ? '99+' : badge || ''; bd.hidden = !badge; }
  });
  if (st.active !== activeId) { st.active = activeId; if (activeId) pop(st.btns.get(activeId)); }
  requestAnimationFrame(() => moveLensTo(activeId, { instant: !st.ready }));
  st.ready = true;
}

function build(bar, onSelect) {
  bar.innerHTML = ''; bar.classList.add('tb2');
  const lens = h('div', { class: 'tb2-lens' }, h('i', { class: 'tb2-lens-hi' }));
  const track = h('div', { class: 'tb2-track' }, lens);
  const btns = new Map();
  for (const it of ITEMS) {
    const b = h('button', { class: `tb2-item ${it.primary ? 'primary' : ''}`, 'data-id': it.id, 'aria-label': it.label, title: it.label },
      h('span', { class: 'tb2-icon' }, svgIcon(it.icon, it.primary ? 24 : 23)),
      it.id === 'home' ? h('span', { class: 'tb2-badge', hidden: true }) : null);
    btns.set(it.id, b); track.append(b);
  }
  bar.append(track);
  st = { bar, track, lens, btns, active: null, ready: false, onSelect,
    spring: { x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, raf: 0 }, drag: null, mini: false };
  wirePointer(); wireScroll();
}

// ---------- spring ----------
const reduced = () => document.body.classList.contains('reduced-motion');
function moveLensTo(id, { instant = false } = {}) {
  const b = id && st.btns.get(id); const s = st.spring;
  if (!b || b.classList.contains('primary')) { st.lens.style.opacity = '0'; return; }
  st.lens.style.opacity = '1';
  const tr = st.track.getBoundingClientRect(), r = b.getBoundingClientRect();
  s.tx = r.left - tr.left; s.tw = r.width;
  if (instant || reduced() || !s.w) { s.x = s.tx; s.w = s.tw; s.vx = s.vw = 0; paint(0); return; }
  kick();
}
function followX(clientX) { // drag: lens centre tracks the finger
  const s = st.spring, tr = st.track.getBoundingClientRect(); const w = s.tw || 60;
  s.tx = Math.max(0, Math.min(tr.width - w, clientX - tr.left - w / 2)); kick();
}
function kick() { if (!st.spring.raf) { st.spring.last = performance.now(); st.spring.raf = requestAnimationFrame(step); } }
function step(t) {
  const s = st.spring; const dt = Math.min(0.032, (t - s.last) / 1000); s.last = t;
  const k = st.drag ? 520 : 340, c = st.drag ? 40 : 30; // stiffness / damping (slightly under-damped = gentle settle)
  for (const [p, v, tgt] of [['x', 'vx', 'tx'], ['w', 'vw', 'tw']]) { const a = -k * (s[p] - s[tgt]) - c * s[v]; s[v] += a * dt; s[p] += s[v] * dt; }
  paint(s.vx);
  if (Math.abs(s.x - s.tx) < 0.3 && Math.abs(s.vx) < 4 && Math.abs(s.w - s.tw) < 0.3 && !st.drag) { s.x = s.tx; s.w = s.tw; s.vx = s.vw = 0; paint(0); s.raf = 0; return; }
  s.raf = requestAnimationFrame(step);
}
function paint(v) {
  const s = st.spring; const stretch = reduced() ? 0 : Math.min(0.35, Math.abs(v) / 2600);
  const lift = st.drag ? 1.12 : 1;
  st.lens.style.width = s.w + 'px';
  st.lens.style.transform = `translate3d(${s.x}px,0,0) scale(${(1 + stretch) * lift}, ${(1 - stretch * 0.6) * lift})`;
}
function pop(b) { if (!b || reduced()) return; const ic = b.querySelector('.tb2-icon'); ic.classList.remove('pop'); void ic.offsetWidth; ic.classList.add('pop'); }
const haptic = () => { try { navigator.vibrate?.(6); } catch (e) { /* */ } };

// ---------- press, tap, scrub ----------
function itemAt(x) { for (const [id, b] of st.btns) { if (b.classList.contains('primary')) continue; const r = b.getBoundingClientRect(); if (x >= r.left && x <= r.right) return id; } return null; }
function wirePointer() {
  const tr = st.track;
  tr.addEventListener('pointerdown', e => {
    const b = e.target.closest('.tb2-item'); if (!b) return;
    if (st.mini) { e.preventDefault(); setMini(false); return; }
    b.classList.add('press');
    if (b.classList.contains('primary')) { st.drag = null; return; }
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
    if (!d) { const b = e.target.closest?.('.tb2-item.primary'); if (b && e.type === 'pointerup') { haptic(); st.onSelect('create'); } return; }
    st.drag = null; if (e.type !== 'pointerup') { moveLensTo(st.active); return; }
    const id = d.moved ? itemAt(e.clientX) : d.over;
    if (id) { haptic(); if (id === st.active) { if (id !== 'search') document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' }); } else { moveLensTo(id); } st.onSelect(id); }
    else moveLensTo(st.active);
  };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const b = e.target.closest('.tb2-item'); if (b) { e.preventDefault(); st.onSelect(b.dataset.id); } } });
  addEventListener('resize', () => st && moveLensTo(st.active, { instant: true }));
}

// ---------- minimise on scroll ----------
function setMini(on) {
  if (!st || st.mini === on) return; st.mini = on; st.bar.classList.toggle('mini', on);
  setTimeout(() => moveLensTo(st.active, { instant: false }), 20); setTimeout(() => moveLensTo(st.active), 380);
}
function wireScroll() {
  const main = document.getElementById('main'); if (!main || main.__tb2) return; main.__tb2 = true;
  let last = 0, acc = 0;
  main.addEventListener('scroll', () => {
    const y = main.scrollTop, dy = y - last; last = y;
    if (y < 24) { acc = 0; setMini(false); return; }
    acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
    if (acc > 36) setMini(true); else if (acc < -28) setMini(false);
  }, { passive: true });
  addEventListener('hashchange', () => { last = 0; acc = 0; setMini(false); });
}
