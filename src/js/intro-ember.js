// "Edge" intro: on black, a thin line of light starts at the bottom centre of the screen, runs outward along the
// bottom and climbs the rounded sides; a soft glow bleeds in from the edges; the wordmark resolves; then the black
// fades away and the light stays on the screen edges inside the app (see edge-light.js).
import { h } from './utils.js';
import { drawEdgeLight, settleEdgeLight, endIntroEdge } from './edge-light.js';

export function playEmberIntro({ onDone, skipable = true } = {}) {
  const root = document.getElementById('intro-root'); root.innerHTML = '';
  const reduced = document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = h('div', { class: 'intro edge-intro' },
    h('div', { class: 'ei-mark' }, h('div', { class: 'ei-logo' }), h('div', { class: 'ei-title' }, 'Recall')),
    h('div', { class: 'ei-tag' }, 'Remember everything'),
    skipable ? h('button', { class: 'intro-skip' }, 'Skip') : null);
  root.append(wrap); document.body.classList.add('intro-playing');
  let done = false; const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, reduced ? Math.min(ms, 300) : ms));
  requestAnimationFrame(() => wrap.classList.add('in'));
  at(200, () => drawEdgeLight({ duration: reduced ? 1 : 1300 }));
  at(1700, () => wrap.classList.add('mark'));
  at(3300, finish);
  function finish() {
    if (done) return; done = true; timers.forEach(clearTimeout); removeEventListener('keydown', onKey);
    wrap.classList.add('out'); settleEdgeLight(); document.body.classList.remove('intro-playing'); onDone && onDone();
    setTimeout(() => { root.innerHTML = ''; endIntroEdge(); }, 900);
  }
  const onKey = e => { if (skipable && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish(); };
  addEventListener('keydown', onKey);
  if (skipable) { wrap.querySelector('.intro-skip').addEventListener('click', finish); wrap.addEventListener('click', e => { if (!e.target.closest('.intro-skip')) finish(); }); }
  return { finish };
}
