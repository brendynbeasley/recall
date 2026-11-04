// Domain model: decks, folders, note types, notes, cards, media, settings.
import { db } from './db.js';
import { uid, now, stripHtml, escapeHtml, DAY } from './utils.js';

// ---------- Note types ----------
export const NT = { BASIC: 'nt_basic', REVERSED: 'nt_reversed', TYPING: 'nt_typing', CLOZE: 'nt_cloze', IMAGE: 'nt_image' };
const DEFAULT_CSS = `.card { font-family: var(--card-font, inherit); font-size: var(--card-font-size, 24px); text-align: center; color: var(--text); }
.cloze { font-weight: 700; color: var(--accent); }
.hint { color: var(--text-muted); font-style: italic; }
img { max-width: 100%; max-height: 40vh; border-radius: 12px; }`;

export const BUILTIN_NOTETYPES = [
  { id: NT.BASIC, name: 'Basic', kind: 'standard', builtin: true, fields: ['Term', 'Definition'], css: DEFAULT_CSS,
    templates: [{ name: 'Card 1', qfmt: '{{Term}}', afmt: '{{FrontSide}}<hr id=answer>{{Definition}}' }] },
  { id: NT.REVERSED, name: 'Basic (and reversed card)', kind: 'standard', builtin: true, fields: ['Term', 'Definition'], css: DEFAULT_CSS,
    templates: [{ name: 'Card 1', qfmt: '{{Term}}', afmt: '{{FrontSide}}<hr id=answer>{{Definition}}' }, { name: 'Card 2', qfmt: '{{Definition}}', afmt: '{{FrontSide}}<hr id=answer>{{Term}}' }] },
  { id: NT.TYPING, name: 'Basic (type in the answer)', kind: 'standard', builtin: true, fields: ['Term', 'Definition'], css: DEFAULT_CSS,
    templates: [{ name: 'Card 1', qfmt: '{{Term}}<br>{{type:Definition}}', afmt: '{{FrontSide}}<hr id=answer>{{Definition}}' }] },
  { id: NT.CLOZE, name: 'Cloze', kind: 'cloze', builtin: true, fields: ['Text', 'Back Extra'], css: DEFAULT_CSS,
    templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}' }] },
  { id: NT.IMAGE, name: 'Image and caption', kind: 'standard', builtin: true, fields: ['Image', 'Caption', 'Notes'], css: DEFAULT_CSS,
    templates: [{ name: 'Image → Caption', qfmt: '{{Image}}', afmt: '{{FrontSide}}<hr id=answer>{{Caption}}<div class="hint">{{Notes}}</div>' }] },
];

export const DEFAULT_PRESET = () => ({
  id: 'preset_default', name: 'Default', builtin: true,
  algorithm: 'sm2',                 // 'sm2' | 'fsrs'
  newPerDay: 20, reviewsPerDay: 200,
  learningSteps: [1, 10],           // minutes
  relearningSteps: [10],
  graduatingInterval: 1, easyInterval: 4,
  startingEase: 2.5, easyBonus: 1.3, hardMultiplier: 1.2, intervalModifier: 1.0, lapseMultiplier: 0.0, minLapseInterval: 1,
  maxInterval: 36500, leechThreshold: 8, leechAction: 'tag', // 'tag' | 'suspend'
  newOrder: 'added', // 'added' | 'random'
  newMix: 'mix', // 'mix' | 'after' | 'before'
  reviewOrder: 'due', // 'due' | 'random' | 'difficulty'
  buryRelated: true, fuzz: true,
  desiredRetention: 0.9, fsrsWeights: null,
  autoAdvance: 0, // seconds, 0 = off
  showTimer: true, maxAnswerSeconds: 60,
});

