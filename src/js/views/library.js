// Library: all sets and folders
import { db } from '../db.js';
import { deckNotes, createFolder, deleteFolder, updateDeck, S, updateSettings } from '../models.js';
import { h, svgIcon, debounce, plural } from '../utils.js';
import { pageHeader, segmented, prompt, confirm, toast, showMenu, emptyState, colorPicker, modal } from '../ui.js';
import { navigate, createSetFlow, renderSidebar, deckContextMenu } from '../app.js';
import { deckCard, deckMastery } from './common.js';
import { dueCounts } from '../scheduler.js';
import { showImportDialog } from '../importers.js';

export function render(main, route) {
  const folderId = route.name === 'folder' ? route.parts[0] : null; const folder = folderId ? db.folders.get(folderId) : null;
  if (folderId && !folder) { navigate('library', { replace: true }); return; }
  const prefs = db.getKV('libraryPrefs', { view: 'grid', sort: 'recent', q: '', tab: 'sets' });
  const inner = h('div', { class: 'main-inner' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Filter sets…', value: prefs.q || '' });
  const actions = [];
  if (folder) actions.push(h('button', { class: 'btn', onClick: () => folderMenu(folder) }, svgIcon('moreV', 16), 'Folder'));
  actions.push(h('button', { class: 'btn', onClick: () => showImportDialog({ folderId }) }, svgIcon('upload', 16), 'Import'), h('button', { class: 'btn btn-primary', onClick: () => folderId ? navigate(`new?folder=${folderId}`) : createSetFlow() }, svgIcon('plus', 16), 'Create'));
  inner.append(pageHeader(folder ? folder.name : 'Library', folder ? `${plural(db.decks.filter(d => d.folderId === folderId).length, 'set')} in this folder` : `${plural(db.decks.filter(d => !d.archived).length, 'set')} · ${plural(db.notes.size, 'term')} · ${plural(db.folders.size, 'folder')}`, ...actions));
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'search-box grow', style: { maxWidth: '360px' } }, svgIcon('search', 16), search),
    h('select', { class: 'input select', onChange: e => { prefs.sort = e.target.value; save(); draw(); } }, ...[['recent', 'Recently studied'], ['name', 'Name A–Z'], ['created', 'Newest'], ['terms', 'Most terms'], ['due', 'Most due'], ['mastery', 'Least mastered']].map(([v, l]) => h('option', { value: v, selected: prefs.sort === v }, l))),
    segmented([{ value: 'grid', icon: 'grid', tip: 'Grid' }, { value: 'list', icon: 'list', tip: 'List' }], prefs.view, v => { prefs.view = v; save(); draw(); }));
  inner.append(toolbar);
  const content = h('div', {}); inner.append(content);
  const save = () => db.setKV('libraryPrefs', prefs);
  const draw = () => {
    content.innerHTML = ''; const q = (prefs.q || '').toLowerCase();
    let decks = db.decks.filter(d => !d.archived && (folderId ? d.folderId === folderId : true) && (!q || d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q)));
    const sorters = { recent: (a, b) => (b.lastStudied || b.created) - (a.lastStudied || a.created), name: (a, b) => a.name.localeCompare(b.name), created: (a, b) => b.created - a.created, terms: (a, b) => deckNotes(b.id).length - deckNotes(a.id).length, due: (a, b) => { const x = dueCounts(b.id, b), y = dueCounts(a.id, a); return (x.new + x.learn + x.review) - (y.new + y.learn + y.review); }, mastery: (a, b) => deckMastery(a.id).pct - deckMastery(b.id).pct };
    decks.sort(sorters[prefs.sort] || sorters.recent);
    if (!folderId && !q) {
      const folders = db.folders.all().sort((a, b) => a.name.localeCompare(b.name));
      if (folders.length) { content.append(h('h2', { class: 'section-title' }, 'Folders')); content.append(h('div', { class: 'folder-grid stagger' }, ...folders.map(f => { const kids = db.decks.filter(d => d.folderId === f.id && !d.archived); return h('div', { class: 'folder-card', style: { '--deck-color': f.color || 'var(--accent)' }, onClick: () => navigate(`folder/${f.id}`), onContextmenu: e => { e.preventDefault(); folderMenu(f, e); } }, h('div', { class: 'folder-icon' }, svgIcon('folder', 22)), h('div', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, f.name), h('div', { class: 'small muted' }, `${plural(kids.length, 'set')} · ${plural(kids.reduce((a, d) => a + deckNotes(d.id).length, 0), 'term')}`)), svgIcon('chevronRight', 16)); }))); content.append(h('h2', { class: 'section-title' }, 'All sets')); }
    }
    if (!decks.length) { content.append(emptyState({ icon: 'library', title: q ? 'No sets match your search' : 'No sets here yet', message: q ? 'Try a different search term.' : 'Create a set from scratch or import one from Quizlet, Anki or a spreadsheet.', action: () => q ? (search.value = '', prefs.q = '', draw()) : createSetFlow(), actionLabel: q ? 'Clear search' : 'Create a set' })); return; }
    if (prefs.view === 'grid') content.append(h('div', { class: 'grid-auto stagger' }, ...decks.map(d => deckCard(d))));
    else {
      const table = h('div', { class: 'deck-list stagger' });
      for (const d of decks) { const m = deckMastery(d.id); const c = dueCounts(d.id, d); const due = c.new + c.learn + c.review;
        const row = h('div', { class: 'deck-row', onClick: () => navigate(`set/${d.id}`) }, h('span', { class: 'dot', style: { background: d.color || 'var(--accent)' } }), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'bold ellipsis' }, d.name), h('div', { class: 'small muted ellipsis' }, d.description || `${plural(deckNotes(d.id).length, 'term')}`)), h('div', { class: 'deck-row-stat' }, h('b', {}, deckNotes(d.id).length), h('span', {}, 'terms')), h('div', { class: 'deck-row-stat' }, h('b', {}, `${Math.round(m.pct * 100)}%`), h('span', {}, 'mastered')), h('div', { class: 'deck-row-stat' }, h('b', { style: { color: due ? 'var(--accent)' : '' } }, due), h('span', {}, 'due')), h('div', { class: 'progress thin', style: { width: '120px' } }, h('div', { class: 'progress-fill', style: { width: `${m.progress * 100}%` } })), h('button', { class: 'icon-btn sm', onClick: e => { e.stopPropagation(); deckContextMenu(d, e); } }, svgIcon('moreV', 16)));
        row.addEventListener('contextmenu', e => { e.preventDefault(); deckContextMenu(d, e); }); table.append(row); }
      content.append(table);
    }
    const archived = db.decks.filter(d => d.archived && (folderId ? d.folderId === folderId : true));
    if (archived.length && !q) content.append(h('details', { class: 'archived-box' }, h('summary', {}, `${plural(archived.length, 'archived set')}`), h('div', { class: 'grid-auto', style: { marginTop: '12px' } }, ...archived.map(d => deckCard(d, { compact: true })))));
  };
  search.addEventListener('input', debounce(() => { prefs.q = search.value; save(); draw(); }, 120));
  draw(); main.append(inner);
  async function folderMenu(f, e) {
    const items = [
      { label: 'Rename', icon: 'edit', onClick: async () => { const n = await prompt('', { title: 'Rename folder', value: f.name }); if (n) { f.name = n; db.folders.put(f); renderSidebar(); navigate(`folder/${f.id}`, { replace: true }); draw(); } } },
      { label: 'Colour', icon: 'palette', onClick: () => { const m = modal({ title: 'Folder colour', size: 'sm', content: colorPicker(f.color, c => { f.color = c; db.folders.put(f); renderSidebar(); draw(); }) }); } },
      { label: 'New set in folder', icon: 'plus', onClick: () => navigate(`new?folder=${f.id}`) },
      { separator: true },
      { label: 'Delete folder (keep sets)', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this folder? Its sets will be moved out, not deleted.', { danger: true, okLabel: 'Delete' })) { deleteFolder(f.id); renderSidebar(); toast('Folder deleted'); navigate('library'); } } },
      { label: 'Delete folder and sets', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this folder AND every set inside it? This cannot be undone.', { danger: true, okLabel: 'Delete all' })) { deleteFolder(f.id, { deleteDecks: true }); renderSidebar(); toast('Folder and sets deleted'); navigate('library'); } } },
    ];
    showMenu(items, e ? { x: e.clientX, y: e.clientY } : { anchor: inner.querySelector('.page-actions .btn') });
  }
}
