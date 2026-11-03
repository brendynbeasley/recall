// Spaced repetition: Anki-style SM-2 with learning/relearning steps, and FSRS-4.5.
import { db } from './db.js';
import { uid, now, DAY, dayNumber, clamp, shuffle } from './utils.js';
import { deckPreset, S } from './models.js';

export const TYPE = { NEW: 0, LEARN: 1, REVIEW: 2, RELEARN: 3 };
export const QUEUE = { NEW: 0, LEARN: 1, REVIEW: 2, SUSPENDED: -1, BURIED: -2 };
export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const today = () => dayNumber(now(), S()?.dayRollover ?? 4);

// ---------- FSRS-4.5 ----------
const FSRS_W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.0010, 1.5674, 0.1567, 0.9661, 2.0275, 0.1536, 0.3209, 1.4486, 0.2240, 2.8372];
const DECAY = -0.5, FACTOR = 19 / 81;
export const fsrs = {
  w: (p) => (p.fsrsWeights && p.fsrsWeights.length === 17) ? p.fsrsWeights : FSRS_W,
  retrievability: (elapsedDays, S) => S <= 0 ? 0 : Math.pow(1 + FACTOR * elapsedDays / S, DECAY),
  interval: (S, r) => Math.max(1, Math.round((S / FACTOR) * (Math.pow(r, 1 / DECAY) - 1))),
  initStability: (w, g) => Math.max(0.1, w[g - 1]),
  initDifficulty: (w, g) => clamp(w[4] - (g - 3) * w[5], 1, 10),
  nextDifficulty(w, d, g) { const nd = d - w[6] * (g - 3); const mean = w[7] * this.initDifficulty(w, 3) + (1 - w[7]) * nd; return clamp(mean, 1, 10); },
  nextRecallStability(w, d, s, r, g) {
    const hard = g === RATING.HARD ? w[15] : 1, easy = g === RATING.EASY ? w[16] : 1;
    return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy + 1);
  },
  nextForgetStability(w, d, s, r) { return Math.min(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)), s); },
};

// ---------- Helpers ----------
function fuzzInterval(ivl, preset) {
  if (!preset.fuzz || ivl < 3) return ivl;
  let f; if (ivl < 7) f = Math.max(1, Math.round(ivl * 0.25)); else if (ivl < 30) f = Math.max(2, Math.round(ivl * 0.15)); else f = Math.max(4, Math.round(ivl * 0.05));
  return ivl + Math.round((Math.random() * 2 - 1) * f);
}
const capIvl = (ivl, p) => Math.max(1, Math.min(Math.round(ivl), p.maxInterval || 36500));
const stepMs = (minutes) => minutes * 60000;
const steps = (p, relearn) => { const s = relearn ? p.relearningSteps : p.learningSteps; return (s && s.length ? s : (relearn ? [10] : [1, 10])).map(Number); };

function reviewIntervals(card, p, elapsedExtra = 0) {
  // SM-2 next intervals for hard/good/easy given a review card
  const ease = (card.factor || 2500) / 1000;
  const ivl = Math.max(1, card.ivl);
  const delay = Math.max(0, today() - card.due) + elapsedExtra;
  const mod = p.intervalModifier || 1;
  let hard = Math.max(ivl + 1, Math.round(ivl * (p.hardMultiplier || 1.2) * mod));
  let good = Math.max(hard + 1, Math.round((ivl + delay / 2) * ease * mod));
  let easy = Math.max(good + 1, Math.round((ivl + delay) * ease * (p.easyBonus || 1.3) * mod));
  return { hard: capIvl(hard, p), good: capIvl(good, p), easy: capIvl(easy, p) };
}
function lapseInterval(card, p) { return capIvl(Math.max(p.minLapseInterval || 1, Math.round(card.ivl * (p.lapseMultiplier || 0))), p); }

