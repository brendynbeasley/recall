// Shared study-mode plumbing: frame, results, question helpers, mastery updates, options modals.
import { db } from '../db.js';
import { S, updateSettings, toggleStar, touchDeck, deckPairs } from '../models.js';
import { h, svgIcon, shuffle, sample, escapeHtml, fmtDuration, plural, pct, clamp, modKey } from '../utils.js';
import { modal, toast, confetti, toggle, settingRow, segmented, numberInput, slider, select, progressRing, kbd } from '../ui.js';
import { sfx, speak } from '../audio.js';
import { awardXP, endSession, startSession, xpForAnswer } from '../xp.js';
import { navigate } from '../app.js';

export function studyFrame(main, { deck, modeName, icon, color, onSettings, onRestart, backTo }) {
  main.innerHTML = '';
  const root = h('div', { class: 'study-root', style: { '--mode-color': color || 'var(--accent)' } });
  const progressBar = h('div', { class: 'study-progress' }, h('div', { class: 'study-progress-fill' }));
  const stats = h('div', { class: 'study-stats' });
  const title = h('div', { class: 'study-title' }, h('span', { class: 'study-mode-name' }, svgIcon(icon || 'cards', 16), modeName), h('span', { class: 'study-deck-name ellipsis' }, deck ? deck.name : ''));
  const top = h('div', { class: 'study-top' },
    h('button', { class: 'icon-btn lg', 'data-tip': 'Exit (Esc)', onClick: () => requestExitCb && requestExitCb() }, svgIcon('x', 20)),
    title, stats,
    h('div', { class: 'row', style: { gap: '4px' } }, onRestart ? h('button', { class: 'icon-btn lg', 'data-tip': 'Restart', 'data-kbd': 'R', onClick: onRestart }, svgIcon('refresh', 18)) : null, onSettings ? h('button', { class: 'icon-btn lg', 'data-tip': 'Options', onClick: onSettings }, svgIcon('settings', 18)) : null, h('button', { class: 'icon-btn lg', 'data-tip': 'Fullscreen', 'data-kbd': 'F11', onClick: async () => { const { toggleFullscreen } = await import('../app.js'); toggleFullscreen(); } }, svgIcon('maximize', 18))));
  const body = h('div', { class: 'study-body' });
  root.append(top, progressBar, body); main.append(root);
  let requestExitCb = null;
  return { root, body, title,
    setProgress: (v) => { progressBar.firstChild.style.width = `${clamp(v, 0, 1) * 100}%`; },
    setStats: (...els) => { stats.innerHTML = ''; stats.append(...els.filter(Boolean)); },
    onExit: (fn) => { requestExitCb = fn; },
    exit: (to) => navigate(to || backTo || (deck ? `set/${deck.id}` : 'home')),
  };
}
export function statChip(label, value, cls = '') { return h('span', { class: `stat-chip ${cls}` }, h('b', {}, value), h('span', {}, label)); }

// ---------- Questions ----------
export const sideText = (p, side) => side === 'term' ? p.term : p.definition;
export const sideHtml = (p, side) => side === 'term' ? (p.termHtml || escapeHtml(p.term)) : (p.defHtml || escapeHtml(p.definition));
export const sideImage = (p, side) => side === 'term' ? p.termImage : p.defImage;
export const otherSide = (s) => s === 'term' ? 'definition' : 'term';
export function pickAnswerSide(answerWith) { return answerWith === 'both' ? (Math.random() < 0.5 ? 'term' : 'definition') : answerWith; }
export function renderSide(p, side, { className = '', big = false } = {}) {
  const img = sideImage(p, side); const wrap = h('div', { class: `q-side ${className} ${big ? 'big' : ''}` });
  if (img) wrap.append(h('img', { src: img, class: 'q-image' }));
  wrap.append(h('div', { class: 'q-text selectable', html: sideHtml(p, side) }));
  return wrap;
}
export function distractors(pair, pool, n, side) {
  const key = (p) => sideText(p, side).trim().toLowerCase(); const target = key(pair);
  const uniq = []; const seen = new Set([target]);
  for (const p of shuffle(pool)) { const k = key(p); if (!k || seen.has(k)) continue; seen.add(k); uniq.push(p); if (uniq.length >= n) break; }
  return uniq;
}
export function mcOptions(pair, pool, n, side) { return shuffle([pair, ...distractors(pair, pool, n - 1, side)]); }
export function deckLang(deck, side) { return side === 'term' ? (deck?.langFront || 'auto') : (deck?.langBack || 'auto'); }
export function speakSide(p, side, deck, opts = {}) { return speak(sideText(p, side), { lang: deckLang(deck, side), voiceName: side === 'term' ? S().ttsVoiceFront : S().ttsVoiceBack, ...opts }); }

