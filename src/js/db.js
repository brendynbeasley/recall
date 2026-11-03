// Persistence layer: everything lives in memory, mirrored to IndexedDB with batched writes.
// Collections: decks, folders, notetypes, notes, cards, revlog, media, presets, sessions, kv
import { Emitter } from './utils.js';

const DB_NAME = 'recall-db';
const DB_VERSION = 1;
const PENDING_KEY = 'recall-sync-pending';
export const COLLECTIONS = ['decks', 'folders', 'notetypes', 'notes', 'cards', 'revlog', 'media', 'presets', 'sessions', 'kv'];

class Collection {
  constructor(db, name) { this.db = db; this.name = name; this.map = new Map(); this.dirty = new Set(); this.deleted = new Set(); }
  get(id) { return this.map.get(id); }
  has(id) { return this.map.has(id); }
  all() { return Array.from(this.map.values()); }
  get size() { return this.map.size; }
  filter(fn) { const out = []; for (const v of this.map.values()) if (fn(v)) out.push(v); return out; }
  find(fn) { for (const v of this.map.values()) if (fn(v)) return v; return undefined; }
  put(obj) { this.db.track(this.name, obj.id, obj); this.map.set(obj.id, obj); this.dirty.add(obj.id); this.deleted.delete(obj.id); this.db.schedule(); this.db.events.emit('change', this.name, obj.id); return obj; }
  putMany(objs) { for (const o of objs) { this.db.track(this.name, o.id, o); this.map.set(o.id, o); this.dirty.add(o.id); this.deleted.delete(o.id); } this.db.schedule(); this.db.events.emit('change', this.name, null); }
  remove(id) { if (!this.map.has(id)) return; this.db.track(this.name, id, null); this.map.delete(id); this.dirty.delete(id); this.deleted.add(id); this.db.schedule(); this.db.events.emit('change', this.name, id); }
  removeMany(ids) { for (const id of ids) { if (this.map.has(id)) this.db.track(this.name, id, null); if (this.map.delete(id)) { this.dirty.delete(id); this.deleted.add(id); } } this.db.schedule(); this.db.events.emit('change', this.name, null); }
  clear() { for (const id of this.map.keys()) { this.db.track(this.name, id, null); this.deleted.add(id); } this.map.clear(); this.dirty.clear(); this.db.schedule(); }
}

export class Database {
  constructor() { this.events = new Emitter(); this.idb = null; this.cols = {}; for (const c of COLLECTIONS) this.cols[c] = new Collection(this, c); this.flushTimer = null; this.flushing = null; this.loaded = false; this.suspendEvents = false;
    // Sync bookkeeping: records changed since the last upload (only while sync is on), keyed "collection\u0001id"
    this.trackChanges = false; this.applyingRemote = false; this.pending = new Map(); this.pendingChanged = false;
    try { for (const p of JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')) this.pending.set(p.c + '\u0001' + p.id, p); } catch (e) { /* */ }
  }
  // Every local write stamps _mts (last-modified ms) so devices can resolve conflicts by recency
  track(c, id, obj) {
    if (this.applyingRemote) return; const ts = Date.now(); if (obj) obj._mts = ts;
    if (this.trackChanges) { this.pending.set(c + '\u0001' + id, { c, id, del: !obj, ts }); this.pendingChanged = true; }
  }
  savePending() { if (!this.pendingChanged) return; this.pendingChanged = false; try { localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(this.pending.values()))); } catch (e) { console.warn('could not save sync queue', e); } }
  // Apply rows downloaded from the cloud without re-queueing them for upload
  applyRemote(fn) { this.applyingRemote = true; try { fn(); } finally { this.applyingRemote = false; } }
  col(name) { return this.cols[name]; }
  get decks() { return this.cols.decks; } get folders() { return this.cols.folders; } get notetypes() { return this.cols.notetypes; }
  get notes() { return this.cols.notes; } get cards() { return this.cols.cards; } get revlog() { return this.cols.revlog; }
  get media() { return this.cols.media; } get presets() { return this.cols.presets; } get sessions() { return this.cols.sessions; } get kv() { return this.cols.kv; }

  async open() {
    this.idb = await new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { const d = req.result; for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('Database blocked'));
    });
    const tx = this.idb.transaction(COLLECTIONS, 'readonly');
    await Promise.all(COLLECTIONS.map(c => new Promise((res, rej) => {
      const r = tx.objectStore(c).getAll();
      r.onsuccess = () => { for (const o of r.result) this.cols[c].map.set(o.id, o); res(); };
      r.onerror = () => rej(r.error);
    })));
    this.loaded = true;
    window.addEventListener('beforeunload', () => { this.flushSync(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    return this;
  }
  schedule() { if (this.flushTimer) return; this.flushTimer = setTimeout(() => this.flush(), 400); }
  async flush() {
    clearTimeout(this.flushTimer); this.flushTimer = null;
    if (!this.idb) return;
    if (this.flushing) await this.flushing;
    const work = [];
    for (const c of COLLECTIONS) { const col = this.cols[c]; if (col.dirty.size || col.deleted.size) { work.push({ c, puts: Array.from(col.dirty).map(id => col.map.get(id)).filter(Boolean), dels: Array.from(col.deleted) }); col.dirty.clear(); col.deleted.clear(); } }
    if (!work.length) { this.savePending(); return; }
    this.flushing = new Promise((res, rej) => {
      const tx = this.idb.transaction(work.map(w => w.c), 'readwrite');
      for (const w of work) { const st = tx.objectStore(w.c); for (const o of w.puts) st.put(o); for (const id of w.dels) st.delete(id); }
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
    try { await this.flushing; } catch (e) { console.error('flush failed', e); } finally { this.flushing = null; }
    this.savePending();
    this.events.emit('flushed');
  }
  flushSync() { // best effort on unload
    try { this.flush(); } catch (e) { /* ignore */ }
  }
  // Key/value convenience
  getKV(key, def) { const o = this.kv.get(key); return o ? o.value : def; }
  setKV(key, value) { this.kv.put({ id: key, value }); }

  // Snapshot of everything (for backups)
  snapshot(includeMedia = true) {
    const out = { app: 'recall', version: 1, exported: Date.now(), data: {} };
    for (const c of COLLECTIONS) { if (c === 'media' && !includeMedia) continue; out.data[c] = this.cols[c].all(); }
    return out;
  }
  async restore(snapshot, { merge = false } = {}) {
    if (!snapshot || !snapshot.data) throw new Error('Invalid backup file');
    this.suspendEvents = true;
    if (!merge) for (const c of COLLECTIONS) this.cols[c].clear();
    for (const c of COLLECTIONS) { const arr = snapshot.data[c]; if (Array.isArray(arr)) this.cols[c].putMany(arr); }
    this.suspendEvents = false;
    await this.flush();
    this.events.emit('restored');
  }
  async wipe() { for (const c of COLLECTIONS) this.cols[c].clear(); await this.flush(); this.events.emit('restored'); }
}

export const db = new Database();
