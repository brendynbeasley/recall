// Importers: pasted text / CSV / TSV, Quizlet exports, Anki .apkg (sql.js), Recall JSON sets and backups.
import { db } from './db.js';
import { createDeck, addNotesBulk, NT, addMedia, createFolder, deckNotes, S, updateSettings, normalizeTags } from './models.js';
import { h, svgIcon, stripHtml, escapeHtml, readFileAs, b64ToBytes, uid, DAY, dayNumber } from './utils.js';
import { modal, toast, segmented, select, toggle, confirm, settingRow } from './ui.js';
import { QUEUE, TYPE } from './scheduler.js';

// ---------- Text parsing ----------
export function parseText(text, { sep = 'tab', rowSep = 'newline', hasHeader = false } = {}) {
  text = String(text || '').replace(/\r\n?/g, '\n');
  const rowDelim = rowSep === 'newline' ? '\n' : rowSep === 'semicolon' ? ';' : rowSep; const colDelim = sep === 'tab' ? '\t' : sep === 'comma' ? ',' : sep;
  let rows;
  if (colDelim === ',' && rowDelim === '\n') rows = parseCsv(text); // handles quotes & embedded newlines
  else rows = text.split(rowDelim).map(line => line.split(colDelim).map(c => c.trim()));
  rows = rows.filter(r => r.some(c => c && c.trim()));
  if (hasHeader && rows.length) rows = rows.slice(1);
  // Quizlet copies definitions with trailing newlines inside; also handle "term - definition" lines when sep is dash
  const unquote = (c) => { c = c.trim(); if (c.length >= 2 && c[0] === '"' && c[c.length - 1] === '"') c = c.slice(1, -1).replace(/""/g, '"'); return c.trim(); };
  return { rows: rows.map(r => r.map(unquote)) };
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function detectSeparator(text) { const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20); const score = (d) => lines.filter(l => l.includes(d)).length; if (score('\t') >= lines.length * 0.6) return 'tab'; if (score(',') >= lines.length * 0.6) return 'comma'; if (score(' - ') >= lines.length * 0.6) return ' - '; if (score(';') >= lines.length * 0.6) return ';'; if (score(':') >= lines.length * 0.6) return ':'; return 'tab'; }

// ---------- sql.js loader ----------
let sqlPromise = null;
export function loadSql() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = new Promise((res, rej) => { if (window.initSqlJs) return res(window.initSqlJs({ locateFile: f => `vendor/${f}` })); const s = document.createElement('script'); s.src = 'vendor/sql-wasm.js'; s.onload = () => res(window.initSqlJs({ locateFile: f => `vendor/${f}` })); s.onerror = () => rej(new Error('Could not load SQLite engine')); document.head.append(s); });
  return sqlPromise;
}
// Minimal protobuf reader for Anki template/field config blobs
function pbStrings(bytes) { const out = {}; let i = 0; const varint = () => { let r = 0, s = 0, b; do { b = bytes[i++]; r += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80); return r; }; const dec = new TextDecoder();
  while (i < bytes.length) { const tag = varint(); const f = Math.floor(tag / 8), wt = tag % 8; if (wt === 0) varint(); else if (wt === 1) i += 8; else if (wt === 5) i += 4; else if (wt === 2) { const len = varint(); out[f] = dec.decode(bytes.slice(i, i + len)); i += len; } else break; } return out; }

