// Exporters: text/CSV, Recall JSON, Anki .apkg, printable sheet, full backups.
import { db } from './db.js';
import { deckNotes, noteCards, S, notePairs } from './models.js';
import { h, svgIcon, stripHtml, escapeHtml, downloadBlob, bytesToB64, uid } from './utils.js';
import { modal, toast, segmented, toggle, select, settingRow } from './ui.js';
import { loadSql } from './importers.js';
import { TYPE, QUEUE, today } from './scheduler.js';

const native = () => window.recallNative;
export async function saveText(name, content, filters) {
  if (native()) { const r = await native().saveFile({ defaultPath: name, filters: filters || [{ name: 'Text', extensions: [name.split('.').pop()] }], data: content }); if (!r.canceled) toast(`Saved to ${r.path}`, 'success', { duration: 4000 }); return !r.canceled; }
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), name); return true;
}
export async function saveBinary(name, bytes, filters) {
  if (native()) { const r = await native().saveFile({ defaultPath: name, filters, data: bytesToB64(bytes), encoding: 'base64' }); if (!r.canceled) toast(`Saved to ${r.path}`, 'success', { duration: 4000 }); return !r.canceled; }
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), name); return true;
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';

// ---------- Text ----------
export function deckToText(deck, { sep = '\t', rowSep = '\n', includeTags = false, html = false } = {}) {
  const lines = [];
  for (const n of deckNotes(deck.id)) { const f = n.fields.map(x => html ? x : stripHtml(x).replace(/\s+/g, ' ').trim()); const cells = [f[0] || '', f[1] || '']; if (includeTags) cells.push(n.tags.join(' ')); lines.push(cells.map(c => sep === ',' ? csvCell(c) : c.replace(new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')).join(sep)); }
  return lines.join(rowSep);
}
const csvCell = (c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;

// ---------- JSON ----------
export function decksToJson(decks, { includeProgress = true, includeMedia = true } = {}) {
  const mediaIds = new Set(); const ntIds = new Set();
  const sets = decks.map(d => { const notes = deckNotes(d.id).map(n => { for (const f of n.fields) for (const m of String(f).matchAll(/media:\/\/([a-z0-9]+)/g)) mediaIds.add(m[1]); ntIds.add(n.notetypeId); const o = { fields: n.fields, tags: n.tags, starred: n.starred, notetypeId: n.notetypeId }; if (includeProgress) o.cards = noteCards(n.id).map(c => ({ ord: c.ord, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, left: c.left, stability: c.stability, difficulty: c.difficulty, lastReview: c.lastReview, mastery: c.mastery, flag: c.flag })); return o; }); return { name: d.name, description: d.description, color: d.color, notetypeId: d.notetypeId, langFront: d.langFront, langBack: d.langBack, notes }; });
  const out = { app: 'recall-set', version: 1, exported: Date.now(), sets };
  out.notetypes = [...ntIds].map(id => db.notetypes.get(id)).filter(nt => nt && !nt.builtin);
  if (includeMedia) sets[0] && (sets[0].media = [...mediaIds].map(id => db.media.get(id)).filter(Boolean));
  return JSON.stringify(out);
}
export async function exportAllJson() { const txt = JSON.stringify(db.snapshot(true)); return saveText(`recall-backup-${new Date().toISOString().slice(0, 10)}.json`, txt, [{ name: 'JSON', extensions: ['json'] }]); }
export async function createBackup(manual = false, label = '') {
  const snap = JSON.stringify(db.snapshot(true)); const name = `recall-${label ? label + '-' : ''}${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.json`;
  if (manual) return saveText(name, snap, [{ name: 'Recall backup', extensions: ['json'] }]);
  if (native()) { const last = db.getKV('lastAutoBackup', 0); if (!label && Date.now() - last < 5 * 3600000) return; await native().backupWrite({ name, data: snap }); db.setKV('lastAutoBackup', Date.now()); }
}

// ---------- Anki .apkg ----------
async function sha1hex(str) { const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)); return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function decksToApkg(decks, { includeScheduling = true } = {}) {
  const SQL = await loadSql(); const sdb = new SQL.Database();
  sdb.run(`CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn); CREATE INDEX ix_revlog_usn on revlog (usn); CREATE INDEX ix_cards_nid on cards (nid); CREATE INDEX ix_cards_sched on cards (did, queue, due); CREATE INDEX ix_revlog_cid on revlog (cid); CREATE INDEX ix_notes_csum on notes (csum);`);
  const nowS = Math.floor(Date.now() / 1000); const crt = nowS - (today() % 100000) * 86400; // so that our day numbers map onto Anki days
  const ankiToday = Math.floor((nowS - crt) / 86400); const ourToday = today();
  const models = {}; const ankiDecks = { 1: { id: 1, name: 'Default', mod: nowS, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 10, extendRev: 50 } };
  const media = {}; let mediaIdx = 0; const mediaNames = new Map();
  const mediaFile = (id) => { if (mediaNames.has(id)) return mediaNames.get(id); const m = db.media.get(id); if (!m) return null; const ext = (m.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg'); const name = `recall-${id}.${ext}`; media[String(mediaIdx)] = { name, data: m.data }; mediaIdx++; mediaNames.set(id, name); return name; };
  let idBase = Date.now(); const nextId = () => ++idBase; const ntMid = new Map();
  const modelFor = (nt) => { if (ntMid.has(nt.id)) return ntMid.get(nt.id); const mid = nextId(); models[mid] = { id: mid, name: nt.name, type: nt.kind === 'cloze' ? 1 : 0, mod: nowS, usn: -1, sortf: 0, did: 1, tmpls: nt.templates.map((t, i) => ({ name: t.name, ord: i, qfmt: t.qfmt, afmt: t.afmt, bqfmt: '', bafmt: '', did: null })), flds: nt.fields.map((f, i) => ({ name: f, ord: i, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })), css: (nt.css || '').replace(/var\(--[^)]+\)/g, 'inherit'), latexPre: '\\documentclass[12pt]{article}\\special{papersize=3in,5in}\\usepackage[utf8]{inputenc}\\usepackage{amssymb,amsmath}\\pagestyle{empty}\\setlength{\\parindent}{0in}\\begin{document}', latexPost: '\\end{document}', tags: [], vers: [], req: nt.templates.map((t, i) => [i, 'any', [0]]) }; ntMid.set(nt.id, mid); return mid; };
  const usedRev = new Set(); const uniqueRevId = (t) => { let id = Math.round(t); while (usedRev.has(id)) id++; usedRev.add(id); return id; };
  const insNote = sdb.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)'); const insCard = sdb.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); const insRev = sdb.prepare('INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)');
  for (const d of decks) {
    const did = nextId(); ankiDecks[did] = { ...ankiDecks[1], id: did, name: d.name.replace(/::/g, ':'), desc: d.description || '' };
    for (const n of deckNotes(d.id)) {
      const nt = db.notetypes.get(n.notetypeId); const mid = modelFor(nt); const nid = nextId();
      const flds = n.fields.map(f => String(f).replace(/<img([^>]*?)src="media:\/\/([a-z0-9]+)"([^>]*)>/g, (m, a, id, b) => { const name = mediaFile(id); return name ? `<img${a}src="${name}"${b}>` : ''; }));
      while (flds.length < nt.fields.length) flds.push('');
      const sfld = stripHtml(flds[0]); const csum = parseInt((await sha1hex(sfld)).slice(0, 8), 16);
      insNote.run([nid, uid().slice(0, 10), mid, nowS, -1, n.tags.length ? ` ${n.tags.join(' ')} ` : '', flds.join('\x1f'), sfld, csum, 0, '']);
      for (const c of noteCards(n.id)) {
        const cid = nextId(); let type = 0, queue = 0, due = c.due, ivl = 0, factor = 0, reps = 0, lapses = 0, left = 0;
        if (includeScheduling && c.type !== TYPE.NEW) { type = c.type === TYPE.RELEARN ? 3 : c.type; queue = c.queue === QUEUE.SUSPENDED ? -1 : c.queue === QUEUE.BURIED ? -2 : (c.type === TYPE.REVIEW ? 2 : 1); ivl = c.ivl; factor = c.factor || 2500; reps = c.reps; lapses = c.lapses; left = c.left ? c.left * 1001 : 0; due = c.type === TYPE.REVIEW ? ankiToday + (c.due - ourToday) : Math.floor(c.due / 1000); if (queue === -1 || queue === -2) { /* keep due */ } }
        else if (includeScheduling && c.queue === QUEUE.SUSPENDED) queue = -1;
        insCard.run([cid, nid, did, nt.kind === 'cloze' ? c.ord - 1 : c.ord, nowS, -1, type, queue, due, ivl, factor, reps, lapses, left, 0, 0, c.flag || 0, '']);
        if (includeScheduling) for (const r of db.revlog.filter(r => r.cardId === c.id)) insRev.run([uniqueRevId(r.time), cid, -1, r.rating, r.ivl, r.lastIvl || 0, r.factor || 0, r.took || 0, r.type === TYPE.NEW ? 0 : r.type === TYPE.REVIEW ? 1 : 2]);
      }
    }
  }
  insNote.free(); insCard.free(); insRev.free();
  const firstMid = Object.keys(models)[0] || '0';
  const conf = { nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0, sortBackwards: false, addToCur: true, curDeck: 1, newBury: true, newSpread: 0, dueCounts: true, curModel: firstMid, collapseTime: 1200 };
  const dconf = { 1: { id: 1, name: 'Default', replayq: true, lapse: { leechFails: 8, minInt: 1, delays: [10], leechAction: 0, mult: 0 }, rev: { perDay: 200, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, ease4: 1.3, bury: true, minSpace: 1 }, timer: 0, maxTaken: 60, usn: 0, new: { perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7], initialFactor: 2500, bury: true, order: 1 }, mod: 0, autoplay: true } };
  sdb.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [crt, nowS, nowS * 1000, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(ankiDecks), JSON.stringify(dconf), '{}']);
  const bytes = sdb.export(); sdb.close();
  const zip = new window.JSZip(); zip.file('collection.anki2', bytes);
  const mediaMap = {}; for (const [k, v] of Object.entries(media)) { mediaMap[k] = v.name; const b64 = v.data.split(',')[1]; if (b64) zip.file(k, b64, { base64: true }); }
  zip.file('media', JSON.stringify(mediaMap));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------- Printable ----------
export function printDeck(deck, { layout = 'table' } = {}) {
  const pairs = deckNotes(deck.id).flatMap(n => notePairs(n));
  const rows = pairs.map(p => `<tr><td>${p.termHtml || escapeHtml(p.term)}</td><td>${p.defHtml || escapeHtml(p.definition)}</td></tr>`).join('');
  const cards = pairs.map(p => `<div class="pc"><div class="f">${p.termHtml || escapeHtml(p.term)}</div><div class="b">${p.defHtml || escapeHtml(p.definition)}</div></div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(deck.name)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:24px}h1{font-size:22px;margin:0 0 4px}p{color:#555;margin:0 0 18px}table{width:100%;border-collapse:collapse}td{border:1px solid #ccc;padding:8px 10px;vertical-align:top;font-size:14px}td:first-child{width:38%;font-weight:600}img{max-height:80px;max-width:140px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pc{border:1px dashed #999;border-radius:8px;padding:14px;break-inside:avoid;min-height:90px}.pc .f{font-weight:700;margin-bottom:6px}.pc .b{color:#333;font-size:13px}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(deck.name)}</h1><p>${escapeHtml(deck.description || '')} · ${pairs.length} terms · exported from Recall</p>${layout === 'table' ? `<table>${rows}</table>` : `<div class="grid">${cards}</div>`}</body></html>`;
  const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'; document.body.append(frame);
  frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); }, 300);
}

