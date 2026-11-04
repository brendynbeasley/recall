// Unscramble: rebuild the term from scrambled pieces while reading its definition.
// Learning: effortful retrieval with partial cues; hints and mistakes mean the card is not counted as known.
import { h, svgIcon, shuffle } from '../utils.js';
import { toast, shake, burst } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, recordMastery, resultsScreen, sessionTracker, loadPairs, missedList } from '../modes/common.js';
import { navigate } from '../app.js';

const ROUNDS = 10;
export async function start(ctx) {
  const { main, deck } = ctx;
  const all = loadPairs(deck).filter(p => String(p.term || '').trim().length >= 2);
  if (all.length < 2) { toast('You need at least 2 terms to play Unscramble', 'warning'); navigate(`set/${deck.id}`); return; }
  let queue = [], cur = null, built = [], tokens = [], hints = 0, mistakes = 0, score = 0, clean = 0, rounds = 0, missed = [], tracker = null, running = false, lock = false;
  const frame = studyFrame(main, { deck, modeName: 'Unscramble', icon: 'shuffle', color: '#06b6d4', onSettings: () => toast('Unscramble has no options yet', 'info'), onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('../modes/index.js'); requestExit(); });
  ctx.inProgress = () => running;

  function begin() { all.forEach(p => { delete p._retry; }); queue = shuffle(all).slice(0, Math.min(ROUNDS, all.length)); rounds = queue.length; score = 0; clean = 0; missed = []; tracker = sessionTracker(deck, 'unscramble'); running = true; next(); }
  function header() { frame.setStats(statChip('score', score, 'ok'), statChip('left', queue.length + 1)); }
  function next() {
    lock = false;
    if (!queue.length) return finish();
    cur = queue.shift(); built = []; hints = 0; mistakes = 0;
    const term = String(cur.term).trim(); const words = term.split(/\s+/);
    const byWord = words.length >= 3 || term.replace(/\s/g, '').length > 22;
    const target = byWord ? words : [...term.replace(/\s/g, '')];
    tokens = shuffle(target.map((t, i) => ({ t, i, used: false })));
    if (tokens.length > 1 && tokens.every((x, k) => x.t.toLowerCase() === target[k].toLowerCase())) tokens.reverse();
    cur._target = target; cur._byWord = byWord; cur._words = words;
    header(); frame.setProgress((rounds - queue.length - 1) / rounds); draw();
  }
  function slotsView() {
    const wrap = h('div', { class: 'us-slots' });
    if (cur._byWord) cur._target.forEach((w, k) => wrap.append(h('span', { class: `us-slot word ${built[k] ? 'filled' : ''}` }, built[k] ? built[k].t : ' ')));
    else { let k = 0; cur._words.forEach(w => { const g = h('span', { class: 'us-word' }); for (let c = 0; c < w.length; c++) { g.append(h('span', { class: `us-slot ${built[k] ? 'filled' : ''}` }, built[k] ? built[k].t : '')); k++; } wrap.append(g); }); }
    return wrap;
  }
  function draw() {
    frame.body.innerHTML = '';
    frame.body.append(h('div', { class: 'lg-stage' },
      h('div', { class: 'lg-prompt' }, h('div', { class: 'q-label' }, 'Definition'), renderSide(cur, 'definition', { big: true })),
      slotsView(),
      h('div', { class: 'us-pieces' }, ...tokens.map(tok => h('button', { class: `us-piece ${cur._byWord ? 'word' : ''}`, disabled: tok.used, onClick: () => pick(tok) }, tok.t))),
      h('div', { class: 'lg-actions' },
        h('button', { class: 'btn', disabled: !built.length, onClick: undo }, svgIcon('undo', 16), 'Undo'),
        h('button', { class: 'btn', onClick: hint }, svgIcon('sparkles', 16), 'Hint'),
        h('button', { class: 'btn btn-ghost', onClick: giveUp }, 'Show answer'))));
  }
  function pick(tok) { if (lock || tok.used) return; tok.used = true; built.push(tok); if (built.length === cur._target.length) check(); else draw(); }
  function goodPrefix() { let k = 0; while (k < built.length && built[k].t.toLowerCase() === cur._target[k].toLowerCase()) k++; return k; }
  function check() {
    const k = goodPrefix();
    if (k === cur._target.length) {
      lock = true; const isClean = hints === 0 && mistakes === 0; score += Math.max(10, 100 - hints * 20 - mistakes * 15);
      if (isClean) clean++; else if (!missed.includes(cur)) missed.push(cur);
      recordMastery(cur, isClean, { mode: 'unscramble' }); tracker.answer(isClean); sfx.correct();
      draw(); const s = frame.body.querySelector('.us-slots'); s.classList.add('ok'); burst(s); header(); setTimeout(next, 900);
    } else {
      lock = true; mistakes++; sfx.wrong(); draw(); const s = frame.body.querySelector('.us-slots'); s.classList.add('bad'); shake(s);
      setTimeout(() => { built.slice(k).forEach(t => { t.used = false; }); built = built.slice(0, k); lock = false; draw(); }, 650);
    }
  }
  function hint() {
    if (lock) return; const k = goodPrefix(); built.slice(k).forEach(t => { t.used = false; }); built = built.slice(0, k);
    const need = cur._target[built.length]; const tok = tokens.find(t => !t.used && t.t.toLowerCase() === need.toLowerCase()); if (!tok) return;
    hints++; tok.used = true; built.push(tok); if (built.length === cur._target.length) check(); else draw();
  }
  function undo() { if (lock) return; const t = built.pop(); if (t) t.used = false; draw(); }
  function giveUp() {
    if (lock) return; lock = true; if (!missed.includes(cur)) missed.push(cur); recordMastery(cur, false, { mode: 'unscramble' }); tracker.answer(false); sfx.wrong();
    if (!cur._retry) { cur._retry = true; queue.push(cur); rounds++; }
    built = cur._target.map((t, i) => ({ t, i, used: true })); draw(); frame.body.querySelector('.us-slots').classList.add('reveal'); setTimeout(next, 2000);
  }
  function finish() {
    running = false; frame.setProgress(1); const s = tracker.finish({ score }); const n = new Set(all.filter(p => p._target)).size || rounds; if (clean) sfx.complete();
    const total = Math.max(1, clean + missed.length);
    resultsScreen(frame, { title: missed.length ? 'Round complete' : 'Perfect round!', subtitle: missed.length ? `${clean} solved cleanly, ${missed.length} worth another look.` : 'Every term rebuilt with no hints.', scoreLabel: String(score), score: Math.round(clean / total * 100), correct: clean, wrong: missed.length, time: s.end - s.start, xp: s.xp, extra: [missedList(missed)].filter(Boolean), actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
    void n;
  }
  const onKey = e => { if (!running || !cur || lock || e.ctrlKey || e.metaKey || /input|textarea/i.test(e.target.tagName)) return; if (e.key === 'Backspace') { e.preventDefault(); undo(); return; } if (!cur._byWord && e.key.length === 1) { const tok = tokens.find(t => !t.used && t.t.toLowerCase() === e.key.toLowerCase()); if (tok) pick(tok); } };
  document.addEventListener('keydown', onKey);
  begin();
  return () => { document.removeEventListener('keydown', onKey); if (running && tracker) tracker.finish({ score }); };
}
