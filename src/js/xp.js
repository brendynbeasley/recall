// Gamification: XP, levels, achievements, daily goals, study sessions.
import { db } from './db.js';
import { S, saveSettings } from './models.js';
import { uid, now, DAY } from './utils.js';
import { toast, confetti, floatText } from './ui.js';
import { sfx } from './audio.js';
import { streakInfo, todayCounts } from './scheduler.js';

export const levelForXp = (xp) => Math.floor(Math.sqrt(xp / 60)) + 1;
export const xpForLevel = (lvl) => Math.pow(lvl - 1, 2) * 60;
export function levelProgress() { const xp = S().xp || 0; const lvl = levelForXp(xp); const a = xpForLevel(lvl), b = xpForLevel(lvl + 1); return { level: lvl, xp, into: xp - a, need: b - a, pct: (xp - a) / (b - a) }; }
export const LEVEL_TITLES = ['Novice', 'Learner', 'Student', 'Scholar', 'Adept', 'Expert', 'Master', 'Sage', 'Virtuoso', 'Legend', 'Grandmaster', 'Oracle'];
export const levelTitle = (lvl) => LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((lvl - 1) / 3))];

export function awardXP(amount, reason, at) {
  if (!amount) return;
  const s = S(); const before = levelForXp(s.xp || 0); s.xp = (s.xp || 0) + amount; const after = levelForXp(s.xp); saveSettings();
  if (at) floatText(at.x, at.y, `+${amount} XP`, 'xp');
  if (after > before) { sfx.levelUp(); confetti({ count: 200, power: 1.2 }); toast(`Level up! You reached level ${after} · ${levelTitle(after)}`, 'trophy', { duration: 5000 }); }
  checkAchievements();
}

// ---------- Sessions ----------
export function startSession(deckId, mode) { return { id: uid(), deckId, mode, start: now(), end: null, correct: 0, wrong: 0, cards: 0, xp: 0, score: null, meta: {} }; }
export function endSession(sess, extra = {}) {
  if (!sess || sess.saved) return sess; sess.end = now(); Object.assign(sess, extra); sess.saved = true;
  db.sessions.put({ id: sess.id, deckId: sess.deckId, mode: sess.mode, start: sess.start, end: sess.end, correct: sess.correct, wrong: sess.wrong, cards: sess.cards, xp: sess.xp, score: sess.score, meta: sess.meta });
  checkAchievements();
  return sess;
}
export function todayStudy() {
  const start = (() => { const roll = S().dayRollover ?? 4; const d = new Date(); d.setHours(roll, 0, 0, 0); if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); return d.getTime(); })();
  let cards = 0, ms = 0; const rev = todayCounts(); cards += rev.total; ms += rev.time;
  for (const s of db.sessions.all()) { if (s.start < start) continue; if (s.mode !== 'review') { cards += s.cards || 0; ms += Math.min((s.end || now()) - s.start, 3 * 3600000); } }
  return { cards, minutes: Math.round(ms / 60000), goalCards: S().dailyGoalCards || 50, goalMinutes: S().dailyGoalMinutes || 20 };
}

