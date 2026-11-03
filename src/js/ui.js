// UI kit: modals, dialogs, toasts, dropdown & context menus, tooltips, confetti, progress rings, keyboard chips.
import { h, $, $$, svgIcon, escapeHtml, sleep, clamp } from './utils.js';
import { sfx } from './audio.js';
import { S } from './models.js';

// ---------- Modal ----------
const modalStack = [];
export function modal({ title, content, actions = [], size = 'md', closable = true, onClose, className = '', noPad = false }) {
  const overlay = h('div', { class: 'overlay modal-overlay' });
  const box = h('div', { class: `modal modal-${size} ${className}`, role: 'dialog', 'aria-modal': 'true' });
  const close = (result) => { if (!overlay.isConnected) return; overlay.classList.add('closing'); box.classList.add('closing'); setTimeout(() => overlay.remove(), 180); modalStack.splice(modalStack.indexOf(api), 1); onClose && onClose(result); api.resolve(result); };
  const api = { overlay, box, close, resolve: () => {}, body: null };
  api.promise = new Promise(r => { api.resolve = r; });
  if (title !== false) box.append(h('div', { class: 'modal-head' }, h('h3', { class: 'modal-title' }, title || ''), closable ? h('button', { class: 'icon-btn modal-close', title: 'Close (Esc)', onClick: () => close(null) }, svgIcon('x')) : null));
  api.body = h('div', { class: `modal-body ${noPad ? 'nopad' : ''}` }); if (content) api.body.append(typeof content === 'string' ? h('div', { html: content }) : content); box.append(api.body);
  if (actions.length) box.append(h('div', { class: 'modal-actions' }, ...actions.map(a => h('button', { class: `btn ${a.variant ? 'btn-' + a.variant : ''} ${a.className || ''}`, disabled: a.disabled, onClick: async () => { const r = a.onClick ? await a.onClick(api) : a.value; if (r !== false && !a.keepOpen) close(r === undefined ? a.value : r); } }, a.icon ? svgIcon(a.icon, 16) : null, a.label))));
  overlay.append(box); document.body.append(overlay);
  if (closable) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(null); });
  modalStack.push(api);
  requestAnimationFrame(() => { overlay.classList.add('show'); const f = box.querySelector('input,textarea,select,button.btn-primary,[autofocus]'); if (f && !box.querySelector('[autofocus]')) { /* don't steal focus from text areas */ } (box.querySelector('[autofocus]') || box.querySelector('input,textarea'))?.focus(); });
  return api;
}
export function topModal() { return modalStack[modalStack.length - 1]; }
export function closeAllModals() { while (modalStack.length) modalStack[modalStack.length - 1].close(null); }
export function confirm(message, { title = 'Are you sure?', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return modal({ title, content: h('p', { class: 'modal-message' }, message), size: 'sm', actions: [{ label: cancelLabel, value: false }, { label: okLabel, value: true, variant: danger ? 'danger' : 'primary', className: 'autofocus-btn' }] }).promise.then(v => !!v);
}
export function alert(message, title = 'Notice') { return modal({ title, content: h('p', { class: 'modal-message' }, message), size: 'sm', actions: [{ label: 'OK', value: true, variant: 'primary' }] }).promise; }
export function prompt(message, { title = 'Enter a value', value = '', placeholder = '', okLabel = 'Save', multiline = false, validate } = {}) {
  let input;
  const m = modal({ title, size: 'sm', content: h('div', {}, message ? h('p', { class: 'modal-message' }, message) : null, input = multiline ? h('textarea', { class: 'input', rows: 5, placeholder, value, autofocus: true }) : h('input', { class: 'input', type: 'text', placeholder, value, autofocus: true })),
    actions: [{ label: 'Cancel', value: null }, { label: okLabel, variant: 'primary', onClick: () => { const v = input.value; if (validate) { const err = validate(v); if (err) { toast(err, 'error'); return false; } } return v; } }] });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); const v = input.value; if (validate && validate(v)) { toast(validate(v), 'error'); return; } m.close(v); } });
  setTimeout(() => { input.focus(); input.select && input.select(); }, 60);
  return m.promise;
}
export function choose(title, options, { message } = {}) {
  // options: [{label, value, icon, description}]
  const m = modal({ title, size: 'sm', content: h('div', { class: 'choice-list' }, message ? h('p', { class: 'modal-message' }, message) : null, ...options.map(o => h('button', { class: 'choice-item', onClick: () => m.close(o.value) }, o.icon ? svgIcon(o.icon) : null, h('div', {}, h('div', { class: 'choice-label' }, o.label), o.description ? h('div', { class: 'choice-desc' }, o.description) : null)))) });
  return m.promise;
}

