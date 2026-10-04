// Several named jobs on one device (EP21-02). Pure: storage, locks and sha256
// are injected, so there is no DOM here and this is the main test seam.
//
// Storage is additive. Each job is one self-contained envelope under its own
// key; the older single-job key (surface.job.v1) is only ever READ. Nothing in
// this module writes, moves or removes it, and no unreadable record is ever
// rewritten or removed. Every add, save and migration runs under a Web Lock;
// without locks the write functions refuse (protected read-only fallback).
import * as C from './core.js';

export const PREFIX = 'surface.jobs.v1.';
export const LEGACY_KEY = 'surface.job.v1';
export const JOB_PREFIX = PREFIX + 'job.';
export const MARKER_PREFIX = PREFIX + 'migrated.';
export const IMPORT_PREFIX = PREFIX + 'import.';
export const RESCUE_PREFIX = PREFIX + 'rescue.';
export const STATE_KEY = PREFIX + 'state';
export const LOCK_CATALOG = PREFIX + 'lock.catalog';
export const lockJob = (id) => PREFIX + 'lock.job.' + id;
export const lockOwner = (id) => PREFIX + 'lock.owner.' + id;

export const MAX_JOBS = 20;          // readable and unreadable job records both count
export const MAX_RESCUES = 3;        // soft bound: the pagehide rescue write is unlocked
// One record must fit comfortably inside the ~5 million characters a browser
// gives one origin, alongside the untouched older-version copy. Larger records
// are refused with a message, never truncated.
export const MAX_RECORD_CHARS = 1000000;
export const MAX_ARCHIVE_BYTES = MAX_JOBS * MAX_RECORD_CHARS;
const ENVELOPE_ROOM = 2048;          // envelope fields around the job itself
export const LOCK_WAIT_MS = 8000;    // bounded wait for job/catalogue locks
export const OWNER_WAIT_MS = 1500;   // a reloading page may still hold its owner lock briefly

export const ARCHIVE_SCHEMA = 'surface-jobs-archive';
const JOB_ID_RE = /^J[0-9a-f]{16}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- Canonical content -------------------------------------------------------
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
// Key-sorted JSON of the normalised job without savedAt and revision. Two jobs
// are exact duplicates only if these strings are equal; names or fitting IDs
// alone never are.
export function canonical(job) {
  const { savedAt, revision, ...rest } = C.normaliseJob(job);
  return JSON.stringify(sortKeys(rest));
}

export function utf8Length(s) { return new TextEncoder().encode(s).length; }

// Per-job placement memory. Invalid entries are dropped on read.
export function cleanPrefs(p) {
  const out = { lastType: null, heights: {} };
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  if (typeof p.lastType === 'string' && has(C.TYPES, p.lastType)) out.lastType = p.lastType;
  const max = C.LIMITS.maxHeightM * 1000;
  if (p.heights && typeof p.heights === 'object' && !Array.isArray(p.heights)) {
    for (const [t, mm] of Object.entries(p.heights)) {
      if (has(C.TYPES, t) && Number.isInteger(mm) && mm >= 0 && mm <= max) out.heights[t] = mm;
    }
  }
  return out;
}

