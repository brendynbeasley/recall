// Settings → Sync: connect a Supabase project, sign in, and choose how this device joins the account
import { db } from '../db.js';
import { h, svgIcon, fmtRelative } from '../utils.js';
import { toast, choose, confirm } from '../ui.js';
import { sync, getConfig, setConfig, session, isLinked, signIn, signUp, signOut, syncNow, linkDevice, remoteHasData, localHasData } from '../sync.js';

// One subscription for the module: redraw the open Sync screen (if any) when the sync state changes
let live = null;
sync.events.on('state', () => { if (live && live.status.isConnected) live.redraw(); else live = null; });

const STATE_TEXT = { off: 'Not signed in', unlinked: 'Signed in, not set up on this device', syncing: 'Syncing…', ok: 'Up to date', offline: 'Offline. Changes will sync when you reconnect.', error: 'Sync problem' };

export function renderSyncSettings(inner, sec, redraw) {
  const cfg = getConfig(); const s = session();
  const status = h('div', { class: `sync-status st-${sync.state}` }, h('span', { class: 'sync-dot' }), h('div', { class: 'grow' }, h('div', { class: 'bold' }, STATE_TEXT[sync.state] || sync.state),
    h('div', { class: 'small muted' }, s ? `${s.user.email}${isLinked() && sync.lastSync ? ` · last synced ${fmtRelative(sync.lastSync)}` : ''}${isLinked() && db.pending.size ? ` · ${db.pending.size} change${db.pending.size === 1 ? '' : 's'} waiting` : ''}` : 'Sign in to keep your sets and progress in sync on every device.'),
    sync.error ? h('div', { class: 'small sync-error' }, sync.error) : null));
  live = { status, redraw };

  if (!s) {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'username' });
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password (at least 6 characters)', autocomplete: 'current-password' });
    const busy = (btn, fn) => async () => { const e = email.value.trim(), p = pw.value; if (!e || p.length < 6) { toast('Enter your email and a password of at least 6 characters', 'warning'); return; } btn.disabled = true; try { await fn(e, p); } catch (err) { toast(err.message, 'error', { duration: 6000 }); } finally { btn.disabled = false; } };
    const inBtn = h('button', { class: 'btn btn-primary' }, svgIcon('user', 16), 'Sign in'); const upBtn = h('button', { class: 'btn' }, 'Create account');
    inBtn.onclick = busy(inBtn, async (e, p) => { await signIn(e, p); toast('Signed in', 'success'); await setupDevice(); redraw(); });
    upBtn.onclick = busy(upBtn, async (e, p) => { const r = await signUp(e, p); if (r.needsConfirmation) { toast('Check your email to confirm your account, then sign in here.', 'info', { duration: 8000 }); return; } toast('Account created', 'success'); await setupDevice(); redraw(); });
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') inBtn.click(); });
    inner.append(sec('Cloud sync', 'Use Recall on any computer, phone or tablet with the same sets and progress. Everything still works offline and syncs when you reconnect.', status,
      cfg.url && cfg.key ? h('div', { class: 'col sync-form' }, email, pw, h('div', { class: 'row wrap', style: { gap: '8px' } }, inBtn, upBtn)) : h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'First connect a Supabase project below.')));
  } else {
    const actions = h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '14px' } });
    if (isLinked()) actions.append(h('button', { class: 'btn btn-primary', disabled: sync.state === 'syncing', onClick: () => syncNow() }, svgIcon('refresh', 16), 'Sync now'));
    else actions.append(h('button', { class: 'btn btn-primary', onClick: async () => { await setupDevice(); redraw(); } }, svgIcon('cloud', 16), 'Set up this device'));
    actions.append(h('button', { class: 'btn', onClick: async () => { if (await confirm('Sign out of sync on this device? Your data stays here; it just stops syncing.', { okLabel: 'Sign out' })) { await signOut(); redraw(); } } }, svgIcon('logOut', 16), 'Sign out'));
    inner.append(sec('Cloud sync', null, status, actions));
  }

  // Connection details (hidden behind a disclosure when the build already includes them)
  const url = h('input', { class: 'input', placeholder: 'https://your-project.supabase.co', value: cfg.url });
  const key = h('input', { class: 'input', placeholder: 'anon public key', value: cfg.key });
  const conn = h('div', { class: 'col', style: { gap: '8px' } }, url, key, h('div', { class: 'row', style: { gap: '8px' } },
    h('button', { class: 'btn', onClick: () => { if (!/^https:\/\/.+/.test(url.value.trim()) || !key.value.trim()) { toast('Enter the project URL (https://…) and the anon key', 'warning'); return; } setConfig(url.value, key.value); toast('Connection saved', 'success'); redraw(); } }, 'Save connection'),
    cfg.baked ? null : h('button', { class: 'btn btn-ghost', onClick: () => { setConfig('', ''); redraw(); } }, 'Clear')));
  const guide = h('ol', { class: 'sync-guide small' },
    h('li', {}, 'Create a free project at supabase.com.'),
    h('li', {}, 'Open SQL Editor → New query, paste the contents of supabase/schema.sql from the Recall folder, and click Run.'),
    h('li', {}, 'Optional: Authentication → Sign In / Providers → Email → turn off "Confirm email" so new accounts work straight away.'),
    h('li', {}, 'Project Settings → API: copy the Project URL and the anon public key into the fields above.'));
  inner.append(sec('Supabase connection', cfg.baked ? 'This copy of Recall comes with a sync server already set up. You only need to change this to use your own.' : 'Recall syncs through your own free Supabase project, so your data lives in an account you control.',
    cfg.baked ? h('details', { class: 'sync-details' }, h('summary', {}, 'Use a different project'), conn) : conn, cfg.baked ? null : h('div', { class: 'label', style: { margin: '16px 0 6px' } }, 'Setup'), cfg.baked ? null : guide));
}

// Decide how this device joins the account, asking only when both sides already have data
export async function setupDevice() {
  let remote; try { remote = await remoteHasData(); } catch (e) { toast(e.message, 'error', { duration: 8000 }); return; }
  const local = localHasData(); let mode = remote ? 'replace' : 'upload';
  if (remote && local) {
    mode = await choose('Set up sync on this device', [
      { value: 'replace', icon: 'cloud', label: 'Use my cloud data', description: 'Replace what is on this device with the sets and progress from your account. Best for a new device.' },
      { value: 'merge', icon: 'refresh', label: 'Merge both', description: 'Keep the sets on this device and add them to your account alongside the existing ones.' },
    ], { message: 'Your account already has data, and so does this device.' });
    if (!mode) return;
  }
  if (mode === 'replace' && local) { try { const { createBackup } = await import('../exporters.js'); await createBackup(false, 'pre-sync'); } catch (e) { /* desktop only */ } }
  try { await linkDevice(mode); toast(mode === 'replace' ? 'Your cloud data is now on this device' : 'Sync is on. This device is backed up to your account.', 'success'); }
  catch (e) { toast(e.message, 'error', { duration: 8000 }); }
}
