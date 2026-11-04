// Application shell: boot, routing, titlebar, sidebar, command palette, global shortcuts, theming.
import { db } from './db.js';
import { ensureDefaults, loadSettings, S, saveSettings, updateSettings, createSampleDecks, createDeck, deckPreset, deckNotes } from './models.js';
import { h, $, $$, svgIcon, debounce, modKey, stripHtml, escapeHtml, hexToHsl } from './utils.js';
import { modal, toast, showMenu, shortcutsModal, closeAllModals, topModal, closeMenus, confirm } from './ui.js';
import { sfx, unlockAudio } from './audio.js';
import { dueCounts, streakInfo } from './scheduler.js';
import { levelProgress, levelTitle, checkAchievements } from './xp.js';
import { playIntro } from './intro.js';
import * as Home from './views/home.js';
import * as Library from './views/library.js';
import * as Deck from './views/deck.js';
import * as Editor from './views/editor.js';
import * as Browser from './views/browser.js';
import * as Stats from './views/stats.js';
import * as Settings from './views/settings.js';
import * as Achievements from './views/achievements.js';
import * as Study from './modes/index.js';
import { showImportDialog } from './importers.js';
import { createBackup } from './exporters.js';
import { sync, initSync } from './sync.js';

export const native = window.recallNative || null;
export const app = { route: { name: 'home', params: {} }, currentView: null, cleanup: null, studyActive: false };
window.recallApp = app;

// ---------- Theme ----------
export const THEMES = [
  { id: 'system', name: 'System', dark: null }, { id: 'light', name: 'Light', dark: false }, { id: 'dark', name: 'Dark', dark: true }, { id: 'midnight', name: 'Midnight OLED', dark: true },
  { id: 'nord', name: 'Nord', dark: true }, { id: 'dracula', name: 'Dracula', dark: true }, { id: 'solarized-light', name: 'Solarized Light', dark: false }, { id: 'solarized-dark', name: 'Solarized Dark', dark: true },
  { id: 'rose', name: 'Rosé Pine', dark: true }, { id: 'forest', name: 'Forest', dark: true }, { id: 'ocean', name: 'Ocean', dark: true }, { id: 'sepia', name: 'Sepia', dark: false },
];
export const ACCENTS = [{ id: 'indigo', hue: 252, hex: '#6366f1' }, { id: 'violet', hue: 270, hex: '#8b5cf6' }, { id: 'fuchsia', hue: 300, hex: '#d946ef' }, { id: 'pink', hue: 330, hex: '#ec4899' }, { id: 'rose', hue: 350, hex: '#f43f5e' }, { id: 'orange', hue: 24, hex: '#f97316' }, { id: 'amber', hue: 38, hex: '#f59e0b' }, { id: 'lime', hue: 84, hex: '#84cc16' }, { id: 'emerald', hue: 160, hex: '#10b981' }, { id: 'teal', hue: 174, hex: '#14b8a6' }, { id: 'cyan', hue: 190, hex: '#06b6d4' }, { id: 'sky', hue: 200, hex: '#0ea5e9' }, { id: 'blue', hue: 217, hex: '#3b82f6' }];
const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const s = S(); const root = document.documentElement;
  let theme = s.theme; if (theme === 'system') theme = mq.matches ? 'dark' : 'light';
  const custom = (s.customThemes || []).find(t => t.id === theme);
  root.setAttribute('data-theme', custom ? custom.base : theme);
  const styleEl = $('#custom-theme-style') || document.head.appendChild(h('style', { id: 'custom-theme-style' }));
  styleEl.textContent = custom ? `:root{${Object.entries(custom.vars || {}).map(([k, v]) => `${k}:${v};`).join('')}}` : '';
  const t = THEMES.find(t => t.id === (custom ? custom.base : theme));
  const themeSetsAccent = ['nord', 'dracula', 'solarized-light', 'solarized-dark', 'rose', 'forest', 'ocean', 'sepia'].includes(custom ? custom.base : theme);
  if (!themeSetsAccent || s.accentOverride) { root.style.setProperty('--accent-h', s.accentHue); root.style.setProperty('--accent-s', '86%'); root.style.setProperty('--accent-l', (t && t.dark === false) ? '56%' : '64%'); root.style.setProperty('--accent-text', '#fff'); }
  else { root.style.removeProperty('--accent-h'); root.style.removeProperty('--accent-s'); root.style.removeProperty('--accent-l'); root.style.removeProperty('--accent-text'); }
  root.style.setProperty('--radius', `${s.radius}px`); root.style.setProperty('--radius-sm', `${Math.max(4, Math.round(s.radius * 0.64))}px`); root.style.setProperty('--radius-lg', `${Math.round(s.radius * 1.55)}px`);
  root.style.setProperty('--font-scale', s.fontScale); root.style.setProperty('--font-ui', s.uiFont === 'System' ? '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' : `"${s.uiFont}", "Segoe UI", system-ui, sans-serif`);
  root.style.setProperty('--font-card', s.cardFont === 'System' ? 'var(--font-ui)' : `"${s.cardFont}", var(--font-ui)`);
  root.style.setProperty('--glass-blur', s.glass ? '18px' : '0px');
  document.body.classList.toggle('reduced-motion', !!s.reducedMotion || !s.animations); document.body.classList.toggle('no-fx', !s.backgroundFx);
  document.body.classList.toggle('density-compact', s.density === 'compact'); document.body.classList.toggle('density-spacious', s.density === 'spacious');
  document.body.classList.toggle('sidebar-collapsed', !!s.sidebarCollapsed); document.body.classList.toggle('zen', !!s.zenMode);
}
mq.addEventListener('change', () => { if (S().theme === 'system') applyTheme(); });