// ---- Record parsing (never throws) -------------------------------------------
export function parseEnvelope(raw, jobId) {
  let d;
  try { d = JSON.parse(raw); } catch { return { ok: false, reason: 'the saved record is incomplete or damaged' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.kind !== 'surface-job-envelope' || d.v !== 1) {
    return { ok: false, reason: 'not a saved job record' };
  }
  if (d.jobId !== jobId) return { ok: false, reason: 'the record’s job ID doesn’t match its slot' };
  if (!Number.isInteger(d.writeRev) || d.writeRev < 1) return { ok: false, reason: 'the record’s save counter is damaged' };
  const v = C.validateJob(d.job);
  if (!v.ok) return { ok: false, reason: v.errors[0] };
  return {
    ok: true,
    env: {
      kind: d.kind, v: 1, jobId: d.jobId,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : null,
      writeRev: d.writeRev,
      writerTab: typeof d.writerTab === 'string' ? d.writerTab : null,
      origin: d.origin && typeof d.origin === 'object' && !Array.isArray(d.origin) ? d.origin : { kind: 'new' },
      prefs: cleanPrefs(d.prefs),
      job: C.normaliseJob(d.job),
    },
  };
}
function parseRescue(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !C.validateJob(d.job).ok) return null;
    return { jobId: typeof d.jobId === 'string' ? d.jobId : null, baseRev: d.baseRev, at: d.at, job: C.normaliseJob(d.job) };
  } catch { return null; }
}
function parseJournal(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || typeof d.archiveSha256 !== 'string' || !Array.isArray(d.planned) || !Array.isArray(d.done)) return null;
    return d;
  } catch { return null; }
}
function parseMarker(raw) {
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && typeof d.jobId === 'string' ? d : null;
  } catch { return null; }
}

// ---- All-jobs archive (validation is pure) ---------------------------------------
export function isArchiveText(text) {
  try { const d = JSON.parse(text); return !!d && typeof d === 'object' && d.schema === ARCHIVE_SCHEMA; }
  catch { return false; }
}
// Phase 1: validate the whole archive before anything is written. Any bad
// entry rejects the archive; nothing is truncated.
export function validateArchive(text, byteSize) {
  const size = Number.isFinite(byteSize) ? byteSize : utf8Length(text);
  if (size > MAX_ARCHIVE_BYTES) {
    return { ok: false, errors: [`the file is ${(size / 1e6).toFixed(1)} MB; an archive can be at most ${MAX_ARCHIVE_BYTES / 1e6} MB`], bad: [] };
  }
  let d;
  try { d = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'], bad: [] }; }
  if (!d || typeof d !== 'object' || d.schema !== ARCHIVE_SCHEMA) return { ok: false, errors: ['not an all-jobs archive'], bad: [] };
  if (d.v !== 1) return { ok: false, errors: ['made by a newer version of this app'], bad: [] };
  if (!Array.isArray(d.entries) || d.entries.length < 1 || d.entries.length > MAX_JOBS) {
    const n = Array.isArray(d.entries) ? d.entries.length : 0;
    return { ok: false, errors: [`it holds ${n} jobs; an archive must hold 1 to ${MAX_JOBS}`], bad: [] };
  }
  const bad = [];
  const entries = [];
  for (const [i, e] of d.entries.entries()) {
    if (!e || typeof e !== 'object') { bad.push({ index: i, reason: 'not a job entry' }); continue; }
    const text1 = JSON.stringify(e.job);
    const r = C.parseBackup(text1 === undefined ? '' : text1);
    if (!r.ok) { bad.push({ index: i, reason: r.errors[0] }); continue; }
    if (text1.length + ENVELOPE_ROOM > MAX_RECORD_CHARS) { bad.push({ index: i, reason: 'too large to store on this device' }); continue; }
    entries.push({ index: i, job: r.job, prefs: cleanPrefs(e.prefs), canon: canonical(r.job) });
  }
  if (bad.length) return { ok: false, errors: bad.map(b => `job ${b.index + 1}: ${b.reason}`), bad };
  return { ok: true, entries };
}

// ---- Storage-bound operations ------------------------------------------------------
function defaultRandomHex(n) {
  const b = new Uint8Array(Math.ceil(n / 2));
  globalThis.crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, n);
}
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

