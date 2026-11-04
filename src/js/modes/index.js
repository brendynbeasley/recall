// Study mode router
import { db } from '../db.js';
import { h, svgIcon } from '../utils.js';
import { confirm } from '../ui.js';
import { navigate } from '../app.js';
import * as Flashcards from './flashcards.js';
import * as Learn from './learn.js';
import * as Test from './test.js';
import * as Write from './write.js';
import * as Spell from './spell.js';
import * as Review from './review.js';
import * as Match from '../games/match.js';
import * as Gravity from '../games/gravity.js';
import * as Memory from '../games/memory.js';
import * as Blast from '../games/blast.js';
import * as Unscramble from '../games/unscramble.js';
import * as Reveal from '../games/reveal.js';
import * as Survival from '../games/survival.js';
import * as Confidence from '../games/confidence.js';
import { stopSpeaking } from '../audio.js';

const MODS = { flashcards: Flashcards, learn: Learn, test: Test, write: Write, spell: Spell, review: Review, match: Match, gravity: Gravity, memory: Memory, blast: Blast, unscramble: Unscramble, reveal: Reveal, survival: Survival, confidence: Confidence };
let current = null;
export async function render(main, route) {
  const mode = route.parts[0]; const deckId = route.parts[1];
  const mod = MODS[mode]; if (!mod) { navigate('home', { replace: true }); return; }
  let deck = null;
  if (deckId !== 'all' && deckId !== 'custom') { deck = db.decks.get(deckId); if (!deck) { navigate('library', { replace: true }); return; } }
  if (mode !== 'review' && !deck) { navigate('library', { replace: true }); return; }
  main.innerHTML = '';
  const ctx = { main, deck, deckId, route, inProgress: () => false };
  const cleanup = await mod.start(ctx);
  current = { ctx, cleanup, mode };
  return () => { stopSpeaking(); if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } } current = null; };
}
export async function requestExit() {
  if (!current) return;
  const busy = current.ctx.inProgress && current.ctx.inProgress();
  if (busy && !(await confirm('Leave this session? Your progress so far is saved, but the session will end.', { title: 'Exit study', okLabel: 'Leave', cancelLabel: 'Keep studying' }))) return;
  const d = current.ctx.deck; navigate(d ? `set/${d.id}` : 'home');
}
export function forceExit() { /* cleanup handled by router */ }