// ---------- Routing ----------
const ROUTES = {
  home: Home, library: Library, folder: Library, set: Deck, edit: Editor, new: Editor, browser: Browser, stats: Stats, settings: Settings, achievements: Achievements, study: Study,
};
export function navigate(path, { replace = false } = {}) { if (!path.startsWith('#')) path = '#/' + path.replace(/^\/+/, ''); if (replace) location.replace(path); else location.hash = path; }
export function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, ''); const [pathPart, query] = raw.split('?'); const parts = pathPart.split('/').filter(Boolean);
  const q = {}; if (query) for (const kv of query.split('&')) { const [k, v] = kv.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return { name: parts[0] || 'home', parts: parts.slice(1), query: q };
}
async function render() {
  const r = parseHash();
  if (app.studyActive && r.name !== 'study') { Study.forceExit(); }
  closeMenus(); closeAllModals();
  if (app.cleanup) { try { app.cleanup(); } catch (e) { console.error(e); } app.cleanup = null; }
  const view = ROUTES[r.name] || Home; app.route = r;
  const main = $('#main'); main.innerHTML = ''; main.scrollTop = 0;
  document.body.classList.toggle('study-mode', r.name === 'study'); app.studyActive = r.name === 'study';
  try { app.cleanup = await view.render(main, r) || null; } catch (e) { console.error(e); main.append(h('div', { class: 'main-inner' }, h('div', { class: 'panel' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, String(e && e.message || e)), h('button', { class: 'btn', onClick: () => navigate('home') }, 'Go home')))); }
  renderSidebar();
}
window.addEventListener('hashchange', render);