// ---------- Anki .apkg ----------
export async function parseApkg(bytes, { onProgress } = {}) {
  const zip = await window.JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const dbName = names.includes('collection.anki21') ? 'collection.anki21' : names.includes('collection.anki2') ? 'collection.anki2' : null;
  if (!dbName) { if (names.includes('collection.anki21b')) throw new Error('This package uses the newest Anki format (zstd-compressed). In Anki, use File → Export with "Support older Anki versions" ticked, then import again.'); throw new Error('No Anki collection found in this file.'); }
  onProgress && onProgress('Reading collection…');
  const SQL = await loadSql(); const data = await zip.file(dbName).async('uint8array'); const sdb = new SQL.Database(data);
  const q = (sql) => { const r = sdb.exec(sql); if (!r.length) return []; const cols = r[0].columns; return r[0].values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]]))); };
  const col = q('select * from col')[0] || {}; const crt = col.crt || Math.floor(Date.now() / 1000);
  let models = {}; try { models = JSON.parse(col.models || '{}'); } catch (e) { models = {}; }
  let decks = {}; try { decks = JSON.parse(col.decks || '{}'); } catch (e) { decks = {}; }
  const tables = q("select name from sqlite_master where type='table'").map(r => r.name);
  if (tables.includes('notetypes') && !Object.keys(models).length) {
    for (const nt of q('select id, name, mtime_secs, config from notetypes')) { const cfg = nt.config ? pbStrings(nt.config) : {}; const flds = q(`select ord, name from fields where ntid=${nt.id} order by ord`); const tmpls = q(`select ord, name, config from templates where ntid=${nt.id} order by ord`).map(t => { const c = t.config ? pbStrings(t.config) : {}; return { name: t.name, ord: t.ord, qfmt: c[1] || '', afmt: c[2] || '' }; }); const isCloze = tmpls.some(t => /\{\{cloze:/.test(t.qfmt)); models[nt.id] = { id: nt.id, name: nt.name, type: isCloze ? 1 : 0, flds: flds.map(f => ({ name: f.name, ord: f.ord })), tmpls, css: cfg[3] || '' }; }
  }
  if (tables.includes('decks') && !Object.keys(decks).length) for (const d of q('select id, name from decks')) decks[d.id] = { id: d.id, name: String(d.name).replace(/\x1f/g, '::') };
  const notes = q('select id, mid, flds, tags from notes'); const cards = q('select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left from cards');
  let revlog = []; try { revlog = q('select id, cid, ease, ivl, lastIvl, factor, time, type from revlog'); } catch (e) { revlog = []; }
  sdb.close();
  // media map
  let mediaMap = {}; try { const mf = zip.file('media'); if (mf) { const txt = await mf.async('string'); mediaMap = JSON.parse(txt); } } catch (e) { mediaMap = {}; }
  const mediaByName = {}; for (const [k, v] of Object.entries(mediaMap)) mediaByName[v] = k;
  return { models, decks, notes, cards, revlog, crt, zip, mediaByName, dbName };
}
export async function importApkg(parsed, { folderId = null, importScheduling = true, importMedia = true, importHistory = true, onProgress } = {}) {
  const { models, decks, notes, cards, revlog, crt, zip, mediaByName } = parsed;
  const cardsByNote = new Map(); for (const c of cards) { if (!cardsByNote.has(c.nid)) cardsByNote.set(c.nid, []); cardsByNote.get(c.nid).push(c); }
  // Media: import referenced images
  const mediaIds = new Map(); const mimeOf = (n) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' })[n.split('.').pop().toLowerCase()];
  async function mediaRef(name) { if (mediaIds.has(name)) return mediaIds.get(name); const key = mediaByName[name]; const mime = mimeOf(name); if (!importMedia || key == null || !mime || !zip.file(key)) { mediaIds.set(name, null); return null; } try { const b64 = await zip.file(key).async('base64'); const id = addMedia({ dataUrl: `data:${mime};base64,${b64}`, name, mime }); mediaIds.set(name, id); return id; } catch (e) { mediaIds.set(name, null); return null; } }
  async function convertField(html) { let out = String(html || '').replace(/\[sound:[^\]]+\]/g, ''); const imgs = [...out.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)]; for (const m of imgs) { const id = await mediaRef(decodeURIComponent(m[1])); out = out.replace(m[0], id ? `<img src="media://${id}">` : ''); } return out; }
  // Group notes by deck (first card's deck)
  const byDeck = new Map(); for (const n of notes) { const cs = cardsByNote.get(n.id) || []; const did = cs[0] ? cs[0].did : null; if (!byDeck.has(did)) byDeck.set(did, []); byDeck.get(did).push(n); }
  const created = []; const todayAnki = Math.floor((Date.now() / 1000 - crt) / 86400); const todayUs = dayNumber(Date.now(), S().dayRollover ?? 4); const cardIdMap = new Map();
  const folderCache = new Map(); let count = 0;
  for (const [did, dnotes] of byDeck) {
    const ad = decks[did] || { name: 'Imported deck' }; const parts = String(ad.name).split('::'); const name = parts[parts.length - 1]; let fid = folderId;
    if (parts.length > 1 && !folderId) { const top = parts[0]; if (!folderCache.has(top)) { const ex = db.folders.find(f => f.name === top); folderCache.set(top, ex || createFolder(top)); } fid = folderCache.get(top).id; }
    // Determine dominant model to choose set notetype
    const mids = {}; for (const n of dnotes) mids[n.mid] = (mids[n.mid] || 0) + 1; const mainMid = Object.keys(mids).sort((a, b) => mids[b] - mids[a])[0]; const mainModel = models[mainMid];
    const isCloze = mainModel && mainModel.type === 1;
    const deck = createDeck({ name, description: `Imported from Anki (${dnotes.length} notes)`, folderId: fid, notetypeId: isCloze ? NT.CLOZE : (mainModel && mainModel.tmpls && mainModel.tmpls.length > 1 ? NT.REVERSED : NT.BASIC) });
    // Register custom note types that have more than 2 fields so content survives
    const ntIdFor = (model) => { if (!model) return NT.BASIC; if (model.type === 1) return NT.CLOZE; const nf = model.flds.length; if (nf <= 2 && model.tmpls.length <= 2) return model.tmpls.length > 1 ? NT.REVERSED : NT.BASIC; const key = 'nt_anki_' + model.id; if (!db.notetypes.has(key)) db.notetypes.put({ id: key, name: `${model.name} (Anki)`, kind: 'standard', fields: model.flds.map(f => f.name), templates: model.tmpls.map(t => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })), css: model.css || '' }); return key; };
    const rows = []; const rowNotes = [];
    for (const n of dnotes) { const model = models[n.mid]; const flds = String(n.flds).split('\x1f'); const conv = []; for (const f of flds) conv.push(await convertField(f)); rows.push({ fields: conv, tags: String(n.tags || '').trim().split(/\s+/).filter(Boolean), ntId: ntIdFor(model) }); rowNotes.push(n); count++; if (count % 200 === 0 && onProgress) { onProgress(`Imported ${count} notes…`); await new Promise(r => setTimeout(r, 0)); } }
    // add by notetype groups preserving order
    const addedNotes = [];
    for (const r of rows) { const [nn] = addNotesBulk(deck.id, r.ntId, [{ fields: r.fields, tags: r.tags }]); addedNotes.push(nn); }
    if (importScheduling) {
      const updates = [];
      addedNotes.forEach((nn, i) => { const ankiNote = rowNotes[i]; const acs = (cardsByNote.get(ankiNote.id) || []); const ours = db.cards.filter(c => c.noteId === nn.id).sort((a, b) => a.ord - b.ord);
        for (const oc of ours) { const ac = acs.find(x => x.ord === oc.ord) || acs.find(x => x.ord === oc.ord - 1 && models[ankiNote.mid]?.type === 1); if (!ac) continue; cardIdMap.set(ac.id, oc.id);
          oc.type = [TYPE.NEW, TYPE.LEARN, TYPE.REVIEW, TYPE.RELEARN][ac.type] ?? TYPE.NEW; oc.ivl = Math.max(0, ac.ivl); oc.factor = ac.factor || 2500; oc.reps = ac.reps; oc.lapses = ac.lapses; oc.left = ac.left % 1000;
          if (ac.queue === -1) oc.queue = QUEUE.SUSPENDED; else if (ac.queue === -2 || ac.queue === -3) oc.queue = QUEUE.BURIED; else if (ac.queue === 0) oc.queue = QUEUE.NEW; else if (ac.queue === 1 || ac.queue === 3) oc.queue = QUEUE.LEARN; else oc.queue = QUEUE.REVIEW;
          if (oc.type === TYPE.REVIEW || (oc.queue === QUEUE.REVIEW)) { oc.due = todayUs + (ac.due - todayAnki); if (oc.type !== TYPE.REVIEW) oc.type = TYPE.REVIEW; }
          else if (oc.queue === QUEUE.LEARN) { oc.due = ac.queue === 3 ? Date.now() + (ac.due - todayAnki) * DAY : (ac.due > 1e9 ? ac.due * 1000 : Date.now()); }
          else oc.due = ac.due;
          if (oc.type !== TYPE.NEW && !oc.lastReview) oc.lastReview = Date.now() - Math.max(0, (todayAnki - (ac.due - ac.ivl))) * DAY;
          updates.push(oc); } });
      if (updates.length) db.cards.putMany(updates);
    }
    created.push(deck);
  }
  if (importScheduling && importHistory && revlog.length) {
    const logs = []; for (const r of revlog) { const cid = cardIdMap.get(r.cid); if (!cid) continue; const c = db.cards.get(cid); logs.push({ id: uid(), cardId: cid, deckId: c ? c.deckId : null, time: r.id, rating: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, took: r.time, type: r.type === 0 ? TYPE.NEW : r.type === 1 ? TYPE.REVIEW : r.type === 2 ? TYPE.RELEARN : TYPE.NEW, kind: 'review' }); }
    db.revlog.putMany(logs);
  }
  db.setKV('ach_import', true);
  return created;
}

