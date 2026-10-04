// Browser UI for the Surface drawing-to-labour prototype.
// Plain ES modules, no dependencies, no outbound requests.
import * as C from './core.js';
import * as J from './jobs.js';

const NS = 'http://www.w3.org/2000/svg';

// ---- Several jobs (EP21-02) ------------------------------------------------
// The open job lives in its own record (jobs.js). The older single-job key is
// read only. access says what this tab may do with the open record:
//   edit      — this tab holds the job's owner lock and saves normally
//   other-tab — another tab is editing it: changes stay on screen, never saved
//   stale     — another tab saved it after we opened it: we never write again
//   fallback  — no Web Locks/SubtleCrypto: nothing is written but rescues
//   unsaved   — the open job has no record here (e.g. the job list is full)
//   switching — between jobs; nothing saves
const TEST_HOOKS = window.__SURFACE_TEST__ || {}; // set only by synthetic tests
const writerTab = 'T' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
let jobsApi = null;
let lockSupport = false;
let access = 'switching';
let currentId = null;     // record of the open job, null if it has none
let lastKnownRev = 0;     // writeRev this tab last read or wrote
let jobPrefs = J.cleanPrefs(null);
let ownerLock = null;
let savedCanon = null;    // contentKey() known to be in storage (null: none)
// What a save would store, minus savedAt/revision: unchanged content is never rewritten.
const contentKey = () => J.canonical(job) + '\u0000' + JSON.stringify(jobPrefs);
let openToken = 0;        // bumps on every open, so late save results never cross jobs
let legacyOffer = null;   // older-version job waiting for "add it as a new job"
let legacyMarkerUnreadable = false; // §4.1 skip: the older-version job is listed in Recover, download only
let accessNote = '';      // why an 'unsaved' job has no record
let staleCause = 'unknown'; // why access is 'stale': 'other-tab', 'own' (our save wasn't confirmed) or 'unknown'
let rescueFullWarned = false;
let refusedNumber = null; // an invalid number refused when its field lost focus; blocks the next switch once

// ---- State ---------------------------------------------------------------
let job = null;
let mode = 'select';            // select | place | draw | notes
let view = 'PLAN';              // PLAN | A | B | C | D
let selectedId = null;
// "Set height for several" sub-state of the Select tool: multiIds is null when
// off and an array of fitting IDs when on. multiDraft keeps the typed height
// across panel rebuilds; multiPending holds a tap awaiting the 12-px threshold.
let multiIds = null;
let multiDraft = '';
let multiPending = null;
let placeType = 'surface';
// "Place like this": {type, heightMm, layer, from} captured once from the
// selected fitting, or null. Each tap in Place places one copy.
let copyTpl = null;
let history = [];               // JSON snapshots (undo), limit 50
let redoStack = [];
let penSeen = false;
let zoom = { s: 1, tx: 0, ty: 0 };
// Must match the phone media queries in style.css.
const PHONE = window.matchMedia('(max-width: 600px), (max-height: 500px)');
let inspectorCollapsed = true; // layout A: every screen starts with details folded so the drawing gets the space
let lastDetailsId = null;       // fitting the details panel last showed (unfold on a new pick)
let lastInspectorKey = '';      // which panel was last rendered (scroll kept across same-panel rebuilds)
let pendingRoom = null;         // room values awaiting shrink decision
// Layer visibility is view state only: never saved, reset to all on job open.
let shownLayers = new Set(C.LAYERS);
let layersOpen = false;
const allShown = () => shownLayers.size === C.LAYERS.length;
const isShown = (item) => shownLayers.has(C.layerOf(item));
// Called inside a commit so the fitting is visible before renderAll runs.
// Returns the revealed layer's label, or null if it was already shown.
function revealLayerOf(id) {
  const it = job.items.find(i => i.id === id);
  if (!it || isShown(it)) return null;
  shownLayers.add(C.layerOf(it));
  return C.LAYER_LABELS[C.layerOf(it)];
}

// ---- Copy mode and remembered placement (§4.8) ------------------------------
// Prefs are per job, never undone, and go out with the job's normal save.
function rememberType(type) {
  jobPrefs = J.cleanPrefs({ ...jobPrefs, lastType: type });
}
function rememberHeight(type, wall, heightMm) {
  if (wall === C.CEILING) return; // a ceiling fitting's heightMm is a plan position
  jobPrefs = J.cleanPrefs({ ...jobPrefs, heights: { ...jobPrefs.heights, [type]: heightMm } });
}
function startCopy(item) {
  copyTpl = { type: item.type, heightMm: item.heightMm, layer: C.isLayer(item.layer) ? item.layer : null, from: item.id };
  placeType = item.type;
  rememberType(item.type);
  inspectorCollapsed = PHONE.matches; // phones need the drawing to tap on
  setMode('place');
  buildPalette();
  renderAll();
}
// Leaves copy mode with nothing added. Returns whether it was on.
function endCopy() {
  if (!copyTpl) return false;
  copyTpl = null;
  buildPalette();
  return true;
}
function cancelCopy() {
  if (!endCopy()) return;
  toast('Stopped placing copies. Nothing was added.');
  renderAll();
}
function copyLabel() {
  const t = copyTpl;
  return t.type === 'downlight'
    ? `Copying ${t.from} (${C.TYPES[t.type].label}). Tap the ceiling in the plan view for each one.`
    : `Copying ${t.from} (${C.TYPES[t.type].label}, ${t.heightMm} mm). Tap the wall for each one.`;
}

// ---- Set height for several -------------------------------------------------
function endMulti() { multiIds = null; multiDraft = ''; multiPending = null; }
function startMulti(initialId = null) {
  multiIds = initialId ? [initialId] : [];
  multiDraft = '';
  multiPending = null;
  selectedId = null;      // single selection is meaningless in multi mode
  layersOpen = false;
  // phones collapse so the drawing can be tapped (the count chip stays in the
  // sheet header); tablets and desktops must stay expanded for Apply/Cancel
  inspectorCollapsed = PHONE.matches;
  setMode('select');
  renderAll();
}
// A hidden, deleted, ceiling-moved or otherwise stale ID can't stay selected.
// Called at the top of renderAll so every rerender drops them safely.
function pruneMulti() {
  if (!multiIds) return;
  const kept = [], hiddenIds = [], staleIds = [];
  for (const id of multiIds) {
    const it = job.items.find(i => i.id === id);
    if (!it || !C.TYPES[it.type] || it.wall === C.CEILING) staleIds.push(id);
    else if (!isShown(it)) hiddenIds.push(id);
    else kept.push(id);
  }
  if (hiddenIds.length || staleIds.length) {
    multiIds = kept;
    const msgs = [];
    if (hiddenIds.length) msgs.push(`${hiddenIds.length} removed from the selection because their layer is now hidden`);
    if (staleIds.length) msgs.push(`${staleIds.join(', ')} removed from the selection because they changed or are no longer in the job`);
    toast(msgs.join(' · '));
  }
}

const $ = (sel) => document.querySelector(sel);
const svgEl = (name, attrs = {}, parent = null) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};
const el = (tag, attrs = {}, text = null) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'class') e.className = v; else e.setAttribute(k, v);
  if (text !== null) e.textContent = text;   // plain text only — never HTML from user data
  return e;
};

// ---- Toast ---------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- History (undo/redo) ---------------------------------------------------
function snapshot() { return JSON.stringify(job); }
function commit(mutate) {
  // Exception-safe: a mutation that throws (e.g. item cap) changes nothing and
  // leaves no empty undo frame.
  const pre = snapshot();
  try { mutate(); }
  catch (err) { toast(`Change not applied — ${err.message}`); renderAll(); return; }
  history.push(pre);
  if (history.length > C.LIMITS.historyLimit) history.shift();
  redoStack = [];
  job.revision += 1;
  // A discrete edit (button, menu, drag, placement) ends any typing session:
  // typing before and after it are separate undo units.
  clearTimeout(sessionTimer); session = null;
  renderAll();
  scheduleSave();
}
function undo() {
  clearDrafts(); // an uncommitted draft dies with the state it belonged to
  if (!history.length) return;
  const prevRevision = job.revision;
  const current = job;
  redoStack.push(snapshot());
  job = C.normaliseJob(JSON.parse(history.pop()));
  job.nextId = C.monotonicNextId(job, current); // never reissue a fitting ID
  selectedId = job.items.some(i => i.id === selectedId) ? selectedId : null;
  job.revision = Math.max(job.revision, prevRevision) + 1; // never reuse a revision number
  renderAll(); scheduleSave();
}
function redo() {
  clearDrafts();
  if (!redoStack.length) return;
  const prevRevision = job.revision;
  const current = job;
  history.push(snapshot());
  job = C.normaliseJob(JSON.parse(redoStack.pop()));
  job.nextId = C.monotonicNextId(job, current);
  selectedId = job.items.some(i => i.id === selectedId) ? selectedId : null;
  job.revision = Math.max(job.revision, prevRevision) + 1;
  renderAll(); scheduleSave();
}

// ---- Typing drafts (EP19-02: valid typing, honest save state) ---------------
// Uncommitted text in one field — a fitting's note, the job note, or a
// fitting's height/position number. A valid draft commits shortly after
// typing pauses and also flushes synchronously on pagehide, so leaving or
// reloading never loses site work. Invalid or partial numbers never reach
// the job or storage and never overwrite the last valid value. One
// continuous typing session in one field is a single undo step, and every
// draft carries its own fitting id / job field, so switching selection,
// jobs or forms can never apply it to the wrong target.
const DRAFT_COMMIT_MS = 500;   // commit + save well inside a second of the last keystroke
const SESSION_IDLE_MS = 2000;  // pauses longer than this end the typing session
let draft = null;              // {key, target, value, valid, dirty}
let draftTimer = null;
let session = null;            // {key, pushed, orig, frame} — one undo frame per typing session
let sessionTimer = null;

function chipTyping() {
  const chip = $('#save-chip');
  chip.className = 'chip warn';
  chip.textContent = 'Unsaved changes — typing…';
  chip.onclick = null;
}
function chipInvalidDraft() {
  const chip = $('#save-chip');
  chip.className = 'chip warn';
  chip.textContent = 'Not saved yet — fix the highlighted number';
  chip.onclick = null;
}
function clearDrafts() {
  clearTimeout(draftTimer); clearTimeout(sessionTimer);
  draft = null; session = null; draftTimer = null; sessionTimer = null;
}
// Register input in one field. A draft in a DIFFERENT field commits first,
// so quick field-to-field typing cannot drop the earlier edit.
function setDraft(d) {
  refusedNumber = null; // typing again supersedes an earlier refused number
  if (draft && draft.key !== d.key) flushDraft();
  draft = d;
  clearTimeout(draftTimer);
  if (!session || session.key !== d.key) {
    // remember where the field started, so a session that types it back to
    // that value can drop its own (visually empty) undo frame
    const t = d.target.kind === 'job' ? job : job.items.find(i => i.id === d.target.id);
    session = { key: d.key, pushed: false, orig: t ? t[d.target.field] : undefined, frame: null };
  }
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => { session = null; }, SESSION_IDLE_MS);
  if (d.dirty) { if (d.valid) chipTyping(); else chipInvalidDraft(); }
  draftTimer = setTimeout(flushDraft, DRAFT_COMMIT_MS);
}
// Commit the pending draft now. Valid + changed: one undo frame per typing
// session, target resolved by stored id/field (never by what is selected
// now). Invalid or unchanged drafts change nothing. An INVALID draft stays
// registered (nothing is stored, but the save chip and the blur/restore
// path must keep knowing the field is showing a refused value). Returns the
// draft it examined, so callers can react to an invalid one.
function flushDraft() {
  clearTimeout(draftTimer); draftTimer = null;
  const d = draft; draft = null;
  if (!d || !job || !d.valid) { if (d && !d.valid) draft = d; return d; }
  const t = d.target.kind === 'job' ? job : job.items.find(i => i.id === d.target.id);
  if (!t) return d; // its fitting is gone (deleted/replaced): the draft dies with it
  // a valid wall height becomes this type's remembered height (E20)
  if (d.target.kind === 'item' && d.target.field === 'heightMm') rememberHeight(t.type, t.wall, d.value);
  if (t[d.target.field] === d.value) { saveNow(); return d; } // same-value input: nothing stored, no undo step
  const pre = snapshot();
  t[d.target.field] = d.value;
  const inSession = session && session.key === d.key;
  if (!(inSession && session.pushed)) { // the session's first commit owns its single undo frame
    history.push(pre);
    if (history.length > C.LIMITS.historyLimit) history.shift();
    redoStack = [];
    if (inSession) { session.pushed = true; session.frame = pre; }
  } else if (session.orig !== undefined && d.value === session.orig
    && history.length && history[history.length - 1] === session.frame) {
    // the session typed the field back to where it started: its undo frame
    // would change nothing visible, so drop it again — and hand ownership back,
    // so typing that goes somewhere new still gets exactly one new frame
    history.pop();
    session.pushed = false;
    session.frame = null;
  }
  job.revision += 1;
  // Never rebuild the panel the draft lives in: focus, caret and the
  // on-screen keyboard stay put (also across focus transitions between two
  // of its fields, while activeElement is briefly the body); the drawing
  // and counts still refresh.
  if (d.elem && d.elem.isConnected) renderAllButInspector(); else renderAll();
  scheduleSave();
  return d;
}
function renderAllButInspector() {
  renderTabs(); renderLayers(); renderCanvas(); renderQuote(); syncFooterHeight();
  updateHistoryButtons();
}
// Drop a draft without committing it and put its field back to the stored
// value. Used by in-field Ctrl+Z before the session committed: undoing "the
// typing" must not consume an unrelated earlier undo step.
function discardDraft(d) {
  clearDrafts();
  if (d && d.elem && d.elem.isConnected && job) {
    const t = d.target.kind === 'job' ? job : job.items.find(i => i.id === d.target.id);
    if (t) d.elem.value = t[d.target.field];
  }
  saveNow(); // chip back to the honest stored state
}
// Leaving the page: valid drafts go in; invalid drafts are simply not stored.
// A locked save is async and may not finish before the page dies, so unsaved
// content first goes to this page's own rescue key (synchronous, no lock),
// then the normal save is requested; a successful save removes the rescue.
// The debounce, not this handler, is the main mechanism, and nothing here can
// guarantee persistence if the system kills the tab.
window.addEventListener('pagehide', (e) => {
  if (!job) return;
  flushDraft();
  clearTimeout(saveTimer);
  if (jobsApi && contentKey() !== savedCanon) {
    // no dialog is possible here; rescue-full was surfaced while the page was active
    const kept = jobsApi.writeRescue({ writerTab, jobId: currentId, baseRev: currentId ? lastKnownRev : null, job });
    if (!kept.ok) rescueFullWarned = false; // warn again if this page comes back from the cache
  }
  if (access === 'edit') saveNow();
  // a page kept in the back/forward cache must not keep others from editing
  if (e.persisted) releaseOwner();
});
window.addEventListener('pageshow', async (e) => {
  if (e.persisted) warnIfRescueFull();
  if (!e.persisted || !currentId || !lockSupport || TEST_HOOKS.noOwnerLock || ownerLock) return;
  if (access !== 'edit' && access !== 'other-tab') return;
  const token = openToken;
  const o = await jobsApi.acquireOwner(currentId);
  await (saveFollowUp || saving); // the pagehide save may still be settling
  // Resume only if nothing changed meanwhile and the stored revision is still the one we know.
  if (token !== openToken || ownerLock || (access !== 'edit' && access !== 'other-tab')) { if (o) o.release(); return; }
  if (o) {
    const r = jobsApi.readJob(currentId);
    if (!r.ok || r.env.writeRev !== lastKnownRev) {
      o.release();
      access = 'stale';
      staleCause = r.ok ? causeOf(r.env.writerTab) : 'unknown';
      showAccessState();
      return;
    }
  }
  ownerLock = o;
  access = o ? 'edit' : 'other-tab';
  showAccessState();
});
// Who wrote the stored revision we didn't expect.
function causeOf(storedWriter) {
  if (storedWriter && storedWriter === writerTab) return 'own';
  return storedWriter ? 'other-tab' : 'unknown';
}
// Surface a full Recover list while the app is active: pagehide can't ask.
function warnIfRescueFull() {
  if (!jobsApi || !job || contentKey() === savedCanon) return;
  if (jobsApi.rescueRoom(writerTab)) { rescueFullWarned = false; return; }
  if (rescueFullWarned) return;
  rescueFullWarned = true;
  toast(`Recover already holds ${J.MAX_RESCUES} kept copies, so unsaved changes here won’t be kept if this page closes. Open Menu → Recover saved data, download one and dismiss it.`);
}
// Another tab wrote the job open here: this copy is out of date and must
// never be saved over it. (Our own writes never fire this event.)
window.addEventListener('storage', (e) => {
  if (!currentId || e.key !== J.JOB_PREFIX + currentId) return;
  if (access === 'edit') { access = 'stale'; staleCause = 'other-tab'; showAccessState(); }
  else if (access === 'other-tab') showAccessState('The other tab has saved changes.');
});

// ---- Storage (honest failures) ---------------------------------------------
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
// Saves are async (they wait for the job's lock) and resolve {ok, reason}.
// A save asked for while one is running is coalesced into ONE follow-up save,
// which every later caller shares.
let saving = null;
let saveFollowUp = null;
function saveNow() {
  if (!saving) {
    saving = runSave().catch(() => ({ ok: false, reason: 'Not saved. Something went wrong while saving.' }))
      .finally(() => { saving = null; });
    return saving;
  }
  if (!saveFollowUp) saveFollowUp = saving.then(() => { saveFollowUp = null; return saveNow(); });
  return saveFollowUp;
}
function setChip(cls, text, onclick = null) {
  const chip = $('#save-chip');
  chip.className = cls ? `chip ${cls}` : 'chip';
  chip.textContent = text;
  chip.onclick = onclick;
}
const NOT_SAVED_BACKUP = 'Not saved — storage full or blocked. Tap to download a backup.';
async function runSave() {
  if (!job) return { ok: true };
  // A save that lands while a newer edit is still being typed must not stamp
  // over the typing/invalid chip state — not on entry, and especially not
  // with a false "Saved" on exit.
  const pendingDraft = draft && draft.dirty ? draft : null;
  try {
    C.serialiseJob({ ...job, savedAt: new Date().toISOString() });
  } catch (err) {
    // The record itself failed validation — say that, never "storage full".
    if (String(err.message).includes('room')) {
      setChip('warn', 'Not saved yet — set the room size first');
      return { ok: false, reason: 'This job can’t be saved until it has a room size.' };
    }
    setChip('err', `Not saved — job record problem (${String(err.message).slice(0, 60)}…). Keep this screen open.`);
    return { ok: false, reason: `This job can’t be saved: ${err.message}.` };
  }
  if (access !== 'edit') {
    // Nothing is written from this tab. Unchanged content is still safe.
    const clean = savedCanon !== null && contentKey() === savedCanon;
    if (!pendingDraft) showAccessState();
    if (!clean) warnIfRescueFull();
    return clean ? { ok: true, reason: 'unchanged' } : { ok: false, reason: accessReason(), canLeave: true };
  }
  const canon = contentKey();
  if (canon === savedCanon) {
    // already stored exactly: no write, so other tabs see no change
    if (pendingDraft) { if (pendingDraft.valid) chipTyping(); else chipInvalidDraft(); }
    else setChip('ok', 'Saved on this device');
    return { ok: true, reason: 'unchanged' };
  }
  if (!pendingDraft) setChip('', 'Saving…');
  const token = openToken;
  const r = await jobsApi.save({ jobId: currentId, job, prefs: jobPrefs, baseRev: lastKnownRev, writerTab });
  if (token !== openToken) return r; // the job was switched meanwhile: this result belongs to the old record
  if (r.ok) {
    lastKnownRev = r.writeRev;
    savedCanon = canon;
    job.savedAt = r.savedAt; // in step with what was actually saved
    jobsApi.clearRescue(writerTab);
    if (pendingDraft) {
      // stored fine, but a newer edit is still uncommitted in a field: say
      // that honestly instead of claiming Saved over it
      if (pendingDraft.valid) chipTyping(); else chipInvalidDraft();
    } else if (contentKey() !== canon) {
      setChip('', 'Saving…'); // a newer edit landed while this one was saved; its save is queued
    } else {
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setChip('ok', `Saved on this device · ${time}`);
    }
    return { ok: true };
  }
  const failed = saveFailed(r);
  warnIfRescueFull();
  return failed;
}
// Honest failure states. The job stays on screen and nothing else changes.
function saveFailed(r) {
  switch (r.reason) {
    case 'stale':
      // writeRev protection stays: a stale tab never writes again
      access = 'stale';
      staleCause = causeOf(r.storedWriter);
      showAccessState();
      return { ok: false, reason: accessReason(), canLeave: true };
    case 'read-failed':
      setChip('err', 'Not saved — this device’s storage would not let us check the saved job, so nothing was overwritten. Tap to download a backup.', () => downloadBackup());
      toast('Your job is still on screen but not saved: the saved job could not be read, so saving stopped rather than risk replacing it. Download a backup, then retry.');
      return { ok: false, reason: 'The saved copy of this job couldn’t be read, so nothing was overwritten.' };
    case 'unreadable':
      setChip('err', 'Not saved. The saved copy of this job can’t be read, so it was left as it is. Tap to download a backup.', () => downloadBackup());
      return { ok: false, reason: 'The saved copy of this job can’t be read. It was left as it is; download a backup or save this as a new job.' };
    case 'missing':
      setChip('err', 'Not saved. This job’s saved record has gone from this device. Tap to download a backup.', () => downloadBackup());
      return { ok: false, reason: 'This job’s saved record has gone from this device. Download a backup or save this as a new job.' };
    case 'lock-timeout':
      setChip('err', 'Not saved. Another tab kept this job busy. Tap to download a backup.', () => downloadBackup());
      return { ok: false, reason: 'Another tab kept this job busy, so it wasn’t saved. Try again in a moment.' };
    case 'too-large':
      setChip('err', 'Not saved. This job is too large to store on this device. Tap to download a backup.', () => downloadBackup());
      return { ok: false, reason: 'This job is too large to store on this device. Download a backup.' };
    case 'readback':
      // the write may have landed; it just couldn't be checked
      setChip('err', 'Not confirmed. This device didn’t give back what was just saved, so we can’t say the job is stored. Tap to download a backup.', () => downloadBackup());
      toast('Your job is still on screen. This device may have stored it, but reading it back didn’t match, so it isn’t confirmed. Download a backup, then retry.');
      return { ok: false, reason: 'This device didn’t give back what was just saved, so the save isn’t confirmed. Download a backup before leaving.' };
    default: // quota, blocked
      setChip('err', NOT_SAVED_BACKUP, () => downloadBackup());
      toast('This device’s storage is full or blocked. Your job is still on screen — download a backup.');
      return { ok: false, reason: 'This device’s storage is full or blocked, so the job wasn’t saved. Nothing else changed.' };
  }
}
function accessReason() {
  if (access === 'other-tab') return 'This job is open for editing in another tab, so changes here aren’t saved.';
  if (access === 'stale') return staleText().reason;
  if (access === 'fallback') return 'This browser can’t safely save jobs on this device, so changes here aren’t saved.';
  return 'This job isn’t saved on this device.';
}
// Only claim "another tab" when the stored record says another tab wrote it.
function staleText() {
  if (staleCause === 'other-tab') return {
    chip: 'Changed in another tab — not saved',
    banner: 'This job was changed in another tab, so this version wasn’t saved.',
    reason: 'Changed in another tab — not saved. This version is still on screen.',
  };
  if (staleCause === 'own') return {
    chip: 'Not saved — last save not confirmed',
    banner: 'This device didn’t confirm the last save, so this version wasn’t saved over it.',
    reason: 'This device didn’t confirm the last save, so nothing more was saved. This version is still on screen.',
  };
  return {
    chip: 'Saved copy changed — not saved',
    banner: 'The saved copy of this job changed after it was opened here, so this version wasn’t saved.',
    reason: 'The saved copy changed after it was opened here, so this version wasn’t saved. It’s still on screen.',
  };
}

