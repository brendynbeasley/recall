// Spaced repetition review (Anki-style): queue, show answer, Again/Hard/Good/Easy, undo, bury/suspend/flag, type-in answers.
import { db } from '../db.js';
import { S, updateSettings, renderCard, toggleStar, deckPreset, touchDeck, deleteNotes } from '../models.js';
import { h, svgIcon, fmtDuration, gradeAnswer, escapeHtml, plural, stripHtml, modKey } from '../utils.js';
import { toast, showMenu, confirm, modal, burst, shake, numberInput, settingRow } from '../ui.js';
import { sfx, speak } from '../audio.js';
import { buildQueue, answerCard, previewIntervals, undoAnswer, canUndo, suspendCards, buryCards, setFlag, unburyAll, TYPE, QUEUE, RATING, dueCounts, fmtMin, today } from '../scheduler.js';
import { studyFrame, statChip, sessionTracker, keyHandler, kbdHint, diffMarkup, resultsScreen, deckLang } from './common.js';
import { navigate } from '../app.js';
import { FLAGS } from '../views/browser.js';
import { quickEditNote } from '../views/editor.js';
import { showDeckOptions } from '../views/deckoptions.js';

export async function start(ctx) {
  const { main, deck, deckId } = ctx; const opt = () => S().review;
  const isAll = deckId === 'all', isCustom = deckId === 'custom';
  const custom = isCustom ? db.getKV('customStudy', null) : null; if (isCustom && !custom) { navigate('home', { replace: true }); return; }
  let queue = null, card = null, shown = false, cardStart = 0, finished = false, ignoreLimits = false, timerIv = null, autoTimer = null, typed = null;
  const stats = { studied: 0, again: 0, time: 0 };
  const tracker = sessionTracker(deck, 'review'); ctx.inProgress = () => !finished && stats.studied > 0;
  const frame = studyFrame(main, { deck: deck || { name: isCustom ? custom.name : 'All sets' }, modeName: 'Review', icon: 'clock', color: '#10b981', onSettings: () => deck ? showDeckOptions(deck, { onSave: () => { rebuild(); next(); } }) : navigate('settings?tab=study') });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  const deckOf = (c) => db.decks.get(c.deckId);
  const presetOf = (c) => deckPreset(deckOf(c));

  function rebuild() {
    if (isCustom) { const cards = custom.cardIds.map(id => db.cards.get(id)).filter(c => c && c.queue !== QUEUE.SUSPENDED); queue = { learn: [], dueLearn: [], main: cards, counts: { new: cards.filter(c => c.type === TYPE.NEW).length, learn: cards.filter(c => c.type === TYPE.LEARN || c.type === TYPE.RELEARN).length, review: cards.filter(c => c.type === TYPE.REVIEW).length } }; return; }
    if (isAll) { const per = db.decks.filter(d => !d.archived).map(d => buildQueue(d.id, d, { ignoreLimits })); queue = { learn: per.flatMap(q => q.learn).sort((a, b) => a.due - b.due), dueLearn: per.flatMap(q => q.dueLearn), main: per.flatMap(q => q.main), counts: per.reduce((a, q) => ({ new: a.new + q.counts.new, learn: a.learn + q.counts.learn, review: a.review + q.counts.review }), { new: 0, learn: 0, review: 0 }) }; return; }
    queue = buildQueue(deck.id, deck, { ignoreLimits });
  }
  function pickNext() {
    const t = Date.now(); const dueLearn = queue.learn.filter(c => c.queue === QUEUE.LEARN && c.due <= t && c.id !== card?.id);
    if (dueLearn.length) return dueLearn.sort((a, b) => a.due - b.due)[0];
    const m = queue.main.find(c => c.id !== card?.id && db.cards.get(c.id) && db.cards.get(c.id).queue >= 0 && !(db.cards.get(c.id).queue === QUEUE.LEARN && db.cards.get(c.id).due > t + 1200000)); if (m) return db.cards.get(m.id);
    // learning cards not yet due: show the soonest if within 20 minutes, else wait
    const pending = queue.learn.filter(c => db.cards.get(c.id)?.queue === QUEUE.LEARN).map(c => db.cards.get(c.id)).sort((a, b) => a.due - b.due);
    if (pending.length) return pending[0];
    return null;
  }
  function counts() { const t = Date.now(); let nw = 0, lrn = 0, rev = 0; const seen = new Set();
    for (const c0 of [...queue.main, ...queue.learn]) { const c = db.cards.get(c0.id); if (!c || seen.has(c.id) || c.queue < 0) continue; seen.add(c.id); if (c.queue === QUEUE.NEW) nw++; else if (c.queue === QUEUE.LEARN) lrn++; else if (c.queue === QUEUE.REVIEW) rev++; }
    return { new: nw, learn: lrn, review: rev }; }
  function header() {
    const c = counts(); const total = c.new + c.learn + c.review; const done = stats.studied; frame.setProgress(done / Math.max(1, done + total));
    frame.setStats(opt().showRemaining ? h('div', { class: 'rev-counts' }, h('span', { class: `rc new ${card && card.queue === QUEUE.NEW ? 'cur' : ''}`, 'data-tip': 'New' }, c.new), h('span', { class: `rc learn ${card && card.queue === QUEUE.LEARN ? 'cur' : ''}`, 'data-tip': 'Learning' }, c.learn), h('span', { class: `rc review ${card && card.queue === QUEUE.REVIEW ? 'cur' : ''}`, 'data-tip': 'To review' }, c.review)) : h('span', { class: 'bold' }, `${done} studied`), h('button', { class: 'icon-btn', 'data-tip': 'Undo', 'data-kbd': `${modKey}+Z`, disabled: !canUndo(), onClick: undo }, svgIcon('undo', 16)));
  }
  function next() {
    clearTimeout(autoTimer); typed = null; card = pickNext(); shown = false;
    if (!card) { congrats(); return; }
    if (card.queue === QUEUE.LEARN && card.due > Date.now()) { waitScreen(card); return; }
    header(); cardStart = Date.now(); renderQ();
  }
  function renderQ() {
    frame.body.innerHTML = ''; const d = deckOf(card); const p = presetOf(card); const q = renderCard(card, 'q'); const note = db.notes.get(card.noteId);
    const area = h('div', { class: `rev-card ${opt().flipAnimation ? 'flip-in' : ''}`, style: { '--deck-color': d?.color || 'var(--accent)' } });
    area.append(h('div', { class: 'rev-card-top' }, h('span', { class: 'rev-deck' }, isAll || isCustom ? d?.name : (card.queue === QUEUE.NEW ? 'New card' : card.queue === QUEUE.LEARN ? 'Learning' : `Review · interval ${card.ivl}d`)), h('span', { class: 'row', style: { gap: '2px' } }, card.flag ? h('span', { class: 'flag-dot', style: { background: FLAGS[card.flag - 1][2] } }) : null, p.showTimer && opt().showTimer ? h('span', { class: 'timer-chip rev-timer' }, '0:00') : null, h('button', { class: `icon-btn ${note.starred ? 'starred' : ''}`, 'data-tip': 'Star', 'data-kbd': 'S', onClick: e => { const v = toggleStar(note); e.currentTarget.classList.toggle('starred', v); if (v) sfx.star(); } }, svgIcon('star', 16)), h('button', { class: 'icon-btn', 'data-tip': 'Play audio', 'data-kbd': 'A', onClick: () => speakCard('q') }, svgIcon('volume', 16)), h('button', { class: 'icon-btn', 'data-tip': 'More', onClick: e => moreMenu(e.currentTarget) }, svgIcon('moreV', 16)))));
    const styleEl = h('style', {}, scopeCss(q.css)); const front = h('div', { class: 'card-render rev-q selectable', html: q.html }); area.append(styleEl, front);
    if (q.typeField) { const inp = h('input', { class: 'input input-lg type-input', placeholder: 'Type your answer…', autocomplete: 'off', spellcheck: false }); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { typed = inp.value; show(); } }); const slot = front.querySelector('.type-answer-slot'); (slot || front).append(inp); area._typeAnswer = q.typeAnswer; setTimeout(() => inp.focus(), 50); }
    frame.body.append(area, h('div', { class: 'rev-actions' }, h('button', { class: 'btn btn-primary btn-xl show-answer', onClick: show }, 'Show answer', kbdHint('Space'))));
    startTimer(); if (S().ttsAutoplay) speakCard('q');
    if (p.autoAdvance > 0) autoTimer = setTimeout(() => { if (!shown) show(); }, p.autoAdvance * 1000);
  }
  function show() {
    if (shown || !card) return; shown = true; clearTimeout(autoTimer); const a = renderCard(card, 'a'); const d = deckOf(card); const p = presetOf(card);
    const area = frame.body.querySelector('.rev-card'); const inp = area.querySelector('.type-input'); if (inp) { typed = inp.value; inp.remove(); }
    let typedResult = null; if (area._typeAnswer != null && typed != null) { const g = gradeAnswer(typed, area._typeAnswer); typedResult = h('div', { class: `typed-compare ${g.correct ? 'ok' : 'bad'}` }, h('div', { class: 'label' }, g.correct ? 'Correct' : 'Your answer'), diffMarkup(typed, area._typeAnswer), g.correct ? null : h('div', { class: 'typed-expected' }, h('span', { class: 'label' }, 'Expected'), h('span', {}, area._typeAnswer))); g.correct ? sfx.correct() : sfx.wrong(); area._typedCorrect = g.correct; }
    area.querySelector('.rev-q').remove(); const back = h('div', { class: 'card-render rev-a selectable', html: a.html }); if (typedResult) { const slot = back.querySelector('.type-answer-slot'); if (slot) slot.replaceWith(typedResult); else back.append(typedResult); } area.append(back); if (opt().flipAnimation && S().animations) { area.classList.remove('flip-in'); void area.offsetWidth; area.classList.add('flip-reveal'); }
    const iv = previewIntervals(card, d); const two = opt().buttons === 2;
    const btn = (r, label, cls, k) => h('button', { class: `btn btn-xl rate-btn ${cls}`, onClick: () => rate(r) }, h('span', { class: 'rate-label' }, label), opt().showIntervals ? h('span', { class: 'rate-ivl' }, iv[r]?.label || '') : null, kbdHint(k));
    const actions = frame.body.querySelector('.rev-actions'); actions.innerHTML = '';
    if (two) actions.append(btn(1, 'Again', 'again', '1'), btn(3, 'Good', 'good', two ? '2' : '3')); else actions.append(btn(1, 'Again', 'again', '1'), btn(2, 'Hard', 'hard', '2'), btn(3, 'Good', 'good', '3'), btn(4, 'Easy', 'easy', '4'));
    if (S().ttsAutoplay) speakCard('a');
    if (p.autoAdvance > 0) autoTimer = setTimeout(() => rate(area._typedCorrect === false ? 1 : 3), p.autoAdvance * 1000);
  }
  function rate(r) {
    if (!shown || !card) return; clearTimeout(autoTimer); const took = Date.now() - cardStart; const d = deckOf(card); const wasType = card.type;
    answerCard(card, r, d, took); stats.studied++; stats.time += took; if (r === RATING.AGAIN) stats.again++;
    const xp = tracker.answer(r > 1, null); const b = frame.body.querySelectorAll('.rate-btn')[opt().buttons === 2 ? (r === 1 ? 0 : 1) : r - 1]; if (b) { b.classList.add('chosen'); if (r > 1) burst(b, 'success'); }
    if (r === 1) sfx.wrong(); else if (r === 4) sfx.match(); else sfx.correct();
    if (d) { d.lastStudied = Date.now(); db.decks.put(d); }
    const el = frame.body.querySelector('.rev-card'); if (el && S().animations) { el.classList.add(r === 1 ? 'swipe-left' : 'swipe-right'); setTimeout(next, 180); } else next();
  }
  function undo() { const c = undoAnswer(); if (!c) return; stats.studied = Math.max(0, stats.studied - 1); tracker.sess.cards = Math.max(0, tracker.sess.cards - 1); card = db.cards.get(c.id); shown = false; cardStart = Date.now(); header(); renderQ(); toast('Undone', 'info', { duration: 1000 }); }
  function startTimer() { clearInterval(timerIv); const el = frame.body.querySelector('.rev-timer'); if (!el) return; const p = presetOf(card); timerIv = setInterval(() => { const s = Math.min(Math.floor((Date.now() - cardStart) / 1000), p.maxAnswerSeconds || 60); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= (p.maxAnswerSeconds || 60)) el.classList.add('over'); }, 1000); }
  function speakCard(side) { const note = db.notes.get(card.noteId); const d = deckOf(card); const txt = side === 'q' ? stripHtml(renderCard(card, 'q').html) : stripHtml(note.fields[1] || renderCard(card, 'a').html.replace(/[\s\S]*<hr[^>]*>/, '')); speak(txt.replace(/\[\.\.\.\]/g, 'blank'), { lang: deckLang(d, side === 'q' ? 'term' : 'definition') }); }
  function moreMenu(anchor) {
    const note = db.notes.get(card.noteId); const d = deckOf(card);
    showMenu([
      { label: 'Edit card', icon: 'edit', shortcut: 'E', onClick: () => quickEditNote(note, () => { shown ? (shown = false, renderQ(), show()) : renderQ(); }) },
      { label: 'Card info', icon: 'info', shortcut: 'I', onClick: () => cardInfo() },
      { separator: true },
      { label: 'Flag', icon: 'flag', submenu: [{ label: 'No flag', checked: !card.flag, onClick: () => { setFlag([card], 0); renderFlag(); } }, ...FLAGS.map(([n, name, color]) => ({ label: name, color, checked: card.flag === n, shortcut: `${modKey}+${n}`, onClick: () => { setFlag([card], n); renderFlag(); } }))] },
      { label: 'Bury card', icon: 'archive', shortcut: '-', onClick: () => { buryCards([card]); toast('Card buried until tomorrow'); next(); } },
      { label: 'Bury note (all its cards)', icon: 'archive', shortcut: '=', onClick: () => { buryCards(db.cards.filter(c => c.noteId === card.noteId)); toast('Note buried'); next(); } },
      { label: 'Suspend card', icon: 'pause', shortcut: '@', onClick: () => { suspendCards([card]); toast('Card suspended'); next(); } },
      { label: 'Suspend note', icon: 'pause', shortcut: '!', onClick: () => { suspendCards(db.cards.filter(c => c.noteId === card.noteId)); toast('Note suspended'); next(); } },
      { separator: true },
      { label: 'Set options', icon: 'sliders', onClick: () => d && showDeckOptions(d, { onSave: () => { rebuild(); next(); } }) },
      { label: 'Delete note', icon: 'trash', danger: true, shortcut: `${modKey}+Del`, onClick: async () => { if (await confirm('Delete this note and all its cards?', { danger: true, okLabel: 'Delete' })) { deleteNotes([note.id]); rebuild(); next(); } } },
    ], { anchor, align: 'right' });
  }
  function renderFlag() { const top = frame.body.querySelector('.rev-card-top .row'); if (!top) return; top.querySelector('.flag-dot')?.remove(); if (card.flag) top.prepend(h('span', { class: 'flag-dot', style: { background: FLAGS[card.flag - 1][2] } })); }
  function cardInfo() { const note = db.notes.get(card.noteId); const logs = db.revlog.filter(r => r.cardId === card.id).sort((a, b) => b.time - a.time); const kv = (k, v) => h('div', { class: 'kv-row' }, h('span', { class: 'muted' }, k), h('span', {}, String(v))); modal({ title: 'Card info', size: 'md', content: h('div', {}, h('div', { class: 'kv' }, kv('Added', new Date(note.created).toLocaleString()), kv('First review', logs.length ? new Date(logs[logs.length - 1].time).toLocaleString() : '—'), kv('Latest review', logs.length ? new Date(logs[0].time).toLocaleString() : '—'), kv('Type', ['New', 'Learning', 'Review', 'Relearning'][card.type]), kv('Interval', `${card.ivl} days`), kv('Ease', `${Math.round((card.factor || 2500) / 10)}%`), kv('Reviews', card.reps), kv('Lapses', card.lapses), kv('Average time', logs.length ? fmtDuration(logs.reduce((a, l) => a + (l.took || 0), 0) / logs.length) : '—'), kv('Total time', fmtDuration(logs.reduce((a, l) => a + (l.took || 0), 0))), card.stability ? kv('Stability / Difficulty', `${card.stability.toFixed(2)} / ${card.difficulty.toFixed(2)}`) : null, kv('Card ID', card.id), kv('Note ID', note.id)), h('div', { class: 'label', style: { margin: '12px 0 6px' } }, 'History'), h('div', { class: 'revlog-list' }, ...logs.slice(0, 30).map(r => h('div', { class: 'revlog-row' }, h('span', { class: `rating r${r.rating}` }, ['', 'Again', 'Hard', 'Good', 'Easy'][r.rating]), h('span', { class: 'muted' }, new Date(r.time).toLocaleString()), h('span', {}, r.ivl > 0 ? `${r.ivl}d` : `${-r.ivl}m`), h('span', { class: 'muted' }, `${Math.round((r.took || 0) / 1000)}s`))))) }); }
  function waitScreen(c) {
    frame.body.innerHTML = ''; clearInterval(timerIv); const wait = Math.max(0, c.due - Date.now());
    frame.body.append(h('div', { class: 'results pop-in' }, h('div', { class: 'results-hero' }, h('div', { class: 'mode-icon big', style: { '--mode-color': '#f59e0b' } }, svgIcon('clock', 30)), h('div', {}, h('h1', {}, 'Learning cards are resting'), h('p', { class: 'muted' }, `The next card is due in ${fmtMin(Math.ceil(wait / 60000))}. You can wait, or study it now.`))), h('div', { class: 'results-actions' }, h('button', { class: 'btn btn-primary btn-lg', onClick: () => { card = null; c.due = Date.now(); db.cards.put(c); next(); } }, 'Study it now'), h('button', { class: 'btn btn-lg', onClick: () => congrats(true) }, 'Finish for now'))));
    const t = setTimeout(() => { if (!finished && !shown) next(); }, Math.min(wait + 200, 60000)); frame._waitTimer = t;
  }
  function congrats(early = false) {
    finished = true; clearInterval(timerIv); const s = tracker.finish({ meta: { again: stats.again } });
    const dc = deck ? dueCounts(deck.id, deck) : dueCounts(null); const buried = dc.buried;
    const left = deck ? { rawNew: dc.rawNew - dc.new, rawReview: dc.rawReview - dc.review } : { rawNew: 0, rawReview: 0 };
    const res = resultsScreen(frame, { title: stats.studied ? (early ? 'Session finished' : 'Congratulations!') : 'Nothing due right now', subtitle: stats.studied ? `You reviewed ${plural(stats.studied, 'card')} in ${fmtDuration(stats.time)}. ${stats.again ? `${stats.again} needed another look.` : 'Every card came back right.'}` : 'This set is up to date. Come back when cards are due, or study ahead.', correct: stats.studied - stats.again, wrong: stats.again, time: stats.time, xp: s.xp, celebrate: stats.studied > 0, scoreLabel: stats.studied ? undefined : '✓', actions: [
      (left.rawNew > 0 || left.rawReview > 0) && deck ? { label: `Study more (${left.rawNew} new · ${left.rawReview} review beyond limits)`, icon: 'zap', primary: true, onClick: () => { ignoreLimits = true; finished = false; stats.studied = 0; stats.again = 0; stats.time = 0; rebuild(); next(); } } : null,
      deck ? { label: 'Custom study session', icon: 'sliders', onClick: () => customStudy() } : null,
      buried ? { label: `Unbury ${buried} card(s)`, icon: 'archive', onClick: () => { unburyAll(deck ? deck.id : null); finished = false; rebuild(); next(); } } : null,
      deck ? { label: 'Practice with Learn', icon: 'brain', onClick: () => navigate(`study/learn/${deck.id}`) } : null,
      { label: isAll || isCustom ? 'Home' : 'Back to set', icon: 'arrowLeft', primary: !(left.rawNew > 0 || left.rawReview > 0), onClick: () => frame.exit(isAll || isCustom ? 'home' : null) }].filter(Boolean) });
    const dueSoon = deck ? db.cards.filter(c => c.deckId === deck.id && c.queue === QUEUE.REVIEW).length : 0; if (deck && dueSoon) res.append(h('p', { class: 'muted small center', style: { marginTop: '20px' } }, `${dueSoon} review cards are scheduled in this set. Streaks and retention improve when you come back daily.`));
  }
  function customStudy() {
    let n = 20, kind = 'new';
    modal({ title: 'Custom study', size: 'sm', content: h('div', { class: 'col' }, h('p', { class: 'muted small' }, 'Build a one-off session from this set.'), ...[['new', 'Study new cards ahead of schedule'], ['forgotten', 'Review cards you got wrong in the last 7 days'], ['ahead', 'Review cards due in the next 7 days'], ['all', 'Review all cards (cram)'], ['starred', 'Starred cards only']].map(([v, l]) => h('label', { class: 'checkbox', style: { padding: '6px 0' } }, h('input', { type: 'radio', name: 'cs', checked: kind === v, onChange: () => { kind = v; } }), l)), settingRow('Maximum cards', numberInput(n, v => { n = v; }, { min: 1, max: 999 }))), actions: [{ label: 'Cancel' }, { label: 'Start', variant: 'primary', onClick: () => { let cards = db.cards.filter(c => c.deckId === deck.id && c.queue !== QUEUE.SUSPENDED); const since = Date.now() - 7 * 86400000;
      if (kind === 'new') cards = cards.filter(c => c.type === TYPE.NEW).sort((a, b) => a.due - b.due); else if (kind === 'forgotten') { const bad = new Set(db.revlog.filter(r => r.time >= since && r.rating === 1).map(r => r.cardId)); cards = cards.filter(c => bad.has(c.id)); } else if (kind === 'ahead') { const limit = today() + 7; cards = cards.filter(c => c.queue === QUEUE.REVIEW && c.due <= limit).sort((a, b) => a.due - b.due); } else if (kind === 'starred') { cards = cards.filter(c => db.notes.get(c.noteId)?.starred); }
      cards = cards.slice(0, n); if (!cards.length) { toast('No cards match', 'warning'); return false; } db.setKV('customStudy', { cardIds: cards.map(c => c.id), name: `${deck.name} · custom` }); navigate('study/review/custom'); return true; } }] });
  }
  const unkey = keyHandler({ '* ': () => shown ? rate(3) : show(), 'enter': () => { if (document.activeElement && document.activeElement.classList.contains('type-input')) return false; shown ? rate(3) : show(); }, '*1': () => shown && rate(1), '*2': () => shown && rate(opt().buttons === 2 ? 3 : 2), '*3': () => shown && rate(3), '*4': () => shown && rate(4), 'mod+z': undo, '*e': () => card && quickEditNote(db.notes.get(card.noteId), () => renderQ()), '*i': () => card && cardInfo(), '*s': () => frame.body.querySelector('.rev-card-top .icon-btn')?.click(), '*a': () => card && speakCard(shown ? 'a' : 'q'), '*-': () => card && (buryCards([card]), next()), '*=': () => card && (buryCards(db.cards.filter(c => c.noteId === card.noteId)), next()), '*@': () => card && (suspendCards([card]), toast('Suspended'), next()), '*!': () => card && (suspendCards(db.cards.filter(c => c.noteId === card.noteId)), toast('Note suspended'), next()), ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(n => [`mod+${n}`, () => { if (card) { setFlag([card], card.flag === n ? 0 : n); renderFlag(); } }])), 'mod+delete': async () => { if (card && await confirm('Delete this note?', { danger: true, okLabel: 'Delete' })) { deleteNotes([card.noteId]); rebuild(); next(); } } });
  rebuild(); next();
  return () => { unkey(); clearInterval(timerIv); clearTimeout(autoTimer); clearTimeout(frame._waitTimer); if (!finished) tracker.finish({ meta: { again: stats.again } }); };
}
export function scopeCss(css) { return (css || '').replace(/(^|\})\s*([^{}]+)\{/g, (m, a, sel) => `${a} ${sel.split(',').map(s => '.card-render ' + s.trim().replace(/^\.card\b/, '')).join(',')}{`); }