// ---------- JSON ----------
export function importRecallJson(obj, { folderId = null } = {}) {
  if (obj && obj.app === 'recall' && obj.data) return { kind: 'backup', obj };
  const sets = obj && obj.app === 'recall-set' ? obj.sets : Array.isArray(obj) ? [{ name: 'Imported set', notes: obj.map(x => ({ fields: [x.term ?? x.front ?? x.question ?? x.word ?? '', x.definition ?? x.back ?? x.answer ?? x.meaning ?? ''], tags: x.tags || [] })) }] : null;
  if (!sets) throw new Error('Unrecognised JSON format');
  // A set file may name its own folder; used when the user didn't pick one (reuses a same-named folder)
  if (!folderId && obj && typeof obj.folder === 'string' && obj.folder.trim()) { const fname = obj.folder.trim(); folderId = (db.folders.find(f => f.name === fname) || createFolder(fname)).id; }
  const created = [];
  for (const s of sets) {
    if (s.media) for (const m of s.media) if (!db.media.has(m.id)) db.media.put(m);
    if (s.notetypes) for (const nt of s.notetypes) if (!db.notetypes.has(nt.id)) db.notetypes.put(nt);
    const d = createDeck({ name: s.name || 'Imported set', description: s.description || '', folderId, notetypeId: s.notetypeId && db.notetypes.has(s.notetypeId) ? s.notetypeId : NT.BASIC, color: s.color || null, langFront: s.langFront || 'auto', langBack: s.langBack || 'auto' });
    const groups = new Map(); for (const n of s.notes || []) { const k = n.notetypeId && db.notetypes.has(n.notetypeId) ? n.notetypeId : d.notetypeId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    for (const [k, arr] of groups) { const added = addNotesBulk(d.id, k, arr.map(n => ({ fields: n.fields, tags: n.tags || [] }))); added.forEach((nn, i) => { if (arr[i].starred) { nn.starred = true; db.notes.put(nn); } if (arr[i].cards) { const ours = db.cards.filter(c => c.noteId === nn.id).sort((a, b) => a.ord - b.ord); arr[i].cards.forEach((sc, j) => { if (ours[j]) { Object.assign(ours[j], sc, { id: ours[j].id, noteId: nn.id, deckId: d.id }); db.cards.put(ours[j]); } }); } }); }
    created.push(d);
  }
  db.setKV('ach_import', true);
  return { kind: 'sets', created };
}

// ---------- Dialog ----------
export function showImportDialog({ files = [], deckId = null, folderId = null, restore = false } = {}) {
  const native = window.recallNative; let mode = restore ? 'file' : 'file'; let picked = files.slice(); let pastedText = '';
  const opts = { sep: 'tab', rowSep: 'newline', hasHeader: false, swap: false, tags: '', target: deckId ? 'existing' : 'new', existingId: deckId || (db.decks.all()[0]?.id || ''), name: '', importScheduling: true, importMedia: true, importHistory: true, folderId, mergeBackup: false };
  const body = h('div', { class: 'import-body' }); let busy = false;
  const dropZone = h('div', { class: 'drop-zone', onClick: pickFiles }, svgIcon('upload', 28), h('div', { class: 'bold' }, 'Drop files here or click to browse'), h('div', { class: 'small muted' }, 'Quizlet export (.txt/.csv), spreadsheet (.csv/.tsv), Anki package (.apkg), Recall JSON'));
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); }); dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over')); dropZone.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('over'); picked = Array.from(e.dataTransfer.files); draw(); });
  async function pickFiles() {
    if (native) { const r = await native.openFile({ multiple: true, binary: true, filters: [{ name: 'All supported', extensions: ['txt', 'csv', 'tsv', 'apkg', 'colpkg', 'json'] }, { name: 'All files', extensions: ['*'] }] }); if (r.canceled) return; picked = r.files.map(f => ({ name: f.name, size: f.size, _b64: f.data })); draw(); }
    else { const inp = h('input', { type: 'file', multiple: true, accept: '.txt,.csv,.tsv,.apkg,.colpkg,.json', style: { display: 'none' } }); inp.onchange = () => { picked = Array.from(inp.files); draw(); }; document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000); }
  }
  const fileText = async (f) => f._b64 ? new TextDecoder().decode(b64ToBytes(f._b64)) : readFileAs(f, 'text');
  const fileBytes = async (f) => f._b64 ? b64ToBytes(f._b64) : new Uint8Array(await readFileAs(f, 'buffer'));
  const kindOf = (f) => { const ext = f.name.split('.').pop().toLowerCase(); return ext === 'apkg' || ext === 'colpkg' ? 'anki' : ext === 'json' ? 'json' : 'text'; };
  let preview = null;
  async function buildPreview() {
    preview = null; if (mode === 'paste') { if (!pastedText.trim()) return; const p = parseText(pastedText, opts); preview = { kind: 'text', rows: p.rows }; return; }
    if (!picked.length) return; const f = picked[0]; const kind = kindOf(f);
    if (kind === 'text') { const txt = await fileText(f); if (!opts._autoSep) { opts.sep = detectSeparator(txt); opts._autoSep = true; } const p = parseText(txt, opts); preview = { kind: 'text', rows: p.rows, name: f.name.replace(/\.[^.]+$/, '') }; }
    else if (kind === 'json') { try { const obj = JSON.parse(await fileText(f)); preview = { kind: 'json', obj, isBackup: obj && obj.app === 'recall' && !!obj.data, sets: obj && obj.app === 'recall-set' ? obj.sets.length : Array.isArray(obj) ? 1 : 0, count: obj && obj.app === 'recall' ? (obj.data.notes || []).length : obj && obj.app === 'recall-set' ? obj.sets.reduce((a, s) => a + (s.notes || []).length, 0) : Array.isArray(obj) ? obj.length : 0 }; } catch (e) { preview = { kind: 'error', error: 'Invalid JSON: ' + e.message }; } }
    else { try { const parsed = await parseApkg(await fileBytes(f)); preview = { kind: 'anki', parsed, decks: [...new Set(parsed.cards.map(c => c.did))].map(id => parsed.decks[id]?.name || 'Deck').filter(Boolean), notes: parsed.notes.length, cards: parsed.cards.length, media: Object.keys(parsed.mediaByName).length, revlog: parsed.revlog.length }; } catch (e) { preview = { kind: 'error', error: e.message }; } }
  }
  async function draw() {
    body.innerHTML = '';
    body.append(segmented([{ value: 'file', label: 'From file', icon: 'upload' }, { value: 'paste', label: 'Paste text', icon: 'type' }], mode, v => { mode = v; draw(); }, { className: 'lg' }));
    if (mode === 'file') { body.append(dropZone); if (picked.length) body.append(h('div', { class: 'picked-files' }, ...picked.map(f => h('div', { class: 'chip' }, svgIcon('cards', 12), f.name, h('span', { class: 'faint' }, ` ${(f.size / 1024).toFixed(0)} KB`))), picked.length > 1 ? h('span', { class: 'small muted' }, 'Each file becomes its own set.') : null)); }
    else { const ta = h('textarea', { class: 'input', rows: 9, placeholder: 'Paste terms here. One card per line, term and definition separated by a tab, comma or " - ".\n\nFrom Quizlet: open the set → ⋯ → Export → copy text.', value: pastedText, style: { fontFamily: 'var(--font-mono)', fontSize: '.85rem' }, onInput: e => { pastedText = e.target.value; opts.sep = detectSeparator(pastedText); debouncedPreview(); } }); body.append(ta); setTimeout(() => ta.focus(), 50); }
    const status = h('div', { class: 'import-status' }); body.append(status);
    if ((mode === 'file' && picked.length) || (mode === 'paste' && pastedText.trim())) { status.append(h('span', { class: 'skeleton', style: { width: '160px', height: '14px', display: 'inline-block' } })); await buildPreview(); status.innerHTML = ''; }
    if (!preview) return;
    if (preview.kind === 'error') { status.append(h('div', { class: 'import-error' }, svgIcon('alert', 18), preview.error)); return; }
    if (preview.kind === 'text') {
      const rows = preview.rows.map(r => opts.swap ? [r[1] || '', r[0] || '', ...r.slice(2)] : r);
      status.append(h('div', { class: 'row wrap', style: { gap: '18px', marginBottom: '10px' } }, h('div', { class: 'field' }, h('label', {}, 'Between term and definition'), segmented([{ value: 'tab', label: 'Tab' }, { value: 'comma', label: 'Comma' }, { value: ' - ', label: 'Dash' }, { value: ';', label: 'Semicolon' }, { value: ':', label: 'Colon' }], opts.sep, v => { opts.sep = v; draw(); })), h('div', { class: 'field' }, h('label', {}, 'Between cards'), segmented([{ value: 'newline', label: 'New line' }, { value: 'semicolon', label: 'Semicolon' }, { value: '|', label: 'Pipe' }], opts.rowSep, v => { opts.rowSep = v; draw(); })), h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: opts.hasHeader, onChange: e => { opts.hasHeader = e.target.checked; draw(); } }), 'First row is a header'), h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: opts.swap, onChange: e => { opts.swap = e.target.checked; draw(); } }), 'Swap columns')));
      status.append(h('div', { class: 'bold small', style: { marginBottom: '6px' } }, `${rows.length} cards detected${rows.length ? ` · ${Math.max(...rows.map(r => r.length))} columns` : ''}`));
      status.append(h('div', { class: 'preview-table' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Term'), h('th', {}, 'Definition'), rows.some(r => r.length > 2) ? h('th', {}, 'Extra / tags') : null)), h('tbody', {}, ...rows.slice(0, 6).map(r => h('tr', {}, h('td', {}, r[0] || ''), h('td', {}, r[1] || ''), rows.some(x => x.length > 2) ? h('td', { class: 'muted' }, r.slice(2).join(' · ')) : null))), rows.length > 6 ? h('tr', {}, h('td', { colspan: 3, class: 'muted center' }, `…and ${rows.length - 6} more`)) : null)));
      status.append(targetPicker(preview.name || (mode === 'paste' ? 'Pasted set' : 'Imported set'), true));
    } else if (preview.kind === 'json') {
      if (preview.isBackup) { status.append(h('div', { class: 'import-info' }, svgIcon('database', 18), h('div', {}, h('b', {}, 'Recall backup'), h('div', { class: 'small muted' }, `${preview.obj.data.decks?.length || 0} sets · ${preview.count} notes · ${preview.obj.data.revlog?.length || 0} review log entries · exported ${new Date(preview.obj.exported).toLocaleString()}`))), toggle(opts.mergeBackup, v => { opts.mergeBackup = v; }, { label: 'Merge into current data', description: 'Off = replace everything with the backup (recommended for restoring). On = add alongside existing data.' })); }
      else { status.append(h('div', { class: 'import-info' }, svgIcon('cards', 18), h('div', {}, h('b', {}, `${preview.sets} set(s) · ${preview.count} notes`), h('div', { class: 'small muted' }, 'Recall set export')))); status.append(targetPicker(null, false)); }
    } else if (preview.kind === 'anki') {
      status.append(h('div', { class: 'import-info' }, svgIcon('layers', 18), h('div', {}, h('b', {}, `${preview.decks.length} deck(s) · ${preview.notes} notes · ${preview.cards} cards`), h('div', { class: 'small muted' }, preview.decks.slice(0, 6).join(', ') + (preview.decks.length > 6 ? '…' : '') + ` · ${preview.media} media files · ${preview.revlog} reviews`))));
      status.append(toggle(opts.importScheduling, v => { opts.importScheduling = v; }, { label: 'Keep scheduling', description: 'Preserve intervals, ease and due dates so you continue where you left off.' }), toggle(opts.importHistory, v => { opts.importHistory = v; }, { label: 'Import review history', description: 'Needed for statistics and retention graphs.' }), toggle(opts.importMedia, v => { opts.importMedia = v; }, { label: 'Import images', description: 'Audio files are skipped (text-to-speech is used instead).' }), settingRow('Folder', select([{ value: '', label: 'Auto (from Anki deck hierarchy)' }, ...db.folders.all().map(f => ({ value: f.id, label: f.name }))], opts.folderId || '', v => { opts.folderId = v || null; })));
    }
  }
  function targetPicker(defaultName, allowExisting) {
    if (defaultName && !opts.name) opts.name = defaultName;
    const wrap = h('div', { class: 'col', style: { marginTop: '12px' } });
    const nameIn = h('input', { class: 'input', placeholder: 'Set name', value: opts.name, onInput: e => { opts.name = e.target.value; } });
    const tagIn = h('input', { class: 'input', placeholder: 'Tags for all cards (optional)', value: opts.tags, onInput: e => { opts.tags = e.target.value; } });
    const body2 = h('div', { class: 'col' });
    const redraw = () => { body2.innerHTML = ''; if (opts.target === 'new') body2.append(h('div', { class: 'row' }, nameIn, select([{ value: '', label: 'No folder' }, ...db.folders.all().map(f => ({ value: f.id, label: f.name }))], opts.folderId || '', v => { opts.folderId = v || null; }))); else body2.append(select(db.decks.all().map(d => ({ value: d.id, label: `${d.name} (${deckNotes(d.id).length})` })), opts.existingId, v => { opts.existingId = v; })); body2.append(tagIn); };
    if (allowExisting && db.decks.size) wrap.append(segmented([{ value: 'new', label: 'Create new set' }, { value: 'existing', label: 'Add to existing set' }], opts.target, v => { opts.target = v; redraw(); }));
    redraw(); wrap.append(body2); return wrap;
  }
  const debouncedPreview = (() => { let t; return () => { clearTimeout(t); t = setTimeout(draw, 250); }; })();
  async function doImport(api) {
    if (busy) return false; if (!preview || preview.kind === 'error') { toast('Nothing to import yet', 'warning'); return false; }
    busy = true; const btn = api.box.querySelector('.btn-primary'); btn.classList.add('loading'); btn.disabled = true;
    try {
      const tags = normalizeTags(opts.tags.split(/[\s,]+/)); let createdDecks = [];
      if (preview.kind === 'json' && preview.isBackup) { await db.restore(preview.obj, { merge: opts.mergeBackup }); toast('Backup restored', 'success'); setTimeout(() => location.reload(), 400); return true; }
      if (preview.kind === 'json') { const r = importRecallJson(preview.obj, { folderId: opts.folderId }); createdDecks = r.created; }
      else if (preview.kind === 'anki') { createdDecks = await importApkg(preview.parsed, { folderId: opts.folderId, importScheduling: opts.importScheduling, importMedia: opts.importMedia, importHistory: opts.importHistory }); }
      else {
        const sources = mode === 'paste' ? [{ name: opts.name || 'Pasted set', text: pastedText }] : await Promise.all(picked.filter(f => kindOf(f) === 'text').map(async f => ({ name: f.name.replace(/\.[^.]+$/, ''), text: await fileText(f) })));
        for (let i = 0; i < sources.length; i++) { const src = sources[i]; const rows = parseText(src.text, opts).rows.map(r => opts.swap ? [r[1] || '', r[0] || '', ...r.slice(2)] : r); if (!rows.length) continue;
          let deck; if (opts.target === 'existing' && db.decks.has(opts.existingId)) deck = db.decks.get(opts.existingId); else deck = createDeck({ name: (sources.length === 1 ? opts.name : '') || src.name || 'Imported set', folderId: opts.folderId });
          const isCloze = rows.every(r => /\{\{c\d+::/.test(r[0]));
          addNotesBulk(deck.id, isCloze ? NT.CLOZE : deck.notetypeId, rows.map(r => ({ fields: isCloze ? [r[0], r[1] || ''] : [r[0] || '', r[1] || ''], tags: r.length > 2 ? r.slice(2).join(' ').split(/[\s,]+/).filter(Boolean) : [] })), tags);
          if (!createdDecks.includes(deck)) createdDecks.push(deck); }
        // other kinds among multiple files
        for (const f of picked.filter(f => kindOf(f) !== 'text')) { if (kindOf(f) === 'anki') createdDecks.push(...await importApkg(await parseApkg(await fileBytes(f)), { folderId: opts.folderId })); else { const r = importRecallJson(JSON.parse(await fileText(f)), { folderId: opts.folderId }); if (r.kind === 'sets') createdDecks.push(...r.created); } }
      }
      db.setKV('ach_import', true);
      const total = createdDecks.reduce((a, d) => a + deckNotes(d.id).length, 0);
      toast(`Imported ${total} cards into ${createdDecks.length} set(s)`, 'success', { duration: 4000 });
      const { navigate, renderSidebar } = await import('./app.js'); renderSidebar();
      if (createdDecks.length === 1) navigate(`set/${createdDecks[0].id}`); else navigate('library');
      const { checkAchievements } = await import('./xp.js'); checkAchievements();
      return true;
    } catch (e) { console.error(e); toast('Import failed: ' + e.message, 'error', { duration: 6000 }); return false; }
    finally { busy = false; btn.classList.remove('loading'); btn.disabled = false; }
  }
  const api = modal({ title: restore ? 'Restore from file' : 'Import', size: 'lg', content: body, actions: [{ label: 'Cancel', value: null }, { label: 'Import', variant: 'primary', onClick: (a) => doImport(a) }] });
  draw();
  return api.promise;
}
export async function restoreBackupFlow(path) {
  const native = window.recallNative; if (!native) return;
  if (!await confirm('Restore this backup? Current data will be replaced (a safety backup is written first).', { danger: true, okLabel: 'Restore' })) return;
  try { const { createBackup } = await import('./exporters.js'); await createBackup(false, 'pre-restore'); const txt = await native.backupRead(path); const obj = JSON.parse(txt); await db.restore(obj, { merge: false }); toast('Backup restored. Reloading…', 'success'); setTimeout(() => location.reload(), 500); } catch (e) { toast('Restore failed: ' + e.message, 'error'); }
}
