// "Ember" intro: light seeps in from the bottom edge of a card, climbs its rounded sides, wells up inside,
// then lifts and disperses into the air like heat. Canvas 2D with additive particles (no WebGL needed).
import { h } from './utils.js';

export function playEmberIntro({ accentHue = 252, onDone, skipable = true } = {}) {
  const root = document.getElementById('intro-root'); root.innerHTML = '';
  const reduced = document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = h('div', { class: 'intro ember' });
  const canvas = h('canvas', { class: 'intro-canvas' });
  const mark = h('div', { class: 'em-mark' }, h('div', { class: 'em-logo' }), h('div', { class: 'em-title' }, 'Recall'));
  const overlay = h('div', { class: 'intro-overlay' }, mark, h('div', { class: 'em-tag' }, 'Remember everything.'),
    skipable ? h('button', { class: 'intro-skip' }, 'Skip') : null);
  wrap.style.setProperty('--em-h', accentHue);
  wrap.append(canvas, overlay); root.append(wrap);
  document.body.classList.add('intro-playing');

  const ctx = canvas.getContext('2d'); let W = 0, H = 0, dpr = 1, card = null, path = null;
  const T_TOTAL = reduced ? 1.6 : 4.6;
  const hot = `hsl(${(accentHue + 30) % 360} 100% 88%)`;
  const sprite = (light, sat, a) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, `hsla(${accentHue} ${sat}% ${light}% / ${a})`); gr.addColorStop(.45, `hsla(${accentHue} ${sat}% ${light - 10}% / ${a * .35})`); gr.addColorStop(1, `hsla(${accentHue} ${sat}% ${light - 20}% / 0)`); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; };
  const spHot = sprite(82, 100, 1), spMid = sprite(62, 95, .9), spDeep = sprite(48, 90, .7);

  function layout() {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = Math.min(W * .62, 640), ch = Math.min(H * .5, cw * .62), r = Math.min(cw, ch) * .16;
    card = { x: (W - cw) / 2, y: (H - ch) / 2 - H * .02, w: cw, h: ch, r };
    // half-perimeter from bottom-centre, up the right side to top-centre (mirrored for the left)
    const pts = []; const { x, y, w, h: hh } = card; const cx = x + w / 2, b = y + hh, rr = r;
    const push = (px, py) => pts.push({ x: px, y: py, f: (b - py) / hh });
    for (let i = 0; i <= 40; i++) push(cx + (w / 2 - rr) * i / 40, b);
    for (let i = 1; i <= 16; i++) { const a = Math.PI / 2 - (Math.PI / 2) * i / 16; push(x + w - rr + Math.cos(a) * rr, b - rr + Math.sin(a) * rr); }
    for (let i = 1; i <= 40; i++) push(x + w, b - rr - (hh - 2 * rr) * i / 40);
    for (let i = 1; i <= 16; i++) { const a = -(Math.PI / 2) * i / 16; push(x + w - rr + Math.cos(a) * rr, y + rr + Math.sin(a) * rr); }
    for (let i = 1; i <= 40; i++) push(x + w - rr - (w / 2 - rr) * i / 40, y);
    path = pts;
  }
  layout(); addEventListener('resize', layout);

  const P = []; const MAX = reduced ? 0 : 520;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = v => Math.max(0, Math.min(1, v));
  function emit(t, reach, power) {
    if (P.length > MAX || power <= 0) return;
    let lit = 0; while (lit < path.length - 1 && path[lit + 1].f <= reach) lit++;
    const n = Math.round(7 * power); const cx = card.x + card.w / 2;
    for (let k = 0; k < n; k++) {
      const p = path[Math.floor(Math.pow(Math.random(), 1.25) * (lit + 1))];
      const side = Math.random() < .5 ? -1 : 1; const px = cx + (p.x - cx) * side;
      const r = Math.random();
      P.push({ x: px + (Math.random() - .5) * 10, y: p.y + (Math.random() - .5) * 6, vx: (Math.random() - .5) * 10, vy: -10 - Math.random() * 22, life: 0, max: 2.2 + Math.random() * 2, s: 34 + Math.random() * 60, sp: r < .12 ? spHot : r < .55 ? spMid : spDeep, a: r < .12 ? .16 : .24, seed: Math.random() * 100 });
    }
  }

  let t0 = 0, last = 0, raf = 0, done = false;
  function frame(now) {
    if (!t0) t0 = last = now; const t = (now - t0) / 1000, dt = Math.min(.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    if (reduced) { mark.style.opacity = clamp(t / .5); if (t >= T_TOTAL) return finish(); raf = requestAnimationFrame(frame); return; }
    // timeline
    const reach = ease(clamp((t - .35) / 1.35)) * .98;          // edge light climbs
    const well = ease(clamp((t - 1.1) / 1.2));                    // interior glow rises
    const lift = ease(clamp((t - 2.7) / 1.4));                    // disperses upward
    const fade = 1 - clamp((t - 3.6) / .9);
    const dy = -lift * H * .12;                                    // whole glow drifts up
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // spill glow under the card
    const { x, y, w, h: hh, r } = card; const cx = x + w / 2, b = y + hh + dy;
    const sp = ctx.createRadialGradient(cx, b, 0, cx, b, w * .7);
    sp.addColorStop(0, `hsla(${accentHue} 95% 60% / ${.22 * reach * fade * (1 - lift * .6)})`); sp.addColorStop(1, `hsla(${accentHue} 95% 50% / 0)`);
    ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H);
    // interior glow (clipped to the card)
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y + dy, w, hh, r); ctx.clip();
    const ig = ctx.createRadialGradient(cx, b + hh * .15, 0, cx, b + hh * .15, hh * (.55 + well * .9));
    ig.addColorStop(0, `hsla(${(accentHue + 20) % 360} 100% 70% / ${.5 * well * fade})`); ig.addColorStop(.5, `hsla(${accentHue} 90% 45% / ${.18 * well * fade})`); ig.addColorStop(1, `hsla(${accentHue} 90% 30% / 0)`);
    ctx.fillStyle = ig; ctx.fillRect(x, y + dy, w, hh); ctx.restore();
    // edge light: continuous path, vertical gradient from a hot base to nothing at the climbing front
    if (reach > .005) {
      const topY = b - hh * reach, cool = lift;
      const grad = (core) => { const g = ctx.createLinearGradient(0, b + 2, 0, topY); const c = core ? `hsla(${(accentHue + 30) % 360} 100% 90%` : `hsla(${accentHue} 95% 62%`;
        g.addColorStop(0, `${c} / ${(core ? 1 : .32) * fade * (1 - cool)})`); g.addColorStop(Math.min(.95, .35 + cool * .5), `${c} / ${(core ? .75 : .22) * fade * (1 - cool * .5)})`); g.addColorStop(1, `${c} / 0)`); return g; };
      const trace = () => { ctx.beginPath(); for (const side of [-1, 1]) { let first = true; for (const q of path) { if (q.f > reach) break; const X = cx + (q.x - cx) * side, Y = q.y + dy; first ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); first = false; } } };
      ctx.lineJoin = ctx.lineCap = 'round';
      trace(); ctx.lineWidth = 7; ctx.strokeStyle = grad(false); ctx.shadowColor = 'hsla(' + accentHue + ' 100% 60% / ' + (.9 * fade * (1 - cool)) + ')'; ctx.shadowBlur = 26; ctx.stroke(); ctx.shadowBlur = 0;
      trace(); ctx.lineWidth = 1.6; ctx.strokeStyle = grad(true); ctx.stroke();
    }
    // smoke / heat particles
    emit(t, Math.max(.04, reach), t < 3.2 ? (t < .45 ? 0 : 1) * (1 - lift * .8) : 0);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life += dt; if (p.life > p.max) { P.splice(i, 1); continue; }
      const u = p.life / p.max; const tt = t + p.seed;
      p.vx += (Math.sin(tt * 1.7 + p.y * .012) + Math.cos(tt * .9 + p.x * .01)) * 22 * dt; p.vx *= .985;
      p.vy -= (12 + lift * 60) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const s = p.s * (1 + u * 1.8); const al = Math.sin(Math.PI * Math.min(1, u * 1.1)) * p.a * fade;
      ctx.globalAlpha = al; ctx.drawImage(p.sp, p.x - s / 2, p.y + dy * .3 - s / 2, s, s);
    }
    ctx.globalAlpha = 1; ctx.restore();
    // wordmark
    const m = ease(clamp((t - 1.5) / 1)); mark.style.opacity = m * fade; mark.style.transform = `translateY(${(1 - m) * 14 + dy * .35}px) scale(${.96 + m * .04})`; mark.style.filter = `blur(${(1 - m) * 10}px)`;
    if (t >= T_TOTAL) return finish(); raf = requestAnimationFrame(frame);
  }
  function finish() {
    if (done) return; done = true; cancelAnimationFrame(raf); removeEventListener('resize', layout); removeEventListener('keydown', onKey);
    wrap.classList.add('out');
    setTimeout(() => { root.innerHTML = ''; document.body.classList.remove('intro-playing'); onDone && onDone(); }, 650);
  }
  const onKey = e => { if (skipable && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish(); };
  addEventListener('keydown', onKey);
  if (skipable) { overlay.querySelector('.intro-skip').addEventListener('click', finish); canvas.addEventListener('click', finish); }
  requestAnimationFrame(n => { wrap.classList.add('in'); frame(n); });
  return { finish };
}
