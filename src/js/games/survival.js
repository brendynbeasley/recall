// Survival: type answers from memory with 3 lives. Every miss comes back a few questions later until you get it right.
// Learning: pure recall (no options to recognise) plus in-session spacing of mistakes.
import { h, svgIcon, shuffle, gradeAnswer } from '../utils.js';
import { toast, shake, burst } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, recordMastery, resultsScreen, sessionTracker, loadPairs, missedList, diffMarkup } from '../modes/common.js';
import { navigate } from '../app.js';

const LIVES = 3, GAP = 3;
export async function start(ctx) {
  const { main, deck } = ctx;
  const all = loadPairs(deck).filter(p => String(p.term || '').trim());
  if (all.length < 2) { toast('You need at least 2 terms to play Survival', 'warning'); navigate(`set/${deck.id}`); return; }
  let pool = [], retries = [], lives = LIVES, score = 0, streak = 0, bestStreak = 0, qn = 0, right = 0, wrongN = 0, missed = [], cur = null, tracker = null, running = false, lock = false, input;
  const frame = studyFrame(main, { deck, modeName: 'Survival', icon: 'heart', color: '#ef4444', onSettings: () => toast('Survival has no options yet', 'info'), onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('../modes/index.js'); requestExit(); });
  ctx.inProgress = () => running;

  function begin() { pool = shuffle(all); retries = []; lives = LIVES; score = 0; streak = 0; bestStreak = 0; qn = 0; right = 0; wrongN = 0; missed = []; tracker = sessionTracker(deck, 'survival'); running = true; next(); }
  const hearts = () => h('span', { class: 'sv-hearts' }, ...Array.from({ length: LIVES }, (_, i) => h('span', { class: `sv-heart ${i < lives ? 'on' : ''}` }, svgIcon('heart', 16))));
  function header() { frame.setStats(hearts(), statChip('score', score, 'ok'), streak >= 3 ? h('span', { class: 'pill-stat streak-pill' }, svgIcon('flame', 13), `${streak}`) : null); frame.setProgress((all.length - pool.length - retries.length) / all.length); }
  function pickNext() {
    qn++; const due = retries.findIndex(r => r.at <= qn); if (due >= 0) return retries.splice(due, 1)[0].pair;
    if (pool.length) return pool.pop(); if (retries.length) { retries.sort((a, b) => a.at - b.at); return retries.shift().pair; } return null;
  }
  function next() {
    lock = false; cur = pickNext(); if (!cur) return finish(true); header();
    frame.body.innerHTML = '';
    input = h('input', { class: 'input input-lg rv-input', placeholder: 'Type the term from memory…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', onKeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    frame.body.append(h('div', { class: 'lg-stage' },
      h('div', { class: 'lg-prompt' }, h('div', { class: 'q-label' }, 'Definition'), renderSide(cur, 'definition', { big: true })),
      h('div', { class: 'rv-row' }, input, h('button', { class: 'btn btn-primary btn-lg', onClick: submit }, 'Submit')),
      h('div', { class: 'lg-actions' }, h('button', { class: 'btn btn-ghost', onClick: () => miss('') }, "I don't know"))));
    setTimeout(() => input.focus(), 50);
  }
  function submit() { if (lock) return; const v = input.value.trim(); if (!v) { input.focus(); return; } const g = gradeAnswer(v, cur.term); if (g.correct) hit(); else miss(v); }
  function hit() {
    lock = true; streak++; bestStreak = Math.max(bestStreak, streak); right++; score += 10 * (1 + Math.floor(streak / 5));
    recordMastery(cur, true, { mode: 'survival' }); tracker.answer(true); sfx.correct(); burst(input); input.classList.add('ok'); header(); setTimeout(next, 450);
  }
  function miss(typed) {
    lock = true; streak = 0; lives--; wrongN++; if (!missed.includes(cur)) missed.push(cur); retries.push({ pair: cur, at: qn + GAP });
    recordMastery(cur, false, { mode: 'survival' }); tracker.answer(false); sfx.wrong(); shake(input); header();
    const stage = frame.body.querySelector('.lg-stage');
    const cont = h('button', { class: 'btn btn-primary btn-lg', onClick: () => { document.removeEventListener('keydown', onEnter); lives <= 0 ? finish(false) : next(); } }, lives <= 0 ? 'See results' : 'Continue');
    const onEnter = e => { if (e.key === 'Enter') { e.preventDefault(); cont.click(); } };
    stage.querySelector('.lg-actions').replaceWith(h('div', { class: 'sv-correction fade-in' }, h('div', { class: 'q-label' }, 'Answer'), h('div', { class: 'sv-answer' }, cur.term), typed ? h('div', { class: 'small muted' }, 'You typed: ', diffMarkup(typed, cur.term)) : null, h('div', { class: 'small muted' }, lives > 0 ? `It will come back in ${GAP} questions.` : 'Out of lives.'), cont));
    input.disabled = true; setTimeout(() => { document.addEventListener('keydown', onEnter); cont.focus(); }, 300);
  }
  function finish(won) {
    running = false; frame.setProgress(won ? 1 : frame._p || 0); const s = tracker.finish({ score }); if (won) sfx.complete();
    resultsScreen(frame, { title: won ? 'You survived!' : 'Out of lives', subtitle: won ? `Cleared all ${all.length} terms. Best streak ${bestStreak}.` : `${right} right before the end. Best streak ${bestStreak}.`, scoreLabel: String(score), score: right + wrongN ? Math.round(right / (right + wrongN) * 100) : 0, celebrate: won, correct: right, wrong: wrongN, time: s.end - s.start, xp: s.xp, extra: [statChip('best streak', bestStreak), missedList(missed)].filter(Boolean), actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
  }
  begin();
  return () => { if (running && tracker) tracker.finish({ score }); };
}
