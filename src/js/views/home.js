// Home: one clear next step (Today), a resume list (Jump back in), and a few glanceable numbers.
// Design rules: one primary action per screen, habit cue next to it, recents to cut effort, 3 key numbers max.
import { db } from '../db.js';
import { S } from '../models.js';
import { h, svgIcon, plural, pct, fmtRelative } from '../utils.js';
import { dueCounts, streakInfo, retentionStats, forecast } from '../scheduler.js';
import { todayStudy } from '../xp.js';
import { navigate, createSetFlow } from '../app.js';
import { deckMastery } from './common.js';
import { showImportDialog } from '../importers.js';

export function render(main) {
  const s = S(); const now = new Date(); const hour = now.getHours();
  const greet = hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const decks = db.decks.filter(d => !d.archived);
  const inner = h('div', { class: 'main-inner hm' });

  inner.append(h('header', { class: 'hm-head' },
    h('div', {}, h('div', { class: 'hm-date' }, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })), h('h1', { class: 'hm-greet' }, greet)),
    h('div', { class: 'hm-head-actions' },
      h('button', { class: 'btn btn-ghost', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import'),
      h('button', { class: 'btn', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'New set'))));

  if (!decks.length) {
    inner.append(h('section', { class: 'hm-today hm-empty' }, h('div', { class: 'hm-today-main' },
      h('div', { class: 'hm-eyebrow' }, 'Get started'), h('div', { class: 'hm-big done' }, 'Make your first set'),
      h('div', { class: 'hm-sub' }, 'Type your own cards, or import from Quizlet, Anki or a spreadsheet.'),
      h('div', { class: 'row', style: { gap: '10px', marginTop: '18px' } }, h('button', { class: 'btn btn-primary hm-cta', onClick: () => createSetFlow() }, svgIcon('plus', 16), 'Create a set'), h('button', { class: 'btn', onClick: () => showImportDialog() }, svgIcon('upload', 16), 'Import')))));
    main.append(inner); return;
  }

  const due = dueCounts(null); const totalDue = due.new + due.learn + due.review;
  const streak = streakInfo(); const ts = todayStudy(); const fc = forecast(null, 7);
  const info = decks.map(d => { const c = dueCounts(d.id, d); return { d, n: c.new + c.learn + c.review, m: deckMastery(d.id) }; });

  // ---- Today: the one thing to do ----
  const mins = Math.max(1, Math.round(totalDue * 8 / 60));
  const parts = [due.new && `${due.new} new`, due.learn && `${due.learn} learning`, due.review && `${due.review} review`].filter(Boolean).join(' · ');
  const weakest = info.filter(x => x.m.total).sort((a, b) => a.m.pct - b.m.pct)[0];
  const todayMain = totalDue
    ? h('div', { class: 'hm-today-main' },
        h('div', { class: 'hm-eyebrow' }, 'Today'),
        h('div', { class: 'hm-big' }, totalDue, h('span', {}, totalDue === 1 ? ' card' : ' cards')),
        h('div', { class: 'hm-sub' }, `About ${mins} min · ${parts}`),
        h('button', { class: 'btn btn-primary hm-cta', onClick: () => navigate('study/review/all') }, svgIcon('play', 16), 'Start review'))
    : h('div', { class: 'hm-today-main' },
        h('div', { class: 'hm-eyebrow' }, 'Today'),
        h('div', { class: 'hm-big done' }, 'All caught up'),
        h('div', { class: 'hm-sub' }, fc[1] ? `${plural(fc[1], 'card')} due tomorrow. Nice work.` : 'Nothing scheduled for tomorrow either.'),
        weakest ? h('button', { class: 'btn hm-cta', onClick: () => navigate(`study/learn/${weakest.d.id}`) }, svgIcon('zap', 16), h('span', { class: 'ellipsis' }, `Practise ${weakest.d.name}`)) : null);
  const goal = Math.min(1, ts.cards / Math.max(1, ts.goalCards));
  const habit = h('div', { class: 'hm-habit' },
    h('div', { class: 'hm-habit-row' },
      h('span', { class: `hm-flame ${streak.studiedToday ? 'on' : ''}` }, svgIcon('flame', 18)),
      h('div', {}, h('div', { class: 'hm-habit-title' }, `${streak.current} day streak`), h('div', { class: 'hm-habit-sub' }, streak.studiedToday ? 'Done for today' : streak.current ? 'Study today to keep it' : 'Start one today'))),
    weekDots(),
    h('div', { class: 'hm-goal' },
      h('div', { class: 'hm-goal-top' }, h('span', {}, 'Daily goal'), h('span', {}, `${Math.min(ts.cards, ts.goalCards)} / ${ts.goalCards} cards`)),
      h('div', { class: `hm-goal-bar ${goal >= 1 ? 'full' : ''}` }, h('div', { style: { width: (goal * 100) + '%' } }))));
  inner.append(h('section', { class: 'hm-today' }, todayMain, habit));

  // ---- Jump back in: recents, with due status ----
  const recentIds = s.recentDecks || [];
  const rank = x => { const r = recentIds.indexOf(x.d.id); return r < 0 ? 1e9 : r; };
  const list = info.slice().sort((a, b) => rank(a) - rank(b) || (b.d.lastStudied || b.d.created || 0) - (a.d.lastStudied || a.d.created || 0)).slice(0, 5);
  const row = ({ d, n, m }) => h('button', { class: 'hm-set', style: { '--c': d.color || 'var(--accent)' }, onClick: () => navigate(`set/${d.id}`) },
    h('span', { class: 'hm-set-dot' }),
    h('span', { class: 'hm-set-main' }, h('span', { class: 'hm-set-name' }, d.name), h('span', { class: 'hm-set-meta' }, `${plural(m.total, 'card')} · ${Math.round(m.pct * 100)}% mastered${d.lastStudied ? ' · ' + fmtRelative(d.lastStudied) : ''}`)),
    h('span', { class: 'hm-set-bar' }, h('span', { style: { width: Math.round(m.pct * 100) + '%' } })),
    n ? h('span', { class: 'hm-pill' }, `${n} due`) : h('span', { class: 'hm-pill done' }, svgIcon('check', 12), 'Done'),
    h('span', { class: 'hm-chev' }, svgIcon('chevronRight', 16)));
  inner.append(h('section', { class: 'hm-section' },
    h('div', { class: 'hm-section-head' }, h('h2', {}, 'Jump back in'), h('button', { class: 'hm-link', onClick: () => navigate('library') }, `All sets (${decks.length})`, svgIcon('arrowRight', 14))),
    h('div', { class: 'hm-sets' }, ...list.map(row))));

  // ---- At a glance: three numbers + what's coming ----
  const ret = retentionStats(null, 30); let tot = 0, mas = 0; info.forEach(x => { tot += x.m.total; mas += x.m.mastered; });
  const weekAgo = Date.now() - 7 * 86400000; const weekReviews = db.revlog.filter(r => r.time > weekAgo).length;
  const maxF = Math.max(1, ...fc);
  const stat = (v, l) => h('div', { class: 'hm-stat' }, h('b', {}, v), h('span', {}, l));
  inner.append(h('section', { class: 'hm-section' },
    h('div', { class: 'hm-section-head' }, h('h2', {}, 'At a glance'), h('button', { class: 'hm-link', onClick: () => navigate('stats') }, 'Statistics', svgIcon('arrowRight', 14))),
    h('div', { class: 'hm-glance' },
      h('div', { class: 'hm-stats' },
        stat(`${pct(mas, tot)}%`, `mastered · ${mas} of ${tot}`),
        stat(ret.retention == null ? '–' : `${Math.round(ret.retention * 100)}%`, 'recall rate · 30 days'),
        stat(weekReviews, 'reviews this week')),
      h('div', { class: 'hm-forecast' },
        h('div', { class: 'hm-forecast-label' }, 'Coming up'),
        h('div', { class: 'hm-bars' }, ...fc.map((n, i) => h('div', { class: 'hm-bar-col' },
          h('span', { class: 'hm-bar-n' }, n || ''),
          h('div', { class: `hm-bar ${n ? '' : 'zero'} ${i === 0 ? 'today' : ''}`, style: { height: Math.max(4, Math.round(n / maxF * 52)) + 'px' } }),
          h('span', { class: 'hm-bar-d' }, i === 0 ? 'Today' : new Date(Date.now() + i * 86400000).toLocaleDateString(undefined, { weekday: 'short' })))))))));
  main.append(inner);
}

function weekDots() {
  const roll = (S().dayRollover ?? 4) * 3600000; const days = new Set();
  for (const r of db.revlog.all()) days.add(Math.floor((r.time - roll) / 86400000));
  for (const x of db.sessions.all()) days.add(Math.floor((x.start - roll) / 86400000));
  const todayN = Math.floor((Date.now() - roll) / 86400000); const wrap = h('div', { class: 'hm-week' });
  for (let i = 6; i >= 0; i--) { const n = todayN - i; const d = new Date((n * 86400000) + roll + 43200000); wrap.append(h('div', { class: `hm-wd ${days.has(n) ? 'on' : ''} ${i === 0 ? 'today' : ''}` }, h('span', { class: 'hm-wd-dot' }), h('span', { class: 'hm-wd-l' }, d.toLocaleDateString(undefined, { weekday: 'narrow' })))); }
  return wrap;
}
