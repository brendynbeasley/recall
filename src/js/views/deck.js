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
  { id: 'flashcards', name: 'Flashcards', icon: 'cards', desc: 'Flip through cards at your own pace', color: '#6366f1' },
  { id: 'learn', name: 'Learn', icon: 'brain', desc: 'Adaptive multiple choice and written rounds', color: '#8b5cf6' },
  { id: 'test', name: 'Test', icon: 'edit', desc: 'A graded practice exam you configure', color: '#ec4899' },
  { id: 'write', name: 'Write', icon: 'type', desc: 'Type every answer until you get it right', color: '#f59e0b' },
  { id: 'spell', name: 'Spell', icon: 'volume', desc: 'Listen and type what you hear', color: '#14b8a6' },
  { id: 'review', name: 'Spaced review', icon: 'clock', desc: 'Anki-style scheduling: Again · Hard · Good · Easy', color: '#10b981' },
];
export const GAMES = [
  { id: 'match', name: 'Match', icon: 'grid', desc: 'Pair terms and definitions against the clock', color: '#3b82f6' },
  { id: 'gravity', name: 'Gravity', icon: 'rocket', desc: 'Type answers before the asteroids hit', color: '#f43f5e' },
  { id: 'memory', name: 'Memory', icon: 'puzzle', desc: 'Concentration: find hidden pairs', color: '#a855f7' },
  { id: 'blast', name: 'Blast', icon: 'zap', desc: 'Rapid-fire true/false under time pressure', color: '#f97316' },
];

