// Write: type every answer; missed terms come back in later rounds until all are correct.
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, gradeAnswer, escapeHtml } from '../utils.js';
import { toast, burst, shake } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, sideText, sideHtml, otherSide, pickAnswerSide, recordMastery, setMasteryLevel, resultsScreen, sessionTracker, optionsModal, starBtn, keyHandler, loadPairs, feedback, kbdHint, speakSide, missedList } from './common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().write;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!pairs.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  let queue = [], idx = 0, round = 1, correctSet = new Set(), wrongThisRound = [], everWrong = new Set(), finished = false, answering = false;
  const tracker = sessionTracker(deck, 'write'); ctx.inProgress = () => !finished && correctSet.size > 0;
  const frame = studyFrame(main, { deck, modeName: 'Write', icon: 'type', color: '#f59e0b', onSettings: openOptions, onRestart: () => restart() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  const header = () => { frame.setProgress(correctSet.size / pairs.length); frame.setStats(h('div', { class: 'write-counts' }, statChip('remaining', queue.length - idx, ''), statChip('incorrect', wrongThisRound.length, wrongThisRound.length ? 'bad' : ''), statChip('correct', correctSet.size, 'ok'), h('span', { class: 'small muted' }, `Round ${round}`))); };
  function startRound(list) { queue = opt().shuffle ? shuffle(list) : list.slice(); idx = 0; wrongThisRound = []; header(); show(); }
  function show() {
    answering = false; if (idx >= queue.length) { endRound(); return; }
    const p = queue[idx]; const answerSide = pickAnswerSide(opt().answerWith); p._side = answerSide; const promptSide = otherSide(answerSide);
    frame.body.innerHTML = '';
    const input = h('input', { class: 'input input-lg answer-input', placeholder: `Type the ${answerSide}…`, autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.ctrlKey || e.metaKey) answer(null); else answer(input.value); } });
    const wrap = h('div', { class: 'learn-q slide-up' }, h('div', { class: 'q-head' }, h('span', { class: 'q-kind' }, `Type the ${answerSide}`), h('span', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'icon-btn', 'data-tip': 'Play audio', onClick: () => speakSide(p, promptSide, deck) }, svgIcon('volume', 16)), starBtn(p))),
      h('div', { class: 'q-prompt' }, h('div', { class: 'q-label' }, promptSide === 'term' ? 'Term' : 'Definition'), renderSide(p, promptSide, { big: true })),
      h('div', { class: 'written-wrap' }, input, h('div', { class: 'row between' }, h('button', { class: 'btn btn-ghost', onClick: () => answer(null) }, "Don't know", kbdHint('Ctrl+Enter')), h('button', { class: 'btn btn-primary', onClick: () => answer(input.value) }, 'Answer', kbdHint('Enter')))));
    frame.body.append(wrap); setTimeout(() => input.focus(), 40);
  }
  function answer(value) {
    if (answering) return; answering = true; const p = queue[idx]; const expected = sideText(p, p._side);
    const g = value == null || !value.trim() ? { correct: false, close: false } : gradeAnswer(value, expected, { typoTolerance: opt().typoTolerance });
    const inp = frame.body.querySelector('.answer-input'); inp.disabled = true; inp.classList.add(g.correct ? 'ok' : 'bad');
    const apply = (ok) => { if (ok) { correctSet.add(p.cardId); setMasteryLevel(p, Math.max(p.card?.mastery?.level || 0, round === 1 ? 3 : 2)); } else { wrongThisRound.push(p); everWrong.add(p.cardId); } recordMastery(p, ok, { mode: 'write' }); tracker.answer(ok, { x: window.innerWidth / 2, y: window.innerHeight / 2 }); header(); };
    apply(g.correct);
    if (g.correct) { sfx.correct(); burst(inp); }
    else { sfx.wrong(); shake(inp); }
    const cont = () => { idx++; show(); };
    const fb = feedback(g.correct, { expected: sideHtml(p, p._side), typed: value || undefined, close: g.close, pair: p, side: p._side, deck, onContinue: cont, retype: !g.correct && opt().retypeWrong && value != null && value.trim() !== '', override: !g.correct && value ? () => { wrongThisRound = wrongThisRound.filter(x => x !== p); everWrong.delete(p.cardId); correctSet.add(p.cardId); tracker.sess.wrong--; tracker.sess.correct++; recordMastery(p, true, { mode: 'write' }); setMasteryLevel(p, 3); header(); toast('Marked as correct', 'success', { duration: 1200 }); cont(); } : null });
    frame.body.querySelector('.learn-q').append(fb);
    if (g.correct) setTimeout(() => { if (frame.body.contains(fb)) cont(); }, 1100);
  }
  function endRound() {
    if (!wrongThisRound.length) { finish(); return; }
    round++; const missed = wrongThisRound.slice(); frame.body.innerHTML = ''; sfx.close();
    frame.body.append(h('div', { class: 'checkpoint pop-in' }, h('div', { class: 'checkpoint-head' }, h('h1', {}, `Round ${round - 1} complete`), h('p', { class: 'muted' }, `${correctSet.size} of ${pairs.length} correct so far · ${missed.length} to retry`)), missedList(missed), h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn btn-primary btn-xl', autofocus: true, onClick: () => startRound(missed) }, `Retry ${missed.length} term${missed.length === 1 ? '' : 's'}`, kbdHint('Enter')))));
    setTimeout(() => frame.body.querySelector('.btn-primary')?.focus(), 60);
  }
  function finish() {
    finished = true; const s = tracker.finish({ meta: { rounds: round } }); const missed = pairs.filter(p => everWrong.has(p.cardId));
    const res = resultsScreen(frame, { title: everWrong.size ? 'All terms written correctly' : 'Flawless!', subtitle: `${pairs.length} terms in ${round} round${round === 1 ? '' : 's'}.`, correct: s.correct, wrong: s.wrong, time: s.end - s.start, xp: s.xp, actions: [{ label: 'Write again', icon: 'rotate', primary: true, onClick: () => restart() }, { label: 'Try Spell', icon: 'volume', onClick: () => navigate(`study/spell/${deck.id}`) }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
    const ml = missedList(missed); if (ml) res.append(ml);
  }
  function restart() { pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); round = 1; correctSet = new Set(); everWrong = new Set(); finished = false; startRound(pairs); }
  function openOptions() { optionsModal('Write options', 'write', [{ type: 'segment', key: 'answerWith', label: 'Answer with', options: [{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }] }, { type: 'toggle', key: 'shuffle', label: 'Shuffle terms' }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }, { type: 'toggle', key: 'typoTolerance', label: 'Accept small typos' }, { type: 'toggle', key: 'retypeWrong', label: 'Retype wrong answers' }], { onChange: (k) => { if (k === 'starredOnly') restart(); } }); }
  const unkey = keyHandler({ 'enter': () => { const c = frame.body.querySelector('.feedback .btn-primary, .checkpoint .btn-primary'); if (c) { c.click(); return true; } return false; }, 'mod+enter': () => { const rt = frame.body.querySelector('.retype'); if (rt) { idx++; show(); return true; } const dk = [...frame.body.querySelectorAll('.btn-ghost')].find(b => b.textContent.includes("Don't know")); if (dk) dk.click(); }, '*o': () => { const b = [...frame.body.querySelectorAll('.feedback .btn-ghost')].find(x => x.textContent.includes('I was correct')); b && b.click(); }, '*r': restart });
  startRound(pairs);
  return () => { unkey(); if (!finished) tracker.finish(); };
}
