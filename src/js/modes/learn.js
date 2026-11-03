// Learn: adaptive rounds mixing multiple choice, written and true/false until every term is mastered.
import { db } from '../db.js';
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, gradeAnswer, escapeHtml, plural, sleep } from '../utils.js';
import { toast, progressBar, confetti, burst, shake } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, sideText, sideHtml, otherSide, pickAnswerSide, mcOptions, recordMastery, setMasteryLevel, resultsScreen, sessionTracker, optionsModal, starBtn, keyHandler, loadPairs, feedback, kbdHint, pickPraise, speakSide, missedList } from './common.js';
import { navigate } from '../app.js';

// Per-term level: 0 unseen, 1 answered MC, 2 answered written (mastered). Question type depends on level & enabled types.
export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().learn;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!pairs.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  const levels = new Map(); // cardId -> level
  const saved = deck.learnProgress && deck.learnProgress.levels ? deck.learnProgress.levels : null;
  for (const p of pairs) { const l = saved && saved[p.cardId] != null ? saved[p.cardId] : (p.card && p.card.mastery && p.card.mastery.level >= 3 ? 2 : 0); levels.set(p.cardId, l); }
  const MAX = () => (opt().questionTypes.includes('written') && opt().questionTypes.includes('mc')) ? 2 : 1;
  let round = [], roundIdx = 0, roundNo = (deck.learnProgress && deck.learnProgress.round) || 1, roundResults = [], finished = false, missedEver = new Set(), answering = false;
  const tracker = sessionTracker(deck, 'learn'); ctx.inProgress = () => !finished;
  const frame = studyFrame(main, { deck, modeName: 'Learn', icon: 'brain', color: '#8b5cf6', onSettings: openOptions, onRestart: () => resetAll() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  const masteredCount = () => pairs.filter(p => levels.get(p.cardId) >= MAX()).length;
  const familiarCount = () => pairs.filter(p => { const l = levels.get(p.cardId); return l > 0 && l < MAX(); }).length;
  const persist = () => { const o = {}; for (const [k, v] of levels) o[k] = v; deck.learnProgress = { levels: o, round: roundNo, updated: Date.now() }; db.decks.put(deck); };
  const updateHeader = () => { frame.setProgress(masteredCount() / pairs.length); frame.setStats(h('div', { class: 'learn-counts' }, h('span', { class: 'lc' }, h('i', { style: { background: 'var(--ok)' } }), `${masteredCount()} mastered`), h('span', { class: 'lc' }, h('i', { style: { background: 'var(--warn)' } }), `${familiarCount()} familiar`), h('span', { class: 'lc' }, h('i', { style: { background: 'var(--border-strong)' } }), `${pairs.length - masteredCount() - familiarCount()} not studied`), h('span', { class: 'muted small' }, `Round ${roundNo}`))); };

  function buildRound() {
    const remaining = pairs.filter(p => levels.get(p.cardId) < MAX());
    if (!remaining.length) return [];
    const byLevel = opt().shuffle ? shuffle(remaining) : remaining.slice();
    // prioritise terms with lowest level, keep a mix
    byLevel.sort((a, b) => levels.get(a.cardId) - levels.get(b.cardId));
    const size = Math.max(3, Math.min(opt().roundSize || 7, byLevel.length));
    const chosen = opt().shuffle ? shuffle(byLevel.slice(0, Math.min(byLevel.length, size + 2))).slice(0, size) : byLevel.slice(0, size);
    return chosen.map(p => ({ pair: p, type: questionType(p), answerSide: pickAnswerSide(opt().answerWith) }));
  }
  function questionType(p) {
    const t = opt().questionTypes; const l = levels.get(p.cardId);
    if (opt().fastMode && t.includes('written')) return 'written';
    if (l === 0) { if (t.includes('mc')) return 'mc'; if (t.includes('tf')) return 'tf'; return 'written'; }
    if (t.includes('written')) return 'written'; if (t.includes('mc')) return 'mc'; return 'tf';
  }
  function nextRound() { round = buildRound(); roundIdx = 0; roundResults = []; if (!round.length) { complete(); return; } updateHeader(); showQuestion(); }
  function showQuestion() {
    answering = false; const q = round[roundIdx]; if (!q) { checkpoint(); return; }
    const { pair, answerSide } = q; const promptSide = otherSide(answerSide);
    frame.body.innerHTML = '';
    const wrap = h('div', { class: 'learn-q slide-up' });
    const head = h('div', { class: 'q-head' }, h('span', { class: 'q-kind' }, q.type === 'mc' ? 'Choose the matching ' + answerSide : q.type === 'written' ? 'Type the ' + answerSide : 'True or false?'), h('span', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'icon-btn', 'data-tip': 'Play audio', onClick: () => speakSide(pair, promptSide, deck) }, svgIcon('volume', 16)), starBtn(pair)));
    const promptEl = h('div', { class: 'q-prompt' }, h('div', { class: 'q-label' }, promptSide === 'term' ? 'Term' : 'Definition'), renderSide(pair, promptSide, { big: true }));
    wrap.append(head, promptEl);
    if (q.type === 'mc') {
      const opts = mcOptions(pair, pairs, Math.min(opt().mcOptions || 4, pairs.length), answerSide);
      const grid = h('div', { class: `mc-grid ${opts.length > 4 ? 'six' : ''}` });
      opts.forEach((o, i) => grid.append(h('button', { class: 'mc-option', 'data-i': i, onClick: (e) => answerMc(o, e.currentTarget, grid) }, h('span', { class: 'mc-num' }, i + 1), renderSide(o, answerSide))));
      wrap.append(grid, h('div', { class: 'q-foot' }, h('button', { class: 'btn btn-ghost', onClick: () => answerMc(null, null, grid) }, "Don't know", kbdHint(`Ctrl+Enter`))));
      q._opts = opts;
    } else if (q.type === 'tf') {
      const other = Math.random() < 0.5 ? pair : (mcOptions(pair, pairs, 2, answerSide).find(o => o !== pair) || pair); q._shown = other;
      wrap.append(h('div', { class: 'tf-shown' }, h('div', { class: 'q-label' }, answerSide === 'term' ? 'Term' : 'Definition'), renderSide(other, answerSide, { big: true })));
      wrap.append(h('div', { class: 'tf-buttons' }, h('button', { class: 'btn btn-xl tf-btn bad', onClick: () => answerTf(false) }, svgIcon('x', 22), 'False', kbdHint('1')), h('button', { class: 'btn btn-xl tf-btn ok', onClick: () => answerTf(true) }, svgIcon('check', 22), 'True', kbdHint('2'))));
    } else {
      const input = h('input', { class: 'input input-lg answer-input', placeholder: `Type the ${answerSide}…`, autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.ctrlKey || e.metaKey) answerWritten(null); else answerWritten(input.value); } });
      wrap.append(h('div', { class: 'written-wrap' }, input, h('div', { class: 'row between' }, h('button', { class: 'btn btn-ghost', onClick: () => answerWritten(null) }, "Don't know", kbdHint('Ctrl+Enter')), h('button', { class: 'btn btn-primary', onClick: () => answerWritten(input.value) }, 'Answer', kbdHint('Enter')))));
      setTimeout(() => input.focus(), 40);
    }
    frame.body.append(wrap);
    if (opt().tts) speakSide(pair, promptSide, deck);
  }
  function answerMc(choice, btn, grid) {
    if (answering) return; answering = true; const q = round[roundIdx]; const correct = choice === q.pair;
    grid.querySelectorAll('.mc-option').forEach((b, i) => { const o = q._opts[i]; b.disabled = true; if (o === q.pair) b.classList.add('correct'); else if (b === btn) b.classList.add('wrong'); else b.classList.add('dim'); });
    resolve(correct, { typed: choice ? sideText(choice, q.answerSide) : null, el: btn });
  }
  function answerTf(saidTrue) { if (answering) return; answering = true; const q = round[roundIdx]; const truth = q._shown === q.pair; const correct = saidTrue === truth; const btns = frame.body.querySelectorAll('.tf-btn'); btns.forEach(b => { b.disabled = true; }); btns[truth ? 1 : 0].classList.add('correct'); if (!correct) btns[saidTrue ? 1 : 0].classList.add('wrong'); resolve(correct, { el: btns[saidTrue ? 1 : 0], message: correct ? null : `False. The ${q.answerSide} is shown below.` }); }
  function answerWritten(value) {
    if (answering) return; answering = true; const q = round[roundIdx]; const expected = sideText(q.pair, q.answerSide);
    if (value === null || !value.trim()) { resolve(false, { typed: null, written: true }); return; }
    const g = gradeAnswer(value, expected, { typoTolerance: opt().typoTolerance, caseSensitive: opt().caseSensitive });
    const inp = frame.body.querySelector('.answer-input'); if (inp) { inp.classList.add(g.correct ? 'ok' : 'bad'); inp.disabled = true; }
    resolve(g.correct, { typed: value, close: g.close, written: true, el: inp });
  }
  function resolve(correct, { typed, close, written, el, message } = {}) {
    const q = round[roundIdx]; const p = q.pair; const l = levels.get(p.cardId);
    const apply = (ok) => { if (ok) levels.set(p.cardId, Math.min(MAX(), l + 1)); else { levels.set(p.cardId, 0); missedEver.add(p.cardId); } recordMastery(p, ok, { mode: 'learn' }); if (levels.get(p.cardId) >= MAX()) setMasteryLevel(p, 3); else if (levels.get(p.cardId) > 0) setMasteryLevel(p, Math.max(p.card?.mastery?.level || 0, 1)); roundResults.push({ pair: p, correct: ok }); tracker.answer(ok, el ? centerOf(el) : null); persist(); updateHeader(); };
    apply(correct);
    if (correct) { sfx.correct(); if (el) burst(el); if (opt().instantFeedback !== false && !written) { roundIdx++; setTimeout(showQuestion, 750); return; } }
    else { sfx.wrong(); if (el) shake(el); }
    const cont = () => { roundIdx++; showQuestion(); };
    const fb = feedback(correct, { expected: sideHtml(p, q.answerSide), typed: typed || undefined, close, message, pair: p, side: q.answerSide, deck, onContinue: cont, retype: !correct && written && opt().retypeWrong && typed !== null, override: !correct && written && typed ? () => { roundResults.pop(); tracker.sess.wrong--; tracker.sess.correct++; missedEver.delete(p.cardId); levels.set(p.cardId, Math.min(MAX(), l + 1)); recordMastery(p, true, { mode: 'learn' }); recordMastery(p, true, { mode: 'learn', weight: 0 }); persist(); updateHeader(); toast('Marked as correct', 'success', { duration: 1200 }); cont(); } : null });
    frame.body.querySelector('.learn-q').append(fb);
    if (correct && written) { setTimeout(() => { if (frame.body.contains(fb)) cont(); }, 1400); }
  }
  const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function checkpoint() {
    roundNo++; persist(); const ok = roundResults.filter(r => r.correct).length; const total = roundResults.length;
    frame.body.innerHTML = '';
    const remaining = pairs.length - masteredCount();
    if (!remaining) { complete(); return; }
    sfx.close();
    const el = h('div', { class: 'checkpoint pop-in' }, h('div', { class: 'checkpoint-head' }, h('h1', {}, ok === total ? 'Perfect round!' : `Round ${roundNo - 1} complete`), h('p', { class: 'muted' }, `${ok} of ${total} correct · ${remaining} term${remaining === 1 ? '' : 's'} left to master`)),
      h('div', { class: 'checkpoint-bar' }, h('div', { class: 'stacked-bar', style: { height: '14px' } }, h('div', { style: { width: `${masteredCount() / pairs.length * 100}%`, background: 'var(--ok)' } }), h('div', { style: { width: `${familiarCount() / pairs.length * 100}%`, background: 'var(--warn)' } })), h('div', { class: 'row between small muted', style: { marginTop: '6px' } }, h('span', {}, `${masteredCount()} mastered`), h('span', {}, `${familiarCount()} familiar`), h('span', {}, `${pairs.length - masteredCount() - familiarCount()} not studied`))),
      h('div', { class: 'checkpoint-list' }, ...roundResults.map(r => h('div', { class: `cp-row ${r.correct ? 'ok' : 'bad'}` }, svgIcon(r.correct ? 'check' : 'x', 16), h('div', { class: 'grow' }, h('div', { class: 'bold', html: sideHtml(r.pair, 'term') }), h('div', { class: 'small muted', html: sideHtml(r.pair, 'definition') })), h('span', { class: `lvl-pill l${levels.get(r.pair.cardId)}` }, levels.get(r.pair.cardId) >= MAX() ? 'Mastered' : levels.get(r.pair.cardId) > 0 ? 'Familiar' : 'Learning')))),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px' } }, h('button', { class: 'btn btn-primary btn-xl', autofocus: true, onClick: nextRound }, 'Continue', kbdHint('Enter')), h('button', { class: 'btn btn-lg', onClick: () => frame.exit() }, 'Finish for now')));
    frame.body.append(el); setTimeout(() => el.querySelector('.btn-primary').focus(), 60);
  }
  function complete() {
    finished = true; deck.learnProgress = null; db.decks.put(deck); const s = tracker.finish({ meta: { completed: true } });
    const missed = pairs.filter(p => missedEver.has(p.cardId));
    const res = resultsScreen(frame, { title: 'You\'ve mastered every term!', subtitle: `${pairs.length} terms learned in ${roundNo - 1} round${roundNo - 1 === 1 ? '' : 's'}.`, correct: s.correct, wrong: s.wrong, time: s.end - s.start, xp: s.xp, actions: [
      { label: 'Practice with Test', icon: 'edit', primary: true, onClick: () => navigate(`study/test/${deck.id}`) }, { label: 'Start over', icon: 'rotate', onClick: () => resetAll() }, { label: 'Play Match', icon: 'grid', onClick: () => navigate(`study/match/${deck.id}`) }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }] });
    const ml = missedList(missed); if (ml) res.append(ml);
  }
  function resetAll() { for (const p of pairs) levels.set(p.cardId, 0); roundNo = 1; missedEver.clear(); finished = false; persist(); nextRound(); }
  function openOptions() {
    optionsModal('Learn options', 'learn', [
      { type: 'multi', key: 'questionTypes', label: 'Question types', options: [{ value: 'mc', label: 'Multiple choice' }, { value: 'written', label: 'Written' }, { value: 'tf', label: 'True / False' }], desc: 'Terms progress from multiple choice to written before they count as mastered.' },
      { type: 'segment', key: 'answerWith', label: 'Answer with', options: [{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }] },
      { type: 'toggle', key: 'shuffle', label: 'Shuffle terms' }, { type: 'toggle', key: 'starredOnly', label: 'Study starred terms only' },
      { type: 'number', key: 'roundSize', label: 'Terms per round', min: 3, max: 30 }, { type: 'number', key: 'mcOptions', label: 'Multiple choice options', min: 2, max: 6 },
      { type: 'toggle', key: 'typoTolerance', label: 'Accept small typos' }, { type: 'toggle', key: 'caseSensitive', label: 'Case sensitive' }, { type: 'toggle', key: 'retypeWrong', label: 'Retype wrong answers' },
      { type: 'toggle', key: 'instantFeedback', label: 'Auto-continue after correct answers' }, { type: 'toggle', key: 'fastMode', label: 'Fast mode', desc: 'Skip multiple choice and go straight to written answers.' }, { type: 'toggle', key: 'tts', label: 'Read prompts aloud' },
    ], { onChange: (k) => { if (k === 'starredOnly') { pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); for (const p of pairs) if (!levels.has(p.cardId)) levels.set(p.cardId, 0); } if (!finished) nextRound(); } });
  }
  const unkey = keyHandler({
    '*1': () => clickMc(0) || clickTf(0), '*2': () => clickMc(1) || clickTf(1), '*3': () => clickMc(2), '*4': () => clickMc(3), '*5': () => clickMc(4), '*6': () => clickMc(5),
    'enter': () => { const c = frame.body.querySelector('.feedback .btn-primary, .checkpoint .btn-primary'); if (c) { c.click(); return true; } return false; }, '* ': () => { const c = frame.body.querySelector('.feedback .btn-primary'); if (c) { c.click(); return true; } return false; },
    'mod+enter': () => { const dk = [...frame.body.querySelectorAll('.btn-ghost')].find(b => b.textContent.includes("Don't know")); if (dk) dk.click(); const rt = frame.body.querySelector('.retype'); if (rt) { const c = frame.body.querySelector('.feedback'); roundIdx++; showQuestion(); } },
    '*o': () => { const b = [...frame.body.querySelectorAll('.feedback .btn-ghost')].find(x => x.textContent.includes('I was correct')); b && b.click(); }, '*r': () => resetAll(), '*s': () => frame.body.querySelector('.q-head .icon-btn:last-child')?.click(),
  });
  const clickMc = (i) => { const b = frame.body.querySelector(`.mc-option[data-i="${i}"]`); if (b && !b.disabled) { b.click(); return true; } return false; };
  const clickTf = (i) => { const b = frame.body.querySelectorAll('.tf-btn')[i]; if (b && !b.disabled) { b.click(); return true; } return false; };
  nextRound();
  return () => { unkey(); if (!finished) { persist(); tracker.finish(); } };
}
