// App-wide interaction layer.
//  - Press: feedback on pointer-down (scale .97, ~100ms ease-out), release springs back; cancel if the finger drags away.
//  - Spotlight: a soft accent light follows the pointer/finger across cards.
//  - Large titles collapse into a frosted compact header while scrolling (iOS-style), with a soft edge fade.
//  - Scroll-reactive edge light: scrolling velocity and hitting an edge briefly brighten the screen glow.
//  - Create sheet: grows out of the + button and returns into it.
// Everything is transform/opacity only and honours Reduce motion.
import { h, svgIcon } from './utils.js';

const reduced = () => document.body.classList.contains('reduced-motion');
const PRESS = '.lb-card, .lb-folder, .btn, .icon-btn, .hm2-set, .hm2-tile, .hm2-cta, .deck-card, .folder-card, .deck-row, .sx-tile, .ap-chip, .ap-amb, .ap-intro-opt, .ap-theme, .menu-item, .palette-item, .choice-item, .seg, .tab, .cs-opt, .ap-reset, .hm2-link';
const SPOT = '.lb-card, .lb-folder, .hm2-tile, .hm2-box, .deck-card, .folder-card, .deck-row, .sx-tile, .panel, .cs-opt';

export function initMotion() {
  if (window.__motion) return; window.__motion = true;
  // ---- press ----
  let pressed = null, x0 = 0, y0 = 0;
  const release = () => { if (pressed) { pressed.classList.remove('is-pressed'); pressed = null; } };
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest(PRESS); if (!el || el.disabled || el.closest('.dock')) return;
    pressed = el; x0 = e.clientX; y0 = e.clientY; el.classList.add('is-pressed');
    const s = e.target.closest(SPOT); if (s) spot(s, e);
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (pressed && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) release();
    if (e.pointerType === 'mouse') { const s = e.target.closest?.(SPOT); if (s) spot(s, e); }
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, release, { passive: true }));
  document.addEventListener('scroll', release, { capture: true, passive: true });
  function spot(el, e) { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); el.classList.add('spot-on'); clearTimeout(el.__spotT); el.__spotT = setTimeout(() => el.classList.remove('spot-on'), e.pointerType === 'mouse' ? 1600 : 700); }

  // ---- scroll: collapsing large title + reactive edge light ----
  const head = h('div', { class: 'scroll-head', 'aria-hidden': 'true' }, h('span', { class: 'sh-title' })); document.body.append(head);
  let title = null, titleTop = 0, raf = 0;
  const main = () => document.getElementById('main');
  function scan() {
    if (title) { title.style.transform = ''; title.style.opacity = ''; }
    const m = main(); title = m && m.querySelector('.page-title, .hm2-greet, .sd-title, .set-title');
    head.classList.remove('on'); head.querySelector('.sh-title').textContent = title ? title.textContent.trim() : '';
    if (title) { const mr = m.getBoundingClientRect(), tr = title.getBoundingClientRect(); titleTop = tr.bottom - mr.top + m.scrollTop; }
    place(); update();
  }
  function place() { const m = main(); if (!m) return; const r = m.getBoundingClientRect(); head.style.left = r.left + 'px'; head.style.width = r.width + 'px'; head.style.top = r.top + 'px'; }
  function update() {
    raf = 0; const m = main(); if (!m || !title || !document.body.classList.contains('tabbar-mode')) { head.classList.remove('on'); return; }
    const y = m.scrollTop; const p = Math.max(0, Math.min(1, (y - titleTop + 70) / 46));
    if (!reduced()) { title.style.transformOrigin = '0 100%'; title.style.transform = `translateY(${p * 6}px) scale(${1 - p * .1})`; }
    title.style.opacity = String(1 - p); head.style.setProperty('--p', p); head.classList.toggle('on', p > .02);
  }
  document.addEventListener('scroll', e => {
    const t = e.target;
    if (t === main()) { if (!raf) raf = requestAnimationFrame(update); }
  }, { capture: true, passive: true });
  addEventListener('hashchange', () => setTimeout(scan, 60)); addEventListener('resize', () => { place(); scan(); });
  new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 40); }).observe(document.getElementById('main') || document.body, { childList: true });
  setTimeout(scan, 300);
}

// ---- Create sheet (from the + button) ----
let sheet = null;
export function openCreateSheet({ origin, onPick }) {
  if (sheet) { closeCreateSheet(); return; }
  const r = origin?.getBoundingClientRect(); const cx = r ? r.left + r.width / 2 : innerWidth / 2; const bottom = r ? innerHeight - r.top + 14 : 110;
  const opt = (id, icon, title, sub, color) => h('button', { class: 'cs-opt', style: { '--c': color }, onClick: () => { closeCreateSheet(); setTimeout(() => onPick(id), reduced() ? 0 : 160); } },
    h('span', { class: 'cs-ic' }, svgIcon(icon, 22)), h('span', { class: 'cs-tx' }, h('b', {}, title), h('span', {}, sub)), svgIcon('chevronRight', 16));
  const card = h('div', { class: 'cs-card', style: { left: cx + 'px', bottom: bottom + 'px' } },
    h('div', { class: 'cs-head' }, 'Create'),
    opt('new', 'edit', 'New set', 'Type your own terms and definitions', 'var(--accent)'),
    opt('import', 'upload', 'Import', 'Quizlet, Anki, CSV or pasted text', '#10b981'),
    opt('folder', 'folderPlus', 'New folder', 'Group sets by class or topic', '#f59e0b'));
  sheet = h('div', { class: 'cs-scrim', onPointerdown: e => { if (e.target === sheet) closeCreateSheet(); } }, card);
  document.body.append(sheet); document.querySelector('.dk-orb')?.classList.add('open');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet && sheet.classList.add('show')));
  addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeCreateSheet(); }
export function closeCreateSheet() {
  if (!sheet) return; const s = sheet; sheet = null; removeEventListener('keydown', escClose);
  s.classList.remove('show'); document.querySelector('.dk-orb')?.classList.remove('open');
  setTimeout(() => s.remove(), 380);
}
