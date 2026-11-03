// Audio: procedurally generated sound effects (no asset files) + offline text-to-speech.
import { S } from './models.js';

let ctx = null;
function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, decay, slide = 0, delay = 0 }) {
  const c = ac(); if (!c) return; const t0 = c.currentTime + delay;
  const o = c.createOscillator(); const g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  const v = vol * (S()?.soundVolume ?? 0.6);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + (decay || dur) + 0.05);
}
function noise({ dur = 0.2, vol = 0.2, delay = 0, hp = 1000 }) {
  const c = ac(); if (!c) return; const t0 = c.currentTime + delay; const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; const g = c.createGain(); g.gain.value = vol * (S()?.soundVolume ?? 0.6);
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0);
}
const enabled = () => S()?.sounds !== false;
export const sfx = {
  flip() { if (!enabled()) return; noise({ dur: 0.08, vol: 0.12, hp: 2500 }); tone({ freq: 900, type: 'triangle', dur: 0.06, vol: 0.05, slide: -300 }); },
  click() { if (!enabled()) return; tone({ freq: 1200, type: 'square', dur: 0.03, vol: 0.04 }); },
  correct() { if (!enabled()) return; tone({ freq: 660, type: 'sine', dur: 0.12, vol: 0.2 }); tone({ freq: 880, type: 'sine', dur: 0.18, vol: 0.2, delay: 0.09 }); },
  wrong() { if (!enabled()) return; tone({ freq: 220, type: 'sawtooth', dur: 0.2, vol: 0.12, slide: -60 }); tone({ freq: 180, type: 'sawtooth', dur: 0.25, vol: 0.1, delay: 0.12, slide: -40 }); },
  close() { if (!enabled()) return; tone({ freq: 520, type: 'triangle', dur: 0.12, vol: 0.12 }); tone({ freq: 620, type: 'triangle', dur: 0.14, vol: 0.1, delay: 0.1 }); },
  match() { if (!enabled()) return; tone({ freq: 523, dur: 0.08, vol: 0.18 }); tone({ freq: 784, dur: 0.1, vol: 0.18, delay: 0.07 }); tone({ freq: 1046, dur: 0.16, vol: 0.16, delay: 0.14 }); },
  mismatch() { if (!enabled()) return; tone({ freq: 300, type: 'triangle', dur: 0.12, vol: 0.12 }); tone({ freq: 240, type: 'triangle', dur: 0.16, vol: 0.12, delay: 0.1 }); },
  complete() { if (!enabled()) return; [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.25, vol: 0.18, delay: i * 0.1 })); tone({ freq: 1318, dur: 0.6, vol: 0.14, delay: 0.42 }); },
  levelUp() { if (!enabled()) return; [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.16, delay: i * 0.07 })); },
  tick() { if (!enabled()) return; tone({ freq: 1500, type: 'square', dur: 0.02, vol: 0.03 }); },
  swoosh() { if (!enabled()) return; noise({ dur: 0.25, vol: 0.08, hp: 600 }); },
  explode() { if (!enabled()) return; noise({ dur: 0.4, vol: 0.25, hp: 100 }); tone({ freq: 90, type: 'sine', dur: 0.4, vol: 0.3, slide: -60 }); },
  laser() { if (!enabled()) return; tone({ freq: 1400, type: 'square', dur: 0.12, vol: 0.08, slide: -1000 }); },
  pop() { if (!enabled()) return; tone({ freq: 500, type: 'sine', dur: 0.06, vol: 0.15, slide: 400 }); },
  whoosh() { if (!enabled()) return; noise({ dur: 0.5, vol: 0.12, hp: 300 }); },
  star() { if (!enabled()) return; tone({ freq: 1760, type: 'sine', dur: 0.1, vol: 0.1 }); tone({ freq: 2217, type: 'sine', dur: 0.2, vol: 0.08, delay: 0.06 }); },
  warn() { if (!enabled()) return; tone({ freq: 440, type: 'square', dur: 0.08, vol: 0.06 }); tone({ freq: 440, type: 'square', dur: 0.08, vol: 0.06, delay: 0.12 }); },
  intro() { if (!enabled()) return; [261, 329, 392, 523].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1.2, vol: 0.08, delay: i * 0.18, attack: 0.3 })); tone({ freq: 1046, type: 'sine', dur: 2, vol: 0.05, delay: 0.9, attack: 0.6 }); },
  unlock() { if (!enabled()) return; [659, 880, 1174, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.14, delay: i * 0.09 })); },
};
export function unlockAudio() { ac(); }

// ---------- Text to speech ----------
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) { voices = []; } }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
export function getVoices() { if (!voices.length) loadVoices(); return voices; }
const LANG_HINTS = { es: /[ñ¿¡]|\b(el|la|los|las|es|una?|por|que|gracias|hola)\b/i, fr: /[çœ]|\b(le|la|les|une?|est|et|bonjour|merci)\b/i, de: /[äöüß]|\b(der|die|das|und|ist|nicht|ich)\b/i, it: /\b(il|lo|gli|una?|che|è|ciao|grazie)\b/i, pt: /[ãõ]|\b(o|a|os|as|uma?|não|obrigad[oa])\b/i, ja: /[぀-ヿ一-龯]/, zh: /[一-鿿]/, ko: /[가-힯]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/, hi: /[ऀ-ॿ]/, el: /[Ͱ-Ͽ]/, he: /[֐-׿]/ };
export function detectLang(text) { for (const [l, re] of Object.entries(LANG_HINTS)) if (re.test(text)) return l; return 'en'; }
export function speak(text, { lang = 'auto', voiceName = '', rate, interrupt = true } = {}) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  const s = S(); if (s && s.tts === false) return Promise.resolve();
  const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\[sound:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim(); if (!clean) return Promise.resolve();
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const l = lang === 'auto' || !lang ? detectLang(clean) : lang;
  u.lang = l; u.rate = rate ?? (s?.ttsRate ?? 1); u.volume = s?.soundVolume ?? 0.8;
  const vs = getVoices();
  let v = voiceName ? vs.find(x => x.name === voiceName) : null;
  if (!v) v = vs.find(x => x.lang.toLowerCase().startsWith(l) && /natural|neural|online/i.test(x.name)) || vs.find(x => x.lang.toLowerCase().startsWith(l)) || null;
  if (v) u.voice = v;
  return new Promise(res => { u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
}
export function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
