// Deck options: SRS presets (Anki-style) + per-set settings
import { db } from '../db.js';
import { DEFAULT_PRESET, deckPreset, updateDeck } from '../models.js';
import { h, uid, svgIcon } from '../utils.js';
import { modal, toggle, select, numberInput, settingRow, toast, prompt, confirm, colorPicker, slider, tabs } from '../ui.js';

const LANGS = [['auto', 'Auto detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['el', 'Greek'], ['he', 'Hebrew'], ['tr', 'Turkish'], ['pl', 'Polish'], ['sv', 'Swedish'], ['la', 'Latin']];
export const langOptions = () => LANGS.map(([value, label]) => ({ value, label }));

export function showDeckOptions(deck, { onSave, tab = 'scheduling' } = {}) {
  let preset = structuredClone(deckPreset(deck)); let presetId = preset.id; let deckPatch = { name: deck.name, description: deck.description || '', color: deck.color, langFront: deck.langFront || 'auto', langBack: deck.langBack || 'auto', presetId: deck.presetId };
  const body = h('div', {}); let active = tab;
  const parseSteps = (s) => s.split(/[\s,]+/).filter(Boolean).map(x => { const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d)?$/i.exec(x.trim()); if (!m) return NaN; const v = parseFloat(m[1]); const u = (m[2] || 'm').toLowerCase(); return u.startsWith('h') ? v * 60 : u === 'd' ? v * 1440 : v; }).filter(x => !isNaN(x) && x > 0);
  const fmtSteps = (arr) => arr.map(m => m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`).join(' ');
  const draw = () => {
    body.innerHTML = '';
    body.append(tabs([{ id: 'scheduling', label: 'Scheduling', icon: 'brain' }, { id: 'limits', label: 'Daily limits & order', icon: 'sliders' }, { id: 'advanced', label: 'Advanced', icon: 'settings' }, { id: 'set', label: 'This set', icon: 'cards' }], active, t => { active = t; draw(); }));
    const sec = h('div', { class: 'options-body' });
    if (active !== 'set') {
      const presets = db.presets.all();
      sec.append(h('div', { class: 'preset-bar' }, h('div', { class: 'field grow' }, h('label', {}, 'Options preset'), select(presets.map(p => ({ value: p.id, label: p.name })), presetId, v => { presetId = v; preset = structuredClone(db.presets.get(v)); deckPatch.presetId = v; draw(); })),
        h('button', { class: 'btn btn-sm', onClick: async () => { const name = await prompt('', { title: 'New preset name', value: 'Custom' }); if (!name) return; const p = { ...DEFAULT_PRESET(), ...structuredClone(preset), id: 'preset_' + uid(), name, builtin: false }; db.presets.put(p); preset = p; presetId = p.id; deckPatch.presetId = p.id; draw(); } }, svgIcon('plus', 14), 'New'),
        h('button', { class: 'btn btn-sm', onClick: async () => { const name = await prompt('', { title: 'Rename preset', value: preset.name }); if (name) { preset.name = name; draw(); } } }, 'Rename'),
        h('button', { class: 'btn btn-sm btn-danger', disabled: preset.builtin, onClick: async () => { if (!await confirm('Delete this preset? Sets using it will fall back to Default.')) return; for (const d of db.decks.all()) if (d.presetId === presetId) { d.presetId = 'preset_default'; db.decks.put(d); } db.presets.remove(presetId); presetId = 'preset_default'; preset = structuredClone(db.presets.get(presetId)); deckPatch.presetId = presetId; draw(); } }, 'Delete'),
        h('span', { class: 'small muted' }, `Used by ${db.decks.filter(d => d.presetId === presetId).length} set(s)`)));
    }
    if (active === 'scheduling') {
      sec.append(settingRow('Algorithm', select([{ value: 'sm2', label: 'SM-2 (Anki classic)' }, { value: 'fsrs', label: 'FSRS-4.5 (modern, retention-based)' }], preset.algorithm, v => { preset.algorithm = v; draw(); }), preset.algorithm === 'fsrs' ? 'FSRS models memory stability and difficulty per card and schedules to hit your desired retention.' : 'The proven SuperMemo-2 scheduler with ease factors, as used by Anki for years.'));
      if (preset.algorithm === 'fsrs') sec.append(settingRow('Desired retention', slider(Math.round(preset.desiredRetention * 100), v => { preset.desiredRetention = v / 100; }, { min: 70, max: 97, step: 1, format: v => v + '%' }), 'Higher retention means more frequent reviews. 90% is the recommended balance.'));
      sec.append(settingRow('Learning steps', h('input', { class: 'input', style: { width: '200px' }, value: fmtSteps(preset.learningSteps), onChange: e => { const s = parseSteps(e.target.value); if (s.length) preset.learningSteps = s; e.target.value = fmtSteps(preset.learningSteps); } }), 'Delays between new-card repetitions, e.g. "1m 10m" or "10m 1h 1d".'));
      sec.append(settingRow('Relearning steps', h('input', { class: 'input', style: { width: '200px' }, value: fmtSteps(preset.relearningSteps), onChange: e => { preset.relearningSteps = parseSteps(e.target.value); e.target.value = fmtSteps(preset.relearningSteps); } }), 'Steps after you forget a review card. Leave blank to skip relearning.'));
      sec.append(settingRow('Graduating interval', numberInput(preset.graduatingInterval, v => { preset.graduatingInterval = v; }, { min: 1, max: 365, suffix: 'days' }), 'Interval after finishing the learning steps with "Good".'));
      sec.append(settingRow('Easy interval', numberInput(preset.easyInterval, v => { preset.easyInterval = v; }, { min: 1, max: 365, suffix: 'days' }), 'Interval when you press "Easy" on a new card.'));
      if (preset.algorithm === 'sm2') {
        sec.append(settingRow('Starting ease', numberInput(Math.round(preset.startingEase * 100), v => { preset.startingEase = v / 100; }, { min: 130, max: 500, suffix: '%' }), 'Default ease factor for new cards. 250% is Anki\'s default.'));
        sec.append(settingRow('Easy bonus', numberInput(Math.round(preset.easyBonus * 100), v => { preset.easyBonus = v / 100; }, { min: 100, max: 300, suffix: '%' }), 'Extra multiplier applied when answering "Easy" on a review.'));
        sec.append(settingRow('Hard interval', numberInput(Math.round(preset.hardMultiplier * 100), v => { preset.hardMultiplier = v / 100; }, { min: 100, max: 200, suffix: '%' }), 'Multiplier applied to the current interval for "Hard".'));
        sec.append(settingRow('Interval modifier', numberInput(Math.round(preset.intervalModifier * 100), v => { preset.intervalModifier = v / 100; }, { min: 50, max: 200, suffix: '%' }), 'Global multiplier for review intervals. Lower = more frequent reviews.'));
        sec.append(settingRow('New interval after lapse', numberInput(Math.round(preset.lapseMultiplier * 100), v => { preset.lapseMultiplier = v / 100; }, { min: 0, max: 100, suffix: '%' }), 'Percentage of the previous interval kept after forgetting (0% resets).'));
        sec.append(settingRow('Minimum interval after lapse', numberInput(preset.minLapseInterval, v => { preset.minLapseInterval = v; }, { min: 1, max: 365, suffix: 'days' })));
      }
      sec.append(settingRow('Maximum interval', numberInput(preset.maxInterval, v => { preset.maxInterval = v; }, { min: 1, max: 36500, suffix: 'days' }), 'Reviews will never be scheduled further out than this.'));
    } else if (active === 'limits') {
      sec.append(settingRow('New cards per day', numberInput(preset.newPerDay, v => { preset.newPerDay = v; }, { min: 0, max: 9999 }), 'How many unseen cards to introduce each day.'));
      sec.append(settingRow('Maximum reviews per day', numberInput(preset.reviewsPerDay, v => { preset.reviewsPerDay = v; }, { min: 0, max: 99999 })));
      sec.append(settingRow('New card order', select([{ value: 'added', label: 'In order added' }, { value: 'random', label: 'Random' }], preset.newOrder, v => { preset.newOrder = v; })));
      sec.append(settingRow('New/review mix', select([{ value: 'mix', label: 'Mix new with reviews' }, { value: 'after', label: 'Show new after reviews' }, { value: 'before', label: 'Show new before reviews' }], preset.newMix, v => { preset.newMix = v; })));
      sec.append(settingRow('Review order', select([{ value: 'due', label: 'Due date, then overdue first' }, { value: 'random', label: 'Random' }, { value: 'difficulty', label: 'Hardest first' }], preset.reviewOrder, v => { preset.reviewOrder = v; })));
      sec.append(toggle(preset.buryRelated, v => { preset.buryRelated = v; }, { label: 'Bury siblings', description: 'Hide other cards from the same note until the next day (e.g. the reverse card).' }));
      sec.append(toggle(preset.fuzz, v => { preset.fuzz = v; }, { label: 'Interval fuzz', description: 'Randomise intervals slightly so cards added together don\'t always come up together.' }));
    } else if (active === 'advanced') {
      sec.append(settingRow('Leech threshold', numberInput(preset.leechThreshold, v => { preset.leechThreshold = v; }, { min: 1, max: 99, suffix: 'lapses' }), 'After this many lapses a card is tagged "leech".'));
      sec.append(settingRow('Leech action', select([{ value: 'tag', label: 'Tag only' }, { value: 'suspend', label: 'Tag and suspend' }], preset.leechAction, v => { preset.leechAction = v; })));
      sec.append(settingRow('Auto-advance', numberInput(preset.autoAdvance, v => { preset.autoAdvance = v; }, { min: 0, max: 120, suffix: 'sec' }), 'Automatically reveal the answer after N seconds (0 = off).'));
      sec.append(settingRow('Maximum answer time', numberInput(preset.maxAnswerSeconds, v => { preset.maxAnswerSeconds = v; }, { min: 5, max: 600, suffix: 'sec' }), 'Caps the time recorded per card in statistics.'));
      sec.append(toggle(preset.showTimer, v => { preset.showTimer = v; }, { label: 'Show answer timer', description: 'Display elapsed time while reviewing.' }));
      if (preset.algorithm === 'fsrs') sec.append(settingRow('FSRS weights', h('input', { class: 'input', style: { width: '320px', fontFamily: 'var(--font-mono)', fontSize: '.78rem' }, placeholder: 'default (17 comma-separated numbers)', value: preset.fsrsWeights ? preset.fsrsWeights.join(', ') : '', onChange: e => { const arr = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number); preset.fsrsWeights = arr.length === 17 && arr.every(x => !isNaN(x)) ? arr : null; if (e.target.value && !preset.fsrsWeights) toast('Weights must be 17 numbers', 'error'); } }), 'Paste optimised weights from the FSRS optimizer, or leave blank for defaults.'));
    } else {
      sec.append(h('div', { class: 'field' }, h('label', {}, 'Title'), h('input', { class: 'input', value: deckPatch.name, onInput: e => { deckPatch.name = e.target.value; } })));
      sec.append(h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', {}, 'Description'), h('textarea', { class: 'input', rows: 2, value: deckPatch.description, onInput: e => { deckPatch.description = e.target.value; } })));
      sec.append(h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', {}, 'Colour'), colorPicker(deckPatch.color, c => { deckPatch.color = c; })));
      sec.append(settingRow('Front language', select(langOptions(), deckPatch.langFront, v => { deckPatch.langFront = v; }), 'Used for text-to-speech pronunciation of terms.'));
      sec.append(settingRow('Back language', select(langOptions(), deckPatch.langBack, v => { deckPatch.langBack = v; }), 'Used for text-to-speech of definitions.'));
    }
    body.append(sec);
  };
  draw();
  const m = modal({ title: 'Set options', size: 'lg', content: body, actions: [{ label: 'Cancel', value: null }, { label: 'Save', variant: 'primary', onClick: () => { db.presets.put(preset); updateDeck(deck, deckPatch); toast('Options saved', 'success'); onSave && onSave(); return true; } }] });
  return m.promise;
}
