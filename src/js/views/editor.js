// Set editor: title, options, rich-text term rows, cloze, images, paste import, autosave.
import { db } from '../db.js';
import { createDeck, updateDeck, deckNotes, addNote, updateNote, deleteNotes, NT, addMedia, fileToDataUrl, S, updateSettings, resolveMedia, normalizeTags, clozeOrdinals } from '../models.js';
import { h, svgIcon, debounce, stripHtml, escapeHtml, plural, uid } from '../utils.js';
import { toast, confirm, showMenu, modal, select, colorPicker, segmented, dragSort, prompt } from '../ui.js';
import { navigate, renderSidebar } from '../app.js';
import { parseText, showImportDialog } from '../importers.js';
import { langOptions } from './deckoptions.js';
import { sfx } from '../audio.js';

export function render(main, route) {
  const isNew = route.name === 'new'; let deck = isNew ? null : db.decks.get(route.parts[0]);
  if (!isNew && !deck) { navigate('library', { replace: true }); return; }
  const folderId = route.query.folder || (deck ? deck.folderId : null);
  let notetypeId = deck ? deck.notetypeId : (S().editor.defaultNotetype || NT.BASIC);
  const nt = () => db.notetypes.get(notetypeId) || db.notetypes.get(NT.BASIC);
  // rows: {key, noteId, fields[], tags[], starred, dirty}
  let rows = deck ? deckNotes(deck.id).map(n => ({ key: n.id, noteId: n.id, fields: n.fields.slice(), tags: n.tags.slice(), starred: n.starred, ntId: n.notetypeId })) : [];
  if (!rows.length) rows = [blank(), blank(), blank()];
  function blank() { return { key: uid(), noteId: null, fields: nt().fields.map(() => ''), tags: [], starred: false, ntId: notetypeId }; }
  const meta = { name: deck ? deck.name : '', description: deck ? deck.description || '' : '', color: deck ? deck.color : null, langFront: deck ? deck.langFront || 'auto' : 'auto', langBack: deck ? deck.langBack || 'auto' : 'auto', folderId };
  let saveState = 'saved';
  const inner = h('div', { class: 'main-inner editor-page' }); main.append(inner);
  const status = h('span', { class: 'save-status' });
  const setStatus = (s) => { saveState = s; status.textContent = s === 'saved' ? 'All changes saved' : s === 'saving' ? 'Saving…' : 'Unsaved changes'; status.className = `save-status ${s}`; };
  // Header
  const titleInput = h('input', { class: 'editor-title', placeholder: 'Enter a title, like "Biology – Chapter 22"', value: meta.name, onInput: e => { meta.name = e.target.value; scheduleSave(); } });
  const descInput = h('textarea', { class: 'editor-desc', rows: 1, placeholder: 'Add a description…', value: meta.description, onInput: e => { meta.description = e.target.value; autoGrow(e.target); scheduleSave(); } });
  inner.append(h('div', { class: 'editor-head' }, h('div', { class: 'row', style: { gap: '8px' } }, h('button', { class: 'crumb', onClick: () => deck ? navigate(`set/${deck.id}`) : navigate('library') }, svgIcon('arrowLeft', 14), deck ? 'Back to set' : 'Library'), status), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => importText() }, svgIcon('upload', 16), 'Import'), h('button', { class: 'btn', onClick: optionsMenu }, svgIcon('sliders', 16), 'Options'), h('button', { class: 'btn btn-primary', onClick: async () => { await saveNow(); if (deck) navigate(`set/${deck.id}`); } }, svgIcon('check', 16), 'Done'))));
  inner.append(h('div', { class: 'panel editor-meta' }, titleInput, descInput, h('div', { class: 'row wrap editor-meta-row' },
    h('div', { class: 'field' }, h('label', {}, 'Card type'), select(db.notetypes.all().map(t => ({ value: t.id, label: t.name })), notetypeId, v => changeNotetype(v))),
    h('div', { class: 'field' }, h('label', {}, 'Folder'), select([{ value: '', label: 'No folder' }, ...db.folders.all().map(f => ({ value: f.id, label: f.name }))], meta.folderId || '', v => { meta.folderId = v || null; scheduleSave(); })),
    h('div', { class: 'field' }, h('label', {}, 'Term language'), select(langOptions(), meta.langFront, v => { meta.langFront = v; scheduleSave(); })),
    h('div', { class: 'field' }, h('label', {}, 'Definition language'), select(langOptions(), meta.langBack, v => { meta.langBack = v; scheduleSave(); })),
    h('div', { class: 'field' }, h('label', {}, 'Colour'), colorPicker(meta.color, c => { meta.color = c; scheduleSave(); })))));
  // Rows
  const rowsWrap = h('div', { class: 'editor-rows' }); inner.append(rowsWrap);
  const footer = h('div', { class: 'editor-footer' }, h('button', { class: 'btn btn-lg btn-soft', onClick: () => { rows.push(blank()); renderRows(); focusRow(rows.length - 1, 0); } }, svgIcon('plus', 18), 'Add card'), h('span', { class: 'muted small' }, 'Tip: press Tab to move between fields, Enter on the last field to add a card. Paste images directly into a field.'));
  inner.append(footer);
  function renderRows() {
    rowsWrap.innerHTML = '';
    rows.forEach((r, i) => rowsWrap.append(rowEl(r, i)));
    dragSort(rowsWrap, { itemSel: '.editor-row', onSort: (ids) => { rows = ids.map(k => rows.find(r => r.key === k)); scheduleSave(); renderRows(); } });
    updateCount();
  }
  const countEl = h('span', { class: 'small muted' });
  footer.append(countEl);
  function updateCount() { const n = rows.filter(hasContent).length; countEl.textContent = `${plural(n, 'card')}`; }
  const hasContent = (r) => r.fields.some(f => stripHtml(f).trim() || /<img|\[sound:/.test(f));
  function rowEl(r, i) {
    const t = db.notetypes.get(r.ntId) || nt(); const isCloze = t.kind === 'cloze';
    const row = h('div', { class: `editor-row sortable-item ${isCloze ? 'cloze-row' : ''}`, 'data-id': r.key });
    const head = h('div', { class: 'editor-row-head' }, h('span', { class: 'drag-handle' }, svgIcon('grip', 16)), h('span', { class: 'row-num' }, i + 1), h('span', { class: 'grow' }),
      h('button', { class: `icon-btn sm ${r.starred ? 'starred' : ''}`, 'data-tip': 'Star', onClick: e => { r.starred = !r.starred; e.currentTarget.classList.toggle('starred', r.starred); scheduleSave(); } }, svgIcon('star', 15)),
      h('button', { class: 'icon-btn sm', 'data-tip': 'Tags', onClick: () => editTags(r, row) }, svgIcon('tag', 15)),
      h('button', { class: 'icon-btn sm', 'data-tip': 'Swap term & definition', onClick: () => { if (r.fields.length >= 2) { [r.fields[0], r.fields[1]] = [r.fields[1], r.fields[0]]; renderRows(); scheduleSave(); } } }, svgIcon('refresh', 15)),
      h('button', { class: 'icon-btn sm danger', 'data-tip': 'Delete card', onClick: () => removeRow(r) }, svgIcon('trash', 15)));
    row.append(head);
    const fieldsWrap = h('div', { class: `editor-fields ${t.fields.length > 2 ? 'three' : ''}` });
    t.fields.forEach((fname, fi) => {
      const ed = h('div', { class: 'rich-field selectable', contenteditable: 'true', 'data-placeholder': isCloze && fi === 0 ? 'Type a sentence, select a word and press the ✂ button (or Ctrl+Shift+C) to make a cloze deletion' : fname, spellcheck: 'true', html: resolveMedia(r.fields[fi] || ''), 'data-row': r.key, 'data-field': fi });
      ed.addEventListener('input', () => { r.fields[fi] = cleanHtml(ed.innerHTML); scheduleSave(); updateCount(); if (isCloze && fi === 0) updateClozeBadge(row, r); });
      ed.addEventListener('keydown', e => onFieldKey(e, r, fi, i, t.fields.length));
      ed.addEventListener('paste', e => onPaste(e, ed, r, fi));
      ed.addEventListener('focus', () => { row.classList.add('focused'); toolbar.dataset.target = `${r.key}:${fi}`; });
      ed.addEventListener('blur', () => { row.classList.remove('focused'); });
      ed.addEventListener('drop', async e => { const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); for (const f of files) await insertImage(ed, f, r, fi); } });
      const label = h('div', { class: 'field-label' }, fname, isCloze && fi === 0 ? h('span', { class: 'cloze-badge' }) : null);
      fieldsWrap.append(h('div', { class: 'editor-field' }, ed, label));
    });
    const toolbar = h('div', { class: 'rich-toolbar' },
      tbBtn('bold', 'Bold', 'Ctrl+B', () => fmt('bold')), tbBtn('italic', 'Italic', 'Ctrl+I', () => fmt('italic')), tbBtn('underline', 'Underline', 'Ctrl+U', () => fmt('underline')), tbBtn('highlight', 'Highlight', '', () => fmt('hiliteColor', 'rgba(250,204,21,.55)')),
      h('span', { class: 'divider-v' }), tbBtn('scissors', 'Cloze deletion (new number)', 'Ctrl+Shift+C', () => makeCloze(r, row, false)), tbBtn('copy', 'Cloze deletion (same number)', 'Ctrl+Shift+Alt+C', () => makeCloze(r, row, true)),
      h('span', { class: 'divider-v' }), tbBtn('image', 'Insert image', '', () => pickImage(r, row)), tbBtn('x', 'Clear formatting', '', () => fmt('removeFormat')));
    row.append(fieldsWrap, toolbar);
    if (r.tags.length) row.append(h('div', { class: 'row-tags' }, ...r.tags.map(tg => h('span', { class: 'chip' }, tg))));
    if (isCloze) updateClozeBadge(row, r);
    return row;
  }
  const tbBtn = (icon, tip, kbd, fn) => h('button', { class: 'icon-btn sm', 'data-tip': tip, 'data-kbd': kbd, onMousedown: e => { e.preventDefault(); fn(); } }, svgIcon(icon, 14));
  function fmt(cmd, val) { document.execCommand(cmd, false, val); const ed = document.activeElement; if (ed && ed.classList.contains('rich-field')) ed.dispatchEvent(new Event('input')); }
  function updateClozeBadge(row, r) { const b = row.querySelector('.cloze-badge'); if (!b) return; const n = clozeOrdinals(r.fields[0]).length; b.textContent = n ? `${n} cloze${n > 1 ? 's' : ''} → ${n} card${n > 1 ? 's' : ''}` : ''; }
  function makeCloze(r, row, sameNumber) {
    const ed = document.activeElement; if (!ed || !ed.classList.contains('rich-field')) { toast('Select text in a field first', 'warning'); return; }
    const sel = window.getSelection(); const text = sel.toString(); if (!text) { toast('Select the word(s) to hide', 'warning'); return; }
    const fi = parseInt(ed.dataset.field, 10); const ords = clozeOrdinals(r.fields[fi]); const n = sameNumber && ords.length ? Math.max(...ords) : (ords.length ? Math.max(...ords) + 1 : 1);
    document.execCommand('insertText', false, `{{c${n}::${text}}}`); ed.dispatchEvent(new Event('input'));
    if ((db.notetypes.get(r.ntId) || nt()).kind !== 'cloze') { r.ntId = NT.CLOZE; if (r.fields.length < 2) r.fields.push(''); toast('Card switched to Cloze type', 'info'); renderRows(); }
  }
  async function pickImage(r, row) { const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } }); inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const ed = row.querySelector('.rich-field.focused') || row.querySelector('.rich-field'); await insertImage(ed, f, r, parseInt(ed.dataset.field, 10)); }; document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000); }
  async function insertImage(ed, file, r, fi) { const dataUrl = await fileToDataUrl(file); const id = addMedia({ dataUrl, name: file.name, mime: file.type }); ed.focus(); document.execCommand('insertHTML', false, `<img src="${dataUrl}" data-media="${id}"> `); r.fields[fi] = cleanHtml(ed.innerHTML); scheduleSave(); updateCount(); }
  function onPaste(e, ed, r, fi) {
    const items = Array.from(e.clipboardData.items || []); const img = items.find(it => it.type.startsWith('image/'));
    if (img) { e.preventDefault(); insertImage(ed, img.getAsFile(), r, fi); return; }
    const text = e.clipboardData.getData('text/plain');
    if (text && /\t|\n/.test(text) && fi === 0 && !stripHtml(ed.innerHTML).trim()) { // multi-row paste → import rows
      const parsed = parseText(text, { sep: text.includes('\t') ? 'tab' : (text.includes(' - ') ? ' - ' : 'comma'), rowSep: 'newline' });
      if (parsed.rows.length > 1) { e.preventDefault(); const idx = rows.indexOf(r); const newRows = parsed.rows.map(f => ({ ...blank(), fields: f.concat(Array(Math.max(0, nt().fields.length - f.length)).fill('')) })); rows.splice(idx, 1, ...newRows); renderRows(); scheduleSave(); toast(`Pasted ${newRows.length} cards`, 'success'); return; }
    }
    e.preventDefault(); document.execCommand('insertText', false, text);
  }
  function onFieldKey(e, r, fi, ri, nf) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); fmt('bold'); } else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); fmt('italic'); } else if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); fmt('underline'); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); makeCloze(r, e.target.closest('.editor-row'), e.altKey); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); rows.splice(ri + 1, 0, blank()); renderRows(); focusRow(ri + 1, 0); }
    else if (mod && e.key === 's') { e.preventDefault(); saveNow(); }
    else if (mod && e.key === 'Backspace' && !stripHtml(e.target.innerHTML).trim()) { e.preventDefault(); removeRow(r); }
    else if (e.key === 'Enter' && !e.shiftKey && (db.notetypes.get(r.ntId) || nt()).kind !== 'cloze') { e.preventDefault(); if (fi < nf - 1) focusRow(ri, fi + 1); else if (ri < rows.length - 1) focusRow(ri + 1, 0); else { rows.push(blank()); renderRows(); focusRow(ri + 1, 0); } }
    else if (e.key === 'Tab' && !e.shiftKey && S().editor.tabToNext && fi === nf - 1 && ri === rows.length - 1) { e.preventDefault(); rows.push(blank()); renderRows(); focusRow(ri + 1, 0); }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); focusRow(Math.min(rows.length - 1, ri + 1), fi); } else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); focusRow(Math.max(0, ri - 1), fi); }
  }
  function focusRow(ri, fi) { const el = rowsWrap.children[ri]?.querySelectorAll('.rich-field')[fi]; if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); } }
  async function removeRow(r) { if (hasContent(r) && !(await confirm('Delete this card?', { danger: true, okLabel: 'Delete' }))) return; if (r.noteId) deleteNotes([r.noteId]); rows = rows.filter(x => x !== r); if (!rows.length) rows.push(blank()); renderRows(); scheduleSave(); }
  async function editTags(r, row) { const v = await prompt('Separate tags with spaces or commas', { title: 'Tags', value: r.tags.join(' ') }); if (v === null) return; r.tags = normalizeTags(v.split(/[\s,]+/)); scheduleSave(); renderRows(); }
  function changeNotetype(v) { notetypeId = v; const t = nt(); rows.forEach(r => { r.ntId = v; while (r.fields.length < t.fields.length) r.fields.push(''); }); if (deck) { updateDeck(deck, { notetypeId: v }); } renderRows(); scheduleSave(); toast(`Card type: ${t.name}. Existing cards keep their fields; new cards will be regenerated on save.`, 'info'); }
  function optionsMenu(e) {
    showMenu([
      { label: 'Swap all terms and definitions', icon: 'refresh', onClick: () => { rows.forEach(r => { if (r.fields.length >= 2) [r.fields[0], r.fields[1]] = [r.fields[1], r.fields[0]]; }); renderRows(); scheduleSave(); } },
      { label: 'Sort alphabetically', icon: 'list', onClick: () => { rows.sort((a, b) => stripHtml(a.fields[0]).localeCompare(stripHtml(b.fields[0]))); renderRows(); scheduleSave(); } },
      { label: 'Remove duplicates', icon: 'copy', onClick: () => { const seen = new Set(); const before = rows.length; rows = rows.filter(r => { const k = stripHtml(r.fields[0]).trim().toLowerCase(); if (!k) return true; if (seen.has(k)) { if (r.noteId) deleteNotes([r.noteId]); return false; } seen.add(k); return true; }); renderRows(); scheduleSave(); toast(`Removed ${before - rows.length} duplicates`); } },
      { label: 'Remove empty cards', icon: 'trash', onClick: () => { rows = rows.filter(hasContent); if (!rows.length) rows.push(blank()); renderRows(); } },
      { label: 'Add tag to all cards', icon: 'tag', onClick: async () => { const v = await prompt('', { title: 'Tag to add', placeholder: 'e.g. chapter-3' }); if (v) { rows.forEach(r => { r.tags = normalizeTags([...r.tags, v]); }); renderRows(); scheduleSave(); } } },
      { label: 'Convert all to Cloze type', icon: 'scissors', onClick: () => changeNotetype(NT.CLOZE) },
      { separator: true },
      { label: 'Import from file…', icon: 'upload', onClick: () => { saveNow().then(() => showImportDialog({ deckId: deck ? deck.id : null })); } },
      { label: 'Delete this set', icon: 'trash', danger: true, disabled: !deck, onClick: async () => { if (await confirm('Delete this entire set?', { danger: true, okLabel: 'Delete' })) { const { deleteDeck } = await import('../models.js'); deleteDeck(deck.id); deck = null; navigate('library'); } } },
    ], { anchor: e.currentTarget, align: 'right' });
  }
  function importText() {
    const ta = h('textarea', { class: 'input', rows: 10, placeholder: 'Word 1\tDefinition 1\nWord 2\tDefinition 2\n\nor\n\nWord 1, Definition 1\nWord 2, Definition 2', style: { fontFamily: 'var(--font-mono)', fontSize: '.85rem' } });
    let sep = S().editor.parseSeparator || 'tab', rowSep = S().editor.parseRowSeparator || 'newline'; const customSep = h('input', { class: 'input input-sm', placeholder: 'custom', style: { width: '80px' } }); const customRow = h('input', { class: 'input input-sm', placeholder: 'custom', style: { width: '80px' } });
    const preview = h('div', { class: 'small muted' });
    const upd = () => { const p = parseText(ta.value, { sep: sep === 'custom' ? customSep.value || '\t' : sep, rowSep: rowSep === 'custom' ? customRow.value || '\n' : rowSep }); preview.textContent = ta.value.trim() ? `${p.rows.length} cards detected` : ''; };
    ta.addEventListener('input', upd); customSep.addEventListener('input', upd); customRow.addEventListener('input', upd);
    const m = modal({ title: 'Import terms from text', size: 'lg', content: h('div', { class: 'col' }, h('p', { class: 'muted small' }, 'Copy and paste your data here (from Word, Excel, Google Docs, Quizlet export, etc.)'), ta,
      h('div', { class: 'row wrap', style: { gap: '20px' } }, h('div', { class: 'field' }, h('label', {}, 'Between term and definition'), h('div', { class: 'row' }, segmented([{ value: 'tab', label: 'Tab' }, { value: 'comma', label: 'Comma' }, { value: ' - ', label: 'Dash' }, { value: 'custom', label: 'Custom' }], sep, v => { sep = v; upd(); }), customSep)), h('div', { class: 'field' }, h('label', {}, 'Between cards'), h('div', { class: 'row' }, segmented([{ value: 'newline', label: 'New line' }, { value: 'semicolon', label: 'Semicolon' }, { value: 'custom', label: 'Custom' }], rowSep, v => { rowSep = v; upd(); }), customRow))), preview),
      actions: [{ label: 'Cancel', value: null }, { label: 'Import', variant: 'primary', onClick: () => { const p = parseText(ta.value, { sep: sep === 'custom' ? customSep.value || '\t' : sep, rowSep: rowSep === 'custom' ? customRow.value || '\n' : rowSep }); if (!p.rows.length) { toast('Nothing to import', 'warning'); return false; } rows = rows.filter(hasContent); for (const f of p.rows) rows.push({ ...blank(), fields: f.concat(Array(Math.max(0, nt().fields.length - f.length)).fill('')) }); renderRows(); scheduleSave(); toast(`Added ${p.rows.length} cards`, 'success'); return true; } }] });
    setTimeout(() => ta.focus(), 80);
  }
  // Saving
  const scheduleSave = () => { setStatus('dirty'); debouncedSave(); };
  const debouncedSave = debounce(() => saveNow(), 900);
  async function saveNow() {
    const content = rows.filter(hasContent);
    if (!deck) { if (!meta.name.trim() && !content.length) { setStatus('saved'); return; } deck = createDeck({ name: meta.name.trim() || 'Untitled set', description: meta.description, folderId: meta.folderId, notetypeId, color: meta.color, langFront: meta.langFront, langBack: meta.langBack }); history.replaceState(null, '', `#/edit/${deck.id}`); }
    setStatus('saving');
    updateDeck(deck, { name: meta.name.trim() || deck.name, description: meta.description, folderId: meta.folderId, notetypeId, color: meta.color, langFront: meta.langFront, langBack: meta.langBack });
    const keep = new Set(); let order = 0;
    for (const r of rows) {
      if (!hasContent(r)) continue;
      if (r.noteId && db.notes.has(r.noteId)) { const n = db.notes.get(r.noteId); const changed = JSON.stringify(n.fields) !== JSON.stringify(r.fields) || JSON.stringify(n.tags) !== JSON.stringify(r.tags) || n.starred !== r.starred || n.notetypeId !== r.ntId || n.order !== order; if (changed) { n.order = order; updateNote(n, { fields: r.fields.slice(), tags: r.tags, starred: r.starred, notetypeId: r.ntId }); } }
      else { const n = addNote(deck.id, r.ntId, r.fields.slice(), r.tags, { starred: r.starred }); n.order = order; db.notes.put(n); r.noteId = n.id; }
      keep.add(r.noteId); order++;
    }
    const stale = deckNotes(deck.id).filter(n => !keep.has(n.id)).map(n => n.id); if (stale.length) deleteNotes(stale);
    setStatus('saved'); renderSidebar();
  }
  const cleanHtml = (html) => html.replace(/<div><br><\/div>/g, '<br>').replace(/<div>/g, '<br>').replace(/<\/div>/g, '').replace(/^<br>/, '').replace(/&nbsp;/g, ' ').replace(/<img([^>]*?)src="data:[^"]+"([^>]*?)data-media="([^"]+)"([^>]*)>/g, '<img$1src="media://$3"$2$4>').replace(/<img([^>]*?)data-media="([^"]+)"([^>]*?)src="data:[^"]+"([^>]*)>/g, '<img$1src="media://$2"$3$4>').trim();
  const autoGrow = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  renderRows(); setStatus('saved'); setTimeout(() => { autoGrow(descInput); if (route.query.note) { const el = rowsWrap.querySelector(`[data-id="${route.query.note}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.querySelector('.rich-field')?.focus(); el.classList.add('pop-in'); } } else if (isNew) titleInput.focus(); }, 50);
  return () => { if (saveState !== 'saved') saveNow(); };
}

// Quick edit of a single note in a modal (used from set page, browser, study modes)
export function quickEditNote(note, onSave) {
  const nt = db.notetypes.get(note.notetypeId); const fields = note.fields.slice();
  const eds = nt.fields.map((f, i) => h('div', { class: 'editor-field' }, h('div', { class: 'rich-field selectable', contenteditable: 'true', html: resolveMedia(fields[i] || ''), 'data-placeholder': f, onInput: e => { fields[i] = e.target.innerHTML.replace(/<img([^>]*?)src="data:[^"]+"([^>]*?)data-media="([^"]+)"([^>]*)>/g, '<img$1src="media://$3"$2$4>'); }, onPaste: e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); } }), h('div', { class: 'field-label' }, f)));
  const tagsInput = h('input', { class: 'input', value: note.tags.join(' '), placeholder: 'tags' });
  const m = modal({ title: 'Edit card', size: 'lg', content: h('div', { class: 'col' }, ...eds, h('div', { class: 'field' }, h('label', {}, 'Tags'), tagsInput)), actions: [{ label: 'Cancel', value: null }, { label: 'Save', variant: 'primary', onClick: () => { updateNote(note, { fields, tags: tagsInput.value.split(/[\s,]+/) }); toast('Card saved', 'success'); onSave && onSave(note); return true; } }] });
  setTimeout(() => eds[0].querySelector('.rich-field').focus(), 80);
  return m.promise;
}
