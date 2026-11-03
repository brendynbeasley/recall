// Test: configurable practice exam with written, matching, multiple choice and true/false sections.
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, gradeAnswer, escapeHtml, plural, pct } from '../utils.js';
import { toast, segmented, toggle, slider, settingRow, numberInput, burst, shake } from '../ui.js';
import { sfx } from '../audio.js';
import { studyFrame, statChip, renderSide, sideText, sideHtml, otherSide, pickAnswerSide, mcOptions, distractors, recordMastery, resultsScreen, sessionTracker, keyHandler, loadPairs, kbdHint, speakSide, missedList } from './common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().test;
  let all = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!all.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  let questions = [], submitted = false, tracker = null, startedAt = 0;
  const frame = studyFrame(main, { deck, modeName: 'Test', icon: 'edit', color: '#ec4899', onRestart: () => setup() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  ctx.inProgress = () => questions.length > 0 && !submitted;

  function setup() {
    questions = []; submitted = false; frame.setProgress(0); frame.setStats(); frame.body.innerHTML = '';
    all = loadPairs(deck, { starredOnly: opt().starredOnly }); const max = all.length; const o = opt(); let count = Math.min(o.count || 20, max);
    const countOut = h('b', {}, count);
    const panel = h('div', { class: 'test-setup pop-in' },
      h('div', { class: 'test-setup-head' }, h('div', { class: 'mode-icon big', style: { '--mode-color': '#ec4899' } }, svgIcon('edit', 28)), h('h1', {}, 'Set up your test'), h('p', { class: 'muted' }, `${max} terms available in ${deck.name}`)),
      settingRow('Questions', h('div', { class: 'row', style: { gap: '14px' } }, h('input', { type: 'range', class: 'range', min: 1, max, value: count, style: { width: '220px' }, onInput: e => { count = parseInt(e.target.value, 10); countOut.textContent = count; } }), countOut)),
      settingRow('Answer with', segmented([{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }], o.answerWith, v => updateSettings({ test: { answerWith: v } }))),
      settingRow('Question types', h('div', { class: 'row wrap' }, ...[['written', 'Written'], ['matching', 'Matching'], ['mc', 'Multiple choice'], ['tf', 'True / False']].map(([id, l]) => h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: o.types.includes(id), onChange: e => { const t = new Set(opt().types); e.target.checked ? t.add(id) : t.delete(id); if (!t.size) { t.add(id); e.target.checked = true; } updateSettings({ test: { types: [...t] } }); } }), l)))),
      toggle(o.instantFeedback, v => updateSettings({ test: { instantFeedback: v } }), { label: 'Instant feedback', description: 'Grade each question as you answer it instead of at the end.' }),
      toggle(o.typoTolerance, v => updateSettings({ test: { typoTolerance: v } }), { label: 'Accept small typos in written answers' }),
      toggle(o.starredOnly, v => { updateSettings({ test: { starredOnly: v } }); setup(); }, { label: 'Starred terms only' }),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px', gap: '10px' } }, h('button', { class: 'btn btn-primary btn-xl', autofocus: true, onClick: () => generate(count) }, svgIcon('play', 18), 'Start test', kbdHint('Enter')), h('button', { class: 'btn btn-lg', onClick: () => frame.exit() }, 'Cancel')));
    frame.body.append(panel);
  }
  function generate(count) {
    const o = opt(); const types = o.types.slice(); const pool = o.shuffle ? shuffle(all) : all.slice(); const chosen = pool.slice(0, count);
    const groups = {}; types.forEach(t => { groups[t] = []; });
    // Matching needs groups of 3-6; distribute round-robin
    chosen.forEach((p, i) => { groups[types[i % types.length]].push(p); });
    if (groups.matching && groups.matching.length < 2 && groups.matching.length) { (groups[types.find(t => t !== 'matching')] || groups.matching).push(...groups.matching); if (types.length > 1) groups.matching = []; }
    questions = []; let n = 0;
    const mk = (type, pair) => ({ id: ++n, type, pair, answerSide: pickAnswerSide(o.answerWith), answer: null, correct: null });
    for (const p of groups.written || []) questions.push(mk('written', p));
    if (groups.matching && groups.matching.length) { for (let i = 0; i < groups.matching.length; i += 6) { const block = groups.matching.slice(i, i + 6); if (block.length < 2) { block.forEach(p => questions.push(mk('mc', p))); continue; } const side = pickAnswerSide(o.answerWith); questions.push({ id: ++n, type: 'matching', pairs: block, answerSide: side, options: shuffle(block), answer: {}, correct: null }); } }
    for (const p of groups.mc || []) { const q = mk('mc', p); q.options = mcOptions(p, all, Math.min(4, all.length), q.answerSide); questions.push(q); }
    for (const p of groups.tf || []) { const q = mk('tf', p); q.shown = Math.random() < 0.5 ? p : (distractors(p, all, 1, q.answerSide)[0] || p); questions.push(q); }
    tracker = sessionTracker(deck, 'test'); startedAt = Date.now(); renderTest();
  }
  const total = () => questions.reduce((a, q) => a + (q.type === 'matching' ? q.pairs.length : 1), 0);
  const answered = () => questions.reduce((a, q) => a + (q.type === 'matching' ? Object.keys(q.answer).length : (q.answer !== null && q.answer !== '' ? 1 : 0)), 0);
  function updateProgress() { frame.setProgress(answered() / total()); frame.setStats(h('span', { class: 'bold' }, `${answered()} / ${total()} answered`)); }
  function renderTest() {
    frame.body.innerHTML = ''; const o = opt(); const wrap = h('div', { class: 'test-paper' }); let num = 0;
    for (const q of questions) {
      const sec = h('div', { class: 'test-q', 'data-id': q.id });
      if (q.type === 'matching') {
        sec.append(h('div', { class: 'tq-head' }, h('span', { class: 'tq-num' }, `${num + 1}–${num + q.pairs.length}`), h('span', { class: 'tq-kind' }, 'Matching questions')));
        const promptSide = otherSide(q.answerSide);
        const letters = q.options.map((_, i) => String.fromCharCode(65 + i));
        sec.append(h('div', { class: 'match-block' }, h('div', { class: 'match-prompts' }, ...q.pairs.map((p, i) => h('div', { class: 'match-prompt', 'data-pi': i }, h('select', { class: 'input select match-select', onChange: e => { q.answer[i] = e.target.value; updateProgress(); if (o.instantFeedback) instant(q, sec); } }, h('option', { value: '' }, '—'), ...letters.map(l => h('option', { value: l, selected: q.answer[i] === l }, l))), renderSide(p, promptSide)))), h('div', { class: 'match-options' }, ...q.options.map((p, i) => h('div', { class: 'match-opt' }, h('span', { class: 'match-letter' }, letters[i]), renderSide(p, q.answerSide))))));
        num += q.pairs.length;
      } else {
        num++; const promptSide = otherSide(q.answerSide);
        sec.append(h('div', { class: 'tq-head' }, h('span', { class: 'tq-num' }, num), h('span', { class: 'tq-kind' }, q.type === 'written' ? 'Written' : q.type === 'mc' ? 'Multiple choice' : 'True or false'), h('button', { class: 'icon-btn sm', 'data-tip': 'Play audio', onClick: () => speakSide(q.pair, promptSide, deck) }, svgIcon('volume', 14))));
        sec.append(h('div', { class: 'tq-prompt' }, h('div', { class: 'q-label' }, promptSide === 'term' ? 'Term' : 'Definition'), renderSide(q.pair, promptSide, { big: true })));
        if (q.type === 'written') { const inp = h('input', { class: 'input input-lg', placeholder: `Type the ${q.answerSide}`, autocomplete: 'off', spellcheck: false, value: q.answer || '', onInput: e => { q.answer = e.target.value; updateProgress(); }, onKeydown: e => { if (e.key === 'Enter') { if (o.instantFeedback) instant(q, sec); const next = sec.nextElementSibling?.querySelector('input, select, button.mc-option, button.tf-btn'); next ? next.focus() : document.getElementById('test-submit')?.focus(); } }, onBlur: () => { if (o.instantFeedback && q.answer) instant(q, sec); } }); sec.append(inp); }
        else if (q.type === 'mc') { sec.append(h('div', { class: 'mc-grid' }, ...q.options.map((op, i) => h('button', { class: `mc-option ${q.answer === op ? 'selected' : ''}`, onClick: e => { q.answer = op; sec.querySelectorAll('.mc-option').forEach(b => b.classList.toggle('selected', b === e.currentTarget)); updateProgress(); if (o.instantFeedback) instant(q, sec); } }, h('span', { class: 'mc-num' }, i + 1), renderSide(op, q.answerSide))))); }
        else { sec.append(h('div', { class: 'tf-shown' }, h('div', { class: 'q-label' }, q.answerSide === 'term' ? 'Term' : 'Definition'), renderSide(q.shown, q.answerSide, { big: true })), h('div', { class: 'tf-buttons' }, ...[[false, 'False', 'x', 'bad'], [true, 'True', 'check', 'ok']].map(([v, l, ic, cls]) => h('button', { class: `btn btn-lg tf-btn ${cls} ${q.answer === v ? 'selected' : ''}`, onClick: e => { q.answer = v; sec.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('selected', b === e.currentTarget)); updateProgress(); if (o.instantFeedback) instant(q, sec); } }, svgIcon(ic, 18), l)))); }
      }
      wrap.append(sec);
    }
    wrap.append(h('div', { class: 'test-submit' }, h('button', { class: 'btn btn-primary btn-xl', id: 'test-submit', onClick: submit }, svgIcon('check', 18), 'Submit test')));
    frame.body.append(wrap); updateProgress(); setTimeout(() => wrap.querySelector('input, select, .mc-option')?.focus(), 60);
  }
  function gradeQ(q) {
    if (q.type === 'matching') { const letters = q.options.map((_, i) => String.fromCharCode(65 + i)); q.results = q.pairs.map((p, i) => { const picked = q.answer[i]; const idx = letters.indexOf(picked); const ok = idx >= 0 && q.options[idx] === p; return { pair: p, ok, picked }; }); q.correct = q.results.every(r => r.ok); return; }
    if (q.type === 'written') { const g = gradeAnswer(q.answer || '', sideText(q.pair, q.answerSide), { typoTolerance: opt().typoTolerance }); q.correct = g.correct; q.close = g.close; }
    else if (q.type === 'mc') q.correct = q.answer === q.pair;
    else q.correct = q.answer !== null && q.answer === (q.shown === q.pair);
  }
  function instant(q, sec) { if (q.graded) return; if (q.type === 'matching' && Object.keys(q.answer).length < q.pairs.length) return; if (q.type === 'written' && !(q.answer || '').trim()) return; if (q.answer === null) return; gradeQ(q); q.graded = true; markSection(q, sec); if (q.type !== 'matching') { recordMastery(q.pair, q.correct, { mode: 'test' }); tracker.answer(q.correct); q.correct ? sfx.correct() : sfx.wrong(); } else { q.results.forEach(r => { recordMastery(r.pair, r.ok, { mode: 'test' }); tracker.answer(r.ok); }); q.correct ? sfx.correct() : sfx.wrong(); } }
  function markSection(q, sec) {
    sec.classList.add('graded', q.correct ? 'ok' : 'bad');
    const badge = h('div', { class: `tq-result ${q.correct ? 'ok' : 'bad'}` }, svgIcon(q.correct ? 'check' : 'x', 16), q.correct ? (q.close ? 'Correct (typo accepted)' : 'Correct') : 'Incorrect');
    sec.querySelector('.tq-head').append(badge);
    if (q.type === 'written') { const inp = sec.querySelector('input'); inp.disabled = true; inp.classList.add(q.correct ? 'ok' : 'bad'); if (!q.correct) sec.append(h('div', { class: 'tq-answer' }, h('span', { class: 'label' }, 'Correct answer'), h('span', { html: sideHtml(q.pair, q.answerSide) }))); }
    else if (q.type === 'mc') { sec.querySelectorAll('.mc-option').forEach((b, i) => { b.disabled = true; const op = q.options[i]; if (op === q.pair) b.classList.add('correct'); else if (op === q.answer) b.classList.add('wrong'); }); }
    else if (q.type === 'tf') { const truth = q.shown === q.pair; sec.querySelectorAll('.tf-btn').forEach((b, i) => { b.disabled = true; if ((i === 1) === truth) b.classList.add('correct'); else if (q.answer === (i === 1)) b.classList.add('wrong'); }); if (!truth) sec.append(h('div', { class: 'tq-answer' }, h('span', { class: 'label' }, `Correct ${q.answerSide}`), h('span', { html: sideHtml(q.pair, q.answerSide) }))); }
    else { const letters = q.options.map((_, i) => String.fromCharCode(65 + i)); sec.querySelectorAll('.match-prompt').forEach((row, i) => { const r = q.results[i]; row.classList.add(r.ok ? 'ok' : 'bad'); row.querySelector('select').disabled = true; if (!r.ok) row.append(h('span', { class: 'match-fix' }, `→ ${letters[q.options.indexOf(r.pair)]}`)); }); }
  }
  function submit() {
    const unanswered = total() - answered();
    if (unanswered > 0 && !confirmSync(`You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`)) return;
    submitted = true; let correct = 0, wrong = 0; const missed = [];
    for (const q of questions) { const sec = frame.body.querySelector(`.test-q[data-id="${q.id}"]`); if (!q.graded) { gradeQ(q); q.graded = true; markSection(q, sec); if (q.type === 'matching') q.results.forEach(r => { recordMastery(r.pair, r.ok, { mode: 'test' }); tracker.answer(r.ok); }); else { recordMastery(q.pair, q.correct, { mode: 'test' }); tracker.answer(q.correct); } }
      if (q.type === 'matching') q.results.forEach(r => { r.ok ? correct++ : (wrong++, missed.push(r.pair)); }); else { q.correct ? correct++ : (wrong++, missed.push(q.pair)); } }
    const score = pct(correct, correct + wrong); const s = tracker.finish({ score, meta: { total: correct + wrong } });
    const paper = frame.body.firstChild; frame.body.querySelector('.test-submit')?.remove();
    const res = resultsScreen(frame, { title: score === 100 ? 'Perfect score!' : `You scored ${score}%`, correct, wrong, time: s.end - s.start, xp: s.xp + (score === 100 ? 25 : 0), actions: [
      missed.length ? { label: `Retake the ${missed.length} missed`, icon: 'refresh', primary: true, onClick: () => { all = [...new Set(missed)]; generate(all.length); } } : null,
      { label: 'New test', icon: 'rotate', primary: !missed.length, onClick: () => setup() }, { label: 'Learn missed terms', icon: 'brain', onClick: () => navigate(`study/learn/${deck.id}`) }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }].filter(Boolean), extra: [statChip('questions', correct + wrong)] });
    if (score === 100) tracker.bonus(25);
    res.append(h('h3', { style: { marginTop: '30px' } }, 'Your answers')); res.append(paper); paper.classList.add('reviewing');
    frame.body.scrollTop = 0;
  }
  const confirmSync = (msg) => window.confirm ? window.confirm(msg) : true;
  const unkey = keyHandler({ 'enter': () => { const b = frame.body.querySelector('.test-setup .btn-primary'); if (b) { b.click(); return true; } return false; } });
  setup();
  return () => { unkey(); if (tracker && !submitted) tracker.finish(); };
}