export function render(main, route) {
  const deck = db.decks.get(route.parts[0]); if (!deck) { navigate('library', { replace: true }); return; }
  const inner = h('div', { class: 'main-inner' }); main.append(inner);
  const prefs = db.getKV('deckViewPrefs', { sort: 'original', starredOnly: false, termsView: 'list' });
  let previewIdx = 0, previewFlipped = false;
  const draw = () => {
    inner.innerHTML = '';
    const notes = deckNotes(deck.id); const pairs = notes.flatMap(n => notePairs(n)); const m = deckMastery(deck.id); const due = dueCounts(deck.id, deck); const dueTotal = due.new + due.learn + due.review; const ret = retentionStats(deck.id, 30);
    // Header
    inner.append(h('div', { class: 'set-head', style: { '--deck-color': deck.color || 'var(--accent)' } },
      h('div', { class: 'set-head-main' }, h('div', { class: 'row', style: { gap: '8px', marginBottom: '6px' } }, deck.folderId && db.folders.get(deck.folderId) ? h('button', { class: 'crumb', onClick: () => navigate(`folder/${deck.folderId}`) }, svgIcon('folder', 13), db.folders.get(deck.folderId).name) : h('button', { class: 'crumb', onClick: () => navigate('library') }, svgIcon('library', 13), 'Library'), h('span', { class: 'faint' }, '/')),
        h('h1', { class: 'set-title' }, h('span', { class: 'set-dot' }), deck.name, deck.pinned ? h('span', { class: 'badge soft', style: { marginLeft: '10px', verticalAlign: 'middle' } }, 'Pinned') : null),
        deck.description ? h('p', { class: 'set-desc' }, deck.description) : null,
        h('div', { class: 'set-meta' }, h('span', { class: 'pill-stat' }, svgIcon('cards', 14), plural(pairs.length, 'card')), h('span', { class: 'pill-stat' }, svgIcon('award', 14), `${Math.round(m.pct * 100)}% mastered`), h('span', { class: 'pill-stat' }, svgIcon('clock', 14), deck.lastStudied ? `Studied ${fmtRelative(deck.lastStudied)}` : 'Not studied yet'), ret.retention != null ? h('span', { class: 'pill-stat' }, svgIcon('target', 14), `${Math.round(ret.retention * 100)}% retention`) : null, h('span', { class: 'pill-stat' }, svgIcon('star', 14), `${notes.filter(n => n.starred).length} starred`))),
      h('div', { class: 'set-head-actions' }, h('button', { class: 'btn', onClick: () => navigate(`edit/${deck.id}`) }, svgIcon('edit', 16), 'Edit'), h('button', { class: 'btn', onClick: () => showDeckOptions(deck, { onSave: () => { draw(); renderSidebar(); } }) }, svgIcon('sliders', 16), 'Options'), h('button', { class: 'btn', onClick: e => deckContextMenu(deck, e) }, svgIcon('more', 16)))));
    // Modes
    const modeTile = (mo, kind) => h('button', { class: 'mode-tile', style: { '--mode-color': mo.color }, onClick: () => { if (!pairs.length) { toast('Add some terms first', 'warning'); return; } navigate(`study/${mo.id}/${deck.id}`); } }, h('div', { class: 'mode-icon' }, svgIcon(mo.icon, 22)), h('div', { class: 'mode-text' }, h('div', { class: 'mode-name' }, mo.name, mo.id === 'review' && dueTotal ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, dueTotal) : null), h('div', { class: 'mode-desc' }, mo.desc)), svgIcon('chevronRight', 16));
    inner.append(h('div', { class: 'modes-section' }, h('div', { class: 'modes-grid stagger' }, ...MODES.map(m => modeTile(m, 'mode'))), h('div', { class: 'games-grid stagger' }, ...GAMES.map(g => modeTile(g, 'game')))));
    // Preview + progress
    const prev = h('div', { class: 'set-preview' });
    if (pairs.length) {
      const p = pairs[Math.min(previewIdx, pairs.length - 1)];
      const face = (side) => h('div', { class: `preview-face ${side}` }, h('div', { class: 'preview-label' }, side === 'front' ? 'Term' : 'Definition'), p[side === 'front' ? 'termImage' : 'defImage'] ? h('img', { src: p[side === 'front' ? 'termImage' : 'defImage'], class: 'preview-img' }) : null, h('div', { class: 'preview-text', html: side === 'front' ? (p.termHtml || escapeHtml(p.term)) : (p.defHtml || escapeHtml(p.definition)) }), h('button', { class: 'icon-btn preview-audio', 'data-tip': 'Play audio', onClick: e => { e.stopPropagation(); speak(side === 'front' ? p.term : p.definition, { lang: side === 'front' ? deck.langFront : deck.langBack }); } }, svgIcon('volume', 16)));
      const card = h('div', { class: `preview-card ${previewFlipped ? 'flipped' : ''}`, onClick: () => { previewFlipped = !previewFlipped; card.classList.toggle('flipped', previewFlipped); } }, h('div', { class: 'preview-inner' }, face('front'), face('back')));
      prev.append(card, h('div', { class: 'preview-nav' }, h('button', { class: 'icon-btn lg', disabled: previewIdx === 0, onClick: () => { previewIdx--; previewFlipped = false; draw(); } }, svgIcon('arrowLeft', 20)), h('span', { class: 'bold' }, `${previewIdx + 1} / ${pairs.length}`), h('button', { class: 'icon-btn lg', disabled: previewIdx >= pairs.length - 1, onClick: () => { previewIdx++; previewFlipped = false; draw(); } }, svgIcon('arrowRight', 20)), h('button', { class: 'btn btn-sm btn-ghost', style: { marginLeft: 'auto' }, onClick: () => navigate(`study/flashcards/${deck.id}`) }, 'Open flashcards', svgIcon('maximize', 14))));
    } else prev.append(h('div', { class: 'empty-state' }, h('h3', {}, 'No terms yet'), h('p', {}, 'Add terms to start studying.'), h('button', { class: 'btn btn-primary', onClick: () => navigate(`edit/${deck.id}`) }, 'Add terms')));
    const progress = h('div', { class: 'panel set-progress' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('activity', 16), 'Progress'), h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate(`stats?deck=${deck.id}`) }, 'Details')),
      h('div', { class: 'row', style: { gap: '20px', alignItems: 'center' } }, donut([{ label: 'Mastered', value: m.mastered, color: 'var(--ok)' }, { label: 'Still learning', value: m.learning, color: 'var(--warn)' }, { label: 'Not studied', value: m.notStudied, color: 'var(--surface-3)' }], { size: 110, stroke: 14, centerLabel: `${Math.round(m.pct * 100)}%`, centerSub: 'mastered' }), h('div', { class: 'col', style: { gap: '6px' } }, legendRow('var(--ok)', 'Mastered', m.mastered), legendRow('var(--warn)', 'Still learning', m.learning), legendRow('var(--border-strong)', 'Not studied', m.notStudied))),
      h('hr'), h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'bold' }, 'Spaced repetition'), h('div', { class: 'small muted' }, dueTotal ? `${due.new} new · ${due.learn} learning · ${due.review} to review` : 'Nothing due right now')), h('button', { class: `btn btn-sm ${dueTotal ? 'btn-primary' : ''}`, onClick: () => navigate(`study/review/${deck.id}`) }, svgIcon('brain', 14), dueTotal ? `Review ${dueTotal}` : 'Study ahead')),
      m.learning + m.notStudied > 0 ? h('button', { class: 'btn btn-block btn-soft', style: { marginTop: '12px' }, onClick: () => navigate(`study/learn/${deck.id}`) }, svgIcon('zap', 14), `Learn the ${m.learning + m.notStudied} you haven't mastered`) : h('div', { class: 'small center', style: { marginTop: '12px', color: 'var(--ok)' } }, '✓ Every card mastered. Keep reviewing to retain it.'));
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
