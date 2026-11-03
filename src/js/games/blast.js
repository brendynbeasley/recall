// Blast: rapid-fire true/false against the clock with streak multipliers.
import { db } from '../db.js';
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle } from '../utils.js';
import { toast, countdown, confetti, shake, burst } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, distractors, otherSide, pickAnswerSide, recordMastery, resultsScreen, sessionTracker, optionsModal, keyHandler, loadPairs, kbdHint } from '../modes/common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().blast;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (pairs.length < 2) { toast('You need at least 2 terms to play Blast', 'warning'); navigate(`set/${deck.id}`); return; }
  let running = false, score = 0, streak = 0, bestStreak = 0, correct = 0, wrong = 0, endAt = 0, timerIv = null, q = null, tracker = null, pool = [];
  const frame = studyFrame(main, { deck, modeName: 'Blast', icon: 'zap', color: '#f97316', onSettings: openOptions, onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  ctx.inProgress = () => running;
  const best = () => db.getKV(`best_blast_${deck.id}`, 0);
  const timeEl = h('span', { class: 'blast-timer' }, '60');
  const mult = () => streak >= 15 ? 4 : streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
  async function begin() {
    clearInterval(timerIv); running = false; score = 0; streak = 0; bestStreak = 0; correct = 0; wrong = 0; pool = shuffle(pairs); tracker = sessionTracker(deck, 'blast'); pairs = loadPairs(deck, { starredOnly: opt().starredOnly });
    frame.body.innerHTML = ''; frame.setProgress(1); header();
    frame.body.append(h('div', { class: 'blast-stage' }));
    await countdown(frame.body, { from: 3, label: 'Blast!' });
    running = true; endAt = Date.now() + (opt().duration || 60) * 1000;
    timerIv = setInterval(() => { const left = Math.max(0, endAt - Date.now()); timeEl.textContent = Math.ceil(left / 1000); frame.setProgress(left / ((opt().duration || 60) * 1000)); if (left <= 5000 && left > 0 && Math.ceil(left / 1000) !== timeEl._last) { sfx.tick(); timeEl._last = Math.ceil(left / 1000); } if (left <= 0) finish(); }, 100);
    nextQ();
  }
  function header() { frame.setStats(h('span', { class: 'row', style: { gap: '6px' } }, svgIcon('clock', 16), timeEl, h('span', { class: 'muted small' }, 's')), statChip('score', score, 'ok'), streak >= 3 ? h('span', { class: 'pill-stat streak-pill' }, svgIcon('flame', 13), `${streak} · ×${mult()}`) : null, h('span', { class: 'pill-stat' }, svgIcon('trophy', 13), `Best ${best()}`)); }
  function nextQ() {
    if (!pool.length) pool = shuffle(pairs); const p = pool.pop(); const answerSide = pickAnswerSide(opt().answerWith); const promptSide = otherSide(answerSide);
    const truth = Math.random() < 0.5; const shown = truth ? p : (distractors(p, pairs, 1, answerSide)[0] || p); q = { pair: p, shown, truth: shown === p, answerSide };
    const stage = frame.body.querySelector('.blast-stage'); stage.innerHTML = '';
    const el = h('div', { class: 'blast-q pop-in' }, h('div', { class: 'blast-side' }, h('div', { class: 'q-label' }, promptSide === 'term' ? 'Term' : 'Definition'), renderSide(p, promptSide, { big: true })), h('div', { class: 'blast-eq' }, '='), h('div', { class: 'blast-side' }, h('div', { class: 'q-label' }, answerSide === 'term' ? 'Term' : 'Definition'), renderSide(shown, answerSide, { big: true })));
    stage.append(el, h('div', { class: 'tf-buttons big' }, h('button', { class: 'btn btn-xl tf-btn bad', onClick: () => answer(false) }, svgIcon('x', 24), 'False', kbdHint('← / 1')), h('button', { class: 'btn btn-xl tf-btn ok', onClick: () => answer(true) }, svgIcon('check', 24), 'True', kbdHint('→ / 2'))));
  }
  function answer(v) {
    if (!running || !q) return; const ok = v === q.truth; const btns = frame.body.querySelectorAll('.tf-btn'); const b = btns[v ? 1 : 0];
    if (ok) { streak++; bestStreak = Math.max(bestStreak, streak); correct++; const pts = 10 * mult(); score += pts; sfx.correct(); burst(b); if (streak % 5 === 0) { endAt += 2000; toast(`+2s streak bonus!`, 'success', { duration: 900 }); } recordMastery(q.pair, true, { mode: 'blast' }); tracker.answer(true); }
    else { streak = 0; wrong++; sfx.wrong(); shake(b); endAt -= 1500; frame.body.querySelector('.blast-stage').append(h('div', { class: 'blast-correction fade-in' }, h('b', {}, q.pair.term), ' = ', q.pair.definition)); recordMastery(q.pair, false, { mode: 'blast' }); tracker.answer(false); }
    header(); q = null; setTimeout(nextQ, ok ? 120 : 650);
  }
  function finish() {
    running = false; clearInterval(timerIv); const prev = best(); const isBest = score > prev; if (isBest) db.setKV(`best_blast_${deck.id}`, score); const s = tracker.finish({ score, meta: { bestStreak } }); if (isBest && score > 0) tracker.bonus(20); if (score > 0) sfx.complete(); if (isBest && score > 0) confetti({ count: 200 });
    resultsScreen(frame, { title: isBest && score > 0 ? 'New high score!' : 'Time\'s up!', subtitle: `${correct} right, ${wrong} wrong · best streak ${bestStreak}.${!isBest ? ` Best: ${prev}.` : ''}`, scoreLabel: String(score), score: correct + wrong ? Math.round(correct / (correct + wrong) * 100) : 0, celebrate: false, correct, wrong, time: s.end - s.start, xp: s.xp + (isBest && score > 0 ? 20 : 0), extra: [statChip('best streak', bestStreak)], actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Try Match', icon: 'grid', onClick: () => navigate(`study/match/${deck.id}`) }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
  }
  function openOptions() { optionsModal('Blast options', 'blast', [{ type: 'segment', key: 'duration', label: 'Duration', options: [{ value: 30, label: '30s' }, { value: 60, label: '60s' }, { value: 90, label: '90s' }, { value: 120, label: '2 min' }] }, { type: 'segment', key: 'answerWith', label: 'Answer with', options: [{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }] }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }], { onChange: () => begin() }); }
  const unkey = keyHandler({ '*arrowleft': () => answer(false), '*arrowright': () => answer(true), '*1': () => answer(false), '*2': () => answer(true), '*f': () => answer(false), '*t': () => answer(true), '*r': begin });
  begin();
  return () => { unkey(); clearInterval(timerIv); if (running && tracker) tracker.finish({ score }); };
}
