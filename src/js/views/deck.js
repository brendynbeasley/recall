// Set page: launch study modes & games, see progress, browse terms
import { db } from '../db.js';
import { deckNotes, notePairs, toggleStar, touchDeck, updateDeck, S, updateSettings, deleteNotes, resolveMedia } from '../models.js';
import { h, svgIcon, plural, fmtRelative, stripHtml, escapeHtml, debounce } from '../utils.js';
import { showMenu, toast, confirm, segmented, modal } from '../ui.js';
import { dueCounts, retentionStats } from '../scheduler.js';
import { speak } from '../audio.js';
import { navigate, deckContextMenu, renderSidebar } from '../app.js';
import { deckMastery, cardLevel, donut, legend } from './common.js';
import { showDeckOptions } from './deckoptions.js';
import { quickEditNote } from './editor.js';

export const MODES = [
  { id: 'flashcards', short: 'Flip at your pace', name: 'Flashcards', icon: 'cards', desc: 'Flip through cards at your own pace', color: '#6366f1' },
  { id: 'learn', short: 'Adaptive rounds', name: 'Learn', icon: 'brain', desc: 'Adaptive multiple choice and written rounds', color: '#8b5cf6' },
  { id: 'test', short: 'Graded practice exam', name: 'Test', icon: 'edit', desc: 'A graded practice exam you configure', color: '#ec4899' },
  { id: 'write', short: 'Type every answer', name: 'Write', icon: 'type', desc: 'Type every answer until you get it right', color: '#f59e0b' },
  { id: 'spell', short: 'Listen and type', name: 'Spell', icon: 'volume', desc: 'Listen and type what you hear', color: '#14b8a6' },
  { id: 'review', short: 'Spaced repetition', name: 'Anki', icon: 'clock', desc: 'Spaced repetition: Again, Hard, Good, Easy', color: '#10b981' },
];
export const GAMES = [
  { id: 'match', short: 'Beat the clock', name: 'Match', icon: 'grid', desc: 'Pair terms and definitions against the clock', color: '#3b82f6' },
  { id: 'gravity', short: 'Stop the asteroids', name: 'Gravity', icon: 'rocket', desc: 'Type answers before the asteroids hit', color: '#f43f5e' },
  { id: 'memory', short: 'Find the pairs', name: 'Memory', icon: 'puzzle', desc: 'Concentration: find hidden pairs', color: '#a855f7' },
  { id: 'blast', short: 'Rapid true or false', name: 'Blast', icon: 'zap', desc: 'Rapid-fire true/false under time pressure', color: '#f97316' },
  { id: 'unscramble', short: 'Rebuild the term', name: 'Unscramble', icon: 'shuffle', desc: 'Rebuild each term from scrambled pieces', color: '#06b6d4' },
  { id: 'reveal', short: 'Fewer hints, more points', name: 'Reveal', icon: 'eye', desc: 'Name the term, uncovering letters only if needed', color: '#8b5cf6' },
  { id: 'survival', short: 'Recall with 3 lives', name: 'Survival', icon: 'heart', desc: 'Type from memory; misses come back until fixed', color: '#ef4444' },
  { id: 'confidence', short: 'Bet on what you know', name: 'Confidence', icon: 'target', desc: 'Answer, then bet how sure you are', color: '#10b981' },
];

