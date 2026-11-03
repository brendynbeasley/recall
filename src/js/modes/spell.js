// Spell: listen to the term and type what you hear.
import { S, updateSettings } from '../models.js';
import { h, svgIcon, shuffle, normalizeAnswer, diffChars } from '../utils.js';
import { toast, burst, shake } from '../ui.js';
import { sfx, speak, getVoices } from '../audio.js';
import { studyFrame, statChip, renderSide, sideText, sideHtml, recordMastery, setMasteryLevel, resultsScreen, sessionTracker, optionsModal, starBtn, keyHandler, loadPairs, kbdHint, deckLang, missedList } from './common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().spell;
  let pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!pairs.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  let queue = shuffle(pairs), idx = 0, attempts = 0, correct = 0, wrong = 0, missed = [], finished = false, answering = false;
  const tracker = sessionTracker(deck, 'spell'); ctx.inProgress = () => !finished && idx > 0;
  const frame = studyFrame(main, { deck, modeName: 'Spell', icon: 'volume', color: '#14b8a6', onSettings: openOptions, onRestart: () => restart() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  if (!getVoices().length) toast('No speech voices found. Spell works best with Windows voices installed; definitions will be shown as a hint.', 'warning', { duration: 6000 });
  const say = (p, rate) => speak(p.term, { lang: deckLang(deck, 'term'), voiceName: S().ttsVoiceFront, rate: rate ?? opt().rate });
  const header = () => { frame.setProgress(idx / queue.length); frame.setStats(statChip('correct', correct, 'ok'), statChip('incorrect', wrong, wrong ? 'bad' : ''), h('span', { class: 'bold' }, `${Math.min(idx + 1, queue.length)} / ${queue.length}`)); };
  function show() {
    answering = false; attempts = 0; if (idx >= queue.length) { finish(); return; } const p = queue[idx]; header();
    frame.body.innerHTML = '';
    const input = h('input', { class: 'input input-lg answer-input spell-input', placeholder: 'Type what you hear…', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') check(input.value); });
    const wrap = h('div', { class: 'learn-q spell-q slide-up' },
      h('div', { class: 'q-head' }, h('span', { class: 'q-kind' }, 'Listen and type the term'), starBtn(p)),
      h('div', { class: 'spell-speaker' }, h('button', { class: 'speaker-btn', 'data-tip': 'Play again', 'data-kbd': 'Ctrl+Space', onClick: () => say(p) }, svgIcon('volume', 40)), h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn btn-sm', onClick: () => say(p, Math.max(0.4, opt().rate * 0.6)) }, svgIcon('snooze', 14), 'Slower'), h('button', { class: 'btn btn-sm', onClick: () => say(p) }, svgIcon('refresh', 14), 'Replay'))),
      opt().showHint || !getVoices().length ? h('div', { class: 'q-prompt hint-prompt' }, h('div', { class: 'q-label' }, 'Definition'), renderSide(p, 'definition')) : null,
      h('div', { class: 'written-wrap' }, input, h('div', { class: 'row between' }, h('button', { class: 'btn btn-ghost', onClick: () => reveal(p) }, "Don't know", kbdHint('Ctrl+Enter')), h('button', { class: 'btn btn-primary', onClick: () => check(input.value) }, 'Check', kbdHint('Enter')))),
      h('div', { class: 'spell-feedback' }));
    frame.body.append(wrap); setTimeout(() => { input.focus(); say(p); }, 150);
  }
  function check(value) {
    if (answering) return; const p = queue[idx]; const a = normalizeAnswer(value, { ignorePunctuation: true }), e = normalizeAnswer(p.term, { ignorePunctuation: true });
    const fbEl = frame.body.querySelector('.spell-feedback'); const input = frame.body.querySelector('.spell-input');
    if (a === e) { answering = true; input.classList.add('ok'); input.disabled = true; sfx.correct(); burst(input); if (attempts === 0) { correct++; recordMastery(p, true, { mode: 'spell' }); setMasteryLevel(p, Math.max(p.card?.mastery?.level || 0, 2)); } tracker.answer(attempts === 0); fbEl.innerHTML = ''; fbEl.append(h('div', { class: 'feedback ok' }, h('div', { class: 'feedback-head' }, svgIcon('check', 20), h('span', {}, attempts === 0 ? 'Perfect spelling!' : 'Correct this time')))); header(); setTimeout(() => { idx++; show(); }, 900); return; }
    attempts++; sfx.wrong(); shake(input); input.classList.add('bad'); setTimeout(() => input.classList.remove('bad'), 600);
    if (attempts === 1) { wrong++; missed.push(p); recordMastery(p, false, { mode: 'spell' }); header(); }
    fbEl.innerHTML = '';
    const d = diffChars(String(value).toLowerCase(), p.term.toLowerCase());
    fbEl.append(h('div', { class: 'feedback bad' }, h('div', { class: 'feedback-head' }, svgIcon('x', 20), h('span', {}, 'Not quite. Listen again and fix the highlighted letters.')), h('div', { class: 'spell-diff' }, ...d.map(x => h('span', { class: `sd-${x.t}` }, x.t === 'ins' ? '_' : x.c))), h('div', { class: 'small muted' }, 'Red letters are wrong, underscores are missing. Correct answer: ', h('b', { class: 'spell-reveal selectable' }, p.term))));
    input.value = ''; input.focus(); say(p, Math.max(0.4, opt().rate * 0.7));
  }
  function reveal(p) { if (answering) return; const fbEl = frame.body.querySelector('.spell-feedback'); if (attempts === 0) { wrong++; missed.push(p); recordMastery(p, false, { mode: 'spell' }); tracker.answer(false); header(); } attempts++; fbEl.innerHTML = ''; fbEl.append(h('div', { class: 'feedback bad' }, h('div', { class: 'feedback-head' }, svgIcon('info', 20), h('span', {}, 'Here it is. Type it to continue.')), h('div', { class: 'feedback-expected selectable' }, p.term))); say(p, Math.max(0.4, opt().rate * 0.7)); frame.body.querySelector('.spell-input').focus(); }
  function finish() { finished = true; const s = tracker.finish(); const res = resultsScreen(frame, { title: wrong ? `${correct} of ${queue.length} spelled right first try` : 'Perfect spelling!', correct, wrong, time: s.end - s.start, xp: s.xp, actions: [missed.length ? { label: `Practice the ${missed.length} missed`, icon: 'refresh', primary: true, onClick: () => { queue = shuffle([...new Set(missed)]); idx = 0; correct = 0; wrong = 0; missed = []; finished = false; show(); } } : null, { label: 'Spell again', icon: 'rotate', primary: !missed.length, onClick: restart }, { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }].filter(Boolean) }); const ml = missedList([...new Set(missed)]); if (ml) res.append(ml); }
  function restart() { pairs = loadPairs(deck, { starredOnly: opt().starredOnly }); queue = shuffle(pairs); idx = 0; correct = 0; wrong = 0; missed = []; finished = false; show(); }
  function openOptions() { optionsModal('Spell options', 'spell', [{ type: 'slider', key: 'rate', label: 'Speech rate', min: 0.5, max: 1.5, step: 0.1, format: v => `${Math.round(v * 100)}%` }, { type: 'toggle', key: 'showHint', label: 'Show the definition as a hint' }, { type: 'toggle', key: 'starredOnly', label: 'Starred terms only' }], { onChange: (k) => { if (k === 'starredOnly') restart(); else show(); } }); }
  const unkey = keyHandler({ 'mod+ ': () => say(queue[idx]), 'mod+enter': () => reveal(queue[idx]), '*r': restart });
  show();
  return () => { unkey(); if (!finished) tracker.finish(); };
}
