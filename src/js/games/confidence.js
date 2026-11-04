// Confidence: pick the answer, then bet on how sure you are. Confident mistakes are flagged as the ones most worth relearning.
// Learning: metacognition (knowing what you know) and the hypercorrection effect: high-confidence errors, once corrected, stick best.
import { h, svgIcon, sample } from '../utils.js';
import { toast, shake, burst } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, mcOptions, recordMastery, resultsScreen, sessionTracker, loadPairs, missedList } from '../modes/common.js';
import { navigate } from '../app.js';

const ROUNDS = 12;
const BETS = [{ v: 1, label: 'Guessing' }, { v: 2, label: 'Fairly sure' }, { v: 3, label: 'Certain' }];
export async function start(ctx) {
  const { main, deck } = ctx;
  const all = loadPairs(deck);
  if (all.length < 3) { toast('You need at least 3 terms to play Confidence', 'warning'); navigate(`set/${deck.id}`); return; }
  let queue = [], cur = null, opts = [], chosen = null, score = 0, idx = 0, stats = {}, wrongs = [], surprises = [], tracker = null, running = false, lock = false;
  const frame = studyFrame(main, { deck, modeName: 'Confidence', icon: 'target', color: '#10b981', onSettings: () => toast('Confidence has no options yet', 'info'), onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('../modes/index.js'); requestExit(); });
  ctx.inProgress = () => running;

  function begin() { queue = sample(all, Math.min(ROUNDS, all.length)); idx = 0; score = 0; stats = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }; wrongs = []; surprises = []; tracker = sessionTracker(deck, 'confidence'); running = true; next(); }
  function header() { frame.setStats(statChip('score', score, score >= 0 ? 'ok' : 'bad'), statChip('question', `${Math.min(idx + 1, queue.length)}/${queue.length}`)); frame.setProgress(idx / queue.length); }
  function next() {
    lock = false; chosen = null; if (idx >= queue.length) return finish();
    cur = queue[idx]; opts = mcOptions(cur, all, Math.min(4, all.length), 'term'); header(); draw();
  }
  function draw(result) {
    frame.body.innerHTML = '';
    const optBtns = opts.map((o, i) => { let cls = 'cf-opt'; if (chosen === o) cls += ' chosen'; if (result) { if (o === cur) cls += ' right'; else if (o === chosen) cls += ' wrong'; } return h('button', { class: cls, disabled: !!result, onClick: () => { chosen = o; draw(); } }, h('span', { class: 'cf-key' }, i + 1), h('span', { class: 'cf-text' }, o.term)); });
    const bets = h('div', { class: `cf-bets ${chosen && !result ? '' : 'idle'}` }, h('div', { class: 'q-label' }, chosen ? 'How sure are you?' : 'Pick an answer, then bet'), h('div', { class: 'cf-bet-row' }, ...BETS.map(b => h('button', { class: `cf-bet b${b.v}`, disabled: !chosen || !!result, onClick: () => bet(b.v) }, h('b', {}, `${'●'.repeat(b.v)}${'○'.repeat(3 - b.v)}`), b.label, h('span', { class: 'small muted' }, `±${b.v * 10}`)))));
    frame.body.append(h('div', { class: 'lg-stage' }, h('div', { class: 'lg-prompt' }, h('div', { class: 'q-label' }, 'Definition'), renderSide(cur, 'definition', { big: true })), h('div', { class: 'cf-opts' }, ...optBtns), result || bets));
  }
  function bet(v) {
    if (lock || !chosen) return; lock = true; const ok = chosen === cur; stats[v][0]++; if (ok) stats[v][1]++;
    score += ok ? v * 10 : -v * 10;
    recordMastery(cur, ok && v >= 2, { mode: 'confidence' }); tracker.answer(ok);
    if (!ok) { wrongs.push(cur); if (v === 3) surprises.push(cur); }
    const msg = ok ? (v === 1 ? 'Right, but you were guessing. Worth a review.' : v === 3 ? 'Right and certain. You know this one.' : 'Right.') : (v === 3 ? 'Confident but wrong. Read the answer carefully: these are the ones that stick once fixed.' : v === 2 ? 'Not quite. Good that you weren’t certain.' : 'Wrong, but you knew you were guessing.');
    const result = h('div', { class: `cf-result ${ok ? 'ok' : 'bad'} fade-in` }, h('div', { class: 'bold' }, ok ? `+${v * 10}` : `−${v * 10}`), h('div', {}, msg), h('button', { class: 'btn btn-primary', onClick: () => { idx++; next(); } }, idx + 1 >= queue.length ? 'See results' : 'Next', svgIcon('arrowRight', 16)));
    draw(result); header(); ok ? sfx.correct() : sfx.wrong(); const el = frame.body.querySelector('.cf-result'); ok ? burst(el) : shake(el);
    setTimeout(() => frame.body.querySelector('.cf-result .btn')?.focus(), 100);
  }
  function finish() {
    running = false; frame.setProgress(1); const s = tracker.finish({ score: Math.max(0, score) }); sfx.complete();
    const right = Object.values(stats).reduce((a, x) => a + x[1], 0), total = Object.values(stats).reduce((a, x) => a + x[0], 0);
    const calib = h('div', { class: 'cf-calib' }, h('h3', {}, 'How well you know what you know'), ...BETS.map(b => { const [n, r] = stats[b.v]; const pct = n ? Math.round(r / n * 100) : null; return h('div', { class: 'cf-calib-row' }, h('span', {}, b.label), h('div', { class: 'cf-calib-bar' }, h('div', { style: { width: (pct || 0) + '%' } })), h('b', {}, n ? `${r}/${n} · ${pct}%` : '–')); }), surprises.length ? h('p', { class: 'small muted' }, `${surprises.length} confident mistake${surprises.length > 1 ? 's' : ''} below. Relearn these first.`) : null);
    resultsScreen(frame, { title: score > 0 ? 'Well calibrated' : 'Round complete', subtitle: `${right} of ${total} right. Score ${score}.`, scoreLabel: String(score), score: total ? Math.round(right / total * 100) : 0, correct: right, wrong: total - right, time: s.end - s.start, xp: s.xp, extra: [calib, missedList([...new Set([...surprises, ...wrongs])])].filter(Boolean), actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
  }
  const onKey = e => { if (!running || /input|textarea/i.test(e.target.tagName)) return; const n = parseInt(e.key, 10); if (!n) return; if (lock) return; if (chosen && n <= 3) { bet(n); return; } if (!chosen && n <= opts.length) { chosen = opts[n - 1]; draw(); } };
  document.addEventListener('keydown', onKey);
  begin();
  return () => { document.removeEventListener('keydown', onKey); if (running && tracker) tracker.finish({ score: Math.max(0, score) }); };
}