// ---------- Mastery (Quizlet-style progress) ----------
export function recordMastery(pair, correct, { mode = 'learn', weight = 1 } = {}) {
  const c = pair.card ? db.cards.get(pair.card.id) : null; if (!c) return;
  c.mastery = c.mastery || { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 };
  if (correct) { c.mastery.correct++; c.mastery.streak++; if (mode === 'learn' || mode === 'write' || mode === 'test') c.mastery.level = clamp(c.mastery.level + weight, 0, 3); else if (c.mastery.streak >= 2) c.mastery.level = clamp(c.mastery.level + 1, 0, 3); }
  else { c.mastery.wrong++; c.mastery.streak = 0; c.mastery.level = clamp(c.mastery.level - 1, 0, 2); }
  c.mastery.lastSeen = Date.now(); db.cards.put(c);
}
export function setMasteryLevel(pair, level) { const c = pair.card ? db.cards.get(pair.card.id) : null; if (!c) return; c.mastery = c.mastery || { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 }; c.mastery.level = clamp(level, 0, 3); c.mastery.lastSeen = Date.now(); db.cards.put(c); }

// ---------- Feedback ----------
export function feedback(correct, { expected, typed, close, message, onContinue, override, retype, pair, side, deck } = {}) {
  const el = h('div', { class: `feedback ${correct ? 'ok' : 'bad'} slide-up` });
  const head = h('div', { class: 'feedback-head' }, svgIcon(correct ? 'check' : 'x', 20), h('span', {}, message || (correct ? (close ? 'Correct! (we accepted a small typo)' : pickPraise()) : 'Not quite')));
  el.append(head);
  if (!correct && expected !== undefined) { el.append(h('div', { class: 'feedback-answer' }, h('div', { class: 'label' }, 'Correct answer'), h('div', { class: 'feedback-expected selectable', html: typeof expected === 'string' ? escapeHtml(expected) : expected }), typed ? h('div', { class: 'feedback-typed' }, h('span', { class: 'label' }, 'You said'), h('span', { class: 'selectable' }, diffMarkup(typed, typeof expected === 'string' ? expected : ''))) : null)); }
  const actions = h('div', { class: 'feedback-actions' });
  if (!correct && override) actions.append(h('button', { class: 'btn btn-ghost', onClick: override }, 'I was correct', kbdHint('O')));
  if (pair && deck) actions.append(h('button', { class: 'icon-btn', 'data-tip': 'Play audio', onClick: () => speakSide(pair, side || 'definition', deck) }, svgIcon('volume', 16)));
  if (retype) { const inp = h('input', { class: 'input input-lg retype', placeholder: 'Type the correct answer to continue', autocomplete: 'off', spellcheck: false }); inp.addEventListener('input', () => { const ok = inp.value.trim().toLowerCase() === String(expected).trim().toLowerCase(); inp.classList.toggle('ok', ok); if (ok) { sfx.pop(); setTimeout(() => onContinue && onContinue(), 250); } }); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) onContinue && onContinue(); }); el.append(h('div', { class: 'retype-wrap' }, inp, h('span', { class: 'small muted' }, `Ctrl+Enter to skip`))); setTimeout(() => inp.focus(), 50); }
  else if (onContinue) actions.append(h('button', { class: 'btn btn-primary btn-lg', onClick: onContinue, autofocus: true }, 'Continue', kbdHint('Enter')));
  el.append(actions); return el;
}
export function kbdHint(k) { return S().keyboardHints ? h('kbd', { class: 'hint-kbd' }, k) : null; }
const PRAISE = ['Correct!', 'Nice!', 'You got it!', 'Exactly right!', 'Well done!', 'Perfect!', 'Brilliant!', 'That\'s it!', 'Nailed it!', 'Yes!'];
export const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
export function diffMarkup(typed, expected) { const a = String(typed), b = String(expected); const wrap = h('span', { class: 'diff' }); let i = 0; for (const ch of a) { const ok = b[i] && b[i].toLowerCase() === ch.toLowerCase(); wrap.append(h('span', { class: ok ? 'd-ok' : 'd-bad' }, ch)); i++; } return wrap; }

// ---------- Results screen ----------
export function resultsScreen(frame, { title, subtitle, correct = 0, wrong = 0, time, xp = 0, extra = [], actions = [], mode, deck, celebrate = true, scoreLabel, score }) {
  const total = correct + wrong; const p = total ? correct / total : (score != null ? score / 100 : 1);
  if (celebrate && p >= 0.8) { sfx.complete(); confetti({ count: p === 1 ? 260 : 160, power: 1.1 }); } else sfx.close();
  const el = h('div', { class: 'results pop-in' },
    h('div', { class: 'results-hero' }, progressRing({ value: p, size: 150, stroke: 12, label: scoreLabel || `${Math.round(p * 100)}%`, color: p >= 0.8 ? 'var(--ok)' : p >= 0.5 ? 'var(--warn)' : 'var(--bad)' }), h('div', {}, h('h1', {}, title), h('p', { class: 'muted' }, subtitle || (p === 1 ? 'Flawless. You know this cold.' : p >= 0.8 ? 'Great work. A little more and it\'s yours.' : p >= 0.5 ? 'Good progress. Keep going!' : 'Tough round. Repetition is how it sticks.')), h('div', { class: 'results-chips' }, total ? statChip('correct', correct, 'ok') : null, total ? statChip('incorrect', wrong, wrong ? 'bad' : '') : null, time ? statChip('time', fmtDuration(time, true)) : null, xp ? statChip('XP earned', `+${xp}`, 'xp') : null, ...extra))),
    h('div', { class: 'results-actions' }, ...actions.map(a => h('button', { class: `btn btn-lg ${a.primary ? 'btn-primary' : ''}`, onClick: a.onClick }, a.icon ? svgIcon(a.icon, 18) : null, a.label))));
  frame.body.innerHTML = ''; frame.body.append(el); frame.setProgress(1);
  return el;
}
export function missedList(pairs, side = 'term') { if (!pairs.length) return null; return h('div', { class: 'missed-list' }, h('h3', {}, `Terms to review (${pairs.length})`), ...pairs.map(p => h('div', { class: 'missed-row' }, h('div', { class: 'bold', html: sideHtml(p, 'term') }), h('div', { class: 'muted', html: sideHtml(p, 'definition') })))); }