export const DEFAULT_SETTINGS = () => ({
  theme: 'system', accentHue: 252, accentPreset: 'indigo', customThemes: [], radius: 14, density: 'comfortable', fontScale: 1, uiFont: 'Inter', cardFont: 'Inter',
  animations: true, reducedMotion: false, sounds: true, soundVolume: 0.6, haptics: false, confetti: true, backgroundFx: true, ambient: 'vivid', glass: true,
  showIntro: true, introVariant: 'ember', edgeGlow: true, edgeTone: 'warm', introStyle: 'cards', startPage: 'home', dayRollover: 4, weekStart: 1,
  tts: true, ttsRate: 1, ttsVoiceFront: '', ttsVoiceBack: '', ttsAutoplay: false, langFront: 'auto', langBack: 'auto',
  dailyGoalCards: 50, dailyGoalMinutes: 20, streakFreeze: 1,
  shortcuts: {}, keyboardHints: true,
  flashcards: { frontSide: 'term', shuffle: false, autoplaySeconds: 4, tts: false, sortMode: false, animation: 'flip', showProgress: true, swipe: true, showStar: true },
  learn: { questionTypes: ['mc', 'written'], answerWith: 'definition', shuffle: true, roundSize: 7, mcOptions: 4, typoTolerance: true, retypeWrong: true, starredOnly: false, instantFeedback: true, tts: false, fastMode: false, caseSensitive: false },
  test: { count: 20, types: ['written', 'mc', 'tf', 'matching'], answerWith: 'definition', instantFeedback: false, starredOnly: false, shuffle: true, typoTolerance: true },
  write: { answerWith: 'definition', typoTolerance: true, retypeWrong: true, starredOnly: false, shuffle: true },
  spell: { rate: 0.9, starredOnly: false, showHint: true },
  match: { gridSize: 12, showTimer: true, penalty: 1, starredOnly: false, cardsFace: 'both' },
  gravity: { difficulty: 'medium', answerWith: 'definition', lives: 3, starredOnly: false },
  memory: { pairs: 8, starredOnly: false, timeLimit: 0 },
  blast: { duration: 60, answerWith: 'definition', starredOnly: false },
  review: { showAnswerKey: 'space', buttons: 4, showIntervals: true, showRemaining: true, showTimer: true, autoReveal: 0, flipAnimation: true },
  editor: { autoSuggest: true, autoDefine: false, tabToNext: true, swapOnPaste: false, defaultNotetype: NT.BASIC, parseSeparator: 'tab', parseRowSeparator: 'newline' },
  browser: { columns: ['sort', 'deck', 'due', 'interval', 'ease', 'reps', 'lapses', 'tags'], pageSize: 100 },
  lastDeckId: null, pinnedDecks: [], recentDecks: [],
  windowZoom: 1, zenMode: false, sidebarCollapsed: false,
  pomodoro: { work: 25, rest: 5, autoStart: false },
  achievementsUnlocked: {}, xp: 0, level: 1, onboarded: false,
});

export const settings = { value: null };
export function loadSettings() { const base = DEFAULT_SETTINGS(); const saved = db.getKV('settings', {}); settings.value = deepMerge(base, saved); return settings.value; }
export function saveSettings() { db.setKV('settings', settings.value); db.events.emit('settings'); }
export function updateSettings(patch) { settings.value = deepMerge(settings.value, patch); saveSettings(); }
export function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return b === undefined ? a : b;
  const out = { ...a }; for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]); return out;
}
export const S = () => settings.value;

// ---------- Bootstrapping ----------
export function ensureDefaults() {
  for (const nt of BUILTIN_NOTETYPES) if (!db.notetypes.has(nt.id)) db.notetypes.put(structuredClone(nt));
  if (!db.presets.has('preset_default')) db.presets.put(DEFAULT_PRESET());
  loadSettings();
}

// ---------- Folders ----------
export function createFolder(name, color = null) { const f = { id: uid(), name, color, created: now(), order: db.folders.size }; db.folders.put(f); return f; }
export function deleteFolder(id, { deleteDecks = false } = {}) {
  for (const d of db.decks.filter(d => d.folderId === id)) { if (deleteDecks) deleteDeck(d.id); else { d.folderId = null; db.decks.put(d); } }
  db.folders.remove(id);
}