// Describe what each rating would do (for the answer buttons)
export function previewIntervals(card, deck) {
  const p = deckPreset(deck);
  const out = {};
  const lsteps = steps(p, false), rsteps = steps(p, true);
  if (p.algorithm === 'fsrs' && card.type === TYPE.REVIEW) {
    const w = fsrs.w(p); const elapsed = card.lastReview ? (now() - card.lastReview) / DAY : card.ivl;
    const r = fsrs.retrievability(elapsed, card.stability || 1);
    const forget = fsrs.nextForgetStability(w, card.difficulty || 5, card.stability || 1, r);
    out[1] = { label: rsteps.length ? `${rsteps[0]}m` : fmtDays(fsrs.interval(forget, p.desiredRetention)), days: 0 };
    for (const g of [2, 3, 4]) { const s = fsrs.nextRecallStability(w, card.difficulty || 5, card.stability || 1, r, g); const d = fsrs.interval(s, p.desiredRetention); out[g] = { label: fmtDays(d), days: d }; }
    return out;
  }
  if (card.type === TYPE.NEW || card.type === TYPE.LEARN) {
    const idx = card.type === TYPE.NEW ? 0 : Math.max(0, lsteps.length - card.left);
    out[1] = { label: fmtMin(lsteps[0]) };
    out[2] = { label: idx === 0 && lsteps.length > 1 ? fmtMin((lsteps[0] + lsteps[1]) / 2) : fmtMin(lsteps[idx] * 1.5) };
    out[3] = idx + 1 < lsteps.length ? { label: fmtMin(lsteps[idx + 1]) } : { label: fmtDays(p.graduatingInterval) };
    out[4] = { label: fmtDays(p.easyInterval) };
    return out;
  }
  if (card.type === TYPE.RELEARN) {
    const idx = Math.max(0, rsteps.length - card.left);
    out[1] = { label: fmtMin(rsteps[0]) }; out[2] = { label: fmtMin(rsteps[idx] * 1.5) };
    out[3] = idx + 1 < rsteps.length ? { label: fmtMin(rsteps[idx + 1]) } : { label: fmtDays(Math.max(1, card.ivl)) };
    out[4] = { label: fmtDays(Math.max(card.ivl + 1, Math.round(card.ivl * 1.3) || 2)) };
    return out;
  }
  const iv = reviewIntervals(card, p);
  out[1] = { label: rsteps.length ? fmtMin(rsteps[0]) : fmtDays(lapseInterval(card, p)) };
  out[2] = { label: fmtDays(iv.hard) }; out[3] = { label: fmtDays(iv.good) }; out[4] = { label: fmtDays(iv.easy) };
  return out;
}
export function fmtMin(m) { if (m < 60) return `${Math.round(m)}m`; if (m < 1440) return `${Math.round(m / 60 * 10) / 10}h`; return fmtDays(m / 1440); }
export function fmtDays(d) { if (d < 1) return fmtMin(d * 1440); if (d < 30) return `${Math.round(d)}d`; if (d < 365) return `${Math.round(d / 30 * 10) / 10}mo`; return `${Math.round(d / 365 * 10) / 10}y`; }

