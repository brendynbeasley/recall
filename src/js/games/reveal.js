// Reveal: name the term from its definition, uncovering letters only when you need them.
// Learning: free recall first, then fading cues. Fewer reveals = more points, and only near-unaided recall counts as known.
import { h, svgIcon, shuffle, gradeAnswer } from '../utils.js';
import { toast, shake, burst } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, recordMastery, resultsScreen, sessionTracker, loadPairs, missedList } from '../modes/common.js';
import { navigate } from '../app.js';

const ROUNDS = 10;
const isLetter = c => /[\p{L}\p{N}]/u.test(c);
export async function start(ctx) {
  const { main, deck } = ctx;
  const all = loadPairs(deck).filter(p => String(p.term || '').trim().length >= 2);
  if (all.length < 2) { toast('You need at least 2 terms to play Reveal', 'warning'); navigate(`set/${deck.id}`); return; }
  let queue = [], cur = null, shown = new Set(), wrongs = 0, score = 0, clean = 0, rounds = 0, missed = [], tracker = null, running = false, lock = false;
  let maskEl, worthEl, input;
  const frame = studyFrame(main, { deck, modeName: 'Reveal', icon: 'eye', color: '#8b5cf6', onSettings: () => toast('Reveal has no options yet', 'info'), onRestart: () => begin() });
  frame.onExit(async () => { const { requestExit } = await import('../modes/index.js'); requestExit(); });
  ctx.inProgress = () => running;

  const term = () => String(cur.term).trim();
  const letterIdx = () => [...term()].map((c, i) => isLetter(c) ? i : -1).filter(i => i >= 0);
  const worth = () => Math.max(10, 100 - shown.size * 12 - wrongs * 10);
  function begin() { all.forEach(p => { delete p._retry; }); queue = shuffle(all).slice(0, Math.min(ROUNDS, all.length)); rounds = queue.length; score = 0; clean = 0; missed = []; tracker = sessionTracker(deck, 'reveal'); running = true; next(); }
  function header() { frame.setStats(statChip('score', score, 'ok'), statChip('left', queue.length + 1)); }
  function next() {
    lock = false; if (!queue.length) return finish();
    cur = queue.shift(); shown = new Set(); wrongs = 0; header(); frame.setProgress((rounds - queue.length - 1) / rounds);
    frame.body.innerHTML = '';
    maskEl = h('div', { class: 'rv-mask' }); worthEl = h('div', { class: 'rv-worth' });
    input = h('input', { class: 'input input-lg rv-input', placeholder: 'Type the term…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', onKeydown: e => { if (e.key === 'Enter') { e.preventDefault(); guess(); } } });
    frame.body.append(h('div', { class: 'lg-stage' },
      h('div', { class: 'lg-prompt' }, h('div', { class: 'q-label' }, 'Definition'), renderSide(cur, 'definition', { big: true })),
      maskEl, worthEl,
      h('div', { class: 'rv-row' }, input, h('button', { class: 'btn btn-primary btn-lg', onClick: guess }, 'Guess')),
      h('div', { class: 'lg-actions' }, h('button', { class: 'btn', onClick: revealOne }, svgIcon('eye', 16), 'Reveal a letter'), h('button', { class: 'btn btn-ghost', onClick: giveUp }, 'Show answer'))));
    update(); setTimeout(() => input.focus(), 50);
  }
  function update(all = false) {
    maskEl.innerHTML = '';
    term().split(/(\s+)/).forEach(part => {
      if (/^\s+$/.test(part)) { maskEl.append(h('span', { class: 'rv-gap' })); return; }
      const w = h('span', { class: 'rv-word' }); maskEl.append(w);
      const offset = maskEl._o || 0; void offset;
      for (const ch of part) w.append(h('span', { class: 'rv-ch' }, ch));
    });
    // mark hidden letters by global index
    const chars = [...term()]; let k = 0;
    maskEl.querySelectorAll('.rv-ch').forEach(el => { while (/\s/.test(chars[k])) k++; const hide = !all && isLetter(chars[k]) && !shown.has(k); if (hide) { el.textContent = ''; el.classList.add('hidden-ch'); } else if (shown.has(k)) el.classList.add('given'); k++; });
    worthEl.textContent = `Worth ${worth()} points`;
  }
  function revealOne() {
    if (lock) return; const hidden = letterIdx().filter(i => !shown.has(i)); if (!hidden.length) return;
    const first = hidden.includes(letterIdx()[0]) ? letterIdx()[0] : hidden[Math.floor(Math.random() * hidden.length)];
    shown.add(first); sfx.tick?.();
    if (hidden.length <= 1) { giveUp(); return; }
    update(); input.focus();
  }
  function guess() {
    if (lock) return; const v = input.value.trim(); if (!v) { input.focus(); return; }
    const g = gradeAnswer(v, term());
    if (g.correct) {
      lock = true; const isClean = shown.size <= 1 && wrongs === 0; score += worth(); if (isClean) clean++; else if (!missed.includes(cur)) missed.push(cur);
      recordMastery(cur, isClean, { mode: 'reveal' }); tracker.answer(isClean); sfx.correct(); update(true); maskEl.classList.add('ok'); burst(maskEl); header(); setTimeout(next, 1000);
    } else { wrongs++; sfx.wrong(); shake(input); input.select(); update(); }
  }
  function giveUp() {
    if (lock) return; lock = true; if (!missed.includes(cur)) missed.push(cur); recordMastery(cur, false, { mode: 'reveal' }); tracker.answer(false); sfx.wrong();
    if (!cur._retry) { cur._retry = true; queue.push(cur); rounds++; }
    update(true); maskEl.classList.add('reveal'); setTimeout(next, 2000);
  }
  function finish() {
    running = false; frame.setProgress(1); const s = tracker.finish({ score }); if (clean) sfx.complete(); const total = Math.max(1, clean + missed.length);
    resultsScreen(frame, { title: missed.length ? 'Round complete' : 'Total recall!', subtitle: missed.length ? `${clean} recalled almost unaided, ${missed.length} needed help.` : 'Every term recalled with at most one letter.', scoreLabel: String(score), score: Math.round(clean / total * 100), correct: clean, wrong: missed.length, time: s.end - s.start, xp: s.xp, extra: [missedList(missed)].filter(Boolean), actions: [{ label: 'Play again', icon: 'refresh', primary: true, onClick: begin }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
  }
  begin();
  return () => { if (running && tracker) tracker.finish({ score }); };
}
