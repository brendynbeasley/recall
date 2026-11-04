// Library: every set and folder.
//
// Information design
//  - The header carries the totals, and today's due count. A due count is the one number that asks for action.
//  - Filters are counts, not just labels ("Due 3"). An empty filter is dimmed in place, not hidden, so
//    the controls never shift under your finger.
//  - A card's primary action is contextual and carries its own number: "Review 20" when cards are due,
//    "Study" when caught up, "Add terms" when the set is empty. The due count lives on the thing you tap.
//  - Titles get two lines before truncating; chapter names like "Ch 3 · Financial Instruments" need it.
//  - Folders show what's inside: the colours of their first sets fan out of the pocket.
//
// Motion (all transform/opacity; honours Reduce motion)
//  - Entrance: the page rises in layers (header, toolbar, folders), then cards arrive in a diagonal wave
//    across the grid, each mastery ring drawing and its percentage counting up as it lands.
//  - Search, filter and sort reflow with FLIP: surviving cards glide to their new slots on a spring,
//    new ones bloom in, leaving ones dissolve in place.
//  - Grid/list swap is a quick fade-through so the layout change never tears.
//  - Segmented controls have a thumb that glides between options.
//  - Touch: press-and-hold a card or folder for its menu (with a haptic tick).
import { db } from '../db.js';
import { deckNotes, deleteFolder } from '../models.js';
import { h, svgIcon, debounce, plural, fmtRelative } from '../utils.js';
import { prompt, confirm, toast, showMenu, colorPicker, modal } from '../ui.js';
import { navigate, createSetFlow, renderSidebar, deckContextMenu } from '../app.js';
import { deckMastery } from './common.js';
import { dueCounts } from '../scheduler.js';
import { showImportDialog } from '../importers.js';

const SORTS = [['recent', 'Recently studied', 'Recent'], ['due', 'Most due', 'Due'], ['name', 'Name', 'Name'], ['created', 'Newest', 'Newest'], ['terms', 'Most terms', 'Size'], ['mastery', 'Least mastered', 'Mastery']];
const FILTERS = [['all', 'All'], ['due', 'Due'], ['new', 'Not started'], ['learning', 'Learning'], ['mastered', 'Mastered']];
const SPRING = 'cubic-bezier(.2, .9, .25, 1.04)';
const OUT = 'cubic-bezier(.16, 1, .3, 1)';
const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = () => { try { navigator.vibrate?.(8); } catch (e) { /* unsupported */ } };