// ---------- Answering ----------
// Returns a revlog entry. Mutates and persists the card. Keeps an undo snapshot.
const undoStack = [];
export function answerCard(card, rating, deck, timeTakenMs = 0) {
  const p = deckPreset(deck);
  const before = structuredClone(card);
  const t = now(); const dayN = today();
  const lastIvl = card.ivl; const prevType = card.type;
  const lsteps = steps(p, false), rsteps = steps(p, true);
  let newTags = null;

  const graduate = (easy) => {
    card.type = TYPE.REVIEW; card.queue = QUEUE.REVIEW; card.left = 0;
    if (p.algorithm === 'fsrs') { card.ivl = fuzzInterval(fsrs.interval(card.stability, p.desiredRetention), p); if (easy) card.ivl = Math.max(card.ivl, p.easyInterval); }
    else card.ivl = fuzzInterval(easy ? p.easyInterval : p.graduatingInterval, p);
    card.ivl = capIvl(card.ivl, p); card.due = dayN + card.ivl;
    if (!card.factor) card.factor = Math.round((p.startingEase || 2.5) * 1000);
  };
  const scheduleLearn = (stepIdx, stepArr) => { card.left = stepArr.length - stepIdx; card.queue = QUEUE.LEARN; card.due = t + stepMs(stepArr[stepIdx]); };

  if (card.type === TYPE.NEW || card.type === TYPE.LEARN) {
    if (card.type === TYPE.NEW) {
      card.type = TYPE.LEARN; card.factor = card.factor || Math.round((p.startingEase || 2.5) * 1000);
      const w = fsrs.w(p); card.stability = fsrs.initStability(w, rating); card.difficulty = fsrs.initDifficulty(w, rating);
      card.left = lsteps.length;
    }
    const idx = clamp(lsteps.length - card.left, 0, lsteps.length - 1);
    if (rating === RATING.AGAIN) { if (p.algorithm === 'fsrs') { const w = fsrs.w(p); card.stability = fsrs.initStability(w, 1); card.difficulty = fsrs.nextDifficulty(w, card.difficulty || 5, 1); } scheduleLearn(0, lsteps); }
    else if (rating === RATING.HARD) { card.queue = QUEUE.LEARN; const m = idx === 0 && lsteps.length > 1 ? (lsteps[0] + lsteps[1]) / 2 : lsteps[idx] * 1.5; card.due = t + stepMs(m); }
    else if (rating === RATING.GOOD) { if (idx + 1 < lsteps.length) scheduleLearn(idx + 1, lsteps); else graduate(false); }
    else { if (p.algorithm === 'fsrs') { const w = fsrs.w(p); card.stability = Math.max(card.stability, fsrs.initStability(w, 4)); } graduate(true); }
  } else if (card.type === TYPE.RELEARN) {
    const idx = clamp(rsteps.length - card.left, 0, rsteps.length - 1);
    if (rating === RATING.AGAIN) scheduleLearn(0, rsteps);
    else if (rating === RATING.HARD) { card.queue = QUEUE.LEARN; card.due = t + stepMs(rsteps[idx] * 1.5); }
    else if (rating === RATING.GOOD) { if (idx + 1 < rsteps.length) scheduleLearn(idx + 1, rsteps); else { card.type = TYPE.REVIEW; card.queue = QUEUE.REVIEW; card.left = 0; card.due = dayN + Math.max(1, card.ivl); } }
    else { card.type = TYPE.REVIEW; card.queue = QUEUE.REVIEW; card.left = 0; card.ivl = capIvl(Math.max(card.ivl + 1, Math.round(card.ivl * 1.3) || 2), p); card.due = dayN + card.ivl; }
  } else { // REVIEW
    if (p.algorithm === 'fsrs') {
      const w = fsrs.w(p); const elapsed = card.lastReview ? Math.max(0, (t - card.lastReview) / DAY) : card.ivl;
      const r = fsrs.retrievability(elapsed, card.stability || 1); const d = card.difficulty || 5;
      if (rating === RATING.AGAIN) {
        card.stability = fsrs.nextForgetStability(w, d, card.stability || 1, r); card.difficulty = fsrs.nextDifficulty(w, d, 1);
        card.lapses++; card.ivl = Math.max(1, fsrs.interval(card.stability, p.desiredRetention));
        if (rsteps.length) { card.type = TYPE.RELEARN; scheduleLearn(0, rsteps); } else { card.due = dayN + card.ivl; }
        newTags = checkLeech(card, p);
      } else {
        card.stability = fsrs.nextRecallStability(w, d, card.stability || 1, r, rating); card.difficulty = fsrs.nextDifficulty(w, d, rating);
        card.ivl = capIvl(fuzzInterval(fsrs.interval(card.stability, p.desiredRetention), p), p); card.due = dayN + card.ivl;
      }
    } else {
      const ease = card.factor || 2500;
      if (rating === RATING.AGAIN) {
        card.factor = Math.max(1300, ease - 200); card.lapses++; card.ivl = lapseInterval(card, p);
        if (rsteps.length) { card.type = TYPE.RELEARN; scheduleLearn(0, rsteps); } else { card.due = dayN + card.ivl; }
        newTags = checkLeech(card, p);
      } else {
        const iv = reviewIntervals(card, p);
        if (rating === RATING.HARD) { card.factor = Math.max(1300, ease - 150); card.ivl = fuzzInterval(iv.hard, p); }
        else if (rating === RATING.GOOD) { card.ivl = fuzzInterval(iv.good, p); }
        else { card.factor = ease + 150; card.ivl = fuzzInterval(iv.easy, p); }
        card.ivl = capIvl(card.ivl, p); card.due = dayN + card.ivl;
      }
    }
  }
  card.reps++; card.lastReview = t; card.modified = t;
  if (card.queue === QUEUE.BURIED) card.queue = card.type === TYPE.REVIEW ? QUEUE.REVIEW : QUEUE.LEARN;
  db.cards.put(card);
  const log = { id: uid(), cardId: card.id, deckId: card.deckId, time: t, rating, ivl: card.type === TYPE.REVIEW ? card.ivl : -(Math.round((card.due - t) / 60000) || 1), lastIvl, factor: card.factor, took: Math.min(timeTakenMs, (p.maxAnswerSeconds || 60) * 1000), type: prevType, kind: 'review' };
  db.revlog.put(log);
  undoStack.push({ card: before, logId: log.id, noteTags: newTags }); if (undoStack.length > 50) undoStack.shift();
  if (p.buryRelated) burySiblings(card);
  return log;
}
function checkLeech(card, p) {
  if (card.lapses >= (p.leechThreshold || 8) && card.lapses % Math.max(1, Math.floor((p.leechThreshold || 8) / 2)) === 0) {
    const note = db.notes.get(card.noteId);
    if (note && !note.tags.includes('leech')) { const before = note.tags.slice(); note.tags.push('leech'); db.notes.put(note); if (p.leechAction === 'suspend') { card.queue = QUEUE.SUSPENDED; } return { noteId: note.id, before }; }
    if (p.leechAction === 'suspend') card.queue = QUEUE.SUSPENDED;
  }
  return null;
}
function burySiblings(card) {
  const sibs = db.cards.filter(c => c.noteId === card.noteId && c.id !== card.id && (c.queue === QUEUE.NEW || c.queue === QUEUE.REVIEW) && (c.queue !== QUEUE.REVIEW || c.due <= today()));
  for (const s of sibs) { s.queue = QUEUE.BURIED; s.buriedDay = today(); }
  if (sibs.length) db.cards.putMany(sibs);
}
export function canUndo() { return undoStack.length > 0; }
export function undoAnswer() {
  const u = undoStack.pop(); if (!u) return null;
  const cur = db.cards.get(u.card.id); if (cur) db.cards.put(u.card);
  db.revlog.remove(u.logId);
  if (u.noteTags) { const n = db.notes.get(u.noteTags.noteId); if (n) { n.tags = u.noteTags.before; db.notes.put(n); } }
  return u.card;
}