// The chip and banner always say what this tab can do with the open job.
function showAccessState(extra = '') {
  const banner = $('#job-banner');
  const acts = $('#job-banner-actions');
  acts.innerHTML = '';
  const btn = (label, testid, fn) => {
    const b = el('button', { 'data-testid': testid }, label);
    b.addEventListener('click', fn);
    acts.appendChild(b);
  };
  let text = '';
  if (access === 'edit') {
    if (savedCanon !== null && contentKey() === savedCanon) setChip('ok', 'Saved on this device');
  } else if (access === 'other-tab') {
    setChip('warn', 'Read-only: open for editing in another tab');
    text = `Open for editing in another tab. Changes here aren’t saved. ${extra}`.trim();
    btn('Download backup', 'banner-download', () => downloadBackup());
    if (jobsApi.canWrite) btn('Save a copy as new job', 'banner-save-new', () => saveCopyAsNew());
    btn('Reload saved version', 'banner-reload', () => confirmReloadSaved());
  } else if (access === 'stale') {
    const st = staleText();
    setChip('err', st.chip, () => $('#job-banner').scrollIntoView({ block: 'nearest' }));
    text = st.banner;
    btn('Download this version', 'banner-download', () => downloadBackup());
    btn('Save this version as new job', 'banner-save-new', () => saveCopyAsNew());
    btn('Reload saved version', 'banner-reload', () => confirmReloadSaved());
  } else if (access === 'fallback') {
    setChip('err', 'Not saved: download a backup', () => downloadBackup());
    // wording quoted by the spec (§4.4)
    text = 'This browser can’t safely save several jobs on this device. Changes stay on screen — download a backup.';
    btn('Download backup', 'banner-download', () => downloadBackup());
  } else if (access === 'unsaved') {
    setChip('err', 'Not saved: download a backup', () => downloadBackup());
    text = `This job isn’t saved on this device. ${extra || accessNote}`.trim();
    btn('Download backup', 'banner-download', () => downloadBackup());
  }
  banner.hidden = !text;
  $('#job-banner-text').textContent = text;
  syncFooterHeight();
}

// ---- Unreadable saved data (BL-04) ----------------------------------------
// A saved record that fails parseBackup is never silently replaced. Each one is
// kept word-for-word under its own numbered key (bounded, never overwriting a
// different preserved copy) so recovery survives reloads. The user decides per
// record: download it, or explicitly delete that one record. Downloading starts
// a browser download only — it does not prove a file was kept, and it clears
// nothing: the copy stays until it is explicitly deleted.
// EP21-02: these older-version slots are only listed and deleted here; the
// new storage never writes them, and the older-version key itself is never
// moved, removed or overwritten (an unreadable one is offered as Download only).
const RECOVERY_PREFIX = 'surface.job.unreadable.';
const RECOVERY_MAX = 3;
function recoverySlots() {
  const out = [];
  for (let i = 1; i <= RECOVERY_MAX; i++) {
    const key = RECOVERY_PREFIX + i + '.v1';
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { raw = null; }
    if (raw !== null) out.push({ key, raw });
  }
  return out;
}
// Everything Recover lists: older-version slots, an unreadable older-version
// record, unreadable job records, rescued pages and incomplete imports.
function recoveryAll() {
  const out = recoverySlots().map(r => ({ kind: 'slot', ...r }));
  if (!jobsApi) return out;
  const L = jobsApi.peekLegacy();
  if (L.status === 'unreadable') out.push({ kind: 'legacy', key: J.LEGACY_KEY, raw: L.raw });
  else if (L.status === 'ok' && legacyMarkerUnreadable) out.push({ kind: 'legacy-kept', key: J.LEGACY_KEY, raw: L.raw });
  const s = jobsApi.safeScan();
  if (s) {
    for (const j of s.jobs) if (!j.ok) out.push({ kind: 'job', key: j.key, raw: j.raw, reason: j.reason });
    for (const r of s.rescues) if (r.writerTab !== writerTab) out.push({ kind: 'rescue', key: r.key, raw: r.raw, data: r.data });
    for (const i of s.imports) out.push({ kind: 'import', key: i.key, raw: i.raw, data: i.data });
  }
  return out;
}
function hasRecovery() { return recoveryAll().length > 0; }
// Dismissing kept changes deletes them, so Download is offered first.
function confirmDismissRescue(rec) {
  modal('Dismiss these kept changes?', [
    el('p', {}, 'This removes only this copy of unsaved changes from this device. It can’t be undone, so download it first if you might need it.'),
  ], [
    { label: 'Keep it', testid: 'rescue-keep', fn: () => openRecovery() },
    { label: 'Download this copy', testid: 'rescue-download', fn: () => { downloadRawRecord(rec.raw); toast('Download started. Check your Downloads folder.'); } },
    {
      label: 'Dismiss copy', class: 'btn-danger', testid: 'rescue-dismiss-confirm', fn: () => {
        if (!jobsApi.dismissRescue(rec.key)) {
          openRecovery();
          toast('Not dismissed. This device’s storage refused, so the copy is still there.');
          return;
        }
        if (hasRecovery()) openRecovery(); else closeModal();
        toast('Kept changes dismissed. Nothing else changed.');
      },
    },
  ]);
}
// An unreadable import record: only that record goes, and only once confirmed.
// Jobs the import already added are complete and stay.
function confirmDismissJournal(rec) {
  modal('Dismiss this import record?', [
    el('p', {}, 'This removes only this unreadable import record from this device. Jobs already added stay in your list. It can’t be undone, so download it first if you might need it.'),
  ], [
    { label: 'Cancel', testid: 'journal-keep', fn: () => openRecovery() },
    { label: 'Download this record', testid: 'journal-download', fn: () => { downloadRawRecord(rec.raw); toast('Download started. Check your Downloads folder.'); } },
    {
      label: 'Dismiss record', class: 'btn-danger', testid: 'journal-dismiss-confirm', fn: () => {
        if (!jobsApi.dismissJournal(rec.key)) {
          openRecovery();
          toast('Not dismissed. This device’s storage refused, so the record is still there.');
          return;
        }
        if (hasRecovery()) openRecovery(); else closeModal();
        toast('Import record dismissed. Nothing else changed.');
      },
    },
  ]);
}
function downloadRawRecord(raw, name = 'unreadable-saved-job') {
  if (raw === null || raw === undefined) { toast('That record couldn’t be read from this device’s storage, so there’s nothing to download.'); return; }
  download(`${name}-${stamp()}.json`, raw, 'application/json');
}
// Plain-language reason for an unreadable record (parseBackup never throws).
function recoveryReason(raw) {
  const r = C.parseBackup(raw);
  if (r.ok) return 'unknown problem';
  if (r.errors[0] === 'not valid JSON') return 'the saved file is incomplete or damaged';
  return r.errors[0] || 'unknown problem';
}
// Delete exactly this one record, wherever it lives. Verifies the removal
// before reporting success; never touches any other key.
function deleteRecoveryRecord(rec) {
  if (rec.kind !== 'slot' || !rec.key.startsWith(RECOVERY_PREFIX)) return false; // only older-version slots can be deleted
  try { localStorage.removeItem(rec.key); } catch { /* checked below */ }
  let after;
  try { after = localStorage.getItem(rec.key); } catch { after = 'unread'; }
  return after === null;
}
function openRecovery() {
  const records = recoveryAll();
  if (!records.length) { toast('No unreadable saved data left on this device.'); return; }
  const box = el('div');
  box.appendChild(el('p', {}, `${records.length === 1 ? 'One item needs' : `${records.length} items need`} a look. Each is kept exactly as it was, so nothing is lost.`));
  box.appendChild(el('p', { style: 'font-size:14px' }, 'Downloading starts a download. Check it lands in your Downloads folder and keep it somewhere safe. A download doesn’t remove anything from this list.'));
  const list = el('div');
  if (legacyOffer) {
    // Recover opens first at boot, so the older-version offer stays reachable from here
    const row = el('div', { class: 'recovery-row', 'data-testid': 'recovery-legacy-offer' });
    row.appendChild(el('p', {}, `Older-version job found: “${legacyOffer.job.name}”. It isn’t in your job list yet.`));
    const b = el('button', { 'data-testid': 'recovery-legacy-review' }, 'Review older-version job');
    b.addEventListener('click', () => { closeModal(); showLegacyOffer(); });
    row.appendChild(b);
    list.appendChild(row);
  }
  for (const [i, rec] of records.entries()) {
    const row = el('div', { class: 'recovery-row', 'data-testid': `recovery-row-${i}`, 'data-kind': rec.kind });
    const btns = el('div', { class: 'recovery-row-actions' });
    const dl = el('button', { class: 'btn-primary', 'data-testid': `recovery-download-${i}` }, 'Download this copy');
    dl.addEventListener('click', () => {
      downloadRawRecord(rec.raw, rec.kind === 'legacy-kept' ? 'older-version-job' : undefined);
      toast('Download started. Check your Downloads folder; the copy stays listed here.');
    });
    if (rec.kind !== 'slot') {
      let text;
      if (rec.kind === 'legacy') text = `Older-version record (unreadable): ${recoveryReason(rec.raw)}. It’s kept as it is. Download only.`;
      else if (rec.kind === 'legacy-kept') text = 'Older-version job, not added to your jobs because its upgrade record can’t be read. Both are kept as they are. Download only.';
      else if (rec.kind === 'job') text = `Unreadable job: ${rec.reason}. It’s kept as it is and still counts towards the ${J.MAX_JOBS}-job limit.`;
      else if (rec.kind === 'rescue') {
        text = rec.data
          ? `Unsaved changes kept when a page closed: “${rec.data.job.name}”, ${rec.data.at ? new Date(rec.data.at).toLocaleString('en-GB') : 'time unknown'}.`
          : 'Unsaved changes kept when a page closed, but they can’t be read.';
      } else {
        text = rec.data
          ? `Incomplete import: added ${rec.data.done.length} of ${rec.data.planned.length} jobs before it stopped. Jobs already added are complete.`
          : 'Incomplete import record that can’t be read.';
      }
      row.appendChild(el('p', {}, text));
      if (rec.kind === 'rescue' && rec.data) {
        const open = el('button', { 'data-testid': `recovery-open-${i}` }, 'Open as new job');
        open.addEventListener('click', () => { closeModal(); openRescueAsNew(rec.key); });
        btns.appendChild(open);
      }
      if (rec.kind === 'import' && rec.data) {
        const retry = el('button', { 'data-testid': `recovery-retry-${i}` }, 'Retry (choose the file again)');
        retry.addEventListener('click', () => { closeModal(); $('#file-input').click(); });
        const dismiss = el('button', { 'data-testid': `recovery-dismiss-${i}` }, 'Dismiss');
        dismiss.addEventListener('click', () => {
          if (!jobsApi.dismissJournal(rec.key)) toast('Not dismissed. This device’s storage refused.');
          if (hasRecovery()) openRecovery(); else closeModal();
        });
        btns.append(retry, dismiss);
      } else btns.appendChild(dl);
      if (rec.kind === 'import' && !rec.data) {
        const dismiss = el('button', { 'data-testid': `recovery-dismiss-${i}` }, 'Dismiss');
        dismiss.addEventListener('click', () => confirmDismissJournal(rec));
        btns.appendChild(dismiss);
      }
      if (rec.kind === 'rescue') {
        const dismiss = el('button', { 'data-testid': `recovery-dismiss-${i}` }, 'Dismiss');
        dismiss.addEventListener('click', () => confirmDismissRescue(rec));
        btns.appendChild(dismiss);
      }
      row.appendChild(btns);
      list.appendChild(row);
      continue;
    }
    const p = el('p', {}, `Older-version unreadable copy: ${recoveryReason(rec.raw)}.`);
    const del = el('button', { class: 'btn-danger', 'data-testid': `recovery-delete-${i}` }, 'Delete this copy');
    del.addEventListener('click', () => {
      modal('Delete this unreadable copy?', [
        el('p', {}, 'This removes only this unreadable saved record from this device. It cannot be undone — download it first if you might need it.'),
      ], [
        { label: 'Keep it', testid: 'recovery-keep', fn: () => openRecovery() },
        {
          label: 'Delete copy', class: 'btn-danger', testid: 'recovery-delete-confirm', fn: () => {
            if (!deleteRecoveryRecord(rec)) {
              openRecovery(); // keep the list on screen: nothing was deleted
              toast('Not deleted — this device’s storage refused. The copy is still there.');
              return;
            }
            if (hasRecovery()) openRecovery();
            else closeModal();
            toast('Unreadable copy deleted. Nothing else was changed.');
          },
        },
      ]);
    });
    btns.append(dl, del);
    row.append(p, btns);
    list.appendChild(row);
  }
  box.appendChild(list);
  modal('Recover saved data', [box], [
    { label: 'Close', class: 'btn-primary', testid: 'recovery-close', fn: closeModal },
  ]);
}

// ---- Modal helpers ----------------------------------------------------------
let modalOpener = null;   // control focused when the current modal opened
let lastFormFocus = null; // last field focused inside the open guarded form
function closeModal() {
  $('#modal-root').innerHTML = '';
  modalDismissGuard = null;
  discardConfirmEl = null;
  discardPriorFocus = null;
  lastFormFocus = null;
  const op = modalOpener;
  modalOpener = null;
  // Closing by any route (Save / Cancel / Throw away) hands focus back to the
  // control that opened the form, so keyboard users are not dropped on <body>.
  if (op && op.isConnected && op.focus) { try { op.focus({ preventScroll: true }); } catch { } }
}
// Slice 3 (BL-03): an EDITED form must not disappear on a stray backdrop tap
// or Escape. When set, modalDismissGuard runs before any implicit close; it
// returns false to keep the modal open — usually because it has just asked
// Keep editing / Throw away.
let modalDismissGuard = null;
function requestCloseModal() {
  if (modalDismissGuard && modalDismissGuard() === false) return false;
  closeModal();
  return true;
}
function modal(title, bodyNodes, actions = [], opts = {}) {
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'modal' });
  box.appendChild(el('h2', {}, title));
  for (const n of bodyNodes) box.appendChild(n);
  const actRow = el('div', { class: 'actions' });
  for (const a of actions) {
    const b = el('button', { 'data-testid': a.testid || '' }, a.label);
    if (a.class) b.className = a.class;
    b.addEventListener('click', () => a.fn(box));
    actRow.appendChild(b);
  }
  box.appendChild(actRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) requestCloseModal(); });
  modalOpener = (document.activeElement && document.activeElement.focus && document.activeElement !== document.body) ? document.activeElement : null;
  lastFormFocus = null;
  $('#modal-root').innerHTML = '';
  $('#modal-root').appendChild(overlay);
  modalDismissGuard = opts.onDismiss || null;
  discardConfirmEl = null;
  return box;
}

// ---- Edited-form dismissal guard (slice 3, BL-03) ----------------------------
// Backdrop or Escape on an edited Rates / Room size / Job details form asks
// "Keep editing or Throw away" instead of silently losing the typing. Untouched
// forms close as before, and the form's own Cancel always discards without
// asking. The question is a second overlay stacked on the untouched form, so
// Keep editing returns to exactly the same fields, values, caret and focus,
// and Throw away closes with no commit — so no extra undo step either.
let discardConfirmEl = null;
let discardPriorFocus = null;
function closeDiscardConfirm() {
  if (!discardConfirmEl) return;
  discardConfirmEl.remove();
  discardConfirmEl = null;
  const formOverlay = $('#modal-root .overlay');
  if (formOverlay) formOverlay.inert = false; // the form takes the keyboard back
  const f = discardPriorFocus;
  discardPriorFocus = null;
  // Restore the field the user was in — for a REAL tap this is the remembered
  // focusin target, because pointerdown already blurred the input to <body>.
  if (f && $('#modal-root').contains(f) && f.focus) { f.focus({ preventScroll: true }); return; }
  const firstInput = formOverlay && formOverlay.querySelector('input');
  if (firstInput) firstInput.focus({ preventScroll: true });
}
function askDiscardEdits(what) {
  if (discardConfirmEl) return;
  // A real backdrop tap blurs the field on pointerdown, so activeElement is
  // <body> by now: remember the last field focused inside the form instead.
  discardPriorFocus = (lastFormFocus && lastFormFocus.isConnected) ? lastFormFocus : document.activeElement;
  const formOverlay = $('#modal-root .overlay');
  if (formOverlay) formOverlay.inert = true; // the question owns the keyboard: no edits behind it
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'modal' });
  box.appendChild(el('h2', {}, 'Throw away your changes?'));
  box.appendChild(el('p', {}, `${what} Keep editing goes back to the form with everything as you left it — nothing is saved until you use its Save button.`));
  const actRow = el('div', { class: 'actions' });
  const toss = el('button', { class: 'btn-danger', 'data-testid': 'discard-throw' }, 'Throw away');
  toss.addEventListener('click', closeModal);
  const keep = el('button', { class: 'btn-primary', 'data-testid': 'discard-keep' }, 'Keep editing');
  keep.addEventListener('click', closeDiscardConfirm);
  actRow.append(toss, keep); // Save-style primary action stays on the right
  box.appendChild(actRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDiscardConfirm(); });
  discardConfirmEl = overlay;
  $('#modal-root').appendChild(overlay);
  keep.focus();
}
function guardedForm(title, bodyNodes, actions, isEdited, what) {
  const boxEl = modal(title, bodyNodes, actions, {
    onDismiss: () => {
      if (discardConfirmEl) { closeDiscardConfirm(); return false; }
      if (!isEdited()) return true; // untouched: close normally, no nagging
      askDiscardEdits(what);
      return false;
    },
  });
  // Track the last field focused inside this form so a REAL backdrop tap
  // (which blurs on pointerdown) can still restore focus on Keep editing.
  boxEl.addEventListener('focusin', (e) => { lastFormFocus = e.target; });
}
// ---- Coordinate geometry ----------------------------------------------------
// Oracle: walls are viewed from INSIDE the room, fromLeft 0 at the viewer's
// left. A: offset = x; B: offset = y; C: offset = W−x; D: offset = D−y.
function roomMm() {
  if (!job || !job.room) return { W: 0, D: 0, H: 0 };
  return { W: Math.round((job.room.widthM || 0) * 1000), D: Math.round((job.room.depthM || 0) * 1000), H: Math.round((job.room.heightM || 0) * 1000) };
}
// Wall letter → plan-space mapping (plan: x right, y down; A top, B right, C bottom, D left).
function planPos(item) {
  const { W, D } = roomMm();
  const f = item.fromLeftMm;
  switch (item.wall) {
    case 'A': return { x: f, y: 0 };
    case 'B': return { x: W, y: f };
    case 'C': return { x: W - f, y: D };
    case 'D': return { x: 0, y: D - f };
    default: return { x: item.fromLeftMm, y: item.heightMm }; // ceiling: (x across width, y across depth)
  }
}
// Inverse: plan point + chosen wall → fromLeft. Returns null if not near that wall.
function wallParamsFromPlan(x, y, wall) {
  const { W, D } = roomMm();
  const NEAR = Math.max(300, Math.round(Math.min(W, D) * 0.12));
  switch (wall) {
    case 'A': return y <= NEAR ? { fromLeft: Math.round(x), height: null } : null;
    case 'B': return x >= W - NEAR ? { fromLeft: Math.round(y), height: null } : null;
    case 'C': return y >= D - NEAR ? { fromLeft: Math.round(W - x), height: null } : null;
    case 'D': return x <= NEAR ? { fromLeft: Math.round(D - y), height: null } : null;
  }
  return null;
}
function nearestWallFromPlan(x, y) {
  const { W, D } = roomMm();
  // Absolute perpendicular distances: a tap beyond a wall's end (e.g. past the
  // right end of A) must stay nearest to that wall and clamp, not flip to the
  // perpendicular wall via a negative distance.
  const dists = { A: Math.abs(y), B: Math.abs(W - x), C: Math.abs(D - y), D: Math.abs(x) };
  return Object.keys(dists).reduce((a, b) => dists[a] <= dists[b] ? a : b);
}