// ---------- Sessions ----------
export function sessionTracker(deck, mode) {
  const sess = startSession(deck ? deck.id : 'all', mode); if (deck) touchDeck(deck);
  let streak = 0;
  return { sess, answer(correct, at) { sess.cards++; if (correct) { sess.correct++; streak++; } else { sess.wrong++; streak = 0; } const xp = xpForAnswer(correct, { streak, mode }); sess.xp += xp; awardXP(xp, mode, at); return xp; }, get streak() { return streak; }, finish(extra) { return endSession(sess, extra); }, bonus(n) { sess.xp += n; awardXP(n, mode); } };
}

// ---------- Options modal ----------
export function optionsModal(title, settingsKey, fields, { onChange, extra } = {}) {
  const cur = S()[settingsKey] || {}; const body = h('div', { class: 'col', style: { gap: '0' } });
  const set = (k, v) => { updateSettings({ [settingsKey]: { [k]: v } }); onChange && onChange(k, v); };
  for (const f of fields) {
    if (f.type === 'toggle') body.append(toggle(cur[f.key], v => set(f.key, v), { label: f.label, description: f.desc }));
    else if (f.type === 'segment') body.append(settingRow(f.label, segmented(f.options, cur[f.key], v => set(f.key, v)), f.desc));
    else if (f.type === 'number') body.append(settingRow(f.label, numberInput(cur[f.key], v => set(f.key, v), { min: f.min, max: f.max, suffix: f.suffix }), f.desc));
    else if (f.type === 'slider') body.append(settingRow(f.label, slider(cur[f.key], v => set(f.key, v), { min: f.min, max: f.max, step: f.step, format: f.format }), f.desc));
    else if (f.type === 'select') body.append(settingRow(f.label, select(f.options, cur[f.key], v => set(f.key, v)), f.desc));
    else if (f.type === 'multi') body.append(settingRow(f.label, h('div', { class: 'row wrap' }, ...f.options.map(o => h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: (cur[f.key] || []).includes(o.value), onChange: e => { const s = new Set(cur[f.key] || []); e.target.checked ? s.add(o.value) : s.delete(o.value); if (!s.size) { s.add(o.value); e.target.checked = true; } cur[f.key] = [...s]; set(f.key, [...s]); } }), o.label))), f.desc));
  }
  if (extra) body.append(extra);
  return modal({ title, size: 'md', content: body, actions: [{ label: 'Done', variant: 'primary', value: true }] }).promise;
}
export function starBtn(pair, { onToggle } = {}) { const b = h('button', { class: `icon-btn lg ${pair.note.starred ? 'starred' : ''}`, 'data-tip': 'Star', 'data-kbd': 'S', onClick: e => { e.stopPropagation(); const v = toggleStar(pair.note); pair.starred = v; b.classList.toggle('starred', v); if (v) sfx.star(); onToggle && onToggle(v); } }, svgIcon('star', 18)); return b; }
export function keyHandler(map) { const fn = (e) => { const tag = (e.target.tagName || '').toLowerCase(); const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable; const k = (e.ctrlKey || e.metaKey ? 'mod+' : '') + (e.shiftKey ? 'shift+' : '') + e.key.toLowerCase(); const handler = map[k] || (typing ? null : map['*' + k]); if (handler) { const r = handler(e); if (r !== false) e.preventDefault(); } }; document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn); }
export function loadPairs(deck, { starredOnly = false } = {}) { let pairs = deckPairs(deck.id, { starredOnly }); if (starredOnly && !pairs.length) { toast('No starred terms, using all terms', 'info'); pairs = deckPairs(deck.id); } return pairs; }
export const fmtTimer = (ms) => { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
export function timerEl(start) { const el = h('span', { class: 'timer-chip' }, svgIcon('clock', 14), h('span', {}, '0:00')); const iv = setInterval(() => { el.lastChild.textContent = fmtTimer(Date.now() - start); }, 500); el.stop = () => clearInterval(iv); return el; }