export function render(main, route) {
  const deck = db.decks.get(route.parts[0]); if (!deck) { navigate('library', { replace: true }); return; }
  const inner = h('div', { class: 'main-inner' }); main.append(inner);
  const prefs = db.getKV('deckViewPrefs', { sort: 'original', starredOnly: false, termsView: 'list' });
  let previewIdx = 0, previewFlipped = false;
  const draw = () => {
    inner.innerHTML = '';
    const notes = deckNotes(deck.id); const pairs = notes.flatMap(n => notePairs(n)); const m = deckMastery(deck.id); const due = dueCounts(deck.id, deck); const dueTotal = due.new + due.learn + due.review; const ret = retentionStats(deck.id, 30);
    // Header (simple)
    const pct = Math.round(m.pct * 100);
    const crumb = deck.folderId && db.folders.get(deck.folderId) ? h('button', { class: 'crumb', onClick: () => navigate(`folder/${deck.folderId}`) }, svgIcon('folder', 13), db.folders.get(deck.folderId).name) : h('button', { class: 'crumb', onClick: () => navigate('library') }, svgIcon('library', 13), 'Library');
    inner.append(h('div', { class: 'sd-head', style: { '--deck-color': deck.color || 'var(--accent)' } },
      h('div', { class: 'sd-top' }, crumb, h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate(`edit/${deck.id}`) }, svgIcon('edit', 15), 'Edit'),
        h('button', { class: 'icon-btn', 'data-tip': 'Options', onClick: () => showDeckOptions(deck, { onSave: () => { draw(); renderSidebar(); } }) }, svgIcon('sliders', 16)),
        h('button', { class: 'icon-btn', onClick: e => deckContextMenu(deck, e) }, svgIcon('more', 16)))),
      h('h1', { class: 'sd-title' }, deck.name),
      h('div', { class: 'sd-meta' }, `${plural(pairs.length, 'card')} · ${pct}% mastered` + (deck.lastStudied ? ` · studied ${fmtRelative(deck.lastStudied)}` : '')),
      h('div', { class: 'sd-bar' }, h('div', { style: { width: pct + '%' } }))));
    // Study actions
    const go = (id) => { if (!pairs.length) { toast('Add some terms first', 'warning'); return; } navigate(`study/${id}/${deck.id}`); };
    const tile = (mo) => h('button', { class: 'sx-tile', style: { '--mode-color': mo.color }, onClick: () => go(mo.id) },
      h('span', { class: 'sx-icon' }, svgIcon(mo.icon, 20)),
      h('span', { class: 'sx-text' }, h('span', { class: 'sx-name' }, mo.name, mo.id === 'review' && dueTotal ? h('span', { class: 'sx-badge' }, dueTotal) : null), h('span', { class: 'sx-sub' }, mo.short || '')));
    const order = ['review', 'flashcards', 'learn', 'test', 'write', 'spell'];
    const studyModes = order.map(id => MODES.find(x => x.id === id)).filter(Boolean);
    const count = (n, l, c) => h('div', { class: 'sx-count' }, h('b', { style: { color: n ? c : 'var(--text-faint)' } }, n), h('span', {}, l));
    inner.append(h('div', { class: 'sx-wrap' },
      h('div', { class: 'sx-today' },
        h('div', { class: 'sx-today-text' }, h('div', { class: 'sx-today-title' }, dueTotal ? 'Ready for today' : 'All caught up'), h('div', { class: 'sx-today-sub' }, dueTotal ? 'Anki review keeps these cards fresh.' : 'Nothing due. Practise any mode below.')),
        h('div', { class: 'sx-counts' }, count(due.new, 'New', 'var(--accent)'), count(due.learn, 'Learning', 'var(--warn)'), count(due.review, 'Review', 'var(--ok)')),
        h('button', { class: 'sx-start', onClick: () => go(dueTotal ? 'review' : 'learn') }, svgIcon(dueTotal ? 'play' : 'zap', 16), dueTotal ? 'Start review' : 'Learn')),
      h('div', { class: 'sx-label' }, 'Study'),
      h('div', { class: 'sx-grid' }, ...studyModes.map(tile)),
      h('div', { class: 'sx-label' }, 'Games'),
      h('div', { class: 'sx-grid sx-games' }, ...GAMES.map(tile))));
    // Preview + progress
    const prev = h('div', { class: 'set-preview' });
    if (pairs.length) {
      const p = pairs[Math.min(previewIdx, pairs.length - 1)];
      const face = (side) => h('div', { class: `preview-face ${side}` }, h('div', { class: 'preview-label' }, side === 'front' ? 'Term' : 'Definition'), p[side === 'front' ? 'termImage' : 'defImage'] ? h('img', { src: p[side === 'front' ? 'termImage' : 'defImage'], class: 'preview-img' }) : null, h('div', { class: 'preview-text', html: side === 'front' ? (p.termHtml || escapeHtml(p.term)) : (p.defHtml || escapeHtml(p.definition)) }), h('button', { class: 'icon-btn preview-audio', 'data-tip': 'Play audio', onClick: e => { e.stopPropagation(); speak(side === 'front' ? p.term : p.definition, { lang: side === 'front' ? deck.langFront : deck.langBack }); } }, svgIcon('volume', 16)));
      const card = h('div', { class: `preview-card ${previewFlipped ? 'flipped' : ''}`, onClick: () => { previewFlipped = !previewFlipped; card.classList.toggle('flipped', previewFlipped); } }, h('div', { class: 'preview-inner' }, face('front'), face('back')));
      prev.append(card, h('div', { class: 'preview-nav' }, h('button', { class: 'icon-btn lg', disabled: previewIdx === 0, onClick: () => { previewIdx--; previewFlipped = false; draw(); } }, svgIcon('arrowLeft', 20)), h('span', { class: 'bold' }, `${previewIdx + 1} / ${pairs.length}`), h('button', { class: 'icon-btn lg', disabled: previewIdx >= pairs.length - 1, onClick: () => { previewIdx++; previewFlipped = false; draw(); } }, svgIcon('arrowRight', 20)), h('button', { class: 'btn btn-sm btn-ghost', style: { marginLeft: 'auto' }, onClick: () => navigate(`study/flashcards/${deck.id}`) }, 'Open flashcards', svgIcon('maximize', 14))));
    } else prev.append(h('div', { class: 'empty-state' }, h('h3', {}, 'No terms yet'), h('p', {}, 'Add terms to start studying.'), h('button', { class: 'btn btn-primary', onClick: () => navigate(`edit/${deck.id}`) }, 'Add terms')));
    const total = Math.max(1, m.mastered + m.learning + m.notStudied);
    const seg = (v, c) => h('div', { style: { width: (v / total * 100) + '%', background: c } });
    const statRow = (c, l, v) => h('div', { class: 'pg-row' }, h('i', { style: { background: c } }), h('span', {}, l), h('b', {}, v));
    const progress = h('div', { class: 'pg-panel' },
      h('div', { class: 'pg-head' }, h('span', { class: 'pg-label' }, 'Progress'), h('button', { class: 'pg-link', onClick: () => navigate(`stats?deck=${deck.id}`) }, 'Details')),
      h('div', { class: 'pg-big' }, h('span', { class: 'pg-pct' }, Math.round(m.pct * 100) + '%'), h('span', { class: 'pg-sub' }, 'mastered')),
      h('div', { class: 'pg-bar' }, seg(m.mastered, 'var(--ok)'), seg(m.learning, 'var(--warn)')),
      h('div', { class: 'pg-rows' }, statRow('var(--ok)', 'Mastered', m.mastered), statRow('var(--warn)', 'Still learning', m.learning), statRow('var(--surface-3)', 'Not studied', m.notStudied)),
      h('div', { class: 'pg-foot' }, dueTotal ? `${dueTotal} due for review` : 'Nothing due right now'));
    inner.append(h('div', { class: 'set-mid' }, prev, progress));
    // Terms list
    const starred = notes.filter(n => n.starred).length;
    const header = h('div', { class: 'terms-head' }, h('h2', { class: 'section-title', style: { margin: 0 } }, `Terms in this set (${pairs.length})`), h('div', { class: 'row wrap' },
      segmented([{ value: false, label: 'All' }, { value: true, label: `Starred (${starred})` }], prefs.starredOnly, v => { prefs.starredOnly = v; db.setKV('deckViewPrefs', prefs); draw(); }),
      h('select', { class: 'input select input-sm', onChange: e => { prefs.sort = e.target.value; db.setKV('deckViewPrefs', prefs); draw(); } }, ...[['original', 'Original order'], ['alpha', 'Alphabetical'], ['stats', 'Your stats'], ['starred', 'Starred first']].map(([v, l]) => h('option', { value: v, selected: prefs.sort === v }, l))),
      h('button', { class: 'btn btn-sm', onClick: () => termsMenu(notes) }, svgIcon('more', 14))));
    inner.append(header);
    let list = pairs.filter(p => !prefs.starredOnly || p.starred);
    if (prefs.sort === 'alpha') list = list.slice().sort((a, b) => a.term.localeCompare(b.term)); else if (prefs.sort === 'starred') list = list.slice().sort((a, b) => (b.starred - a.starred)); else if (prefs.sort === 'stats') list = list.slice().sort((a, b) => cardLevel(a.card || {}) - cardLevel(b.card || {}));
    const groups = prefs.sort === 'stats' ? [[0, 'Not studied'], [1, 'Still learning'], [2, 'Still learning'], [3, 'Mastered']] : null;
    const termsWrap = h('div', { class: 'terms-list' }); inner.append(termsWrap);
    const CHUNK = 80; let shown = 0;
    const renderChunk = () => { const slice = list.slice(shown, shown + CHUNK); let lastGroup = null;
      for (const p of slice) { if (groups) { const g = groups[cardLevel(p.card || {})][1]; if (g !== lastGroup && (shown === 0 || true)) { if (!termsWrap.querySelector(`[data-group="${g}"]`)) termsWrap.append(h('div', { class: 'terms-group', 'data-group': g }, g)); lastGroup = g; } } termsWrap.append(termRow(p)); }
      shown += slice.length; more.classList.toggle('hidden', shown >= list.length); more.textContent = `Show more (${list.length - shown} remaining)`; };
    const more = h('button', { class: 'btn btn-block', style: { marginTop: '10px' }, onClick: renderChunk }); inner.append(more); renderChunk();
    if (!list.length) termsWrap.append(h('div', { class: 'empty-state', style: { padding: '30px' } }, h('p', {}, prefs.starredOnly ? 'No starred terms. Star terms to focus on them.' : 'No terms yet.')));
    inner.append(h('div', { class: 'row', style: { marginTop: '20px', justifyContent: 'center' } }, h('button', { class: 'btn btn-lg', onClick: () => navigate(`edit/${deck.id}`) }, svgIcon('plus', 16), 'Add or edit terms')));
  };
  const legendRow = (c, l, v) => h('div', { class: 'row small' }, h('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: c, display: 'inline-block' } }), h('span', { class: 'grow muted' }, l), h('b', {}, v));
  const termRow = (p) => {
    const lvl = cardLevel(p.card || {});
    const row = h('div', { class: 'term-row', 'data-note': p.noteId },
      h('div', { class: `term-level lvl-${lvl}`, 'data-tip': ['Not studied', 'Still learning', 'Familiar', 'Mastered'][lvl] }),
      h('div', { class: 'term-cell selectable' }, p.termImage ? h('img', { src: p.termImage, class: 'term-thumb' }) : null, h('div', { class: 'term-text', html: p.termHtml || escapeHtml(p.term) })),
      h('div', { class: 'term-cell selectable' }, p.defImage ? h('img', { src: p.defImage, class: 'term-thumb' }) : null, h('div', { class: 'term-text', html: p.defHtml || escapeHtml(p.definition) })),
      h('div', { class: 'term-actions' }, h('button', { class: `icon-btn sm ${p.starred ? 'starred' : ''}`, 'data-tip': p.starred ? 'Unstar' : 'Star', onClick: () => { const v = toggleStar(p.note); row.querySelector('.icon-btn').classList.toggle('starred', v); row.querySelector('.icon-btn').dataset.tip = v ? 'Unstar' : 'Star'; } }, svgIcon('star', 15)), h('button', { class: 'icon-btn sm', 'data-tip': 'Play audio', onClick: () => speak(p.term, { lang: deck.langFront }).then(() => speak(p.definition, { lang: deck.langBack, interrupt: false })) }, svgIcon('volume', 15)), h('button', { class: 'icon-btn sm', 'data-tip': 'Edit', onClick: () => quickEditNote(p.note, () => draw()) }, svgIcon('edit', 15))));
    row.addEventListener('contextmenu', e => { e.preventDefault(); showMenu([{ label: 'Edit', icon: 'edit', onClick: () => quickEditNote(p.note, () => draw()) }, { label: p.starred ? 'Unstar' : 'Star', icon: 'star', onClick: () => { toggleStar(p.note); draw(); } }, { label: 'Open in browser', icon: 'search', onClick: () => navigate(`browser?note=${p.noteId}`) }, { separator: true }, { label: 'Delete term', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this term?', { danger: true, okLabel: 'Delete' })) { deleteNotes([p.noteId]); draw(); } } }], { x: e.clientX, y: e.clientY }); });
    return row;
  };
  const termsMenu = (notes) => showMenu([
    { label: 'Star all', icon: 'star', onClick: () => { notes.forEach(n => toggleStar(n, true)); draw(); } }, { label: 'Unstar all', icon: 'star', onClick: () => { notes.forEach(n => toggleStar(n, false)); draw(); } },
    { label: 'Reset learn progress', icon: 'refresh', onClick: async () => { if (await confirm('Reset mastery progress for this set? Spaced-repetition scheduling is kept.')) { const cards = db.cards.filter(c => c.deckId === deck.id); cards.forEach(c => { c.mastery = { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 }; }); db.cards.putMany(cards); deck.learnProgress = null; db.decks.put(deck); draw(); toast('Progress reset'); } } },
    { label: 'Open in card browser', icon: 'search', onClick: () => navigate(`browser?deck=${deck.id}`) }, { label: 'Statistics for this set', icon: 'stats', onClick: () => navigate(`stats?deck=${deck.id}`) },
    { separator: true }, { label: 'Print / export terms', icon: 'download', onClick: async () => { const { showExportDialog } = await import('../exporters.js'); showExportDialog(deck); } },
  ], { anchor: inner.querySelector('.terms-head .btn-sm:last-child'), align: 'right' });
  draw();
  updateSettings({ lastDeckId: deck.id });
  const unsub = db.events.on('change', (col) => { if (col === 'notes' || col === 'decks') debouncedDraw(); }); const debouncedDraw = debounce(() => { if (db.decks.has(deck.id)) draw(); }, 300);
  return () => unsub();
}