// ---------- Dialog ----------
export function showExportDialog(deck) {
  let format = 'text', sep = '\t', rowSep = '\n', includeTags = false, includeProgress = true, includeMedia = true, selected = new Set(deck ? [deck.id] : db.decks.all().map(d => d.id)); let layout = 'table';
  const body = h('div', { class: 'col' });
  const draw = () => {
    body.innerHTML = '';
    if (!deck) body.append(h('div', { class: 'field' }, h('label', {}, 'Sets to export'), h('div', { class: 'deck-check-list' }, ...db.decks.all().sort((a, b) => a.name.localeCompare(b.name)).map(d => h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: selected.has(d.id), onChange: e => { e.target.checked ? selected.add(d.id) : selected.delete(d.id); } }), d.name)))));
    body.append(h('div', { class: 'field' }, h('label', {}, 'Format'), segmented([{ value: 'text', label: 'Text / CSV' }, { value: 'json', label: 'Recall JSON' }, { value: 'apkg', label: 'Anki .apkg' }, { value: 'print', label: 'Print / PDF' }], format, v => { format = v; draw(); }, { className: 'lg' })));
    if (format === 'text') body.append(h('div', { class: 'col' }, settingRow('Between term and definition', segmented([{ value: '\t', label: 'Tab' }, { value: ',', label: 'Comma' }, { value: ' - ', label: 'Dash' }], sep, v => { sep = v; })), settingRow('Between cards', segmented([{ value: '\n', label: 'New line' }, { value: ';', label: 'Semicolon' }], rowSep, v => { rowSep = v; })), toggle(includeTags, v => { includeTags = v; }, { label: 'Include tags column' }), h('p', { class: 'small muted' }, 'Tab-separated text pastes straight into Quizlet, Excel or Google Sheets.')));
    if (format === 'json') body.append(h('div', { class: 'col' }, toggle(includeProgress, v => { includeProgress = v; }, { label: 'Include study progress', description: 'Scheduling, mastery and flags for every card.' }), toggle(includeMedia, v => { includeMedia = v; }, { label: 'Include images' }), h('p', { class: 'small muted' }, 'Best for moving sets between Recall installs. Re-import with Import → From file.')));
    if (format === 'apkg') body.append(h('div', { class: 'col' }, toggle(includeProgress, v => { includeProgress = v; }, { label: 'Include scheduling and review history' }), h('p', { class: 'small muted' }, 'Creates a standard Anki package (legacy schema) with your card templates, images, intervals and review log. Open it in Anki with File → Import.')));
    if (format === 'print') body.append(h('div', { class: 'col' }, settingRow('Layout', segmented([{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cut-out cards' }], layout, v => { layout = v; })), h('p', { class: 'small muted' }, 'Opens the system print dialog. Choose "Save as PDF" as the printer to make a PDF.')));
  };
  draw();
  modal({ title: 'Export', size: 'md', content: body, actions: [{ label: 'Cancel', value: null }, { label: 'Export', variant: 'primary', onClick: async (api) => { const decks = [...selected].map(id => db.decks.get(id)).filter(Boolean); if (!decks.length) { toast('Select at least one set', 'warning'); return false; } const btn = api.box.querySelector('.btn-primary'); btn.classList.add('loading');
    try {
      if (format === 'text') { if (decks.length === 1) await saveText(`${safeName(decks[0].name)}.${sep === ',' ? 'csv' : 'txt'}`, deckToText(decks[0], { sep, rowSep, includeTags }), [{ name: sep === ',' ? 'CSV' : 'Text', extensions: [sep === ',' ? 'csv' : 'txt'] }]); else await saveText(`recall-sets.${sep === ',' ? 'csv' : 'txt'}`, decks.map(d => `# ${d.name}\n${deckToText(d, { sep, rowSep, includeTags })}`).join('\n\n'), [{ name: 'Text', extensions: ['txt', 'csv'] }]); }
      else if (format === 'json') await saveText(`${decks.length === 1 ? safeName(decks[0].name) : 'recall-sets'}.json`, decksToJson(decks, { includeProgress, includeMedia }), [{ name: 'JSON', extensions: ['json'] }]);
      else if (format === 'apkg') { const bytes = await decksToApkg(decks, { includeScheduling: includeProgress }); await saveBinary(`${decks.length === 1 ? safeName(decks[0].name) : 'recall-export'}.apkg`, bytes, [{ name: 'Anki package', extensions: ['apkg'] }]); }
      else { decks.forEach((d, i) => setTimeout(() => printDeck(d, { layout }), i * 800)); }
      return true;
    } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'error'); return false; } finally { btn.classList.remove('loading'); } } }] });
}
