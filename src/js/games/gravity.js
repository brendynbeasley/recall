// Gravity: asteroids carrying prompts fall toward your planet. Type the answer to blast them.
import { db } from '../db.js';
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, gradeAnswer, stripHtml, clamp } from '../utils.js';
import { toast, countdown, confetti, shake } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, sideText, otherSide, pickAnswerSide, recordMastery, resultsScreen, sessionTracker, optionsModal, keyHandler, loadPairs, kbdHint } from '../modes/common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().gravity;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!pairs.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  const frame = studyFrame(main, { deck, modeName: 'Gravity', icon: 'rocket', color: '#f43f5e', onSettings: openOptions, onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  let canvas, ctx2, W = 0, H = 0, asteroids = [], particles = [], lasers = [], score = 0, level = 1, lives = 3, streak = 0, running = false, paused = false, finished = false, raf = 0, last = 0, spawnTimer = 0, pool = [], tracker = null, answered = 0, dangerPair = null, stars = [];
  ctx.inProgress = () => running;
  const input = h('input', { class: 'input input-lg gravity-input', placeholder: 'Type the answer and press Enter', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
  const hud = h('div', { class: 'gravity-hud' });
  const diff = () => ({ easy: { speed: 14, spawn: 6.5 }, medium: { speed: 22, spawn: 5 }, hard: { speed: 32, spawn: 3.8 }, insane: { speed: 46, spawn: 2.8 } })[opt().difficulty || 'medium'];
  const best = () => db.getKV(`best_gravity_${deck.id}`, 0);
  function layout() { const r = canvas.parentElement.getBoundingClientRect(); W = Math.max(300, r.width); H = Math.max(300, r.height); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; ctx2.setTransform(dpr, 0, 0, dpr, 0, 0); if (!stars.length) for (let i = 0; i < 160; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, a: Math.random() }); }
  async function begin() {
    cancelAnimationFrame(raf); finished = false; running = false; paused = false; asteroids = []; particles = []; lasers = []; score = 0; level = 1; lives = opt().lives || 3; streak = 0; answered = 0; dangerPair = null; pool = shuffle(pairs); tracker = sessionTracker(deck, 'gravity');
    frame.body.innerHTML = ''; frame.setProgress(0);
    canvas = h('canvas', { class: 'gravity-canvas' }); ctx2 = canvas.getContext('2d');
    const area = h('div', { class: 'gravity-area' }, canvas, hud, h('div', { class: 'gravity-input-wrap' }, input, h('button', { class: 'btn btn-ghost', 'data-tip': 'Pause', 'data-kbd': 'P', onClick: togglePause }, svgIcon('pause', 16))));
    frame.body.append(area); layout(); window.addEventListener('resize', layout);
    updateHud(); draw(0);
    await countdown(area, { from: 3, label: 'Launch!' });
    running = true; last = performance.now(); spawnTimer = 0; input.value = ''; input.focus(); spawn(); raf = requestAnimationFrame(loop);
  }
  function updateHud() { hud.innerHTML = ''; hud.append(...[h('span', { class: 'hud-item' }, svgIcon('zap', 14), h('b', {}, score), 'pts'), h('span', { class: 'hud-item' }, svgIcon('layers', 14), 'Level ', h('b', {}, level)), h('span', { class: 'hud-item lives' }, ...Array.from({ length: opt().lives || 3 }, (_, i) => h('span', { class: `life ${i < lives ? 'on' : ''}` }, svgIcon('heart', 14)))), streak >= 3 ? h('span', { class: 'hud-item streak' }, svgIcon('flame', 14), `${streak} streak ×${multiplier()}`) : null, h('span', { class: 'hud-item muted' }, `Best ${best()}`)].filter(Boolean)); frame.setStats(statChip('score', score, 'ok'), statChip('level', level)); }
  const multiplier = () => streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
  function spawn() { if (!pool.length) pool = shuffle(pairs); const p = pool.pop(); const answerSide = pickAnswerSide(opt().answerWith); const promptSide = otherSide(answerSide); const text = stripHtml(sideText(p, promptSide)) || '(image)'; const size = clamp(50 + text.length * 2.2, 60, 120); asteroids.push({ pair: p, answerSide, text, x: 60 + Math.random() * (W - 120), y: -size, size, speed: diff().speed * (1 + (level - 1) * 0.18) * (0.85 + Math.random() * 0.3), rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, hue: 200 + Math.random() * 120 }); }
  function loop(t) { if (!running) return; const dt = Math.min(0.05, (t - last) / 1000); last = t; if (!paused) update(dt); draw(dt); raf = requestAnimationFrame(loop); }
  function update(dt) {
    spawnTimer += dt; const interval = diff().spawn / (1 + (level - 1) * 0.12); if (spawnTimer >= interval && asteroids.length < 4 + level) { spawnTimer = 0; spawn(); }
    for (const a of asteroids) { a.y += a.speed * dt; a.rot += a.vr * dt; }
    const planetY = H - 70;
    const hit = asteroids.find(a => a.y + a.size / 2 >= planetY); if (hit) impact(hit);
    particles = particles.filter(p => (p.life -= dt) > 0); for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
    lasers = lasers.filter(l => (l.life -= dt) > 0);
  }
  function draw() {
    ctx2.clearRect(0, 0, W, H);
    // starfield
    for (const s of stars) { ctx2.globalAlpha = 0.3 + Math.sin(performance.now() / 700 + s.a * 10) * 0.25; ctx2.fillStyle = '#fff'; ctx2.beginPath(); ctx2.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx2.fill(); } ctx2.globalAlpha = 1;
    // planet
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
    const g2 = ctx2.createRadialGradient(W / 2, H + 230, 60, W / 2, H + 230, 330); g2.addColorStop(0, accent); g2.addColorStop(0.55, 'rgba(60,40,120,.95)'); g2.addColorStop(1, 'rgba(10,8,30,0)');
    ctx2.fillStyle = g2; ctx2.beginPath(); ctx2.arc(W / 2, H + 230, 330, 0, Math.PI * 2); ctx2.fill();
    ctx2.strokeStyle = 'rgba(255,255,255,.18)'; ctx2.lineWidth = 2; ctx2.beginPath(); ctx2.arc(W / 2, H + 230, 302, Math.PI * 1.1, Math.PI * 1.9); ctx2.stroke();
    // asteroids
    for (const a of asteroids) { ctx2.save(); ctx2.translate(a.x, a.y); const r = a.size / 2; const grd = ctx2.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r); grd.addColorStop(0, `hsl(${a.hue} 30% 55%)`); grd.addColorStop(1, `hsl(${a.hue} 35% 22%)`); ctx2.fillStyle = grd; ctx2.beginPath(); for (let i = 0; i < 9; i++) { const ang = a.rot + i / 9 * Math.PI * 2; const rr = r * (0.85 + Math.sin(i * 2.3 + a.hue) * 0.12); ctx2.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); } ctx2.closePath(); ctx2.fill(); ctx2.strokeStyle = 'rgba(255,255,255,.25)'; ctx2.lineWidth = 1.5; ctx2.stroke();
      // glow danger
      if (a.y > H * 0.65) { ctx2.shadowColor = 'rgba(244,63,94,.9)'; ctx2.shadowBlur = 24; ctx2.stroke(); ctx2.shadowBlur = 0; }
      ctx2.restore();
      // label
      ctx2.save(); ctx2.font = `600 ${a.text.length > 30 ? 13 : 15}px ${getComputedStyle(document.body).fontFamily}`; ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle'; const lines = wrap(ctx2, a.text, Math.max(120, a.size + 70)); const lh = 18; const boxW = Math.max(...lines.map(l => ctx2.measureText(l).width)) + 20; const boxH = lines.length * lh + 10; ctx2.fillStyle = 'rgba(8,10,20,.78)'; roundRect(ctx2, a.x - boxW / 2, a.y + a.size / 2 + 6, boxW, boxH, 8); ctx2.fill(); ctx2.fillStyle = '#fff'; lines.forEach((l, i) => ctx2.fillText(l, a.x, a.y + a.size / 2 + 11 + lh / 2 + i * lh)); ctx2.restore(); }
    // lasers
    for (const l of lasers) { ctx2.strokeStyle = `rgba(99,230,255,${l.life * 4})`; ctx2.lineWidth = 3; ctx2.beginPath(); ctx2.moveTo(W / 2, H - 60); ctx2.lineTo(l.x, l.y); ctx2.stroke(); }
    // particles
    for (const p of particles) { ctx2.globalAlpha = Math.max(0, p.life / p.max); ctx2.fillStyle = p.color; ctx2.beginPath(); ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx2.fill(); } ctx2.globalAlpha = 1;
    if (paused) { ctx2.fillStyle = 'rgba(0,0,0,.55)'; ctx2.fillRect(0, 0, W, H); ctx2.fillStyle = '#fff'; ctx2.font = '800 40px sans-serif'; ctx2.textAlign = 'center'; ctx2.fillText('Paused', W / 2, H / 2); ctx2.font = '500 16px sans-serif'; ctx2.fillText('Press P to resume', W / 2, H / 2 + 34); }
  }
  function wrap(c, text, maxW) { const words = text.split(' '); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines.slice(0, 4); }
  function roundRect(c, x, y, w, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function explode(x, y, color) { for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 180; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 4, life: 0.6 + Math.random() * 0.5, max: 1, color }); } }
  function submit() {
    if (!running || paused) return; const v = input.value.trim(); if (!v) return;
    let hitIdx = -1; for (let i = asteroids.length - 1; i >= 0; i--) { const a = asteroids[i]; if (gradeAnswer(v, sideText(a.pair, a.answerSide), { typoTolerance: false }).correct) { hitIdx = i; break; } }
    if (hitIdx < 0) { for (let i = 0; i < asteroids.length; i++) { const a = asteroids[i]; if (gradeAnswer(v, sideText(a.pair, a.answerSide), { typoTolerance: true }).correct) { hitIdx = i; break; } } }
    if (hitIdx >= 0) { const a = asteroids.splice(hitIdx, 1)[0]; sfx.laser(); lasers.push({ x: a.x, y: a.y, life: 0.25 }); setTimeout(() => { explode(a.x, a.y, `hsl(${a.hue} 80% 65%)`); sfx.explode(); }, 80); streak++; answered++; const pts = (10 + level * 5 + Math.round((1 - a.y / H) * 10)) * multiplier(); score += pts; recordMastery(a.pair, true, { mode: 'gravity' }); tracker.answer(true); const r = input.getBoundingClientRect(); const ft = h('div', { class: 'float-text', style: { left: r.left + r.width / 2 + 'px', top: r.top + 'px' } }, `+${pts}`); document.body.append(ft); setTimeout(() => ft.remove(), 1200); if (answered % 6 === 0) { level++; sfx.levelUp(); toast(`Level ${level}! Asteroids are faster now.`, 'info', { duration: 1500 }); } input.value = ''; updateHud(); frame.setProgress(Math.min(1, answered / 40)); }
    else { streak = 0; sfx.warn(); shake(input); input.classList.add('bad'); setTimeout(() => input.classList.remove('bad'), 400); updateHud(); }
  }
  function impact(a) {
    asteroids = asteroids.filter(x => x !== a); explode(a.x, H - 80, 'rgba(244,63,94,.9)'); sfx.explode(); lives--; streak = 0; recordMastery(a.pair, false, { mode: 'gravity' }); tracker.answer(false); updateHud();
    paused = true; dangerPair = a;
    const overlay = h('div', { class: 'gravity-danger pop-in' }, h('div', { class: 'danger-head' }, svgIcon('alert', 22), lives > 0 ? `Impact! ${lives} ${lives === 1 ? 'life' : 'lives'} left` : 'Your planet was destroyed'), h('div', { class: 'danger-body' }, h('div', { class: 'q-label' }, otherSide(a.answerSide) === 'term' ? 'Term' : 'Definition'), h('div', { class: 'danger-term' }, a.text), h('div', { class: 'q-label' }, a.answerSide === 'term' ? 'Term' : 'Definition'), h('div', { class: 'danger-answer selectable' }, sideText(a.pair, a.answerSide))), lives > 0 ? h('div', { class: 'col' }, h('p', { class: 'small muted' }, 'Type the correct answer to resume.'), (() => { const inp = h('input', { class: 'input input-lg', placeholder: 'Type the answer…', autocomplete: 'off', spellcheck: false }); inp.addEventListener('input', () => { if (gradeAnswer(inp.value, sideText(a.pair, a.answerSide), { typoTolerance: false }).correct) { inp.classList.add('ok'); setTimeout(() => { overlay.remove(); paused = false; dangerPair = null; last = performance.now(); input.focus(); }, 250); } }); setTimeout(() => inp.focus(), 60); return inp; })()) : h('button', { class: 'btn btn-primary btn-lg', onClick: () => { overlay.remove(); gameOver(); } }, 'See results'));
    frame.body.querySelector('.gravity-area').append(overlay);
  }
  function gameOver() { running = false; finished = true; cancelAnimationFrame(raf); const prev = best(); const isBest = score > prev; if (isBest) db.setKV(`best_gravity_${deck.id}`, score); const s = tracker.finish({ score, meta: { level, answered } }); if (isBest && score > 0) tracker.bonus(20); if (score > 0) sfx.complete(); if (isBest && score > 0) confetti({ count: 220 });
    resultsScreen(frame, { title: isBest && score > 0 ? 'New high score!' : 'Game over', subtitle: `You reached level ${level} and destroyed ${answered} asteroid${answered === 1 ? '' : 's'}.${!isBest ? ` Best: ${prev}.` : ''}`, scoreLabel: String(score), score: Math.min(100, Math.round(answered / 40 * 100)), celebrate: false, correct: s.correct, wrong: s.wrong, time: s.end - s.start, xp: s.xp + (isBest && score > 0 ? 20 : 0), extra: [statChip('level', level)], actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Harder', icon: 'zap', onClick: () => { const order = ['easy', 'medium', 'hard', 'insane']; updateSettings({ gravity: { difficulty: order[Math.min(3, order.indexOf(opt().difficulty || 'medium') + 1)] } }); begin(); } }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] }); }
  function togglePause() { if (!running || dangerPair) return; paused = !paused; if (!paused) { last = performance.now(); input.focus(); } }
  function openOptions() { optionsModal('Gravity options', 'gravity', [{ type: 'segment', key: 'difficulty', label: 'Difficulty', options: [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }, { value: 'insane', label: 'Insane' }] }, { type: 'segment', key: 'answerWith', label: 'Answer with', options: [{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }] }, { type: 'segment', key: 'lives', label: 'Lives', options: [{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }] }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }], { onChange: () => begin() }); }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') e.stopPropagation(); });
  const unkey = keyHandler({ '*p': togglePause, '*r': begin, 'p': (e) => { if (document.activeElement === input && input.value === '') { togglePause(); return true; } return false; } });
  begin();
  return () => { unkey(); cancelAnimationFrame(raf); window.removeEventListener('resize', layout); if (running && tracker) tracker.finish({ score }); };
}