// ---------- Card state operations ----------
export function suspendCards(cards, v = true) { for (const c of cards) { c.queue = v ? QUEUE.SUSPENDED : (c.type === TYPE.NEW ? QUEUE.NEW : (c.type === TYPE.REVIEW ? QUEUE.REVIEW : QUEUE.LEARN)); } db.cards.putMany(cards); }
export function buryCards(cards, v = true) { for (const c of cards) { if (v) { c.queue = QUEUE.BURIED; c.buriedDay = today(); } else c.queue = c.type === TYPE.NEW ? QUEUE.NEW : (c.type === TYPE.REVIEW ? QUEUE.REVIEW : QUEUE.LEARN); } db.cards.putMany(cards); }
export function unburyAll(deckId) { const cs = db.cards.filter(c => c.queue === QUEUE.BURIED && (!deckId || c.deckId === deckId)); buryCards(cs, false); return cs.length; }
export function forgetCards(cards) { for (const c of cards) { Object.assign(c, { type: TYPE.NEW, queue: QUEUE.NEW, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, stability: 0, difficulty: 0, lastReview: 0, due: Date.now() % 1e7 }); } db.cards.putMany(cards); }
export function rescheduleCards(cards, days) { const d = today(); for (const c of cards) { c.type = TYPE.REVIEW; c.queue = QUEUE.REVIEW; c.ivl = Math.max(1, days); c.due = d + Math.max(0, days); if (!c.factor) c.factor = 2500; } db.cards.putMany(cards); }
export function setFlag(cards, flag) { for (const c of cards) c.flag = flag; db.cards.putMany(cards); }
export function setDueDate(cards, days) { const d = today(); for (const c of cards) { if (c.type === TYPE.NEW) { c.type = TYPE.REVIEW; c.factor = c.factor || 2500; c.ivl = Math.max(1, days); } c.queue = QUEUE.REVIEW; c.due = d + days; } db.cards.putMany(cards); }