// Small, purpose-drawn glyphs (24 grid, 1.75 stroke) so the toolbar reads as one family.
const GL = {
  search: '<circle cx="11" cy="11" r="6.25"/><path d="m15.6 15.6 4.4 4.4"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  sort: '<path d="M7 5v14M4 8l3-3 3 3M17 19V5M14 16l3 3 3-3"/>',
  chevDown: '<path d="m7 10 5 5 5-5"/>',
  chevLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevRight: '<path d="m9.5 6 6 6-6 6"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.75"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.75"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.75"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75"/>',
  list: '<rect x="4" y="5" width="16" height="5" rx="1.75"/><rect x="4" y="14" width="16" height="5" rx="1.75"/>',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  upload: '<path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  review: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4"/>',
  play: '<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.8-6.2a.8.8 0 0 0 0-1.4L9.2 5.1A.8.8 0 0 0 8 5.8z" fill="currentColor" stroke="none"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
};
function gl(name, size = 18, extra = '') {
  const s = document.createElement('span'); s.className = `lb-gl ${extra}`;
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GL[name]}</svg>`;
  return s;
}

export function render(main, route) {
  const folderId = route.name === 'folder' ? route.parts[0] : null; const folder = folderId ? db.folders.get(folderId) : null;
  if (folderId && !folder) { navigate('library', { replace: true }); return; }
  const prefs = db.getKV('libraryPrefs', { view: 'grid', sort: 'recent', q: '' });
  prefs.filter = FILTERS.some(f => f[0] === prefs.filter) ? prefs.filter : 'all';
  const save = () => db.setKV('libraryPrefs', prefs);

  // ---------- data (computed once per render; dueCounts is the expensive part) ----------
  const scope = db.decks.filter(d => !d.archived && (folderId ? d.folderId === folderId : true));
  const stats = new Map();
  const statOf = d => {
    let s = stats.get(d.id); if (s) return s;
    let due = 0; try { const c = dueCounts(d.id, d); due = c.new + c.learn + c.review; } catch (e) { /* unscheduled */ }
    const m = deckMastery(d.id); const n = deckNotes(d.id).length;
    const state = !m.total ? 'empty' : m.mastered === m.total ? 'mastered' : m.notStudied === m.total ? 'new' : 'learning';
    s = { due, m, n, state }; stats.set(d.id, s); return s;
  };
  scope.forEach(statOf);
  const totalDue = scope.reduce((a, d) => a + statOf(d).due, 0);
  const matchesFilter = (d, f) => { const s = statOf(d); return f === 'all' || (f === 'due' ? s.due > 0 : s.state === f); };

  const inner = h('div', { class: 'main-inner lb' });

  // ---------- header ----------
  const subBits = folder
    ? [plural(scope.length, 'set'), plural(scope.reduce((a, d) => a + statOf(d).n, 0), 'term')]
    : [plural(scope.length, 'set'), plural(db.notes.size, 'term'), plural(db.folders.size, 'folder')];
  const sub = h('p', { class: 'lb-sub' }, ...subBits.flatMap((t, i) => [i ? h('span', { class: 'lb-sep', 'aria-hidden': 'true' }) : null, h('span', {}, t)]),
    totalDue ? h('span', { class: 'lb-sep', 'aria-hidden': 'true' }) : null,
    totalDue ? h('span', { class: 'lb-sub-due' }, h('i', { 'aria-hidden': 'true' }), `${totalDue} due`) : null);
  const actions = h('div', { class: 'lb-actions' },
    folder ? h('button', { type: 'button', class: 'lb-btn lb-btn-quiet lb-icon-only', 'aria-label': 'Folder options', onClick: e => folderMenu(folder, null, e.currentTarget) }, gl('more', 20)) : null,
    h('button', { type: 'button', class: 'lb-btn lb-btn-quiet', onClick: () => showImportDialog({ folderId }) }, gl('upload', 17), h('span', {}, 'Import')),
    h('button', { type: 'button', class: 'lb-btn lb-btn-primary lb-new', onClick: () => folderId ? navigate(`new?folder=${folderId}`) : createSetFlow() }, gl('plus', 17), h('span', {}, 'New set')));
  inner.append(h('header', { class: 'lb-head lb-in', style: { '--i': 0 } },
    h('div', { class: 'lb-head-text' },
      folder ? h('button', { type: 'button', class: 'lb-back', onClick: () => navigate('library') }, gl('chevLeft', 18), 'Library') : null,
      h('h1', { class: 'page-title lb-title' }, folder ? h('span', { class: 'lb-title-dot', style: { '--c': folder.color || 'var(--accent)' }, 'aria-hidden': 'true' }) : null, folder ? folder.name : 'Library'),
      sub),
    actions));

  // ---------- toolbar ----------
  const search = h('input', { class: 'lb-search-input', type: 'search', placeholder: folder ? `Search ${folder.name}` : 'Search sets', value: prefs.q || '', 'aria-label': 'Search sets', enterkeyhint: 'search', autocomplete: 'off', spellcheck: false });
  const clear = h('button', { type: 'button', class: 'lb-search-clear', 'aria-label': 'Clear search', tabindex: -1, onClick: () => { search.value = ''; prefs.q = ''; save(); syncClear(); draw(); search.focus(); } }, gl('x', 14));
  const syncClear = () => clear.classList.toggle('show', !!search.value);
  const searchBox = h('label', { class: 'lb-search' }, gl('search', 17), search, clear, h('kbd', { class: 'lb-kbd', 'aria-hidden': 'true' }, '/'));
  syncClear();

  const filterSeg = seg(FILTERS.map(([v, l]) => ({ value: v, label: l, count: 0 })), prefs.filter, v => { prefs.filter = v; save(); draw(); }, { className: 'lb-filters', label: 'Filter sets' });
  const sortLbl = h('span', { class: 'lb-pill-lbl' }, (SORTS.find(s => s[0] === prefs.sort) || SORTS[0])[2]);
  const sortBtn = h('button', { type: 'button', class: 'lb-pill', 'aria-haspopup': 'menu', 'aria-label': 'Sort sets', title: 'Sort', onClick: () => {
    sortBtn.classList.add('open');
    const m = showMenu([{ header: 'Sort by' }, ...SORTS.map(([v, l, short]) => ({ label: l, checked: prefs.sort === v, onClick: () => { prefs.sort = v; sortLbl.textContent = short; save(); draw(); } }))], { anchor: sortBtn, align: 'right', minWidth: 210 });
    new MutationObserver((_, o) => { if (!m.isConnected) { sortBtn.classList.remove('open'); o.disconnect(); } }).observe(document.body, { childList: true });
  } }, gl('sort', 16), sortLbl, gl('chevDown', 14, 'lb-pill-chev'));
  const viewSeg = seg([{ value: 'grid', icon: gl('grid', 17), aria: 'Grid view' }, { value: 'list', icon: gl('list', 17), aria: 'List view' }], prefs.view, v => { prefs.view = v; save(); draw({ morph: true }); }, { className: 'lb-view', label: 'Layout' });
  inner.append(h('div', { class: 'lb-bar lb-in', style: { '--i': 1 } },
    searchBox, h('div', { class: 'lb-filters-scroll' }, filterSeg), h('div', { class: 'lb-bar-end' }, sortBtn, viewSeg)));

  // ---------- folders ----------
  const folders = folder ? [] : db.folders.all().sort((a, b) => a.name.localeCompare(b.name));
  let folderSec = null;
  if (folders.length) {
    folderSec = h('section', { class: 'lb-collapse lb-in', style: { '--i': 2 }, 'aria-label': 'Folders' },
      h('div', { class: 'lb-collapse-inner' },
        h('div', { class: 'lb-sec-head' }, h('h2', { class: 'lb-sec-title' }, 'Folders'), h('span', { class: 'lb-sec-count' }, folders.length)),
        h('div', { class: 'lb-folders' }, ...folders.map(folderCard))));
    inner.append(folderSec);
  }

  // ---------- sets ----------
  const setTitle = h('h2', { class: 'lb-sec-title' }, 'Sets'); const setCount = h('span', { class: 'lb-sec-count' });
  const grid = h('div', { class: 'lb-grid', role: 'list' });
  const empty = h('div', { class: 'lb-empty-slot' });
  inner.append(h('section', { class: 'lb-sets', 'aria-label': 'Sets' }, h('div', { class: 'lb-sec-head lb-in', style: { '--i': folders.length ? 3 : 2 } }, setTitle, setCount), grid, empty));

  const archived = db.decks.filter(d => d.archived && (folderId ? d.folderId === folderId : true));
  if (archived.length) {
    const det = h('details', { class: 'lb-archived' }, h('summary', {}, gl('chevRight', 15, 'lb-arch-chev'), plural(archived.length, 'archived set')),
      h('div', { class: 'lb-grid is-list lb-arch-list' }, ...archived.map(d => card(d, { archived: true }))));
    inner.append(det);
  }

  // ---------- cards ----------
  const cache = new Map();
  function card(d, { archived: isArch = false } = {}) {
    if (!isArch && cache.has(d.id)) return cache.get(d.id);
    const s = statOf(d); const pct = Math.round(s.m.pct * 100);
    const open = () => navigate(`set/${d.id}`);
    const meta = [plural(s.n, 'term'), d.lastStudied ? fmtRelative(d.lastStudied) : 'Not studied yet'];
    const primary = s.due
      ? h('button', { type: 'button', class: 'lb-btn lb-btn-primary lb-sm', onClick: e => { e.stopPropagation(); navigate(`study/review/${d.id}`); } }, gl('review', 15), h('span', {}, 'Review'), h('span', { class: 'lb-count' }, s.due > 999 ? '999+' : s.due))
      : s.n
        ? h('button', { type: 'button', class: 'lb-btn lb-btn-tonal lb-sm', onClick: e => { e.stopPropagation(); navigate(`study/flashcards/${d.id}`); } }, gl('play', 14), h('span', {}, 'Study'))
        : h('button', { type: 'button', class: 'lb-btn lb-btn-tonal lb-sm', onClick: e => { e.stopPropagation(); navigate(`edit/${d.id}`); } }, gl('pen', 15), h('span', {}, 'Add terms'));
    const quiet = s.n ? [
      h('button', { type: 'button', class: 'lb-btn lb-btn-quiet lb-sm lb-secondary', onClick: e => { e.stopPropagation(); navigate(`study/learn/${d.id}`); } }, 'Learn'),
      h('button', { type: 'button', class: 'lb-btn lb-btn-quiet lb-sm lb-secondary', onClick: e => { e.stopPropagation(); navigate(`study/match/${d.id}`); } }, 'Match')] : [];
    const stateLbl = { empty: 'No cards yet', new: 'Not started', mastered: 'All mastered', learning: `${s.m.mastered} of ${s.m.total} mastered` }[s.state];
    const el = h('article', {
      class: `lb-card is-${s.state} ${s.due ? 'has-due' : ''} ${isArch ? 'is-archived' : ''}`, role: 'listitem', tabindex: 0, 'data-id': d.id,
      style: { '--c': d.color || 'var(--accent)' },
      'aria-label': `${d.name}. ${plural(s.n, 'term')}, ${pct}% mastered${s.due ? `, ${s.due} due` : ''}.`,
      onClick: open, onKeydown: e => { if (e.key === 'Enter' && e.target === el) open(); },
      onContextmenu: e => { e.preventDefault(); deckContextMenu(d, e); } },
      h('div', { class: 'lb-card-tint', 'aria-hidden': 'true' }),
      h('div', { class: 'lb-card-head' },
        h('div', { class: 'lb-glyph', 'aria-hidden': 'true' }, svgIcon(d.icon || 'cards', 19)),
        h('div', { class: 'lb-card-titles' }, h('h3', { class: 'lb-card-name' }, d.name), h('p', { class: 'lb-card-meta' }, meta.join(' · '))),
        h('button', { type: 'button', class: 'lb-more', 'aria-label': `Options for ${d.name}`, onClick: e => { e.stopPropagation(); deckContextMenu(d, e); } }, gl('more', 18))),
      d.description ? h('p', { class: 'lb-card-desc' }, d.description) : h('p', { class: 'lb-card-desc is-empty', 'aria-hidden': 'true' }),
      h('div', { class: 'lb-card-foot' },
        h('div', { class: 'lb-mastery' }, ring(s.m), h('div', { class: 'lb-mastery-txt' }, h('b', {}, h('span', { class: 'lb-num', 'data-to': pct }, pct), '%'), h('span', {}, stateLbl))),
        h('div', { class: 'lb-card-actions' }, primary, ...quiet)));
    if (!isArch) cache.set(d.id, el);
    return el;
  }
  function ring(m) {
    const R = 15, C = 2 * Math.PI * R; const t = m.total || 1;
    const lm = C * m.mastered / t, ll = C * m.learning / t;
    const el = h('div', { class: 'lb-ring', 'aria-hidden': 'true' });
    el.innerHTML = `<svg viewBox="0 0 38 38" width="38" height="38"><circle class="lb-ring-track" cx="19" cy="19" r="${R}"/>`
      + (ll > .1 ? `<circle class="lb-ring-learn" cx="19" cy="19" r="${R}" stroke-dasharray="${ll.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-lm).toFixed(2)}"/>` : '')
      + (lm > .1 ? `<circle class="lb-ring-done" cx="19" cy="19" r="${R}" stroke-dasharray="${lm.toFixed(2)} ${C.toFixed(2)}"/>` : '') + '</svg>';
    return el;
  }
  function folderCard(f) {
    const kids = db.decks.filter(d => d.folderId === f.id && !d.archived);
    const terms = kids.reduce((a, d) => a + deckNotes(d.id).length, 0);
    const due = kids.reduce((a, d) => { try { const c = dueCounts(d.id, d); return a + c.new + c.learn + c.review; } catch (e) { return a; } }, 0);
    const peek = kids.slice(0, 3);
    return h('button', { type: 'button', class: 'lb-folder', style: { '--c': f.color || 'var(--accent)' }, 'data-fid': f.id,
      'aria-label': `${f.name} folder, ${plural(kids.length, 'set')}${due ? `, ${due} due` : ''}`,
      onClick: () => navigate(`folder/${f.id}`), onContextmenu: e => { e.preventDefault(); folderMenu(f, e); } },
      h('span', { class: 'lb-fart', 'aria-hidden': 'true' },
        h('i', { class: 'lb-fart-back' }),
        ...(peek.length ? peek : [null]).map((k, i, a) => h('i', { class: 'lb-fart-card', style: { '--k': k?.color || 'color-mix(in srgb, var(--text) 30%, transparent)', '--n': i - (a.length - 1) / 2 } })),
        h('i', { class: 'lb-fart-front' })),
      h('span', { class: 'lb-folder-text' },
        h('span', { class: 'lb-folder-name' }, f.name),
        h('span', { class: 'lb-folder-meta' }, `${plural(kids.length, 'set')} · ${plural(terms, 'term')}`, due ? h('span', { class: 'lb-folder-due' }, ` · ${due} due`) : null)),
      gl('chevRight', 18, 'lb-folder-chev'));
  }

  // ---------- draw (FLIP) ----------
  const sorters = {
    recent: (a, b) => (b.lastStudied || b.created) - (a.lastStudied || a.created), name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    created: (a, b) => b.created - a.created, terms: (a, b) => statOf(b).n - statOf(a).n,
    due: (a, b) => statOf(b).due - statOf(a).due, mastery: (a, b) => statOf(a).m.pct - statOf(b).m.pct };
  let first = true, swapping = false;
  function visible() {
    const q = (prefs.q || '').trim().toLowerCase();
    const searched = scope.filter(d => !q || d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q));
    filterSeg.setCounts(Object.fromEntries(FILTERS.map(([f]) => [f, searched.filter(d => matchesFilter(d, f)).length])));
    return { q, list: searched.filter(d => matchesFilter(d, prefs.filter)).sort(sorters[prefs.sort] || sorters.recent) };
  }
  function draw({ morph = false } = {}) {
    if (morph && !first && !reduced() && !swapping) { // fade-through: out, swap layout, wave back in
      swapping = true;
      const a = grid.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.99)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => { swapping = false; a.cancel(); layout({ wave: true }); };
      return;
    }
    layout();
  }
  function layout({ wave = false } = {}) {
    const { q, list } = visible();
    const els = list.map(d => card(d));
    // settle anything still leaving from a previous draw
    grid.querySelectorAll('.lb-ghost').forEach(g => { resetGhost(g); g.remove(); });
    const animate = !first && !wave && !reduced();
    const before = new Map(); if (animate) for (const el of grid.children) before.set(el.dataset.id, el.getBoundingClientRect());
    const leaving = animate ? [...grid.children].filter(el => !els.includes(el)) : [];

    grid.classList.toggle('is-list', prefs.view === 'list');
    grid.replaceChildren(...els);
    if (folderSec) folderSec.classList.toggle('is-collapsed', !!q || prefs.filter !== 'all');
    const fl = FILTERS.find(f => f[0] === prefs.filter)[1];
    setTitle.textContent = q ? 'Results' : prefs.filter === 'all' ? (folder ? 'Sets' : 'All sets') : fl;
    setCount.textContent = list.length;
    renderEmpty(q, list.length);

    if (first || wave) {
      const cols = prefs.view === 'list' ? 1 : Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
      els.forEach((el, i) => enter(el, ((i / cols | 0) + (i % cols)) * (wave ? 45 : 70) + (first ? 220 : 0), first));
      first = false; return;
    }
    if (!animate) { els.forEach(settle); return; }
    const gr = grid.getBoundingClientRect(); let k = 0;
    for (const el of leaving) { // ghost out in place
      const r = before.get(el.dataset.id); if (!r) continue;
      el.classList.add('lb-ghost');
      Object.assign(el.style, { position: 'absolute', left: `${r.left - gr.left}px`, top: `${r.top - gr.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', pointerEvents: 'none' });
      grid.append(el);
      el.__exit = el.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(.94)', filter: 'blur(5px)' }], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      el.__exit.onfinish = () => { resetGhost(el); el.remove(); };
    }
    for (const el of els) {
      const r0 = before.get(el.dataset.id);
      if (!r0) { enter(el, 60 + k++ * 40); continue; }
      const r1 = el.getBoundingClientRect(); const dx = r0.left - r1.left, dy = r0.top - r1.top;
      if (Math.abs(dx) > .5 || Math.abs(dy) > .5) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 620, easing: SPRING });
    }
  }
  function resetGhost(el) { if (el.__exit) { el.__exit.onfinish = null; el.__exit.cancel(); el.__exit = null; } el.classList.remove('lb-ghost'); ['position', 'left', 'top', 'width', 'height', 'margin', 'pointerEvents'].forEach(p => { el.style[p] = ''; }); }
  function enter(el, delay, firstPaint) {
    if (reduced()) { settle(el); return; }
    el.animate([{ opacity: 0, transform: 'translateY(18px) scale(.965)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: firstPaint ? 760 : 560, delay, easing: OUT, fill: 'backwards' });
    if (!el.__drawn) { el.__drawn = true; el.style.setProperty('--d', `${delay + 160}ms`); el.classList.add('lb-draw'); countUp(el.querySelector('.lb-num'), delay + 160); }
  }
  function settle(el) { if (!el.__drawn) { el.__drawn = true; const n = el.querySelector('.lb-num'); if (n) n.textContent = n.dataset.to; } }
  function countUp(node, delay) {
    if (!node) return; const to = +node.dataset.to; if (!to || reduced()) { node.textContent = to; return; }
    node.textContent = '0'; const dur = 900; let t0 = 0;
    setTimeout(() => requestAnimationFrame(function tick(t) { t0 ||= t; const p = Math.min(1, (t - t0) / dur); node.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(tick); }), delay);
  }
  function renderEmpty(q, n) {
    empty.replaceChildren();
    if (n) return;
    const filtered = prefs.filter !== 'all';
    const [title, msg, label, act] = q ? [`Nothing matches “${prefs.q.trim()}”`, 'Try a shorter word, or search across every set with Search.', 'Clear search', () => clear.click()]
      : filtered ? [{ due: 'Nothing due right now', new: 'Every set has been started', learning: 'Nothing in progress', mastered: 'Nothing fully mastered yet' }[prefs.filter], prefs.filter === 'due' ? 'You’re caught up. New reviews will appear here when they’re ready.' : 'Switch back to All to see every set.', 'Show all sets', () => filterSeg.select('all')]
        : [folder ? 'This folder is empty' : 'Your library is empty', 'Create a set from scratch, or import one from Quizlet, Anki or a spreadsheet.', 'New set', () => folderId ? navigate(`new?folder=${folderId}`) : createSetFlow()];
    const box = h('div', { class: 'lb-empty' },
      h('div', { class: 'lb-empty-art', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('h3', {}, title), h('p', {}, msg),
      h('button', { type: 'button', class: `lb-btn ${q || filtered ? 'lb-btn-quiet' : 'lb-btn-primary'}`, onClick: act }, label));
    empty.append(box);
  }

  // ---------- input ----------
  search.addEventListener('input', () => { syncClear(); onSearch(); });
  const onSearch = debounce(() => { prefs.q = search.value; save(); draw(); }, 110);
  search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); clear.click(); } });
  const onKey = e => {
    if (!inner.isConnected) { removeEventListener('keydown', onKey); return; }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { e.preventDefault(); search.focus(); search.select(); }
  };
  addEventListener('keydown', onKey);
  wireLongPress(inner, el => {
    if (el.classList.contains('lb-folder')) { const f = db.folders.get(el.dataset.fid); if (f) return (e) => folderMenu(f, e); }
    const d = db.decks.get?.(el.dataset.id) || db.decks.find(x => x.id === el.dataset.id); return d ? (e) => deckContextMenu(d, e) : null;
  });

  main.append(inner);
  draw();

  async function folderMenu(f, e, anchor) {
    const items = [
      { label: 'Rename', icon: 'edit', onClick: async () => { const n = await prompt('', { title: 'Rename folder', value: f.name }); if (n) { f.name = n; db.folders.put(f); renderSidebar(); navigate(folderId ? `folder/${f.id}` : 'library', { replace: true }); } } },
      { label: 'Colour', icon: 'palette', onClick: () => { modal({ title: 'Folder colour', size: 'sm', content: colorPicker(f.color, c => { f.color = c; db.folders.put(f); renderSidebar(); navigate(folderId ? `folder/${f.id}` : 'library', { replace: true }); }) }); } },
      { label: 'New set in folder', icon: 'plus', onClick: () => navigate(`new?folder=${f.id}`) },
      { separator: true },
      { label: 'Delete folder (keep sets)', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this folder? Its sets will be moved out, not deleted.', { danger: true, okLabel: 'Delete' })) { deleteFolder(f.id); renderSidebar(); toast('Folder deleted'); navigate('library'); } } },
      { label: 'Delete folder and sets', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this folder AND every set inside it? This cannot be undone.', { danger: true, okLabel: 'Delete all' })) { deleteFolder(f.id, { deleteDecks: true }); renderSidebar(); toast('Folder and sets deleted'); navigate('library'); } } },
    ];
    showMenu(items, e ? { x: e.clientX, y: e.clientY } : { anchor, align: 'right' });
  }
}

// Segmented control with a gliding thumb. Options: { value, label?, icon?, count?, aria? }.
function seg(options, value, onChange, { className = '', label } = {}) {
  const thumb = h('span', { class: 'lb-seg-thumb', 'aria-hidden': 'true' });
  const wrap = h('div', { class: `lb-seg ${className}`, role: 'radiogroup', 'aria-label': label }, thumb);
  const btns = options.map(o => {
    const b = h('button', { type: 'button', class: 'lb-seg-btn', role: 'radio', 'data-v': o.value, 'aria-label': o.aria || null, title: o.aria || null, onClick: () => select(o.value) },
      o.icon || null, o.label ? h('span', { class: 'lb-seg-lbl' }, o.label) : null, o.count != null ? h('span', { class: 'lb-seg-n' }) : null);
    wrap.append(b); return b;
  });
  let placed = false;
  function place() {
    const b = btns.find(x => x.dataset.v === value); if (!b || !b.offsetWidth) return;
    if (!placed) thumb.style.transition = 'none';
    thumb.style.width = `${b.offsetWidth}px`; thumb.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!placed) { void thumb.offsetWidth; thumb.style.transition = ''; placed = true; }
    if (wrap.parentElement?.scrollWidth > wrap.parentElement?.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: placed ? 'smooth' : 'auto' });
  }
  function mark() { btns.forEach(b => { const on = b.dataset.v === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }); }
  function select(v) { if (v === value) return; value = v; mark(); place(); onChange(v); }
  wrap.addEventListener('keydown', e => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!dir) return;
    e.preventDefault(); const live = btns.filter(b => !b.disabled); const i = live.findIndex(b => b.dataset.v === value);
    const nb = live[(i + dir + live.length) % live.length]; select(nb.dataset.v); nb.focus();
  });
  new ResizeObserver(place).observe(wrap);
  mark();
  wrap.select = select;
  wrap.setCounts = counts => btns.forEach(b => {
    const n = counts[b.dataset.v]; const c = b.querySelector('.lb-seg-n'); if (!c || n == null) return;
    c.textContent = n; b.disabled = !n && b.dataset.v !== value && b.dataset.v !== 'all';
    requestAnimationFrame(place);
  });
  return wrap;
}

// Press and hold (touch / pen) opens an item's menu; the click that ends the hold is swallowed.
function wireLongPress(root, resolve) {
  let timer = 0, x0 = 0, y0 = 0, target = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = 0; target?.classList.remove('is-holding'); };
  root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.button) return;
    const el = e.target.closest('.lb-card:not(.lb-ghost), .lb-folder'); if (!el || (e.target.closest('button') && e.target.closest('button') !== el)) return;
    const open = resolve(el); if (!open) return;
    target = el; fired = false; x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { timer = 0; fired = true; haptic(); el.classList.add('is-held'); open({ clientX: x0, clientY: y0 }); setTimeout(() => el.classList.remove('is-held'), 420); }, 460);
    setTimeout(() => timer && el.classList.add('is-holding'), 140);
  }, { passive: true });
  root.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => root.addEventListener(t, cancel, { passive: true }));
  root.addEventListener('click', e => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); } }, true);
  root.addEventListener('contextmenu', e => { if (fired) e.preventDefault(); }, true);
}
