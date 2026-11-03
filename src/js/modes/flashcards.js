// Flashcards: flip, navigate, shuffle, autoplay, TTS, star, sort (know / still learning)
import { S, updateSettings, toggleStar } from '../models.js';
import { h, svgIcon, shuffle, escapeHtml, plural } from '../utils.js';
import { toast, modal, segmented } from '../ui.js';
import { sfx, speak, stopSpeaking } from '../audio.js';
import { studyFrame, statChip, renderSide, speakSide, otherSide, recordMastery, setMasteryLevel, resultsScreen, sessionTracker, optionsModal, starBtn, keyHandler, loadPairs, kbdHint, missedList } from './common.js';
import { navigate } from '../app.js';

export async function start(ctx) {
  const { main, deck } = ctx; const opt = () => S().flashcards;
  let all = loadPairs(deck, { starredOnly: opt().starredOnly }); if (!all.length) { toast('This set has no terms yet', 'warning'); navigate(`set/${deck.id}`); return; }
  let order = opt().shuffle ? shuffle(all) : all.slice(); let idx = 0, flipped = false, autoplay = null, know = [], learning = [], finished = false, dragging = false;
  const tracker = sessionTracker(deck, 'flashcards'); ctx.inProgress = () => !finished && (know.length + learning.length) > 0;
  const frame = studyFrame(main, { deck, modeName: 'Flashcards', icon: 'cards', color: '#6366f1', onSettings: openOptions, onRestart: () => restart() });
  frame.onExit(async () => { const { requestExit } = await import('./index.js'); requestExit(); });
  const stage = h('div', { class: 'fc-stage' }); frame.body.append(stage);
  const front = () => opt().frontSide === 'definition' ? 'definition' : 'term';

  function render() {
    stopSpeaking(); stage.innerHTML = '';
    if (!order.length) { stage.append(h('div', { class: 'empty-state' }, h('h3', {}, 'Nothing to show'))); return; }
    const p = order[idx]; const f = front(), b = otherSide(f);
    frame.setProgress((idx + 1) / order.length);
    frame.setStats(opt().sortMode ? h('div', { class: 'sort-counts' }, h('span', { class: 'sc bad' }, learning.length, h('small', {}, 'Still learning')), h('span', { class: 'sc ok' }, know.length, h('small', {}, 'Know'))) : h('span', { class: 'bold' }, `${idx + 1} / ${order.length}`));
    const card = h('div', { class: `flashcard anim-${opt().animation} ${flipped ? 'flipped' : ''}`, tabindex: 0 },
      h('div', { class: 'flashcard-inner' },
        h('div', { class: 'fc-face fc-front' }, faceTools(p, f), h('div', { class: 'fc-label' }, f === 'term' ? 'Term' : 'Definition'), renderSide(p, f, { big: true }), h('div', { class: 'fc-hint muted small' }, 'Click or press Space to flip')),
        h('div', { class: 'fc-face fc-back' }, faceTools(p, b), h('div', { class: 'fc-label' }, b === 'term' ? 'Term' : 'Definition'), renderSide(p, b, { big: true }))));
    card.addEventListener('click', e => { if (e.target.closest('button')) return; if (dragging) return; flip(); });
    // swipe / drag for sort mode and navigation
    if (opt().swipe) attachDrag(card);
    stage.append(card);
    const nav = h('div', { class: 'fc-nav' });
    if (opt().sortMode) nav.append(h('button', { class: 'btn btn-xl btn-sort bad', onClick: () => sort(false) }, svgIcon('x', 22), h('span', {}, 'Still learning'), kbdHint('1 / ←')), h('div', { class: 'fc-counter' }, h('button', { class: 'icon-btn lg', disabled: idx === 0, onClick: prev, 'data-tip': 'Undo last' }, svgIcon('undo', 20)), h('span', { class: 'bold' }, `${idx + 1} / ${order.length}`)), h('button', { class: 'btn btn-xl btn-sort ok', onClick: () => sort(true) }, svgIcon('check', 22), h('span', {}, 'Know'), kbdHint('2 / →')));
    else nav.append(h('button', { class: 'icon-btn lg fc-arrow', disabled: idx === 0, onClick: prev, 'data-tip': 'Previous', 'data-kbd': '←' }, svgIcon('arrowLeft', 26)), h('div', { class: 'fc-counter' }, h('span', { class: 'bold' }, `${idx + 1} / ${order.length}`)), h('button', { class: 'icon-btn lg fc-arrow', disabled: idx >= order.length - 1 && !opt().sortMode, onClick: next, 'data-tip': 'Next', 'data-kbd': '→' }, svgIcon('arrowRight', 26)));
    stage.append(nav);
    stage.append(h('div', { class: 'fc-tools' },
      toolBtn('play', autoplay ? 'pause' : 'play', autoplay ? 'Pause autoplay' : 'Autoplay', 'P', toggleAutoplay, !!autoplay),
      toolBtn('shuffle', 'shuffle', 'Shuffle', 'H', () => { updateSettings({ flashcards: { shuffle: !opt().shuffle } }); order = opt().shuffle ? shuffle(all) : all.slice(); idx = 0; flipped = false; render(); toast(opt().shuffle ? 'Shuffled' : 'Original order', 'info', { duration: 1200 }); }, opt().shuffle),
      toolBtn('sort', 'layers', opt().sortMode ? 'Sort mode on' : 'Sort cards (know / still learning)', 'T', () => { updateSettings({ flashcards: { sortMode: !opt().sortMode } }); know = []; learning = []; idx = 0; flipped = false; render(); }, opt().sortMode),
      toolBtn('tts', 'volume', 'Read aloud', 'A', () => speakCurrent(), opt().tts),
      toolBtn('swap', 'rotate', `Front: ${front() === 'term' ? 'Term' : 'Definition'} (swap)`, 'F', () => { updateSettings({ flashcards: { frontSide: otherSide(front()) } }); flipped = false; render(); }),
      toolBtn('edit', 'edit', 'Edit this card', 'E', async () => { const { quickEditNote } = await import('../views/editor.js'); await quickEditNote(p.note, () => { all = loadPairs(deck, { starredOnly: opt().starredOnly }); const o = order.map(x => all.find(a => a.cardId === x.cardId) || x); order = o; render(); }); })));
    if (opt().tts && opt().ttsAutoplayed !== false && S().ttsAutoplay) speakSide(p, f, deck);
  }
  const toolBtn = (id, icon, tip, k, fn, active) => h('button', { class: `icon-btn lg ${active ? 'active' : ''}`, 'data-tip': tip, 'data-kbd': k, onClick: fn }, svgIcon(icon, 18));
  function faceTools(p, side) { return h('div', { class: 'fc-face-tools' }, h('button', { class: 'icon-btn', 'data-tip': 'Play audio', onClick: e => { e.stopPropagation(); speakSide(p, side, deck); } }, svgIcon('volume', 16)), starBtn(p)); }
  function flip() { flipped = !flipped; sfx.flip(); const c = stage.querySelector('.flashcard'); c && c.classList.toggle('flipped', flipped); if (flipped && opt().tts && S().ttsAutoplay) speakSide(order[idx], otherSide(front()), deck); }
  function go(delta, dir) { const n = idx + delta; if (n < 0 || n >= order.length) return; const c = stage.querySelector('.flashcard'); if (c && S().animations) { c.classList.add(dir === 'next' ? 'slide-out-left' : 'slide-out-right'); setTimeout(() => { idx = n; flipped = false; render(); const nc = stage.querySelector('.flashcard'); nc && nc.classList.add(dir === 'next' ? 'slide-in-right' : 'slide-in-left'); }, 140); } else { idx = n; flipped = false; render(); } }
  function next() { if (opt().sortMode) return; go(1, 'next'); }
  function prev() { if (opt().sortMode) { if (idx === 0) return; const last = order[idx - 1]; know = know.filter(x => x !== last); learning = learning.filter(x => x !== last); idx--; flipped = false; render(); return; } go(-1, 'prev'); }
  function sort(knowIt) {
    const p = order[idx]; (knowIt ? know : learning).push(p); recordMastery(p, knowIt, { mode: 'flashcards' }); if (knowIt) setMasteryLevel(p, Math.max(p.card?.mastery?.level || 0, 2)); tracker.answer(knowIt);
    const c = stage.querySelector('.flashcard'); if (c) { c.classList.add(knowIt ? 'fly-right' : 'fly-left'); knowIt ? sfx.correct() : sfx.swoosh(); }
    setTimeout(() => { if (idx >= order.length - 1) finishSort(); else { idx++; flipped = false; render(); } }, S().animations ? 260 : 0);
  }
  function finishSort() {
    finished = true; stopAutoplay(); const s = tracker.finish({ meta: { know: know.length, learning: learning.length } });
    const res = resultsScreen(frame, { title: know.length === order.length ? 'You know them all!' : `${Math.round(know.length / order.length * 100)}% known`, correct: know.length, wrong: learning.length, time: s.end - s.start, xp: s.xp, celebrate: true, actions: [
      learning.length ? { label: `Review the ${learning.length} still learning`, icon: 'refresh', primary: true, onClick: () => { order = shuffle(learning); know = []; learning = []; idx = 0; flipped = false; finished = false; render(); } } : null,
      { label: 'Restart all cards', icon: 'rotate', primary: !learning.length, onClick: () => restart() },
      { label: 'Learn these', icon: 'brain', onClick: () => navigate(`study/learn/${deck.id}`) },
      { label: 'Back to set', icon: 'arrowLeft', onClick: () => frame.exit() }].filter(Boolean) });
    const ml = missedList(learning); if (ml) res.append(ml);
  }
  function restart() { stopAutoplay(); all = loadPairs(deck, { starredOnly: opt().starredOnly }); order = opt().shuffle ? shuffle(all) : all.slice(); idx = 0; flipped = false; know = []; learning = []; finished = false; render(); }
  function toggleAutoplay() { if (autoplay) stopAutoplay(); else { const step = () => { if (!flipped) flip(); else if (idx < order.length - 1) go(1, 'next'); else { stopAutoplay(); toast('Autoplay finished', 'info'); return; } autoplay = setTimeout(step, opt().autoplaySeconds * 1000); }; autoplay = setTimeout(step, opt().autoplaySeconds * 1000); render(); } }
  function stopAutoplay() { if (autoplay) { clearTimeout(autoplay); autoplay = null; render(); } }
  function speakCurrent() { const p = order[idx]; speakSide(p, flipped ? otherSide(front()) : front(), deck); }
  function attachDrag(card) {
    let sx = 0, sy = 0, dx = 0, down = false; const TH = 110;
    card.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button')) return; down = true; dragging = false; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); card.classList.add('grabbing'); });
    card.addEventListener('pointermove', e => { if (!down) return; dx = e.clientX - sx; const dy = e.clientY - sy; if (Math.abs(dx) > 6) dragging = true; if (!dragging) return; card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 22}deg)`; card.classList.toggle('lean-right', dx > TH / 2); card.classList.toggle('lean-left', dx < -TH / 2); });
    const end = () => { if (!down) return; down = false; card.classList.remove('grabbing'); const was = dragging; card.style.transform = ''; card.classList.remove('lean-right', 'lean-left'); if (was && Math.abs(dx) > TH) { if (opt().sortMode) sort(dx > 0); else if (dx < 0) next(); else prev(); } dx = 0; setTimeout(() => { dragging = false; }, 50); };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  }
  function openOptions() {
    optionsModal('Flashcard options', 'flashcards', [
      { type: 'segment', key: 'frontSide', label: 'Front side', options: [{ value: 'term', label: 'Term' }, { value: 'definition', label: 'Definition' }] },
      { type: 'toggle', key: 'shuffle', label: 'Shuffle cards' }, { type: 'toggle', key: 'sortMode', label: 'Sort mode', desc: 'Sort each card into Know / Still learning as you go.' },
      { type: 'toggle', key: 'starredOnly', label: 'Study starred terms only' },
      { type: 'segment', key: 'animation', label: 'Flip animation', options: [{ value: 'flip', label: '3D flip' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'Instant' }] },
      { type: 'number', key: 'autoplaySeconds', label: 'Autoplay speed', min: 1, max: 30, suffix: 'sec' },
      { type: 'toggle', key: 'tts', label: 'Read cards aloud', desc: 'Uses the voices installed on this computer.' }, { type: 'toggle', key: 'swipe', label: 'Swipe / drag gestures' },
    ], { onChange: (k) => { if (k === 'starredOnly' || k === 'shuffle') restart(); else render(); } });
  }
  const unkey = keyHandler({ '* ': flip, '*arrowup': flip, '*arrowdown': flip, '*arrowright': () => opt().sortMode ? sort(true) : next(), '*arrowleft': () => opt().sortMode ? sort(false) : prev(), '*1': () => opt().sortMode && sort(false), '*2': () => opt().sortMode && sort(true), '*s': () => { const p = order[idx]; const v = toggleStar(p.note); p.starred = v; render(); if (v) sfx.star(); }, '*h': () => stage.querySelectorAll('.fc-tools .icon-btn')[1].click(), '*a': speakCurrent, '*p': toggleAutoplay, '*f': () => stage.querySelectorAll('.fc-tools .icon-btn')[4].click(), '*t': () => stage.querySelectorAll('.fc-tools .icon-btn')[2].click(), '*r': restart, '*e': () => stage.querySelectorAll('.fc-tools .icon-btn')[5]?.click() });
  render();
  return () => { unkey(); stopAutoplay(); if (!finished && (know.length || learning.length)) tracker.finish(); };
}
