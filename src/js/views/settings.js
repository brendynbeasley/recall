// Settings: appearance, study defaults, audio, startup, data, shortcuts, about
import { db } from '../db.js';
import { S, updateSettings, DEFAULT_SETTINGS, saveSettings } from '../models.js';
import { h, svgIcon, fmtDate, modKey, hexToHsl } from '../utils.js';
import { pageHeader, toggle, settingRow, select, numberInput, slider, segmented, toast, confirm, modal, tabs, prompt } from '../ui.js';
import { applyTheme, THEMES, ACCENTS, THEME_OWNS_ACCENT, native, showShortcuts, renderSidebar } from '../app.js';
import { getVoices, speak, sfx } from '../audio.js';
import { playIntro } from '../intro.js';
import { createBackup, exportAllJson, showExportDialog } from '../exporters.js';
import { showImportDialog, restoreBackupFlow } from '../importers.js';
import { renderSyncSettings } from './syncsettings.js';

let apSection = 'theme', apFilter = 'all';
const FONTS = ['System', 'Segoe UI', 'Inter', 'Georgia', 'Cambria', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Calibri', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond', 'Arial Rounded MT Bold'];

// Mini app mock rendered with a theme's own tokens (data-theme scopes the CSS variables to this element)
function themeSwatch(id, vars) { return h('div', { class: 'theme-swatch', 'data-theme': id, style: vars || {} }, h('div', { class: 'ts-bar' }), h('div', { class: 'ts-body' }, h('div', { class: 'ts-side' }, h('div', { class: 'ts-nav on' }), h('div', { class: 'ts-nav' }), h('div', { class: 'ts-nav' })), h('div', { class: 'ts-main' }, h('div', { class: 'ts-accent' }), h('div', { class: 'ts-line' }), h('div', { class: 'ts-line short' }), h('div', { class: 'ts-dots' }, h('i', { style: { background: 'var(--ok)' } }), h('i', { style: { background: 'var(--warn)' } }), h('i', { style: { background: 'var(--bad)' } }), h('i', { style: { background: 'var(--accent-2)' } }))))); }
export function render(main, route) {
  let tab = route.query.tab || 'appearance';
  const inner = h('div', { class: 'main-inner narrow' }); main.append(inner);
  const resetAppearance = async () => {
    if (!(await confirm('Reset theme, colours, text and motion to their defaults?', { okLabel: 'Reset' }))) return;
    const d = DEFAULT_SETTINGS; updateSettings({ theme: d.theme, accentPreset: d.accentPreset, accentHue: d.accentHue, accentOverride: false, radius: d.radius, density: d.density, fontScale: d.fontScale, uiFont: d.uiFont, cardFont: d.cardFont, glass: d.glass, ambient: 'vivid', backgroundFx: true, animations: true, reducedMotion: false });
    applyTheme(); draw(); toast('Appearance reset');
  };
  const draw = () => {
    inner.innerHTML = ''; const s = S(); inner.classList.toggle('ap-fit', tab === 'appearance');
    inner.append(pageHeader('Settings', 'Make Recall yours. Every option is saved instantly.'));
    inner.append(tabs([{ id: 'appearance', label: 'Appearance', icon: 'palette' }, { id: 'study', label: 'Study', icon: 'brain' }, { id: 'audio', label: 'Audio & speech', icon: 'volume' }, { id: 'startup', label: 'Startup & window', icon: 'layout' }, { id: 'data', label: 'Data & backups', icon: 'database' }, { id: 'sync', label: 'Sync', icon: 'cloud' }, { id: 'about', label: 'About', icon: 'info' }], tab, t => { tab = t; history.replaceState(null, '', `#/settings?tab=${t}`); draw(); }));
    const sec = (title, desc, ...kids) => h('div', { class: 'settings-section panel' }, h('h2', {}, title), desc ? h('p', {}, desc) : null, ...kids);
    const re = () => { saveSettings(); applyTheme(); };
    if (tab === 'appearance') {
      const amb = s.ambient || (s.backgroundFx === false ? 'off' : 'vivid');
      const set = (patch, redraw = true) => { updateSettings(patch); applyTheme(); if (redraw) draw(); };
      const touch = document.body.classList.contains('tabbar-mode');
      const current = THEMES.find(t => t.id === s.theme) || (s.customThemes || []).find(t => t.id === s.theme);
      // ---- Left: live preview (sticky) ----
      const preview = h('div', { class: 'ap-preview big' },
        h('div', { class: 'ap-pv-bg' }, h('i', { class: 'o1' }), h('i', { class: 'o2' })),
        h('div', { class: 'ap-pv-card' }, h('div', { class: 'ap-pv-eyebrow' }, 'Today'), h('div', { class: 'ap-pv-big' }, '22', h('span', {}, ' cards')), h('div', { class: 'ap-pv-sub' }, 'About 3 min · 20 new'), h('div', { class: 'ap-pv-btn' }, svgIcon('play', 12), 'Start review')),
        h('div', { class: 'ap-pv-side' },
          h('div', { class: 'ap-pv-row' }, h('i', {}), h('div', {}, h('b', {}, 'Bonds & Interest Rates'), h('span', {}, '48 cards · 62% mastered'))),
          h('div', { class: 'ap-pv-row' }, h('i', { style: { background: 'var(--ok)' } }), h('div', {}, h('b', {}, 'Computer Science'), h('span', {}, '20 cards · 35% mastered'))),
          h('div', { class: 'ap-pv-tabs' }, h('span', { class: 'on' }), h('span', {}), h('em', {}), h('span', {}), h('span', {}))));
      const left = h('div', { class: 'ap-left' }, preview,
        h('div', { class: 'ap-caption' }, h('div', {}, h('div', { class: 'ap-eyebrow' }, 'Live preview'), h('div', { class: 'ap-cap-name' }, current ? current.name : 'Theme'), h('div', { class: 'ap-cap-meta' }, [amb === 'off' ? 'Solid background' : amb === 'subtle' ? 'Subtle glow' : 'Vivid glow', `${Math.round(s.fontScale * 100)}% text`, s.uiFont].join(' · '))),
          h('button', { class: 'ap-reset', 'aria-label': 'Reset appearance', onClick: resetAppearance }, svgIcon('refresh', 15), 'Reset')));
      // ---- Right: tabbed control panel ----
      const sections = [['theme', 'Theme', 'palette'], ['colour', 'Colour', 'sparkles'], ['background', 'Background', 'layers'], ['text', 'Text', 'type'], ['motion', 'Motion', 'zap']];
      const seg = h('div', { class: 'ap-seg' }, ...sections.map(([id, label, icon]) => h('button', { class: `ap-seg-btn ${apSection === id ? 'on' : ''}`, onClick: () => { apSection = id; draw(); } }, svgIcon(icon, 15), h('span', {}, label))));
      const body = h('div', { class: 'ap-body' });
      const row = (label, control, hint) => h('div', { class: 'ap-row' }, h('div', { class: 'ap-row-l' }, h('div', { class: 'ap-row-t' }, label), hint ? h('div', { class: 'ap-row-h' }, hint) : null), h('div', { class: 'ap-row-c' }, control));
      const sw = (id, vars) => h('span', { class: 'ap-chip-sw', 'data-theme': id, style: vars || {} }, h('i', { class: 'bg' }), h('i', { class: 'sf' }), h('i', { class: 'ac' }));
      if (apSection === 'theme') {
        const filters = [['all', 'All'], ['dark', 'Dark'], ['light', 'Light']];
        const list = THEMES.filter(t => apFilter === 'all' || t.id === 'system' || (apFilter === 'dark' ? t.dark === true : t.dark === false));
        body.append(h('div', { class: 'ap-filter' }, ...filters.map(([id, l]) => h('button', { class: `ap-filter-btn ${apFilter === id ? 'on' : ''}`, onClick: () => { apFilter = id; draw(); } }, l))),
          h('div', { class: 'ap-chips' },
            ...list.map(t => h('button', { class: `ap-chip ${s.theme === t.id ? 'on' : ''}`, onClick: () => set({ theme: t.id }) }, t.id === 'system' ? h('span', { class: 'ap-chip-sw split' }, sw('light'), sw('dark')) : sw(t.id), h('span', { class: 'ap-chip-n' }, t.name), s.theme === t.id ? svgIcon('check', 14) : null)),
            ...(s.customThemes || []).map(t => h('button', { class: `ap-chip ${s.theme === t.id ? 'on' : ''}`, onClick: () => set({ theme: t.id }), onContextmenu: async e => { e.preventDefault(); if (await confirm(`Delete custom theme "${t.name}"?`, { danger: true })) set({ customThemes: s.customThemes.filter(x => x.id !== t.id), theme: s.theme === t.id ? 'dark' : s.theme }); } }, sw(t.base, t.vars), h('span', { class: 'ap-chip-n' }, t.name))),
            h('button', { class: 'ap-chip add', onClick: customThemeDialog }, h('span', { class: 'ap-chip-sw plus' }, svgIcon('plus', 14)), h('span', { class: 'ap-chip-n' }, 'Create your own'))));
      } else if (apSection === 'colour') {
        const owns = THEME_OWNS_ACCENT.includes(s.theme);
        body.append(
          h('div', { class: 'ap-accents' }, ...ACCENTS.map(x => h('button', { class: `ap-accent ${s.accentPreset === x.id ? 'active' : ''}`, style: { '--c': x.hex }, 'aria-label': x.id, onClick: () => set({ accentPreset: x.id, accentHue: x.hue }) })), h('label', { class: 'ap-accent custom', 'aria-label': 'Any colour' }, svgIcon('palette', 15), h('input', { type: 'color', value: '#6366f1', onInput: e => { const [hue] = hexToHsl(e.target.value); set({ accentPreset: 'custom', accentHue: hue }, false); } }))),
          row('Fine-tune', slider(s.accentHue, v => set({ accentHue: v, accentPreset: 'custom' }, false), { min: 0, max: 360, step: 1, format: v => `${v}°` })),
          row('Use my accent everywhere', h('div', {}, toggle(!!s.accentOverride, v => set({ accentOverride: v }), {})), owns ? 'This theme has its own accent. Turn on to use yours.' : 'Overrides themes with built-in accents.'));
      } else if (apSection === 'background') {
        const tile = (v, label, desc) => h('button', { class: `ap-amb ${amb === v ? 'active' : ''}`, onClick: () => set({ ambient: v, backgroundFx: v !== 'off' }) }, h('div', { class: `ap-amb-pv ${v}` }, h('i', { class: 'o1' }), h('i', { class: 'o2' })), h('b', {}, label), h('span', {}, desc));
        body.append(h('div', { class: 'ap-amb-grid' }, tile('vivid', 'Vivid', 'Glowing colour'), tile('subtle', 'Subtle', 'A soft hint'), tile('off', 'Off', 'Solid and calm')),
          row('Frosted glass', h('div', {}, toggle(s.glass, v => set({ glass: v }), {})), 'Blur behind floating bars and panels.'));
      } else if (apSection === 'text') {
        body.append(
          row('Text size', slider(Math.round(s.fontScale * 100), v => set({ fontScale: v / 100 }, false), { min: 80, max: 130, step: 5, format: v => `${v}%` })),
          row('Corner roundness', slider(s.radius, v => set({ radius: v }, false), { min: 0, max: 28, format: v => `${v}px` })),
          row('Density', segmented([{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfy' }, { value: 'spacious', label: 'Spacious' }], s.density, v => set({ density: v }, false))),
          row('Interface font', select(FONTS.map(f => ({ value: f, label: f })), s.uiFont, v => set({ uiFont: v }))),
          row('Flashcard font', select(FONTS.map(f => ({ value: f, label: f })), s.cardFont, v => set({ cardFont: v }, false)), 'Used on card faces while studying.'));
      } else {
        body.append(
          row('Animations', h('div', {}, toggle(s.animations, v => set({ animations: v }, false), {})), 'Transitions, card flips and springs.'),
          row('Reduce motion', h('div', {}, toggle(s.reducedMotion, v => set({ reducedMotion: v }, false), {})), 'No large movement, confetti or countdowns.'),
          row('Celebrations', h('div', {}, toggle(s.confetti, v => updateSettings({ confetti: v }), {})), 'Confetti when you finish or hit a goal.'),
          ...(touch ? [] : [row('Keyboard hints', h('div', {}, toggle(s.keyboardHints, v => updateSettings({ keyboardHints: v }), {})), 'Shortcut keys on study buttons.')]));
      }
      inner.append(h('div', { class: 'ap-studio' }, left, h('div', { class: 'ap-panel' }, seg, body)));
    } else if (tab === 'study') {
      inner.append(sec('Daily goals', 'Shown on your home dashboard and used for streaks and achievements.',
        settingRow('Cards per day', numberInput(s.dailyGoalCards, v => updateSettings({ dailyGoalCards: v }), { min: 1, max: 5000 })),
        settingRow('Minutes per day', numberInput(s.dailyGoalMinutes, v => updateSettings({ dailyGoalMinutes: v }), { min: 1, max: 1440 })),
        settingRow('Day starts at', select(Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${String(i).padStart(2, '0')}:00` })), s.dayRollover, v => updateSettings({ dayRollover: parseInt(v, 10) })), 'Late-night sessions count toward the previous day until this hour.'),
        settingRow('Week starts on', segmented([{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }], s.weekStart, v => updateSettings({ weekStart: v })))));
      inner.append(sec('Spaced review (Anki-style)', 'Per-set scheduling lives in each set\'s Options. These are the review screen defaults.',
        settingRow('Answer buttons', segmented([{ value: 4, label: 'Again · Hard · Good · Easy' }, { value: 2, label: 'Again · Good' }], s.review.buttons, v => updateSettings({ review: { buttons: v } })), 'Two-button mode is simpler; four buttons give the scheduler more information.'),
        toggle(s.review.showIntervals, v => updateSettings({ review: { showIntervals: v } }), { label: 'Show next intervals on buttons', description: 'e.g. "Good · 3d".' }),
        toggle(s.review.showRemaining, v => updateSettings({ review: { showRemaining: v } }), { label: 'Show remaining counts', description: 'New · learning · review counts at the top of the screen.' }),
        toggle(s.review.showTimer, v => updateSettings({ review: { showTimer: v } }), { label: 'Show answer timer' }),
        toggle(s.review.flipAnimation, v => updateSettings({ review: { flipAnimation: v } }), { label: 'Flip animation when revealing' })));
      inner.append(sec('Learn, Write & Test defaults', 'You can change these any time from inside each mode.',
        settingRow('Learn: answer with', segmented([{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }], s.learn.answerWith, v => updateSettings({ learn: { answerWith: v } }))),
        settingRow('Learn: question types', h('div', { class: 'row' }, ...[['mc', 'Multiple choice'], ['written', 'Written'], ['tf', 'True / False']].map(([id, l]) => h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: s.learn.questionTypes.includes(id), onChange: e => { const t = new Set(s.learn.questionTypes); e.target.checked ? t.add(id) : t.delete(id); if (!t.size) { t.add('mc'); e.target.checked = true; } updateSettings({ learn: { questionTypes: [...t] } }); } }), l)))),
        settingRow('Learn: round size', numberInput(s.learn.roundSize, v => updateSettings({ learn: { roundSize: v } }), { min: 3, max: 30 }), 'Terms per round before a checkpoint.'),
        toggle(s.learn.typoTolerance, v => updateSettings({ learn: { typoTolerance: v }, write: { typoTolerance: v }, test: { typoTolerance: v } }), { label: 'Typo tolerance', description: 'Accept answers with minor spelling mistakes (you can still override).' }),
        toggle(s.learn.retypeWrong, v => updateSettings({ learn: { retypeWrong: v }, write: { retypeWrong: v } }), { label: 'Retype wrong answers', description: 'After a miss, copy the correct answer before continuing.' }),
        toggle(s.learn.caseSensitive, v => updateSettings({ learn: { caseSensitive: v } }), { label: 'Case sensitive grading' }),
        settingRow('Test: default question count', numberInput(s.test.count, v => updateSettings({ test: { count: v } }), { min: 1, max: 500 }))));
      inner.append(sec('Flashcards', null,
        settingRow('Flip animation', segmented([{ value: 'flip', label: '3D flip' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'Instant' }], s.flashcards.animation, v => updateSettings({ flashcards: { animation: v } }))),
        settingRow('Autoplay speed', numberInput(s.flashcards.autoplaySeconds, v => updateSettings({ flashcards: { autoplaySeconds: v } }), { min: 1, max: 30, suffix: 'sec per side' })),
        settingRow('Card text size', slider(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-font-size')) || 26, v => { document.documentElement.style.setProperty('--card-font-size', v + 'px'); db.setKV('cardFontSize', v); }, { min: 16, max: 48, format: v => `${v}px` }))));
    } else if (tab === 'audio') {
      const voices = getVoices(); const vopts = [{ value: '', label: 'Automatic (best for language)' }, ...voices.map(v => ({ value: v.name, label: `${v.name} (${v.lang})` }))];
      inner.append(sec('Sound effects', null,
        toggle(s.sounds, v => { updateSettings({ sounds: v }); if (v) sfx.correct(); }, { label: 'Sound effects', description: 'Flip, correct/incorrect, game and celebration sounds. Generated on the fly, no files needed.' }),
        settingRow('Volume', slider(Math.round(s.soundVolume * 100), v => { updateSettings({ soundVolume: v / 100 }); }, { min: 0, max: 100, format: v => `${v}%` })),
        h('div', { class: 'row wrap', style: { gap: '6px', paddingTop: '10px' } }, ...[['correct', 'Correct'], ['wrong', 'Wrong'], ['flip', 'Flip'], ['match', 'Match'], ['complete', 'Complete'], ['levelUp', 'Level up']].map(([k, l]) => h('button', { class: 'btn btn-sm', onClick: () => sfx[k]() }, svgIcon('play', 12), l)))));
      inner.append(sec('Text to speech', `Uses the voices installed on this computer (${voices.length} available). Works fully offline.`,
        toggle(s.tts, v => updateSettings({ tts: v }), { label: 'Enable text to speech' }),
        settingRow('Speaking rate', slider(Math.round(s.ttsRate * 100), v => updateSettings({ ttsRate: v / 100 }), { min: 50, max: 200, step: 5, format: v => `${v}%` })),
        settingRow('Voice for terms', select(vopts, s.ttsVoiceFront, v => updateSettings({ ttsVoiceFront: v }))),
        settingRow('Voice for definitions', select(vopts, s.ttsVoiceBack, v => updateSettings({ ttsVoiceBack: v }))),
        toggle(s.ttsAutoplay, v => updateSettings({ ttsAutoplay: v }), { label: 'Auto-read cards', description: 'Speak each card automatically in Flashcards and Review.' }),
        h('div', { class: 'row', style: { paddingTop: '10px' } }, h('button', { class: 'btn', onClick: () => speak('Hello! This is how I sound.', { voiceName: s.ttsVoiceFront, lang: 'en' }) }, svgIcon('volume', 16), 'Test voice'), h('button', { class: 'btn btn-ghost', onClick: () => speak('Hola, ¿cómo estás?', { lang: 'es' }) }, 'Test Spanish'), h('button', { class: 'btn btn-ghost', onClick: () => speak('Bonjour, comment ça va ?', { lang: 'fr' }) }, 'Test French'), voices.length ? null : h('span', { class: 'small muted' }, 'If no voices appear, install voices in Windows Settings → Time & Language → Speech.'))));
    } else if (tab === 'startup') {
      inner.append(sec('Startup', null,
        toggle(s.showIntro, v => updateSettings({ showIntro: v }), { label: 'Play intro animation on launch', description: 'The 3D flashcard galaxy. Press Esc any time to skip.' }),
        settingRow('Replay', h('button', { class: 'btn', onClick: () => playIntro({ accentHue: s.accentHue }) }, svgIcon('sparkles', 16), 'Play intro now')),
        settingRow('Start page', segmented([{ value: 'home', label: 'Home' }, { value: 'library', label: 'Library' }], s.startPage, v => updateSettings({ startPage: v })))));
      inner.append(sec('Window', null,
        settingRow('Fullscreen', h('button', { class: 'btn', onClick: () => native ? native.fullscreen() : document.documentElement.requestFullscreen() }, svgIcon('maximize', 16), 'Toggle fullscreen (F11)')),
        toggle(s.zenMode, v => { updateSettings({ zenMode: v }); applyTheme(); }, { label: 'Zen mode', description: 'Hide the sidebar for a distraction-free workspace (Ctrl+Shift+Z).' }),
        toggle(s.sidebarCollapsed, v => { updateSettings({ sidebarCollapsed: v }); applyTheme(); renderSidebar(); }, { label: 'Compact sidebar', description: 'Icons only.' }),
        settingRow('Zoom', h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onClick: () => native && native.zoom(-0.1) }, '−'), h('button', { class: 'btn btn-sm', onClick: () => native && native.zoom(0) }, 'Reset'), h('button', { class: 'btn btn-sm', onClick: () => native && native.zoom(0.1) }, '+')), `${modKey}+= / ${modKey}+- / ${modKey}+0`),
        settingRow('Keyboard shortcuts', h('button', { class: 'btn', onClick: showShortcuts }, svgIcon('keyboard', 16), 'View all shortcuts'))));
    } else if (tab === 'data') {
      const info = h('div', { class: 'small muted' }); if (native) native.info().then(i => { info.textContent = `Data folder: ${i.userData}`; });
      const backupsList = h('div', { class: 'col', style: { gap: '6px' } }); if (native) native.backupList().then(list => { backupsList.innerHTML = ''; if (!list.length) backupsList.append(h('span', { class: 'small muted' }, 'No automatic backups yet (first one is created shortly after launch).')); list.slice(0, 10).forEach(b => backupsList.append(h('div', { class: 'row between small backup-row' }, h('span', {}, `${fmtDate(b.time, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${(b.size / 1024).toFixed(0)} KB`), h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onClick: () => restoreBackupFlow(b.path) }, 'Restore'), h('button', { class: 'btn btn-sm btn-ghost', onClick: () => native.showItem(b.path) }, 'Show'))))); }); else backupsList.append(h('span', { class: 'small muted' }, 'Automatic backups are available in the desktop app.'));
      inner.append(sec('Backup & restore', 'Everything is stored locally on this computer. Back up regularly to keep it safe.',
        h('div', { class: 'row wrap', style: { gap: '8px', padding: '6px 0 14px' } }, h('button', { class: 'btn btn-primary', onClick: () => createBackup(true) }, svgIcon('save', 16), 'Back up now'), h('button', { class: 'btn', onClick: () => exportAllJson() }, svgIcon('download', 16), 'Export everything (JSON)'), h('button', { class: 'btn', onClick: () => showImportDialog({ restore: true }) }, svgIcon('upload', 16), 'Restore from file')),
        h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Automatic backups (kept: newest 30)'), backupsList, info));
      inner.append(sec('Storage', null, h('div', { class: 'kv' }, kv('Sets', db.decks.size), kv('Notes', db.notes.size), kv('Cards', db.cards.size), kv('Review log entries', db.revlog.size), kv('Media items', db.media.size), kv('Media size', `${(db.media.all().reduce((a, m) => a + (m.size || 0), 0) / 1024 / 1024).toFixed(1)} MB`), kv('Sessions', db.sessions.size)),
        h('div', { class: 'row wrap', style: { gap: '8px', paddingTop: '12px' } }, h('button', { class: 'btn', onClick: async () => { const { gcMedia } = await import('../models.js'); const before = db.media.size; gcMedia(); toast(`Removed ${before - db.media.size} unused media items`); draw(); } }, 'Clean unused media'), h('button', { class: 'btn', onClick: () => showExportDialog(null) }, 'Export sets…'))));
      inner.append(sec('Danger zone', 'These cannot be undone. Make a backup first.',
        settingRow('Reset all settings', h('button', { class: 'btn btn-danger', onClick: async () => { if (await confirm('Reset every setting to defaults? Your sets and progress are kept.', { danger: true, okLabel: 'Reset' })) { const d = DEFAULT_SETTINGS(); d.onboarded = true; d.xp = s.xp; d.achievementsUnlocked = s.achievementsUnlocked; db.setKV('settings', d); location.reload(); } } }, 'Reset settings')),
        settingRow('Reset all progress', h('button', { class: 'btn btn-danger', onClick: async () => { if (await confirm('Erase all review history, scheduling and mastery for every card? Sets and terms are kept.', { danger: true, okLabel: 'Erase progress' })) { const { forgetCards } = await import('../scheduler.js'); const cards = db.cards.all(); cards.forEach(c => { c.mastery = { level: 0, correct: 0, wrong: 0, streak: 0, lastSeen: 0 }; }); forgetCards(cards); db.revlog.clear(); db.sessions.clear(); toast('Progress erased'); } } }, 'Erase progress')),
        settingRow('Delete everything', h('button', { class: 'btn btn-danger', onClick: async () => { if (await confirm('Delete ALL sets, cards, history and settings? This cannot be undone.', { danger: true, okLabel: 'Delete everything' })) { if (await confirm('Really delete everything? Last chance.', { danger: true, okLabel: 'Yes, delete it all' })) { await db.wipe(); location.reload(); } } } }, 'Delete all data'))));
    } else if (tab === 'sync') {
      renderSyncSettings(inner, sec, draw);
    } else {
      const about = h('div', { class: 'kv' }); if (native) native.info().then(i => { about.append(kv('Version', i.version), kv('Electron', i.electron), kv('Chromium', i.chrome), kv('Platform', i.platform)); }); else about.append(kv('Version', '1.0.0 (web preview)'));
      { // Display diagnostics: helps track down iOS/iPadOS screen-size bugs
        const probe = h('div', { style: { position: 'fixed', top: 0, left: 0, width: 0, height: 0, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', visibility: 'hidden', pointerEvents: 'none' } }); document.body.append(probe);
        const cs = getComputedStyle(probe); const rs = getComputedStyle(document.documentElement);
        const vv = window.visualViewport; const box = h('pre', { class: 'diag selectable' });
        const lines = [
          'innerHeight × innerWidth: ' + innerHeight + ' × ' + innerWidth,
          'visualViewport: ' + (vv ? Math.round(vv.height) + ' × ' + Math.round(vv.width) : 'n/a'),
          'screen: ' + screen.width + ' × ' + screen.height,
          'clientHeight: ' + document.documentElement.clientHeight,
          'safe areas (t r b l): ' + [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
          '--app-h: ' + (rs.getPropertyValue('--app-h').trim() || 'unset') + '   --vp-gap: ' + (rs.getPropertyValue('--vp-gap').trim() || 'unset'),
          'standalone: ' + (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) + '   touch layout: ' + document.body.classList.contains('tabbar-mode') + '   fix active: ' + document.documentElement.classList.contains('vp-fix'),
          'device: ' + navigator.platform + ' · ' + navigator.maxTouchPoints + ' touch points',
        ];
        box.textContent = lines.join('\n'); probe.remove();
        fetch('sw.js', { cache: 'no-store' }).then(r => r.text()).then(t => { const m = t.match(/VERSION = '([^']+)'/); box.textContent += '\nbuild: ' + (m ? m[1] : '?'); }).catch(() => {});
        inner.append(sec('Display diagnostics', 'If something looks wrong on screen, a screenshot of this helps fix it.', box));
      }
      inner.append(sec('About Recall', 'A complete study studio that works offline. Quizlet-style modes and games, Anki-style spaced repetition, and optional cloud sync. No tracking.',
        h('div', { class: 'about-hero' }, h('div', { class: 'intro-logo', style: { animation: 'none', opacity: 1, width: '56px', height: '56px', borderRadius: '16px' } }), h('div', {}, h('h3', { style: { fontSize: '1.4rem' } }, 'Recall'), h('p', { class: 'muted' }, 'Remember everything.'))), about,
        h('div', { class: 'label', style: { margin: '14px 0 6px' } }, 'Built with'), h('p', { class: 'small muted' }, 'Electron · Three.js (intro) · sql.js (Anki package import) · JSZip. Scheduling implements SM-2 with Anki-style learning steps and FSRS-4.5.'),
        h('div', { class: 'label', style: { margin: '14px 0 6px' } }, 'Privacy'), h('p', { class: 'small muted' }, 'Your data is stored in a local database on this device and in the backups you create. If you turn on cloud sync, it is also stored in your own Supabase account; otherwise Recall never connects to the internet.')));
    }
  };
  draw();
  function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'muted' }, k), h('span', { class: 'selectable' }, String(v))); }
  async function customThemeDialog() {
    const s = S(); const vars = { '--bg': '#0e1018', '--surface': '#171a27', '--surface-2': '#1d2131', '--surface-3': '#262a3c', '--text': '#eef0fa', '--text-muted': '#8a90aa', '--accent': '#6366f1' }; let base = 'dark'; const name = h('input', { class: 'input', placeholder: 'Theme name', value: 'My theme' });
    const rows = Object.keys(vars).map(k => settingRow(k.replace('--', '').replace(/-/g, ' '), h('input', { type: 'color', value: vars[k], onInput: e => { vars[k] = e.target.value; } })));
    modal({ title: 'Custom theme', size: 'sm', content: h('div', { class: 'col' }, name, settingRow('Based on', segmented([{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], base, v => { base = v; })), ...rows, h('p', { class: 'small muted' }, 'Accent is applied as a flat colour; other theme tokens derive from the base.')), actions: [{ label: 'Cancel' }, { label: 'Create', variant: 'primary', onClick: () => { const id = 'custom_' + Date.now().toString(36); const v = { ...vars }; const [hh] = hexToHsl(v['--accent']); delete v['--accent']; v['--accent-h'] = hh; v['--accent-s'] = '80%'; v['--accent-l'] = '60%'; v['--bg-2'] = v['--bg']; v['--card-face'] = v['--surface']; v['--card-face-2'] = v['--surface-2']; v['--titlebar'] = v['--bg']; v['--sidebar'] = v['--bg']; v['--surface-glass'] = v['--surface']; v['--text-2'] = v['--text']; updateSettings({ customThemes: [...(s.customThemes || []), { id, name: name.value || 'Custom', base, vars: v }], theme: id }); applyTheme(); draw(); return true; } }] });
  }
}