// ---------- Toasts ----------
let toastWrap = null;
export function toast(message, type = 'info', { duration = 3200, action, actionLabel } = {}) {
  if (!toastWrap) { toastWrap = h('div', { class: 'toast-wrap' }); document.body.append(toastWrap); }
  const icon = { info: 'info', success: 'check', error: 'alert', warning: 'alert', star: 'star', trophy: 'trophy' }[type] || 'info';
  const t = h('div', { class: `toast toast-${type}` }, svgIcon(icon, 18), h('span', { class: 'toast-msg' }, message), action ? h('button', { class: 'btn btn-sm btn-ghost', onClick: () => { action(); remove(); } }, actionLabel || 'Undo') : null, h('button', { class: 'icon-btn toast-x', onClick: () => remove() }, svgIcon('x', 14)));
  const remove = () => { t.classList.add('hide'); setTimeout(() => t.remove(), 250); };
  toastWrap.append(t); requestAnimationFrame(() => t.classList.add('show'));
  if (duration > 0) setTimeout(remove, duration);
  return remove;
}

// ---------- Menus ----------
let openMenu = null;
export function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } }
document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (openMenu) { closeMenus(); e.stopPropagation(); } } }, true);
window.addEventListener('blur', closeMenus); window.addEventListener('resize', closeMenus);
// items: [{label, icon, onClick, danger, disabled, shortcut, checked, separator, submenu:[...] , header}]
export function showMenu(items, { x, y, anchor, align = 'left', minWidth = 200 } = {}) {
  closeMenus();
  const menu = h('div', { class: 'menu', role: 'menu', style: { minWidth: minWidth + 'px' } });
  const build = (list, container) => {
    for (const it of list) {
      if (!it) continue;
      if (it.separator) { container.append(h('div', { class: 'menu-sep' })); continue; }
      if (it.header) { container.append(h('div', { class: 'menu-header' }, it.header)); continue; }
      const el = h('button', { class: `menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''} ${it.checked === true ? 'checked' : ''}`, disabled: it.disabled, role: 'menuitem' },
        h('span', { class: 'menu-icon' }, it.checked === true ? svgIcon('check', 16) : it.icon ? svgIcon(it.icon, 16) : null),
        h('span', { class: 'menu-label' }, it.label), it.shortcut ? h('kbd', { class: 'menu-kbd' }, it.shortcut) : null, it.submenu ? svgIcon('chevronRight', 14) : null);
      if (it.color) el.prepend(h('span', { class: 'menu-swatch', style: { background: it.color } }));
      if (it.submenu) { const sub = h('div', { class: 'menu submenu' }); build(it.submenu, sub); el.append(sub); el.classList.add('has-sub'); }
      else el.addEventListener('click', e => { e.stopPropagation(); if (it.disabled) return; closeMenus(); it.onClick && it.onClick(e); });
      container.append(el);
    }
  };
  build(items, menu);
  document.body.append(menu); openMenu = menu;
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
  const mw = menu.offsetWidth, mh = menu.offsetHeight; const vw = window.innerWidth, vh = window.innerHeight;
  let left = align === 'right' ? r.right - mw : r.left; let top = anchor ? r.bottom + 6 : r.top;
  if (left + mw > vw - 8) left = vw - mw - 8; if (left < 8) left = 8;
  if (top + mh > vh - 8) top = anchor ? Math.max(8, r.top - mh - 6) : Math.max(8, vh - mh - 8);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('show'));
  const first = menu.querySelector('.menu-item:not(.disabled)'); first && first.focus();
  menu.addEventListener('keydown', e => { const items = $$('.menu-item:not(.disabled)', menu).filter(i => !i.closest('.submenu')); const i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); } });
  return menu;
}
export function contextMenu(el, itemsFn) { el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); const items = typeof itemsFn === 'function' ? itemsFn(e) : itemsFn; if (items && items.length) showMenu(items, { x: e.clientX, y: e.clientY }); }); }

// ---------- Tooltip ----------
let tip = null, tipTimer = null;
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) return;
  clearTimeout(tipTimer); tipTimer = setTimeout(() => {
    if (!tip) { tip = h('div', { class: 'tooltip' }); document.body.append(tip); }
    tip.innerHTML = escapeHtml(t.dataset.tip) + (t.dataset.kbd ? ` <kbd>${escapeHtml(t.dataset.kbd)}</kbd>` : '');
    const r = t.getBoundingClientRect(); tip.classList.add('show');
    const tw = tip.offsetWidth; let left = r.left + r.width / 2 - tw / 2; left = clamp(left, 8, window.innerWidth - tw - 8);
    const pos = t.dataset.tipPos || 'bottom'; let top = pos === 'top' ? r.top - tip.offsetHeight - 8 : r.bottom + 8; if (top < 4) top = r.bottom + 8; if (top + tip.offsetHeight > window.innerHeight) top = r.top - tip.offsetHeight - 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }, 450);
});
document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-tip]')) { clearTimeout(tipTimer); tip && tip.classList.remove('show'); } });
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tip && tip.classList.remove('show'); });

