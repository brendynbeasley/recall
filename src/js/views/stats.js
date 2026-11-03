// Statistics: Anki-style graphs + Quizlet-style session history
import { db } from '../db.js';
import { S, deckNotes } from '../models.js';
import { h, svgIcon, fmtDuration, fmtDate, plural, DAY, pct } from '../utils.js';
import { pageHeader, select, segmented } from '../ui.js';
import { forecast, intervalHistogram, easeHistogram, reviewHeatmap, retentionStats, TYPE, streakInfo, todayCounts } from '../scheduler.js';
import { heatmap, barChart, lineChart, donut, legend, cardStateCounts, deckMastery } from './common.js';
import { navigate } from '../app.js';
import { MODES, GAMES } from './deck.js';

export function render(main, route) {
  let deckId = route.query.deck || null; let range = 30;
  const inner = h('div', { class: 'main-inner' }); main.append(inner);
  const draw = () => {
    inner.innerHTML = '';
    const deck = deckId ? db.decks.get(deckId) : null; if (deckId && !deck) deckId = null;
    inner.append(pageHeader('Statistics', deck ? deck.name : 'Across your whole library', select([{ value: '', label: 'All sets' }, ...db.decks.all().sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ value: d.id, label: d.name }))], deckId || '', v => { deckId = v || null; history.replaceState(null, '', `#/stats${deckId ? '?deck=' + deckId : ''}`); draw(); }), segmented([{ value: 7, label: '1W' }, { value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }], range, v => { range = v; draw(); })));
    const logs = db.revlog.filter(r => (!deckId || r.deckId === deckId) && r.kind === 'review'); const since = Date.now() - range * DAY; const recent = logs.filter(r => r.time >= since);
    const sessions = db.sessions.filter(s => (!deckId || s.deckId === deckId)).sort((a, b) => b.start - a.start);
    const todayC = todayCounts(deckId); const ret = retentionStats(deckId, range); const streak = streakInfo(); const states = cardStateCounts(deckId);
    const totalCards = Object.values(states).reduce((a, b) => a + b, 0);
    const timeMs = recent.reduce((a, r) => a + (r.took || 0), 0) + sessions.filter(s => s.start >= since && s.mode !== 'review').reduce((a, s) => a + Math.min((s.end || s.start) - s.start, 3 * 3600000), 0);
    const daysStudied = new Set(recent.map(r => new Date(r.time).toDateString())).size;
    inner.append(h('div', { class: 'grid-4 stagger' }, tile('Reviews today', todayC.total, `${fmtDuration(todayC.time)} · ${todayC.newDone} new`, 'activity'), tile(`Reviews (${range}d)`, recent.length, `${daysStudied} days studied · avg ${daysStudied ? Math.round(recent.length / daysStudied) : 0}/day`, 'calendar'), tile(`Retention (${range}d)`, ret.retention == null ? '—' : `${Math.round(ret.retention * 100)}%`, ret.mature == null ? 'No mature reviews yet' : `Mature: ${Math.round(ret.mature * 100)}%`, 'target'), tile(`Time (${range}d)`, fmtDuration(timeMs), `Streak ${streak.current}d · best ${streak.best}d`, 'clock')));
    // Reviews per day (stacked by card type)
    const days = []; for (let i = range - 1; i >= 0; i--) { const d = new Date(Date.now() - i * DAY); days.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), n: 0, learn: 0, young: 0, mature: 0, relearn: 0 }); }
    const dayMap = new Map(days.map(d => [d.key, d]));
    for (const r of recent) { const d = dayMap.get(new Date(r.time).toDateString()); if (!d) continue; d.n++; if (r.type === TYPE.NEW) d.learn++; else if (r.type === TYPE.REVIEW) { if (r.lastIvl >= 21) d.mature++; else d.young++; } else d.relearn++; }
    inner.append(panel('Reviews', `${recent.length} reviews in the last ${range} days`, stackedBars(days, [['learn', 'Learning', '#f59e0b'], ['relearn', 'Relearning', '#f43f5e'], ['young', 'Young', '#3b82f6'], ['mature', 'Mature', '#10b981']], range)));
    // Forecast + card counts
    const fc = forecast(deckId, Math.min(range, 90)); const fcDays = fc.map((n, i) => { const d = new Date(Date.now() + i * DAY); return { label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), n }; });
    const stateParts = [{ label: 'New', value: states.new, color: '#3b82f6' }, { label: 'Learning', value: states.learn, color: '#f59e0b' }, { label: 'Young', value: states.young, color: '#14b8a6' }, { label: 'Mature', value: states.mature, color: '#10b981' }, { label: 'Suspended', value: states.suspended, color: '#94a3b8' }, { label: 'Buried', value: states.buried, color: '#64748b' }];
    inner.append(h('div', { class: 'grid-2' }, panel('Future due', `${fc.reduce((a, b) => a + b, 0)} reviews due in the next ${fc.length} days`, barChart(fcDays, { height: 170, color: 'var(--accent)', labelEvery: Math.ceil(fc.length / 8) })), panel('Card counts', `${totalCards} cards`, h('div', { class: 'row', style: { gap: '20px' } }, donut(stateParts, { size: 150, stroke: 20, centerLabel: totalCards, centerSub: 'cards' }), legend(stateParts.filter(p => p.value))))));
    // Intervals + ease
    inner.append(h('div', { class: 'grid-2' }, panel('Review intervals', 'Delays until reviews are shown again', barChart(intervalHistogram(deckId), { height: 150, color: '#14b8a6' })), panel('Card ease', 'Lower ease means a card is harder for you', barChart(easeHistogram(deckId), { height: 150, color: '#8b5cf6', labelEvery: 2 }))));
    // Hourly breakdown + answer buttons
    const hours = Array.from({ length: 24 }, (_, i) => ({ label: `${i}`, n: 0, ok: 0 })); for (const r of logs) { const hh = new Date(r.time).getHours(); hours[hh].n++; if (r.rating > 1) hours[hh].ok++; }
    const buttons = [[TYPE.NEW, 'Learning'], [TYPE.REVIEW, 'Review'], [TYPE.RELEARN, 'Relearning']].map(([t, name]) => { const rs = recent.filter(r => (t === TYPE.NEW ? (r.type === TYPE.NEW || r.type === TYPE.LEARN) : r.type === t)); const counts = [1, 2, 3, 4].map(k => rs.filter(r => r.rating === k).length); return { name, counts, total: rs.length }; });
    inner.append(h('div', { class: 'grid-2' }, panel('Hourly breakdown', 'When you review and how well', barChart(hours.map(x => ({ label: x.label, n: x.n })), { height: 140, color: '#f97316', labelEvery: 3 })), panel('Answer buttons', 'How you rated cards', h('div', { class: 'col', style: { gap: '14px' } }, ...buttons.map(b => h('div', {}, h('div', { class: 'row between small' }, h('b', {}, b.name), h('span', { class: 'muted' }, b.total ? `${Math.round((b.total - b.counts[0]) / b.total * 100)}% correct · ${b.total} answers` : 'No data')), h('div', { class: 'stacked-bar', style: { height: '14px', marginTop: '4px' } }, ...b.counts.map((c, i) => h('div', { style: { width: `${b.total ? c / b.total * 100 : 0}%`, background: ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6'][i] }, 'data-tip': `${['Again', 'Hard', 'Good', 'Easy'][i]}: ${c}` }))))), legend([{ label: 'Again', value: '', color: '#f43f5e' }, { label: 'Hard', value: '', color: '#f59e0b' }, { label: 'Good', value: '', color: '#10b981' }, { label: 'Easy', value: '', color: '#3b82f6' }])))));
    // Heatmap
    inner.append(panel('Activity', `${logs.length} reviews all time · ${streak.totalDays} days studied`, heatmap(reviewHeatmap(deckId, 365), { weeks: 52, cellSize: 11 })));
    // Mastery per set
    if (!deckId) { const rows = db.decks.filter(d => !d.archived).map(d => ({ d, m: deckMastery(d.id) })).filter(x => x.m.total).sort((a, b) => b.m.pct - a.m.pct); if (rows.length) inner.append(panel('Mastery by set', 'Share of cards mastered in each set', h('div', { class: 'col', style: { gap: '10px' } }, ...rows.map(({ d, m }) => h('div', { class: 'mastery-row', onClick: () => navigate(`stats?deck=${d.id}`) }, h('span', { class: 'ellipsis', style: { width: '220px' } }, d.name), h('div', { class: 'stacked-bar grow', style: { height: '12px' } }, h('div', { style: { width: `${m.mastered / m.total * 100}%`, background: 'var(--ok)' } }), h('div', { style: { width: `${m.learning / m.total * 100}%`, background: 'var(--warn)' } })), h('b', { style: { width: '48px', textAlign: 'right' } }, `${Math.round(m.pct * 100)}%`)))))); }
    // Session history
    const modeName = (id) => (MODES.find(m => m.id === id) || GAMES.find(g => g.id === id) || { name: id }).name;
    inner.append(panel('Session history', `${sessions.length} sessions`, sessions.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Set'), h('th', {}, 'Mode'), h('th', {}, 'Cards'), h('th', {}, 'Correct'), h('th', {}, 'Score'), h('th', {}, 'Time'), h('th', {}, 'XP'))), h('tbody', {}, ...sessions.slice(0, 40).map(s => h('tr', { onClick: () => db.decks.has(s.deckId) && navigate(`set/${s.deckId}`) }, h('td', {}, fmtDate(s.start, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('td', { class: 'bold' }, db.decks.get(s.deckId)?.name || (s.deckId === 'all' ? 'All sets' : '(deleted)')), h('td', {}, h('span', { class: 'chip' }, modeName(s.mode))), h('td', {}, s.cards || 0), h('td', {}, s.correct + s.wrong ? `${pct(s.correct, s.correct + s.wrong)}%` : '—'), h('td', {}, s.score != null ? (s.mode === 'match' || s.mode === 'memory' ? `${s.score}s` : s.score) : '—'), h('td', {}, fmtDuration((s.end || s.start) - s.start, true)), h('td', { class: 'muted' }, s.xp ? `+${s.xp}` : ''))))) : h('p', { class: 'muted' }, 'No sessions yet. Study a set to see history here.')));
  };
  draw();
  function tile(label, value, sub, icon) { return h('div', { class: 'stat-tile' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-sub' }, sub), h('div', { class: 'stat-icon' }, svgIcon(icon, 20))); }
  function panel(title, sub, content) { return h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'panel-title' }, h('div', {}, h('div', {}, title), h('div', { class: 'small muted', style: { fontWeight: 400 } }, sub))), content); }
  function stackedBars(days, series, range) {
    const max = Math.max(1, ...days.map(d => d.n)); const wrap = h('div', { class: 'bar-chart', style: { height: '180px' } });
    days.forEach((d, i) => { const col = h('div', { class: 'bar-col', 'data-tip': `${d.label}: ${d.n} reviews` }, h('div', { class: 'bar stacked', style: { height: `${d.n / max * 100}%` } }, ...series.map(([k, name, color]) => h('div', { style: { flex: d[k], background: color } }))), h('span', { class: 'bar-label' }, i % Math.ceil(range / 8) === 0 ? d.label : '')); wrap.append(col); });
    return h('div', {}, wrap, legend(series.map(([k, name, color]) => ({ label: name, value: days.reduce((a, d) => a + d[k], 0), color }))));
  }
}