// ---- Drawing: plan and wall views --------------------------------------------
const TYPE_COLOURS = { existing: '#777', unknown: '#b26a00' };

function fittingGlyph(item, x, y, labelBelow = true) {
  const g = svgEl('g', { class: 'fitting', 'data-id': item.id, transform: `translate(${x},${y})` });
  const t = C.TYPES[item.type];
  const isCeil = item.wall === C.CEILING;
  const col = TYPE_COLOURS[item.type] || '#1a1a1a';
  // distinct black-and-white-safe shapes per type
  if (isCeil) {
    // transparent fill (not 'none') so the whole disc is grabbable for dragging
    svgEl('circle', { cx: 0, cy: 0, r: 90, fill: 'transparent', stroke: col, 'stroke-dasharray': '40 30', 'stroke-width': 25 }, g);
  } else if (item.type === 'unknown') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff3cd', stroke: col, 'stroke-width': 25, transform: 'rotate(45)' }, g);
  } else if (item.type === 'existing') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#e8e8e8', stroke: col, 'stroke-width': 20, 'stroke-dasharray': '50 35' }, g);
    svgEl('line', { x1: -110, y1: -110, x2: 110, y2: 110, stroke: col, 'stroke-width': 12, 'stroke-dasharray': '30 30' }, g);
  } else if (item.type === 'switch') {
    svgEl('circle', { cx: 0, cy: 0, r: 110, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
  } else if (item.type === 'recessed') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
    svgEl('rect', { x: -50, y: -50, width: 100, height: 100, fill: 'none', stroke: col, 'stroke-width': 20 }, g);
  } else if (item.type === 'replacement') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
    svgEl('line', { x1: -110, y1: -110, x2: 110, y2: 110, stroke: col, 'stroke-width': 18 }, g);
    svgEl('line', { x1: 110, y1: -110, x2: -110, y2: 110, stroke: col, 'stroke-width': 18 }, g);
  } else if (item.type === 'spur') {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
    svgEl('line', { x1: -110, y1: 0, x2: 110, y2: 0, stroke: col, 'stroke-width': 18 }, g);
  } else if (item.type === 'threephase') {
    svgEl('polygon', { points: '0,-135 125,100 -125,100', fill: '#fff', stroke: col, 'stroke-width': 25, 'stroke-linejoin': 'round' }, g);
  } else {
    svgEl('rect', { x: -110, y: -110, width: 220, height: 220, fill: '#fff', stroke: col, 'stroke-width': 25 }, g);
  }
  const label = svgEl('text', { x: 0, y: labelBelow ? 250 : -350, 'text-anchor': 'middle', 'font-size': 150, fill: '#1a1a1a', 'font-family': 'inherit' }, g);
  label.textContent = `${item.id}·${t.symbol}`;
  return g;
}

// `show` decides which fittings are drawn. Room outline, labels and sketches
// are always drawn: they belong to every layer.
function renderPlan(content, { W, D }, show = isShown) {
  svgEl('rect', { x: 0, y: 0, width: W, height: D, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 25 }, content);
  // wall labels: one label per wall, each with its length
  const dims = [
    { x: W / 2, y: -260, text: `Wall A · ${job.room.widthM.toFixed(2)} m`, wall: 'A' },
    { x: W / 2, y: D + 420, text: `Wall C · ${job.room.widthM.toFixed(2)} m`, wall: 'C' },
    { x: -420, y: D / 2, text: `Wall D · ${job.room.depthM.toFixed(2)} m`, wall: 'D', rot: true },
    { x: W + 420, y: D / 2, text: `Wall B · ${job.room.depthM.toFixed(2)} m`, wall: 'B', rot: true },
  ];
  for (const d of dims) {
    const t = svgEl('text', {
      x: d.x, y: d.y, 'text-anchor': 'middle', 'font-size': 240,
      fill: '#23324d', 'font-family': 'inherit',
      transform: d.rot ? `rotate(-90 ${d.x} ${d.y})` : '', class: 'wall-letter', 'data-wall': d.wall,
    }, content);
    t.textContent = d.text;
  }
  // label-side bookkeeping so nearby fittings keep readable, separate labels
  const placedLabels = [];
  const labelFits = (x, gy, below) => !placedLabels.some(q =>
    q.below === below && Math.abs(q.x - x) < 900 && Math.abs(q.gy - gy) < 600);
  for (const item of job.items) {
    if (!show(item)) continue;
    if (item.wall === C.CEILING) {
      const g = fittingGlyph(item, item.fromLeftMm, item.heightMm, true);
      g.setAttribute('opacity', '0.75');
      content.appendChild(g);
      continue;
    }
    const p = planPos(item);
    // sit just inside the wall line
    const inset = { A: [0, 260], B: [-260, 0], C: [0, -260], D: [260, 0] }[item.wall];
    const gx = p.x + inset[0], gy = p.y + inset[1];
    // default: label on the room side of the wall line (A: below, C: above)
    let below = item.wall !== 'C';
    if (!labelFits(gx, gy, below) && labelFits(gx, gy, !below)) below = !below;
    placedLabels.push({ x: gx, gy, below });
    content.appendChild(fittingGlyph(item, gx, gy, below));
  }
  for (const s of (job.annotations.PLAN || [])) {
    const pl = svgEl('polyline', { points: s.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, content);
    pl.setAttribute('class', 'stroke');
  }
  return { margin: 500 };
}

function renderWall(content, wall, { W, D, H }, forPrint = false, show = isShown) {
  const L = (wall === 'A' || wall === 'C') ? W : D;
  svgEl('line', { x1: 0, y1: H, x2: L, y2: H, stroke: '#1a1a1a', 'stroke-width': 40 }, content); // floor line
  const hT = svgEl('text', { x: L + 380, y: H / 2, 'font-size': 240, fill: '#555', 'font-family': 'inherit', 'text-anchor': 'middle', transform: `rotate(-90 ${L + 380} ${H / 2})` }, content);
  hT.textContent = `${job.room.heightM.toFixed(2)} m`;
  const lT = svgEl('text', { x: L / 2, y: H + 420, 'font-size': 260, fill: '#23324d', 'text-anchor': 'middle', 'font-family': 'inherit' }, content);
  lT.textContent = `Wall ${wall} · ${(L / 1000).toFixed(2)} m — viewed from inside`;
  for (const item of job.items) {
    if (!show(item)) continue;
    if (item.wall === C.CEILING) {
      // Printed wall drawings omit the projection ticks: the small grey labels
      // collide at print scale, and the ceiling table on the same page already
      // lists them. Live wall views keep the ticks.
      if (forPrint) continue;
      // Ceiling fittings are drawn only as clearly labelled projection ticks on
      // the ceiling line — they are never wall mounted. Position along each
      // wall follows the same "viewed from inside" oracle as wall fittings:
      // A: x; B: y; C: W−x; D: D−y.
      const along = {
        A: item.fromLeftMm,
        B: item.heightMm,
        C: W - item.fromLeftMm,
        D: D - item.heightMm,
      }[wall];
      svgEl('line', { x1: along, y1: 0, x2: along, y2: 120, stroke: '#999', 'stroke-width': 25, 'stroke-dasharray': '60 40' }, content);
      const t = svgEl('text', { x: along, y: -140, 'font-size': 150, fill: '#777', 'text-anchor': 'middle', 'font-family': 'inherit' }, content);
      t.textContent = `${item.id}·${C.TYPES[item.type].symbol} (ceiling)`;
      continue;
    }
    if (item.wall !== wall) continue;
    content.appendChild(fittingGlyph(item, item.fromLeftMm, H - item.heightMm));
    if (item.id === selectedId) {
      svgEl('line', { x1: 0, y1: H - item.heightMm, x2: item.fromLeftMm, y2: H - item.heightMm, stroke: '#b26a00', 'stroke-width': 18, 'stroke-dasharray': '80 50' }, content);
      svgEl('line', { x1: item.fromLeftMm, y1: H, x2: item.fromLeftMm, y2: H - item.heightMm, stroke: '#b26a00', 'stroke-width': 18, 'stroke-dasharray': '80 50' }, content);
    }
  }
  for (const s of job.annotations[wall] || []) {
    const pl = svgEl('polyline', { points: s.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'stroke' }, content);
    pl.setAttribute('data-index', job.annotations[wall].indexOf(s));
  }
  return { L, H };
}

function renderCanvas() {
  const svg = $('#canvas');
  svg.innerHTML = '';
  if (!job || !job.room || !job.room.widthM) { svg.setAttribute('viewBox', '0 0 100 100'); renderLayerEmpty(); return; }
  const dims = roomMm();
  let vbW, vbH;
  if (view === 'PLAN') { vbW = dims.W + 1800; vbH = dims.D + 1800; }
  else { const L = (view === 'A' || view === 'C') ? dims.W : dims.D; vbW = L + 1800; vbH = dims.H + 1800; }
  svg.setAttribute('viewBox', `${-900} ${-900} ${vbW} ${vbH}`);
  const world = svgEl('g', { id: 'world', transform: `translate(${zoom.tx} ${zoom.ty}) scale(${zoom.s})` }, svg);
  const content = svgEl('g', {}, world);
  if (view === 'PLAN') renderPlan(content, dims);
  else renderWall(content, view, dims);
  // note pins
  const pins = (job.notePins || []).filter(p => p.view === view);
  for (const p of pins) {
    const g = svgEl('g', { transform: `translate(${p.x},${p.y})`, class: 'note-pin', 'data-id': p.id }, content);
    svgEl('circle', { cx: 0, cy: 0, r: 160, fill: '#fff3cd', stroke: '#8a7a2a', 'stroke-width': 20 }, g);
    const t = svgEl('text', { x: 0, y: 60, 'font-size': 200, 'text-anchor': 'middle' }, g);
    t.textContent = 'N';
    const lb = svgEl('text', { x: 0, y: 340, 'font-size': 150, 'text-anchor': 'middle', fill: '#444' }, g);
    lb.textContent = p.text.slice(0, 40);
  }
  if (multiIds) {
    for (const id of multiIds) {
      const sel = svg.querySelector(`.fitting[data-id="${id}"]`);
      if (sel) { const r = svgEl('rect', { x: -180, y: -180, width: 360, height: 360, fill: 'none', stroke: '#2266cc', 'stroke-width': 40 }); sel.insertBefore(r, sel.firstChild); }
    }
  } else if (selectedId) {
    const sel = svg.querySelector(`.fitting[data-id="${selectedId}"]`);
    if (sel) { const r = svgEl('rect', { x: -180, y: -180, width: 360, height: 360, fill: 'none', stroke: '#2266cc', 'stroke-width': 40 }); sel.insertBefore(r, sel.firstChild); }
  }
  const placeLayer = copyTpl ? (copyTpl.layer ?? C.defaultLayerFor(copyTpl.type)) : C.defaultLayerFor(placeType);
  const placeLayerHidden = !shownLayers.has(placeLayer);
  $('#hint').textContent = multiIds ? 'Tap fittings to add or remove them, then enter one height.' : {
    select: 'Tap a fitting to select it. Drag to move.',
    place: (copyTpl ? copyLabel() : C.TYPES[placeType].label + (placeType === 'downlight' ? ' — tap the ceiling in the plan view.' : ' — tap on the wall where the fitting goes.'))
      + (placeLayerHidden ? ` Its layer (${C.LAYER_LABELS[placeLayer]}) is hidden and will be shown when you place it.` : ''),
    draw: 'Sketches are notes only, shared by all layers. They are never priced.',
    notes: 'Tap to add a note. Notes are shared by all layers.',
  }[mode];
  renderLayerEmpty();
}

// Shown over the drawing when the layer filter leaves nothing to see on this view.
function renderLayerEmpty() {
  const box = $('#layer-empty');
  let msg = '';
  if (job && job.room && job.room.widthM) {
    const here = view === 'PLAN' ? job.items : job.items.filter(i => i.wall === view || i.wall === C.CEILING);
    const hiddenHere = here.filter(i => !isShown(i)).length;
    if (!shownLayers.size) msg = `All layers are hidden.${hiddenHere ? ` ${hiddenHere} fitting${hiddenHere === 1 ? '' : 's'} on this view aren’t shown.` : ''}`;
    else if (here.length && hiddenHere === here.length) msg = `Nothing shown on this view. ${hiddenHere} fitting${hiddenHere === 1 ? ' is' : 's are'} on hidden layers.`;
  }
  box.hidden = !msg;
  if (box.dataset.msg === msg) return;
  box.dataset.msg = msg;
  box.innerHTML = '';
  if (!msg) return;
  const all = el('button', { class: 'btn-primary', 'data-testid': 'layer-empty-show-all' }, 'Show all layers');
  all.addEventListener('click', () => applyLayers(new Set(C.LAYERS)));
  box.append(el('p', {}, msg), all);
}

// ---- Show layers control ------------------------------------------------------
function applyLayers(next) {
  const sel = job.items.find(i => i.id === selectedId);
  shownLayers = next;
  if (sel && !isShown(sel)) {
    selectedId = null;
    toast(`${sel.id} deselected because its layer is now hidden`);
  }
  renderAll();
}
function setLayerShown(layer, on) {
  const next = new Set(shownLayers);
  if (on) next.add(layer); else next.delete(layer);
  applyLayers(next);
}
function setLayersOpen(open) {
  layersOpen = open;
  renderLayers();
}
function renderLayers() {
  const btn = $('#btn-layers');
  const reset = $('#btn-layers-reset');
  const panel = $('#layers-panel');
  const hiddenN = job.items.length - C.visibleItems(job, shownLayers).length;
  const label = C.visibilityLabel(shownLayers);
  btn.textContent = `Layers: ${allShown() ? 'All' : shownLayers.size ? label : 'none shown'}`;
  btn.title = `Show layers (now: ${label})`;
  btn.setAttribute('aria-expanded', String(layersOpen));
  btn.classList.toggle('filtered', !allShown());
  reset.hidden = allShown();
  reset.textContent = hiddenN ? `${hiddenN} hidden · Show all` : 'Show all';
  panel.hidden = !layersOpen;
  if (!layersOpen) return;
  const active = document.activeElement;
  const focusKey = active && panel.contains(active) ? active.dataset.key : null;
  panel.innerHTML = '';
  panel.appendChild(el('p', { class: 'layers-title' }, 'Show layers'));
  const counts = C.layerCounts(job);
  for (const l of C.LAYERS) {
    const row = el('div', { class: 'layer-row' });
    const lbl = el('label', { class: 'layer-check' });
    const cb = el('input', { type: 'checkbox', 'data-key': `cb-${l}`, 'data-testid': `layer-${l}` });
    cb.checked = shownLayers.has(l);
    cb.addEventListener('change', () => setLayerShown(l, cb.checked));
    lbl.append(cb, el('span', {}, `${C.LAYER_LABELS[l]} (${counts[l]})`));
    const only = el('button', { class: 'layer-only', 'data-key': `only-${l}`, 'data-testid': `layer-only-${l}`, 'aria-label': `Show only ${C.LAYER_LABELS[l]}` }, 'Only');
    only.addEventListener('click', () => applyLayers(new Set([l])));
    row.append(lbl, only);
    panel.appendChild(row);
  }
  const all = el('button', { class: 'layer-all', 'data-key': 'all', 'data-testid': 'layers-show-all' }, 'Show all');
  all.disabled = allShown();
  all.addEventListener('click', () => applyLayers(new Set(C.LAYERS)));
  panel.appendChild(all);
  panel.appendChild(el('p', { class: 'layers-note' }, 'Hiding a layer only changes the drawing. The quote, CSV and whole-job print still include every fitting. Sketches and notes are shared by all layers and always show.'));
  const target = focusKey && panel.querySelector(`[data-key="${focusKey}"]`);
  if (target && !target.disabled) target.focus({ preventScroll: true });
  else if (focusKey) btn.focus({ preventScroll: true });
}

// ---- Tabs, quote bar, inspector ----------------------------------------------
function renderTabs() {
  const tabs = $('#view-tabs');
  tabs.innerHTML = '';
  if (!job) return;
  // With a layer filter on, counts read "shown/total" so hidden fittings stay obvious.
  const filtered = !allShown();
  const count = (list) => {
    const shown = list.filter(isShown).length;
    return { text: filtered ? `${shown}/${list.length}` : String(list.length), title: filtered ? `${shown} of ${list.length} fittings shown` : '' };
  };
  const ceilItems = job.items.filter(i => i.wall === C.CEILING);
  const defs = ['PLAN', 'A', 'B', 'C', 'D'].map(v => {
    // wall tabs count fittings mounted on that wall only; downlights are
    // ceiling fittings (shown in plan and as projection ticks on wall views)
    const c = count(v === 'PLAN' ? job.items : job.items.filter(i => i.wall === v));
    return { v, label: v === 'PLAN' ? `Plan (${c.text})` : `Wall ${v} (${c.text})`, title: c.title };
  });
  if (ceilItems.length) defs.push({ v: null, label: `Ceiling fittings: ${count(ceilItems).text} (plan only)`, info: true });
  for (const d of defs) {
    if (d.info) {
      tabs.appendChild(el('span', { class: 'tabs-info', style: 'align-self:center;font-size:13px;color:#555;padding:0 6px' }, d.label));
      continue;
    }
    const b = el('button', { 'data-view': d.v, 'data-testid': `tab-${d.v}`, class: view === d.v ? 'active' : '' }, d.label);
    if (d.title) b.title = d.title;
    b.addEventListener('click', () => {
      view = d.v;
      // a copied downlight can only go on the ceiling in the plan view
      if (copyTpl && copyTpl.type === 'downlight' && view !== 'PLAN' && endCopy()) toast('Stopped placing copies. Downlights can only be copied in the plan view.');
      renderAll();
    });
    tabs.appendChild(b);
  }
}

function renderQuote() {
  const bd = C.breakdown(job);
  const bar = $('#quote-bar');
  bar.classList.toggle('incomplete', !bd.complete);
  const sum = $('#quote-summary');
  sum.innerHTML = '';
  if (!job.items.length) { sum.textContent = 'No fittings yet.'; return; }
  const pricedQty = bd.rows.filter(r => r.status === 'priced').reduce((s, r) => s + r.qty, 0);
  // Phones hide the q-count/q-priced/q-existing/q-detail/q-long parts (see
  // style.css) so the bar stays short; the text content is the same everywhere.
  const chip = (txt, cls) => { const s = el('span', { class: `q-chip ${cls}` }, txt); s.style.whiteSpace = 'nowrap'; return s; };
  sum.append(
    chip(`${job.items.length} fittings`, 'q-count'),
    chip(`${pricedQty} priced`, 'q-priced'),
  );
  if (bd.unpricedCount) {
    // name exactly what needs a price: unpriced work types and unknown fitting IDs
    const missing = [
      ...bd.rows.filter(r => r.status === 'unpriced').map(r => r.label.toLowerCase()),
      ...job.items.filter(i => i.type === 'unknown').map(i => i.id),
    ];
    // The warning itself is the first tap of the fix route: it opens the
    // prices-missing sheet, whose Edit rates / Show F.. buttons are the second.
    const warn = el('button', { class: 'q-chip q-warn', 'data-testid': 'price-warning', title: 'Open what needs a price' });
    warn.style.whiteSpace = 'nowrap';
    warn.append(
      el('span', { 'aria-hidden': 'true' }, '⚠ '),
      C.unpricedPhrase(bd.unpricedCount),
      el('span', { class: 'q-detail' }, ` (${missing.join(', ')})`),
    );
    warn.addEventListener('click', openPriceWarnings);
    sum.append(warn);
  }
  const total = chip(bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `${C.formatPence(bd.totalPence)} so far`, 'q-total');
  if (!bd.complete) total.append(el('span', { class: 'q-long' }, ' — total incomplete'));
  sum.append(total);
  if (!allShown()) sum.append(chip('Quote covers all layers', 'q-scope'));
  if (bd.existingQty) sum.append(chip(`${bd.existingQty} existing not counted`, 'q-existing'));
}

// Phones: a bottom sheet that shrinks to its header. Tablet and desktop: a right
// drawer that shrinks to a narrow strip holding only this button (style.css).
function inspectorToggle() {
  const toggle = el('button', { id: 'btn-inspector-toggle', class: 'inspector-toggle', 'aria-expanded': String(!inspectorCollapsed) }, inspectorCollapsed ? 'Show details' : 'Hide details');
  toggle.addEventListener('click', () => {
    // "Set height for several": the collapsed tablet/desktop strip hides the
    // heading and clips the controls, so keep the drawer open while choosing.
    if (!inspectorCollapsed && multiIds && !PHONE.matches) {
      toast('Details stay open while setting several heights — Cancel or Apply first.');
      return;
    }
    inspectorCollapsed = !inspectorCollapsed;
    // phones share the screen between the two panels: expanding details closes Layers
    if (!inspectorCollapsed && PHONE.matches) layersOpen = false;
    renderAll();
    $('#inspector').scrollTop = 0;
    // the panel is rebuilt, so hand focus to the new toggle
    const next = $('#btn-inspector-toggle');
    if (next) next.focus({ preventScroll: true });
  });
  return toggle;
}

function inspectorRoomPanel() {
  const box = $('#inspector');
  box.innerHTML = '';
  const title = el('h2', {}, 'Room');
  const toggle = inspectorToggle();
  const head = el('div', { class: 'inspector-head' });
  head.append(title, toggle);
  box.appendChild(head);
  if (inspectorCollapsed) return;
  box.appendChild(el('p', { class: 'job-title' }, `${job.name}`));
  if (job.room && job.room.widthM) {
    box.appendChild(el('p', {}, `${job.room.widthM.toFixed(2)} × ${job.room.depthM.toFixed(2)} × ${job.room.heightM.toFixed(2)} m (w × d × h)`));
  }
  const sizeBtn = el('button', { 'data-testid': 'room-size', class: 'btn-primary' }, 'Room size');
  sizeBtn.addEventListener('click', openRoomForm);
  box.appendChild(sizeBtn);
  const multiBtn = el('button', { 'data-testid': 'multi-start-room' }, 'Set height for several');
  multiBtn.addEventListener('click', () => startMulti());
  box.appendChild(multiBtn);
  box.appendChild(el('label', {}, 'Job notes'));
  const ta = el('textarea', { 'data-testid': 'job-notes' });
  ta.value = job.jobNotes;
  box.appendChild(ta);
  // Drafts: valid text commits after a short typing pause (and on pagehide),
  // one undo step per typing session, keyed to the job itself.
  ta.addEventListener('input', () => {
    const value = ta.value.slice(0, 5000);
    setDraft({ key: 'job:jobNotes', target: { kind: 'job', field: 'jobNotes' }, value, valid: true, dirty: value !== job.jobNotes, elem: ta });
  });
  ta.addEventListener('change', () => flushDraft());
  const bd = C.breakdown(job);
  const pricedQty = bd.rows.filter(r => r.status === 'priced').reduce((s, r) => s + r.qty, 0);
  const counts = el('p', { class: 'count-line' });
  const cnt = (t) => { const s = el('span', { class: 'q-chip' }, t); s.style.whiteSpace = 'nowrap'; return s; };
  counts.append(cnt(`${job.items.length} fittings`), cnt(`${pricedQty} priced`), cnt(C.unpricedPhrase(bd.unpricedCount)), cnt(`${bd.existingQty} existing not counted`));
  box.appendChild(counts);
  const lc = C.layerCounts(job);
  const layerLine = el('p', { class: 'count-line', 'data-testid': 'layer-counts' });
  for (const l of C.LAYERS) layerLine.append(cnt(`${C.LAYER_LABELS[l]} ${lc[l]}${shownLayers.has(l) ? '' : ' (hidden)'}`));
  box.append(el('label', {}, 'Fittings by layer'), layerLine);
  const ratesBtn = el('button', { 'data-testid': 'rates-open' }, 'Rates for this job');
  ratesBtn.addEventListener('click', openRates);
  box.appendChild(ratesBtn);
  // symbol legend so every ID label on the drawings is readable
  box.appendChild(el('label', {}, 'Fitting symbols'));
  const legend = el('ul', { class: 'legend' });
  for (const t of Object.values(C.TYPES)) {
    legend.appendChild(el('li', {}, `${t.symbol} = ${t.label}`));
  }
  legend.appendChild(el('li', {}, 'F1, F2… are fitting numbers. The letters after the dot are the fitting type.'));
  legend.appendChild(el('li', {}, 'Dashed circles are ceiling fittings (plan view only)'));
  legend.appendChild(el('li', {}, 'Use “Layers” above the drawing to show lighting, sockets & spurs or three-phase on their own or together.'));
  box.appendChild(legend);
}

// "Set height for several" panel: count, removable rows, current-height summary,
// one height field (kept in multiDraft across rebuilds), Apply and Cancel.
function inspectorMultiPanel() {
  const box = $('#inspector');
  box.innerHTML = '';
  const n = multiIds.length;
  const toggle = inspectorToggle();
  const headCancel = el('button', { class: 'inspector-toggle', 'data-testid': 'multi-cancel-head' }, 'Cancel');
  headCancel.addEventListener('click', () => { endMulti(); renderAll(); });
  const head = el('div', { class: 'inspector-head multi-head' });
  const countChip = el('span', { class: 'multi-count', 'data-testid': 'multi-count' }, n ? `${n} selected` : 'none selected');
  head.append(el('h2', { 'data-testid': 'multi-title' }, 'Set one height'), countChip, toggle, headCancel);
  box.appendChild(head);
  if (inspectorCollapsed) return; // phone sheet: the count and Cancel stay visible in the header

  box.appendChild(el('p', { class: 'field-note' }, 'Tap fittings on the drawing to add or remove them. Ceiling fittings can’t be added.'));

  const list = el('div', { class: 'multi-list', 'data-testid': 'multi-list' });
  for (const id of multiIds) {
    const it = job.items.find(i => i.id === id);
    const sym = it && C.TYPES[it.type] ? C.TYPES[it.type].symbol : '?';
    const wall = it && it.wall !== C.CEILING ? `Wall ${it.wall}` : '—';
    const h = it ? it.heightMm : '?';
    const row = el('div', { class: 'multi-row' });
    row.appendChild(el('span', { class: 'multi-row-label' }, `${id} · ${sym} · ${wall} · ${h} mm`));
    const rm = el('button', { 'aria-label': `Remove ${id} from selection`, 'data-testid': `multi-remove-${id}` }, 'Remove');
    rm.addEventListener('click', () => { multiIds = multiIds.filter(x => x !== id); renderAll(); });
    row.appendChild(rm);
    list.appendChild(row);
  }
  box.appendChild(list);

  const groups = C.heightGroups(job, multiIds);
  if (groups.length === 1) box.appendChild(el('p', { class: 'count-line', 'data-testid': 'multi-heights' }, `Current height: ${groups[0].heightMm} mm for all`));
  else if (groups.length > 1) box.appendChild(el('p', { class: 'count-line', 'data-testid': 'multi-heights' }, `Current heights are mixed: ${groups.map(g => `${g.heightMm} mm ×${g.count}`).join(', ')}`));

  const max = C.ceilingHeightMm(job.room);
  const errP = el('p', { class: 'field-err', 'data-testid': 'multi-err' }); errP.hidden = true;
  const applyBtn = el('button', { class: 'btn-primary multi-apply', 'data-testid': 'multi-apply' }, `Apply to ${n} fitting${n === 1 ? '' : 's'}`);
  applyBtn.disabled = true;

  box.appendChild(el('label', { for: 'multi-height' }, 'New height to centre (mm)'));
  const input = el('input', { type: 'number', inputmode: 'numeric', step: '10', id: 'multi-height', 'data-testid': 'multi-height', placeholder: 'e.g. 450' });
  input.value = multiDraft; // typed text survives every rebuild
  box.appendChild(input);
  box.appendChild(errP);
  box.appendChild(el('p', { class: 'field-note' }, 'Only the height changes. Position along the wall, type, layer and price stay the same.'));

  // Checks the RAW text before rounding; never clamps silently. Runs in place —
  // a renderAll here would wipe the typed text and close the keyboard.
  const validateDraft = (dirty) => {
    const raw = input.value.trim();
    multiDraft = input.value;
    if (!n) { applyBtn.disabled = true; if (dirty) { errP.textContent = 'Select at least one fitting first.'; errP.hidden = false; } return null; }
    if (raw === '') { applyBtn.disabled = true; errP.hidden = !dirty; if (dirty) errP.textContent = `Enter a height from 0 to ${max} mm.`; return null; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) {
      applyBtn.disabled = true; errP.hidden = false;
      errP.textContent = max ? `Enter a height from 0 to ${max} mm.` : 'Set the room size first.';
      return null;
    }
    errP.hidden = true; applyBtn.disabled = false; return v;
  };
  input.addEventListener('input', () => validateDraft(true));
  validateDraft(false);

  const doApply = () => {
    if (!multiIds.length) { errP.textContent = 'Select at least one fitting first.'; errP.hidden = false; return; }
    const v = validateDraft(true);
    if (v === null) return;
    const h = Math.round(v);
    if (multiIds.every(id => job.items.find(i => i.id === id)?.heightMm === h)) {
      toast(`All ${multiIds.length} are already at ${h} mm. Nothing changed.`);
      return; // no commit, no undo entry
    }
    let res = null;
    commit(() => { res = C.setWallHeights(job, multiIds, h); }); // throws before changing anything on a stale ID
    if (!res) return; // commit already toasted the failure; job untouched
    const { heightMm, count } = res;
    for (const id of multiIds) {
      const it = job.items.find(i => i.id === id);
      if (it) rememberHeight(it.type, it.wall, heightMm);
    }
    multiIds = null; multiDraft = ''; // leave multi mode and clear the selection before the final render
    renderAll();
    toast(`Height set to ${heightMm} mm on ${count} fitting${count === 1 ? '' : 's'} · Undo`);
  };
  applyBtn.addEventListener('click', doApply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doApply(); } });
  box.appendChild(applyBtn);
  const cancelBtn = el('button', { class: 'multi-cancel-btn', 'data-testid': 'multi-cancel' }, 'Cancel');
  cancelBtn.addEventListener('click', () => { endMulti(); renderAll(); });
  box.appendChild(cancelBtn);
}