export function createJobs({
  storage, locks = null, sha256 = null, randomHex = defaultRandomHex,
  now = () => new Date().toISOString(), lockWaitMs = LOCK_WAIT_MS, lockDelayMs = 0,
}) {
  const canWrite = !!(locks && typeof locks.request === 'function' && sha256);

  // Bounded exclusive lock. The callback runs only synchronous storage calls.
  async function withLock(name, fn) {
    if (lockDelayMs) await new Promise(r => setTimeout(r, lockDelayMs)); // test hook only
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), lockWaitMs) : null;
    try {
      return await locks.request(name, ac ? { mode: 'exclusive', signal: ac.signal } : { mode: 'exclusive' }, () => {
        clearTimeout(timer);
        return fn();
      });
    } catch (err) {
      if (ac && ac.signal.aborted) return fail('lock-timeout');
      throw err;
    } finally { clearTimeout(timer); }
  }
  // Any unexpected throw (blocked storage, key() failing) becomes an honest result.
  async function guarded(fn) {
    if (!canWrite) return fail('no-locks');
    try { return await fn(); }
    catch (err) { return fail('blocked', { detail: String(err && err.message || err) }); }
  }

  function listKeys() {
    const n = storage.length;
    const out = [];
    for (let i = 0; i < n; i++) { const k = storage.key(i); if (k !== null) out.push(k); }
    return out;
  }

  // Throws if storage can't be enumerated; callers decide how to report.
  function scan() {
    const res = { jobs: [], markers: new Map(), imports: [], rescues: [], bytes: 0 };
    for (const key of listKeys()) {
      if (!key.startsWith(PREFIX) || key === STATE_KEY) continue;
      let raw = null, readErr = false;
      try { raw = storage.getItem(key); } catch { readErr = true; }
      if (raw === null && !readErr) continue; // removed between key() and getItem()
      res.bytes += (raw ? raw.length : 0) + key.length;
      if (key.startsWith(JOB_PREFIX)) {
        const jobId = key.slice(JOB_PREFIX.length);
        const p = readErr ? fail('this device’s storage wouldn’t let us read it') : parseEnvelope(raw, jobId);
        res.jobs.push({ key, jobId, raw, ok: p.ok, env: p.ok ? p.env : null, reason: p.ok ? null : p.reason, size: raw ? raw.length : 0 });
      } else if (key.startsWith(MARKER_PREFIX)) {
        res.markers.set(key.slice(MARKER_PREFIX.length), readErr ? null : parseMarker(raw));
      } else if (key.startsWith(IMPORT_PREFIX)) {
        const data = readErr ? null : parseJournal(raw);
        res.imports.push({ key, importId: key.slice(IMPORT_PREFIX.length), raw, ok: !!data, data });
      } else if (key.startsWith(RESCUE_PREFIX)) {
        const data = readErr ? null : parseRescue(raw);
        res.rescues.push({ key, writerTab: key.slice(RESCUE_PREFIX.length), raw, ok: !!data, data });
      }
    }
    // newest first; unreadable records last, by key, so the order is stable
    res.jobs.sort((a, b) => (a.ok !== b.ok ? (a.ok ? -1 : 1)
      : String(b.env?.createdAt || '').localeCompare(String(a.env?.createdAt || '')) || a.key.localeCompare(b.key)));
    return res;
  }
  function safeScan() { try { return scan(); } catch { return null; } }

  function unusedId(taken) {
    for (let i = 0; i < 50; i++) {
      const id = 'J' + randomHex(16);
      if (!taken.has(id) && storage.getItem(JOB_PREFIX + id) === null) return id;
    }
    throw new Error('could not find an unused job ID');
  }

  // Write a brand-new record. Never touches an existing key. Caller holds the
  // catalogue lock and has checked the cap.
  function writeNew(s, job, prefs, origin, writerTab, presetId = null) {
    const v = C.validateJob(job);
    if (!v.ok) return fail('invalid', { detail: v.errors[0] });
    const taken = new Set(s.jobs.map(j => j.jobId));
    const id = presetId || unusedId(taken);
    const key = JOB_PREFIX + id;
    if (storage.getItem(key) !== null) return fail('id-taken');
    // Every stored job carries the time it was stored, as saves do. An existing
    // stamp (older-version job, backup, rescue) is kept. savedAt is outside the
    // canonical content, so this never changes duplicate detection.
    const stored = JSON.parse(JSON.stringify(job));
    if (typeof stored.savedAt !== 'string') stored.savedAt = now();
    const env = {
      kind: 'surface-job-envelope', v: 1, jobId: id, createdAt: now(), writeRev: 1,
      writerTab: writerTab || null, origin, prefs: cleanPrefs(prefs), job: stored,
    };
    const text = JSON.stringify(env);
    if (text.length > MAX_RECORD_CHARS) return fail('too-large', { size: text.length });
    try { storage.setItem(key, text); } catch { return fail('quota'); }
    let back = null;
    try { back = storage.getItem(key); } catch { /* checked below */ }
    if (back !== text) {
      // our own just-created key: take it back so no half-checked copy counts
      try { storage.removeItem(key); } catch { /* listed as unreadable if anything is left */ }
      return fail('readback');
    }
    s.jobs.push({ key, jobId: id, raw: text, ok: true, env, reason: null, size: text.length });
    return { ok: true, jobId: id, writeRev: 1, env };
  }

  // Create, sample and single import (§4.3): refuse at the cap, never touch
  // another key. A failed create leaves nothing behind.
  function create({ job, prefs = null, origin = { kind: 'new' }, writerTab = null }) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      const s = scan();
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      return writeNew(s, job, prefs, origin, writerTab);
    }));
  }

  // Locked compare-and-write of one job (§4.3). Resolves {ok, reason}.
  function save({ jobId, job, prefs = null, baseRev, writerTab = null }) {
    let plain;
    try { plain = JSON.parse(C.serialiseJob(job)); } // validates; stamps savedAt
    catch (err) { return Promise.resolve(fail('invalid', { detail: String(err.message) })); }
    if (!JOB_ID_RE.test(String(jobId))) return Promise.resolve(fail('missing'));
    return guarded(() => withLock(lockJob(jobId), () => {
      const key = JOB_PREFIX + jobId;
      let raw;
      try { raw = storage.getItem(key); } catch { return fail('read-failed'); }
      if (raw === null) return fail('missing');
      const p = parseEnvelope(raw, jobId);
      if (!p.ok) return fail('unreadable', { detail: p.reason });
      // storedWriter lets the caller tell its own unconfirmed write from another tab's
      if (p.env.writeRev !== baseRev) return fail('stale', { storedRev: p.env.writeRev, storedWriter: p.env.writerTab || null });
      const env = {
        kind: 'surface-job-envelope', v: 1, jobId, createdAt: p.env.createdAt, writeRev: baseRev + 1,
        writerTab: writerTab || null, origin: p.env.origin, prefs: cleanPrefs(prefs), job: plain,
      };
      const text = JSON.stringify(env);
      if (text.length > MAX_RECORD_CHARS) return fail('too-large', { size: text.length });
      try { storage.setItem(key, text); } catch { return fail('quota'); }
      let back = null;
      try { back = storage.getItem(key); } catch { /* checked below */ }
      if (back !== text) return fail('readback');
      return { ok: true, writeRev: env.writeRev, savedAt: plain.savedAt };
    }));
  }

  function readJob(jobId) {
    let raw;
    try { raw = storage.getItem(JOB_PREFIX + jobId); } catch { return fail('read-failed'); }
    if (raw === null) return fail('missing');
    const p = parseEnvelope(raw, jobId);
    return p.ok ? { ok: true, env: p.env, raw } : fail('unreadable', { detail: p.reason, raw });
  }
  function readRaw(key) { try { return storage.getItem(key); } catch { return null; } }

  // ---- Edit ownership -----------------------------------------------------------
  // Held for as long as this tab edits the job. Never stolen: a bounded wait
  // covers a reloading page that hasn't released yet, then read-only.
  async function acquireOwner(jobId, waitMs = OWNER_WAIT_MS) {
    if (!canWrite) return null;
    let release;
    const held = new Promise(r => { release = r; });
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), waitMs) : null;
    const got = await new Promise((resolve) => {
      locks.request(lockOwner(jobId), ac ? { mode: 'exclusive', signal: ac.signal } : { mode: 'exclusive', ifAvailable: true }, (lock) => {
        clearTimeout(timer);
        if (!lock) { resolve(false); return null; }
        resolve(true);
        return held;
      }).catch(() => resolve(false));
    });
    clearTimeout(timer);
    return got ? { release: () => release() } : null;
  }

  // ---- Older-version record --------------------------------------------------------
  function peekLegacy() {
    let raw;
    try { raw = storage.getItem(LEGACY_KEY); } catch { return { status: 'blocked' }; }
    if (raw === null) return { status: 'empty' };
    const r = C.parseBackup(raw);
    return r.ok ? { status: 'ok', raw, job: r.job } : { status: 'unreadable', raw, reason: r.errors[0] };
  }
  async function readLegacy() {
    const L = peekLegacy();
    if (L.status !== 'ok' || !sha256) return L;
    try { return { ...L, sha: await sha256(L.raw), byteLength: utf8Length(L.raw) }; }
    catch { return L; }
  }
  // Boot step 3 (§4.6). Copies, never moves: the older key is read only. With
  // accept=false a hash that matches no marker while other markers exist is
  // offered (the older app was used after a rollback) instead of migrated.
  async function reconcileLegacy({ writerTab = null, accept = false } = {}) {
    const L = await readLegacy();
    if (L.status !== 'ok') return { ok: true, status: 'none', legacy: L };
    if (!L.sha) return fail('no-hash', { legacy: L });
    if (!canWrite) return fail('no-locks', { legacy: L });
    const r = await guarded(() => withLock(LOCK_CATALOG, () => {
      let cur;
      try { cur = storage.getItem(LEGACY_KEY); } catch { return fail('read-failed'); }
      if (cur !== L.raw) return fail('legacy-changed');
      const s = scan();
      const markerKey = MARKER_PREFIX + L.sha;
      const m = s.markers.get(L.sha);
      if (m) return { ok: true, status: 'migrated', jobId: m.jobId };
      // An unreadable marker is never rewritten, and never hides a matching job.
      const markerUnreadable = s.markers.has(L.sha);
      const writeMarker = (jobId) => {
        if (markerUnreadable) return;
        try { storage.setItem(markerKey, JSON.stringify({ v: 1, jobId, byteLength: L.byteLength, at: now() })); }
        catch { /* origin and canonical checks still prevent duplicates */ }
      };
      const prior = s.jobs.find(j => j.ok && j.env.origin.kind === 'legacy' && j.env.origin.legacySha256 === L.sha);
      if (prior) {
        // crash between job write and marker write: repair, no second copy
        writeMarker(prior.jobId);
        return { ok: true, status: 'repaired', jobId: prior.jobId };
      }
      // Same content under a new hash (the older app restamps savedAt on
      // pagehide): map it to the job that already holds it (§4.2 duplicate rule).
      const canon = canonical(L.job);
      const same = s.jobs.find(j => j.ok && canonical(j.env.job) === canon);
      if (same) {
        writeMarker(same.jobId);
        return { ok: true, status: 'migrated', jobId: same.jobId, sameContent: true };
      }
      // §4.1: an unreadable marker counts as present, so migration is skipped,
      // even when accepted. Marker and older key stay as they are.
      if (markerUnreadable) return { ok: true, status: 'skipped', markerUnreadable: true };
      if (s.markers.size > 0 && !accept) return { ok: true, status: 'offer' };
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      const w = writeNew(s, L.job, null, { kind: 'legacy', legacySha256: L.sha }, writerTab);
      if (!w.ok) return w;
      let back = null;
      try { back = storage.getItem(JOB_PREFIX + w.jobId); } catch { /* checked below */ }
      const p = back === null ? null : parseEnvelope(back, w.jobId);
      if (!p || !p.ok || canonical(p.env.job) !== canon) return fail('readback');
      writeMarker(w.jobId);
      const markerFailed = !markerUnreadable && readRaw(markerKey) === null;
      return { ok: true, status: 'migrated', jobId: w.jobId, created: true, ...(markerFailed ? { markerFailed } : {}) };
    }));
    return { ...r, legacy: L };
  }

  // ---- Rescue copies (pagehide) ---------------------------------------------------
  // Synchronous and unlocked: one writer per key (this page). Never applied
  // automatically. Skipped when MAX_RESCUES other rescues already exist.
  function writeRescue({ writerTab, jobId = null, baseRev = null, job }) {
    let plain;
    try { plain = JSON.parse(C.serialiseJob(job)); } catch { return fail('invalid'); }
    const key = RESCUE_PREFIX + writerTab;
    try {
      if (storage.getItem(key) === null) {
        const count = listKeys().filter(k => k.startsWith(RESCUE_PREFIX)).length;
        if (count >= MAX_RESCUES) return fail('rescue-full');
      }
      const text = JSON.stringify({ v: 1, jobId, baseRev, at: now(), job: plain });
      if (text.length > MAX_RECORD_CHARS) return fail('too-large');
      storage.setItem(key, text);
      return { ok: true, key };
    } catch { return fail('quota'); }
  }
  // Only this page's own rescue, after its normal save succeeded.
  function clearRescue(writerTab) {
    const key = RESCUE_PREFIX + writerTab;
    try { if (storage.getItem(key) !== null) storage.removeItem(key); } catch { /* listed in Recover */ }
  }
  // Whether a pagehide rescue from this page could be kept right now.
  function rescueRoom(writerTab) {
    try {
      if (storage.getItem(RESCUE_PREFIX + writerTab) !== null) return true;
      return listKeys().filter(k => k.startsWith(RESCUE_PREFIX)).length < MAX_RESCUES;
    } catch { return false; }
  }
  // Recover → "Dismiss", only after the user confirms. Rescue keys only (they
  // are written without locks, so this works in the no-locks fallback too).
  function dismissRescue(key) {
    if (!String(key).startsWith(RESCUE_PREFIX)) return false;
    try { storage.removeItem(key); return storage.getItem(key) === null; } catch { return false; }
  }
  // Recover → "Open as new job". The rescue is removed only after the new job
  // has been written and read back, so its content always exists somewhere.
  function promoteRescue({ key, writerTab = null }) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      let raw;
      try { raw = storage.getItem(key); } catch { return fail('read-failed'); }
      const data = raw === null ? null : parseRescue(raw);
      if (!data) return fail('unreadable');
      const s = scan();
      // The page's own save may have landed before its rescue was cleared: the
      // matching job already holds this content, so open that, add nothing.
      const canon = canonical(data.job);
      const same = s.jobs.find(j => j.ok && canonical(j.env.job) === canon);
      if (same) {
        try { storage.removeItem(key); } catch { /* still listed; content is safe in the matching job */ }
        return { ok: true, jobId: same.jobId, existing: true };
      }
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      const w = writeNew(s, data.job, null, { kind: 'rescue', fromJobId: data.jobId }, writerTab);
      if (!w.ok) return w;
      try { storage.removeItem(key); } catch { /* still listed; content is safe in the new job */ }
      return w;
    }));
  }

  // ---- Archive import (§4.7) --------------------------------------------------------
  async function importArchive({ text, byteSize, writerTab = null }) {
    const v = validateArchive(text, byteSize);
    if (!v.ok) return fail('invalid', { errors: v.errors, bad: v.bad });
    if (!canWrite) return fail('no-locks');
    let archiveSha;
    try { archiveSha = await sha256(text); } catch { return fail('no-hash'); }
    return guarded(() => withLock(LOCK_CATALOG, () => {
      // Phase 2: plan against a fresh scan. Duplicates judged by canonical only.
      const s = scan();
      const seen = new Set(s.jobs.filter(j => j.ok).map(j => canonical(j.env.job)));
      const plan = [];
      let skipped = 0;
      for (const e of v.entries) {
        if (seen.has(e.canon)) { skipped++; continue; }
        seen.add(e.canon);
        plan.push(e);
      }
      const total = v.entries.length;
      const sameArchive = s.imports.filter(i => i.ok && i.data.archiveSha256 === archiveSha);
      const clearJournals = () => { for (const i of sameArchive) { try { storage.removeItem(i.key); } catch { /* still listed */ } } };
      if (s.jobs.length + plan.length > MAX_JOBS) {
        return fail('cap', { existing: s.jobs.length, adding: plan.length, max: MAX_JOBS });
      }
      if (!plan.length) { clearJournals(); return { ok: true, added: 0, skipped, total }; }
      // Phase 3: journal, read back. A retry reuses the same archive's journal.
      const importId = sameArchive.length ? sameArchive[0].importId : 'I' + randomHex(16);
      const jkey = IMPORT_PREFIX + importId;
      const taken = new Set(s.jobs.map(j => j.jobId));
      const planned = plan.map(e => { const id = unusedId(taken); taken.add(id); return { entryIndex: e.index, jobId: id }; });
      const journal = { v: 1, archiveSha256: archiveSha, at: now(), planned, done: [] };
      let jtext = JSON.stringify(journal);
      let jback = null;
      try { storage.setItem(jkey, jtext); jback = storage.getItem(jkey); } catch { /* checked below */ }
      if (jback !== jtext) {
        if (!sameArchive.length) { try { storage.removeItem(jkey); } catch { /* listed */ } }
        return fail('journal', { added: 0, total: plan.length, skipped });
      }
      // Phase 4: apply. Each job is complete and read back; no existing key is touched.
      for (const [k, e] of plan.entries()) {
        const w = writeNew(s, e.job, e.prefs, { kind: 'import', archiveSha256: archiveSha, entryIndex: e.index }, writerTab, planned[k].jobId);
        if (!w.ok) return fail(w.reason, { added: k, total: plan.length, skipped, importId });
        journal.done.push(planned[k].jobId);
        try { jtext = JSON.stringify(journal); storage.setItem(jkey, jtext); } catch { /* the job is complete; retry dedupes it */ }
      }
      try { storage.removeItem(jkey); } catch { /* listed as incomplete; retry clears it */ }
      clearJournals();
      return { ok: true, added: plan.length, skipped, total };
    }));
  }
  function dismissJournal(key) {
    if (!key.startsWith(IMPORT_PREFIX)) return false;
    try { storage.removeItem(key); return storage.getItem(key) === null; } catch { return false; }
  }

  // ---- Convenience state -------------------------------------------------------------
  function readState() {
    try {
      const raw = storage.getItem(STATE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.v === 1 && JOB_ID_RE.test(String(d.lastOpenedId)) ? d.lastOpenedId : null;
    } catch { return null; }
  }
  function writeState(lastOpenedId) {
    if (!canWrite) return false;
    try { storage.setItem(STATE_KEY, JSON.stringify({ v: 1, lastOpenedId })); return true; } catch { return false; }
  }

  return {
    canWrite, scan, safeScan, create, save, readJob, readRaw, acquireOwner,
    peekLegacy, readLegacy, reconcileLegacy, writeRescue, clearRescue, rescueRoom, dismissRescue, promoteRescue,
    importArchive, dismissJournal, readState, writeState,
  };
}

// All readable jobs, each as its exact stored backup object plus prefs.
// Unreadable records are counted, never silently dropped from the report.
export function buildArchive(scanResult, exportedAt) {
  const readable = scanResult.jobs.filter(j => j.ok);
  const entries = readable.map(j => {
    let job = j.env.job;
    try { job = JSON.parse(j.raw).job; } catch { /* parsed copy is equivalent */ }
    return { job, prefs: j.env.prefs };
  });
  return {
    text: JSON.stringify({ schema: ARCHIVE_SCHEMA, v: 1, exportedAt, entries }),
    count: readable.length,
    unreadable: scanResult.jobs.length - readable.length,
  };
}