// ---------- Queue / counts ----------
function autoUnbury() {
  const d = today(); const cs = db.cards.filter(c => c.queue === QUEUE.BURIED && c.buriedDay < d); if (cs.length) buryCards(cs, false);
}
export function todayCounts(deckId) {
  const start = dayStartTs();
  let newDone = 0, revDone = 0, learnDone = 0, time = 0;
  for (const r of db.revlog.all()) { if (r.time < start || (deckId && r.deckId !== deckId) || r.kind !== 'review') continue; time += r.took || 0; if (r.type === TYPE.NEW) newDone++; else if (r.type === TYPE.REVIEW) revDone++; else learnDone++; }
  return { newDone, revDone, learnDone, total: newDone + revDone + learnDone, time };
}
export function dayStartTs() { const roll = S()?.dayRollover ?? 4; const d = new Date(); d.setHours(roll, 0, 0, 0); if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); return d.getTime(); }

export function dueCounts(deckId, deck) {
  autoUnbury();
  const p = deckPreset(deck || db.decks.get(deckId)); const d = today(); const t = now();
  let nw = 0, lrn = 0, rev = 0, total = 0, suspended = 0, buried = 0, mature = 0, young = 0;
  for (const c of db.cards.all()) {
    if (deckId && c.deckId !== deckId) continue; total++;
    if (c.queue === QUEUE.SUSPENDED) { suspended++; continue; } if (c.queue === QUEUE.BURIED) { buried++; continue; }
    if (c.queue === QUEUE.NEW) nw++;
    else if (c.queue === QUEUE.LEARN) { if (c.due <= t + 20 * 60000) lrn++; }
    else if (c.queue === QUEUE.REVIEW) { if (c.due <= d) rev++; if (c.ivl >= 21) mature++; else young++; }
  }
  const done = todayCounts(deckId);
  return { new: Math.max(0, Math.min(nw, (p.newPerDay ?? 20) - done.newDone)), learn: lrn, review: Math.max(0, Math.min(rev, (p.reviewsPerDay ?? 200) - done.revDone)), rawNew: nw, rawReview: rev, total, suspended, buried, mature, young, done };
}
export function buildQueue(deckId, deck, opts = {}) {
  autoUnbury();
  deck = deck || db.decks.get(deckId);
  const p = deckPreset(deck); const d = today(); const t = now(); const counts = dueCounts(deckId, deck);
  const all = db.cards.filter(c => (!deckId || c.deckId === deckId) && c.queue >= 0);
  let learn = all.filter(c => c.queue === QUEUE.LEARN).sort((a, b) => a.due - b.due);
  let review = all.filter(c => c.queue === QUEUE.REVIEW && c.due <= d);
  if (p.reviewOrder === 'random') review = shuffle(review); else if (p.reviewOrder === 'difficulty') review.sort((a, b) => (a.factor || 2500) - (b.factor || 2500)); else review.sort((a, b) => a.due - b.due || a.ivl - b.ivl);
  review = review.slice(0, opts.ignoreLimits ? review.length : counts.review);
  let nw = all.filter(c => c.queue === QUEUE.NEW); nw = p.newOrder === 'random' ? shuffle(nw) : nw.sort((a, b) => a.due - b.due);
  nw = nw.slice(0, opts.ignoreLimits ? nw.length : counts.new);
  const dueLearn = learn.filter(c => c.due <= t);
  let main;
  if (p.newMix === 'before') main = [...nw, ...review]; else if (p.newMix === 'after') main = [...review, ...nw];
  else { // interleave evenly
    main = []; const ratio = nw.length ? Math.max(1, Math.round(review.length / nw.length)) : 0; let ni = 0;
    for (let i = 0; i < review.length; i++) { main.push(review[i]); if (ratio && (i + 1) % ratio === 0 && ni < nw.length) main.push(nw[ni++]); }
    while (ni < nw.length) main.push(nw[ni++]);
  }
  return { learn, dueLearn, main, counts };
}

