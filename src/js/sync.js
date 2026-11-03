// Cloud sync through Supabase: email/password accounts, one `records` row per local record,
// last-write-wins per record using the _mts stamp db.js puts on every write. See supabase/schema.sql.
import { db, COLLECTIONS } from './db.js';
import { Emitter } from './utils.js';

const LS = { session: 'recall-sync-session', config: 'recall-sync-config', cursor: 'recall-sync-cursor', linked: 'recall-sync-linked', last: 'recall-sync-last' };
const PAGE = 1000, BATCH = 250, BATCH_BYTES = 1500000, OVERLAP_MS = 15000;
const key = (c, id) => c + '\u0001' + id;
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } },
};

// state: 'off' (no account) | 'unlinked' (signed in, device not set up yet) | 'syncing' | 'ok' | 'offline' | 'error'
export const sync = { events: new Emitter(), state: 'off', error: null, lastSync: ls.get(LS.last, 0) };
function setState(state, error = null) { sync.state = state; sync.error = error; sync.events.emit('state', sync); }

// ---------- Config & session ----------
export function getConfig() {
  const baked = window.RECALL_CONFIG || {}; const saved = ls.get(LS.config, {}) || {};
  return { url: String(saved.url || baked.supabaseUrl || '').trim().replace(/\/+$/, ''), key: String(saved.key || baked.supabaseAnonKey || '').trim(), baked: !!(baked.supabaseUrl && baked.supabaseAnonKey) };
}
export function setConfig(url, anonKey) { ls.set(LS.config, url || anonKey ? { url: url.trim(), key: anonKey.trim() } : null); }
export const session = () => ls.get(LS.session, null);
export const isLinked = () => { const s = session(), l = ls.get(LS.linked, null); return !!(s && l && l.userId === s.user.id); };

