// Memory (concentration): flip cards to find term/definition pairs.
import { db } from '../db.js';
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, sample } from '../utils.js';
import { toast, countdown, confetti } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, sideHtml, sideImage, recordMastery, resultsScreen, sessionTracker, optionsModal, keyHandler, loadPairs, fmtTimer } from '../modes/common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().memory;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (pairs.length < 2) { toast('You need at least 2 terms to play Memory', 'warning'); navigate(`set/${deck.id}`); return; }
  let cards = [], first = null, lock = false, moves = 0, matched = 0, startAt = 0, timerIv = null, running = false, tracker = null, timeLeft = 0;
  const frame = studyFrame(main, { deck, modeName: 'Memory', icon: 'puzzle', color: '#a855f7', onSettings: openOptions, onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  ctx.inProgress = () => running;
  const best = () => db.getKV(`best_memory_${deck.id}`, null);
  const timeEl = h('span', { class: 'bold' }, '0:00');
  async function begin() {
    clearInterval(timerIv); running = false; first = null; lock = false; moves = 0; matched = 0; pairs = loadPairs(deck, { starredOnly: opt().starredOnly });
    const n = Math.min(opt().pairs || 8, pairs.length); const chosen = sample(pairs, n);
    cards = shuffle(chosen.flatMap(p => [{ pair: p, side: 'term' }, { pair: p, side: 'definition' }])); tracker = sessionTracker(deck, 'memory');
    frame.body.innerHTML = ''; frame.setProgress(0); const b = best();
    frame.setStats(h('span', { class: 'row', style: { gap: '6px' } }, svgIcon('clock', 16), timeEl), statChip('moves', 0, ''), b ? h('span', { class: 'pill-stat' }, svgIcon('trophy', 13), `Best ${b.moves} moves · ${fmtTimer(b.time * 1000)}`) : null);
    const total = n * 2, wide = innerWidth > innerHeight; const cols = wide ? (total <= 12 ? 4 : total <= 16 ? 4 : total <= 20 ? 5 : 6) : (total <= 12 ? 3 : 4);
    const grid = h('div', { class: 'memory-grid', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } });
    cards.forEach((c, i) => { const el = h('button', { class: `memory-card ${c.side}`, onClick: () => flip(c) }, h('div', { class: 'mem-inner' }, h('div', { class: 'mem-back' }, svgIcon('brain', 26)), h('div', { class: 'mem-front' }, sideImage(c.pair, c.side) ? h('img', { src: sideImage(c.pair, c.side) }) : null, h('div', { class: 'mem-text', html: sideHtml(c.pair, c.side) })))); c.el = el; grid.append(el); });
    frame.body.append(h('div', { class: 'memory-wrap' }, h('p', { class: 'muted center small' }, 'Flip two cards. Match each term with its definition.'), grid));
    await countdown(frame.body, { from: 3, label: 'Go!' });
    // brief peek
    cards.forEach(c => c.el.classList.add('flipped')); await new Promise(r => setTimeout(r, Math.min(4000, 800 + n * 250))); cards.forEach(c => c.el.classList.remove('flipped'));
    startAt = Date.now(); running = true; timeLeft = (opt().timeLimit || 0) * 1000;
    timerIv = setInterval(() => { const el = Date.now() - startAt; if (timeLeft) { const left = Math.max(0, timeLeft - el); timeEl.textContent = fmtTimer(left); if (left <= 0) finish(false); } else timeEl.textContent = fmtTimer(el); }, 250);
  }
  function flip(c) {
    if (!running || lock || c.done || c === first) return; sfx.flip(); c.el.classList.add('flipped');
    if (!first) { first = c; return; }
    moves++; updateMoves(); lock = true;
    if (first.pair === c.pair && first.side !== c.side) { const a = first; setTimeout(() => { a.el.classList.add('done'); c.el.classList.add('done'); a.done = c.done = true; matched++; sfx.match(); recordMastery(c.pair, true, { mode: 'memory' }); tracker.answer(true); frame.setProgress(matched / (cards.length / 2)); first = null; lock = false; if (matched === cards.length / 2) finish(true); }, 350); }
    else { const a = first; sfx.mismatch(); a.el.classList.add('nope'); c.el.classList.add('nope'); recordMastery(c.pair, false, { mode: 'memory' }); tracker.answer(false); setTimeout(() => { a.el.classList.remove('flipped', 'nope'); c.el.classList.remove('flipped', 'nope'); first = null; lock = false; }, 900); }
  }
  function updateMoves() { const chip = frame.root.querySelector('.study-stats .stat-chip'); if (chip) chip.firstChild.textContent = moves; }
  function finish(won) {
    running = false; clearInterval(timerIv); const time = Math.round((Date.now() - startAt) / 1000); const prev = best(); const isBest = won && (prev == null || moves < prev.moves || (moves === prev.moves && time < prev.time)); if (isBest) db.setKV(`best_memory_${deck.id}`, { moves, time });
    const s = tracker.finish({ score: time, meta: { moves, won } }); if (isBest) tracker.bonus(15); if (won) { sfx.complete(); confetti({ count: 180 }); }
    const perfect = cards.length / 2; setTimeout(() => resultsScreen(frame, { title: won ? (isBest ? 'New best!' : 'All pairs found!') : 'Time\'s up', subtitle: won ? `${perfect} pairs in ${moves} moves (${perfect} is perfect) and ${fmtTimer(time * 1000)}.` : `You found ${matched} of ${perfect} pairs.`, scoreLabel: won ? `${moves}` : `${matched}/${perfect}`, score: Math.round(Math.max(0, Math.min(100, perfect / Math.max(perfect, moves) * 100))), celebrate: false, time: s.end - s.start, xp: s.xp + (isBest ? 15 : 0), extra: [statChip('moves', moves)], actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'More pairs', icon: 'grid', onClick: () => { updateSettings({ memory: { pairs: Math.min(12, (opt().pairs || 8) + 2) } }); begin(); } }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] }), 500);
  }
  function openOptions() { optionsModal('Memory options', 'memory', [{ type: 'segment', key: 'pairs', label: 'Pairs', options: [{ value: 6, label: '6' }, { value: 8, label: '8' }, { value: 10, label: '10' }, { value: 12, label: '12' }] }, { type: 'segment', key: 'timeLimit', label: 'Time limit', options: [{ value: 0, label: 'None' }, { value: 60, label: '1 min' }, { value: 120, label: '2 min' }, { value: 180, label: '3 min' }] }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }], { onChange: () => begin() }); }
  const unkey = keyHandler({ '*r': begin });
  begin();
  return () => { unkey(); clearInterval(timerIv); if (running && tracker) tracker.finish(); };
}