// ---------- Achievements ----------
export const ACHIEVEMENTS = [
  { id: 'first_set', title: 'First Steps', desc: 'Create your first set', icon: 'plus', check: () => db.decks.size >= 1 },
  { id: 'five_sets', title: 'Collector', desc: 'Create 5 sets', icon: 'library', check: () => db.decks.size >= 5 },
  { id: 'hundred_cards', title: 'Century', desc: 'Have 100 cards in your library', icon: 'cards', check: () => db.cards.size >= 100 },
  { id: 'thousand_cards', title: 'Archivist', desc: 'Have 1,000 cards in your library', icon: 'database', check: () => db.cards.size >= 1000 },
  { id: 'first_review', title: 'Warming Up', desc: 'Complete your first review', icon: 'check', check: () => db.revlog.size >= 1 },
  { id: 'hundred_reviews', title: 'Committed', desc: 'Complete 100 reviews', icon: 'activity', check: () => db.revlog.size >= 100 },
  { id: 'thousand_reviews', title: 'Relentless', desc: 'Complete 1,000 reviews', icon: 'zap', check: () => db.revlog.size >= 1000 },
  { id: 'ten_k_reviews', title: 'Ten Thousand Hours', desc: 'Complete 10,000 reviews', icon: 'trophy', check: () => db.revlog.size >= 10000 },
  { id: 'streak_3', title: 'Hat Trick', desc: 'Study 3 days in a row', icon: 'flame', check: () => streakInfo().current >= 3 },
  { id: 'streak_7', title: 'One Week Strong', desc: 'Study 7 days in a row', icon: 'flame', check: () => streakInfo().current >= 7 },
  { id: 'streak_30', title: 'Monthly Habit', desc: 'Study 30 days in a row', icon: 'flame', check: () => streakInfo().current >= 30 },
  { id: 'streak_100', title: 'Unstoppable', desc: 'Study 100 days in a row', icon: 'flame', check: () => streakInfo().current >= 100 },
  { id: 'match_fast', title: 'Lightning Hands', desc: 'Finish a Match game in under 20 seconds', icon: 'zap', check: () => db.sessions.find(s => s.mode === 'match' && s.score != null && s.score < 20) },
  { id: 'learn_complete', title: 'Mastered', desc: 'Complete a Learn session with every term mastered', icon: 'brain', check: () => db.sessions.find(s => s.mode === 'learn' && s.meta && s.meta.completed) },
  { id: 'test_perfect', title: 'Perfect Score', desc: 'Score 100% on a Test', icon: 'award', check: () => db.sessions.find(s => s.mode === 'test' && s.score === 100) },
  { id: 'gravity_1000', title: 'Rocket Scientist', desc: 'Score 1,000+ in Gravity', icon: 'rocket', check: () => db.sessions.find(s => s.mode === 'gravity' && s.score >= 1000) },
  { id: 'night_owl', title: 'Night Owl', desc: 'Study between midnight and 4am', icon: 'moon', check: () => db.sessions.find(s => { const hr = new Date(s.start).getHours(); return hr >= 0 && hr < 4; }) },
  { id: 'early_bird', title: 'Early Bird', desc: 'Study before 7am', icon: 'sun', check: () => db.sessions.find(s => { const hr = new Date(s.start).getHours(); return hr >= 4 && hr < 7; }) },
  { id: 'all_modes', title: 'Explorer', desc: 'Try every study mode and game', icon: 'globe', check: () => { const m = new Set(db.sessions.all().map(s => s.mode)); return ['flashcards', 'learn', 'test', 'write', 'spell', 'review', 'match', 'gravity', 'memory', 'blast'].every(x => m.has(x)); } },
  { id: 'importer', title: 'Importer', desc: 'Import a set from a file', icon: 'upload', check: () => db.getKV('ach_import', false) },
  { id: 'level_5', title: 'Rising Star', desc: 'Reach level 5', icon: 'star', check: () => levelForXp(S().xp || 0) >= 5 },
  { id: 'level_10', title: 'Shining Bright', desc: 'Reach level 10', icon: 'sparkles', check: () => levelForXp(S().xp || 0) >= 10 },
  { id: 'level_25', title: 'Luminary', desc: 'Reach level 25', icon: 'award', check: () => levelForXp(S().xp || 0) >= 25 },
  { id: 'goal_7', title: 'Goal Getter', desc: 'Hit your daily goal 7 days', icon: 'target', check: () => Object.keys(db.getKV('goalDays', {})).length >= 7 },
  { id: 'cloze_master', title: 'Fill in the Blanks', desc: 'Create 10 cloze notes', icon: 'scissors', check: () => db.notes.filter(n => n.notetypeId === 'nt_cloze').length >= 10 },
  { id: 'marathon', title: 'Marathon', desc: 'Study 200 cards in a single day', icon: 'activity', check: () => todayStudy().cards >= 200 },
];
// Progress toward countable achievements: id -> [current(), target]
const ACH_TARGETS = { first_set: [() => db.decks.size, 1], five_sets: [() => db.decks.size, 5], hundred_cards: [() => db.cards.size, 100], thousand_cards: [() => db.cards.size, 1000], first_review: [() => db.revlog.size, 1], hundred_reviews: [() => db.revlog.size, 100], thousand_reviews: [() => db.revlog.size, 1000], ten_k_reviews: [() => db.revlog.size, 10000], streak_3: [() => streakInfo().current, 3], streak_7: [() => streakInfo().current, 7], streak_30: [() => streakInfo().current, 30], streak_100: [() => streakInfo().current, 100], level_5: [() => levelForXp(S().xp || 0), 5], level_10: [() => levelForXp(S().xp || 0), 10], level_25: [() => levelForXp(S().xp || 0), 25], goal_7: [() => Object.keys(db.getKV('goalDays', {})).length, 7], cloze_master: [() => db.notes.filter(n => n.notetypeId === 'nt_cloze').length, 10], marathon: [() => todayStudy().cards, 200] };
export function achievementProgress(a) { const t = ACH_TARGETS[a.id]; if (!t) return null; let cur = 0; try { cur = t[0](); } catch (e) { /* */ } return { cur: Math.min(cur, t[1]), target: t[1] }; }
export function checkAchievements() {
  const s = S(); s.achievementsUnlocked = s.achievementsUnlocked || {}; let changed = false;
  for (const a of ACHIEVEMENTS) { if (s.achievementsUnlocked[a.id]) continue; let ok = false; try { ok = !!a.check(); } catch (e) { ok = false; } if (ok) { s.achievementsUnlocked[a.id] = now(); changed = true; sfx.unlock(); toast(`Achievement unlocked: ${a.title}`, 'trophy', { duration: 5000 }); s.xp = (s.xp || 0) + 50; } }
  if (changed) saveSettings();
  // Daily goal tracking
  const t = todayStudy(); if (t.cards >= t.goalCards) { const g = db.getKV('goalDays', {}); const k = new Date().toDateString(); if (!g[k]) { g[k] = true; db.setKV('goalDays', g); toast('Daily goal reached! Great work.', 'success'); confetti({ count: 120 }); } }
}
export function xpForAnswer(correct, { streak = 0, mode = 'review' } = {}) {
  if (!correct) return 1; let base = mode === 'review' ? 4 : 3; if (streak >= 5) base += 2; if (streak >= 10) base += 3; return base;
}
