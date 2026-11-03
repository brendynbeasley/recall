// Home dashboard
import { db } from '../db.js';
import { S, deckNotes } from '../models.js';
import { h, svgIcon, fmtDuration, plural, pct } from '../utils.js';
import { progressRing, pageHeader } from '../ui.js';
import { dueCounts, streakInfo, reviewHeatmap, todayCounts, retentionStats, forecast } from '../scheduler.js';
import { todayStudy, levelProgress, levelTitle, ACHIEVEMENTS } from '../xp.js';
import { navigate, createSetFlow } from '../app.js';
import { deckCard, heatmap, deckMastery, barChart } from './common.js';
import { MODES, GAMES } from './deck.js';
import { showImportDialog } from '../importers.js';

export function render(main) {
  const s = S(); const hour = new Date().getHours(); const greet = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const decks = db.decks.filter(d => !d.archived); const due = dueCounts(null); const totalDue = due.new + due.learn + due.review; const streak = streakInfo(); const ts = todayStudy(); const lp = levelProgress();
  const inner = h('div', { class: 'main-inner home' });
  inner.append(pageHeader(`${greet}.`, totalDue ? `You have ${plural(totalDue, 'card')} due across ${plural(decks.filter(d => { const c = dueCounts(d.id, d); return c.new + c.learn + c.review > 0; }).length, 'set')}.` : (decks.length ? 'Everything is up to date. Pick a set to keep sharpening your memory.' : 'Create your first set to get started.'),
    h('button', { class: 'btn', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import'), h('button', { class: 'btn btn-primary', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'Create')));

  // Hero row: due + goal + streak + level
  const hero = h('div', { class: 'home-hero stagger' });
  hero.append(h('div', { class: 'hero-card due-card', onClick: () => totalDue && navigate('study/review/all') },
    h('div', { class: 'hero-label' }, svgIcon('brain', 16), 'Due now'), h('div', { class: 'hero-value' }, totalDue), h('div', { class: 'hero-breakdown' }, h('span', { class: 'b-new' }, `${due.new} new`), h('span', { class: 'b-learn' }, `${due.learn} learning`), h('span', { class: 'b-review' }, `${due.review} review`)),
    h('button', { class: 'btn btn-primary btn-lg', disabled: !totalDue, onClick: e => { e.stopPropagation(); navigate('study/review/all'); } }, svgIcon('play', 16), totalDue ? 'Study all due' : 'All caught up')));
  const goalPct = Math.min(1, ts.cards / ts.goalCards);
  hero.append(h('div', { class: 'hero-card' }, h('div', { class: 'hero-label' }, svgIcon('target', 16), 'Daily goal'), h('div', { class: 'row', style: { gap: '16px', marginTop: '8px' } }, progressRing({ value: goalPct, size: 84, stroke: 9, label: `${Math.round(goalPct * 100)}%`, color: goalPct >= 1 ? 'var(--ok)' : 'var(--accent)' }), h('div', {}, h('div', { class: 'hero-mini' }, h('b', {}, ts.cards), ` / ${ts.goalCards} cards`), h('div', { class: 'hero-mini' }, h('b', {}, ts.minutes), ` / ${ts.goalMinutes} min`), h('div', { class: 'small muted', style: { marginTop: '6px' } }, goalPct >= 1 ? 'Goal complete. Keep the momentum!' : `${ts.goalCards - ts.cards} more to go`)))));
  hero.append(h('div', { class: 'hero-card streak-card' }, h('div', { class: 'hero-label' }, svgIcon('flame', 16), 'Streak'), h('div', { class: 'hero-value' }, streak.current, h('span', { class: 'hero-unit' }, streak.current === 1 ? ' day' : ' days')), h('div', { class: 'small muted' }, streak.studiedToday ? 'Studied today ✓' : (streak.current ? 'Study today to keep it alive' : 'Start a streak today')), h('div', { class: 'small muted' }, `Best: ${streak.best} · Total days: ${streak.totalDays}`), weekDots()));
  hero.append(h('div', { class: 'hero-card level-card', onClick: () => navigate('achievements') }, h('div', { class: 'hero-label' }, svgIcon('award', 16), `Level ${lp.level}`), h('div', { class: 'hero-value', style: { fontSize: '1.5rem' } }, levelTitle(lp.level)), h('div', { class: 'progress', style: { marginTop: '8px' } }, h('div', { class: 'progress-fill', style: { width: `${lp.pct * 100}%` } })), h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${lp.into} / ${lp.need} XP · ${Object.keys(s.achievementsUnlocked || {}).length}/${ACHIEVEMENTS.length} achievements`)));
  inner.append(hero);

  // Two-column dashboard: primary content left, glanceable widgets right
  const recent = (s.recentDecks || []).map(id => db.decks.get(id)).filter(d => d && !d.archived);
  const dueDecks = decks.map(d => ({ d, c: dueCounts(d.id, d) })).filter(x => x.c.new + x.c.learn + x.c.review > 0).sort((a, b) => (b.c.review + b.c.learn + b.c.new) - (a.c.review + a.c.learn + a.c.new));
  const mainCol = h('div', { class: 'home-col' }); const side = h('div', { class: 'home-col home-side' });
  inner.append(h('div', { class: 'home-grid' }, mainCol, side));

  if (decks.length) {
    mainCol.append(h('div', { class: 'panel due-list' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('clock', 16), 'Due today'), totalDue ? h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('study/review/all') }, 'Study all', svgIcon('arrowRight', 14)) : null),
      dueDecks.length ? h('div', {}, ...dueDecks.slice(0, 8).map(({ d, c }) => { const mm = deckMastery(d.id); return h('div', { class: 'due-row', onClick: () => navigate(`study/review/${d.id}`) }, h('span', { class: 'dot', style: { background: d.color || 'var(--accent)' } }), h('div', { class: 'grow due-row-main' }, h('span', { class: 'ellipsis bold' }, d.name), h('div', { class: 'due-row-bar', 'data-tip': `${Math.round(mm.pct * 100)}% mastered` }, h('div', { style: { width: `${Math.round(mm.pct * 100)}%`, background: d.color || 'var(--accent)' } }))), h('span', { class: 'badge info' }, `${c.new} new`), h('span', { class: 'badge warn' }, `${c.learn} learn`), h('span', { class: 'badge ok' }, `${c.review} due`), h('button', { class: 'btn btn-sm btn-soft' }, 'Review', svgIcon('arrowRight', 14))); }))
        : h('div', { class: 'due-empty' }, svgIcon('check', 22), h('div', {}, h('div', { class: 'bold' }, 'All caught up'), h('div', { class: 'small muted' }, 'Nothing is due right now. Practise a set below to stay sharp.')))));
    const shown = [...new Set([...recent, ...decks.slice().sort((a, b) => (b.lastStudied || b.created || 0) - (a.lastStudied || a.created || 0))])].slice(0, 6);
    mainCol.append(h('div', {}, h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, recent.length ? 'Continue studying' : 'Your sets'), h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('library') }, `All sets (${decks.length})`, svgIcon('arrowRight', 14))), h('div', { class: 'home-decks stagger' }, ...shown.map(d => deckCard(d)))));
  } else {
    mainCol.append(h('div', { class: 'panel home-empty' }, svgIcon('cards', 36), h('h3', {}, 'No sets yet'), h('p', { class: 'muted' }, 'Create a set or import one from Quizlet, Anki or a spreadsheet to begin.'), h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn btn-primary', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'Create set'), h('button', { class: 'btn', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import'))));
  }
  mainCol.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('calendar', 16), 'Review heatmap'), h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('stats') }, 'All statistics', svgIcon('arrowRight', 14))), heatmap(reviewHeatmap(null, 380), { weeks: 52, fluid: true })));

  // Side column
  const today = todayCounts(); const ret = retentionStats(null, 30); const fc = forecast(null, 7);
  const m = { total: 0, mastered: 0 }; for (const d of decks) { const mm = deckMastery(d.id); m.total += mm.total; m.mastered += mm.mastered; }
  side.append(h('div', { class: 'home-tiles stagger' },
    tile('Reviews today', today.total, fmtDuration(today.time) + ' studied', 'activity'),
    tile('Mastered', `${pct(m.mastered, m.total)}%`, `${m.mastered} of ${m.total} cards`, 'award'),
    tile('Retention', ret.retention == null ? '—' : `${Math.round(ret.retention * 100)}%`, ret.n ? `${ret.n} reviews · 30 days` : 'No reviews yet', 'target'),
    tile('Next 7 days', fc.reduce((a, b) => a + b, 0), 'reviews scheduled', 'calendar')));
  side.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('activity', 16), 'Upcoming reviews')), !fc.some(Boolean) ? h('div', { class: 'small muted', style: { padding: '4px 0 6px' } }, 'No reviews scheduled this week. Cards move here after you study them.') : barChart(fc.map((n, i) => ({ n, label: i === 0 ? 'Today' : new Date(Date.now() + i * 86400000).toLocaleDateString(undefined, { weekday: 'short' }) })), { height: 120, showValues: true })));
  const qDeck = recent[0] || decks[0];
  if (qDeck) {
    const picks = ['flashcards', 'learn', 'test', 'write', 'match', 'gravity'].map(id => [...MODES, ...GAMES].find(x => x.id === id)).filter(Boolean);
    side.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('zap', 16), 'Quick start'), h('span', { class: 'small muted ellipsis quick-deck' }, qDeck.name)),
      h('div', { class: 'quick-grid' }, ...picks.map(mo => h('button', { class: 'quick-tile', style: { '--mode-color': mo.color }, 'data-tip': mo.desc, onClick: () => navigate(`study/${mo.id}/${qDeck.id}`) }, h('span', { class: 'quick-icon' }, svgIcon(mo.icon, 18)), h('span', {}, mo.name))))));
  }
  const unlocked = s.achievementsUnlocked || {}; const next = ACHIEVEMENTS.filter(a => !unlocked[a.id]).slice(0, 3);
  if (next.length) side.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', { class: 'row' }, svgIcon('award', 16), 'Next achievements'), h('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('achievements') }, 'View all', svgIcon('arrowRight', 14))),
    h('div', { class: 'ach-mini-list' }, ...next.map(a => h('div', { class: 'ach-mini' }, h('span', { class: 'ach-mini-icon' }, svgIcon(a.icon, 16)), h('div', { class: 'grow' }, h('div', { class: 'bold small' }, a.title), h('div', { class: 'small muted' }, a.desc)), h('span', { class: 'badge soft' }, '+50 XP'))))));
  main.append(inner);
}
function tile(label, value, sub, icon) { return h('div', { class: 'stat-tile' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-sub' }, sub), h('div', { class: 'stat-icon' }, svgIcon(icon, 20))); }
function weekDots() {
  const roll = (S().dayRollover ?? 4) * 3600000; const days = new Set(); for (const r of db.revlog.all()) days.add(Math.floor((r.time - roll) / 86400000)); for (const s of db.sessions.all()) days.add(Math.floor((s.start - roll) / 86400000));
  const todayN = Math.floor((Date.now() - roll) / 86400000); const wrap = h('div', { class: 'week-dots' });
  for (let i = 6; i >= 0; i--) { const n = todayN - i; const d = new Date((n * 86400000) + roll + 43200000); wrap.append(h('div', { class: `wd ${days.has(n) ? 'on' : ''} ${i === 0 ? 'today' : ''}`, 'data-tip': d.toLocaleDateString(undefined, { weekday: 'short' }) }, d.toLocaleDateString(undefined, { weekday: 'narrow' }))); }
  return wrap;
}