async function authCall(path, body, bearer) {
  const { url, key: anon } = getConfig(); if (!url || !anon) throw new Error('Add your Supabase project URL and anon key first.');
  const res = await fetch(`${url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body || {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error_description || j.msg || j.message || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return j;
}
function saveSession(j) { const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user.id, email: j.user.email } }; ls.set(LS.session, s); return s; }

export async function signUp(email, password) {
  const j = await authCall('signup', { email, password });
  if (!j.access_token) return { needsConfirmation: true }; // project requires email confirmation
  saveSession(j); setState('unlinked'); return { needsConfirmation: false };
}
export async function signIn(email, password) { saveSession(await authCall('token?grant_type=password', { email, password })); setState('unlinked'); }
export async function signOut() {
  const s = session(); if (s) authCall('logout', {}, s.access_token).catch(() => {});
  for (const k of [LS.session, LS.cursor, LS.linked, LS.last]) ls.set(k, null);
  db.trackChanges = false; db.pending.clear(); db.pendingChanged = true; db.savePending(); setState('off');
}

async function validSession() {
  let s = session(); if (!s) throw new Error('Not signed in');
  if (Date.now() > s.expires_at - 60000) {
    try { s = saveSession(await authCall('token?grant_type=refresh_token', { refresh_token: s.refresh_token })); }
    catch (e) { if (e.status >= 400 && e.status < 500) { ls.set(LS.session, null); db.trackChanges = false; setState('off', 'Your sign-in expired. Sign in again to keep syncing.'); } throw e; }
  }
  return s;
}
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const s = await validSession(); const { url, key: anon } = getConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: anon, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const j = await res.json().catch(() => ({})); const e = new Error(j.message || `Sync request failed (${res.status})`); e.status = res.status;
    if (/records/.test(e.message) && /does not exist|could not find/i.test(e.message)) e.message = 'The sync table is missing. Run supabase/schema.sql in your Supabase project (SQL Editor).';
    throw e;
  }
  return res;
}

// ---------- Push / pull ----------
async function push() {
  const s = session(); const items = Array.from(db.pending.values()); let batch = [], bytes = 0, sent = 0;
  const send = async () => {
    if (!batch.length) return;
    await rest('records?on_conflict=user_id,collection,id', { method: 'POST', body: batch.map(b => b.row), prefer: 'resolution=merge-duplicates,return=minimal' });
    for (const b of batch) { const cur = db.pending.get(b.k); if (cur && cur.ts === b.ts) db.pending.delete(b.k); } // keep entries edited mid-upload
    db.pendingChanged = true; db.savePending(); sent += batch.length; batch = []; bytes = 0;
  };
  for (const p of items) {
    const obj = p.del ? null : db.col(p.c)?.get(p.id) || null; const size = obj ? JSON.stringify(obj).length : 64;
    if (batch.length && (batch.length >= BATCH || bytes + size > BATCH_BYTES)) await send();
    batch.push({ k: key(p.c, p.id), ts: p.ts, row: { user_id: s.user.id, collection: p.c, id: p.id, data: obj, deleted: !obj, updated_at: obj ? (obj._mts || p.ts) : p.ts } }); bytes += size;
  }
  await send(); return sent;
}
function applyRows(rows, touched) {
  let changed = 0;
  db.applyRemote(() => {
    for (const r of rows) {
      const col = db.col(r.collection); if (!col || !COLLECTIONS.includes(r.collection)) continue;
      const k = key(r.collection, r.id); const local = col.get(r.id); const pend = db.pending.get(k);
      const localTs = Math.max(local?._mts || 0, pend?.ts || 0); const ts = Number(r.updated_at);
      if (localTs > ts) continue; // our newer edit wins and will be uploaded
      if (pend) db.pending.delete(k);
      if (r.deleted || !r.data) { if (local) { col.remove(r.id); changed++; touched.add(r.collection); } }
      else if (!(local && localTs === ts)) { r.data._mts = ts; col.put(r.data); changed++; touched.add(r.collection); }
    }
  });
  return changed;
}
async function pull({ full = false } = {}) {
  const start = full ? null : ls.get(LS.cursor, null); const since = start ? new Date(start - OVERLAP_MS).toISOString() : null;
  let offset = 0, max = start || 0, changed = 0; const touched = new Set();
  for (;;) { // fixed lower bound + offset paging, so bursts of rows with the same timestamp can't loop
    const q = `records?select=collection,id,data,deleted,updated_at,synced_at&order=synced_at.asc,collection.asc,id.asc&limit=${PAGE}&offset=${offset}${since ? `&synced_at=gt.${encodeURIComponent(since)}` : ''}`;
    const rows = await (await rest(q)).json();
    changed += applyRows(rows, touched); for (const r of rows) max = Math.max(max, Date.parse(r.synced_at) || 0);
    if (rows.length < PAGE) break; offset += rows.length;
  }
  ls.set(LS.cursor, max || null); db.pendingChanged = true;
  return { changed, touched };
}

let running = null, again = false, timer = null;
export function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    if (!isLinked()) return;
    if (!navigator.onLine) { setState('offline'); return; }
    setState('syncing');
    try {
      await db.flush(); await push(); const res = await pull(); await db.flush();
      sync.lastSync = Date.now(); ls.set(LS.last, sync.lastSync); setState('ok');
      if (res.changed) sync.events.emit('remote', res);
    } catch (e) { console.warn('sync failed', e); if (sync.state !== 'off') setState(e instanceof TypeError ? 'offline' : 'error', e.message); }
  })().finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}
export function syncSoon(ms = 2500) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

// ---------- Device setup ----------
export async function remoteHasData() { const rows = await (await rest('records?select=id&limit=1')).json(); return rows.length > 0; }
export const localHasData = () => db.decks.size > 0 || db.notes.size > 0;
// mode: 'upload' (cloud is empty) | 'merge' (keep both) | 'replace' (this device takes the cloud copy)
export async function linkDevice(mode) {
  const s = session(); if (!s) throw new Error('Not signed in');
  ls.set(LS.cursor, null);
  if (mode === 'replace') {
    db.applyRemote(() => { for (const c of COLLECTIONS) db.col(c).clear(); }); db.pending.clear();
  } else {
    const now = Date.now();
    for (const c of COLLECTIONS) for (const o of db.col(c).all()) { if (!o._mts) { o._mts = now; db.col(c).dirty.add(o.id); } db.pending.set(key(c, o.id), { c, id: o.id, del: false, ts: o._mts }); }
    db.schedule();
  }
  db.pendingChanged = true; db.savePending(); db.trackChanges = true;
  ls.set(LS.linked, { userId: s.user.id, at: Date.now() });
  if (mode === 'replace') { setState('syncing'); const res = await pull({ full: true }); await db.flush(); sync.lastSync = Date.now(); ls.set(LS.last, sync.lastSync); setState('ok'); sync.events.emit('remote', { ...res, replaced: true }); }
  else await syncNow();
}

// ---------- Startup ----------
export function initSync() {
  // Triggers are always attached; syncNow() is a no-op until this device is linked to an account
  db.events.on('flushed', () => { if (db.trackChanges && db.pending.size) syncSoon(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 90000);
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => { if (isLinked()) setState('offline'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  if (!session()) { setState('off'); return; }
  if (!isLinked()) { setState('unlinked'); return; }
  db.trackChanges = true; setState(navigator.onLine ? 'ok' : 'offline');
  setTimeout(syncNow, 1500);
}