// ---------- Confetti ----------
let confettiCanvas = null;
export function confetti({ count = 140, origin, spread = 70, power = 1, colors } = {}) {
  if (S() && (S().confetti === false || S().reducedMotion)) return;
  if (!confettiCanvas) { confettiCanvas = h('canvas', { class: 'confetti-canvas' }); document.body.append(confettiCanvas); }
  const c = confettiCanvas; c.width = window.innerWidth; c.height = window.innerHeight; const ctx = c.getContext('2d');
  const cols = colors || ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#f43f5e', '#a855f7', '#facc15'];
  const ox = origin ? origin.x : c.width / 2, oy = origin ? origin.y : c.height * 0.4;
  const parts = Array.from({ length: count }, () => { const a = (-90 + (Math.random() - 0.5) * spread) * Math.PI / 180; const v = (8 + Math.random() * 9) * power; return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 6 + Math.random() * 6, hgt: 8 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, col: cols[Math.floor(Math.random() * cols.length)], life: 1, shape: Math.random() < 0.3 ? 'circle' : 'rect' }; });
  let frame; const start = performance.now();
  const step = (t) => { const el = (t - start) / 1000; ctx.clearRect(0, 0, c.width, c.height); let alive = 0;
    for (const p of parts) { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life = Math.max(0, 1 - el / 3.2); if (p.y > c.height + 20 || p.life <= 0) continue; alive++; ctx.save(); ctx.globalAlpha = p.life; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt * Math.abs(Math.cos(el * 6 + p.r))); ctx.restore(); }
    if (alive && el < 4) frame = requestAnimationFrame(step); else ctx.clearRect(0, 0, c.width, c.height); };
  cancelAnimationFrame(frame); frame = requestAnimationFrame(step);
}
export function burst(el, type = 'success') { // tiny particle burst from an element
  if (S() && S().reducedMotion) return;
  const r = el.getBoundingClientRect(); confetti({ count: type === 'success' ? 36 : 18, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, spread: 360, power: 0.5, colors: type === 'success' ? ['#10b981', '#34d399', '#a7f3d0', '#facc15'] : ['#f43f5e', '#fb7185', '#fecdd3'] });
}
export function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 500); }
export function pulse(el, cls = 'pulse-ok') { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 700); }

// ---------- Components ----------
export function progressRing({ value = 0, size = 64, stroke = 6, color = 'var(--accent)', track = 'var(--surface-3)', label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const wrap = h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } });
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/><circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(value, 0, 1))}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  if (label !== undefined) wrap.append(h('div', { class: 'ring-label' }, label));
  wrap.set = (v) => { wrap.querySelector('.ring-val').setAttribute('stroke-dashoffset', c * (1 - clamp(v, 0, 1))); };
  return wrap;
}
export function progressBar(value, { className = '', color } = {}) { const b = h('div', { class: `progress ${className}` }, h('div', { class: 'progress-fill', style: { width: `${clamp(value, 0, 1) * 100}%`, background: color || '' } })); b.set = v => { b.firstChild.style.width = `${clamp(v, 0, 1) * 100}%`; }; return b; }
export function segmented(options, value, onChange, { className = '' } = {}) {
  const wrap = h('div', { class: `segmented ${className}`, role: 'tablist' });
  const render = () => { wrap.innerHTML = ''; for (const o of options) wrap.append(h('button', { class: `seg ${o.value === value ? 'active' : ''}`, role: 'tab', 'data-tip': o.tip, onClick: () => { if (o.value === value) return; value = o.value; render(); onChange(value); } }, o.icon ? svgIcon(o.icon, 16) : null, o.label !== undefined ? h('span', {}, o.label) : null)); };
  render(); wrap.setValue = (v) => { value = v; render(); }; return wrap;
}
export function toggle(checked, onChange, { label, description, disabled } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled, onChange: e => onChange(e.target.checked) });
  const sw = h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
  if (!label) return sw;
  return h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), description ? h('div', { class: 'setting-desc' }, description) : null), sw);
}
export function settingRow(label, control, description) { return h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), description ? h('div', { class: 'setting-desc' }, description) : null), h('div', { class: 'setting-control' }, control)); }
export function select(options, value, onChange, { className = '' } = {}) {
  const s = h('select', { class: `input select ${className}`, onChange: e => onChange(e.target.value) }, ...options.map(o => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  return s;
}
export function numberInput(value, onChange, { min, max, step = 1, className = '', suffix } = {}) {
  const i = h('input', { class: `input num ${className}`, type: 'number', value, min, max, step, onChange: e => { let v = parseFloat(e.target.value); if (isNaN(v)) v = min ?? 0; if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); e.target.value = v; onChange(v); } });
  return suffix ? h('div', { class: 'input-suffix' }, i, h('span', {}, suffix)) : i;
}
export function slider(value, onChange, { min = 0, max = 100, step = 1, format } = {}) {
  const out = h('span', { class: 'slider-val' }, format ? format(value) : value);
  const i = h('input', { type: 'range', class: 'range', min, max, step, value, onInput: e => { const v = parseFloat(e.target.value); out.textContent = format ? format(v) : v; onChange(v); } });
  return h('div', { class: 'slider-wrap' }, i, out);
}
export function kbd(keys) { return h('span', { class: 'kbd-group' }, ...String(keys).split('+').map(k => h('kbd', {}, k))); }
export function emptyState({ icon = 'cards', title, message, action, actionLabel }) { return h('div', { class: 'empty-state' }, h('div', { class: 'empty-icon' }, svgIcon(icon, 40)), h('h3', {}, title), message ? h('p', {}, message) : null, action ? h('button', { class: 'btn btn-primary', onClick: action }, actionLabel) : null); }
export function chip(text, { color, onRemove, onClick, active } = {}) { return h('span', { class: `chip ${active ? 'active' : ''} ${onClick ? 'clickable' : ''}`, style: color ? { '--chip': color } : null, onClick }, text, onRemove ? h('button', { class: 'chip-x', onClick: e => { e.stopPropagation(); onRemove(); } }, svgIcon('x', 12)) : null); }
export function card(...children) { return h('div', { class: 'card-panel' }, ...children); }
export function pageHeader(title, subtitle, ...actions) { return h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, title), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null), h('div', { class: 'page-actions' }, ...actions)); }
export function tabs(items, active, onChange) { const wrap = h('div', { class: 'tabs' }); const render = () => { wrap.innerHTML = ''; for (const it of items) wrap.append(h('button', { class: `tab ${it.id === active ? 'active' : ''}`, onClick: () => { active = it.id; render(); onChange(active); } }, it.icon ? svgIcon(it.icon, 16) : null, it.label, it.count != null ? h('span', { class: 'tab-count' }, it.count) : null)); }; render(); return wrap; }

