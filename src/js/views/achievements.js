import { db } from '../db.js';
import { S } from '../models.js';
import { h, svgIcon, fmtDate, fmtDuration } from '../utils.js';
import { pageHeader, progressRing } from '../ui.js';
import { ACHIEVEMENTS, levelProgress, levelTitle, LEVEL_TITLES, xpForLevel, achievementProgress } from '../xp.js';
import { streakInfo } from '../scheduler.js';

export function render(main) {
  const s = S(); const lp = levelProgress(); const unlocked = s.achievementsUnlocked || {}; const n = Object.keys(unlocked).length; const streak = streakInfo();
  const inner = h('div', { class: 'main-inner roomy' });
  inner.append(pageHeader('Achievements', `${n} of ${ACHIEVEMENTS.length} unlocked`));
  const totalTime = db.sessions.all().reduce((a, x) => a + Math.min((x.end || x.start) - x.start, 3 * 3600000), 0) + db.revlog.all().reduce((a, r) => a + (r.took || 0), 0);
  const ladder = h('div', { class: 'level-ladder' }, ...LEVEL_TITLES.map((t, i) => { const lvl = i * 3 + 1; return h('div', { class: `ladder-step ${lp.level >= lvl ? 'done' : ''} ${lp.level >= lvl && lp.level < lvl + 3 ? 'current' : ''}`, 'data-tip': `Level ${lvl} · ${xpForLevel(lvl).toLocaleString()} XP` }, h('span', {}, t)); }));
  inner.append(h('div', { class: 'panel level-panel' },
    h('div', { class: 'level-top' }, progressRing({ value: lp.pct, size: 128, stroke: 12, label: `Lv ${lp.level}` }),
      h('div', { class: 'level-info' }, h('div', { class: 'hero-label' }, svgIcon('award', 14), `Level ${lp.level}`), h('h2', { class: 'level-title' }, levelTitle(lp.level)),
        h('div', { class: 'progress level-bar' }, h('div', { class: 'progress-fill', style: { width: `${lp.pct * 100}%` } })),
        h('div', { class: 'small muted' }, `${lp.into.toLocaleString()} / ${lp.need.toLocaleString()} XP · ${(lp.need - lp.into).toLocaleString()} XP to level ${lp.level + 1} · ${lp.xp.toLocaleString()} XP total`)),
      h('div', { class: 'level-stats' }, stat('flame', streak.current, streak.current === 1 ? 'day streak' : 'day streak'), stat('trophy', streak.best, 'best streak'), stat('activity', db.revlog.size.toLocaleString(), 'reviews'), stat('clock', fmtDuration(totalTime, true), 'studied'), stat('cards', db.cards.size.toLocaleString(), 'cards'))),
    h('div', { class: 'level-ladder-wrap' }, h('div', { class: 'label' }, 'Rank ladder'), ladder)));
  const grid = h('div', { class: 'ach-grid stagger' });
  for (const a of ACHIEVEMENTS) {
    const when = unlocked[a.id]; const pr = !when && achievementProgress(a);
    grid.append(h('div', { class: `ach ${when ? 'unlocked' : 'locked'}` }, h('div', { class: 'ach-icon' }, svgIcon(a.icon, 22), when ? null : h('span', { class: 'ach-lock' }, svgIcon('lock', 11))),
      h('div', { class: 'grow ach-body' }, h('div', { class: 'ach-head' }, h('span', { class: 'bold' }, a.title), h('span', { class: `ach-xp ${when ? 'got' : ''}` }, when ? svgIcon('check', 12) : null, '+50 XP')), h('div', { class: 'small muted' }, a.desc),
        when ? h('div', { class: 'tiny ach-when' }, `Unlocked ${fmtDate(when)}`) : pr ? h('div', { class: 'ach-progress' }, h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${pr.cur / pr.target * 100}%` } })), h('span', { class: 'tiny muted' }, `${pr.cur.toLocaleString()} / ${pr.target.toLocaleString()}`)) : null)));
  }
  inner.append(h('div', { class: 'section-head ach-section-head' }, h('h2', { class: 'section-title' }, 'All achievements'), h('div', { class: 'ach-overall' }, h('span', { class: 'small muted' }, `${n} / ${ACHIEVEMENTS.length}`), h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${n / ACHIEVEMENTS.length * 100}%` } })))), grid); main.append(inner);
}
const stat = (icon, value, label) => h('div', { class: 'level-stat' }, h('span', { class: 'level-stat-icon' }, svgIcon(icon, 16)), h('div', {}, h('div', { class: 'level-stat-value' }, value), h('div', { class: 'tiny muted' }, label)));
