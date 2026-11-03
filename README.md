# Recall

A complete, fully offline flashcards studio for Windows that combines Quizlet-style study modes and games with Anki-style spaced repetition.

## Run the app

Double-click `dist/Recall.exe`. It is a single portable executable: no installer, no account, no internet. Your data is stored in `%APPDATA%\Recall` (automatic backups are kept in `%APPDATA%\Recall\backups`).

## Features

**Study modes**: Flashcards (3D flip, autoplay, shuffle, swipe, know/still-learning sorting), Learn (adaptive rounds: multiple choice → written → mastered), Test (written, matching, multiple choice, true/false, instant or final grading), Write, Spell (offline text-to-speech), and Spaced Review (Anki-style Again/Hard/Good/Easy with SM-2 or FSRS-4.5, learning steps, daily limits, bury/suspend/flag, undo, type-in answers, custom study).

**Games**: Match, Gravity, Memory, Blast. Each keeps per-set personal bests.

**Content**: rich-text term editor with images, cloze deletions, tags, drag-to-reorder, paste-to-import. Note types: Basic, Basic (reversed), Basic (type answer), Cloze, Image + caption, plus custom types imported from Anki.

**Import / Export**: Quizlet text exports, CSV/TSV, pasted text, Anki `.apkg` (with scheduling, review history and images), Recall JSON. Export to text/CSV, JSON, Anki `.apkg`, and printable PDF.

**Insight**: card browser with Anki search syntax (`deck:`, `tag:`, `is:due`, `prop:ivl>21`, `flag:1`, …), statistics (reviews, forecast, intervals, ease, heatmap, retention, session history), achievements, XP and levels, streaks and daily goals.

**Customisation**: 12 themes plus custom themes, any accent colour, corner radius, density, fonts, animations, sounds, text-to-speech voices, keyboard shortcuts (`?` to view), zen mode, fullscreen (F11), command palette (Ctrl+K).

## Development

```bash
npm install
npm start          # run with Electron
npm run serve      # browser preview at http://localhost:4777
npm run dist       # build dist/Recall.exe (portable)
```

Source lives in `src/` (vanilla ES modules, no build step) and `electron/` (main process + preload).
