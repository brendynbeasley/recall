// Settings
//
// Structure
//  - Two panes on iPad and desktop: a sidebar of labelled sections, each showing its current value
//    ("Dark · Blue", "50 cards a day", "Up to date"), and a detail pane that scrolls on its own.
//    Narrow screens push from the list into a section and back, like iOS Settings.
//  - Search finds any setting by name or description across every section and jumps straight to it.
//  - Statistics and Achievements are their own pages, so they sit in the list as links (↗), not tabs.
//
// Controls (one family, built here so every row behaves the same)
//  - Switch: the whole row is the hit target; spring thumb; haptic tick.
//  - Segmented: a thumb glides between options.
//  - Slider: filled track, value read-out, live preview where it matters (text size, corners, card text).
//  - Stepper: − value +, press and hold to repeat (accelerating), tap the number to type one.
//  - Picker: the app's menu with a check on the current value; font pickers render each font in itself.
//  - Action rows: icon tile, title, description, chevron; danger rows are red.
//
// Motion: the sidebar selection lens glides; sections cross-fade in with their groups staggered;
// the narrow layout pushes and pops. Honours Reduce motion.
import { db } from '../db.js';
import { S, updateSettings, DEFAULT_SETTINGS, saveSettings } from '../models.js';
import { h, svgIcon, fmtDate, modKey, hexToHsl } from '../utils.js';
import { toast, confirm, modal, showMenu } from '../ui.js';
import { navigate, applyTheme, THEMES, ACCENTS, THEME_OWNS_ACCENT, native, showShortcuts, renderSidebar } from '../app.js';
import { getVoices, speak, sfx } from '../audio.js';
import { playIntro } from '../intro.js';
import { createBackup, exportAllJson, showExportDialog } from '../exporters.js';
import { showImportDialog, restoreBackupFlow } from '../importers.js';
import { renderSyncSettings } from './syncsettings.js';
import { sync } from '../sync.js';
import { levelForXp, xpForLevel, levelTitle } from '../xp.js';

const FONTS = ['System', 'Segoe UI', 'Inter', 'Georgia', 'Cambria', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Calibri', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond', 'Arial Rounded MT Bold'];
const fontStack = f => f === 'System' ? 'system-ui, sans-serif' : `"${f}", system-ui, sans-serif`;
const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = (ms = 6) => { try { navigator.vibrate?.(ms); } catch (e) { /* unsupported */ } };
const touch = () => document.body.classList.contains('tabbar-mode');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const NAV = [
  { items: [
    { id: 'appearance', label: 'Appearance', icon: 'palette', tint: ['#8b7bff', '#5b6cff'] },
    { id: 'study', label: 'Study', icon: 'brain', tint: ['#ff7aa0', '#f2476f'] },
    { id: 'audio', label: 'Sound & speech', icon: 'volume', tint: ['#ffb067', '#ff7d3b'] },
    { id: 'startup', label: 'Startup & window', icon: 'layout', tint: ['#9aa6bd', '#6b7790'] },
  ] },
  { title: 'Your data', items: [
    { id: 'sync', label: 'Sync', icon: 'cloud', tint: ['#5fc4ff', '#2d8cff'] },
    { id: 'data', label: 'Data & backups', icon: 'database', tint: ['#47d38b', '#13a86b'] },
  ] },
  { title: 'Progress', items: [
    { id: 'stats', label: 'Statistics', icon: 'stats', tint: ['#4fd1c5', '#1aa39a'], link: true },
    { id: 'achievements', label: 'Achievements', icon: 'trophy', tint: ['#ffd25e', '#f5a524'], link: true },
  ] },
  { items: [{ id: 'about', label: 'About Recall', icon: 'info', tint: ['#9aa6bd', '#6b7790'] }] },
];
const ALL = NAV.flatMap(g => g.items); const SECTION_IDS = ALL.filter(x => !x.link).map(x => x.id);
const META = Object.fromEntries(ALL.map(x => [x.id, x]));

let apThemeFilter = 'all'; // remembered while the app runs