// ---------- Decks ----------
export function createDeck({ name, description = '', folderId = null, notetypeId = NT.BASIC, presetId = 'preset_default', color = null, icon = null, langFront = 'auto', langBack = 'auto' }) {
  const d = { id: uid(), name: name.trim() || 'Untitled set', description, folderId, notetypeId, presetId, color, icon, langFront, langBack, created: now(), modified: now(), lastStudied: null, pinned: false, archived: false, studyCount: 0, learnProgress: null, collapsed: false };
  db.decks.put(d); return d;
}
export function updateDeck(deck, patch) { Object.assign(deck, patch, { modified: now() }); db.decks.put(deck); return deck; }
export function deleteDeck(id) {
  const notes = db.notes.filter(n => n.deckId === id);
  const noteIds = new Set(notes.map(n => n.id));
  const cards = db.cards.filter(c => c.deckId === id || noteIds.has(c.noteId));
  const cardIds = new Set(cards.map(c => c.id));
  db.revlog.removeMany(db.revlog.filter(r => cardIds.has(r.cardId)).map(r => r.id));
  db.cards.removeMany([...cardIds]);
  db.notes.removeMany([...noteIds]);
  db.decks.remove(id);
  gcMedia();
}
export function duplicateDeck(id) {
  const src = db.decks.get(id); if (!src) return null;
  const d = createDeck({ ...src, name: src.name + ' (copy)' });
  for (const n of deckNotes(id)) addNote(d.id, n.notetypeId, n.fields.slice(), n.tags.slice(), { starred: n.starred });
  return d;
}
export const deckNotes = (deckId) => db.notes.filter(n => n.deckId === deckId).sort((a, b) => a.order - b.order || a.created - b.created);
export const deckCards = (deckId) => db.cards.filter(c => c.deckId === deckId);
export const deckCount = (deckId) => db.notes.filter(n => n.deckId === deckId).length;
export function deckPreset(deck) { return db.presets.get(deck?.presetId) || db.presets.get('preset_default') || DEFAULT_PRESET(); }
export function touchDeck(deck) { deck.lastStudied = now(); deck.studyCount = (deck.studyCount || 0) + 1; db.decks.put(deck); const s = S(); s.recentDecks = [deck.id, ...(s.recentDecks || []).filter(x => x !== deck.id)].slice(0, 8); saveSettings(); }
export function moveDeck(deckId, folderId) { const d = db.decks.get(deckId); if (d) updateDeck(d, { folderId }); }

// ---------- Notes & cards ----------
export const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
export function clozeOrdinals(text) { const s = new Set(); for (const m of String(text || '').matchAll(CLOZE_RE)) s.add(parseInt(m[1], 10)); return [...s].sort((a, b) => a - b); }

export function newCard(note, ord, deckId) {
  return { id: uid(), noteId: note.id, deckId: deckId || note.deckId, ord,
    type: 0, queue: 0, due: nextNewPosition(), ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, stability: 0, difficulty: 0, lastReview: 0, elapsed: 0,
    flag: 0, flags: 0, buriedDay: 0, created: now(), modified: now(),
    // Quizlet-style mastery (independent of SRS)
    mastery: { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 } };
}
let newPosCounter = null;
function nextNewPosition() { if (newPosCounter == null) { newPosCounter = 0; for (const c of db.cards.all()) if (c.type === 0 && c.due > newPosCounter) newPosCounter = c.due; } return ++newPosCounter; }

