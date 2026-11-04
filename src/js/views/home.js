// Home: today, in one glance.
//
// Three questions, three regions, no dead tiles:
//  1. What should I do now?   The session hero: how many cards, how long, what kind, one button.
//                             The real next cards wait in a stack beside it; tapping the stack starts too.
//  2. Where was I?            Continue: the sets you touched last, each with its own due count.
//  3. How am I doing?         One band: streak with this week's activity, daily goal, mastery, and the
//                             week ahead (today's bar is the session you're about to do).
//
// Numbers agree with the session: "cards ready" is the scheduler's real queue for today (daily limits
// applied), not a sum of every set's maximum.
//
// Motion (transform/opacity only; honours Reduce motion and the Edge glow setting)
//  - The greeting resolves word by word; the date and the hero follow.
//  - The session count rolls up, the mix bar fills segment by segment, the stack deals in from the
//    right and settles into a slow idle float. Rings draw, week bars grow from the baseline,
//    streak days light in sequence.
//  - Start: the top card is flicked off the deck before the review opens.
//  - Mouse: the stack tilts toward the pointer in 3D.
import { db } from '../db.js';
import { S, notePairs } from '../models.js';
import { h, plural, pct, stripHtml } from '../utils.js';
import { dueCounts, streakInfo, retentionStats, forecast, QUEUE, today } from '../scheduler.js';
import { todayStudy } from '../xp.js';
import { navigate, createSetFlow } from '../app.js';
import { deckMastery } from './common.js';
import { showImportDialog } from '../importers.js';

const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAYMS = 86400000;

