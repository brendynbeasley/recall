// Card browser: Anki-style search, sortable table, bulk actions, preview
import { db } from '../db.js';
import { deleteNotes, moveNotes, toggleStar, renderCard, normalizeTags, allTags, S, saveSettings } from '../models.js';
import { h, svgIcon, debounce, stripHtml, escapeHtml, fmtDate, plural, fmtInterval } from '../utils.js';
import { showMenu, toast, confirm, prompt, modal, select, segmented, emptyState } from '../ui.js';
import { QUEUE, TYPE, today, suspendCards, buryCards, forgetCards, rescheduleCards, setFlag, setDueDate, cardRetrievability } from '../scheduler.js';
import { navigate } from '../app.js';
import { quickEditNote } from './editor.js';

export const FLAGS = [[1, 'Red', '#ef4444'], [2, 'Orange', '#f97316'], [3, 'Green', '#22c55e'], [4, 'Blue', '#3b82f6'], [5, 'Pink', '#ec4899'], [6, 'Turquoise', '#14b8a6'], [7, 'Purple', '#a855f7']];

// ---------- Search ----------
export function searchCards(query) {
  const terms = tokenize(query); const d = today(); const now = Date.now();
  const deckCache = new Map(); const getDeck = (id) => { if (!deckCache.has(id)) deckCache.set(id, db.decks.get(id)); return deckCache.get(id); };
  return db.cards.filter(c => { const n = db.notes.get(c.noteId); if (!n) return false; return terms.every(t => matchTerm(t, c, n)); });
  function matchTerm(t, c, n) {
    let { neg, key, val } = t; let r;
    if (!key) { const re = wild(val); r = n.fields.some(f => re.test(stripHtml(f))) || n.tags.some(tg => re.test(tg)); }
    else if (key === 'deck') { const dk = getDeck(c.deckId); r = dk && (wild(val).test(dk.name) || dk.id === val); }
    else if (key === 'tag') { r = val === 'none' ? n.tags.length === 0 : n.tags.some(tg => wild(val).test(tg)); }
    else if (key === 'is') { r = ({ due: c.queue === QUEUE.REVIEW && c.due <= d || c.queue === QUEUE.LEARN && c.due <= now, new: c.type === TYPE.NEW, learn: c.type === TYPE.LEARN || c.type === TYPE.RELEARN, review: c.type === TYPE.REVIEW, suspended: c.queue === QUEUE.SUSPENDED, buried: c.queue === QUEUE.BURIED, starred: !!n.starred, leech: n.tags.includes('leech'), mature: c.type === TYPE.REVIEW && c.ivl >= 21, young: c.type === TYPE.REVIEW && c.ivl < 21 })[val] ?? false; }
    else if (key === 'flag') { r = c.flag === parseInt(val, 10); }
    else if (key === 'prop') { const m = /^(ivl|due|reps|lapses|ease|lvl|stability|difficulty)(<=|>=|=|<|>|!=)(-?\d+(?:\.\d+)?)$/.exec(val); if (!m) return !neg; const v = { ivl: c.ivl, due: c.queue === QUEUE.REVIEW ? c.due - d : 9999, reps: c.reps, lapses: c.lapses, ease: (c.factor || 0) / 10, lvl: c.mastery?.level || 0, stability: c.stability || 0, difficulty: c.difficulty || 0 }[m[1]]; const x = parseFloat(m[3]); r = { '<': v < x, '>': v > x, '<=': v <= x, '>=': v >= x, '=': v === x, '!=': v !== x }[m[2]]; }
    else if (key === 'added') { r = n.created >= now - parseInt(val, 10) * 86400000; }
    else if (key === 'rated') { const [days, rating] = val.split(':'); const since = now - parseInt(days, 10) * 86400000; r = db.revlog.find(l => l.cardId === c.id && l.time >= since && (!rating || l.rating === parseInt(rating, 10))) != null; }
    else if (key === 'note' || key === 'type') { const nt = db.notetypes.get(n.notetypeId); r = nt && wild(val).test(nt.name); }
    else if (key === 'card') { r = String(c.ord + 1) === val; }
    else if (key === 'nid') r = n.id === val; else if (key === 'cid') r = c.id === val;
    else { const nt = db.notetypes.get(n.notetypeId); const fi = nt ? nt.fields.findIndex(f => f.toLowerCase() === key) : -1; r = fi >= 0 ? wild(val).test(stripHtml(n.fields[fi] || '')) : false; }
    return neg ? !r : !!r;
  }
}
function tokenize(q) { const out = []; const re = /(-)?(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g; let m; while ((m = re.exec(q || ''))) out.push({ neg: !!m[1], key: m[2] ? m[2].toLowerCase() : null, val: (m[3] ?? m[4] ?? '').trim() }); return out; }
const wildCache = new Map(); function wild(val) { if (!wildCache.has(val)) wildCache.set(val, new RegExp(val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.'), 'i')); return wildCache.get(val); }

// ---------- View ----------
export function render(main, route) {
  const prefs = db.getKV('browserPrefs', { q: '', sort: 'created', dir: -1, mode: 'cards' });
  if (route.query.deck) prefs.q = `deck:"${db.decks.get(route.query.deck)?.name || ''}"`; if (route.query.note) prefs.q = `nid:${route.query.note}`; if (route.query.q) prefs.q = route.query.q;
  let results = [], selected = new Set(), anchor = null, previewCard = null;
  const inner = h('div', { class: 'main-inner wide browser-page' }); main.append(inner);
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search: words, deck:Spanish, tag:verb, is:due, is:suspended, flag:1, prop:ivl>21, added:7, -tag:leech…', value: prefs.q, spellcheck: false });
  const countEl = h('span', { class: 'small muted' });
  const sideFilters = h('div', { class: 'browser-side' });
  const tableWrap = h('div', { class: 'browser-table' });
  const preview = h('div', { class: 'browser-preview' });
  const toolbar = h('div', { class: 'browser-toolbar' },
    h('div', { class: 'search-box grow' }, svgIcon('search', 16), input),
    segmented([{ value: 'cards', label: 'Cards' }, { value: 'notes', label: 'Notes' }], prefs.mode, v => { prefs.mode = v; save(); run(); }),
    h('button', { class: 'btn', onClick: e => actionsMenu(e.currentTarget) }, svgIcon('sliders', 16), 'Actions'),
    h('button', { class: 'btn btn-ghost', 'data-tip': 'Search help', onClick: helpModal }, svgIcon('help', 16)));
  inner.append(toolbar, h('div', { class: 'row between', style: { marginBottom: '8px' } }, countEl, h('span', { class: 'small muted' }, 'Click to select · Shift/Ctrl for multiple · Ctrl+A all · Right-click for actions')), h('div', { class: 'browser-layout' }, sideFilters, tableWrap, preview));
  const save = () => db.setKV('browserPrefs', prefs);
  const COLS = [['sort', 'Sort field'], ['answer', 'Answer'], ['deck', 'Deck'], ['type', 'Card'], ['state', 'State'], ['due', 'Due'], ['interval', 'Interval'], ['ease', 'Ease'], ['reps', 'Reviews'], ['lapses', 'Lapses'], ['retention', 'Recall'], ['tags', 'Tags'], ['created', 'Created']];
  const cellValue = (c, n, col) => { const nt = db.notetypes.get(n.notetypeId); switch (col) {
    case 'sort': return stripHtml(n.fields[0]).slice(0, 80); case 'answer': return stripHtml(n.fields[1] || '').slice(0, 80); case 'deck': return db.decks.get(c.deckId)?.name || '?';
    case 'type': return nt?.kind === 'cloze' ? `Cloze ${c.ord}` : (nt?.templates[c.ord]?.name || 'Card 1'); case 'state': return c.queue === QUEUE.SUSPENDED ? 'Suspended' : c.queue === QUEUE.BURIED ? 'Buried' : ['New', 'Learning', 'Review', 'Relearning'][c.type];
    case 'due': return c.queue === QUEUE.SUSPENDED || c.queue === QUEUE.BURIED ? '—' : c.type === TYPE.NEW ? `New #${c.due}` : (c.queue === QUEUE.LEARN ? fmtDate(c.due, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : fmtDate(Date.now() + (c.due - today()) * 86400000));
    case 'interval': return c.type === TYPE.REVIEW ? fmtInterval(c.ivl) : (c.type === TYPE.NEW ? '(new)' : '(learning)'); case 'ease': return c.type === TYPE.NEW ? '—' : (c.stability ? `S ${c.stability.toFixed(1)} D ${(c.difficulty || 0).toFixed(1)}` : `${Math.round((c.factor || 2500) / 10)}%`);
    case 'reps': return c.reps; case 'lapses': return c.lapses; case 'retention': { const r = cardRetrievability(c); return r == null ? '—' : `${Math.round(r * 100)}%`; } case 'tags': return n.tags.join(' '); case 'created': return fmtDate(n.created); default: return ''; } };
  const sortValue = (c, n, col) => { switch (col) { case 'due': return c.queue < 0 ? 1e15 : c.type === TYPE.NEW ? 1e12 + c.due : c.queue === QUEUE.LEARN ? c.due : c.due * 86400000 + Date.now() - today() * 86400000; case 'interval': return c.ivl; case 'ease': return c.factor; case 'reps': return c.reps; case 'lapses': return c.lapses; case 'created': return n.created; case 'retention': return cardRetrievability(c) ?? -1; default: return cellValue(c, n, col).toLowerCase(); } };
  function run() {
    let cards; try { cards = searchCards(input.value); } catch (e) { cards = []; }
    if (prefs.mode === 'notes') { const seen = new Set(); cards = cards.filter(c => { if (seen.has(c.noteId)) return false; seen.add(c.noteId); return true; }); }
    const col = prefs.sort; cards.sort((a, b) => { const x = sortValue(a, db.notes.get(a.noteId), col), y = sortValue(b, db.notes.get(b.noteId), col); return (x < y ? -1 : x > y ? 1 : 0) * prefs.dir; });
    results = cards; selected = new Set([...selected].filter(id => results.some(c => c.id === id))); drawTable(); drawSide(); countEl.textContent = `${plural(results.length, prefs.mode === 'notes' ? 'note' : 'card')} found${selected.size ? ` · ${selected.size} selected` : ''}`;
  }
  function drawTable() {
    tableWrap.innerHTML = '';
    if (!results.length) { tableWrap.append(emptyState({ icon: 'search', title: 'No cards match', message: 'Try a broader search, or check the syntax with the ? button.' })); return; }
    const cols = S().browser.columns.length ? ['sort', ...S().browser.columns.filter(c => c !== 'sort')] : COLS.map(c => c[0]);
    const table = h('table', { class: 'table' }); const thead = h('tr', {}, ...cols.map(col => h('th', { onClick: () => { if (prefs.sort === col) prefs.dir *= -1; else { prefs.sort = col; prefs.dir = col === 'created' ? -1 : 1; } save(); run(); }, onContextmenu: e => { e.preventDefault(); columnsMenu(e); } }, COLS.find(c => c[0] === col)?.[1] || col, prefs.sort === col ? svgIcon(prefs.dir > 0 ? 'chevronUp' : 'chevronDown', 12) : null)));
    table.append(h('thead', {}, thead)); const tbody = h('tbody'); table.append(tbody);
    const LIMIT = S().browser.pageSize || 100; let shown = 0;
    const renderMore = () => { const slice = results.slice(shown, shown + LIMIT); for (const c of slice) { const n = db.notes.get(c.noteId); const tr = h('tr', { class: `${selected.has(c.id) ? 'selected' : ''} ${c.queue === QUEUE.SUSPENDED ? 'suspended' : ''} ${c.flag ? 'flag-' + c.flag : ''}`, 'data-id': c.id }, ...cols.map(col => h('td', { class: col === 'sort' ? 'bold' : '' }, col === 'sort' && n.starred ? h('span', { style: { color: 'var(--warn)', marginRight: '6px' } }, '★') : null, col === 'tags' ? n.tags.map(t => h('span', { class: 'chip', style: { marginRight: '4px', height: '20px', fontSize: '.7rem' } }, t)) : String(cellValue(c, n, col)))));
      tr.addEventListener('click', e => onRowClick(e, c)); tr.addEventListener('dblclick', () => quickEditNote(n, () => run())); tr.addEventListener('contextmenu', e => { e.preventDefault(); if (!selected.has(c.id)) { selected = new Set([c.id]); anchor = c.id; drawTable(); } showMenu(actionItems(), { x: e.clientX, y: e.clientY }); }); tbody.append(tr); }
      shown += slice.length; moreBtn.classList.toggle('hidden', shown >= results.length); moreBtn.textContent = `Show more (${results.length - shown} remaining)`; };
    const moreBtn = h('button', { class: 'btn btn-block', style: { marginTop: '8px' }, onClick: renderMore }); tableWrap.append(table, moreBtn); renderMore();
    if (selected.size === 1) showPreview(db.cards.get([...selected][0])); else if (!selected.size) preview.innerHTML = '';
  }
  function onRowClick(e, c) {
    const ids = results.map(x => x.id);
    if (e.shiftKey && anchor) { const a = ids.indexOf(anchor), b = ids.indexOf(c.id); const [s, en] = a < b ? [a, b] : [b, a]; if (!e.ctrlKey) selected = new Set(); for (let i = s; i <= en; i++) selected.add(ids[i]); }
    else if (e.ctrlKey || e.metaKey) { if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id); anchor = c.id; }
    else { selected = new Set([c.id]); anchor = c.id; }
    drawTable(); countEl.textContent = `${plural(results.length, 'card')} found · ${selected.size} selected`;
  }
  function showPreview(c) {
    if (!c) return; previewCard = c; const n = db.notes.get(c.noteId); const q = renderCard(c, 'q'), a = renderCard(c, 'a'); const d = db.decks.get(c.deckId);
    preview.innerHTML = ''; preview.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', {}, 'Preview'), h('button', { class: 'btn btn-sm', onClick: () => quickEditNote(n, () => run()) }, svgIcon('edit', 14), 'Edit')),
      h('div', { class: 'preview-side' }, h('div', { class: 'label' }, 'Front'), h('div', { class: 'card-render selectable', html: q.html }), h('style', {}, scopeCss(q.css))), h('div', { class: 'preview-side' }, h('div', { class: 'label' }, 'Back'), h('div', { class: 'card-render selectable', html: a.html })),
      h('hr'), h('div', { class: 'kv' }, kv('Deck', d?.name), kv('State', cellValue(c, n, 'state')), kv('Due', cellValue(c, n, 'due')), kv('Interval', cellValue(c, n, 'interval')), kv('Ease', cellValue(c, n, 'ease')), kv('Reviews', c.reps), kv('Lapses', c.lapses), kv('Mastery', ['Not studied', 'Still learning', 'Familiar', 'Mastered'][c.mastery?.level || 0]), kv('Created', fmtDate(n.created)), kv('Card ID', c.id)),
      h('div', { class: 'label', style: { marginTop: '12px' } }, 'Review history'), h('div', { class: 'revlog-list' }, ...db.revlog.filter(r => r.cardId === c.id).sort((a, b) => b.time - a.time).slice(0, 20).map(r => h('div', { class: 'revlog-row' }, h('span', { class: `rating r${r.rating}` }, ['', 'Again', 'Hard', 'Good', 'Easy'][r.rating] || '?'), h('span', { class: 'muted' }, fmtDate(r.time, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('span', {}, r.ivl > 0 ? fmtInterval(r.ivl) : `${-r.ivl}m`), h('span', { class: 'muted' }, `${Math.round((r.took || 0) / 1000)}s`))), db.revlog.find(r => r.cardId === c.id) ? null : h('span', { class: 'small muted' }, 'No reviews yet'))));
  }
  const kv = (k, v) => h('div', { class: 'kv-row' }, h('span', { class: 'muted' }, k), h('span', { class: 'selectable' }, String(v ?? '—')));
  function drawSide() {
    sideFilters.innerHTML = '';
    const addTerm = (t) => { const cur = input.value.trim(); input.value = cur.includes(t) ? cur.replace(t, '').replace(/\s+/g, ' ').trim() : (cur ? cur + ' ' + t : t); run(); };
    const section = (title, items) => sideFilters.append(h('div', { class: 'side-section' }, h('div', { class: 'side-title' }, title), ...items.map(it => h('button', { class: `side-item ${input.value.includes(it.term) ? 'active' : ''}`, onClick: () => addTerm(it.term) }, it.icon ? svgIcon(it.icon, 14) : null, h('span', { class: 'grow ellipsis' }, it.label), it.count != null ? h('span', { class: 'tiny muted' }, it.count) : null))));
    section('State', [{ label: 'Due', term: 'is:due', icon: 'clock' }, { label: 'New', term: 'is:new', icon: 'sparkles' }, { label: 'Learning', term: 'is:learn', icon: 'zap' }, { label: 'Review', term: 'is:review', icon: 'refresh' }, { label: 'Suspended', term: 'is:suspended', icon: 'pause' }, { label: 'Buried', term: 'is:buried', icon: 'archive' }, { label: 'Starred', term: 'is:starred', icon: 'star' }, { label: 'Leeches', term: 'tag:leech', icon: 'alert' }, { label: 'Mature', term: 'is:mature', icon: 'award' }]);
    section('Flags', FLAGS.map(([n, name, color]) => ({ label: name, term: `flag:${n}`, count: db.cards.filter(c => c.flag === n).length })).filter(f => f.count));
    section('Decks', db.decks.all().sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ label: d.name, term: `deck:"${d.name}"`, icon: 'cards', count: db.cards.filter(c => c.deckId === d.id).length })));
    section('Tags', allTags().slice(0, 40).map(([t, n]) => ({ label: t, term: `tag:${t}`, icon: 'tag', count: n })));
  }
  // ---- Actions ----
  const selCards = () => [...selected].map(id => db.cards.get(id)).filter(Boolean);
  const selNotes = () => [...new Set(selCards().map(c => c.noteId))].map(id => db.notes.get(id)).filter(Boolean);
  const actionItems = () => { const cs = selCards(); const ns = selNotes(); const none = !cs.length; return [
    { header: `${cs.length} selected` },
    { label: 'Edit', icon: 'edit', disabled: cs.length !== 1, onClick: () => quickEditNote(ns[0], () => run()) },
    { label: 'Open set', icon: 'cards', disabled: cs.length !== 1, onClick: () => navigate(`set/${cs[0].deckId}`) },
    { label: 'Preview / study these', icon: 'play', disabled: none, onClick: () => { db.setKV('customStudy', { cardIds: cs.map(c => c.id), name: `Browser selection (${cs.length})` }); navigate('study/review/custom'); } },
    { separator: true },
    { label: 'Toggle suspend', icon: 'pause', disabled: none, shortcut: '@', onClick: () => { const allSusp = cs.every(c => c.queue === QUEUE.SUSPENDED); suspendCards(cs, !allSusp); run(); toast(allSusp ? 'Unsuspended' : 'Suspended', 'info'); } },
    { label: 'Toggle bury', icon: 'archive', disabled: none, onClick: () => { const all = cs.every(c => c.queue === QUEUE.BURIED); buryCards(cs, !all); run(); } },
    { label: 'Toggle star', icon: 'star', disabled: none, onClick: () => { const all = ns.every(n => n.starred); ns.forEach(n => toggleStar(n, !all)); run(); } },
    { label: 'Flag', icon: 'flag', disabled: none, submenu: [{ label: 'No flag', onClick: () => { setFlag(cs, 0); run(); } }, ...FLAGS.map(([n, name, color]) => ({ label: name, color, onClick: () => { setFlag(cs, n); run(); } }))] },
    { separator: true },
    { label: 'Move to set…', icon: 'folder', disabled: none, onClick: async () => { const opts = db.decks.all().map(d => ({ value: d.id, label: d.name })); let v = opts[0]?.value; const m = modal({ title: 'Move to set', size: 'sm', content: select(opts, v, x => { v = x; }), actions: [{ label: 'Cancel' }, { label: 'Move', variant: 'primary', onClick: () => { moveNotes(ns.map(n => n.id), v); toast(`Moved ${ns.length} notes`, 'success'); run(); return true; } }] }); } },
    { label: 'Add tags…', icon: 'tag', disabled: none, onClick: async () => { const v = await prompt('', { title: 'Add tags', placeholder: 'tag1 tag2' }); if (!v) return; const tags = normalizeTags(v.split(/[\s,]+/)); ns.forEach(n => { n.tags = normalizeTags([...n.tags, ...tags]); db.notes.put(n); }); run(); } },
    { label: 'Remove tags…', icon: 'tag', disabled: none, onClick: async () => { const v = await prompt('', { title: 'Remove tags', placeholder: 'tag1 tag2' }); if (!v) return; const tags = new Set(normalizeTags(v.split(/[\s,]+/))); ns.forEach(n => { n.tags = n.tags.filter(t => !tags.has(t)); db.notes.put(n); }); run(); } },
    { separator: true },
    { label: 'Reset to new (forget)', icon: 'refresh', disabled: none, onClick: async () => { if (await confirm(`Reset ${cs.length} card(s) to new? Review history is kept.`)) { forgetCards(cs); run(); } } },
    { label: 'Set due date…', icon: 'calendar', disabled: none, onClick: async () => { const v = await prompt('Days from today (0 = today). Cards become review cards.', { title: 'Set due date', value: '0' }); if (v == null) return; setDueDate(cs, Math.max(0, parseInt(v, 10) || 0)); run(); } },
    { label: 'Reschedule interval…', icon: 'clock', disabled: none, onClick: async () => { const v = await prompt('New interval in days', { title: 'Reschedule', value: '7' }); if (v == null) return; rescheduleCards(cs, Math.max(1, parseInt(v, 10) || 1)); run(); } },
    { separator: true },
    { label: 'Select all', icon: 'check', shortcut: 'Ctrl+A', onClick: () => { selected = new Set(results.map(c => c.id)); drawTable(); } },
    { label: 'Delete notes', icon: 'trash', danger: true, disabled: none, onClick: async () => { if (await confirm(`Delete ${ns.length} note(s) and all their cards?`, { danger: true, okLabel: 'Delete' })) { deleteNotes(ns.map(n => n.id)); selected.clear(); run(); toast('Deleted', 'info'); } } },
  ]; };
  const actionsMenu = (anchorEl) => showMenu(actionItems(), { anchor: anchorEl, align: 'right' });
  const columnsMenu = (e) => showMenu([{ header: 'Columns' }, ...COLS.filter(c => c[0] !== 'sort').map(([id, label]) => ({ label, checked: S().browser.columns.includes(id), onClick: () => { const cols = S().browser.columns; const i = cols.indexOf(id); if (i >= 0) cols.splice(i, 1); else cols.push(id); saveSettings(); drawTable(); } }))], { x: e.clientX, y: e.clientY });
  function helpModal() { modal({ title: 'Search syntax', size: 'md', content: h('div', { class: 'help-grid' }, ...[['dog', 'cards containing "dog" in any field'], ['"to be"', 'exact phrase'], ['d*g', 'wildcard'], ['-dog', 'exclude'], ['deck:Spanish', 'in a set (wildcards ok)'], ['tag:verb', 'has tag (tag:none for untagged)'], ['is:due', 'due now · is:new · is:learn · is:review · is:suspended · is:buried · is:starred · is:mature · is:young · is:leech'], ['flag:1', 'flagged red (1–7)'], ['prop:ivl>21', 'interval > 21 days · prop:due<=0 · prop:reps>5 · prop:lapses>3 · prop:ease<200 · prop:lvl=3'], ['added:7', 'added in the last 7 days'], ['rated:1', 'reviewed in the last 1 day · rated:7:1 = answered Again in 7 days'], ['term:hola', 'search a specific field by name'], ['note:Cloze', 'by card type'], ['card:2', 'card number within the note']].map(([k, v]) => h('div', { class: 'help-row' }, h('code', {}, k), h('span', {}, v)))) }); }
  input.addEventListener('input', debounce(() => { prefs.q = input.value; save(); run(); }, 150));
  const onKey = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return; const mod = e.ctrlKey || e.metaKey; if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selected = new Set(results.map(c => c.id)); drawTable(); } else if (e.key === '@') { const cs = selCards(); if (cs.length) { suspendCards(cs, !cs.every(c => c.queue === QUEUE.SUSPENDED)); run(); } } else if (e.key === 'Delete') { const ns = selNotes(); if (ns.length) confirm(`Delete ${ns.length} note(s)?`, { danger: true, okLabel: 'Delete' }).then(ok => { if (ok) { deleteNotes(ns.map(n => n.id)); selected.clear(); run(); } }); } else if (e.key === 'Enter' && selected.size === 1) { quickEditNote(selNotes()[0], () => run()); } else if (mod && /^[1-7]$/.test(e.key)) { e.preventDefault(); const cs = selCards(); if (cs.length) { const f = parseInt(e.key, 10); setFlag(cs, cs.every(c => c.flag === f) ? 0 : f); run(); } } };
  document.addEventListener('keydown', onKey);
  run();
  return () => document.removeEventListener('keydown', onKey);
}
function scopeCss(css) { return (css || '').replace(/(^|\})\s*([^{}]+)\{/g, (m, a, sel) => `${a} ${sel.split(',').map(s => '.card-render ' + s.trim().replace(/^\.card\b/, '')).join(',')}{`); }
