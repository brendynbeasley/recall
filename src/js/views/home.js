// Home: one clear next step, a living preview of what's next, glanceable progress, and a resume list.
// Motion: staggered entrance, count-up numbers, self-drawing rings and charts, a floating "Up next" card stack.
// All motion is skipped when Reduce motion / animations are off (body.reduced-motion).
import { db } from '../db.js';
import { S, notePairs } from '../models.js';
import { h, svgIcon, plural, pct, fmtRelative, stripHtml } from '../utils.js';
import { dueCounts, streakInfo, retentionStats, forecast, QUEUE, today } from '../scheduler.js';
import { todayStudy } from '../xp.js';
import { navigate, createSetFlow } from '../app.js';
import { deckMastery } from './common.js';
import { showImportDialog } from '../importers.js';

const reduced = () => document.body.classList.contains('reduced-motion');
let ringSeq = 0;

function countUp(el, to, { dur = 1000, suffix = '' } = {}) {
  if (reduced() || !to) { el.textContent = to + suffix; return; }
  const t0 = performance.now(); el.textContent = '0' + suffix;
  const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function num(to, opts) { const el = h('span', { class: 'hm2-num' }, '0'); requestAnimationFrame(() => countUp(el, to, opts)); return el; }

function ring(value, { size = 96, stroke = 9, label = '' } = {}) {
  const id = 'hm2g' + (++ringSeq); const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const off = c * (1 - Math.max(0, Math.min(1, value || 0)));
  const el = h('span', { class: 'hm2-ring', style: { width: size + 'px', height: size + 'px' }, html:
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>` +
    `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" style="stroke:var(--surface-3)" stroke-width="${stroke}"/>` +
    `<circle class="fg" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${reduced() ? off : c}" transform="rotate(-90 ${mid} ${mid})"/></svg>` +
    (label ? `<span class="hm2-ring-l">${label}</span>` : '') });
  if (!reduced()) requestAnimationFrame(() => requestAnimationFrame(() => { const fg = el.querySelector('.fg'); if (fg) fg.style.strokeDashoffset = off; }));
  return el;
}

function upNext(n = 3) {
  const t = Date.now(), d = today(); const live = new Set(db.decks.filter(x => !x.archived).map(x => x.id));
  const rank = c => c.queue === QUEUE.LEARN ? 0 : c.queue === QUEUE.REVIEW ? 1 : 2;
  const due = db.cards.filter(c => live.has(c.deckId) && (c.queue === QUEUE.NEW || (c.queue === QUEUE.REVIEW && c.due <= d) || (c.queue === QUEUE.LEARN && c.due <= t + 20 * 60000)));
  return due.sort((a, b) => rank(a) - rank(b) || a.due - b.due).slice(0, n).map(c => {
    const note = db.notes.get(c.noteId); const ps = note ? notePairs(note) : []; const p = ps.find(x => x.card && x.card.id === c.id) || ps[0];
    return p ? { term: stripHtml(p.term || '').trim(), deck: db.decks.get(c.deckId)?.name || '', color: db.decks.get(c.deckId)?.color } : null;
  }).filter(x => x && x.term);
}

export function render(main) {
  const s = S(); const now = new Date(); const hour = now.getHours(); ringSeq = 0;
  const greet = hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const decks = db.decks.filter(d => !d.archived);
  const inner = h('div', { class: 'main-inner hm2' }); let i = 0; const rise = el => { el.classList.add('rise'); el.style.setProperty('--i', i++); return el; };

  inner.append(rise(h('header', { class: 'hm2-head' },
    h('div', {}, h('div', { class: 'hm2-date' }, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })), h('h1', { class: 'hm2-greet' }, greet)),
    h('div', { class: 'hm2-head-actions' },
      h('button', { class: 'btn btn-ghost', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import'),
      h('button', { class: 'btn', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'New set')))));

  if (!decks.length) {
    inner.append(rise(h('section', { class: 'hm2-hero empty' }, h('div', { class: 'hm2-today' },
      h('div', { class: 'hm2-eyebrow' }, 'Welcome'), h('div', { class: 'hm2-title' }, 'Make your first set'),
      h('div', { class: 'hm2-sub' }, 'Type your own cards, or import from Quizlet, Anki or a spreadsheet.'),
      h('div', { class: 'hm2-actions' }, h('button', { class: 'btn btn-primary hm2-cta', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'Create a set'), h('button', { class: 'btn btn-ghost', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import'))))));
    main.append(inner); return;
  }

  const due = dueCounts(null); const totalDue = due.new + due.learn + due.review;
  const streak = streakInfo(); const ts = todayStudy(); const fc = forecast(null, 7); const ret = retentionStats(null, 30);
  const info = decks.map(d => { const c = dueCounts(d.id, d); return { d, n: c.new + c.learn + c.review, m: deckMastery(d.id) }; });
  const weakest = info.filter(x => x.m.total).sort((a, b) => a.m.pct - b.m.pct)[0];

  // ---------- Hero ----------
  const mins = Math.max(1, Math.round(totalDue * 8 / 60));
  const split = (n, label, color) => h('div', { class: 'hm2-split-i' }, h('i', { style: { background: color } }), h('b', {}, n), h('span', {}, label));
  const start = () => totalDue ? navigate('study/review/all') : weakest && navigate(`study/learn/${weakest.d.id}`);
  const today_ = totalDue
    ? h('div', { class: 'hm2-today' },
        h('div', { class: 'hm2-eyebrow' }, "Today's session"),
        h('div', { class: 'hm2-count' }, num(totalDue), h('span', { class: 'hm2-unit' }, totalDue === 1 ? 'card' : 'cards')),
        h('div', { class: 'hm2-sub' }, `About ${mins} min. Ready when you are.`),
        h('div', { class: 'hm2-split' }, split(due.new, 'New', 'var(--accent)'), split(due.learn, 'Learning', 'var(--warn)'), split(due.review, 'Review', 'var(--ok)')),
        h('div', { class: 'hm2-actions' }, h('button', { class: 'btn btn-primary hm2-cta', onClick: start }, svgIcon('play', 16), 'Start review'), h('button', { class: 'btn btn-ghost', onClick: () => navigate('library') }, 'Choose a set')))
    : h('div', { class: 'hm2-today' },
        h('div', { class: 'hm2-eyebrow' }, "Today's session"),
        h('div', { class: 'hm2-title' }, 'All caught up'),
        h('div', { class: 'hm2-sub' }, fc[1] ? `${plural(fc[1], 'card')} due tomorrow. Nice work.` : 'Nothing scheduled for tomorrow either.'),
        h('div', { class: 'hm2-actions' }, weakest ? h('button', { class: 'btn btn-primary hm2-cta', onClick: start }, svgIcon('zap', 16), h('span', { class: 'ellipsis' }, `Practise ${weakest.d.name}`)) : null, h('button', { class: 'btn btn-ghost', onClick: () => navigate('library') }, 'Browse sets')));
  const next = upNext(3);
  const cards = next.length ? next : [{ term: totalDue ? 'Ready' : 'All done', deck: totalDue ? '' : 'Come back tomorrow' }];
  const stackInner = h('div', { class: 'hm2-stack-in' }, ...cards.slice().reverse().map((c, k, arr) => {
    const depth = arr.length - 1 - k; // 0 = top
    return h('div', { class: `hm2-card d${depth}`, style: { '--c': c.color || 'var(--accent)' } },
      depth === 0 ? h('div', { class: 'hm2-card-label' }, next.length ? 'Up next' : (totalDue ? 'Up next' : 'Done for today')) : null,
      h('div', { class: 'hm2-card-term' }, c.term),
      c.deck ? h('div', { class: 'hm2-card-deck' }, h('i', {}), c.deck) : null);
  }));
  const stack = h('button', { class: 'hm2-stack', 'aria-label': 'Start review', onClick: start }, stackInner);
  stack.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || reduced()) return; const r = stack.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; stackInner.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 12}deg)`; });
  stack.addEventListener('pointerleave', () => { stackInner.style.transform = ''; });
  inner.append(rise(h('section', { class: 'hm2-hero' }, h('div', { class: 'hm2-mesh' }, h('i', { class: 'm1' }), h('i', { class: 'm2' }), h('i', { class: 'm3' })), today_, stack)));

  // ---------- Glance tiles ----------
  const goal = Math.min(1, ts.cards / Math.max(1, ts.goalCards));
  let tot = 0, mas = 0; info.forEach(x => { tot += x.m.total; mas += x.m.mastered; });
  const tile = (...kids) => h('div', { class: 'hm2-tile' }, ...kids);
  inner.append(rise(h('section', { class: 'hm2-tiles' },
    tile(h('div', { class: `hm2-flame ${streak.studiedToday ? 'on' : ''}` }, svgIcon('flame', 26)),
      h('div', { class: 'hm2-tile-t' }, h('div', { class: 'hm2-tile-big' }, num(streak.current), h('span', {}, streak.current === 1 ? ' day' : ' days')), h('div', { class: 'hm2-tile-s' }, streak.studiedToday ? 'Streak safe for today' : streak.current ? 'Study today to keep it' : 'Start a streak today'), weekDots())),
    tile(ring(goal, { size: 84, stroke: 8, label: `${Math.round(goal * 100)}%` }),
      h('div', { class: 'hm2-tile-t' }, h('div', { class: 'hm2-tile-k' }, 'Daily goal'), h('div', { class: 'hm2-tile-big' }, num(Math.min(ts.cards, ts.goalCards)), h('span', {}, ` / ${ts.goalCards}`)), h('div', { class: 'hm2-tile-s' }, goal >= 1 ? 'Goal complete' : `${ts.goalCards - Math.min(ts.cards, ts.goalCards)} cards to go`))),
    tile(ring(tot ? mas / tot : 0, { size: 84, stroke: 8, label: `${pct(mas, tot)}%` }),
      h('div', { class: 'hm2-tile-t' }, h('div', { class: 'hm2-tile-k' }, 'Mastered'), h('div', { class: 'hm2-tile-big' }, num(mas), h('span', {}, ` / ${tot}`)), h('div', { class: 'hm2-tile-s' }, ret.retention == null ? 'Recall rate appears after reviews' : `${Math.round(ret.retention * 100)}% recall rate, 30 days`))))));

  // ---------- Jump back in ----------
  const recentIds = s.recentDecks || []; const rank = x => { const r = recentIds.indexOf(x.d.id); return r < 0 ? 1e9 : r; };
  const list = info.slice().sort((a, b) => rank(a) - rank(b) || (b.d.lastStudied || b.d.created || 0) - (a.d.lastStudied || a.d.created || 0)).slice(0, 5);
  inner.append(rise(h('section', { class: 'hm2-section' },
    h('div', { class: 'hm2-section-head' }, h('h2', {}, 'Jump back in'), h('button', { class: 'hm2-link', onClick: () => navigate('library') }, `All sets (${decks.length})`, svgIcon('arrowRight', 14))),
    h('div', { class: 'hm2-sets' }, ...list.map(({ d, n, m }, k) => h('button', { class: 'hm2-set', style: { '--c': d.color || 'var(--accent)', '--k': k }, onClick: () => navigate(`set/${d.id}`) },
      h('span', { class: 'hm2-set-ring' }, ring(m.pct, { size: 40, stroke: 4 }), h('span', { class: 'hm2-set-dot' })),
      h('span', { class: 'hm2-set-main' }, h('span', { class: 'hm2-set-name' }, d.name), h('span', { class: 'hm2-set-meta' }, `${plural(m.total, 'card')} · ${Math.round(m.pct * 100)}% mastered${d.lastStudied ? ' · ' + fmtRelative(d.lastStudied) : ''}`)),
      n ? h('span', { class: 'hm2-pill' }, `${n} due`) : h('span', { class: 'hm2-pill done' }, svgIcon('check', 12), 'Done'),
      h('span', { class: 'hm2-chev' }, svgIcon('chevronRight', 16))))))));

  // ---------- Your week ----------
  const roll = (s.dayRollover ?? 4) * 3600000; const dayN = t => Math.floor((t - roll) / 86400000); const todayN = dayN(Date.now());
  const act = new Array(14).fill(0); for (const r of db.revlog.all()) { const k = todayN - dayN(r.time); if (k >= 0 && k < 14) act[13 - k]++; }
  const total14 = act.reduce((a, b) => a + b, 0); const maxA = Math.max(1, ...act); const W = 320, H = 80;
  const pts = act.map((v, k) => [Math.round(k / 13 * W), Math.round(H - 6 - v / maxA * (H - 14))]);
  const line = pts.map((p, k) => (k ? 'L' : 'M') + p.join(' ')).join(' '); const area = `${line} L${W} ${H} L0 ${H} Z`;
  const spark = h('div', { class: 'hm2-spark', html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="hm2a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs><path class="area" d="${area}" fill="url(#hm2a)"/><path class="line" d="${line}" pathLength="1" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>` });
  const maxF = Math.max(1, ...fc);
  inner.append(rise(h('section', { class: 'hm2-section' },
    h('div', { class: 'hm2-section-head' }, h('h2', {}, 'Your rhythm'), h('button', { class: 'hm2-link', onClick: () => navigate('stats') }, 'Statistics', svgIcon('arrowRight', 14))),
    h('div', { class: 'hm2-week' },
      h('div', { class: 'hm2-panel' }, h('div', { class: 'hm2-panel-top' }, h('div', {}, h('div', { class: 'hm2-tile-k' }, 'Last 2 weeks'), h('div', { class: 'hm2-tile-big' }, num(total14), h('span', {}, ' reviews'))), h('div', { class: 'hm2-tile-s' }, `${act.filter(Boolean).length} active days`)), spark),
      h('div', { class: 'hm2-panel' }, h('div', { class: 'hm2-panel-top' }, h('div', {}, h('div', { class: 'hm2-tile-k' }, 'Coming up'), h('div', { class: 'hm2-tile-big' }, num(fc.reduce((a, b) => a + b, 0)), h('span', {}, ' this week'))), null),
        fc.some(Boolean) ? h('div', { class: 'hm2-bars' }, ...fc.map((v, k) => h('div', { class: 'hm2-bar-col' }, h('span', { class: 'hm2-bar-n' }, v || ''), h('div', { class: `hm2-bar ${v ? '' : 'zero'} ${k === 0 ? 'today' : ''}`, style: { height: Math.max(4, Math.round(v / maxF * 54)) + 'px', '--k': k } }), h('span', { class: 'hm2-bar-d' }, k === 0 ? 'Today' : new Date(Date.now() + k * 86400000).toLocaleDateString(undefined, { weekday: 'short' })))))
          : h('div', { class: 'hm2-empty' }, 'Reviews you schedule will appear here.'))))));
  main.append(inner);
}

function weekDots() {
  const roll = (S().dayRollover ?? 4) * 3600000; const days = new Set();
  for (const r of db.revlog.all()) days.add(Math.floor((r.time - roll) / 86400000));
  for (const x of db.sessions.all()) days.add(Math.floor((x.start - roll) / 86400000));
  const todayN = Math.floor((Date.now() - roll) / 86400000); const wrap = h('div', { class: 'hm2-week-dots' });
  for (let k = 6; k >= 0; k--) { const n = todayN - k; const d = new Date((n * 86400000) + roll + 43200000); wrap.append(h('span', { class: `hm2-wd ${days.has(n) ? 'on' : ''} ${k === 0 ? 'today' : ''}`, title: d.toLocaleDateString(undefined, { weekday: 'long' }) }, d.toLocaleDateString(undefined, { weekday: 'narrow' }))); }
  return wrap;
}
