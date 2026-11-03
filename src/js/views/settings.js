// Settings: appearance, study defaults, audio, startup, data, shortcuts, about
import { db } from '../db.js';
import { S, updateSettings, DEFAULT_SETTINGS, saveSettings } from '../models.js';
import { h, svgIcon, fmtDate, modKey, hexToHsl } from '../utils.js';
import { pageHeader, toggle, settingRow, select, numberInput, slider, segmented, toast, confirm, modal, tabs, prompt } from '../ui.js';
import { applyTheme, THEMES, ACCENTS, native, showShortcuts, renderSidebar } from '../app.js';
import { getVoices, speak, sfx } from '../audio.js';
import { playIntro } from '../intro.js';
import { createBackup, exportAllJson, showExportDialog } from '../exporters.js';
import { showImportDialog, restoreBackupFlow } from '../importers.js';
import { renderSyncSettings } from './syncsettings.js';

const FONTS = ['System', 'Segoe UI', 'Inter', 'Georgia', 'Cambria', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Calibri', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond', 'Arial Rounded MT Bold'];

// Mini app mock rendered with a theme's own tokens (data-theme scopes the CSS variables to this element)
function themeSwatch(id, vars) { return h('div', { class: 'theme-swatch', 'data-theme': id, style: vars || {} }, h('div', { class: 'ts-bar' }), h('div', { class: 'ts-body' }, h('div', { class: 'ts-side' }, h('div', { class: 'ts-nav on' }), h('div', { class: 'ts-nav' }), h('div', { class: 'ts-nav' })), h('div', { class: 'ts-main' }, h('div', { class: 'ts-accent' }), h('div', { class: 'ts-line' }), h('div', { class: 'ts-line short' }), h('div', { class: 'ts-dots' }, h('i', { style: { background: 'var(--ok)' } }), h('i', { style: { background: 'var(--warn)' } }), h('i', { style: { background: 'var(--bad)' } }), h('i', { style: { background: 'var(--accent-2)' } }))))); }
export function render(main, route) {
  let tab = route.query.tab || 'appearance';
  const inner = h('div', { class: 'main-inner narrow' }); main.append(inner);
  const draw = () => {
    inner.innerHTML = ''; const s = S();
    inner.append(pageHeader('Settings', 'Make Recall yours. Every option is saved instantly.'));
    inner.append(tabs([{ id: 'appearance', label: 'Appearance', icon: 'palette' }, { id: 'study', label: 'Study', icon: 'brain' }, { id: 'audio', label: 'Audio & speech', icon: 'volume' }, { id: 'startup', label: 'Startup & window', icon: 'layout' }, { id: 'data', label: 'Data & backups', icon: 'database' }, { id: 'sync', label: 'Sync', icon: 'cloud' }, { id: 'about', label: 'About', icon: 'info' }], tab, t => { tab = t; history.replaceState(null, '', `#/settings?tab=${t}`); draw(); }));
    const sec = (title, desc, ...kids) => h('div', { class: 'settings-section panel' }, h('h2', {}, title), desc ? h('p', {}, desc) : null, ...kids);
    const re = () => { saveSettings(); applyTheme(); };
    if (tab === 'appearance') {
      const themeGrid = h('div', { class: 'theme-grid' }, ...THEMES.map(t => h('button', { class: `theme-card ${s.theme === t.id ? 'active' : ''}`, onClick: () => { updateSettings({ theme: t.id }); applyTheme(); draw(); } }, t.id === 'system' ? h('div', { class: 'theme-swatch split' }, themeSwatch('light'), themeSwatch('dark')) : themeSwatch(t.id), h('div', { class: 'theme-name' }, t.name, s.theme === t.id ? svgIcon('check', 14) : null))),
        ...(s.customThemes || []).map(t => h('button', { class: `theme-card ${s.theme === t.id ? 'active' : ''}`, onClick: () => { updateSettings({ theme: t.id }); applyTheme(); draw(); }, onContextmenu: async e => { e.preventDefault(); if (await confirm(`Delete custom theme "${t.name}"?`, { danger: true })) { updateSettings({ customThemes: s.customThemes.filter(x => x.id !== t.id), theme: s.theme === t.id ? 'dark' : s.theme }); applyTheme(); draw(); } } }, themeSwatch(t.base, t.vars), h('div', { class: 'theme-name' }, t.name))),
        h('button', { class: 'theme-card add', onClick: customThemeDialog }, h('div', { class: 'theme-swatch', style: { display: 'grid', placeItems: 'center' } }, svgIcon('plus', 22)), h('div', { class: 'theme-name' }, 'Custom theme')));
      const accentRow = h('div', { class: 'accent-row' }, ...ACCENTS.map(a => h('button', { class: `accent-dot ${s.accentPreset === a.id ? 'active' : ''}`, style: { background: a.hex }, 'data-tip': a.id, onClick: () => { updateSettings({ accentPreset: a.id, accentHue: a.hue }); applyTheme(); draw(); } })), h('label', { class: 'accent-dot custom', 'data-tip': 'Pick any colour' }, svgIcon('palette', 14), h('input', { type: 'color', value: '#6366f1', onInput: e => { const [hue] = hexToHsl(e.target.value); updateSettings({ accentPreset: 'custom', accentHue: hue }); applyTheme(); } })));
      inner.append(sec('Theme', 'Choose a palette. Themed presets carry their own accent unless you override it.', themeGrid, h('div', { style: { marginTop: '18px' } }, h('div', { class: 'label' }, 'Accent colour'), accentRow, settingRow('Hue', slider(s.accentHue, v => { updateSettings({ accentHue: v, accentPreset: 'custom' }); applyTheme(); }, { min: 0, max: 360, step: 1, format: v => `${v}°` })), toggle(!!s.accentOverride, v => { updateSettings({ accentOverride: v }); applyTheme(); }, { label: 'Force accent on themed presets', description: 'Apply your accent colour even to Nord, Dracula, Rosé Pine, etc.' }))));
      inner.append(sec('Interface', null,
        settingRow('Corner roundness', slider(s.radius, v => { updateSettings({ radius: v }); applyTheme(); }, { min: 0, max: 28, format: v => `${v}px` })),
        settingRow('Density', segmented([{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }], s.density, v => { updateSettings({ density: v }); applyTheme(); })),
        settingRow('Text size', slider(Math.round(s.fontScale * 100), v => { updateSettings({ fontScale: v / 100 }); applyTheme(); }, { min: 80, max: 130, step: 5, format: v => `${v}%` })),
        settingRow('Interface font', select(FONTS.map(f => ({ value: f, label: f })), s.uiFont, v => { updateSettings({ uiFont: v }); applyTheme(); })),
        settingRow('Flashcard font', select(FONTS.map(f => ({ value: f, label: f })), s.cardFont, v => { updateSettings({ cardFont: v }); applyTheme(); }), 'Used on the faces of cards in study modes.'),
        toggle(s.glass, v => { updateSettings({ glass: v }); applyTheme(); }, { label: 'Frosted glass surfaces', description: 'Blur behind the sidebar and title bar. Turn off on slower machines.' }),
        toggle(s.backgroundFx, v => { updateSettings({ backgroundFx: v }); applyTheme(); }, { label: 'Ambient background', description: 'Soft animated colour orbs behind the interface.' }),
        toggle(s.animations, v => { updateSettings({ animations: v }); applyTheme(); }, { label: 'Animations', description: 'Page transitions, card flips, button springs.' }),
        toggle(s.reducedMotion, v => { updateSettings({ reducedMotion: v }); applyTheme(); }, { label: 'Reduce motion', description: 'Disables confetti, countdowns and large motion effects.' }),
        toggle(s.confetti, v => updateSettings({ confetti: v }), { label: 'Celebrations', description: 'Confetti when you finish a session or hit a goal.' }),
        toggle(s.keyboardHints, v => updateSettings({ keyboardHints: v }), { label: 'Keyboard hints', description: 'Show shortcut keys on buttons in study modes.' })));
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
