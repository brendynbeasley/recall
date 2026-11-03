// Shared view helpers: mastery calculation, deck cards, heatmap, charts.
import { db } from '../db.js';
import { deckNotes, noteCards, S } from '../models.js';
import { h, svgIcon, fmtRelative, plural, DAY, clamp } from '../utils.js';
import { dueCounts, TYPE, QUEUE } from '../scheduler.js';
import { navigate, deckContextMenu } from '../app.js';

export function cardLevel(card) {
  let lvl = card.mastery?.level || 0;
  if (card.type === TYPE.REVIEW) lvl = Math.max(lvl, card.ivl >= 21 ? 3 : 2); else if (card.type === TYPE.LEARN || card.type === TYPE.RELEARN) lvl = Math.max(lvl, 1);
  return clamp(lvl, 0, 3);
}
export function deckMastery(deckId) {
  const cards = db.cards.filter(c => c.deckId === deckId); let a = 0, b = 0, c3 = 0;
  for (const c of cards) { const l = cardLevel(c); if (l === 0) a++; else if (l === 3) c3++; else b++; }
  const total = cards.length; return { notStudied: a, learning: b, mastered: c3, total, pct: total ? c3 / total : 0, progress: total ? (c3 + b * 0.5) / total : 0 };
}
export function deckCard(d, { compact = false } = {}) {
  const n = deckNotes(d.id).length; const m = deckMastery(d.id); let due = { new: 0, learn: 0, review: 0 }; try { due = dueCounts(d.id, d); } catch (e) { /* */ }
  const dueTotal = due.new + due.learn + due.review;
  const el = h('div', { class: `deck-card ${compact ? 'compact' : ''}`, style: { '--deck-color': d.color || 'var(--accent)' }, tabindex: 0, onClick: () => navigate(`set/${d.id}`), onKeydown: e => { if (e.key === 'Enter') navigate(`set/${d.id}`); } },
    h('div', { class: 'deck-card-top' }, h('div', { class: 'deck-badge' }, svgIcon(d.icon || 'cards', 18)), h('div', { class: 'grow' }, h('div', { class: 'deck-name ellipsis' }, d.name), h('div', { class: 'deck-meta' }, plural(n, 'term'), d.lastStudied ? ` · studied ${fmtRelative(d.lastStudied)}` : ' · not studied yet')), h('button', { class: 'icon-btn sm', onClick: e => { e.stopPropagation(); deckContextMenu(d, e); } }, svgIcon('moreV', 16))),
    !compact && d.description ? h('p', { class: 'deck-desc' }, d.description) : null,
    h('div', { class: 'deck-progress' }, h('div', { class: 'stacked-bar' }, h('div', { style: { width: `${m.total ? m.mastered / m.total * 100 : 0}%`, background: 'var(--ok)' } }), h('div', { style: { width: `${m.total ? m.learning / m.total * 100 : 0}%`, background: 'var(--warn)' } })), h('div', { class: 'deck-progress-labels' }, h('span', {}, `${Math.round(m.pct * 100)}% mastered`), dueTotal ? h('span', { class: 'badge soft' }, `${dueTotal} due`) : h('span', { class: 'faint' }, 'Up to date'))),
    !compact ? h('div', { class: 'deck-actions' }, h('button', { class: 'btn btn-sm btn-primary', onClick: e => { e.stopPropagation(); navigate(dueTotal ? `study/review/${d.id}` : `study/flashcards/${d.id}`); } }, svgIcon(dueTotal ? 'brain' : 'play', 14), dueTotal ? 'Review' : 'Study'), h('button', { class: 'btn btn-sm btn-ghost', onClick: e => { e.stopPropagation(); navigate(`study/learn/${d.id}`); } }, 'Learn'), h('button', { class: 'btn btn-sm btn-ghost', onClick: e => { e.stopPropagation(); navigate(`study/match/${d.id}`); } }, 'Match')) : null);
  el.addEventListener('contextmenu', e => { e.preventDefault(); deckContextMenu(d, e); });
  return el;
}
export function heatmap(map, { weeks = 26, cellSize = 12, gap = 3, fluid = false } = {}) {
  const wrap = h('div', { class: 'heatmap' }); const days = weeks * 7; const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
  const startDow = (S().weekStart ?? 1); const dow = (todayD.getDay() - startDow + 7) % 7; const first = new Date(todayD.getTime() - (days - 1 - (6 - dow)) * DAY);
  let max = 1; for (const v of map.values()) max = Math.max(max, v);
  const grid = h('div', { class: 'heatmap-grid', style: { gridTemplateRows: `repeat(7, ${cellSize}px)`, gap: gap + 'px', gridAutoColumns: cellSize + 'px' } });
  const monthLabels = h('div', { class: 'heatmap-months' }); let lastMonth = -1;
  for (let i = 0; i < days + (6 - dow); i++) {
    const d = new Date(first.getTime() + i * DAY); const future = d > todayD; const v = map.get(d.toDateString()) || 0; const lvl = future ? -1 : v === 0 ? 0 : Math.min(4, Math.ceil(v / max * 4));
    const col = Math.floor(i / 7);
    grid.append(h('div', { class: `hm-cell lvl-${lvl}`, style: { gridColumn: col + 1, gridRow: (i % 7) + 1 }, 'data-tip': future ? '' : `${v} reviews · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` }));
    if (i % 7 === 0 && d.getMonth() !== lastMonth) { lastMonth = d.getMonth(); monthLabels.append(h('span', { style: { gridColumn: col + 1 } }, d.toLocaleDateString(undefined, { month: 'short' }))); }
  }
  monthLabels.style.gridAutoColumns = (cellSize + gap) + 'px';
  if (fluid) { // stretch cells to fill the container width
    const cols = `repeat(${Math.ceil((days + (6 - dow)) / 7)}, minmax(0, 1fr))`; wrap.classList.add('fluid');
    Object.assign(grid.style, { gridTemplateColumns: cols, gridTemplateRows: 'repeat(7, auto)', gridAutoColumns: '' }); Object.assign(monthLabels.style, { gridTemplateColumns: cols, gridAutoColumns: '', columnGap: gap + 'px' });
  }
  wrap.append(monthLabels, grid, h('div', { class: 'heatmap-legend' }, h('span', {}, 'Less'), ...[0, 1, 2, 3, 4].map(l => h('div', { class: `hm-cell lvl-${l}` })), h('span', {}, 'More')));
  return wrap;
}
// Simple SVG bar chart
export function barChart(data, { height = 160, color = 'var(--accent)', labelEvery = 1, valueFmt = v => v, showValues = false, colors } = {}) {
  const n = data.length; const max = Math.max(1, ...data.map(d => d.n || d.value || 0));
  const wrap = h('div', { class: 'bar-chart', style: { height: height + 'px' } });
  data.forEach((d, i) => { const v = d.n ?? d.value ?? 0; const bar = h('div', { class: 'bar-col', 'data-tip': `${d.label}: ${valueFmt(v)}` }, showValues && v ? h('span', { class: 'bar-val' }, valueFmt(v)) : null, h('div', { class: 'bar', style: { height: `${Math.max(v ? 2 : 0, v / max * 100)}%`, background: colors ? colors[i % colors.length] : (d.color || color) } }), h('span', { class: 'bar-label' }, i % labelEvery === 0 ? d.label : '')); wrap.append(bar); });
  return wrap;
}
export function lineChart(points, { height = 160, color = 'var(--accent)', fill = true, labels = [], valueFmt = v => v, yMax } = {}) {
  const w = 600, hgt = height; const max = yMax || Math.max(1, ...points); const pad = 6;
  const xs = points.map((_, i) => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2)); const ys = points.map(v => hgt - pad - (v / max) * (hgt - pad * 2));
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const svg = h('div', { class: 'line-chart' }); svg.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" style="width:100%;height:${hgt}px;overflow:visible"><defs><linearGradient id="lg${Math.random().toString(36).slice(2, 6)}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${fill ? `<path d="${path} L${xs[xs.length - 1]},${hgt} L${xs[0]},${hgt} Z" fill="url(#${svg.innerHTML ? '' : ''}lg)" opacity=".6"/>` : ''}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="3" fill="${color}"><title>${labels[i] || ''}: ${valueFmt(points[i])}</title></circle>`).join('')}</svg>`;
  // fix gradient id reference
  const gid = svg.querySelector('linearGradient').id; const fp = svg.querySelector('path'); if (fill && fp) fp.setAttribute('fill', `url(#${gid})`);
  if (labels.length) svg.append(h('div', { class: 'line-labels' }, ...labels.map((l, i) => h('span', {}, i % Math.ceil(labels.length / 8) === 0 ? l : ''))));
  return svg;
}
export function donut(parts, { size = 120, stroke = 16, centerLabel, centerSub } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1; const r = (size - stroke) / 2; const c = 2 * Math.PI * r; let off = 0;
  const segs = parts.map(p => { const len = p.value / total * c; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${p.label}: ${p.value}</title></circle>`; off += len; return s; }).join('');
  const el = h('div', { class: 'donut', style: { width: size + 'px', height: size + 'px' } }); el.innerHTML = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>${segs}</svg>`;
  if (centerLabel !== undefined) el.append(h('div', { class: 'donut-center' }, h('b', {}, centerLabel), centerSub ? h('span', {}, centerSub) : null));
  return el;
}
export function legend(parts) { return h('div', { class: 'legend' }, ...parts.map(p => h('span', { class: 'legend-item' }, h('i', { style: { background: p.color } }), `${p.label}`, h('b', {}, p.value)))); }
export function cardStateCounts(deckId) {
  let nw = 0, learn = 0, young = 0, mature = 0, susp = 0, buried = 0;
  for (const c of db.cards.all()) { if (deckId && c.deckId !== deckId) continue; if (c.queue === QUEUE.SUSPENDED) susp++; else if (c.queue === QUEUE.BURIED) buried++; else if (c.type === TYPE.NEW) nw++; else if (c.type === TYPE.REVIEW) { if (c.ivl >= 21) mature++; else young++; } else learn++; }
  return { new: nw, learn, young, mature, suspended: susp, buried };
}