function renderInspector() {
  document.body.classList.toggle('inspector-collapsed', inspectorCollapsed);
  if (multiIds) { inspectorMultiPanel(); return; }
  const item = job.items.find(i => i.id === selectedId);
  if (!item) { inspectorRoomPanel(); return; }
  const box = $('#inspector');
  box.innerHTML = '';
  const toggle = inspectorToggle();
  const done = el('button', { class: 'inspector-toggle inspector-done' }, 'Done');
  done.addEventListener('click', () => { selectedId = null; renderAll(); });
  const head = el('div', { class: 'inspector-head' });
  head.append(el('h2', {}, `${item.id} · ${C.TYPES[item.type].label}`), toggle, done);
  box.appendChild(head);
  if (inspectorCollapsed) return;

  const like = el('button', { class: 'place-like-btn', 'data-testid': 'ins-place-like' }, 'Place like this');
  like.addEventListener('click', () => startCopy(item));
  box.appendChild(like);
  box.appendChild(el('p', { class: 'field-note' }, item.wall === C.CEILING
    ? 'Each tap adds a copy with the same type and layer where you tap. Notes start blank.'
    : 'Each tap adds a copy with the same type, height and layer. Notes start blank.'));

  const label = (txt) => box.appendChild(el('label', {}, txt));
  const typeSel = el('select', { 'data-testid': 'ins-type' });
  for (const [k, t] of Object.entries(C.TYPES)) typeSel.appendChild(el('option', { value: k }, t.label));
  typeSel.value = item.type;
  label('Type');
  box.appendChild(typeSel);
  typeSel.addEventListener('change', () => {
    let revealed = null;
    commit(() => { C.setItemType(job, item.id, typeSel.value); revealed = revealLayerOf(item.id); });
    if (revealed) toast(`${revealed} layer shown so ${item.id} stays visible`);
  });

  // Layer: automatic follows the type; an explicit choice is kept until the type changes.
  const def = C.defaultLayerFor(item.type);
  const layerSel = el('select', { 'data-testid': 'ins-layer' });
  layerSel.appendChild(el('option', { value: '' }, `Automatic (${C.LAYER_LABELS[def]})`));
  for (const l of C.LAYERS) if (l !== def) layerSel.appendChild(el('option', { value: l }, C.LAYER_LABELS[l]));
  layerSel.value = C.isLayer(item.layer) && item.layer !== def ? item.layer : '';
  label('Layer');
  box.appendChild(layerSel);
  box.appendChild(el('p', { class: 'field-note' }, 'The layer only changes what’s shown. The price follows the type. Changing the type sets this back to automatic.'));
  layerSel.addEventListener('change', () => {
    let revealed = null;
    commit(() => { C.setItemLayer(job, item.id, layerSel.value || null); revealed = revealLayerOf(item.id); });
    if (revealed) toast(`${revealed} layer shown so ${item.id} stays visible`);
  });

  const wallSel = el('select', { 'data-testid': 'ins-wall' });
  if (item.type === 'downlight') {
    wallSel.appendChild(el('option', { value: C.CEILING }, 'Ceiling'));
  } else {
    for (const w of C.WALLS) wallSel.appendChild(el('option', { value: w }, `Wall ${w}`));
  }
  wallSel.value = item.wall;
  label('Wall');
  box.appendChild(wallSel);
  wallSel.addEventListener('change', () => commit(() => { item.wall = wallSel.value; C.clampItem(job, item); }));

  const mkNum = (idAttr, text, key) => {
    label(text);
    const row = el('div', { class: 'field-row' });
    const input = el('input', { type: 'number', inputmode: 'numeric', 'data-testid': idAttr, step: '10' });
    input.value = item[key];
    const minus = el('button', {}, '−50');
    const plus = el('button', {}, '+50');
    const errP = el('p', { class: 'field-err' }); errP.hidden = true;
    const max = () => key === 'fromLeftMm' ? C.maxFromLeft(job, item) : C.maxHeight(job, item);
    const read = () => {
      const m = max();
      const raw = input.value.trim();
      if (raw === '') return { valid: false, value: null };
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > m) return { valid: false, value: null };
      return { valid: true, value: Math.round(v) };
    };
    // Live draft: valid numbers commit after a short typing pause (and on
    // pagehide); invalid, PARTIAL (e.g. "12-") or EMPTY input never reaches
    // the job or storage — and every refused state shows visible guidance,
    // so the chip's "fix the highlighted number" always has something
    // highlighted.
    input.addEventListener('input', () => {
      const r = read();
      if (!r.valid) {
        errP.textContent = key === 'fromLeftMm'
          ? `Enter a number from 0 to ${max().toLocaleString('en-GB')} mm along this wall.`
          : `Enter a number from 0 to ${max().toLocaleString('en-GB')} mm.`;
        errP.hidden = false;
      } else errP.hidden = true;
      setDraft({
        key: `item:${item.id}:${key}`,
        target: { kind: 'item', id: item.id, field: key },
        value: r.value, valid: r.valid,
        dirty: input.value !== String(item[key]),
        elem: input,
      });
    });
    input.addEventListener('change', () => {
      flushDraft();
      // Re-check the FIELD itself, not the draft: the 500 ms debounce may
      // already have consumed the invalid draft, and the field must never
      // keep displaying a value the job refused.
      if (!read().valid) {
        errP.hidden = false;
        refusedNumber = { text: text.toLowerCase(), value: input.value };
        input.value = item[key];
        draft = null; // the refused value is resolved together with its field
        saveNow(); // the chip returns to the honest stored state
      }
    });
    const bump = (delta) => {
      flushDraft(); // apply what was typed before bumping from it
      const v = item[key] + delta;
      const m = max();
      if (!(Number.isFinite(v) && v >= 0 && v <= m)) {
        errP.textContent = key === 'fromLeftMm'
          ? `Enter 0–${m.toLocaleString('en-GB')} mm along this wall.`
          : `Enter 0–${m.toLocaleString('en-GB')} mm.`;
        errP.hidden = false; input.value = item[key]; return;
      }
      errP.hidden = true;
      commit(() => { item[key] = v; });
    };
    minus.addEventListener('click', () => bump(-50));
    plus.addEventListener('click', () => bump(50));
    row.append(input, minus, plus);
    box.append(row, errP);
  };
  const ceiling = item.wall === C.CEILING;
  mkNum('ins-fromleft', ceiling ? 'Across width (mm)' : 'From left end of wall (mm)', 'fromLeftMm');
  mkNum('ins-height', ceiling ? 'Across depth (mm)' : 'Height to centre (mm)', 'heightMm');
  if (!ceiling) {
    const multiBtn = el('button', { 'data-testid': 'multi-start-fitting' }, 'Set height for several');
    multiBtn.addEventListener('click', () => startMulti(item.id));
    box.appendChild(multiBtn);
  }

  label('Notes');
  const ta = el('textarea', { 'data-testid': 'ins-notes' });
  ta.value = item.notes;
  box.appendChild(ta);
  // Draft keyed to this fitting's id: switching selection or jobs while the
  // debounce is pending can never apply the text to the wrong target.
  ta.addEventListener('input', () => {
    const value = ta.value.slice(0, C.LIMITS.maxTextLen);
    setDraft({ key: `item:${item.id}:notes`, target: { kind: 'item', id: item.id, field: 'notes' }, value, valid: true, dirty: value !== item.notes, elem: ta });
  });
  ta.addEventListener('change', () => flushDraft());

  const price = el('p', { class: 'price-line', 'data-testid': 'price-line' });
  if (item.type === 'existing') price.textContent = 'Existing — no work, not counted on any layer';
  else if (item.type === 'unknown') price.textContent = 'Unknown — needs a price before quoting';
  else {
    const rate = C.rateFor(job, item.type);
    price.textContent = rate === null ? '⚠ No rate set — shown as unpriced' : `Priced as ${C.TYPES[item.type].label} · ${C.formatPence(rate)}`;
  }
  box.appendChild(price);

  const del = el('button', { class: 'btn-danger', 'data-testid': 'delete-fitting' }, 'Delete fitting');
  del.addEventListener('click', () => {
    const id = item.id;
    commit(() => { job.items = job.items.filter(i => i.id !== id); });
    selectedId = null;
    toast(`${id} deleted · Undo`);
  });
  box.appendChild(del);
}

function updateHistoryButtons() {
  $('#btn-undo').disabled = !history.length;
  $('#btn-redo').disabled = !redoStack.length;
  // QA-readable depth: how many undo/redo steps are stacked right now
  $('#btn-undo').dataset.history = String(history.length);
  $('#btn-redo').dataset.history = String(redoStack.length);
}

function renderAll() {
  if (!job) return;
  pruneMulti();
  updateHistoryButtons();
  $('#sample-chip').hidden = !job.sample;
  $('#btn-job-name').textContent = job.name;
  $('#btn-job-name').setAttribute('aria-label', `Jobs. Open now: ${job.name}`);
  // A hidden fitting can't stay selected: it could be moved or deleted unseen.
  const sel = job.items.find(i => i.id === selectedId);
  if (!sel || !isShown(sel)) selectedId = null;
  // Tablet/desktop (layout A): picking a different fitting unfolds its details.
  // Phones keep the folded sheet header so the drawing stays tappable, and Place
  // mode never resizes the drawing between taps.
  // Not while a pointer is still down on the fitting: unfolding resizes the
  // drawing mid-gesture and the drag would land far from the finger. The lift's
  // renderAll unfolds it instead.
  if (!dragFitting) {
    if (selectedId && selectedId !== lastDetailsId && mode === 'select' && !PHONE.matches && !multiIds) inspectorCollapsed = false;
    lastDetailsId = selectedId;
  }
  // A rebuild of the same panel (a save, a layer change) keeps the reader's
  // scroll position; a different panel starts at the top.
  const insBox = $('#inspector');
  const insKey = `${currentId}|${selectedId}|${multiIds ? 'multi' : ''}|${inspectorCollapsed}`;
  const keepTop = insKey === lastInspectorKey ? insBox.scrollTop : 0;
  lastInspectorKey = insKey;
  renderTabs(); renderLayers(); renderCanvas(); renderInspector(); renderQuote();
  if (keepTop) insBox.scrollTop = keepTop;
  syncFooterHeight();
}

// Portrait layout: the quote bar (total + breakdown) must stay visible ABOVE the
// inspector bottom sheet. Its height varies when the chips wrap, so measure it
// and expose the real height to CSS for the sheet's scroll clearance.
function syncFooterHeight() {
  const bar = $('#quote-bar');
  if (bar) document.documentElement.style.setProperty('--footer-h', (bar.offsetHeight + 2) + 'px');
  // the floating tool dock (layout A) starts below the view tabs, which wrap
  const tabs = $('#view-tabs');
  if (tabs) document.documentElement.style.setProperty('--tabs-h', tabs.offsetHeight + 'px');
}
window.addEventListener('resize', syncFooterHeight);
// Crossing the phone breakpoint (resize, or a small tablet rotating) resets the
// details panel to the layout A default: folded, drawing first.
const onPhoneChange = () => { inspectorCollapsed = true; renderAll(); };
if (PHONE.addEventListener) PHONE.addEventListener('change', onPhoneChange);
else PHONE.addListener(onPhoneChange);