export function render(main, route) {
  const narrowMq = matchMedia('(max-width: 760px)');
  let current = SECTION_IDS.includes(route.query.tab) ? route.query.tab : (narrowMq.matches ? null : 'appearance');

  const inner = h('div', { class: 'main-inner st' });
  const search = h('input', { class: 'st-search-in', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off', spellcheck: false, enterkeyhint: 'search' });
  const clearBtn = h('button', { type: 'button', class: 'st-search-x', 'aria-label': 'Clear search', tabindex: -1, onClick: () => { search.value = ''; onSearch(); search.focus(); } }, svgIcon('x', 12));
  const lens = h('span', { class: 'st-lens', 'aria-hidden': 'true' });
  const navList = h('nav', { class: 'st-nav', 'aria-label': 'Settings sections' }, lens);
  const results = h('div', { class: 'st-results', role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const side = h('aside', { class: 'st-side' },
    h('div', { class: 'st-side-head' }, h('h1', { class: 'page-title st-title' }, 'Settings'), profileChip()),
    h('label', { class: 'st-search' }, svgIcon('search', 16), search, clearBtn),
    navList, results);
  const paneInner = h('div', { class: 'st-pane-in' });
  const pane = h('section', { class: 'st-pane', 'aria-live': 'polite' }, paneInner);
  inner.append(side, pane);
  main.append(inner);

  // ---------- sidebar ----------
  const navBtns = new Map();
  for (const g of NAV) {
    const box = h('div', { class: 'st-nav-group' }, g.title ? h('div', { class: 'st-nav-title' }, g.title) : null);
    for (const it of g.items) {
      const hint = h('span', { class: 'st-nav-hint' });
      const b = h('button', { type: 'button', class: 'st-nav-item', 'data-id': it.id, onClick: () => it.link ? navigate(it.id) : open(it.id, { push: true }) },
        tile(it.icon, it.tint), h('span', { class: 'st-nav-label' }, it.label), hint,
        it.link ? h('span', { class: 'st-nav-go', 'aria-hidden': 'true' }, svgIcon('arrowRight', 14)) : h('span', { class: 'st-nav-go', 'aria-hidden': 'true' }, svgIcon('chevronRight', 15)));
      b.__hint = hint; navBtns.set(it.id, b); box.append(b);
    }
    navList.append(box);
  }
  const refreshHints = () => { const s = S(); navBtns.forEach((b, id) => { b.__hint.textContent = hintFor(id, s); }); };
  const placeLens = (instant = false) => {
    const b = current && navBtns.get(current);
    if (!b || inner.classList.contains('is-narrow') || !results.hidden) { lens.style.opacity = '0'; return; }
    if (instant) lens.style.transition = 'none';
    lens.style.opacity = '1'; lens.style.height = `${b.offsetHeight}px`; lens.style.transform = `translateY(${b.offsetTop}px)`;
    if (instant) { void lens.offsetWidth; lens.style.transition = ''; }
  };

  // ---------- open a section ----------
  function open(id, { push = false, focusKey = null, keepScroll = false } = {}) {
    const changed = id !== current; current = id;
    navBtns.forEach((b, k) => { b.classList.toggle('on', k === id); if (k === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    history.replaceState(null, '', `#/settings?tab=${id}`);
    const top = keepScroll ? pane.scrollTop : 0;
    const body = h('div', { class: 'st-sec' });
    body.append(h('header', { class: 'st-sec-head' },
      h('button', { type: 'button', class: 'st-back', onClick: back }, svgIcon('chevronLeft', 18), 'Settings'),
      h('h2', { class: 'st-sec-title' }, META[id].label)));
    BUILD[id](body, ctx());
    const animate = changed && !keepScroll && !reduced();
    if (animate) [...body.children].forEach((el, k) => { el.style.setProperty('--k', k); el.classList.add('st-in'); });
    paneInner.replaceChildren(body);
    pane.scrollTop = top;
    if (push) inner.classList.add('show-detail');
    refreshHints(); placeLens();
    if (focusKey) requestAnimationFrame(() => flash(focusKey));
  }
  function back() { inner.classList.remove('show-detail'); if (narrowMq.matches) { history.replaceState(null, '', '#/settings'); } }
  const redraw = () => open(current, { keepScroll: true });
  const ctx = () => ({ s: S(), redraw, set: (patch, re = true) => { updateSettings(patch); applyTheme(); refreshHints(); if (re) redraw(); } });

  function flash(key) {
    const el = paneInner.querySelector(`[data-key="${key}"]`); if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    el.classList.remove('st-flash'); void el.offsetWidth; el.classList.add('st-flash');
  }

  // ---------- search ----------
  let index = null;
  const buildIndex = () => {
    index = [];
    for (const id of SECTION_IDS) {
      if (id === 'sync') { index.push({ id, label: 'Cloud sync', desc: 'Sign in, sync now, Supabase connection', key: null }); continue; }
      const tmp = h('div'); try { BUILD[id](tmp, { ...ctx(), indexing: true }); } catch (e) { /* skip */ }
      tmp.querySelectorAll('[data-key]').forEach(el => index.push({ id, key: el.dataset.key, label: el.dataset.label || '', desc: el.dataset.desc || '' }));
    }
  };
  function onSearch() {
    const q = search.value.trim().toLowerCase(); clearBtn.classList.toggle('show', !!q);
    if (!q) { results.hidden = true; navList.hidden = false; placeLens(true); return; }
    if (!index) buildIndex();
    const words = q.split(/\s+/);
    const hits = index.filter(x => words.every(w => `${x.label} ${x.desc} ${META[x.id].label}`.toLowerCase().includes(w)))
      .sort((a, b) => (b.label.toLowerCase().startsWith(q) - a.label.toLowerCase().startsWith(q))).slice(0, 24);
    navList.hidden = true; results.hidden = false;
    results.replaceChildren(...(hits.length ? hits.map((x, k) => h('button', { type: 'button', class: 'st-result', role: 'option', style: { '--k': k },
      onClick: () => { search.value = ''; onSearch(); open(x.id, { push: true, focusKey: x.key }); } },
      tile(META[x.id].icon, META[x.id].tint, 26), h('span', { class: 'st-result-t' }, h('b', {}, x.label), h('span', {}, META[x.id].label)))) : [h('div', { class: 'st-noresult' }, h('b', {}, 'No matches'), h('span', {}, `Nothing called “${search.value.trim()}”.`))]));
  }
  search.addEventListener('input', onSearch);
  search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; onSearch(); } if (e.key === 'Enter') results.querySelector('.st-result')?.click(); });

  // ---------- layout mode ----------
  const applyMode = () => {
    inner.classList.toggle('is-narrow', narrowMq.matches);
    if (!narrowMq.matches && !current) current = 'appearance';
    if (current) open(current, { keepScroll: true }); else refreshHints();
    if (narrowMq.matches) inner.classList.toggle('show-detail', !!(current && route.query.tab));
    requestAnimationFrame(() => placeLens(true));
  };
  narrowMq.addEventListener?.('change', () => { if (inner.isConnected) applyMode(); });
  new ResizeObserver(() => placeLens(true)).observe(navList);
  const onKey = e => {
    if (!inner.isConnected) { removeEventListener('keydown', onKey); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); search.focus(); search.select(); }
  };
  addEventListener('keydown', onKey);
  applyMode();
}

// ---------- sidebar pieces ----------
function tile(icon, [a, b], size = 30) {
  return h('span', { class: 'st-tile', style: { '--a': a, '--b': b, width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, svgIcon(icon, Math.round(size * .55)));
}
function profileChip() {
  const xp = S().xp || 0; const lvl = levelForXp(xp); const a = xpForLevel(lvl), b = xpForLevel(lvl + 1);
  const p = Math.max(0, Math.min(1, (xp - a) / Math.max(1, b - a)));
  return h('button', { type: 'button', class: 'st-profile', onClick: () => navigate('achievements'), 'aria-label': `Level ${lvl}, ${levelTitle(lvl)}. ${Math.round(p * 100)}% to next level. Open achievements.` },
    h('span', { class: 'st-profile-lvl' }, lvl),
    h('span', { class: 'st-profile-t' }, h('b', {}, levelTitle(lvl)), h('span', { class: 'st-profile-bar' }, h('i', { style: { width: `${p * 100}%` } }))));
}
function hintFor(id, s) {
  const theme = THEMES.find(t => t.id === s.theme)?.name || (s.customThemes || []).find(t => t.id === s.theme)?.name || 'Custom';
  const acc = s.accentPreset === 'custom' ? 'Custom' : cap(s.accentPreset || '');
  switch (id) {
    case 'appearance': return THEME_OWNS_ACCENT.includes(s.theme) && !s.accentOverride ? theme : `${theme} · ${acc}`;
    case 'study': return `${s.dailyGoalCards} a day`;
    case 'audio': return [s.sounds ? 'Sounds' : null, s.tts ? 'Speech' : null].filter(Boolean).join(' · ') || 'Off';
    case 'startup': return s.startPage === 'library' ? 'Opens Library' : 'Opens Home';
    case 'sync': return { off: 'Off', unlinked: 'Set up', syncing: 'Syncing', ok: 'On', offline: 'Offline', error: 'Problem' }[sync.state] || '';
    case 'data': return `${db.decks.size} ${db.decks.size === 1 ? 'set' : 'sets'}`;
    default: return '';
  }
}

// ---------- control kit ----------
function group(title, ...kids) {
  let foot = null; if (kids.length && kids[kids.length - 1]?.__foot) foot = kids.pop().text;
  return h('section', { class: 'st-group' }, title ? h('h3', { class: 'st-group-t' }, title) : null,
    h('div', { class: 'st-card' }, ...kids.filter(Boolean)), foot ? h('p', { class: 'st-foot' }, foot) : null);
}
const foot = text => ({ __foot: true, text });
// A setting row: label + optional description, control on the right (or below with `stack`).
function row(label, control, { desc, stack = false, key, hideLabel = false } = {}) {
  const k = key || slug(label);
  const el = h('div', { class: `st-row ${stack ? 'is-stack' : ''} ${hideLabel ? 'no-label' : ''}`, 'data-key': k, 'data-label': label, 'data-desc': desc || '' },
    h('div', { class: 'st-row-t' }, h('span', { class: 'st-row-l' }, label), desc ? h('span', { class: 'st-row-d' }, desc) : null),
    control ? h('div', { class: 'st-row-c' }, control) : null);
  if (control?.classList?.contains('st-switch')) { // whole row toggles
    el.classList.add('is-tappable');
    el.addEventListener('click', e => { if (!control.contains(e.target) && !control.disabled) control.click(); });
  }
  return el;
}
function action(label, { icon, tint, desc, onClick, danger = false, primary = false, value, external = false, key, disabled = false } = {}) {
  return h('button', { type: 'button', class: `st-row st-action ${danger ? 'is-danger' : ''} ${primary ? 'is-primary' : ''}`, disabled, 'data-key': key || slug(label), 'data-label': label, 'data-desc': desc || '', onClick },
    icon ? tile(icon, tint || (danger ? ['#ff6b6b', '#e5484d'] : ['#9aa6bd', '#6b7790']), 28) : null,
    h('span', { class: 'st-row-t' }, h('span', { class: 'st-row-l' }, label), desc ? h('span', { class: 'st-row-d' }, desc) : null),
    value != null ? h('span', { class: 'st-action-v' }, value) : null,
    h('span', { class: 'st-action-go', 'aria-hidden': 'true' }, svgIcon(external ? 'arrowRight' : 'chevronRight', 15)));
}
function switchCtl(on, onChange, { label, disabled = false } = {}) {
  const b = h('button', { type: 'button', class: `st-switch ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!on), 'aria-label': label || null, disabled },
    h('i', { class: 'st-switch-thumb' }));
  b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); haptic(); onChange(on); });
  return b;
}
function segCtl(options, value, onChange, { label, full = false } = {}) {
  const thumb = h('span', { class: 'st-seg-thumb', 'aria-hidden': 'true' });
  const wrap = h('div', { class: `st-seg ${full ? 'is-full' : ''}`, role: 'radiogroup', 'aria-label': label || null }, thumb);
  const btns = options.map(o => {
    const b = h('button', { type: 'button', class: 'st-seg-b', role: 'radio', 'data-v': String(o.value), onClick: () => pick(o.value) }, o.icon ? svgIcon(o.icon, 14) : null, h('span', {}, o.label));
    wrap.append(b); return b;
  });
  let placed = false;
  const place = () => { const b = btns.find(x => x.dataset.v === String(value)); if (!b || !b.offsetWidth) return; if (!placed) thumb.style.transition = 'none'; thumb.style.width = `${b.offsetWidth}px`; thumb.style.transform = `translateX(${b.offsetLeft}px)`; if (!placed) { void thumb.offsetWidth; thumb.style.transition = ''; placed = true; } };
  const mark = () => btns.forEach(b => { const on = b.dataset.v === String(value); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  function pick(v) { if (String(v) === String(value)) return; value = v; mark(); place(); haptic(4); onChange(v); }
  wrap.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); const i = options.findIndex(o => String(o.value) === String(value)); const n = options[(i + d + options.length) % options.length]; pick(n.value); btns[options.indexOf(n)].focus(); });
  mark(); new ResizeObserver(place).observe(wrap);
  return wrap;
}
function sliderCtl(value, onChange, { min = 0, max = 100, step = 1, format = v => v, label, ticks } = {}) {
  const out = h('output', { class: 'st-slider-v' }, format(value));
  const inp = h('input', { type: 'range', class: 'st-range', min, max, step, value, 'aria-label': label || null });
  const paint = () => inp.style.setProperty('--p', `${(inp.value - min) / (max - min) * 100}%`);
  let last = value;
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = format(v); paint(); if (v !== last) { last = v; if (ticks) haptic(3); } onChange(v); });
  paint();
  return h('div', { class: 'st-slider' }, inp, out);
}
function stepperCtl(value, onChange, { min = 0, max = 9999, step = 1, suffix, label } = {}) {
  const stepAt = typeof step === 'function' ? step : () => step;
  const num = h('span', { class: 'st-step-n' }, String(value));
  const dec = h('button', { type: 'button', class: 'st-step-b', 'aria-label': `Decrease ${label || ''}`.trim() }, svgIcon('minus', 15));
  const inc = h('button', { type: 'button', class: 'st-step-b', 'aria-label': `Increase ${label || ''}`.trim() }, svgIcon('plus', 15));
  const sync_ = () => { dec.disabled = value <= min; inc.disabled = value >= max; };
  const commit = (v, dir) => {
    v = Math.max(min, Math.min(max, Math.round(v))); if (v === value) return false;
    value = v; num.textContent = String(v); sync_(); haptic(3); onChange(v);
    if (!reduced()) num.animate([{ transform: `translateY(${dir * 40}%)`, opacity: .2 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,.9,.25,1)' });
    return true;
  };
  const hold = (btn, dir) => {
    let t = 0, n = 0;
    const tick = () => { if (!commit(value + dir * stepAt(value, dir), dir)) return stop(); n++; t = setTimeout(tick, Math.max(40, 180 - n * 14)); };
    const stop = () => { clearTimeout(t); t = 0; };
    btn.addEventListener('pointerdown', e => { if (btn.disabled) return; e.preventDefault(); commit(value + dir * stepAt(value, dir), dir); n = 0; t = setTimeout(tick, 420); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(value + dir * stepAt(value, dir), dir); } });
  };
  hold(dec, -1); hold(inc, 1);
  const mid = h('button', { type: 'button', class: 'st-step-mid', 'aria-label': `${label || 'Value'}: ${value}. Tap to type.` }, num, suffix ? h('small', {}, suffix) : null);
  mid.addEventListener('click', () => { // tap to type
    const inp = h('input', { class: 'st-step-in', type: 'number', inputmode: 'numeric', value, min, max });
    const done = () => { const v = parseFloat(inp.value); if (!isNaN(v)) commit(v, v > value ? 1 : -1); inp.replaceWith(mid); };
    inp.addEventListener('blur', done); inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = value; inp.blur(); } });
    mid.replaceWith(inp); inp.focus(); inp.select();
  });
  sync_();
  return h('div', { class: 'st-stepper', role: 'group', 'aria-label': label || null }, dec, mid, inc);
}
function pickerCtl(options, value, onChange, { font = false, label } = {}) {
  const cur = () => options.find(o => String(o.value) === String(value))?.label ?? String(value);
  const lbl = h('span', { class: 'st-pick-l' }, cur()); if (font) lbl.style.fontFamily = fontStack(value);
  const b = h('button', { type: 'button', class: 'st-pick', 'aria-haspopup': 'menu', 'aria-label': label ? `${label}: ${cur()}` : null }, lbl, svgIcon('chevronsUpDown', 14));
  b.addEventListener('click', () => {
    b.classList.add('open');
    const m = showMenu(options.map(o => ({ label: o.label, checked: String(o.value) === String(value), onClick: () => {
      value = o.value; lbl.textContent = cur(); if (font) lbl.style.fontFamily = fontStack(value); b.setAttribute('aria-label', label ? `${label}: ${cur()}` : ''); haptic(4); onChange(o.value);
    } })), { anchor: b, align: 'right', minWidth: Math.max(220, b.offsetWidth) });
    m.classList.add('st-menu');
    if (font) m.querySelectorAll(':scope > .menu-item .menu-label').forEach((el, i) => { el.style.fontFamily = fontStack(options[i].value); });
    m.querySelector('.menu-item.checked')?.scrollIntoView({ block: 'center' });
    new MutationObserver((_, o) => { if (!m.isConnected) { b.classList.remove('open'); o.disconnect(); } }).observe(document.body, { childList: true });
  });
  return b;
}
function chipsCtl(options, selected, onChange) { // multi-select, never empty
  const set = new Set(selected);
  const wrap = h('div', { class: 'st-chips' });
  const btns = options.map(([id, l]) => { const b = h('button', { type: 'button', class: `st-chip ${set.has(id) ? 'on' : ''}`, 'aria-pressed': String(set.has(id)), onClick: () => {
    if (set.has(id) && set.size === 1) { b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 260 }); toast('Keep at least one question type'); return; }
    set.has(id) ? set.delete(id) : set.add(id); b.classList.toggle('on', set.has(id)); b.setAttribute('aria-pressed', String(set.has(id))); haptic(4); onChange([...set]);
  } }, svgIcon('check', 13), l); wrap.append(b); return b; });
  return wrap;
}
// Press and hold (touch) or right-click (mouse); swallows the click that ends a hold.
function longPress(el, fn) {
  let t = 0, fired = false, x0 = 0, y0 = 0;
  el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; fired = false; x0 = e.clientX; y0 = e.clientY; t = setTimeout(() => { fired = true; haptic(10); fn(); }, 480); });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) { clearTimeout(t); t = 0; } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => { clearTimeout(t); t = 0; }));
  el.addEventListener('click', e => { if (fired) { fired = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) fn(); });
}
const btn = (label, onClick, { icon, kind = 'tonal', disabled = false } = {}) => h('button', { type: 'button', class: `st-btn is-${kind}`, disabled, onClick }, icon ? svgIcon(icon, 15) : null, h('span', {}, label));

// ---------- sections ----------
const BUILD = {
  appearance(body, { s, set, indexing }) {
    const amb = s.ambient || (s.backgroundFx === false ? 'off' : 'vivid');
    body.append(preview(s, set));

    // Theme
    const list = THEMES.filter(t => apThemeFilter === 'all' || t.id === 'system' || (apThemeFilter === 'dark' ? t.dark === true : t.dark === false));
    const themeTile = (id, name, on, onClick, { vars, base, split, extra } = {}) => h('button', { type: 'button', class: `st-theme ${on ? 'on' : ''}`, 'aria-pressed': String(on), onClick, ...(extra || {}) },
      split ? h('span', { class: 'st-theme-pv is-split' }, miniWin('light'), miniWin('dark')) : miniWin(base || id, vars),
      h('span', { class: 'st-theme-n' }, name), h('span', { class: 'st-theme-ok', 'aria-hidden': 'true' }, svgIcon('check', 12)));
    const grid = h('div', { class: 'st-themes' },
      ...list.map(t => themeTile(t.id, t.name, s.theme === t.id, () => set({ theme: t.id }), { split: t.id === 'system' })),
      ...(s.customThemes || []).map(t => themeTile(t.id, t.name, s.theme === t.id, () => set({ theme: t.id }), { vars: t.vars, base: t.base, extra: { ref: el => longPress(el, async () => { if (await confirm(`Delete custom theme “${t.name}”?`, { danger: true, okLabel: 'Delete' })) set({ customThemes: s.customThemes.filter(x => x.id !== t.id), theme: s.theme === t.id ? 'dark' : s.theme }); }) } })),
      h('button', { type: 'button', class: 'st-theme is-add', onClick: () => customThemeDialog(set) }, h('span', { class: 'st-theme-pv' }, svgIcon('plus', 18)), h('span', { class: 'st-theme-n' }, 'Create your own')));
    body.append(group('Theme',
      row('Theme', grid, { stack: true, hideLabel: true, key: 'theme' }),
      row('Show themes', segCtl([{ value: 'all', label: 'All' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], apThemeFilter, v => { apThemeFilter = v; if (!indexing) set({}, true); }, { label: 'Filter themes' }), { key: 'theme-filter' }),
      (s.customThemes || []).length ? foot('Press and hold a theme you made to delete it.') : null));

    // Colour
    const owns = THEME_OWNS_ACCENT.includes(s.theme);
    const swatches = h('div', { class: 'st-accents', role: 'radiogroup', 'aria-label': 'Accent colour' },
      ...ACCENTS.map(x => h('button', { type: 'button', class: `st-accent ${s.accentPreset === x.id ? 'on' : ''}`, role: 'radio', 'aria-checked': String(s.accentPreset === x.id), 'aria-label': cap(x.id), title: cap(x.id), style: { '--c': x.hex }, onClick: () => set({ accentPreset: x.id, accentHue: x.hue }) })),
      h('label', { class: `st-accent is-custom ${s.accentPreset === 'custom' ? 'on' : ''}`, title: 'Any colour', 'aria-label': 'Any colour' },
        h('input', { type: 'color', value: '#6366f1', onInput: e => { const [hue] = hexToHsl(e.target.value); set({ accentPreset: 'custom', accentHue: hue }, false); }, onChange: () => set({}, true) })));
    body.append(group('Accent colour',
      row('Accent', swatches, { stack: true, hideLabel: true, key: 'accent', desc: owns && !s.accentOverride ? 'This theme brings its own accent. Turn on “Use my accent everywhere” to use yours.' : null }),
      row('Fine-tune hue', sliderCtl(s.accentHue, v => set({ accentHue: v, accentPreset: 'custom' }, false), { min: 0, max: 360, format: v => `${v}°`, label: 'Accent hue' }), { key: 'hue' }),
      row('Use my accent everywhere', switchCtl(!!s.accentOverride, v => set({ accentOverride: v }), { label: 'Use my accent everywhere' }), { desc: 'Overrides themes that have a built-in accent.' })));

    // Background
    const ambTile = (v, label, d) => h('button', { type: 'button', class: `st-amb ${amb === v ? 'on' : ''}`, 'aria-pressed': String(amb === v), onClick: () => set({ ambient: v, backgroundFx: v !== 'off' }) },
      h('span', { class: `st-amb-pv is-${v}` }, h('i'), h('i')), h('b', {}, label), h('span', {}, d));
    body.append(group('Background',
      row('Ambient glow', h('div', { class: 'st-ambs' }, ambTile('vivid', 'Vivid', 'Glowing colour'), ambTile('subtle', 'Subtle', 'A soft hint'), ambTile('off', 'Off', 'Solid and calm')), { stack: true, key: 'ambient' }),
      row('Frosted glass', switchCtl(s.glass, v => set({ glass: v }), { label: 'Frosted glass' }), { desc: 'Blur behind floating bars and panels.' }),
      row('Edge light', switchCtl(s.edgeGlow !== false, v => set({ edgeGlow: v }), { label: 'Edge light' }), { desc: 'A soft line of light around the screen and key cards.' })));

    // Text & layout
    const sample = h('span', { class: 'st-aa', style: { fontSize: `${s.fontScale * 1.15}rem` } }, 'Aa');
    const corner = h('span', { class: 'st-corner', style: { borderTopLeftRadius: `${s.radius}px` } });
    body.append(group('Text & layout',
      row('Text size', h('div', { class: 'st-with-pv' }, sliderCtl(Math.round(s.fontScale * 100), v => { sample.style.fontSize = `${v / 100 * 1.15}rem`; set({ fontScale: v / 100 }, false); }, { min: 80, max: 130, step: 5, format: v => `${v}%`, ticks: true, label: 'Text size' }), sample)),
      row('Corner roundness', h('div', { class: 'st-with-pv' }, sliderCtl(s.radius, v => { corner.style.borderTopLeftRadius = `${v}px`; set({ radius: v }, false); }, { min: 0, max: 28, format: v => `${v} px`, label: 'Corner roundness' }), corner)),
      row('Density', segCtl([{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfy' }, { value: 'spacious', label: 'Spacious' }], s.density, v => set({ density: v }, false), { label: 'Density' })),
      row('Interface font', pickerCtl(FONTS.map(f => ({ value: f, label: f })), s.uiFont, v => set({ uiFont: v }), { font: true, label: 'Interface font' })),
      row('Flashcard font', pickerCtl(FONTS.map(f => ({ value: f, label: f })), s.cardFont, v => set({ cardFont: v }, false), { font: true, label: 'Flashcard font' }), { desc: 'Used on card faces while studying.' })));

    // Motion
    const introOn = v => v === 'off' ? !s.showIntro : (s.showIntro && (s.introVariant || 'ember') === v);
    const introTile = (v, l, d) => h('button', { type: 'button', class: `st-amb is-intro ${introOn(v) ? 'on' : ''}`, 'aria-pressed': String(introOn(v)), onClick: () => set(v === 'off' ? { showIntro: false } : { showIntro: true, introVariant: v }) },
      h('span', { class: `st-intro-pv is-${v}` }, h('i')), h('b', {}, l), h('span', {}, d));
    body.append(group('Motion',
      row('Intro animation', h('div', { class: 'st-col' }, h('div', { class: 'st-ambs' }, introTile('ember', 'Edge', 'Light traces the screen'), introTile('classic', 'Classic', '3D flashcard galaxy'), introTile('off', 'Off', 'Open straight to Home')),
        btn('Preview intro', () => playIntro({ accentHue: s.accentHue }), { icon: 'play', disabled: !s.showIntro })), { stack: true, key: 'intro' }),
      row('Animations', switchCtl(s.animations, v => set({ animations: v }, false), { label: 'Animations' }), { desc: 'Transitions, card flips and springs.' }),
      row('Reduce motion', switchCtl(s.reducedMotion, v => set({ reducedMotion: v }, false), { label: 'Reduce motion' }), { desc: 'No large movement, confetti or countdowns.' }),
      row('Celebrations', switchCtl(s.confetti, v => updateSettings({ confetti: v }), { label: 'Celebrations' }), { desc: 'Confetti when you finish or hit a goal.' }),
      touch() ? null : row('Keyboard hints', switchCtl(s.keyboardHints, v => updateSettings({ keyboardHints: v }), { label: 'Keyboard hints' }), { desc: 'Shortcut keys on study buttons.' })));

    body.append(group(null, action('Reset appearance', { icon: 'refresh', tint: ['#9aa6bd', '#6b7790'], desc: 'Theme, colours, text and motion back to their defaults.', onClick: async () => {
      if (!(await confirm('Reset theme, colours, text and motion to their defaults?', { okLabel: 'Reset' }))) return;
      const d = DEFAULT_SETTINGS; set({ theme: d.theme, accentPreset: d.accentPreset, accentHue: d.accentHue, accentOverride: false, radius: d.radius, density: d.density, fontScale: d.fontScale, uiFont: d.uiFont, cardFont: d.cardFont, glass: d.glass, ambient: 'vivid', backgroundFx: true, animations: true, reducedMotion: false }); toast('Appearance reset');
    } })));
  },

  study(body, { s }) {
    const hours = Array.from({ length: 24 }, (_, i) => ({ value: i, label: new Date(2000, 0, 1, i).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }));
    const goalStep = v => v < 20 ? 1 : v < 100 ? 5 : v < 500 ? 25 : 100;
    body.append(group('Daily goal',
      row('Cards per day', stepperCtl(s.dailyGoalCards, v => updateSettings({ dailyGoalCards: v }), { min: 1, max: 5000, step: goalStep, label: 'Cards per day' })),
      row('Minutes per day', stepperCtl(s.dailyGoalMinutes, v => updateSettings({ dailyGoalMinutes: v }), { min: 1, max: 1440, step: v => v < 10 ? 1 : 5, label: 'Minutes per day' })),
      row('New day starts at', pickerCtl(hours, s.dayRollover, v => updateSettings({ dayRollover: parseInt(v, 10) }), { label: 'New day starts at' }), { desc: 'Late-night sessions count toward the previous day until then.' }),
      row('Week starts on', segCtl([{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }], s.weekStart, v => updateSettings({ weekStart: v }), { label: 'Week starts on' })),
      foot('Shown on Home and used for streaks and achievements.')));
    body.append(group('Spaced review',
      row('Answer buttons', segCtl([{ value: 4, label: 'Four' }, { value: 2, label: 'Two' }], s.review.buttons, v => updateSettings({ review: { buttons: v } }), { label: 'Answer buttons' }), { desc: s.review.buttons === 2 ? 'Again · Good. Simpler.' : 'Again · Hard · Good · Easy. Gives the scheduler more to work with.', key: 'answer-buttons' }),
      row('Show next intervals', switchCtl(s.review.showIntervals, v => updateSettings({ review: { showIntervals: v } }), { label: 'Show next intervals' }), { desc: 'For example “Good · 3d” on each button.' }),
      row('Show remaining counts', switchCtl(s.review.showRemaining, v => updateSettings({ review: { showRemaining: v } }), { label: 'Show remaining counts' }), { desc: 'New, learning and review counts at the top.' }),
      row('Show answer timer', switchCtl(s.review.showTimer, v => updateSettings({ review: { showTimer: v } }), { label: 'Show answer timer' })),
      row('Flip when revealing', switchCtl(s.review.flipAnimation, v => updateSettings({ review: { flipAnimation: v } }), { label: 'Flip when revealing' })),
      foot('Scheduling for each set lives in that set’s Options.')));
    body.append(group('Learn, Write & Test',
      row('Answer with', segCtl([{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }], s.learn.answerWith, v => updateSettings({ learn: { answerWith: v } }), { label: 'Answer with' })),
      row('Question types', chipsCtl([['mc', 'Multiple choice'], ['written', 'Written'], ['tf', 'True / False']], s.learn.questionTypes, v => updateSettings({ learn: { questionTypes: v } })), { stack: true }),
      row('Terms per round', stepperCtl(s.learn.roundSize, v => updateSettings({ learn: { roundSize: v } }), { min: 3, max: 30, label: 'Terms per round' }), { desc: 'Before each Learn checkpoint.' }),
      row('Forgive small typos', switchCtl(s.learn.typoTolerance, v => updateSettings({ learn: { typoTolerance: v }, write: { typoTolerance: v }, test: { typoTolerance: v } }), { label: 'Forgive small typos' }), { desc: 'You can still override a grade.' }),
      row('Retype wrong answers', switchCtl(s.learn.retypeWrong, v => updateSettings({ learn: { retypeWrong: v }, write: { retypeWrong: v } }), { label: 'Retype wrong answers' }), { desc: 'Copy the correct answer before moving on.' }),
      row('Case sensitive', switchCtl(s.learn.caseSensitive, v => updateSettings({ learn: { caseSensitive: v } }), { label: 'Case sensitive' })),
      row('Test length', stepperCtl(s.test.count, v => updateSettings({ test: { count: v } }), { min: 1, max: 500, step: v => v < 20 ? 1 : 5, suffix: 'questions', label: 'Test length' })),
      foot('Each mode also lets you change these on the spot.')));
    const cardSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-font-size')) || 26;
    const cardPv = h('div', { class: 'st-cardpv' }, h('span', { style: { fontSize: `${cardSize}px` } }, 'Photosynthesis'));
    body.append(group('Flashcards',
      row('Reveal animation', segCtl([{ value: 'flip', label: '3D flip' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'Instant' }], s.flashcards.animation, v => updateSettings({ flashcards: { animation: v } }), { label: 'Reveal animation' })),
      row('Autoplay speed', stepperCtl(s.flashcards.autoplaySeconds, v => updateSettings({ flashcards: { autoplaySeconds: v } }), { min: 1, max: 30, suffix: 'sec', label: 'Autoplay speed' }), { desc: 'Time on each side of the card.' }),
      row('Card text size', h('div', { class: 'st-col' }, sliderCtl(cardSize, v => { cardPv.firstChild.style.fontSize = `${v}px`; document.documentElement.style.setProperty('--card-font-size', `${v}px`); db.setKV('cardFontSize', v); }, { min: 16, max: 48, format: v => `${v} px`, label: 'Card text size' }), cardPv), { stack: true, key: 'card-text-size' })));
  },

  audio(body, { s, redraw }) {
    const voices = getVoices(); const vopts = [{ value: '', label: 'Automatic' }, ...voices.map(v => ({ value: v.name, label: `${v.name} · ${v.lang}` }))];
    const play = (k, b) => { sfx[k](); if (!reduced()) b.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1.2)' }); };
    const pads = h('div', { class: 'st-pads' }, ...[['correct', 'Correct'], ['wrong', 'Wrong'], ['flip', 'Flip'], ['match', 'Match'], ['complete', 'Complete'], ['levelUp', 'Level up']].map(([k, l]) => { const b = h('button', { type: 'button', class: 'st-pad', disabled: !s.sounds, onClick: () => play(k, b) }, svgIcon('play', 12), l); return b; }));
    body.append(group('Sound effects',
      row('Sound effects', switchCtl(s.sounds, v => { updateSettings({ sounds: v }); if (v) sfx.correct(); redraw(); }, { label: 'Sound effects' }), { desc: 'Flips, answers, games and celebrations.' }),
      row('Volume', sliderCtl(Math.round(s.soundVolume * 100), v => updateSettings({ soundVolume: v / 100 }), { min: 0, max: 100, format: v => `${v}%`, label: 'Volume' })),
      row('Try a sound', pads, { stack: true, key: 'sound-test' })));
    body.append(group('Text to speech',
      row('Speak cards aloud', switchCtl(s.tts, v => { updateSettings({ tts: v }); redraw(); }, { label: 'Speak cards aloud' })),
      row('Speaking rate', sliderCtl(Math.round(s.ttsRate * 100), v => updateSettings({ ttsRate: v / 100 }), { min: 50, max: 200, step: 5, format: v => `${(v / 100).toFixed(2).replace(/0$/, '')}×`, label: 'Speaking rate' })),
      row('Voice for terms', pickerCtl(vopts, s.ttsVoiceFront, v => updateSettings({ ttsVoiceFront: v }), { label: 'Voice for terms' })),
      row('Voice for definitions', pickerCtl(vopts, s.ttsVoiceBack, v => updateSettings({ ttsVoiceBack: v }), { label: 'Voice for definitions' })),
      row('Read cards automatically', switchCtl(s.ttsAutoplay, v => updateSettings({ ttsAutoplay: v }), { label: 'Read cards automatically' }), { desc: 'In Flashcards and Review.' }),
      row('Test a voice', h('div', { class: 'st-btnrow' },
        btn('English', () => speak('Hello! This is how I sound.', { voiceName: s.ttsVoiceFront, lang: 'en' }), { icon: 'volume' }),
        btn('Spanish', () => speak('Hola, ¿cómo estás?', { lang: 'es' }), { kind: 'quiet' }),
        btn('French', () => speak('Bonjour, comment ça va ?', { lang: 'fr' }), { kind: 'quiet' })), { stack: true, key: 'test-voice' }),
      foot(voices.length ? `${voices.length} voices on this device. Works offline.` : 'No voices found on this device yet. Add them in your system’s speech settings.')));
  },

  startup(body, { s }) {
    body.append(group('Launch',
      row('Play intro on launch', switchCtl(s.showIntro, v => updateSettings({ showIntro: v }), { label: 'Play intro on launch' }), { desc: 'Tap or press Esc to skip it.' }),
      action('Play the intro now', { icon: 'sparkles', tint: ['#8b7bff', '#5b6cff'], onClick: () => playIntro({ accentHue: s.accentHue }) }),
      row('Open on', segCtl([{ value: 'home', label: 'Home' }, { value: 'library', label: 'Library' }], s.startPage, v => updateSettings({ startPage: v }), { label: 'Open on' }))));
    const win = [];
    if (native || document.fullscreenEnabled) win.push(action('Full screen', { icon: 'maximize', tint: ['#9aa6bd', '#6b7790'], value: touch() ? null : 'F11', onClick: () => native ? native.fullscreen() : (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) }));
    win.push(row('Zen mode', switchCtl(s.zenMode, v => { updateSettings({ zenMode: v }); applyTheme(); }, { label: 'Zen mode' }), { desc: touch() ? 'Hide the navigation for distraction-free study.' : 'Hide the sidebar for distraction-free study (Ctrl+Shift+Z).' }));
    if (!touch()) win.push(row('Compact sidebar', switchCtl(s.sidebarCollapsed, v => { updateSettings({ sidebarCollapsed: v }); applyTheme(); renderSidebar(); }, { label: 'Compact sidebar' }), { desc: 'Icons only.' }));
    if (native) win.push(row('Zoom', h('div', { class: 'st-btnrow' }, btn('', () => native.zoom(-0.1), { icon: 'minus', kind: 'quiet' }), btn('Reset', () => native.zoom(0), { kind: 'quiet' }), btn('', () => native.zoom(0.1), { icon: 'plus', kind: 'quiet' })), { desc: `${modKey}+=  ·  ${modKey}+−  ·  ${modKey}+0` }));
    if (!touch()) win.push(action('Keyboard shortcuts', { icon: 'keyboard', tint: ['#9aa6bd', '#6b7790'], value: '?', onClick: showShortcuts }));
    body.append(group('Window', ...win));
  },

  sync(body, { redraw }) {
    const sec = (title, desc, ...kids) => h('section', { class: 'st-group' }, title ? h('h3', { class: 'st-group-t' }, title) : null, h('div', { class: 'st-card is-free' }, desc ? h('p', { class: 'st-free-d' }, desc) : null, ...kids.filter(Boolean)));
    renderSyncSettings(body, sec, redraw);
  },

  data(body, { s, redraw, indexing }) {
    body.append(group('Backup',
      action('Back up now', { icon: 'save', tint: ['#47d38b', '#13a86b'], desc: 'Save a copy of everything on this device.', primary: true, onClick: () => createBackup(true) }),
      action('Export everything', { icon: 'download', tint: ['#5fc4ff', '#2d8cff'], desc: 'One JSON file with all sets, progress and settings.', onClick: () => exportAllJson() }),
      action('Restore from a file', { icon: 'upload', tint: ['#ffb067', '#ff7d3b'], desc: 'Replace this library with a backup or export.', onClick: () => showImportDialog({ restore: true }) }),
      foot('Everything is stored on this device. Back up regularly, or turn on Sync.')));
    const backups = h('div', { class: 'st-card' });
    if (native && !indexing) {
      backups.append(h('div', { class: 'st-row' }, h('span', { class: 'st-row-d' }, 'Loading…')));
      native.backupList().then(list => {
        backups.replaceChildren(...(list.length ? list.slice(0, 10).map(b => h('div', { class: 'st-row st-backup' },
          h('div', { class: 'st-row-t' }, h('span', { class: 'st-row-l' }, fmtDate(b.time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), h('span', { class: 'st-row-d' }, `${(b.size / 1024).toFixed(0)} KB`)),
          h('div', { class: 'st-btnrow' }, btn('Restore', () => restoreBackupFlow(b.path), { kind: 'tonal' }), btn('Show', () => native.showItem(b.path), { kind: 'quiet' })))) : [h('div', { class: 'st-row' }, h('span', { class: 'st-row-d' }, 'No automatic backups yet. The first one is made shortly after launch.'))]));
      });
      native.info().then(i => { const p = body.querySelector('.st-datafolder'); if (p) p.textContent = `Data folder: ${i.userData}`; });
      body.append(h('section', { class: 'st-group' }, h('h3', { class: 'st-group-t' }, 'Automatic backups'), backups, h('p', { class: 'st-foot st-datafolder selectable' }, 'The newest 30 are kept.')));
    }
    const mediaMb = (db.media.all().reduce((a, m) => a + (m.size || 0), 0) / 1024 / 1024);
    const stat = (n, l) => h('div', { class: 'st-stat' }, h('b', {}, typeof n === 'number' ? n.toLocaleString() : n), h('span', {}, l));
    body.append(h('section', { class: 'st-group' }, h('h3', { class: 'st-group-t' }, 'Storage'),
      h('div', { class: 'st-card is-free' }, h('div', { class: 'st-stats', 'data-key': 'storage', 'data-label': 'Storage', 'data-desc': 'sets notes cards reviews media' },
        stat(db.decks.size, 'Sets'), stat(db.notes.size, 'Notes'), stat(db.cards.size, 'Cards'), stat(db.revlog.size, 'Reviews'), stat(db.sessions.size, 'Sessions'), stat(db.media.size, 'Media'), stat(`${mediaMb.toFixed(1)} MB`, 'Media size'))),
      h('div', { class: 'st-card', style: { marginTop: '10px' } },
        action('Export sets…', { icon: 'download', tint: ['#5fc4ff', '#2d8cff'], desc: 'Quizlet text, CSV, Anki or printable PDF.', onClick: () => showExportDialog(null) }),
        action('Clean unused media', { icon: 'sparkles', tint: ['#8b7bff', '#5b6cff'], desc: 'Remove images no card uses any more.', onClick: async () => { const { gcMedia } = await import('../models.js'); const before = db.media.size; gcMedia(); toast(`Removed ${before - db.media.size} unused media items`); redraw(); } }))));
    body.append(group('Danger zone',
      action('Reset all settings', { danger: true, icon: 'refresh', desc: 'Your sets and progress are kept.', onClick: async () => { if (await confirm('Reset every setting to defaults? Your sets and progress are kept.', { danger: true, okLabel: 'Reset' })) { const d = DEFAULT_SETTINGS(); d.onboarded = true; d.xp = s.xp; d.achievementsUnlocked = s.achievementsUnlocked; db.setKV('settings', d); location.reload(); } } }),
      action('Erase all progress', { danger: true, icon: 'clock', desc: 'Review history, scheduling and mastery. Sets and terms are kept.', onClick: async () => { if (await confirm('Erase all review history, scheduling and mastery for every card? Sets and terms are kept.', { danger: true, okLabel: 'Erase progress' })) { const { forgetCards } = await import('../scheduler.js'); const cards = db.cards.all(); cards.forEach(c => { c.mastery = { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 }; }); forgetCards(cards); db.revlog.clear(); db.sessions.clear(); toast('Progress erased'); } } }),
      action('Delete everything', { danger: true, icon: 'trash', desc: 'All sets, cards, history and settings.', onClick: async () => { if (await confirm('Delete ALL sets, cards, history and settings? This cannot be undone.', { danger: true, okLabel: 'Delete everything' })) { if (await confirm('Really delete everything? Last chance.', { danger: true, okLabel: 'Yes, delete it all' })) { await db.wipe(); location.reload(); } } } }),
      foot('These can’t be undone. Make a backup first.')));
  },

  about(body, { indexing }) {
    const version = h('span', {}, native ? '' : '1.0 · web');
    const facts = h('div', { class: 'st-card' });
    const fact = (k, v) => h('div', { class: 'st-row', 'data-key': slug(k), 'data-label': k, 'data-desc': '' }, h('span', { class: 'st-row-l' }, k), h('span', { class: 'st-row-v selectable' }, String(v)));
    if (native && !indexing) native.info().then(i => { version.textContent = `Version ${i.version}`; facts.append(fact('Version', i.version), fact('Electron', i.electron), fact('Chromium', i.chrome), fact('Platform', i.platform)); });
    else facts.append(fact('Version', '1.0.0 (web)'), fact('Storage', 'On this device'));
    body.append(h('div', { class: 'st-about' },
      h('div', { class: 'intro-logo st-logo' }),
      h('div', {}, h('div', { class: 'st-about-n' }, 'Recall'), h('div', { class: 'st-about-s' }, 'Remember everything.'), h('div', { class: 'st-about-v' }, version))));
    body.append(h('section', { class: 'st-group' }, h('h3', { class: 'st-group-t' }, 'This copy'), facts));
    body.append(group('Privacy', row('Your data stays yours', null, { desc: 'Everything lives in a database on this device and in backups you make. With Sync on, it is also stored in your own Supabase project. Otherwise Recall never goes online. No tracking.', key: 'privacy' })));
    body.append(group('Built with', row('Open-source parts', null, { desc: 'Electron · Three.js (intro) · sql.js (Anki import) · JSZip. Scheduling implements SM-2 with Anki-style learning steps, and FSRS-4.5.', key: 'built-with' })));
    if (!indexing) body.append(h('section', { class: 'st-group' }, h('details', { class: 'st-disclosure' }, h('summary', {}, svgIcon('chevronRight', 15), 'Display diagnostics', h('span', {}, 'For screen-size bug reports')), diagnostics())));
  },
};

// ---------- appearance pieces ----------
function miniWin(themeId, vars) { // a tiny app window drawn with that theme's own tokens
  return h('span', { class: 'st-theme-pv', 'data-theme': themeId, style: vars || {} },
    h('i', { class: 'w-side' }), h('i', { class: 'w-card' }, h('i', { class: 'w-acc' }), h('i', { class: 'w-ln' }), h('i', { class: 'w-ln s' })));
}
function preview(s, set) { // live mini Home, drawn with the real tokens, so every change shows here first
  const current = THEMES.find(t => t.id === s.theme) || (s.customThemes || []).find(t => t.id === s.theme);
  return h('div', { class: 'st-preview', 'data-key': 'preview', 'data-label': 'Live preview', 'data-desc': '' },
    h('div', { class: 'st-pv-stage', 'aria-hidden': 'true' },
      h('div', { class: 'st-pv-hero' },
        h('div', { class: 'st-pv-main' }, h('span', { class: 'st-pv-eb' }, h('i'), "Today's session"), h('span', { class: 'st-pv-big' }, '20', h('small', {}, 'cards ready')), h('span', { class: 'st-pv-bar' }, h('i'), h('i'), h('i')), h('span', { class: 'st-pv-btn' }, svgIcon('play', 9), 'Start review')),
        h('div', { class: 'st-pv-deck' }, h('i'), h('i'), h('span', { class: 'st-pv-card' }, h('em', {}, 'Up next'), h('b', {}, 'hola')))),
      h('div', { class: 'st-pv-row' }, h('span', { class: 'st-pv-tile' }), h('span', { class: 'st-pv-tile' }), h('span', { class: 'st-pv-tile' })),
      h('div', { class: 'st-pv-dock' }, h('i', { class: 'on' }), h('i'), h('i'), h('i'), h('b'))),
    h('div', { class: 'st-pv-cap' }, h('span', { class: 'st-pv-k' }, 'Live preview'), h('b', {}, current ? current.name : 'Theme')));
}
async function customThemeDialog(set) {
  const s = S(); const vars = { '--bg': '#0e1018', '--surface': '#171a27', '--surface-2': '#1d2131', '--surface-3': '#262a3c', '--text': '#eef0fa', '--text-muted': '#8a90aa', '--accent': '#6366f1' }; let base = 'dark';
  const name = h('input', { class: 'input', placeholder: 'Theme name', value: 'My theme' });
  const label = { '--bg': 'Background', '--surface': 'Surface', '--surface-2': 'Raised surface', '--surface-3': 'Highest surface', '--text': 'Text', '--text-muted': 'Secondary text', '--accent': 'Accent' };
  const rows = Object.keys(vars).map(k => h('label', { class: 'st-colorrow' }, h('span', {}, label[k]), h('input', { type: 'color', value: vars[k], onInput: e => { vars[k] = e.target.value; } })));
  modal({ title: 'Create a theme', size: 'sm', content: h('div', { class: 'col st-themedlg' }, name, h('div', { class: 'st-colorrow' }, h('span', {}, 'Based on'), segCtl([{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], base, v => { base = v; })), ...rows),
    actions: [{ label: 'Cancel' }, { label: 'Create', variant: 'primary', onClick: () => {
      const id = 'custom_' + Date.now().toString(36); const v = { ...vars }; const [hh] = hexToHsl(v['--accent']); delete v['--accent'];
      Object.assign(v, { '--accent-h': hh, '--accent-s': '80%', '--accent-l': '60%', '--bg-2': v['--bg'], '--card-face': v['--surface'], '--card-face-2': v['--surface-2'], '--titlebar': v['--bg'], '--sidebar': v['--bg'], '--surface-glass': v['--surface'], '--text-2': v['--text'] });
      set({ customThemes: [...(s.customThemes || []), { id, name: name.value || 'Custom', base, vars: v }], theme: id }); return true;
    } }] });
}
function diagnostics() {
  const probe = h('div', { style: { position: 'fixed', top: 0, left: 0, width: 0, height: 0, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', visibility: 'hidden', pointerEvents: 'none' } }); document.body.append(probe);
  const cs = getComputedStyle(probe); const rs = getComputedStyle(document.documentElement); const vv = window.visualViewport;
  const box = h('pre', { class: 'st-diag selectable' });
  box.textContent = [
    'innerHeight × innerWidth: ' + innerHeight + ' × ' + innerWidth,
    'visualViewport: ' + (vv ? Math.round(vv.height) + ' × ' + Math.round(vv.width) : 'n/a'),
    'screen: ' + screen.width + ' × ' + screen.height,
    'clientHeight: ' + document.documentElement.clientHeight,
    'safe areas (t r b l): ' + [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
    '--app-h: ' + (rs.getPropertyValue('--app-h').trim() || 'unset') + '   --vp-gap: ' + (rs.getPropertyValue('--vp-gap').trim() || 'unset'),
    'standalone: ' + (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) + '   touch layout: ' + document.body.classList.contains('tabbar-mode') + '   fix active: ' + document.documentElement.classList.contains('vp-fix'),
    'device: ' + navigator.platform + ' · ' + navigator.maxTouchPoints + ' touch points',
  ].join('\n');
  probe.remove();
  fetch('sw.js', { cache: 'no-store' }).then(r => r.text()).then(t => { const m = t.match(/VERSION = '([^']+)'/); box.textContent += '\nbuild: ' + (m ? m[1] : '?'); }).catch(() => {});
  return box;
}
// keep the old API surface: other modules call saveSettings via settings; nothing else is exported
void saveSettings;