// Color picker (palette)
export const PALETTE = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#64748b'];
export function colorPicker(value, onChange) {
  const wrap = h('div', { class: 'color-grid' });
  const render = () => { wrap.innerHTML = ''; for (const c of PALETTE) wrap.append(h('button', { class: `swatch ${c === value ? 'active' : ''}`, style: { background: c }, onClick: () => { value = c; render(); onChange(c); } }, c === value ? svgIcon('check', 14) : null)); };
  render(); return wrap;
}

// Countdown overlay (3,2,1,Go!)
export async function countdown(container, { from = 3, label = 'Go!' } = {}) {
  if (S() && S().reducedMotion) return;
  const el = h('div', { class: 'countdown' }); container.append(el);
  for (let i = from; i >= 1; i--) { el.textContent = i; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sfx.tick(); await sleep(700); }
  el.textContent = label; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sfx.pop(); await sleep(500); el.remove();
}
// Floating number (+10 XP etc.)
export function floatText(x, y, text, cls = '') { if (S() && S().reducedMotion) return; const el = h('div', { class: `float-text ${cls}`, style: { left: x + 'px', top: y + 'px' } }, text); document.body.append(el); setTimeout(() => el.remove(), 1200); }

// Keyboard shortcuts help overlay (populated by app)
export function shortcutsModal(groups) {
  modal({ title: 'Keyboard shortcuts', size: 'lg', content: h('div', { class: 'shortcut-grid' }, ...groups.map(g => h('div', { class: 'shortcut-group' }, h('h4', {}, g.title), ...g.items.map(it => h('div', { class: 'shortcut-row' }, h('span', {}, it.label), kbd(it.keys)))))) });
}
export function dragSort(container, { handle = '.drag-handle', onSort, itemSel = '.sortable-item' } = {}) {
  let dragging = null, placeholder = null;
  container.addEventListener('dragstart', e => { const it = e.target.closest(itemSel); if (!it) return; dragging = it; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* */ } });
  container.addEventListener('dragover', e => { if (!dragging) return; e.preventDefault(); const over = e.target.closest(itemSel); if (!over || over === dragging) return; const r = over.getBoundingClientRect(); const after = (e.clientY - r.top) > r.height / 2; container.insertBefore(dragging, after ? over.nextSibling : over); });
  container.addEventListener('dragend', () => { if (!dragging) return; dragging.classList.remove('dragging'); dragging = null; onSort && onSort($$(itemSel, container).map(el => el.dataset.id)); });
  $$(itemSel, container).forEach(it => { it.draggable = true; });
}