const GL = {
  play: '<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.8-6.2a.8.8 0 0 0 0-1.4L9.2 5.1A.8.8 0 0 0 8 5.8z" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  upload: '<path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  flame: '<path d="M12 21.5c-3.9 0-6.5-2.6-6.5-6.2 0-2.6 1.4-4.6 3-6.2.4 1.5 1.3 2.6 2.4 3.1C10.6 9 11.6 5.6 14.2 2.5c.3 3.2 1.6 5 3 6.8 1 1.4 1.8 3.1 1.8 5.4 0 3.9-2.9 6.8-7 6.8z"/>',
  check: '<path d="m5.5 12.5 4 4 9-9.5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
};
function gl(name, size = 18, cls = '') {
  const s = document.createElement('span'); s.className = `hx-gl ${cls}`;
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GL[name]}</svg>`;
  return s;
}

// ---------- motion helpers ----------
function countUp(el, to, { dur = 1100, delay = 0 } = {}) {
  if (reduced() || !to) { el.textContent = to; return; }
  el.textContent = '0';
  setTimeout(() => { let t0 = 0; requestAnimationFrame(function step(t) { t0 ||= t; const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); }); }, delay);
}
const num = (to, delay = 0, cls = 'hx-num') => { const el = h('span', { class: cls }, String(to)); requestAnimationFrame(() => countUp(el, to, { delay })); return el; };

let ringId = 0;
function ring(value, { size = 64, stroke = 6, color = 'var(--accent)', color2, label, delay = 0 } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, m = size / 2; const v = Math.max(0, Math.min(1, value || 0)); const id = `hxr${++ringId}`;
  const el = h('span', { class: 'hx-ring', style: { width: `${size}px`, height: `${size}px`, '--delay': `${delay}ms` } });
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">`
    + (color2 ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${color}"/><stop offset="1" style="stop-color:${color2}"/></linearGradient></defs>` : '')
    + `<circle class="hx-ring-track" cx="${m}" cy="${m}" r="${r}" stroke-width="${stroke}"/>`
    + (v > 0.001 ? `<circle class="hx-ring-fg" cx="${m}" cy="${m}" r="${r}" stroke-width="${stroke}" style="stroke:${color2 ? `url(#${id})` : color};--c:${c.toFixed(2)};--off:${(c * (1 - v)).toFixed(2)}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}"/>` : '')
    + '</svg>' + (label != null ? `<span class="hx-ring-l">${label}</span>` : '');
  return el;
}

// The real next cards in the queue (learning first, then reviews, then new), for the preview stack.
function upNext(n = 3) {
  const t = Date.now(), d = today(); const live = new Set(db.decks.filter(x => !x.archived).map(x => x.id));
  const rank = c => c.queue === QUEUE.LEARN ? 0 : c.queue === QUEUE.REVIEW ? 1 : 2;
  const due = db.cards.filter(c => live.has(c.deckId) && (c.queue === QUEUE.NEW || (c.queue === QUEUE.REVIEW && c.due <= d) || (c.queue === QUEUE.LEARN && c.due <= t + 20 * 60000)));
  return due.sort((a, b) => rank(a) - rank(b) || a.due - b.due).slice(0, n).map(c => {
    const note = db.notes.get(c.noteId); const ps = note ? notePairs(note) : []; const p = ps.find(x => x.card && x.card.id === c.id) || ps[0];
    const dk = db.decks.get(c.deckId);
    return p ? { term: stripHtml(p.term || '').trim(), deck: dk?.name || '', color: dk?.color, kind: rank(c) } : null;
  }).filter(x => x && x.term);
}

// Days are counted from the user's rollover hour, like the scheduler.
function dayIndex() { const roll = (S().dayRollover ?? 4) * 3600000; return t => Math.floor((t - roll) / DAYMS); }

export function render(main) {
  ringId = 0;
  const now = new Date(); const hour = now.getHours();
  const greet = hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = (S().profileName || S().name || '').trim().split(/\s+/)[0];
  const decks = db.decks.filter(d => !d.archived);
  const inner = h('div', { class: 'main-inner hx' });
  let seq = 0; const rise = (el, step = 1) => { el.classList.add('hx-in'); el.style.setProperty('--i', seq); seq += step; return el; };

  // ---------- header ----------
  const words = (name ? `${greet}, ${name}` : greet).split(' ');
  inner.append(h('header', { class: 'hx-head' },
    h('div', { class: 'hx-head-text' },
      h('p', { class: 'hx-date hx-in', style: { '--i': 0 } }, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
      h('h1', { class: 'hx-greet', 'aria-label': words.join(' ') }, ...words.map((w, k) => h('span', { class: 'hx-word', style: { '--w': k }, 'aria-hidden': 'true' }, w)))),
    h('div', { class: 'hx-head-actions hx-in', style: { '--i': 1 } },
      h('button', { type: 'button', class: 'hx-btn hx-btn-quiet', onClick: () => showImportDialog() }, gl('upload', 17), h('span', {}, 'Import')),
      h('button', { type: 'button', class: 'hx-btn hx-btn-soft hx-new', onClick: () => createSetFlow() }, gl('plus', 17), h('span', {}, 'New set')))));
  seq = 2;

  if (!decks.length) { inner.append(rise(welcome())); main.append(inner); return; }

  // ---------- data ----------
  const due = dueCounts(null); const totalDue = due.new + due.learn + due.review;
  const streak = streakInfo(); const ts = todayStudy(); const fc = forecast(null, 7); const ret = retentionStats(null, 30);
  const info = decks.map(d => { let n = 0; try { const c = dueCounts(d.id, d); n = c.new + c.learn + c.review; } catch (e) { /* */ } return { d, n, m: deckMastery(d.id) }; });
  const weakest = info.filter(x => x.m.total).sort((a, b) => a.m.pct - b.m.pct)[0];
  const start = () => totalDue ? navigate('study/review/all') : weakest ? navigate(`study/learn/${weakest.d.id}`) : navigate('library');

  const grid = h('div', { class: 'hx-grid' }); inner.append(grid);

  // ---------- hero ----------
  const mins = Math.max(1, Math.round(totalDue * 8 / 60));
  const next = upNext(8);
  const stack = deck(next, totalDue, () => start());
  const hero = h('section', { class: `hx-hero ${totalDue ? '' : 'is-done'}`, 'aria-label': "Today's session" },
    h('div', { class: 'hx-aura', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'hx-hero-main' }, ...(totalDue ? [
      h('p', { class: 'hx-eyebrow' }, h('span', { class: 'hx-live', 'aria-hidden': 'true' }), "Today's session", h('span', { class: 'hx-dim' }, `· about ${mins} min`)),
      h('div', { class: 'hx-big' }, num(totalDue, 260, 'hx-num hx-big-n'), h('span', { class: 'hx-big-u' }, totalDue === 1 ? 'card ready' : 'cards ready')),
      mixBar([{ n: due.learn, label: 'Learning', c: 'var(--warn)' }, { n: due.review, label: 'Review', c: 'var(--ok)' }, { n: due.new, label: 'New', c: 'var(--accent)' }], totalDue),
      h('div', { class: 'hx-cta-row' },
        h('button', { type: 'button', class: 'hx-btn hx-btn-primary hx-cta', onClick: () => stack.deal() }, gl('play', 15), h('span', {}, 'Start review'), h('kbd', { class: 'hx-kbd' }, 'Space')),
        h('button', { type: 'button', class: 'hx-btn hx-btn-quiet', onClick: () => navigate('library') }, 'Pick a set')),
    ] : [
      h('p', { class: 'hx-eyebrow' }, "Today's session"),
      h('div', { class: 'hx-done' }, h('span', { class: 'hx-done-badge' }, gl('check', 26)), h('div', {}, h('h2', { class: 'hx-done-t' }, 'All caught up'), h('p', { class: 'hx-done-s' }, fc[1] ? `${plural(fc[1], 'card')} due tomorrow.` : 'Nothing due tomorrow either.'))),
      h('div', { class: 'hx-cta-row' },
        weakest ? h('button', { type: 'button', class: 'hx-btn hx-btn-primary hx-cta', onClick: start }, gl('bolt', 16), h('span', { class: 'hx-ellipsis' }, `Practise ${weakest.d.name}`)) : null,
        h('button', { type: 'button', class: 'hx-btn hx-btn-quiet', onClick: () => navigate('library') }, 'Browse sets')),
    ])),
    stack.el);
  grid.append(rise(hero));

  // ---------- continue ----------
  const recent = S().recentDecks || []; const rank = x => { const r = recent.indexOf(x.d.id); return r < 0 ? 1e9 : r; };
  const list = info.slice().sort((a, b) => rank(a) - rank(b) || (b.d.lastStudied || b.d.created || 0) - (a.d.lastStudied || a.d.created || 0)).slice(0, 4);
  grid.append(rise(h('section', { class: 'hx-panel hx-continue', 'aria-label': 'Continue' },
    h('div', { class: 'hx-panel-head' }, h('h2', {}, 'Continue'), h('button', { type: 'button', class: 'hx-link', onClick: () => navigate('library') }, `All ${decks.length}`, gl('chev', 15))),
    h('div', { class: 'hx-rows' }, ...list.map(({ d, n, m }, k) => h('button', { type: 'button', class: 'hx-row', style: { '--c': d.color || 'var(--accent)', '--k': k }, onClick: () => navigate(`set/${d.id}`), 'aria-label': `${d.name}, ${Math.round(m.pct * 100)}% mastered${n ? `, ${n} due` : ''}` },
      ring(m.pct, { size: 36, stroke: 3.5, color: d.color || 'var(--accent)', delay: 520 + k * 70, label: '' }),
      h('span', { class: 'hx-row-main' }, h('span', { class: 'hx-row-name' }, d.name), h('span', { class: 'hx-row-meta' }, `${plural(m.total, 'card')} · ${Math.round(m.pct * 100)}% mastered`)),
      n ? h('span', { class: 'hx-chip' }, `${n} due`) : h('span', { class: 'hx-chip is-done' }, gl('check', 12), 'Done'),
      gl('chev', 16, 'hx-row-chev')))))));

  // ---------- stats band ----------
  const di = dayIndex(); const todayN = di(Date.now());
  const act = new Array(7).fill(0); const studied = new Set();
  for (const r of db.revlog.all()) { const k = todayN - di(r.time); if (k >= 0 && k < 7) { act[6 - k]++; studied.add(6 - k); } }
  for (const x of db.sessions.all()) { const k = todayN - di(x.start); if (k >= 0 && k < 7) studied.add(6 - k); }
  const dayName = (offset, style = 'narrow') => new Date(Date.now() + offset * DAYMS).toLocaleDateString(undefined, { weekday: style });
  const goal = Math.min(1, ts.cards / Math.max(1, ts.goalCards));
  let tot = 0, mas = 0; info.forEach(x => { tot += x.m.total; mas += x.m.mastered; });
  const ahead = fc.slice(); ahead[0] = totalDue; const maxA = Math.max(1, ...ahead);
  const busiest = ahead.indexOf(Math.max(...ahead)); const weekTotal = ahead.reduce((a, b) => a + b, 0);

  const cell = (cls, ...kids) => h('div', { class: `hx-cell ${cls}` }, ...kids);
  grid.append(rise(h('section', { class: 'hx-band', 'aria-label': 'Progress' },
    cell('hx-streak',
      h('div', { class: 'hx-cell-top' }, h('span', { class: `hx-flame ${streak.studiedToday ? 'on' : ''}` }, gl('flame', 20)), h('span', { class: 'hx-cell-k' }, 'Streak')),
      h('div', { class: 'hx-stat' }, num(streak.current, 600), h('span', { class: 'hx-stat-u' }, streak.current === 1 ? 'day' : 'days')),
      h('div', { class: 'hx-week', role: 'img', 'aria-label': `Studied on ${studied.size} of the last 7 days` }, ...act.map((v, k) => h('span', { class: `hx-wd ${studied.has(k) ? 'on' : ''} ${k === 6 ? 'today' : ''}`, style: { '--k': k } }, h('i'), h('b', {}, dayName(k - 6)))))),
    cell('hx-goal',
      ring(goal, { size: 58, stroke: 6, color: 'var(--accent)', color2: 'var(--accent-2)', label: `${Math.round(goal * 100)}%`, delay: 640 }),
      h('div', { class: 'hx-cell-txt' }, h('span', { class: 'hx-cell-k' }, 'Daily goal'),
        h('div', { class: 'hx-stat' }, num(Math.min(ts.cards, ts.goalCards), 640), h('span', { class: 'hx-stat-u' }, `/ ${ts.goalCards}`)),
        h('span', { class: 'hx-cell-s' }, goal >= 1 ? 'Goal complete' : `${ts.goalCards - Math.min(ts.cards, ts.goalCards)} cards to go`))),
    cell('hx-mastery',
      ring(tot ? mas / tot : 0, { size: 58, stroke: 6, color: 'var(--ok)', label: `${pct(mas, tot)}%`, delay: 720 }),
      h('div', { class: 'hx-cell-txt' }, h('span', { class: 'hx-cell-k' }, 'Mastered'),
        h('div', { class: 'hx-stat' }, num(mas, 720), h('span', { class: 'hx-stat-u' }, `/ ${tot}`)),
        h('span', { class: 'hx-cell-s' }, ret.retention == null ? 'No reviews yet' : `${Math.round(ret.retention * 100)}% recall rate`))),
    cell('hx-ahead',
      h('div', { class: 'hx-cell-top' }, h('span', { class: 'hx-cell-k' }, 'Week ahead'), h('span', { class: 'hx-cell-s', title: weekTotal ? `Busiest: ${busiest === 0 ? 'today' : dayName(busiest, 'long')}` : '' }, weekTotal ? `${weekTotal} cards` : 'Clear week')),
      h('div', { class: 'hx-bars', role: 'img', 'aria-label': ahead.map((v, k) => `${k === 0 ? 'Today' : dayName(k, 'long')}: ${v}`).join(', ') },
        ...ahead.map((v, k) => h('span', { class: `hx-bar ${k === 0 ? 'today' : ''} ${v ? '' : 'zero'}`, style: { '--h': `${Math.max(v ? 10 : 0, v / maxA * 100)}%`, '--k': k } },
          h('i', {}, v ? h('em', {}, v) : null), h('b', {}, k === 0 ? 'Today' : dayName(k)))))))));

  main.append(inner);
  fitToView(inner);

  // Space starts the session (desktop); ignored while typing or when a dialog is open.
  const onKey = e => {
    if (!inner.isConnected) { removeEventListener('keydown', onKey); return; }
    if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName) || document.querySelector('.modal, .menu, .palette, .cs-scrim')) return;
    e.preventDefault(); stack.deal();
  };
  const onArrows = e => {
    if (!inner.isConnected) { removeEventListener('keydown', onArrows); return; }
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('.modal, .menu, .palette, .cs-scrim')) return;
    e.preventDefault(); stack.cycle(e.key === 'ArrowRight' ? 1 : -1);
  };
  addEventListener('keydown', onArrows);
  addEventListener('keydown', onKey);
}