export function addNote(deckId, notetypeId, fields, tags = [], extra = {}) {
  const nt = db.notetypes.get(notetypeId) || db.notetypes.get(NT.BASIC);
  const n = { id: uid(), deckId, notetypeId: nt.id, fields: padFields(fields, nt), tags: normalizeTags(tags), starred: false, created: now(), modified: now(), order: nextNoteOrder(deckId), ...extra };
  db.notes.put(n);
  db.cards.putMany(generateCards(n, nt));
  const d = db.decks.get(deckId); if (d) { d.modified = now(); db.decks.put(d); }
  return n;
}
export function addNotesBulk(deckId, notetypeId, rows, tags = []) {
  const nt = db.notetypes.get(notetypeId) || db.notetypes.get(NT.BASIC);
  const notes = [], cards = []; let order = nextNoteOrder(deckId);
  for (const r of rows) {
    const fields = Array.isArray(r) ? r : r.fields;
    const n = { id: uid(), deckId, notetypeId: nt.id, fields: padFields(fields, nt), tags: normalizeTags([...(tags || []), ...((r.tags) || [])]), starred: false, created: now(), modified: now(), order: order++ };
    notes.push(n); cards.push(...generateCards(n, nt));
  }
  db.notes.putMany(notes); db.cards.putMany(cards);
  const d = db.decks.get(deckId); if (d) { d.modified = now(); db.decks.put(d); }
  return notes;
}
function nextNoteOrder(deckId) { let m = -1; for (const n of db.notes.all()) if (n.deckId === deckId && n.order > m) m = n.order; return m + 1; }
function padFields(fields, nt) { const out = (fields || []).map(f => f == null ? '' : String(f)); while (out.length < nt.fields.length) out.push(''); return out.slice(0, Math.max(nt.fields.length, out.length)); }
export function normalizeTags(tags) { return [...new Set((tags || []).flatMap(t => String(t).split(/[\s,]+/)).map(t => t.trim().replace(/^#/, '')).filter(Boolean))]; }

export function generateCards(note, nt) {
  nt = nt || db.notetypes.get(note.notetypeId);
  if (nt.kind === 'cloze') {
    const ords = clozeOrdinals(note.fields[0]); if (!ords.length) ords.push(1);
    return ords.map(o => newCard(note, o));
  }
  const cards = [];
  nt.templates.forEach((t, i) => { if (templateHasContent(t.qfmt, nt, note.fields)) cards.push(newCard(note, i)); });
  if (!cards.length) cards.push(newCard(note, 0));
  return cards;
}
function templateHasContent(qfmt, nt, fields) {
  // A template produces a card if any referenced field is non-empty (Anki semantics)
  const refs = [...qfmt.matchAll(/\{\{(?:[a-z-]+:)?([^}#/^]+)\}\}/g)].map(m => m[1].trim()).filter(f => f !== 'FrontSide');
  if (!refs.length) return true;
  return refs.some(f => { const i = nt.fields.indexOf(f); return i >= 0 && stripHtml(fields[i] || '').trim() !== '' || /<img|<audio|\[sound:/.test(fields[i] || ''); });
}
export function updateNote(note, { fields, tags, starred, notetypeId } = {}) {
  if (fields) note.fields = fields; if (tags) note.tags = normalizeTags(tags); if (typeof starred === 'boolean') note.starred = starred;
  const nt = db.notetypes.get(note.notetypeId);
  if (notetypeId && notetypeId !== note.notetypeId) { note.notetypeId = notetypeId; note.fields = padFields(note.fields, db.notetypes.get(notetypeId)); }
  note.modified = now(); db.notes.put(note);
  // Reconcile cards (cloze ordinals / templates may have changed)
  const nt2 = db.notetypes.get(note.notetypeId);
  const want = generateCards(note, nt2).map(c => c.ord);
  const existing = db.cards.filter(c => c.noteId === note.id);
  const have = new Set(existing.map(c => c.ord));
  const toAdd = want.filter(o => !have.has(o)).map(o => newCard(note, o));
  if (toAdd.length) db.cards.putMany(toAdd);
  if (notetypeId && nt && nt.kind !== nt2.kind) { db.cards.removeMany(existing.filter(c => !want.includes(c.ord)).map(c => c.id)); }
  else { const stale = existing.filter(c => !want.includes(c.ord) && nt2.kind === 'cloze'); if (stale.length) db.cards.removeMany(stale.map(c => c.id)); }
  return note;
}
export function deleteNotes(ids) {
  const idSet = new Set(ids);
  const cards = db.cards.filter(c => idSet.has(c.noteId)); const cardIds = new Set(cards.map(c => c.id));
  db.revlog.removeMany(db.revlog.filter(r => cardIds.has(r.cardId)).map(r => r.id));
  db.cards.removeMany([...cardIds]); db.notes.removeMany(ids);
}
export function moveNotes(ids, deckId) {
  const idSet = new Set(ids);
  const notes = db.notes.filter(n => idSet.has(n.id)); notes.forEach(n => { n.deckId = deckId; n.modified = now(); });
  const cards = db.cards.filter(c => idSet.has(c.noteId)); cards.forEach(c => { c.deckId = deckId; });
  db.notes.putMany(notes); db.cards.putMany(cards);
}
export function toggleStar(note, v) { note.starred = typeof v === 'boolean' ? v : !note.starred; db.notes.put(note); return note.starred; }
export const noteCards = (noteId) => db.cards.filter(c => c.noteId === noteId).sort((a, b) => a.ord - b.ord);

// ---------- Rendering ----------
export function fieldMap(note, nt) { const m = {}; nt.fields.forEach((f, i) => { m[f] = note.fields[i] || ''; }); return m; }
export function renderCloze(text, ord, side, { hideOthers = false } = {}) {
  return String(text || '').replace(CLOZE_RE, (m, n, ans, hint) => {
    const num = parseInt(n, 10);
    if (num === ord) return side === 'q' ? `<span class="cloze cloze-blank">[${hint ? escapeHtml(hint) : '...'}]</span>` : `<span class="cloze cloze-answer">${ans}</span>`;
    return hideOthers && side === 'q' ? '<span class="cloze-other">[...]</span>' : `<span class="cloze-other-shown">${ans}</span>`;
  });
}
export function renderTemplate(fmt, fields, ctx = {}) {
  let out = String(fmt || '');
  // Conditionals {{#F}}...{{/F}} and {{^F}}...{{/F}}
  for (let i = 0; i < 5; i++) {
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, f, body) => hasValue(fields[f.trim()]) ? body : '')
      .replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, f, body) => hasValue(fields[f.trim()]) ? '' : body);
  }
  out = out.replace(/\{\{([^}]+)\}\}/g, (m, expr) => {
    expr = expr.trim();
    if (expr === 'FrontSide') return ctx.frontSide || '';
    const parts = expr.split(':'); const field = parts.pop().trim(); const filters = parts.map(p => p.trim());
    if (field === 'Tags') return (ctx.tags || []).join(' ');
    if (field === 'Deck') return escapeHtml(ctx.deckName || '');
    let val = fields[field] ?? '';
    for (const f of filters.reverse()) {
      if (f === 'cloze') val = renderCloze(val, ctx.ord || 1, ctx.side || 'q');
      else if (f === 'hint') val = hasValue(val) ? `<details class="hint-box"><summary>Show ${escapeHtml(field)}</summary>${val}</details>` : '';
      else if (f === 'text') val = stripHtml(val);
      else if (f === 'type') { ctx.typeField = field; val = ctx.side === 'q' ? '<div class="type-answer-slot"></div>' : (ctx.typedResult || ''); }
      else if (f === 'cloze-only') val = [...String(val).matchAll(CLOZE_RE)].filter(m => parseInt(m[1], 10) === (ctx.ord || 1)).map(m => m[2]).join(', ');
    }
    return val;
  });
  return out;
}
const hasValue = (v) => v != null && (stripHtml(v).trim() !== '' || /<img|<audio|\[sound:/.test(v));

export function renderCard(card, side = 'q', extra = {}) {
  const note = db.notes.get(card.noteId); if (!note) return { html: '<i>Missing note</i>', css: '' };
  const nt = db.notetypes.get(note.notetypeId); const deck = db.decks.get(card.deckId);
  const fields = fieldMap(note, nt);
  const ctx = { ord: card.ord, side: 'q', tags: note.tags, deckName: deck?.name, ...extra };
  const tpl = nt.kind === 'cloze' ? nt.templates[0] : (nt.templates[card.ord] || nt.templates[0]);
  const q = renderTemplate(tpl.qfmt, fields, ctx);
  if (side === 'q') return { html: resolveMedia(q), css: nt.css, typeField: ctx.typeField, typeAnswer: ctx.typeField ? stripHtml(fields[ctx.typeField]) : null };
  const a = renderTemplate(tpl.afmt, fields, { ...ctx, side: 'a', frontSide: q });
  return { html: resolveMedia(a), css: nt.css, typeField: ctx.typeField };
}

// Quizlet-style pairs (term/definition) for a deck or note
export function notePairs(note, nt) {
  nt = nt || db.notetypes.get(note.notetypeId);
  const cards = noteCards(note.id);
  if (nt.kind === 'cloze') {
    return cards.map(c => ({ cardId: c.id, noteId: note.id, card: c, note,
      term: stripHtml(renderCloze(note.fields[0], c.ord, 'q')).replace(/\[\.\.\.\]/g, '_____'), termHtml: renderCloze(note.fields[0], c.ord, 'q'),
      definition: [...String(note.fields[0]).matchAll(CLOZE_RE)].filter(m => parseInt(m[1], 10) === c.ord).map(m => m[2]).join(', '), defHtml: null, image: findImage(note.fields.join(' ')), starred: note.starred }));
  }
  const f = note.fields; const c = cards[0];
  const imgIdx = nt.id === NT.IMAGE ? 0 : -1;
  const termIdx = imgIdx === 0 ? 1 : 0, defIdx = imgIdx === 0 ? 2 : 1;
  const term = stripHtml(f[termIdx] || ''), definition = stripHtml(f[defIdx] || '');
  return [{ cardId: c?.id, noteId: note.id, card: c, note, term: nt.id === NT.IMAGE ? (term || '(image)') : term, termHtml: resolveMedia(f[termIdx] || ''), definition, defHtml: resolveMedia(f[defIdx] || ''), image: findImage(f.join(' ')), termImage: findImage(f[termIdx] || '') || (imgIdx === 0 ? findImage(f[0]) : null), defImage: findImage(f[defIdx] || ''), starred: note.starred }];
}
export function deckPairs(deckId, { starredOnly = false } = {}) {
  const out = []; for (const n of deckNotes(deckId)) { if (starredOnly && !n.starred) continue; out.push(...notePairs(n)); }
  return out.filter(p => p.term || p.definition || p.image);
}
export function findImage(html) { const m = /<img[^>]+src="([^"]+)"/i.exec(html || ''); return m ? resolveMediaUrl(m[1]) : null; }

// ---------- Media ----------
const urlCache = new Map();
export function addMedia({ dataUrl, name = 'image', mime = 'image/png' }) {
  const id = 'm' + uid(); db.media.put({ id, name, mime, data: dataUrl, created: now(), size: dataUrl.length }); return id;
}
export function resolveMediaUrl(src) {
  if (!src) return src;
  if (src.startsWith('media://')) { const m = db.media.get(src.slice(8)); return m ? m.data : ''; }
  return src;
}
export function resolveMedia(html) { return String(html || '').replace(/src="media:\/\/([^"]+)"/g, (m, id) => `src="${resolveMediaUrl('media://' + id)}" data-media="${id}"`); }
export function gcMedia() {
  const used = new Set(); for (const n of db.notes.all()) for (const f of n.fields) for (const m of String(f).matchAll(/media:\/\/([a-z0-9]+)/g)) used.add(m[1]);
  for (const d of db.decks.all()) if (d.cover && d.cover.startsWith('media://')) used.add(d.cover.slice(8));
  const stale = db.media.all().filter(m => !used.has(m.id)).map(m => m.id); if (stale.length) db.media.removeMany(stale);
}
export async function fileToDataUrl(file, maxDim = 1600) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return url;
  return new Promise(res => { const img = new Image(); img.onload = () => { const sc = Math.min(1, maxDim / Math.max(img.width, img.height)); if (sc >= 1 && file.size < 400000) return res(url); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86)); }; img.onerror = () => res(url); img.src = url; });
}

// ---------- Tags ----------
export function allTags() { const m = new Map(); for (const n of db.notes.all()) for (const t of n.tags) m.set(t, (m.get(t) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }

// ---------- Sample content ----------
export function createSampleDecks() {
  const f = createFolder('Languages', '#6366f1');
  const spanish = createDeck({ name: 'Spanish Essentials', description: 'Everyday Spanish vocabulary to get you talking fast.', folderId: f.id, color: '#f59e0b', langFront: 'es', langBack: 'en' });
  addNotesBulk(spanish.id, NT.BASIC, [
    ['hola', 'hello'], ['gracias', 'thank you'], ['por favor', 'please'], ['buenos días', 'good morning'], ['buenas noches', 'good night'],
    ['¿cómo estás?', 'how are you?'], ['la casa', 'the house'], ['el perro', 'the dog'], ['el gato', 'the cat'], ['comer', 'to eat'],
    ['beber', 'to drink'], ['la escuela', 'the school'], ['el libro', 'the book'], ['la ciudad', 'the city'], ['el tiempo', 'the weather / time'],
    ['rojo', 'red'], ['azul', 'blue'], ['verde', 'green'], ['grande', 'big'], ['pequeño', 'small'],
  ], ['spanish', 'vocab']);
  const geo = createDeck({ name: 'World Capitals', description: 'Capital cities of the world.', color: '#10b981' });
  addNotesBulk(geo.id, NT.BASIC, [
    ['France', 'Paris'], ['Japan', 'Tokyo'], ['Australia', 'Canberra'], ['Canada', 'Ottawa'], ['Brazil', 'Brasília'], ['Egypt', 'Cairo'],
    ['Germany', 'Berlin'], ['Italy', 'Rome'], ['Kenya', 'Nairobi'], ['Argentina', 'Buenos Aires'], ['South Korea', 'Seoul'], ['Norway', 'Oslo'],
    ['Turkey', 'Ankara'], ['Peru', 'Lima'], ['Thailand', 'Bangkok'], ['Portugal', 'Lisbon'],
  ], ['geography']);
  const bio = createDeck({ name: 'Cell Biology (Cloze)', description: 'Cloze deletions covering the basics of the cell.', color: '#ec4899', notetypeId: NT.CLOZE });
  addNotesBulk(bio.id, NT.CLOZE, [
    ['The {{c1::mitochondria}} is the powerhouse of the cell, producing {{c2::ATP}} through cellular respiration.', ''],
    ['{{c1::Ribosomes}} are the site of {{c2::protein synthesis}}.', ''],
    ['The {{c1::nucleus}} contains the cell\'s genetic material in the form of {{c2::DNA}}.', ''],
    ['The {{c1::cell membrane}} is a {{c2::phospholipid bilayer}} that controls what enters and leaves the cell.', ''],
    ['Plant cells have a rigid {{c1::cell wall}} made of {{c2::cellulose}}.', ''],
    ['{{c1::Photosynthesis}} takes place in the {{c2::chloroplasts}}.', ''],
  ], ['biology']);
  const cs = createDeck({ name: 'Computer Science Terms', description: 'Core CS concepts every developer should know.', color: '#3b82f6', notetypeId: NT.REVERSED });
  addNotesBulk(cs.id, NT.REVERSED, [
    ['Algorithm', 'A finite sequence of well-defined instructions to solve a problem'], ['Big O notation', 'Describes the upper bound of an algorithm\'s growth rate'],
    ['Recursion', 'A function that calls itself to solve smaller instances of a problem'], ['Hash table', 'A data structure mapping keys to values via a hash function'],
    ['Stack', 'LIFO data structure: last in, first out'], ['Queue', 'FIFO data structure: first in, first out'], ['Binary search', 'Finds an item in a sorted list by repeatedly halving the search range'],
    ['Mutex', 'A lock ensuring only one thread accesses a resource at a time'], ['Compiler', 'Translates source code into machine code before execution'], ['Garbage collection', 'Automatic reclamation of memory no longer in use'],
  ], ['cs']);
  return [spanish, geo, bio, cs];
}
export { DAY };