// ---------- Stats helpers ----------
export function cardRetrievability(card) {
  if (card.type !== TYPE.REVIEW) return null;
  if (card.stability > 0) { const el = card.lastReview ? (now() - card.lastReview) / DAY : 0; return fsrs.retrievability(el, card.stability); }
  const el = card.lastReview ? (now() - card.lastReview) / DAY : 0; return Math.pow(0.9, el / Math.max(1, card.ivl));
}
export function forecast(deckId, days = 30) {
  const d = today(); const out = new Array(days).fill(0);
  for (const c of db.cards.all()) { if (deckId && c.deckId !== deckId) continue; if (c.queue !== QUEUE.REVIEW) continue; const k = Math.max(0, c.due - d); if (k < days) out[k]++; }
  return out;
}
export function intervalHistogram(deckId) {
  const buckets = [[1, '1d'], [3, '2-3d'], [7, '4-7d'], [14, '1-2w'], [30, '2-4w'], [90, '1-3mo'], [180, '3-6mo'], [365, '6-12mo'], [Infinity, '1y+']];
  const out = buckets.map(b => ({ label: b[1], n: 0 }));
  for (const c of db.cards.all()) { if (deckId && c.deckId !== deckId) continue; if (c.type !== TYPE.REVIEW) continue; const i = buckets.findIndex(b => c.ivl <= b[0]); out[i < 0 ? out.length - 1 : i].n++; }
  return out;
}
export function easeHistogram(deckId) {
  const out = []; for (let e = 130; e <= 350; e += 20) out.push({ label: `${e}%`, n: 0 });
  for (const c of db.cards.all()) { if (deckId && c.deckId !== deckId) continue; if (c.type !== TYPE.REVIEW) continue; const i = clamp(Math.round(((c.factor || 2500) / 10 - 130) / 20), 0, out.length - 1); out[i].n++; }
  return out;
}
export function reviewHeatmap(deckId, daysBack = 365) {
  const m = new Map(); const since = now() - daysBack * DAY;
  for (const r of db.revlog.all()) { if (r.time < since || (deckId && r.deckId !== deckId)) continue; const k = new Date(r.time - (S()?.dayRollover ?? 4) * 3600000).toDateString(); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
export function streakInfo() {
  const days = new Set(); const roll = (S()?.dayRollover ?? 4) * 3600000;
  for (const r of db.revlog.all()) days.add(Math.floor((r.time - roll) / DAY));
  for (const s of db.sessions.all()) days.add(Math.floor((s.start - roll) / DAY));
  const todayN = Math.floor((now() - roll) / DAY);
  let cur = 0, k = todayN; if (!days.has(k)) k--; while (days.has(k)) { cur++; k--; }
  let best = 0, run = 0; const sorted = [...days].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) { run = (i > 0 && sorted[i] === sorted[i - 1] + 1) ? run + 1 : 1; best = Math.max(best, run); }
  return { current: cur, best, studiedToday: days.has(todayN), totalDays: days.size };
}
export function retentionStats(deckId, daysBack = 30) {
  const since = now() - daysBack * DAY; let ok = 0, n = 0, matureOk = 0, matureN = 0;
  for (const r of db.revlog.all()) { if (r.time < since || (deckId && r.deckId !== deckId) || r.kind !== 'review') continue; if (r.type !== TYPE.REVIEW) continue; n++; if (r.rating > 1) ok++; if (r.lastIvl >= 21) { matureN++; if (r.rating > 1) matureOk++; } }
  return { retention: n ? ok / n : null, mature: matureN ? matureOk / matureN : null, n };
}