// ---------- one view, no scrolling ----------
// Pin Home to the visible area, then step through denser levels until nothing overflows: compact
// spacing, then fewer Continue rows (never fewer than two), then tight (secondary text drops away).
// Re-runs on resize/rotation. Falls back to scrolling only if even the tightest level can't fit.
function fitToView(inner) {
  const rows = [...inner.querySelectorAll('.hx-row')];
  const over = () => {
    // Layout boxes, not scrollHeight: entrance transforms would otherwise read as overflow.
    const g = inner.querySelector('.hx-grid');
    if (g && g.offsetTop - inner.offsetTop + g.offsetHeight > inner.clientHeight - parseFloat(getComputedStyle(inner).paddingBottom) + 1) return true;
    // Content regions only: the hero's glow and the deck's rotated cards overflow on purpose.
    if ([...inner.querySelectorAll('.hx-hero-main, .hx-rows, .hx-cell')].some(el => el.scrollHeight > el.clientHeight + 1)) return true;
    const panel = inner.querySelector('.hx-continue'); const rowsEl = inner.querySelector('.hx-rows');
    if (panel && rowsEl && rowsEl.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom - 4) return true;
    const dk = inner.querySelector('.hx-deck'); const top = inner.querySelector('.hx-card');
    return !!(dk && top && dk.offsetParent && dk.clientHeight < top.offsetHeight + 24);
  };
  const run = () => {
    if (!inner.isConnected) { removeEventListener('resize', onResize); return; }
    inner.classList.add('hx-fit'); inner.classList.remove('hx-compact', 'hx-tight');
    rows.forEach(r => { r.style.display = ''; });
    if (!over()) return;
    inner.classList.add('hx-compact'); if (!over()) return;
    // Drop Continue rows only while the list itself overflows (never below two).
    const rowsOver = () => { const r = inner.querySelector('.hx-rows'), p = inner.querySelector('.hx-continue'); return !!(r && p && (r.scrollHeight > r.clientHeight + 1 || r.getBoundingClientRect().bottom > p.getBoundingClientRect().bottom - 4)); };
    for (let k = rows.length - 1; k >= 2 && rowsOver(); k--) rows[k].style.display = 'none';
    if (!over()) return;
    inner.classList.add('hx-tight'); if (!over()) return;
    inner.classList.remove('hx-fit', 'hx-compact', 'hx-tight'); rows.forEach(r => { r.style.display = ''; }); // too small to fit: scroll instead
  };
  let raf = 0; const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); };
  addEventListener('resize', onResize);
  run(); requestAnimationFrame(run); // again after fonts/layout settle
  document.fonts?.ready?.then(() => inner.isConnected && run());
}

