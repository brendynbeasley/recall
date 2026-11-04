// Screen edge light: a thin line of light that hugs the screen's rounded edges, brightest along the bottom and
// fading up the sides, with a soft glow bleeding inward. The intro draws it in; afterwards it stays as a calm frame.
const NS = 'http://www.w3.org/2000/svg';
let el = null, svg = null, paths = [];

function corner() {
  const touch = document.body.classList.contains('tabbar-mode');
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return touch && standalone ? 22 : touch ? 12 : 0; // iPad display corners vs browser / desktop window
}
function geometry() {
  const W = innerWidth, H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || innerHeight;
  const i = 1, r = corner(), cx = W / 2;
  const right = `M${cx},${H - i} L${W - r},${H - i} A${r},${r} 0 0 0 ${W - i},${H - r} L${W - i},${r} A${r},${r} 0 0 0 ${W - r},${i} L${cx},${i}`;
  const left = `M${cx},${H - i} L${r},${H - i} A${r},${r} 0 0 1 ${i},${H - r} L${i},${r} A${r},${r} 0 0 1 ${r},${i} L${cx},${i}`;
  return { W, H, right, left };
}
function mk(tag, attrs) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }

export function ensureEdgeLight() {
  if (!el) {
    el = document.createElement('div'); el.className = 'edge-light'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="el-orb"></div><div class="el-cone"><i></i></div><div class="el-side l"></div><div class="el-side r"></div><div class="el-base"></div>';
    svg = mk('svg', { class: 'el-svg', preserveAspectRatio: 'none' });
    const defs = mk('defs', {});
    const g = mk('linearGradient', { id: 'elGrad', gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 });
    [['0', 'var(--el-hot)', 1], ['.12', 'var(--el-tone)', .9], ['.45', 'var(--el-tone)', .32], ['.8', 'var(--el-neutral)', .12], ['1', 'var(--el-neutral)', .16]].forEach(([o, c, a]) => g.append(mk('stop', { offset: o, style: `stop-color:${c};stop-opacity:${a}` })));
    const f = mk('filter', { id: 'elBlur', x: '-20%', y: '-20%', width: '140%', height: '140%' }); f.append(mk('feGaussianBlur', { stdDeviation: 7 }));
    defs.append(g, f); svg.append(defs);
    paths = [];
    for (const cls of ['el-glow', 'el-line']) for (const side of ['right', 'left']) { const p = mk('path', { class: `${cls} ${side}`, pathLength: 1, fill: 'none', stroke: 'url(#elGrad)' }); if (cls === 'el-glow') p.setAttribute('filter', 'url(#elBlur)'); paths.push(p); svg.append(p); }
    el.append(svg); document.body.append(el);
    const relayout = () => layout(); addEventListener('resize', relayout); addEventListener('orientationchange', () => setTimeout(relayout, 300));
  }
  layout(); return el;
}
function layout() {
  if (!svg) return; const { W, H, right, left } = geometry();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); el.style.setProperty('--el-r', corner() + 'px'); svg.style.height = H + 'px';
  const g = svg.querySelector('#elGrad'); g.setAttribute('y1', H); g.setAttribute('y2', 0);
  paths.forEach(p => p.setAttribute('d', p.classList.contains('right') ? right : left));
}
// Intro: draw the line from the bottom centre, outward and up both sides.
let stageTimers = [];
export function drawEdgeLight({ duration = 1300 } = {}) {
  ensureEdgeLight(); stageTimers.forEach(clearTimeout); stageTimers = [];
  el.classList.remove('drawn', 'drawing', 's1', 's2', 's3'); void el.offsetWidth;
  el.style.setProperty('--el-draw', duration + 'ms'); el.classList.add('boost', 'over');
  const at = (ms, fn) => stageTimers.push(setTimeout(fn, ms));
  at(20, () => el.classList.add('s1'));
  at(420, () => el.classList.add('s2'));
  at(820, () => el.classList.add('s3'));
  at(1250, () => el.classList.add('drawing', 'drawn'));
}
export function settleEdgeLight() { ensureEdgeLight(); stageTimers.forEach(clearTimeout); el.classList.remove('boost'); el.classList.add('s1', 's2', 's3', 'drawing', 'drawn', 'over'); }
export function endIntroEdge() { if (el) el.classList.remove('over'); }
export function showEdgeLight() { ensureEdgeLight(); if (!document.body.classList.contains('intro-playing')) el.classList.add('s1', 's2', 's3', 'drawing', 'drawn'); }