// ---------- Titlebar ----------
function renderTitlebar() {
  const tb = $('#titlebar'); tb.innerHTML = '';
  const brand = h('div', { class: 'brand' }, h('div', { class: 'logo' }), h('span', {}, 'Recall'));
  const center = h('div', { class: 'center' },
    h('button', { class: 'search-trigger', onClick: () => openPalette() }, svgIcon('search', 15), h('span', {}, 'Search sets, cards, actions…'), h('kbd', {}, `${modKey} K`)),
    h('button', { class: 'tb-btn', 'data-tip': 'Zen mode', 'data-kbd': `${modKey}+Shift+Z`, onClick: toggleZen }, svgIcon('eye', 16)),
    h('button', { class: 'tb-btn fs-btn', 'data-tip': 'Toggle fullscreen', 'data-kbd': 'F11', onClick: toggleFullscreen }, h('span', { class: 'fs-enter' }, svgIcon('maximize', 16)), h('span', { class: 'fs-exit' }, svgIcon('maximize-off', 16))),
    h('button', { class: 'tb-btn', 'data-tip': 'Keyboard shortcuts', 'data-kbd': '?', onClick: showShortcuts }, svgIcon('keyboard', 16)),
    syncButton());
  const controls = h('div', { class: 'win-controls' },
    h('button', { title: 'Minimize', onClick: () => native && native.minimize() }, h('span', { html: '<svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>' })),
    h('button', { title: 'Maximize', class: 'max', onClick: () => native && native.maximize() }, h('span', { html: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>' })),
    h('button', { title: 'Close', class: 'close', onClick: () => native && native.close() }, h('span', { html: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>' })));
  tb.append(brand, center, controls);
  if (native) { native.onWindowState(st => { if (st.fullscreen !== undefined) document.body.classList.toggle('fullscreen', st.fullscreen); if (st.maximized !== undefined) document.body.classList.toggle('maximized', st.maximized); }); native.windowState().then(st => { document.body.classList.toggle('fullscreen', !!st.fullscreen); document.body.classList.toggle('maximized', !!st.maximized); }); }
  else { document.body.classList.add('web'); if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) document.body.classList.add('standalone'); const zx = document.getElementById('zen-exit'); if (zx) zx.addEventListener('click', toggleZen); document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement)); }
}
// Titlebar cloud icon: shows sync state, opens Settings → Sync
const SYNC_TIPS = { off: 'Cloud sync is off', unlinked: 'Finish setting up sync', syncing: 'Syncing…', ok: 'Synced', offline: 'Offline. Will sync later', error: 'Sync problem' };
function syncButton() {
  const btn = h('button', { class: 'tb-btn sync-btn', onClick: () => navigate('settings?tab=sync') });
  const paint = () => { btn.className = `tb-btn sync-btn st-${sync.state}`; btn.dataset.tip = sync.state === 'error' && sync.error ? `Sync problem: ${sync.error}` : SYNC_TIPS[sync.state] || 'Sync'; btn.innerHTML = ''; btn.append(svgIcon(sync.state === 'off' || sync.state === 'offline' ? 'cloudOff' : 'cloud', 16)); };
  paint(); sync.events.on('state', paint); return btn;
}
export function toggleFullscreen() { if (native) native.fullscreen(); else { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } }
export function toggleZen() { updateSettings({ zenMode: !S().zenMode }); applyTheme(); toast(S().zenMode ? 'Zen mode on: distraction-free' : 'Zen mode off', 'info', { duration: 1500 }); }

// ---------- Sidebar ----------
const NAV_SHORT = { browser: 'Browse', stats: 'Stats', achievements: 'Awards' }; // labels for the phone tab bar
export function renderSidebar() {
  const sb = $('#sidebar'); sb.innerHTML = ''; const r = app.route; const s = S();
  const nav = (name, icon, label, route, badge) => h('button', { class: `nav-btn ${r.name === name || (name === 'library' && r.name === 'folder') ? 'active' : ''}`, 'data-short': NAV_SHORT[name] || label, 'data-nav': name, 'data-tip': s.sidebarCollapsed ? label : null, 'data-tip-pos': 'right', onClick: () => navigate(route) }, svgIcon(icon, 19), h('span', { class: 'label' }, label), badge ? h('span', { class: 'badge' }, badge) : null);
  let totalDue = 0; try { const c = dueCounts(null); totalDue = c.new + c.learn + c.review; } catch (e) { /* */ }
  sb.append(h('button', { class: 'btn btn-primary btn-block collapse-btn', style: { height: '42px' }, onClick: () => createSetFlow() }, svgIcon('plus', 18), s.sidebarCollapsed ? null : h('span', { class: 'label' }, 'Create')));
  sb.append(nav('home', 'home', 'Home', 'home', totalDue || null), nav('library', 'library', 'Library', 'library'), nav('browser', 'search', 'Browse cards', 'browser'), nav('stats', 'stats', 'Statistics', 'stats'), nav('achievements', 'trophy', 'Achievements', 'achievements'), nav('settings', 'settings', 'Settings', 'settings'));
  // Decks grouped by folder
  const folders = db.folders.all().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  const decks = db.decks.filter(d => !d.archived).sort((a, b) => (b.pinned - a.pinned) || (b.lastStudied || 0) - (a.lastStudied || 0) || a.name.localeCompare(b.name));
  const deckLink = (d) => { let due = 0; try { const c = dueCounts(d.id, d); due = c.new + c.learn + c.review; } catch (e) { /* */ }
    return h('button', { class: `deck-link ${r.name === 'set' && r.parts[0] === d.id ? 'active' : ''}`, onClick: () => navigate(`set/${d.id}`), onContextmenu: (e) => { e.preventDefault(); deckContextMenu(d, e); } }, h('span', { class: 'dot', style: { background: d.color || 'var(--accent)' } }), h('span', { class: 'name' }, d.name), due ? h('span', { class: 'due' }, due) : null); };
  const pinned = decks.filter(d => d.pinned);
  if (pinned.length) { sb.append(h('div', { class: 'nav-section' }, 'Pinned')); pinned.forEach(d => sb.append(deckLink(d))); }
  sb.append(h('div', { class: 'nav-section' }, h('span', {}, 'Sets'), h('button', { 'data-tip': 'New folder', onClick: async () => { const { createFolder } = await import('./models.js'); const { prompt } = await import('./ui.js'); const name = await prompt('', { title: 'New folder', placeholder: 'Folder name' }); if (name) { createFolder(name); renderSidebar(); } } }, svgIcon('folderPlus', 14))));
  for (const f of folders) {
    const kids = decks.filter(d => d.folderId === f.id && !d.pinned);
    const row = h('button', { class: `folder-row ${f.collapsed ? 'collapsed' : ''}`, onClick: () => { f.collapsed = !f.collapsed; db.folders.put(f); renderSidebar(); }, onDblclick: () => navigate(`folder/${f.id}`) }, h('span', { class: 'icon caret' }, svgIcon('chevronDown', 12)), svgIcon('folder', 14), h('span', { class: 'ellipsis grow', style: { textAlign: 'left' } }, f.name), h('span', { class: 'tiny faint' }, kids.length));
    row.addEventListener('contextmenu', e => { e.preventDefault(); showMenu([{ label: 'Open folder', icon: 'folder', onClick: () => navigate(`folder/${f.id}`) }, { label: 'Rename', icon: 'edit', onClick: async () => { const { prompt } = await import('./ui.js'); const n = await prompt('', { title: 'Rename folder', value: f.name }); if (n) { f.name = n; db.folders.put(f); renderSidebar(); } } }, { separator: true }, { label: 'Delete folder', icon: 'trash', danger: true, onClick: async () => { if (await confirm('Delete this folder? Sets inside will be kept.', { danger: true, okLabel: 'Delete' })) { const { deleteFolder } = await import('./models.js'); deleteFolder(f.id); renderSidebar(); if (app.route.name === 'folder') navigate('library'); } } }], { x: e.clientX, y: e.clientY }); });
    sb.append(row); if (!f.collapsed) { const wrap = h('div', { class: 'folder-kids' }); kids.forEach(d => wrap.append(deckLink(d))); sb.append(wrap); }
  }
  decks.filter(d => !d.folderId && !d.pinned).forEach(d => sb.append(deckLink(d)));
  sb.append(h('div', { class: 'spacer' }));
  const lp = levelProgress(); const streak = streakInfo();
  sb.append(h('button', { class: 'profile', onClick: () => navigate('achievements'), 'data-tip': s.sidebarCollapsed ? `Level ${lp.level} · ${lp.into}/${lp.need} XP` : null, 'data-tip-pos': 'right' }, h('div', { class: 'avatar' }, lp.level), h('div', { class: 'ptext grow' }, h('div', { class: 'row between' }, h('span', { class: 'lvl' }, levelTitle(lp.level)), h('span', { class: 'tiny muted row', style: { gap: '3px' } }, svgIcon('flame', 12), streak.current)), h('div', { class: 'xpbar' }, h('div', { style: { width: `${lp.pct * 100}%` } })), h('div', { class: 'tiny muted' }, `${lp.into} / ${lp.need} XP`))));
  sb.append(h('button', { class: 'nav-btn', style: { marginTop: '6px', height: '34px' }, 'data-tip': s.sidebarCollapsed ? 'Expand sidebar' : null, 'data-tip-pos': 'right', onClick: () => { updateSettings({ sidebarCollapsed: !S().sidebarCollapsed }); applyTheme(); renderSidebar(); } }, svgIcon(s.sidebarCollapsed ? 'chevronRight' : 'chevronLeft', 16), h('span', { class: 'label small muted' }, 'Collapse')));
}
export function deckContextMenu(d, e) {
  showMenu([
    { label: 'Open', icon: 'cards', onClick: () => navigate(`set/${d.id}`) }, { label: 'Edit terms', icon: 'edit', onClick: () => navigate(`edit/${d.id}`) },
    { label: 'Study (flashcards)', icon: 'play', onClick: () => navigate(`study/flashcards/${d.id}`) }, { label: 'Review due (SRS)', icon: 'brain', onClick: () => navigate(`study/review/${d.id}`) },
    { separator: true },
    { label: d.pinned ? 'Unpin' : 'Pin to sidebar', icon: 'pin', onClick: () => { d.pinned = !d.pinned; db.decks.put(d); renderSidebar(); } },
    { label: 'Move to folder', icon: 'folder', submenu: [{ label: 'No folder', checked: !d.folderId, onClick: () => { d.folderId = null; db.decks.put(d); renderSidebar(); } }, ...db.folders.all().map(f => ({ label: f.name, checked: d.folderId === f.id, onClick: () => { d.folderId = f.id; db.decks.put(d); renderSidebar(); } }))] },
    { label: 'Duplicate', icon: 'copy', onClick: async () => { const { duplicateDeck } = await import('./models.js'); const n = duplicateDeck(d.id); toast('Set duplicated', 'success'); navigate(`set/${n.id}`); } },
    { label: 'Export', icon: 'download', onClick: async () => { const { showExportDialog } = await import('./exporters.js'); showExportDialog(d); } },
    { separator: true },
    { label: 'Delete set', icon: 'trash', danger: true, onClick: async () => { if (await confirm(`Delete "${d.name}" and all its cards? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) { const { deleteDeck } = await import('./models.js'); deleteDeck(d.id); toast('Set deleted', 'info'); if (app.route.parts[0] === d.id) navigate('library'); else { renderSidebar(); if (app.route.name === 'library' || app.route.name === 'home') render(); } } } },
  ], { x: e.clientX, y: e.clientY });
}
export async function createSetFlow() {
  const { choose } = await import('./ui.js');
  const v = await choose('Create', [
    { label: 'New set', value: 'new', icon: 'plus', description: 'Start a blank set and add terms' },
    { label: 'Import from file or text', value: 'import', icon: 'upload', description: 'CSV, TSV, Quizlet export, Anki .apkg, JSON' },
    { label: 'New folder', value: 'folder', icon: 'folderPlus', description: 'Organise your sets' },
  ]);
  if (v === 'new') navigate('new'); else if (v === 'import') showImportDialog(); else if (v === 'folder') { const { prompt } = await import('./ui.js'); const { createFolder } = await import('./models.js'); const name = await prompt('', { title: 'New folder', placeholder: 'Folder name' }); if (name) { createFolder(name); renderSidebar(); toast('Folder created', 'success'); } }
}

// ---------- Command palette ----------
let paletteEl = null;
export function openPalette(initial = '') {
  if (paletteEl) return; sfx.click();
  const input = h('input', { type: 'text', placeholder: 'Type a command or search…', value: initial, spellcheck: false });
  const list = h('div', { class: 'palette-list' });
  paletteEl = h('div', { class: 'palette' }, h('div', { class: 'palette-box' }, h('div', { class: 'palette-input' }, svgIcon('search', 18), input, h('kbd', {}, 'Esc')), list, h('div', { class: 'palette-foot' }, h('span', {}, '↑↓ navigate'), h('span', {}, '↵ select'), h('span', {}, 'Esc close'))));
  document.body.append(paletteEl); requestAnimationFrame(() => paletteEl.classList.add('show')); input.focus();
  const close = () => { if (!paletteEl) return; paletteEl.classList.remove('show'); const el = paletteEl; paletteEl = null; setTimeout(() => el.remove(), 150); };
  paletteEl.addEventListener('mousedown', e => { if (e.target === paletteEl) close(); });
  let items = [], active = 0;
  const actions = () => [
    { title: 'Create new set', sub: 'Editor', icon: 'plus', run: () => navigate('new'), kw: 'new create set deck' },
    { title: 'Import', sub: 'CSV, text, Anki package, JSON', icon: 'upload', run: () => showImportDialog(), kw: 'import file anki csv' },
    { title: 'Go to Home', icon: 'home', run: () => navigate('home'), kw: 'dashboard' }, { title: 'Go to Library', icon: 'library', run: () => navigate('library') },
    { title: 'Browse cards', icon: 'search', run: () => navigate('browser'), kw: 'browser search cards notes' }, { title: 'Statistics', icon: 'stats', run: () => navigate('stats'), kw: 'stats graphs' },
    { title: 'Achievements', icon: 'trophy', run: () => navigate('achievements') }, { title: 'Settings', icon: 'settings', run: () => navigate('settings'), kw: 'preferences options theme' },
    { title: 'Toggle theme (light/dark)', icon: 'moon', run: () => { const cur = S().theme; updateSettings({ theme: cur === 'light' ? 'dark' : 'light' }); applyTheme(); }, kw: 'dark light appearance' },
    { title: 'Toggle Zen mode', icon: 'eye', run: toggleZen }, { title: 'Toggle fullscreen', icon: 'maximize', run: toggleFullscreen },
    { title: 'Keyboard shortcuts', icon: 'keyboard', run: showShortcuts }, { title: 'Back up now', icon: 'save', run: () => createBackup(true), kw: 'backup export all' },
    { title: 'Replay intro animation', icon: 'sparkles', run: () => playIntro({ accentHue: S().accentHue }) },
    { title: 'Study all due cards', sub: 'Across every set', icon: 'brain', run: () => navigate('study/review/all'), kw: 'review due srs' },
  ];
  const update = () => {
    const q = input.value.trim().toLowerCase(); list.innerHTML = ''; items = []; active = 0;
    const push = (section, arr) => { if (!arr.length) return; list.append(h('div', { class: 'palette-section' }, section)); arr.forEach(it => { const idx = items.length; items.push(it); list.append(h('button', { class: 'palette-item', onClick: () => { close(); it.run(); }, onMousemove: () => { active = idx; hl(); } }, svgIcon(it.icon || 'circle', 16), h('div', { class: 'pi-text' }, h('div', { class: 'pi-title', html: it.titleHtml || escapeHtml(it.title) }), it.sub ? h('div', { class: 'pi-sub' }, it.sub) : null))); }); };
    const decks = db.decks.filter(d => !q || d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q)).sort((a, b) => (b.lastStudied || 0) - (a.lastStudied || 0)).slice(0, q ? 8 : 5);
    push(q ? 'Sets' : 'Recent sets', decks.map(d => ({ title: d.name, sub: `${deckNotes(d.id).length} terms`, icon: 'cards', run: () => navigate(`set/${d.id}`) })));
    if (q) {
      const matches = []; const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      for (const n of db.notes.all()) { const txt = n.fields.map(stripHtml).join(' — '); if (re.test(txt)) { const d = db.decks.get(n.deckId); matches.push({ title: txt.slice(0, 90), titleHtml: escapeHtml(txt.slice(0, 90)).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'), sub: d ? d.name : '', icon: 'type', run: () => navigate(`edit/${n.deckId}?note=${n.id}`) }); if (matches.length >= 8) break; } }
      push('Cards', matches);
    }
    push('Actions', actions().filter(a => !q || a.title.toLowerCase().includes(q) || (a.kw || '').includes(q) || (a.sub || '').toLowerCase().includes(q)).slice(0, q ? 8 : 6));
    if (!items.length) list.append(h('div', { class: 'empty-state', style: { padding: '30px' } }, h('p', {}, 'No results')));
    hl();
  };
  const hl = () => { $$('.palette-item', list).forEach((el, i) => el.classList.toggle('active', i === active)); const a = $$('.palette-item', list)[active]; a && a.scrollIntoView({ block: 'nearest' }); };
  input.addEventListener('input', debounce(update, 60));
  input.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; hl(); } else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; hl(); } else if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) { close(); it.run(); } } else if (e.key === 'Escape') { close(); } });
  update();
}

// ---------- Shortcuts ----------
export function showShortcuts() {
  shortcutsModal([
    { title: 'Global', items: [{ label: 'Command palette / search', keys: `${modKey}+K` }, { label: 'New set', keys: `${modKey}+N` }, { label: 'Settings', keys: `${modKey}+,` }, { label: 'Zen mode', keys: `${modKey}+Shift+Z` }, { label: 'Fullscreen', keys: 'F11' }, { label: 'Zoom in / out / reset', keys: `${modKey}+= / - / 0` }, { label: 'This help', keys: '?' }, { label: 'Go back / exit study', keys: 'Esc' }, { label: 'Home / Library / Browser / Stats', keys: 'G then H / L / B / S' }] },
    { title: 'Flashcards', items: [{ label: 'Flip card', keys: 'Space / ↑ / ↓' }, { label: 'Next / previous', keys: '→ / ←' }, { label: 'Still learning / Know (sort mode)', keys: '1 / 2' }, { label: 'Star card', keys: 'S' }, { label: 'Shuffle', keys: 'H' }, { label: 'Play audio', keys: 'A' }, { label: 'Autoplay', keys: 'P' }] },
    { title: 'Review (spaced repetition)', items: [{ label: 'Show answer', keys: 'Space / Enter' }, { label: 'Again / Hard / Good / Easy', keys: '1 / 2 / 3 / 4' }, { label: 'Undo', keys: `${modKey}+Z` }, { label: 'Suspend / Bury card', keys: '@ / -' }, { label: 'Flag card', keys: `${modKey}+1..7` }, { label: 'Edit card', keys: 'E' }, { label: 'Star', keys: 'S' }, { label: 'Play audio', keys: 'A' }] },
    { title: 'Learn / Write / Test', items: [{ label: 'Choose option', keys: '1 – 4' }, { label: 'Submit answer', keys: 'Enter' }, { label: 'Don\'t know / skip', keys: `${modKey}+Enter` }, { label: 'Override as correct', keys: 'O' }, { label: 'Continue', keys: 'Space / Enter' }] },
    { title: 'Games', items: [{ label: 'Match: select', keys: 'Click or 1-9, A-C' }, { label: 'Gravity: type then submit', keys: 'Enter' }, { label: 'Pause', keys: 'P' }, { label: 'Restart', keys: 'R' }] },
    { title: 'Editor', items: [{ label: 'Next field / row', keys: 'Tab / Enter' }, { label: 'Add row', keys: `${modKey}+Enter` }, { label: 'Save', keys: `${modKey}+S` }, { label: 'Bold / Italic / Underline', keys: `${modKey}+B / I / U` }, { label: 'Cloze deletion', keys: `${modKey}+Shift+C` }, { label: 'Delete row', keys: `${modKey}+Backspace` }] },
  ]);
}
let gPressed = false, gTimer = null;
document.addEventListener('keydown', e => {
  if (document.body.classList.contains('intro-playing')) return;
  const tag = (e.target.tagName || '').toLowerCase(); const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (paletteEl) { $('.palette input')?.focus(); } else openPalette(); return; }
  if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); navigate('new'); return; }
  if (mod && e.key === ',') { e.preventDefault(); navigate('settings'); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); toggleZen(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(0.1); return; } if (mod && e.key === '-') { e.preventDefault(); zoom(-0.1); return; } if (mod && e.key === '0') { e.preventDefault(); zoom(0); return; }
  if (typing) return;
  if (e.key === '?' ) { e.preventDefault(); showShortcuts(); return; }
  if (e.key === 'Escape' && !topModal() && !paletteEl) { if (app.route.name === 'study') { Study.requestExit(); } else if (document.body.classList.contains('fullscreen') && native) { native.fullscreen(false); } }
  if (e.key.toLowerCase() === 'g' && !mod && !e.altKey) { gPressed = true; clearTimeout(gTimer); gTimer = setTimeout(() => { gPressed = false; }, 900); return; }
  if (gPressed) { gPressed = false; const map = { h: 'home', l: 'library', b: 'browser', s: 'stats', a: 'achievements', ',': 'settings' }; if (map[e.key.toLowerCase()]) { e.preventDefault(); navigate(map[e.key.toLowerCase()]); } }
});
function zoom(delta) { if (native) { native.zoom(delta).then(z => toast(`Zoom ${Math.round(z * 100)}%`, 'info', { duration: 900 })); } else { const cur = parseFloat(document.body.style.zoom || 1); const z = delta === 0 ? 1 : Math.min(2, Math.max(0.6, cur + delta)); document.body.style.zoom = z; toast(`Zoom ${Math.round(z * 100)}%`, 'info', { duration: 900 }); } }
document.addEventListener('pointerdown', unlockAudio, { once: true }); document.addEventListener('keydown', unlockAudio, { once: true });
// Prevent accidental drag/drop navigations; route dropped files to import
document.addEventListener('dragover', e => { e.preventDefault(); }); document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files && e.dataTransfer.files.length && !e.target.closest('.editor-row, .drop-zone')) showImportDialog({ files: Array.from(e.dataTransfer.files) }); });

// ---------- Boot ----------
async function boot() {
  try { await db.open(); } catch (e) { document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif"><h2>Could not open the local database</h2><p>${escapeHtml(String(e))}</p></div>`; return; }
  ensureDefaults(); applyTheme();
  // Changes downloaded from another device: refresh settings/theme and redraw (but don't disturb a study session)
  sync.events.on('remote', res => { if (res.touched.has('kv') || res.replaced) { loadSettings(); applyTheme(); } if (res.replaced) ensureDefaults(); renderSidebar(); if (!app.studyActive) render(); });
  initSync();
  // Hosted web app: cache files for offline use (not in Electron, which loads from disk)
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
  const s = S(); const firstRun = !s.onboarded;
  if (firstRun && db.decks.size === 0) { createSampleDecks(); }
  renderTitlebar();
  const start = async () => {
    if (!location.hash || location.hash === '#/' || location.hash === '#') navigate(s.startPage === 'library' ? 'library' : 'home', { replace: true });
    await render();
    if (firstRun) { updateSettings({ onboarded: true }); setTimeout(() => showWelcome(), 600); }
    checkAchievements();
    setInterval(() => { try { createBackup(false); } catch (e) { /* */ } }, 6 * 3600000); setTimeout(() => { try { createBackup(false); } catch (e) { /* */ } }, 20000);
    // Keep the sidebar due counts fresh around the day rollover
    setInterval(() => { if (!app.studyActive) renderSidebar(); }, 60000);
  };
  if (s.showIntro) playIntro({ accentHue: s.accentHue, onDone: start }); else start();
}
function showWelcome() {
  const m = modal({ title: false, size: 'md', className: 'welcome-modal', closable: true, content: h('div', { class: 'welcome' },
    h('div', { class: 'welcome-hero' }, h('div', { class: 'intro-logo', style: { animation: 'none', opacity: 1, width: '64px', height: '64px' } }), h('h2', {}, 'Welcome to Recall'), h('p', {}, 'Your complete, offline study studio. Flashcards, Learn, Test, Write, Spell, spaced repetition and nine games, with every option customizable.')),
    h('div', { class: 'welcome-grid' },
      h('div', { class: 'welcome-item' }, svgIcon('cards', 20), h('div', {}, h('b', {}, 'Sample sets are ready'), h('p', {}, 'Four sets were added so you can explore every mode right away.'))),
      h('div', { class: 'welcome-item' }, svgIcon('upload', 20), h('div', {}, h('b', {}, 'Bring your own'), h('p', {}, 'Import Quizlet exports, CSV/TSV, Anki .apkg packages or paste text.'))),
      h('div', { class: 'welcome-item' }, svgIcon('brain', 20), h('div', {}, h('b', {}, 'Spaced repetition built in'), h('p', {}, 'Anki-style scheduling (SM-2 or FSRS) with learning steps and daily limits.'))),
      h('div', { class: 'welcome-item' }, svgIcon('keyboard', 20), h('div', {}, h('b', {}, 'Keyboard first'), h('p', {}, `Press ${modKey}+K anywhere to search or run a command, and ? for shortcuts.`)))),
    h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px', marginTop: '20px' } }, h('button', { class: 'btn btn-lg', onClick: () => { m.close(); showImportDialog(); } }, svgIcon('upload', 18), 'Import'), h('button', { class: 'btn btn-primary btn-lg', onClick: () => m.close() }, 'Start exploring', svgIcon('arrowRight', 18)))) });
}
boot();