// ---------- pieces ----------
function mixBar(parts, total) {
  const live = parts.filter(p => p.n);
  return h('div', { class: 'hx-mix' },
    h('div', { class: 'hx-mix-bar', role: 'img', 'aria-label': live.map(p => `${p.n} ${p.label}`).join(', ') },
      ...live.map((p, k) => h('i', { style: { flexGrow: p.n, '--c': p.c, '--k': k } }))),
    h('div', { class: 'hx-mix-legend' }, ...parts.map(p => h('span', { class: `hx-mix-i ${p.n ? '' : 'zero'}`, style: { '--c': p.c } }, h('i'), h('b', {}, p.n), p.label))));
}

// The "Up next" deck: the real next cards in the queue.
//  - Swipe (or drag, or ←/→) to flick through them: the top card follows the finger with a little
//    rotation, the card beneath rises as you pull, and past a distance or a quick flick the card sails
//    off and tucks in at the back. Short of that, it springs home.
//  - Tap starts the review: the top card is flicked off the deck first.
//  - Mouse: the deck tilts toward the pointer; a glare follows it.
//  - First visit per session: the top card nudges once to show it can move.
function deck(next, totalDue, onStart, { emptyTerm, emptyLbl, fixed = false } = {}) {
  const cards = next.length ? next : [{ term: emptyTerm || (totalDue ? 'Ready when you are' : 'See you tomorrow'), deck: '', empty: true }];
  const kindLbl = ['Learning', 'Review', 'New']; const n = cards.length;
  const els = cards.map((c, i) => h('div', { class: `hx-card ${c.empty ? 'is-empty' : ''}`, style: { '--c': c.color || 'var(--accent)' } },
    h('div', { class: 'hx-card-top' },
      h('span', { class: 'hx-card-lbl' }, emptyLbl || (!next.length ? (totalDue ? 'Up next' : 'Done for today') : i === 0 ? 'Up next' : `${i + 1} of ${n}`)),
      c.kind != null ? h('span', { class: 'hx-card-kind' }, kindLbl[c.kind]) : null),
    h('div', { class: 'hx-card-term' }, c.term),
    c.deck ? h('div', { class: 'hx-card-deck' }, h('i'), h('span', {}, c.deck)) : null));
  const inner = h('div', { class: 'hx-deck-in' }, ...els);
  const swipeable = !fixed && n > 1;
  const el = h('div', { class: `hx-deck ${swipeable ? 'is-swipeable' : ''}`, role: 'group', 'aria-roledescription': 'card deck', 'aria-label': swipeable ? `Up next, ${n} cards. Swipe to browse, tap to start.` : 'Up next' }, inner);
  let order = els.slice(); // order[0] is on top

  const layout = () => order.forEach((c, d) => {
    c.style.setProperty('--d', Math.min(d, 3)); c.style.zIndex = String(20 - d);
    c.classList.toggle('d0', d === 0); c.classList.toggle('is-hidden', d > 2);
  });
  layout();
  // Entrance is CSS; after it (or the first touch) cards switch to transitions so depth changes glide.
  const live = () => el.classList.add('is-live');
  setTimeout(live, 1800);

  let busy = false;
  const deal = () => { if (busy) return; busy = true; if (reduced()) { onStart(); return; } live(); el.classList.add('is-dealing'); setTimeout(onStart, 340); };

  const clearInline = c => { c.style.transform = ''; c.style.opacity = ''; };
  function cycle(dir) { // send the top card off in `dir` (-1 left, 1 right) and tuck it at the back
    if (!swipeable || busy) return; live();
    const top = order[0]; const under = order[1];
    try { navigator.vibrate?.(5); } catch (e) { /* unsupported */ }
    if (reduced()) { order.push(order.shift()); clearInline(top); clearInline(under); layout(); return; }
    top.classList.remove('is-drag'); top.classList.add('is-fling');
    top.style.transform = `translate3d(${dir * 135}%, -8%, 0) rotate(${dir * 22}deg)`; top.style.opacity = '0';
    clearInline(under); order.push(order.shift()); // the rest re-layer now; the old top finishes flying
    order.slice(0, -1).forEach((c, d) => { c.style.setProperty('--d', Math.min(d, 3)); c.style.zIndex = String(20 - d); c.classList.toggle('d0', d === 0); c.classList.toggle('is-hidden', d > 2); });
    setTimeout(() => { // re-enter at the back, unseen
      top.classList.remove('is-fling'); top.classList.add('is-reset'); clearInline(top); layout();
      requestAnimationFrame(() => requestAnimationFrame(() => top.classList.remove('is-reset')));
    }, 300);
  }

  // ---- pointer: drag to swipe, tap to start ----
  let drag = null; let suppressClick = false;
  el.addEventListener('pointerdown', e => {
    if (busy || (e.pointerType === 'mouse' && e.button)) return;
    live(); drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
    el.setPointerCapture(e.pointerId); inner.style.transform = '';
  });
  el.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) {
      if (e.pointerType === 'mouse' && !reduced() && !drag) { // hover tilt + glare
        const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        inner.style.transform = `rotateY(${x * 16}deg) rotateX(${-y * 12}deg)`; inner.style.setProperty('--gx', `${(x + .5) * 100}%`); inner.style.setProperty('--gy', `${(y + .5) * 100}%`);
      }
      return;
    }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; const t = performance.now();
    drag.v = (e.clientX - drag.lastX) / Math.max(1, t - drag.lastT); drag.lastX = e.clientX; drag.lastT = t;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    drag.moved = true; drag.dx = dx; if (!swipeable) return;
    const top = order[0], under = order[1]; top.classList.add('is-drag');
    // rubber-band vertical motion; rotation follows the horizontal pull
    top.style.transform = `translate3d(${dx}px, ${dy * .18}px, 0) rotate(${dx * .065}deg)`;
    const p = Math.min(1, Math.abs(dx) / 140); // the card beneath rises as you pull
    if (under) { under.classList.add('is-drag'); under.style.transform = `translate3d(${(1 - p) * 13}px, ${(1 - p) * -11}px, ${(1 - p) * -30}px) rotate(${(1 - p) * 5}deg)`; under.style.opacity = String(.72 + p * .28); }
  });
  const end = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; const top = order[0], under = order[1];
    top.classList.remove('is-drag'); under?.classList.remove('is-drag');
    if (e.type === 'pointerup' && !d.moved) { deal(); return; }
    suppressClick = d.moved;
    if (!swipeable) return;
    if (e.type === 'pointerup' && (Math.abs(d.dx) > 84 || (Math.abs(d.v) > .55 && Math.abs(d.dx) > 24))) cycle(Math.sign(d.dx || d.v));
    else { clearInline(top); if (under) clearInline(under); } // spring home
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => { if (suppressClick) { suppressClick = false; e.preventDefault(); } });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) { inner.style.transform = ''; inner.style.removeProperty('--gx'); } });

  // One-time hint that the deck moves
  if (swipeable && !reduced()) {
    let seen = false; try { seen = sessionStorage.getItem('hxSwipeHint') === '1'; sessionStorage.setItem('hxSwipeHint', '1'); } catch (e) { /* storage blocked */ }
    if (!seen) setTimeout(() => { if (!el.isConnected || drag || busy) return; order[0].animate([{ transform: 'none' }, { transform: 'translate3d(30px, -2px, 0) rotate(3.5deg)', offset: .45 }, { transform: 'none' }], { duration: 900, easing: 'cubic-bezier(.3, .7, .3, 1)' }); }, 2200);
  }
  return { el, deal, cycle };
}

function welcome() {
  return h('section', { class: 'hx-hero hx-welcome' },
    h('div', { class: 'hx-aura', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'hx-hero-main' },
      h('p', { class: 'hx-eyebrow' }, 'Welcome to Recall'),
      h('h2', { class: 'hx-welcome-t' }, 'Make your first set'),
      h('p', { class: 'hx-welcome-s' }, 'Type your own cards, or bring them in from Quizlet, Anki or a spreadsheet. Recall schedules the reviews for you.'),
      h('div', { class: 'hx-cta-row' },
        h('button', { type: 'button', class: 'hx-btn hx-btn-primary hx-cta', onClick: () => createSetFlow() }, gl('plus', 16), h('span', {}, 'Create a set')),
        h('button', { type: 'button', class: 'hx-btn hx-btn-quiet', onClick: () => showImportDialog() }, gl('upload', 16), h('span', {}, 'Import')))),
    deck([{ term: 'Your first card', deck: 'New set', color: 'var(--accent)' }, { term: ' ' }, { term: ' ' }], 0, () => createSetFlow(), { emptyLbl: 'Preview', fixed: true }).el);
}
