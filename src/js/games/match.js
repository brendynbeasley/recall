// Match: pair terms with definitions as fast as you can.
import { db } from '../db.js';
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, sample, escapeHtml } from '../utils.js';
import { toast, countdown, confetti, shake } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, sideHtml, recordMastery, resultsScreen, sessionTracker, optionsModal, keyHandler, loadPairs, fmtTimer, sideImage } from '../modes/common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().match;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (pairs.length < 2) { toast('You need at least 2 terms to play Match', 'warning'); navigate(`set/${deck.id}`); return; }
  let tiles = [], selected = null, matched = 0, startAt = 0, timerIv = null, penalty = 0, running = false, finished = false, misses = 0, tracker = null, locked = false;
  const frame = studyFrame(main, { deck, modeName: 'Match', icon: 'grid', color: '#3b82f6', onSettings: openOptions, onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  ctx.inProgress = () => running;
  const best = () => db.getKV(`best_match_${deck.id}`, null);
  const timeEl = h('span', { class: 'match-timer' }, '0.0');
  async function begin() {
    clearInterval(timerIv); finished = false; running = false; matched = 0; penalty = 0; misses = 0; selected = null; locked = false;
    pairs = loadPairs(deck, { starredOnly: opt().starredOnly });
    const n = Math.min(Math.floor((opt().gridSize || 12) / 2), pairs.length); const chosen = sample(pairs, n);
    tiles = shuffle(chosen.flatMap(p => [{ pair: p, side: 'term', id: p.cardId + 't' }, { pair: p, side: 'definition', id: p.cardId + 'd' }]));
    tracker = sessionTracker(deck, 'match');
    frame.body.innerHTML = ''; frame.setProgress(0);
    const b = best(); frame.setStats(h('span', { class: 'row', style: { gap: '6px' } }, svgIcon('clock', 16), timeEl, h('span', { class: 'muted small' }, 's')), b != null ? h('span', { class: 'pill-stat' }, svgIcon('trophy', 13), `Best ${b.toFixed(1)}s`) : null);
    const grid = h('div', { class: `match-grid n${tiles.length}` });
    tiles.forEach((t, i) => { const el = h('button', { class: `match-tile ${t.side}`, 'data-i': i, onClick: () => pick(i, el) }, h('span', { class: 'tile-key' }, keyFor(i)), sideImage(t.pair, t.side) ? h('img', { src: sideImage(t.pair, t.side), class: 'tile-img' }) : null, h('div', { class: 'tile-text', html: sideHtml(t.pair, t.side) })); t.el = el; grid.append(el); });
    frame.body.append(h('div', { class: 'match-wrap' }, h('p', { class: 'muted center small' }, 'Click a term, then its matching definition. Keys 1–9 and A–G also select tiles.'), grid));
    await countdown(frame.body, { from: 3, label: 'Match!' });
    startAt = Date.now(); running = true; timerIv = setInterval(() => { timeEl.textContent = ((Date.now() - startAt) / 1000 + penalty).toFixed(1); }, 100);
  }
  const KEYS = '123456789ABCDEFG'; const keyFor = (i) => KEYS[i] || '';
  function pick(i, el) {
    if (!running || locked || el.classList.contains('done')) return; sfx.click();
    if (selected === null) { selected = i; el.classList.add('selected'); return; }
    if (selected === i) { selected = null; el.classList.remove('selected'); return; }
    const a = tiles[selected], b = tiles[i]; const aEl = a.el;
    if (a.pair === b.pair && a.side !== b.side) {
      matched++; sfx.match(); aEl.classList.remove('selected'); aEl.classList.add('done', 'pop'); el.classList.add('done', 'pop'); recordMastery(a.pair, true, { mode: 'match' }); tracker.answer(true, centerOf(el)); selected = null; frame.setProgress(matched / (tiles.length / 2));
      if (matched === tiles.length / 2) finish();
    } else {
      misses++; penalty += opt().penalty || 0; sfx.mismatch(); locked = true; aEl.classList.add('wrong'); el.classList.add('wrong'); shake(aEl); shake(el); recordMastery(a.pair, false, { mode: 'match' }); tracker.answer(false);
      if (opt().penalty) { const r = el.getBoundingClientRect(); const pen = h('div', { class: 'float-text bad', style: { left: r.left + r.width / 2 + 'px', top: r.top + 'px' } }, `+${opt().penalty}s`); document.body.append(pen); setTimeout(() => pen.remove(), 1200); }
      setTimeout(() => { aEl.classList.remove('wrong', 'selected'); el.classList.remove('wrong'); selected = null; locked = false; }, 450);
    }
  }
  const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function finish() {
    running = false; finished = true; clearInterval(timerIv); const time = (Date.now() - startAt) / 1000 + penalty; const prev = best(); const isBest = prev == null || time < prev; if (isBest) db.setKV(`best_match_${deck.id}`, time);
    const s = tracker.finish({ score: Math.round(time * 10) / 10, meta: { misses, tiles: tiles.length } }); if (isBest) tracker.bonus(20);
    sfx.complete(); confetti({ count: isBest ? 260 : 150 });
    setTimeout(() => resultsScreen(frame, { title: isBest ? 'New personal best!' : 'Matched!', subtitle: `${tiles.length / 2} pairs in ${time.toFixed(1)} seconds${misses ? ` with ${misses} miss${misses === 1 ? '' : 'es'}` : ' with no misses'}.${prev != null && !isBest ? ` Best: ${prev.toFixed(1)}s.` : ''}`, scoreLabel: `${time.toFixed(1)}s`, score: Math.max(0, 100 - misses * 10), celebrate: false, time: s.end - s.start, xp: s.xp + (isBest ? 20 : 0), extra: [statChip('misses', misses, misses ? 'bad' : 'ok'), statChip('penalty', `${penalty}s`)], actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Bigger grid', icon: 'grid', onClick: () => { updateSettings({ match: { gridSize: Math.min(16, (opt().gridSize || 12) + 4) } }); begin(); } }, { label: 'Try Gravity', icon: 'rocket', onClick: () => navigate(`study/gravity/${deck.id}`) }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] }), 500);
  }
  function openOptions() { optionsModal('Match options', 'match', [{ type: 'segment', key: 'gridSize', label: 'Tiles', options: [{ value: 6, label: '6' }, { value: 8, label: '8' }, { value: 12, label: '12' }, { value: 16, label: '16' }] }, { type: 'segment', key: 'penalty', label: 'Miss penalty', options: [{ value: 0, label: 'None' }, { value: 1, label: '+1s' }, { value: 2, label: '+2s' }] }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }], { onChange: () => begin() }); }
  const unkey = keyHandler({ ...Object.fromEntries(KEYS.split('').map((k, i) => [`*${k.toLowerCase()}`, () => { const t = tiles[i]; if (t) pick(i, t.el); }])), '*r': begin });
  begin();
  return () => { unkey(); clearInterval(timerIv); if (running && tracker) tracker.finish(); };
}