// ---- Room size form -----------------------------------------------------------
function openRoomForm() {
  const box = el('div');
  const fields = {};
  const initial = {};
  const mk = (key, labelTxt, max) => {
    box.appendChild(el('label', {}, labelTxt));
    const i = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0.1', max: String(max), 'data-testid': `room-${key}` });
    i.value = job.room[key] ?? '';
    initial[key] = i.value;
    box.appendChild(i);
    fields[key] = { input: i, max };
  };
  mk('widthM', 'Width (m)', C.LIMITS.maxWallM);
  mk('depthM', 'Depth (m)', C.LIMITS.maxWallM);
  mk('heightM', 'Height (m)', C.LIMITS.maxHeightM);
  const errP = el('p', { class: 'field-err' }); errP.hidden = true; box.appendChild(errP);
  const isEdited = () => ['widthM', 'depthM', 'heightM'].some(k => fields[k].input.value !== initial[k]);
  guardedForm('Room size', [box], [
    { label: 'Cancel', fn: closeModal },
    {
      label: 'Save', class: 'btn-primary', testid: 'room-save', fn: () => {
        const vals = {};
        for (const k of ['widthM', 'depthM', 'heightM']) {
          const v = Number(fields[k].input.value);
          const max = k === 'heightM' ? C.LIMITS.maxHeightM : C.LIMITS.maxWallM;
          if (!(v >= 0.1 && v <= max)) {
            errP.hidden = false;
            errP.textContent = `Enter a ${k === 'heightM' ? 'height' : k.replace('M', '')} between 0.10 m and ${max} m.`;
            return;
          }
          vals[k] = Math.round(v * 100) / 100;
        }
        const outside = C.itemsOutside(job, vals.widthM, vals.depthM, vals.heightM);
        if (outside.length) { closeModal(); askShrink(vals, outside); return; }
        commit(() => { job.room = vals; });
        closeModal();
      },
    },
  ], isEdited, 'You have edited the room size.');
}
function askShrink(vals, outside) {
  modal(`${outside.length} fitting${outside.length > 1 ? 's' : ''} would sit outside the new size`,
    [el('p', {}, `${outside.map(i => i.id).join(', ')} fall outside a ${vals.widthM.toFixed(2)} × ${vals.depthM.toFixed(2)} × ${vals.heightM.toFixed(2)} m room.`)],
    [
      { label: 'Cancel', fn: closeModal },
      {
        label: 'Move them to the nearest edge', class: 'btn-primary', testid: 'shrink-move', fn: () => {
          commit(() => { job.room = vals; C.moveOutsideItemsToEdge(job, vals.widthM, vals.depthM, vals.heightM); });
          closeModal(); toast('Kept inside the room');
        },
      },
    ]);
}

// ---- Rates -----------------------------------------------------------------
function openRates() {
  const box = el('div');
  box.appendChild(el('p', {}, 'These rates are saved with this job. Changing them reprices this job only.'));
  box.appendChild(el('p', { style: 'font-size:14px' }, 'Fused spur and three-phase point have no example rate. Add your own price, or leave them blank and they’ll show as needing a price.'));
  const inputs = {};
  const initial = {};
  for (const k of C.RATE_KEYS) {
    const row = el('div', { class: 'rate-input-row' });
    row.appendChild(el('span', {}, C.TYPES[k].label));
    const i = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0.01', 'data-testid': `rate-${k}` });
    i.value = C.rateFor(job, k) === null ? '' : (C.rateFor(job, k) / 100).toFixed(2);
    initial[k] = i.value;
    i.placeholder = 'unpriced';
    row.appendChild(i);
    inputs[k] = i;
    box.appendChild(row);
  }
  const errP = el('p', { class: 'field-err' }); errP.hidden = true; box.appendChild(errP);
  box.appendChild(el('p', { class: 'field-err' }, 'Leave blank to mark a type unpriced. Enter a price above £0, or leave blank.'));
  const isEdited = () => C.RATE_KEYS.some(k => inputs[k].value !== initial[k]);
  guardedForm('Rates for this job', [box], [
    { label: 'Cancel', fn: closeModal },
    {
      label: 'Save rates', class: 'btn-primary', testid: 'rates-save', fn: () => {
        const next = { ...job.rates };
        for (const k of C.RATE_KEYS) {
          const raw = inputs[k].value.trim();
          if (raw === '') { next[k] = null; continue; }
          const p = Math.round(Number(raw) * 100);
          if (!Number.isFinite(p) || p <= 0) {
            errP.hidden = false;
            errP.textContent = `${C.TYPES[k].label}: enter a price above £0, or leave blank to mark unpriced.`;
            return;
          }
          next[k] = p;
        }
        commit(() => { job.rates = next; });
        closeModal();
      },
    },
  ], isEdited, 'You have edited the rates for this job.');
}

// ---- Breakdown drawer ---------------------------------------------------------
// The quote-bar warning opens this sheet: one tap from the warning, and its
// Edit rates / Show F.. buttons are the second tap to the relevant edit. It
// reuses the existing Rates form and fitting inspector — no duplicate controls.
function openPriceWarnings() {
  const bd = C.breakdown(job);
  const unpricedRows = bd.rows.filter(r => r.status === 'unpriced');
  const unknowns = job.items.filter(i => i.type === 'unknown');
  if (bd.complete) { toast('Every fitting has a price — nothing to fix.'); return; }
  const box = el('div');
  box.appendChild(el('p', {}, `${C.unpricedPhrase(bd.unpricedCount)} before the total is complete:`));
  const list = el('ul', { class: 'legend', 'data-testid': 'price-warning-list' });
  for (const r of unpricedRows) {
    list.appendChild(el('li', {}, `${r.qty} × ${r.label} — no rate set. Edit rates to price ${r.qty === 1 ? 'it' : 'them'}.`));
  }
  for (const u of unknowns) {
    list.appendChild(el('li', {}, `${u.id} is an unknown fitting — no work type, so no rate can price it. Show it to name its type or remove it.`));
  }
  box.appendChild(list);
  const actions = unknowns.map(u => ({
    label: `Show ${u.id}`, testid: `warn-show-${u.id}`, fn: () => { closeModal(); revealUnknownFitting(u.id); },
  }));
  actions.push(
    { label: 'Edit rates', class: 'btn-primary', testid: 'warn-edit-rates', fn: () => { closeModal(); openRates(); } },
    { label: 'Close', fn: closeModal },
  );
  modal('Prices still missing', [box], actions);
}

// Select an unknown fitting and bring the user to it: show its layer if
// hidden, switch to a view it is drawn on, and expand the details panel with
// its type selector ready. No job change — pure view/selection state.
function revealUnknownFitting(id) {
  const it = job.items.find(i => i.id === id);
  if (!it) { toast(`${id} is no longer in the job`); return; }
  if (!isShown(it)) {
    shownLayers.add(C.layerOf(it));
    toast(`${C.LAYER_LABELS[C.layerOf(it)]} layer shown so ${id} stays visible`);
  }
  selectedId = id;
  if (it.wall === C.CEILING) view = 'PLAN';
  else if (view !== 'PLAN' && view !== it.wall) view = it.wall;
  if (multiIds) endMulti();
  if (mode !== 'select') setMode('select');
  inspectorCollapsed = false; // the type selector is the edit the route promises
  if (PHONE.matches) layersOpen = false; // same phone panel-share rule as the toggle
  renderAll();
  $('#inspector').scrollTop = 0;
}

function openBreakdown() {
  const bd = C.breakdown(job);
  const box = el('div');
  const table = el('table');
  const head = el('tr');
  for (const h of ['Work type', 'Qty', 'Rate', 'Line total']) head.appendChild(el('th', {}, h));
  table.appendChild(head);
  for (const r of bd.rows) {
    const tr = el('tr', { class: r.status === 'unpriced' ? 'unpriced' : '' });
    tr.append(
      el('td', {}, r.label), el('td', {}, String(r.qty)),
      el('td', {}, r.ratePence === null ? '—' : C.formatPence(r.ratePence)),
      el('td', {}, r.linePence === null ? '⚠ No rate — not included in total' : C.formatPence(r.linePence)),
    );
    table.appendChild(tr);
  }
  if (bd.unknownQty) {
    const tr = el('tr', { class: 'unpriced' });
    tr.append(el('td', {}, C.TYPES.unknown.label), el('td', {}, String(bd.unknownQty)), el('td', {}, '—'), el('td', {}, '⚠ Unknown — needs a price'));
    table.appendChild(tr);
  }
  if (bd.existingQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.existing.label), el('td', {}, String(bd.existingQty)), el('td', {}, '—'), el('td', {}, 'No work, not counted'));
    table.appendChild(tr);
  }
  box.appendChild(table);
  box.appendChild(el('p', {}, bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `Total so far ${C.formatPence(bd.totalPence)} — incomplete, ${C.unpricedPhrase(bd.unpricedCount)}`));
  box.appendChild(el('p', { style: 'font-size:14px', 'data-testid': 'breakdown-scope' }, 'Whole job, all layers. Hiding layers on screen doesn’t change this.'));
  box.appendChild(el('p', { style: 'font-size:13px' }, 'Example labour rates only. Not a quotation or installation advice.'));
  modal('Labour breakdown', [box], [
    { label: 'Edit rates', testid: 'breakdown-edit-rates', fn: () => { closeModal(); openRates(); } },
    { label: 'Close', class: 'btn-primary', fn: closeModal },
  ]);
}

// ---- Exports ------------------------------------------------------------------
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function jobSlug() { return job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job'; }
function stamp() { const d = new Date(); return `${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; }
function downloadBackup() {
  try {
    const text = C.serialiseJob({ ...job, savedAt: new Date().toISOString() });
    download(`${jobSlug()}-${stamp()}.json`, text, 'application/json');
    toast('Backup downloaded. Keep it somewhere safe — this app doesn’t sync anywhere.');
    return true;
  } catch (err) {
    toast(String(err.message).includes('room')
      ? 'Can’t back up yet — set the room size first.'
      : `Can’t back up yet — ${err.message}`);
    return false;
  }
}
function downloadCsv() { download(`${jobSlug()}-labour.csv`, C.jobCsv(job), 'text/csv'); }

// ---- Print pack -----------------------------------------------------------------
// layers: null prints the whole job (default). A Set of layer ids limits the
// drawing pages and their fitting lists to those layers; the labour page always
// covers the whole job. Either way the job itself is never copied or changed.
function buildPrintPack(includeInk = true, layers = null) {
  const pack = $('#print-pack');
  pack.innerHTML = '';
  const show = layers ? (it) => layers.has(C.layerOf(it)) : () => true;
  const drawScope = layers ? `Drawings: ${C.visibilityLabel(layers)} only` : 'All layers';
  const hiddenLayers = layers ? C.LAYERS.filter(l => !layers.has(l)).map(l => C.LAYER_LABELS[l]) : [];
  const hiddenN = job.items.filter(it => !show(it)).length;
  const dims = roomMm();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const savedStr = job.savedAt ? `saved ${new Date(job.savedAt).toLocaleString('en-GB')}` : 'not yet saved';
  const mkPage = (scope) => {
    const p = el('div', { class: 'page' });
    const h = el('div', { class: 'print-header' });
    h.append(el('strong', {}, `${job.name} — prototype, example rates`), el('span', {}, `${scope} · revision ${job.revision} · ${savedStr} · printed ${dateStr}`));
    p.appendChild(h);
    pack.appendChild(p);
    return p;
  };
  const scopeNote = (page) => {
    if (!layers) return;
    page.appendChild(el('p', { class: 'print-scope' },
      `These drawings show ${C.visibilityLabel(layers)} only. Not drawn: ${hiddenLayers.join(', ')} (${hiddenN} fitting${hiddenN === 1 ? '' : 's'}), still included in the labour breakdown. Sketches are shared by all layers.`));
  };
  const svgFor = (viewName) => {
    const svg = document.createElementNS(NS, 'svg');
    let vbW, vbH;
    const tmpWorld = svgEl('g');
    if (viewName === 'PLAN') {
      vbW = dims.W + 1600; vbH = dims.D + 1600;
      svg.setAttribute('viewBox', `-800 -800 ${vbW} ${vbH}`);
      if (!includeInk) job.annotations.PLAN.forEach(() => { });
      const saved = job.annotations.PLAN; if (!includeInk) job.annotations.PLAN = [];
      renderPlan(tmpWorld, dims, show);
      if (!includeInk) job.annotations.PLAN = saved;
    } else {
      const L = (viewName === 'A' || viewName === 'C') ? dims.W : dims.D;
      vbW = L + 1600; vbH = dims.H + 1600;
      svg.setAttribute('viewBox', `-800 -800 ${vbW} ${vbH}`);
      const saved = job.annotations[viewName]; if (!includeInk) job.annotations[viewName] = [];
      renderWall(tmpWorld, viewName, dims, true, show);
      if (!includeInk) job.annotations[viewName] = saved;
    }
    while (tmpWorld.firstChild) svg.appendChild(tmpWorld.firstChild);
    return svg;
  };
  const itemTable = (items, ceilingCoords = false) => {
    const t = el('table');
    const head = el('tr');
    // ceiling fittings store plan x/y, not a mounting height
    const cols = ceilingCoords ? ['ID', 'Type', 'x (mm)', 'y (mm)', 'Notes'] : ['ID', 'Type', 'From left (mm)', 'Height (mm)', 'Notes'];
    for (const h of cols) head.appendChild(el('th', {}, h));
    t.appendChild(head);
    for (const it of items) {
      const tr = el('tr');
      tr.append(el('td', {}, it.id), el('td', {}, C.TYPES[it.type].label),
        el('td', {}, it.wall === C.CEILING ? `x ${it.fromLeftMm}` : String(it.fromLeftMm)),
        el('td', {}, it.wall === C.CEILING ? `y ${it.heightMm}` : String(it.heightMm)),
        el('td', {}, it.notes || ''));
      t.appendChild(tr);
    }
    return t;
  };

  // Page 1: plan, legend, room, notes
  const p1 = mkPage(drawScope);
  p1.appendChild(el('h2', {}, layers ? `Floor plan — ${C.visibilityLabel(layers)} only` : 'Floor plan — all layers'));
  scopeNote(p1);
  p1.appendChild(svgFor('PLAN'));
  const legend = el('p', { style: 'font-size:9.5pt' });
  legend.textContent = Object.values(C.TYPES).map(t => `${t.symbol} = ${t.label}`).join(' · ') + ' · downlights shown dashed on the ceiling';
  p1.appendChild(legend);
  p1.appendChild(el('h2', {}, 'Room and job notes'));
  p1.appendChild(el('p', {}, `${job.room.widthM.toFixed(2)} × ${job.room.depthM.toFixed(2)} × ${job.room.heightM.toFixed(2)} m (w × d × h)`));
  p1.appendChild(el('p', {}, job.jobNotes || '(no job notes)'));

  // Pages 2–3: two walls per page
  let page = null;
  C.WALLS.forEach((w, idx) => {
    if (idx % 2 === 0) { page = mkPage(drawScope); scopeNote(page); }
    page.appendChild(el('h2', {}, layers ? `Wall ${w} — ${C.visibilityLabel(layers)} only` : `Wall ${w}`));
    page.appendChild(svgFor(w));
    page.appendChild(itemTable(job.items.filter(i => i.wall === w && show(i))));
  });
  // ceiling items table appended to wall D page
  const ceil = job.items.filter(i => i.wall === C.CEILING && show(i));
  if (ceil.length) {
    page.appendChild(el('h2', {}, 'Ceiling fittings'));
    page.appendChild(itemTable(ceil, true));
  }

  // Last page: labour breakdown, always the whole job
  const pL = mkPage('Whole job, all layers');
  pL.appendChild(el('h2', {}, 'Labour breakdown — whole job, all layers'));
  if (layers) pL.appendChild(el('p', { class: 'print-scope' }, `This page covers every fitting on every layer, including the ${hiddenN} not drawn on the earlier pages.`));
  const bd = C.breakdown(job);
  const t = el('table');
  const head = el('tr');
  for (const h of ['Work type', 'Qty', 'Rate', 'Line total', 'Status']) head.appendChild(el('th', {}, h));
  t.appendChild(head);
  for (const r of bd.rows) {
    const tr = el('tr');
    tr.append(el('td', {}, r.label), el('td', {}, String(r.qty)),
      el('td', {}, r.ratePence === null ? '—' : C.formatPence(r.ratePence)),
      el('td', {}, r.linePence === null ? '—' : C.formatPence(r.linePence)),
      el('td', {}, r.status));
    t.appendChild(tr);
  }
  if (bd.unknownQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.unknown.label), el('td', {}, String(bd.unknownQty)), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, 'unpriced'));
    t.appendChild(tr);
  }
  if (bd.existingQty) {
    const tr = el('tr');
    tr.append(el('td', {}, C.TYPES.existing.label), el('td', {}, String(bd.existingQty)), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, 'excluded — no work'));
    t.appendChild(tr);
  }
  pL.appendChild(t);
  pL.appendChild(el('p', {}, bd.complete ? `Total ${C.formatPence(bd.totalPence)}` : `Total so far ${C.formatPence(bd.totalPence)} — incomplete, ${C.unpricedPhrase(bd.unpricedCount)}`));
  pL.appendChild(el('p', { class: 'disclaimer' }, 'Prototype with example labour rates only. Not a quotation, electrical design or installation advice. Cable and material costs are not included.'));
  pL.appendChild(el('p', { class: 'disclaimer' }, 'Tested with simulated pen and touch. Not yet tried on a real Surface; palm rejection unverified.'));

  // page footers
  const pages = pack.querySelectorAll('.page');
  pages.forEach((p, i) => p.appendChild(el('p', { style: 'font-size:9pt;text-align:right' }, `Page ${i + 1} of ${pages.length}`)));
}

function openPrint() {
  const box = el('div');
  box.appendChild(el('p', {}, 'Prints the plan, all four wall views with fittings, and the labour breakdown.'));
  const choice = (value, text, checked, disabled) => {
    const r = el('input', { type: 'radio', name: 'print-scope', value, 'data-testid': `print-scope-${value}` });
    r.checked = checked; r.disabled = disabled;
    const lbl = el('label', { class: 'print-choice' });
    lbl.append(r, el('span', {}, text));
    box.appendChild(lbl);
    return r;
  };
  choice('all', 'Whole job — all layers', true, false);
  const canFilter = !allShown() && shownLayers.size > 0;
  const shownR = choice('shown',
    canFilter
      ? `Drawings: shown layers only (${C.visibilityLabel(shownLayers)})`
      : 'Drawings: shown layers only (hide a layer first to use this)',
    false, !canFilter);
  box.appendChild(el('p', { style: 'font-size:14px' }, 'The labour breakdown always covers the whole job, all layers.'));
  // Snapshot now so the printed pages match what was chosen here.
  const chosen = new Set(shownLayers);
  modal('Print', [box], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Print', class: 'btn-primary', testid: 'print-go', fn: () => {
      const layers = shownR.checked ? chosen : null;
      closeModal();
      // wait for the debounced save first, so the header shows a real saved
      // time (bounded: never blocks printing for more than 2 s)
      const t0 = Date.now();
      const go = () => { printFromDialog = true; buildPrintPack(true, layers); setTimeout(() => window.print(), 50); };
      const tick = () => (job.savedAt || Date.now() - t0 > 2000) ? go() : setTimeout(tick, 100);
      tick();
    } },
  ]);
}

// Printing from the browser's own menu (not the Print dialog) always gets the
// whole job, never a leftover shown-layers pack.
let printFromDialog = false;
window.addEventListener('beforeprint', () => {
  if (!printFromDialog && job && job.room && job.room.widthM) buildPrintPack(true, null);
});
window.addEventListener('afterprint', () => { printFromDialog = false; });

// ---- Menu / start flows -----------------------------------------------------------
function openMenu() {
  const box = el('div');
  // Phones can scroll the status chips out of sight, so repeat them here.
  const status = [$('#save-chip').textContent, $('#offline-chip').textContent, job.sample ? 'Sample job with example data' : 'Example rates only'];
  box.appendChild(el('p', { class: 'menu-status', 'data-testid': 'menu-status', style: 'font-size:14px;margin:0 0 8px' }, status.join(' · ')));
  const items = [
    ...(hasRecovery() ? [['Recover saved data', () => { closeModal(); openRecovery(); }]] : []),
    ['Jobs', () => { closeModal(); openJobsList(); }],
    ['New job', () => { closeModal(); confirmNewJob(); }],
    ['Room size', () => { closeModal(); openRoomForm(); }],
    ['Rates for this job', () => { closeModal(); openRates(); }],
    ['Download backup (JSON)', () => { closeModal(); downloadBackup(); }],
    ['Download all jobs', () => { closeModal(); downloadAllJobs(); }],
    ['Import backup as new job', () => { closeModal(); $('#file-input').click(); }],
    ['Download CSV', () => { closeModal(); downloadCsv(); }],
    ['Print', () => { closeModal(); openPrint(); }],
    ['Try layers demo', () => { closeModal(); confirmLayersDemo(); }],
    ['About this prototype', () => { closeModal(); openAbout(); }],
  ];
  for (const [label, fn] of items) {
    const b = el('button', { style: 'width:100%;margin:4px 0' }, label);
    b.addEventListener('click', fn);
    box.appendChild(b);
  }
  const check = el('div', { class: 'drawing-check', 'data-testid': 'drawing-check', style: 'font-size:13px;margin-top:12px;border-top:1px solid #ccc;padding-top:8px' });
  check.appendChild(el('p', { style: 'margin:0 0 4px;font-weight:600' }, 'Drawing check (for support)'));
  for (const line of drawingCheckLines()) check.appendChild(el('p', { style: 'margin:0' }, line));
  box.appendChild(check);
  modal('Menu', [box], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
}

function openAbout() {
  modal('About this prototype', [
    el('p', {}, 'Your jobs are saved in this browser on this device only. They aren’t sent anywhere and don’t sync. Clearing browser data deletes them, so use Download all jobs to keep a copy.'),
    el('p', {}, 'Example labour rates only. Not a quotation, electrical design or compliance tool.'),
    el('p', {}, 'Tested with simulated pen and touch. Not yet tried on a real Surface, and palm rejection is unverified.'),
  ], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
}

// A new job never replaces the current one. Name and room size come first
// (a job without a room can't be saved), so Cancel creates nothing.
function confirmNewJob() { openNewJobForm(); }
function openNewJobForm() {
  const box = el('div');
  box.appendChild(el('label', {}, 'Job name'));
  const name = el('input', { type: 'text', maxlength: String(C.LIMITS.maxTextLen), 'data-testid': 'newjob-name' });
  name.value = 'Untitled room';
  box.appendChild(name);
  const fields = {};
  for (const [key, labelTxt, max] of [['widthM', 'Width (m)', C.LIMITS.maxWallM], ['depthM', 'Depth (m)', C.LIMITS.maxWallM], ['heightM', 'Height (m)', C.LIMITS.maxHeightM]]) {
    box.appendChild(el('label', {}, labelTxt));
    const i = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0.1', max: String(max), 'data-testid': `room-${key}` });
    box.appendChild(i);
    fields[key] = { input: i, max };
  }
  const errP = el('p', { class: 'field-err' }); errP.hidden = true; box.appendChild(errP);
  const isEdited = () => name.value !== 'Untitled room' || Object.values(fields).some(f => f.input.value !== '');
  guardedForm('New job', [box], [
    { label: 'Cancel', testid: 'newjob-cancel', fn: closeModal },
    {
      label: 'Create job', class: 'btn-primary', testid: 'room-save', fn: () => {
        const vals = {};
        for (const k of ['widthM', 'depthM', 'heightM']) {
          const v = Number(fields[k].input.value);
          if (!(fields[k].input.value !== '' && v >= 0.1 && v <= fields[k].max)) {
            errP.hidden = false;
            errP.textContent = `Enter a ${k === 'heightM' ? 'height' : k.replace('M', '')} between 0.10 m and ${fields[k].max} m.`;
            return;
          }
          vals[k] = Math.round(v * 100) / 100;
        }
        const j = C.blankJob(name.value.trim() || 'Untitled room');
        j.room = vals;
        closeModal();
        startNewJob(j, { kind: 'new' });
      },
    },
  ], isEdited, 'You have started filling in a new job.');
}

function openLayersDemo() {
  startNewJob(C.layersDemoJob(), { kind: 'sample' },
    'Layers demo added as a new job. It’s made up, and the fused spur and three-phase prices are blank on purpose.');
}
function confirmLayersDemo() {
  modal('Try the layers demo', [
    el('p', {}, 'Adds a made-up workshop with lighting, sockets & spurs and three-phase fittings as a new job. Your current job stays as it is.'),
  ], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Open demo', class: 'btn-primary', testid: 'demo-nobackup', fn: () => { closeModal(); openLayersDemo(); } },
  ]);
}

function showStart() {
  const s = jobsApi && jobsApi.safeScan();
  $('#start').hidden = false;
  $('#app').hidden = true;
  $('#start-continue').hidden = !(s && s.jobs.length);
}
function beginJob(j, prefs = null) {
  clearDrafts(); // a pending draft belongs to the job being left, never this one
  clearTimeout(saveTimer);
  refusedNumber = null;
  job = C.normaliseJob(j); history = []; redoStack = []; selectedId = null; view = 'PLAN'; zoom = { s: 1, tx: 0, ty: 0 }; multiIds = null; multiDraft = ''; multiPending = null;
  shownLayers = new Set(C.LAYERS); layersOpen = false;
  // remembered type and heights belong to this job; copy mode never crosses jobs
  jobPrefs = J.cleanPrefs(prefs);
  placeType = jobPrefs.lastType ?? 'surface';
  copyTpl = null;
  buildPalette();
  $('#start').hidden = true; $('#app').hidden = false;
  renderAll();
  if (!job.room.widthM) openRoomForm();
}

// ---- Switching jobs (§4.5) ---------------------------------------------------------
// Leaving a job first commits a valid draft and saves it, and waits for that
// save. An invalid number or a failed save keeps the current job open and says
// why. Undo history and selection never cross jobs (beginJob resets them).
let switchBusy = false;
async function switchJobs(action) {
  if (switchBusy) return false;
  switchBusy = true;
  try {
    if (!(await leaveJob(action))) return false;
    await action();
    return true;
  } finally { switchBusy = false; }
}
async function leaveJob(action) {
  if (!job) return true;
  const d = flushDraft();
  if (d && !d.valid) { refuseSwitch('Fix the highlighted number or undo it before switching.', null, false); return false; }
  if (refusedNumber) {
    // Tapping Menu already took focus from the field, which refused the number
    // and put the saved one back. Say so before leaving, once.
    const n = refusedNumber;
    refusedNumber = null;
    refuseSwitch(`The ${n.text} you typed (${n.value || 'blank'}) isn’t valid, so it wasn’t saved. Fix it before switching, or switch and keep the saved value.`, action, false, 'Switch anyway');
    return false;
  }
  clearTimeout(saveTimer);
  let r = await saveNow();
  // an edit made while that save ran gets its own save before leaving
  if (r.ok && access === 'edit' && contentKey() !== savedCanon) r = await saveNow();
  if (r.ok && access === 'edit' && contentKey() !== savedCanon) r = { ok: false, reason: 'Your latest change is still being saved. Try again in a moment.' };
  if (!r.ok) { refuseSwitch(r.reason, r.canLeave ? action : null, true); return false; }
  return true;
}
function refuseSwitch(reason, discardAction, offerCopy, discardLabel = null) {
  const acts = [
    { label: 'Stay in this job', class: 'btn-primary', testid: 'switch-stay', fn: closeModal },
    { label: 'Download backup', testid: 'switch-download', fn: () => downloadBackup() },
  ];
  if (offerCopy && jobsApi.canWrite) acts.push({ label: 'Save as new job', testid: 'switch-save-new', fn: () => { closeModal(); saveCopyAsNew(); } });
  if (discardAction && discardLabel) {
    // the refused number was never stored: switching keeps the saved value
    acts.push({ label: discardLabel, testid: 'switch-anyway', fn: () => { closeModal(); switchJobs(discardAction); } });
  } else if (discardAction) {
    // Only where this version can never be saved to its record (another tab,
    // no safe storage). A rescue copy is kept in Recover first.
    acts.push({
      label: 'Leave without saving', class: 'btn-danger', testid: 'switch-discard', fn: async () => {
        closeModal();
        const kept = jobsApi.writeRescue({ writerTab: writerTab + 'x' + Date.now().toString(36), jobId: currentId, baseRev: currentId ? lastKnownRev : null, job });
        if (!kept.ok) { confirmDiscardUnkept(kept, discardAction); return; } // stay until the user chooses
        await discardAction();
        toast('Left without saving. A copy of the changes is kept in Menu → Recover saved data.');
      },
    });
  }
  modal('Still in this job', [el('p', { 'data-testid': 'switch-refused' }, reason)], acts);
}
// The copy for Recover couldn't be written: this job stays open unless the
// user explicitly chooses to throw the changes away.
function confirmDiscardUnkept(kept, discardAction) {
  const why = kept.reason === 'rescue-full'
    ? `Recover already holds ${J.MAX_RESCUES} kept copies, so these changes couldn’t be kept.`
    : 'This device’s storage refused, so these changes couldn’t be kept.';
  modal('Changes not kept', [
    el('p', { 'data-testid': 'leave-not-kept' }, `${why} You’re still in this job. Download a backup first, or leave and lose these changes.`),
  ], [
    { label: 'Stay in this job', class: 'btn-primary', testid: 'leave-stay', fn: closeModal },
    { label: 'Download backup', testid: 'leave-download', fn: () => downloadBackup() },
    ...(kept.reason === 'rescue-full' ? [{ label: 'Open Recover', testid: 'leave-recover', fn: () => { closeModal(); openRecovery(); } }] : []),
    {
      label: 'Leave and lose changes', class: 'btn-danger', testid: 'leave-discard-confirm', fn: async () => {
        closeModal();
        await discardAction();
        toast('Left without saving. These changes weren’t kept.');
      },
    },
  ]);
}
function releaseOwner() {
  if (ownerLock) { ownerLock.release(); ownerLock = null; }
}
// Open a stored job. Reads it first (nothing changes if it can't be read),
// then takes edit ownership — or opens it read-only if another tab has it.
async function openRecord(jobId, note = '') {
  const pre = jobsApi.readJob(jobId);
  if (!pre.ok) { toast(pre.reason === 'unreadable' ? 'That job can’t be read. It’s kept as it is, and you can download it from Jobs.' : 'That job couldn’t be opened. Nothing has changed.'); return false; }
  access = 'switching';
  releaseOwner();
  const token = ++openToken;
  let o = null;
  if (lockSupport) o = TEST_HOOKS.noOwnerLock ? { release() {} } : await jobsApi.acquireOwner(jobId);
  if (token !== openToken) { if (o) o.release(); return false; }
  const r = jobsApi.readJob(jobId); // fresh writeRev now that ownership is settled
  if (!r.ok) {
    if (o) o.release();
    job = null; currentId = null;
    showStart();
    toast('That job couldn’t be opened. Nothing has changed.');
    return false;
  }
  beginJob(r.env.job, r.env.prefs);
  currentId = jobId;
  lastKnownRev = r.env.writeRev;
  savedCanon = contentKey();
  accessNote = '';
  ownerLock = o;
  access = !lockSupport ? 'fallback' : (o ? 'edit' : 'other-tab');
  if (lockSupport) jobsApi.writeState(jobId);
  showAccessState();
  if (note) toast(note);
  return true;
}
// A job with no record of its own here (no safe storage, or the list is full).
// storedElsewhere: its content is safe as it is (e.g. the older-version key).
function openInMemory(j, mode, storedElsewhere, note = '') {
  access = 'switching';
  releaseOwner();
  openToken++;
  beginJob(j);
  currentId = null; lastKnownRev = 0; jobPrefs = J.cleanPrefs(null);
  savedCanon = storedElsewhere ? contentKey() : null;
  accessNote = note;
  access = mode;
  showAccessState();
}
function createFailText(r) {
  switch (r.reason) {
    case 'cap': return `This device already holds ${r.count} jobs, the most it can keep (${J.MAX_JOBS}). Nothing was added. Download all jobs to keep a copy.`;
    case 'too-large': return 'This job is too large to store on this device. Nothing was added.';
    case 'lock-timeout': return 'Another tab kept the job list busy. Nothing was added. Try again in a moment.';
    case 'invalid': return `This job can’t be saved (${r.detail}). Nothing was added.`;
    case 'no-locks': return 'This browser can’t safely save jobs on this device. Nothing was added.';
    case 'legacy-changed': return 'The older-version job changed while it was being added. Nothing was added. Try again.';
    case 'unreadable': return 'That copy can’t be read. Nothing was added.';
    case 'readback': return 'This device didn’t give back the job just stored, so it couldn’t be checked. Check Jobs before trying again.';
    default: return 'This device’s storage is full or blocked. Nothing was added.';
  }
}
function jobNotAdded(r) {
  modal('Job not added', [el('p', { 'data-testid': 'create-refused' }, createFailText(r))], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
}
async function startNewJob(j, origin, okMsg = '') {
  await switchJobs(async () => {
    if (!jobsApi.canWrite) { openInMemory(j, 'fallback', false); if (okMsg) toast(okMsg, 5000); return; }
    const r = await jobsApi.create({ job: j, origin, writerTab });
    if (!r.ok) { jobNotAdded(r); return; }
    await openRecord(r.jobId, okMsg);
  });
}
// Same content, new record. The record it came from is never touched.
async function saveCopyAsNew() {
  if (!job || !jobsApi.canWrite) return;
  const d = flushDraft();
  if (d && !d.valid) { toast('Fix the highlighted number or undo it first.'); return; }
  const r = await jobsApi.create({ job: JSON.parse(JSON.stringify(job)), prefs: jobPrefs, origin: { kind: 'new', copyOf: currentId }, writerTab });
  if (!r.ok) { jobNotAdded(r); return; }
  await openRecord(r.jobId, 'Saved as a new job. The other copy wasn’t changed.');
}
function confirmReloadSaved() {
  modal('Reload the saved version?', [
    el('p', {}, 'This replaces what’s on screen with the version saved on this device. Unsaved changes on screen are lost, so download them first if you need them.'),
  ], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Download this version', fn: () => downloadBackup() },
    { label: 'Reload saved version', class: 'btn-danger', testid: 'reload-confirm', fn: async () => { closeModal(); if (currentId) await openRecord(currentId); } },
  ]);
}
async function openRescueAsNew(key) {
  await switchJobs(async () => {
    const r = await jobsApi.promoteRescue({ key, writerTab });
    if (!r.ok) { jobNotAdded(r); return; }
    await openRecord(r.jobId, r.existing
      ? 'These kept changes were already saved in this job, so it was opened. Nothing was added.'
      : 'Opened the kept changes as a new job.');
  });
}

// ---- Jobs list, all-jobs download, older-version offer --------------------------------
function openJobsList() {
  const s = jobsApi && jobsApi.safeScan();
  if (!s) { toast('This device’s storage is blocked, so saved jobs can’t be listed. Nothing has been changed.'); return false; }
  const box = el('div');
  box.appendChild(el('p', { 'data-testid': 'jobs-summary', style: 'font-size:14px' },
    `${s.jobs.length} of ${J.MAX_JOBS} jobs on this device · about ${Math.max(1, Math.round(s.bytes * 2 / 1024))} KB stored`));
  if (!jobsApi.canWrite) box.appendChild(el('p', { class: 'field-err' }, 'This browser can’t safely save jobs here. You can open them and look, but changes aren’t saved.'));
  if (legacyOffer) {
    const row = el('div', { class: 'job-row', 'data-testid': 'jobs-offer' });
    row.appendChild(el('p', {}, `Older-version job found: “${legacyOffer.job.name}”.`));
    const b = el('button', { 'data-testid': 'jobs-offer-accept' }, 'Add it as a new job');
    b.addEventListener('click', acceptLegacyOffer);
    row.appendChild(b);
    box.appendChild(row);
  }
  if (job) {
    const row = el('div', { class: 'job-row', 'data-testid': 'jobs-current' });
    row.appendChild(el('p', {}, `Open now: ${job.name}`));
    const b = el('button', { 'data-testid': 'jobs-rename' }, 'Rename');
    b.addEventListener('click', () => { closeModal(); renameJob(); });
    row.appendChild(b);
    box.appendChild(row);
  }
  for (const j of s.jobs) {
    const row = el('div', { class: 'job-row', 'data-testid': `jobs-row-${j.jobId}` });
    if (j.ok) {
      const isOpen = j.jobId === currentId;
      row.appendChild(el('p', {}, `${j.env.job.name} · ${j.env.job.items.length} fitting${j.env.job.items.length === 1 ? '' : 's'}${isOpen ? ' · open now' : ''}`));
      const b = el('button', { 'data-testid': `jobs-open-${j.jobId}` }, isOpen ? 'Open now' : 'Open');
      b.disabled = isOpen;
      b.addEventListener('click', () => { closeModal(); switchJobs(() => openRecord(j.jobId)); });
      row.appendChild(b);
    } else {
      row.appendChild(el('p', {}, `Unreadable job, kept as it is (${j.reason}).`));
      const b = el('button', { 'data-testid': `jobs-download-${j.jobId}` }, 'Download raw');
      b.addEventListener('click', () => { downloadRawRecord(j.raw); toast('Download started. Check your Downloads folder; the record stays here.'); });
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  if (!s.jobs.length) box.appendChild(el('p', {}, 'No saved jobs on this device yet.'));
  modal('Jobs', [box], [
    { label: 'Close', fn: closeModal },
    { label: 'Download all jobs', testid: 'jobs-download-all', fn: () => downloadAllJobs() },
    { label: 'New job', class: 'btn-primary', testid: 'jobs-new', fn: () => { closeModal(); openNewJobForm(); } },
  ]);
  return true;
}
// Saved copies only. Unreadable records are reported, never silently left out.
function downloadAllJobs() {
  const s = jobsApi && jobsApi.safeScan();
  if (!s) { toast('This device’s storage is blocked, so saved jobs can’t be read. Nothing has been changed.'); return; }
  const a = J.buildArchive(s, new Date().toISOString());
  const skipped = a.unreadable ? ` ${a.unreadable} unreadable record${a.unreadable === 1 ? '' : 's'} not included. Download ${a.unreadable === 1 ? 'it' : 'them'} from Recover.` : '';
  if (!a.count) { toast(`No readable saved jobs to download.${skipped}`, 6000); return; }
  download(`all-jobs-${stamp()}.json`, a.text, 'application/json');
  const unsaved = job && savedCanon !== contentKey() ? ' Changes on screen that aren’t saved aren’t included.' : '';
  toast(`${a.count} job${a.count === 1 ? '' : 's'} downloaded. Check the file landed in your Downloads folder.${skipped}${unsaved}`, 6000);
}
function showLegacyOffer() {
  modal('Older-version job found', [
    el('p', {}, `“${legacyOffer.job.name}” was saved by the older version of this app after your jobs were upgraded. Add it as a new job? Your other jobs won’t change.`),
  ], [
    { label: 'Not now', fn: closeModal },
    { label: 'Add as new job', class: 'btn-primary', testid: 'legacy-offer-accept', fn: acceptLegacyOffer },
  ]);
}
async function acceptLegacyOffer() {
  closeModal();
  const r = await jobsApi.reconcileLegacy({ writerTab, accept: true });
  if (r.ok && r.status === 'skipped') {
    // its upgrade record became unreadable after the offer: nothing is added
    legacyOffer = null;
    legacyMarkerUnreadable = true;
    modal('Older-version job not added', [
      el('p', { 'data-testid': 'legacy-skipped' }, 'The older-version job wasn’t added, because its upgrade record can’t be read and adding it could make a second copy. Nothing was changed. You can download the older-version job from Recover.'),
    ], [
      { label: 'Close', fn: closeModal },
      { label: 'Open Recover', class: 'btn-primary', testid: 'legacy-skipped-recover', fn: () => openRecovery() },
    ]);
    return;
  }
  if (r.ok) {
    legacyOffer = null;
    toast(r.status === 'none' ? 'The older-version job has gone, so nothing was added.'
      : r.created ? `Added “${r.legacy.job.name}” as a new job. Your other jobs weren’t changed.`
        : 'That older-version job is already in your list.');
    return;
  }
  jobNotAdded(r);
}

// ---- Import ------------------------------------------------------------------------
$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const failed = (msg) => modal('Import failed', [el('p', { 'data-testid': 'import-failed' }, msg)], [{ label: 'Close', class: 'btn-primary', fn: closeModal }]);
  if (file.size > J.MAX_ARCHIVE_BYTES) {
    failed(`This file is too large to import (${(file.size / 1e6).toFixed(1)} MB; the limit is ${J.MAX_ARCHIVE_BYTES / 1e6} MB). Nothing has changed.`);
    return;
  }
  file.text().then((text) => {
    if (J.isArchiveText(text)) { importArchiveFlow(text, file.size); return; }
    let r;
    try { r = C.parseBackup(text); }
    catch (err) { r = { ok: false, errors: [String(err && err.message || err)] }; }
    if (!r.ok) { failed(`This file isn’t a valid job backup (${r.errors[0]}). Nothing has changed.`); return; }
    const s = C.summariseBackup(r.job);
    // Importing never replaces anything: the backup becomes a new job.
    modal('Import backup', [
      el('p', {}, `“${s.name}” · ${s.size} · ${s.items} fittings · saved ${new Date(s.savedAt).toLocaleString('en-GB')}${s.complete ? '' : ' · contains unpriced items'}`),
      el('p', {}, 'It will be added as a new job. Your current job stays as it is.'),
    ], [
      { label: 'Cancel', fn: closeModal },
      { label: 'Add as new job', class: 'btn-primary', testid: 'import-confirm', fn: () => { closeModal(); startNewJob(r.job, { kind: 'import' }, 'Backup added as a new job'); } },
    ]);
  }).catch(() => failed('This file couldn’t be read. Nothing has changed.'));
});
// All-jobs archive: validated as a whole before anything is written (§4.7).
function importArchiveFlow(text, size) {
  const v = J.validateArchive(text, size);
  const close = [{ label: 'Close', class: 'btn-primary', fn: closeModal }];
  if (!v.ok) {
    const ul = el('ul', { 'data-testid': 'import-failed' });
    for (const e of v.errors.slice(0, 10)) ul.appendChild(el('li', {}, e));
    modal('Import failed', [el('p', {}, 'This archive can’t be imported:'), ul, el('p', {}, 'Nothing has changed.')], close);
    return;
  }
  if (!jobsApi.canWrite) {
    modal('Import not available', [el('p', { 'data-testid': 'import-failed' }, 'This browser can’t safely save jobs on this device, so the archive wasn’t imported. Nothing has changed.')], close);
    return;
  }
  const n = v.entries.length;
  modal('Import all-jobs archive', [
    el('p', {}, `This archive holds ${n} job${n === 1 ? '' : 's'}. They’ll be added as new jobs, and any already on this device are skipped. Your current job stays as it is.`),
  ], [
    { label: 'Cancel', fn: closeModal },
    {
      label: 'Add jobs', class: 'btn-primary', testid: 'archive-confirm', fn: async () => {
        closeModal();
        const r = await jobsApi.importArchive({ text, byteSize: size, writerTab });
        let msg;
        if (r.ok) {
          msg = r.added
            ? `Added ${r.added} job${r.added === 1 ? '' : 's'}.${r.skipped ? ` Skipped ${r.skipped} already on this device.` : ''}`
            : `Nothing to add. All ${r.total} jobs are already on this device.`;
        } else if (r.reason === 'cap') {
          msg = `This device holds at most ${r.max} jobs. You have ${r.existing} and the archive would add ${r.adding}. Nothing has changed.`;
        } else if (r.reason === 'journal') {
          msg = 'This device’s storage is full or blocked, so nothing was imported. Nothing has changed.';
        } else if (Number.isInteger(r.added)) {
          const why = {
            quota: 'storage full',
            readback: 'this device didn’t store a job correctly',
            'too-large': 'a job is too large to store on this device',
            blocked: 'this device’s storage refused',
            'lock-timeout': 'another tab kept the job list busy',
          }[r.reason] || 'a storage problem';
          msg = `Added ${r.added} of ${r.total} — ${why}. Existing jobs unchanged. Menu → Recover saved data lists this incomplete import; choose the same file again to add the rest.`;
        } else msg = createFailText(r);
        modal(r.ok ? 'Import finished' : 'Import stopped', [el('p', { 'data-testid': 'archive-result' }, msg)], close);
      },
    },
  ]);
}

// ---- Pointer interaction --------------------------------------------------------------
// EP19-05 (BL-09/10): finger selection needs a dead zone and a clear target.
// Movement under TAP_SLOP_PX screen px is a tap (select, never a nudge); every
// visible glyph is grabbable a little beyond its drawn symbol (HIT_SLOP_PX)
// without enlarging anything visual; when two fittings are effectively at the
// same spot the app asks which one was meant instead of guessing.
const TAP_SLOP_PX = 10;    // movement below this (CSS px) is a tap, not a drag
const HIT_SLOP_PX = 12;    // extra grab room around every symbol, screen px
const AMBIGUOUS_PX = 14;   // candidates this close to the best hit are ambiguous
const pointers = new Map(); // pointerId → {x,y,type}
let dragFitting = null, drawingStroke = null, panning = null, pinch = null;
let owner = null;               // pointerId that started the current drag, stroke or pan
// Palm protection: fingers only pan while a pen is touching, hovering (where the
// hardware reports hover) or was lifted less than this long ago.
const PEN_GRACE_MS = 1000;
let lastPenAt = -Infinity;
let fingerDraws = false;        // user's choice, offered once a pen has been seen
let fingerToastAt = -Infinity, wideToastAt = -Infinity;

const penNear = () => performance.now() - lastPenAt < PEN_GRACE_MS
  || [...pointers.values()].some(q => q.type === 'pen');
// Last input outcome, readable by QA on the element; no effect on behaviour.
function noteInput(e, outcome) {
  $('#canvas').dataset.lastInput = `${e.pointerType}:${outcome}`;
  if (e.pointerId === lastDown.id) lastDown.outcome = outcome;
}

// Local-only drawing check shown in the Menu for support calls. Holds pointer
// facts only, never job content, and is never sent anywhere.
const BUILD_LABEL = 'Electrical jobs update 1';
let downCount = 0;
let lastDown = { id: null };
function startDiag(e) {
  downCount += 1;
  lastDown = { id: e.pointerId, type: e.pointerType, width: e.width, tool: mode, outcome: '', moves: 0, end: '', capture: '' };
}
function endDiag(e, how) {
  if (e.pointerId === lastDown.id && !lastDown.end) lastDown.end = how; // first ending wins
}
const TOOL_LABEL = { select: 'Select', place: 'Place', draw: 'Draw', notes: 'Notes' };
const DEVICE_LABEL = { touch: 'finger', pen: 'pen', mouse: 'mouse' };
function outcomeText(o) {
  if (!o) return 'nothing happened yet';
  if (o.startsWith('ignored-wide-')) return `ignored as a palm (contact ${o.slice(13)} px wide)`;
  return {
    'draw': 'started a sketch line',
    'ignored-pen-down': 'ignored because the pen was touching',
    'pinch': 'two fingers, so it zoomed',
    'no-drawing': 'ignored because the room size isn’t set',
    'sketch-limit': 'ignored because this view has too many sketches',
    'select': 'picked up a fitting',
    'multi-tap': 'added or removed a fitting from the selection',
    'pan': 'moved the drawing',
    'pan-pen-mode': 'moved the drawing (a pen was used, so fingers only move it)',
    'place': 'placed a fitting',
    'note': 'opened a note',
  }[o] || o;
}
const END_TEXT = { up: 'lifted normally', cancel: 'cancelled by the browser', 'capture-lost': 'the page lost track of it before it lifted' };
function drawingCheckLines() {
  const lines = [`Build: ${BUILD_LABEL}`, `Tool now: ${TOOL_LABEL[mode] || mode}`];
  if (typeof window.PointerEvent === 'undefined') {
    lines.push('This browser doesn’t support pointer events, so the drawing can’t respond to touch.');
    return lines;
  }
  if (!downCount) {
    lines.push('No finger, pen or mouse has reached the drawing since this page opened.');
    return lines;
  }
  const d = lastDown;
  lines.push(
    `Last touch: ${DEVICE_LABEL[d.type] || d.type || 'unknown'} in ${TOOL_LABEL[d.tool] || d.tool}, ${outcomeText(d.outcome)}`,
    `Contact width: ${typeof d.width === 'number' && d.width > 0 ? Math.round(d.width) + ' px' : 'not reported'}`,
    `Movement events: ${d.moves}`,
    `Ended: ${END_TEXT[d.end] || 'still down or not reported'}`,
  );
  if (d.capture === 'failed') lines.push('Pointer capture: failed');
  return lines;
}

function renderFingerMode() {
  const b = $('#btn-finger-draw');
  b.hidden = !penSeen;
  b.setAttribute('aria-pressed', String(fingerDraws));
  b.innerHTML = '';
  b.append(el('span', { 'aria-hidden': 'true' }, '✋ '), fingerDraws ? 'Finger drawing: on' : 'Finger drawing: off');
  b.title = fingerDraws
    ? 'Fingers draw and place too. They still only move the drawing while the pen is in use.'
    : 'A pen was used, so fingers only move and zoom the drawing. Tap to let fingers draw too.';
}
function explainFingerPan() {
  if (fingerDraws || performance.now() - fingerToastAt < 8000) return;
  fingerToastAt = performance.now();
  toast('A pen was used here, so fingers only move and zoom the drawing. Tap “Finger drawing: off” to let fingers draw too.', 5000);
}
function explainWideTouch(width) {
  if (performance.now() - wideToastAt < 8000) return;
  wideToastAt = performance.now();
  toast(`Touch ignored: the contact was ${Math.round(width)} px wide, so it was treated as a palm. Try a fingertip.`, 4000);
}

// Drop whatever is in progress without saving any part of it.
function cancelInteraction() {
  const drag = dragFitting;
  pinch = null; drawingStroke = null; panning = null; dragFitting = null; owner = null;
  multiPending = null; // a cancelled or pinched tap never toggles
  if (drag) { job = C.normaliseJob(JSON.parse(drag.pre)); renderAll(); }
  else renderCanvas();
}
// Stop tracking every pointer of one type, cancelling what they had started.
function dropPointers(type) {
  let hit = false;
  for (const [id, q] of pointers) {
    if (q.type !== type) continue;
    pointers.delete(id);
    if (id === owner || pinch) hit = true;
  }
  if (hit) cancelInteraction();
}

function svgPoint(e) {
  const svg = $('#canvas');
  const world = svg.querySelector('#world');
  if (!world || !job || !job.room || !job.room.widthM) return null; // no drawing yet
  const ctm = world.getScreenCTM();
  if (!ctm) return null; // not laid out yet (e.g. hidden canvas)
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(ctm.inverse());
}
function startPinch() {
  cancelInteraction(); // a half-finished drag is reverted, not left moved without an undo step
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s };
}
function doPinch() {
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinch && pinch.d > 0) {
    zoom.s = Math.min(4, Math.max(0.5, pinch.s * (d / pinch.d)));
    renderCanvas();
  }
}

// Screen-space hit test over the drawn glyphs (EP19-05): every fitting shown on
// this view is grabbable out to its symbol extent (largest glyph half-size,
// 135 mm) plus HIT_SLOP_PX, with a floor so small drawings stay finger-sized.
// Hidden fittings are not drawn, so they are never targets. Returns candidates
// sorted nearest-first ({id, d}) and the symbol-core radius in screen px.
function fittingHits(cx, cy) {
  const svg = $('#canvas');
  const world = svg.querySelector('#world');
  const content = world && world.querySelector('g'); // the room/fitting layer
  const none = { hits: [], core: 0 };
  if (!content || !job) return none;
  const ctm = content.getScreenCTM();
  if (!ctm) return none;
  const scale = Math.hypot(ctm.a, ctm.b) || 1; // screen px per room mm
  const core = Math.max(10, 110 * scale);       // typical glyph half-size, floored
  const radius = Math.max(24, 135 * scale) + HIT_SLOP_PX;
  const out = [];
  for (const g of svg.querySelectorAll('.fitting')) {
    const id = g.getAttribute('data-id');
    const it = job.items.find(i => i.id === id);
    if (!it) continue;
    const tr = (g.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)\s*[, ]\s*([-\d.]+)\s*\)/);
    if (!tr) continue;
    const pt = svg.createSVGPoint(); pt.x = +tr[1]; pt.y = +tr[2];
    const s = pt.matrixTransform(ctm);
    const d = Math.hypot(cx - s.x, cy - s.y);
    if (d <= radius) out.push({ id, d });
  }
  out.sort((a, b) => a.d - b.d);
  return { hits: out, core };
}
// Decide a hit list: a tap inside the nearest symbol's CORE is clearly that
// fitting; an exact tie (overlapping fittings) or a slop-zone tap between two
// nearby fittings is ambiguous and returns the candidate group instead. In an
// ambiguous group, `chosen` (the fitting the user already selected, e.g. from
// the chooser) is the target, so it can be dragged out of the group; nothing
// else is ever guessed.
function resolveHits(hits, core, chosen = null) {
  if (!hits.length) return { id: null, cands: [] };
  const near = hits.filter(h => h.d <= hits[0].d + AMBIGUOUS_PX).map(h => h.id);
  const group = () => ({ id: near.includes(chosen) ? chosen : null, cands: near });
  if (near.length > 1 && hits[1].d - hits[0].d < 3) return group();                  // exact overlap
  if (hits[0].d <= core) return { id: hits[0].id, cands: [hits[0].id] };              // on the symbol
  if (near.length > 1) return group();                                                // between two
  return { id: hits[0].id, cands: [hits[0].id] };                                      // slop grab
}
// Dense groups (EP19-05): when fittings sit close together, ask which one was
// meant. Choosing only selects — it never moves anything.
function askWhichFitting(cands, choose, hint = '') {
  const box = el('div');
  box.appendChild(el('p', {}, `${cands.length} fittings are near this spot. Which one did you mean?`));
  if (hint) box.appendChild(el('p', {}, hint));
  for (const id of cands) {
    const it = job.items.find(i => i.id === id);
    if (!it) continue;
    const current = !multiIds && id === selectedId;
    const b = el('button', { class: 'which-row', 'data-testid': `which-${id}`, ...(current ? { 'aria-current': 'true' } : {}) },
      `${id} · ${C.TYPES[it.type].label}${it.wall === C.CEILING ? ' · ceiling' : ' · Wall ' + it.wall}${current ? ' · selected now' : ''}`);
    b.addEventListener('click', () => { closeModal(); choose(id); });
    box.appendChild(b);
  }
  modal('Which fitting?', [box], [{ label: 'Cancel', class: 'btn-primary', testid: 'which-cancel', fn: closeModal }]);
}
// Where the finger grabbed, relative to the fitting's own position (room mm),
// so a drag carries the fitting without snapping its centre under the finger.
function grabOffsetFor(id, p) {
  const it = job.items.find(i => i.id === id);
  if (!it) return { dL: 0, dH: 0 };
  if (view === 'PLAN') {
    if (it.wall === C.CEILING) return { dL: p.x - it.fromLeftMm, dH: p.y - it.heightMm };
    const wp = wallParamsFromPlan(p.x, p.y, it.wall);
    return wp ? { dL: wp.fromLeft - it.fromLeftMm, dH: 0 } : { dL: 0, dH: 0 };
  }
  const { H } = roomMm();
  // wall views store height as H−y, so the offset carries that sign: the
  // fitting keeps its hold point while the finger moves either way
  return { dL: p.x - it.fromLeftMm, dH: it.heightMm - (H - p.y) };
}

$('#canvas').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const canvas = $('#canvas');
  startDiag(e);
  if (layersOpen) setLayersOpen(false);
  // A primary pointer means the browser has no other contact of this kind down,
  // so any we still track of that kind lost its pointerup. Forget it, or every
  // later single touch would start a pinch.
  if (e.isPrimary) dropPointers(e.pointerType);
  if (e.pointerType === 'pen') {
    penSeen = true;
    lastPenAt = performance.now();
    // The pen wins over fingers already down (usually a resting palm): drop them
    // and anything they started, so the pen is neither ignored nor made a pinch.
    dropPointers('touch');
    renderFingerMode();
  } else if (e.pointerType === 'touch') {
    // stray-tap / palm guard: very wide touches, or touch while pen is down
    const penDown = [...pointers.values()].some(q => q.type === 'pen');
    // A fingertip can be reported wider than 40 px. A finger that is
    // about to draw (Draw tool, no pen in use, fingers allowed to draw) skips the
    // width check; every other tool, and any touch near pen use, keeps it.
    const fingerWillDraw = mode === 'draw' && !penNear() && (!penSeen || fingerDraws);
    if (penDown || (e.width > 40 && !fingerWillDraw)) {
      noteInput(e, penDown ? 'ignored-pen-down' : `ignored-wide-${Math.round(e.width)}`);
      if (!penDown && !penNear()) explainWideTouch(e.width);
      return;
    }
  }
  try { canvas.setPointerCapture(e.pointerId); lastDown.capture = 'ok'; }
  catch { lastDown.capture = 'failed'; /* synthetic/untracked pointer: events still arrive */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (pointers.size === 2) { startPinch(); noteInput(e, 'pinch'); return; }
  if (pinch) return;

  // Once a pen has been seen, fingers only pan and zoom unless the user turns
  // finger drawing on; even then, not while the pen is in use.
  const fingerOnly = e.pointerType === 'touch' && penSeen && (!fingerDraws || penNear());
  const p = svgPoint(e);
  if (!p) { noteInput(e, 'no-drawing'); return; } // room not set yet (e.g. blank job, room form dismissed)
  const { hits, core } = fittingHits(e.clientX, e.clientY);
  const hitFitting = hits.length ? hits[0] : null;
  if (fingerOnly && (mode !== 'select' || hitFitting)) explainFingerPan();

  if (mode === 'select' && !fingerOnly) {
    if (multiIds) {
      // Multi mode: a tap toggles a fitting; empty space only pans and never
      // clears the selection. No dragFitting — moving happens through Apply or
      // not at all. An ambiguous tap asks which fitting was meant on lift.
      multiPending = hits.length ? { hits, core, sx: e.clientX, sy: e.clientY } : null;
      panning = { sx: e.clientX, sy: e.clientY, tx: zoom.tx, ty: zoom.ty };
      owner = e.pointerId;
      noteInput(e, hitFitting ? 'multi-tap' : 'pan');
      return;
    }
    if (hitFitting) {
      const res = resolveHits(hits, core, selectedId);
      // a dense spot selects nothing yet unless one of its fittings was already
      // chosen — the chooser on lift names the fitting
      selectedId = res.id;
      // A tap-select arms a drag but nothing moves until the pointer travels
      // TAP_SLOP_PX: a small wobble selects without nudging the fitting. The
      // grab offset keeps the fitting where the finger took hold of it. A drag
      // from an ambiguous spot moves only the chosen fitting; with no choice
      // it is refused and the lift opens the chooser.
      dragFitting = {
        id: selectedId, moved: false, pre: snapshot(),
        sx: e.clientX, sy: e.clientY, active: false,
        grab: grabOffsetFor(selectedId, p),
        cands: res.cands,
      };
    } else {
      selectedId = null;
      panning = { sx: e.clientX, sy: e.clientY, tx: zoom.tx, ty: zoom.ty };
    }
    owner = e.pointerId;
    noteInput(e, hitFitting ? 'select' : 'pan');
    renderAll();
    return;
  }
  if (mode === 'place' && !fingerOnly) { noteInput(e, 'place'); placeAt(p); return; }
  if (mode === 'draw' && !fingerOnly) {
    if ((job.annotations[view] || []).length >= C.LIMITS.maxStrokesPerView) {
      noteInput(e, 'sketch-limit');
      toast(`Sketch limit reached on this view (${C.LIMITS.maxStrokesPerView}) — clear sketches to add more.`);
      return;
    }
    drawingStroke = { points: [[Math.round(p.x), Math.round(p.y)]] };
    owner = e.pointerId;
    noteInput(e, 'draw');
    return;
  }
  if (mode === 'notes' && !fingerOnly) {
    // The prompt below can swallow this pointer's pointerup; stop tracking it now.
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    noteInput(e, 'note');
    if ((job.notePins || []).length >= 100) {
      toast('Note limit reached (100) — delete a note before adding another.');
      return;
    }
    const text = window.prompt('Note text (plain text, notes are never priced):', '');
    if (text && text.trim()) {
      commit(() => {
        job.notePins.push({ id: 'N' + (job.notePins.length + 1) + '-' + Date.now().toString(36), view, x: Math.round(p.x), y: Math.round(p.y), text: text.slice(0, 200) });
      });
    }
    return;
  }
  // finger (or empty-area touch) pans
  panning = { sx: e.clientX, sy: e.clientY, tx: zoom.tx, ty: zoom.ty };
  owner = e.pointerId;
  noteInput(e, fingerOnly ? 'pan-pen-mode' : 'pan');
});

function placeAt(p) {
  if (!p || !job.room || !job.room.widthM) { toast('Set the room size first.'); return; }
  const dims = roomMm();
  const tpl = copyTpl;
  const type = tpl ? tpl.type : placeType;
  let wall, fromLeft, height;
  if (type === 'downlight') {
    if (view !== 'PLAN') {
      if (endCopy()) { toast('Stopped placing copies. Downlights can only be copied in the plan view.'); renderAll(); return; }
      toast('Downlights go on the ceiling — switch to the plan view.'); return;
    }
    // a copied downlight takes type and layer only: its heightMm is a plan position (E9)
    wall = C.CEILING;
    fromLeft = Math.max(0, Math.min(dims.W, Math.round(p.x)));
    height = Math.max(0, Math.min(dims.D, Math.round(p.y)));
  } else if (view !== 'PLAN') {
    // a copy keeps its captured height in every view; the tap gives only the distance from the left
    wall = view;
    fromLeft = Math.max(0, Math.min(Math.round(p.x), C.wallLengthMm(job.room, view)));
    height = tpl ? tpl.heightMm : Math.max(0, Math.min(dims.H - Math.round(p.y), dims.H));
  } else {
    wall = nearestWallFromPlan(p.x, p.y);
    const wp = wallParamsFromPlan(p.x, p.y, wall);
    if (!wp) {
      toast('That’s in the open floor. Tap close to a wall, or open that wall’s view and tap there.');
      return;
    }
    const maxL = C.wallLengthMm(job.room, wall);
    fromLeft = Math.max(0, Math.min(wp.fromLeft, maxL)); // clamp taps beyond the wall ends
    height = tpl ? tpl.heightMm : (jobPrefs.heights[type] ?? C.TYPES[type].defaultHeightMm ?? 450);
  }
  fromLeft = Math.max(0, fromLeft);
  let clampNote = '';
  if (wall !== C.CEILING) {
    const c = C.clampWallHeight(job, height);
    if (c.clamped) clampNote = ` · height set to ${c.heightMm} mm, the ceiling height`;
    height = c.heightMm;
  }
  let id, revealed = null;
  // Placing onto a hidden layer shows that layer, so the new fitting never vanishes.
  commit(() => {
    id = tpl ? C.placeLike(job, { type, layer: tpl.layer }, wall, fromLeft, height) : C.placeItem(job, type, wall, fromLeft, height);
    revealed = revealLayerOf(id);
  });
  if (!id) return; // commit failed (e.g. item cap); job untouched
  rememberHeight(type, wall, height);
  selectedId = id;
  toast(`${id} placed on ${wall === C.CEILING ? 'ceiling' : 'Wall ' + wall}${revealed ? ` · ${revealed} layer now shown` : ''}${clampNote}`);
  renderAll();
}

$('#canvas').addEventListener('pointermove', (e) => {
  if (e.pointerType === 'pen') lastPenAt = performance.now(); // includes hover
  if (e.pointerId === lastDown.id && !lastDown.end) lastDown.moves += 1;
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, down: true });
  if (pinch && pointers.size === 2) { doPinch(); return; }
  if (e.pointerId !== owner) return; // only the pointer that started a drag, stroke or pan moves it
  const p = svgPoint(e);
  if (!p) return; // nothing drawable yet
  if (dragFitting) {
    if (dragFitting.refused) return;
    if (!dragFitting.active) {
      // EP19-05: under TAP_SLOP_PX of travel this is still a tap — the fitting
      // stays put. An ambiguous grab with no chosen fitting never becomes a
      // drag: the pointer's lift opens the chooser instead.
      if (Math.hypot(e.clientX - dragFitting.sx, e.clientY - dragFitting.sy) < TAP_SLOP_PX) return;
      if (!dragFitting.id) {
        dragFitting.refused = true;
        toast(`${dragFitting.cands.length} fittings are near this spot — lift your finger and choose one, then drag it.`, 4000);
        return;
      }
      if (dragFitting.cands.length > 1) toast(`Moving ${dragFitting.id} (the selected fitting)`);
      dragFitting.active = true;
    }
    const item = job.items.find(i => i.id === dragFitting.id);
    if (!item) { dragFitting = null; return; }
    const p2 = svgPoint(e);
    if (!p2) return;
    // carry the fitting from where the finger grabbed it, not centre-under-finger
    const t = { x: p2.x - dragFitting.grab.dL, y: p2.y - dragFitting.grab.dH };
    let changedToClamp = false;
    let newL = item.fromLeftMm, newH = item.heightMm;
    if (view === 'PLAN') {
      if (item.wall === C.CEILING) {
        const dims = roomMm();
        newL = Math.max(0, Math.min(dims.W, Math.round(t.x)));
        newH = Math.max(0, Math.min(dims.D, Math.round(t.y)));
      } else {
        // slide along the item's own wall only
        const wp = wallParamsFromPlan(t.x, t.y, item.wall);
        if (wp) {
          const maxL = C.maxFromLeft(job, item);
          if (wp.fromLeft > maxL) { wp.fromLeft = maxL; changedToClamp = true; }
          newL = Math.max(0, wp.fromLeft);
        }
      }
    } else {
      const maxL = C.maxFromLeft(job, item);
      const maxH = C.maxHeight(job, item);
      newL = Math.max(0, Math.min(maxL, Math.round(t.x)));
      if (item.wall !== C.CEILING) newH = Math.max(0, Math.min(maxH, roomMm().H - Math.round(t.y)));
      if (Math.round(t.x) > maxL || (roomMm().H - Math.round(t.y)) > maxH) changedToClamp = true;
    }
    if (newL !== item.fromLeftMm || newH !== item.heightMm) dragFitting.moved = true; // no empty undo steps
    item.fromLeftMm = newL;
    item.heightMm = newH;
    if (changedToClamp && !dragFitting.warned) { toast(`Kept inside ${item.wall === C.CEILING ? 'the ceiling' : 'Wall ' + item.wall}`); dragFitting.warned = true; }
    renderCanvas(); renderInspector(); renderTabs();
    return;
  }
  if (drawingStroke) {
    const last = drawingStroke.points[drawingStroke.points.length - 1];
    const q = [Math.round(p.x), Math.round(p.y)];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 15 && drawingStroke.points.length < C.LIMITS.maxPointsPerStroke) {
      drawingStroke.points.push(q);
      // live preview
      renderCanvas();
      const world = $('#canvas').querySelector('#world');
      svgEl('polyline', { points: drawingStroke.points.map(pt => pt.join(',')).join(' '), fill: 'none', stroke: '#2266cc', 'stroke-width': 25 }, world);
    }
    return;
  }
  if (panning) {
    zoom.tx = panning.tx + (e.clientX - panning.sx);
    zoom.ty = panning.ty + (e.clientY - panning.sy);
    renderCanvas();
  }
});

function endPointer(e) {
  // Ignored contacts (a palm, or a finger dropped for the pen) must not end the
  // pen's stroke or drag.
  endDiag(e, 'up');
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (e.pointerType === 'pen') lastPenAt = performance.now();
  if (pointers.size < 2) pinch = null;
  if (e.pointerId !== owner) return;
  owner = null;
  if (multiPending) {
    // A tap only counts if it moved less than TAP_SLOP_PX; longer presses were
    // pans. Two fittings at the same spot ask which one was meant.
    const pend = multiPending;
    multiPending = null;
    if (Math.hypot(e.clientX - pend.sx, e.clientY - pend.sy) < TAP_SLOP_PX) {
      const { id, cands } = resolveHits(pend.hits, pend.core);
      const toggle = (tid) => {
        const it = job.items.find(i => i.id === tid);
        if (it && it.wall === C.CEILING) toast(`${tid} is a ceiling fitting, so it has no wall height. Not added.`);
        else if (it) multiIds = multiIds.includes(tid) ? multiIds.filter(x => x !== tid) : [...multiIds, tid];
        renderAll();
      };
      if (id) toggle(id);
      else askWhichFitting(cands, toggle); // chooser rerenders through its own click
    }
    renderAll();
    return;
  }
  if (dragFitting) {
    if (!dragFitting.moved && dragFitting.cands.length > 1) {
      // A tap on a dense spot, or a refused drag: ask instead of guessing
      // (never moves anything). A tap also lets an earlier choice be changed.
      const { cands, refused } = dragFitting;
      dragFitting = null;
      askWhichFitting(cands, (id) => {
        selectedId = id; renderAll();
        toast(`${id} selected — drag from this spot to move it`);
      }, refused ? 'Choose one, then drag it.' : '');
      return;
    }
    if (dragFitting.moved) {
      // one history entry for the whole drag (snapshot taken before it started)
      history.push(dragFitting.pre);
      if (history.length > C.LIMITS.historyLimit) history.shift();
      redoStack = [];
      job.revision += 1;
      scheduleSave();
    }
    dragFitting = null;
    renderAll();
  }
  if (drawingStroke) {
    const stroke = drawingStroke; drawingStroke = null;
    if (stroke.points.length > 1) {
      const target = job.annotations[view] = job.annotations[view] || [];
      commit(() => { target.push(stroke); });
    } else renderCanvas();
  }
  panning = null;
}
function cancelPointer(e) {
  // A cancelled palm is ignored; a cancelled owner drops the interaction
  // entirely (drag reverted to its pre-drag snapshot, no partial stroke saved).
  endDiag(e, 'cancel');
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (e.pointerType === 'pen') lastPenAt = performance.now();
  if (e.pointerId === owner || pinch) cancelInteraction();
}
// Window listeners catch a pointerup or cancel that lands off the canvas when
// capture failed. Each handler is a no-op for a pointer already handled.
for (const target of [$('#canvas'), window]) {
  target.addEventListener('pointerup', endPointer);
  target.addEventListener('pointercancel', cancelPointer);
}
// Recorded for the Menu check only. A normal pointerup or the Notes tool's own
// release has already stopped tracking the pointer, so neither counts as lost.
$('#canvas').addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) endDiag(e, 'capture-lost'); });
$('#btn-finger-draw').addEventListener('click', () => {
  fingerDraws = !fingerDraws;
  renderFingerMode();
  toast(fingerDraws
    ? 'Fingers can draw and place now. While the pen is in use they still only move the drawing.'
    : 'Fingers only move and zoom the drawing. The pen draws.');
});

// Wheel zoom (desktop convenience)
$('#canvas').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom.s = Math.min(4, Math.max(0.5, zoom.s * (e.deltaY < 0 ? 1.1 : 0.9)));
  renderCanvas();
}, { passive: false });

// ---- Modes / palette ------------------------------------------------------------
const MODES = ['select', 'place', 'draw', 'notes'];
function setMode(m) {
  if (!MODES.includes(m)) return;
  const leftMulti = m !== 'select' && !!multiIds;
  if (leftMulti) endMulti(); // another tool leaves multi mode with no change
  if (m !== 'place') endCopy(); // so does copy mode
  mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#place-palette').hidden = m !== 'place';
  // leaving multi mode swaps the panel back; renderAll so the inspector follows
  if (leftMulti) renderAll(); else renderCanvas();
}
document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

function buildPalette() {
  const pal = $('#place-palette');
  pal.innerHTML = '';
  if (copyTpl) {
    // copy mode: the strip holds what is being copied and a touch-sized Cancel
    const bar = el('div', { class: 'copy-bar', 'data-testid': 'copy-bar', role: 'status' });
    bar.appendChild(el('span', {}, copyLabel()));
    const cancel = el('button', { class: 'copy-cancel-btn', 'data-testid': 'copy-cancel' }, 'Cancel');
    cancel.addEventListener('click', cancelCopy);
    bar.appendChild(cancel);
    pal.appendChild(bar);
    return;
  }
  pal.appendChild(el('p', { class: 'palette-title' }, 'Pick a fitting'));
  for (const [k, t] of Object.entries(C.TYPES)) {
    const b = el('button', { class: 'pal-btn' + (k === placeType ? ' active' : ''), 'data-type': k, 'data-testid': `pal-${k}` });
    b.append(el('span', { class: 'sym' }, t.symbol), el('span', {}, t.label));
    b.addEventListener('click', () => {
      placeType = k;
      rememberType(k);
      pal.querySelectorAll('.pal-btn').forEach(x => x.classList.toggle('active', x.dataset.type === k));
      setMode('place');
      renderCanvas();
    });
    pal.appendChild(b);
  }
}

$('#btn-clear-ink').addEventListener('click', () => {
  const strokes = job.annotations[view] || [];
  if (!strokes.length) { toast('No sketches on this view'); return; }
  modal('Clear sketches', [el('p', {}, `Remove ${strokes.length} sketch(es) from this view? This can be undone.`)], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Clear sketches', class: 'btn-danger', fn: () => { commit(() => { job.annotations[view] = []; }); closeModal(); } },
  ]);
});

// ---- Top bar wiring --------------------------------------------------------------
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
// Pressing Menu must not blur a number field: the blur refuses an invalid
// number and resets the save chip, which sits just before Menu in the wrapping
// top bar, so Menu moved out from under the pointer and the tap was lost. The
// field keeps focus; the refusal then happens at the switch (leaveJob).
$('#btn-menu').addEventListener('mousedown', (e) => e.preventDefault());
$('#btn-menu').addEventListener('click', openMenu);
$('#btn-breakdown').addEventListener('click', openBreakdown);
// The job name at the top opens Jobs; Rename is in there. If storage can't be
// listed, rename stays reachable directly.
$('#btn-job-name').setAttribute('aria-label', 'Jobs');
$('#btn-job-name').title = 'Jobs';
$('#btn-job-name').addEventListener('click', () => {
  if (!openJobsList() && job) renameJob();
});
function renameJob() {
  const box = el('div');
  const nameI = el('input', { 'data-testid': 'job-name-input' }); nameI.value = job.name;
  box.append(el('label', {}, 'Job name'), nameI);
  const save = () => commit(() => { job.name = nameI.value.trim().slice(0, C.LIMITS.maxTextLen) || 'Untitled room'; });
  const initialName = nameI.value;
  guardedForm('Job details', [box], [
    { label: 'Cancel', fn: closeModal },
    { label: 'Save', class: 'btn-primary', fn: () => { save(); closeModal(); } },
  ], () => nameI.value !== initialName, 'You have edited the job name.');
}
$('#btn-zoom-in').addEventListener('click', () => { zoom.s = Math.min(4, zoom.s * 1.25); renderCanvas(); });
$('#btn-zoom-out').addEventListener('click', () => { zoom.s = Math.max(0.5, zoom.s / 1.25); renderCanvas(); });
$('#btn-zoom-fit').addEventListener('click', () => { zoom = { s: 1, tx: 0, ty: 0 }; renderCanvas(); });

document.addEventListener('keydown', (e) => {
  const inField = e.target.matches('input, textarea, select');
  if (e.key === 'Escape' && discardConfirmEl) {
    // on the Keep editing / Throw away question itself: back to the form
    closeDiscardConfirm();
    return;
  }
  if (e.key === 'Escape' && layersOpen && !$('#modal-root').firstChild) {
    setLayersOpen(false);
    $('#btn-layers').focus({ preventScroll: true });
    return;
  }
  if (e.key === 'Escape' && inField) {
    // In a dialog: an implicit close; an edited guarded form asks first.
    // In the details panel: blur, which commits the field through its change handler.
    if (e.target.closest('#modal-root')) requestCloseModal(); else e.target.blur();
    return;
  }
  if (inField && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && e.target.closest('#inspector')) {
    // Ctrl+Z inside a details-panel field is the app's undo, never the
    // browser's per-field text undo: one intentional typing session is the
    // unit. Before the session committed, the first press discards the
    // typing (no history step); after it committed, one press undoes the
    // whole session. An explicit second press then reaches earlier edits.
    e.preventDefault();
    const d = draft;
    if (d && d.elem === e.target && d.dirty && !(session && session.key === d.key && session.pushed)) {
      discardDraft(d);
      return;
    }
    if (d && d.elem !== e.target) flushDraft();
    undo();
    return;
  }
  if (inField) return;
  if ($('#modal-root').firstChild) {
    // An open modal owns the keyboard: app-level shortcuts (undo/redo, Delete
    // of the selected fitting, mode keys) must never modify the job behind it
    // — focus is often on a modal BUTTON, which is not a field. Fields inside
    // the modal returned above and keep their native editing. Escape on a
    // modal button still closes implicitly (an edited guarded form asks).
    if (e.key === 'Escape') requestCloseModal();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
  else if (e.key === 'Delete' && selectedId) { commit(() => { job.items = job.items.filter(i => i.id !== selectedId); }); toast(`${selectedId} deleted · Undo`); selectedId = null; renderAll(); }
  else if (e.key === 'Escape' && copyTpl) cancelCopy(); // leaves copy mode with nothing added
  else if (e.key === 'Escape') {
    if (PHONE.matches) inspectorCollapsed = true;
    endMulti(); // Escape outside a field cancels multi mode with no change
    selectedId = null; renderAll();
  }
  else if (e.key.toLowerCase() === 'v') setMode('select');
  else if (e.key.toLowerCase() === 'p') setMode('place');
  else if (e.key.toLowerCase() === 'd') setMode('draw');
  else if (e.key.toLowerCase() === 'n') setMode('notes');
});

// ---- Start buttons -----------------------------------------------------------------
$('#start-blank').addEventListener('click', () => openNewJobForm());
$('#start-sample').addEventListener('click', () => startNewJob(C.sampleJob(), { kind: 'sample' }));
$('#start-layers-demo').addEventListener('click', openLayersDemo);
// phones share the screen between the two panels: opening Layers collapses details
$('#btn-layers').addEventListener('click', () => {
  if (!layersOpen && PHONE.matches && !inspectorCollapsed) {
    inspectorCollapsed = true;
    layersOpen = true;
    renderAll();
    return;
  }
  setLayersOpen(!layersOpen);
});
$('#btn-layers-reset').addEventListener('click', () => applyLayers(new Set(C.LAYERS)));
$('#start-continue').addEventListener('click', () => openJobsList());
$('#start-import').addEventListener('click', () => $('#file-input').click());

// ---- Offline / online chips ----------------------------------------------------------
let offlineTimers = [];
function updateOfflineChip() {
  const chip = $('#offline-chip');
  if (!('serviceWorker' in navigator)) { chip.className = 'chip warn'; chip.textContent = 'Not yet available offline — this browser doesn’t support it'; return; }
  chip.className = 'chip warn';
  chip.textContent = navigator.onLine ? 'Getting ready for offline…' : 'Offline — working from this device';
  offlineTimers.forEach(clearTimeout); offlineTimers = [];
  // Bounded readiness: if the worker never settles, say so instead of hanging on "getting ready".
  offlineTimers.push(setTimeout(() => {
    if (!navigator.serviceWorker.controller && chip.textContent.includes('Getting ready')) {
      chip.className = 'chip warn';
      chip.textContent = 'Not yet available offline — open once while online';
    }
  }, 8000));
  navigator.serviceWorker.ready.then(() => {
    offlineTimers.forEach(clearTimeout); offlineTimers = [];
    if (navigator.onLine) { chip.className = 'chip ok'; chip.textContent = 'Ready to use offline'; }
    else { chip.className = 'chip'; chip.textContent = 'Offline — working from this device'; }
  }).catch(() => {
    chip.className = 'chip warn';
    chip.textContent = 'Not yet available offline — open once while online';
  });
}
window.addEventListener('online', updateOfflineChip);
window.addEventListener('offline', updateOfflineChip);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(updateOfflineChip).catch(() => updateOfflineChip());
} else updateOfflineChip();

// ---- Boot ------------------------------------------------------------------------------
buildPalette();
setMode('select');
renderFingerMode();
// Boot (§4.6), async: detect safe storage, copy a readable older-version job
// into the job list once (its key is never changed), then reopen the last job
// opened here. Recover opens while anything needs attention; it's never
// cleared by downloading.
async function bootJobs() {
  let store = null;
  try { store = window.localStorage; } catch { store = null; }
  const blocked = () => { throw new Error('storage blocked'); };
  const storage = store || { get length() { return blocked(); }, key: blocked, getItem: blocked, setItem: blocked, removeItem: blocked };
  lockSupport = !!(navigator.locks && typeof navigator.locks.request === 'function' && window.crypto && crypto.subtle);
  const sha256 = lockSupport
    ? async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
    : null;
  jobsApi = J.createJobs({ storage, locks: lockSupport ? navigator.locks : null, sha256, lockDelayMs: TEST_HOOKS.lockDelayMs || 0 });
  let legacy = jobsApi.peekLegacy();
  let legacyJobId = null;
  let notice = '';
  let markerNote = '';
  if (lockSupport) {
    let m = await jobsApi.reconcileLegacy({ writerTab });
    if (!m.ok && m.reason === 'legacy-changed') m = await jobsApi.reconcileLegacy({ writerTab });
    if (m.legacy) legacy = m.legacy;
    if (m.ok && m.status === 'offer') legacyOffer = { job: legacy.job };
    else if (m.ok && m.markerUnreadable) {
      legacyMarkerUnreadable = true;
      markerNote = 'The older-version job wasn’t added again: its upgrade record can’t be read. Both are kept as they are; download it from Menu → Recover saved data.';
    }
    else if (m.ok) legacyJobId = m.jobId || null;
    else if (legacy.status === 'ok') {
      notice = m.reason === 'cap'
        ? `The job list is full (${J.MAX_JOBS} jobs), so the older-version job “${legacy.job.name}” wasn’t added to it. Download a backup of it.`
        : 'The older-version job couldn’t be added to your job list. Download a backup of it.';
    }
  }
  const s = jobsApi.safeScan();
  if (!s) {
    showStart();
    toast('This device’s storage is blocked, so saved jobs can’t be read. Nothing has been changed.');
    return;
  }
  const readable = (id) => !!id && s.jobs.some(j => j.ok && j.jobId === id);
  const last = jobsApi.readState();
  let opened = false;
  let noticeHidden = false; // the older-version notice wasn't shown by what opened
  if (readable(last)) { opened = await openRecord(last, notice || markerNote); noticeHidden = !!notice; }
  else if (notice) { openInMemory(legacy.job, 'unsaved', true, notice); opened = true; }
  else if (readable(legacyJobId)) opened = await openRecord(legacyJobId);
  else if (!lockSupport && legacy.status === 'ok') { openInMemory(legacy.job, 'fallback', true); opened = true; }
  if (!opened) { showStart(); if (s.jobs.length || legacyOffer) openJobsList(); if (markerNote) toast(markerNote); }
  // the kept older-version job alone doesn't force Recover open at every boot
  if (recoveryAll().some(r => r.kind !== 'legacy-kept')) openRecovery();
  else if (legacyOffer) showLegacyOffer();
  else if (noticeHidden) showLegacyNotice(legacy.job, notice);
}
// The last job opened, but the older-version job couldn't be added. Viewing it
// writes nothing; it opens unsaved so it can be downloaded.
function showLegacyNotice(oldJob, text) {
  modal('Older-version job not added', [el('p', { 'data-testid': 'legacy-notice' }, text)], [
    { label: 'Close', fn: closeModal },
    { label: 'Open it to download', class: 'btn-primary', testid: 'legacy-notice-open', fn: () => { closeModal(); switchJobs(async () => { openInMemory(oldJob, 'unsaved', true, text); }); } },
  ]);
}
bootJobs()
  .catch(() => { if (!job) showStart(); toast('Saved jobs couldn’t be loaded. Nothing has been changed.'); })
  .finally(() => { document.documentElement.dataset.jobsBoot = 'ready'; });
