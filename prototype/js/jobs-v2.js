// Schema 2 jobs under surface.jobs.v2. (EP-FLOOR-02). Storage, locks and sha256
// are injected. This factory never writes surface.jobs.v1.* or surface.job.v1.
// v1 envelopes are read with the pure v1 parser, then copied into new v2 slots.
import * as C from './core.js';
import {
  cleanPrefs, LOCK_WAIT_MS, OWNER_WAIT_MS, LOCK_CATALOG as V1_LOCK_CATALOG,
  MAX_JOBS, MAX_RESCUES, MAX_RECORD_CHARS, MAX_ARCHIVE_BYTES, utf8Length,
  LEGACY_KEY, ARCHIVE_SCHEMA, parseEnvelope as parseV1Envelope,
} from './jobs.js';

export { cleanPrefs, MAX_JOBS, MAX_RESCUES, MAX_ARCHIVE_BYTES, LEGACY_KEY, ARCHIVE_SCHEMA };
export const BUILD = 'surface-proto-v13-floor-zones-20261012';
export const JOB_PREFIX = 'surface.jobs.v2.job.';

const PREFIX = 'surface.jobs.v2.';
const MARKER_PREFIX = PREFIX + 'migrated.';
const IMPORT_PREFIX = PREFIX + 'import.';
const RESCUE_PREFIX = PREFIX + 'rescue.';
const STATE_KEY = PREFIX + 'state';
const LOCK_CATALOG = PREFIX + 'lock.catalog';
const V1_PREFIX = 'surface.jobs.v1.';
const V1_JOB_PREFIX = V1_PREFIX + 'job.';
const V1_STATE_KEY = V1_PREFIX + 'state';
const lockJob = (id) => PREFIX + 'lock.job.' + id;
const lockOwner = (id) => PREFIX + 'lock.owner.' + id;
const JOB_ID_RE = /^J[0-9a-f]{16}$/;
const ENVELOPE_ROOM = 2048;
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// Every write in this module stays under surface.jobs.v2. A v1 key is refused.
function assertV2Key(key) {
  if (typeof key !== 'string' || !key.startsWith(PREFIX)) throw new Error('refusing a write outside surface.jobs.v2');
}

function defaultRandomHex(n) {
  const b = new Uint8Array(Math.ceil(n / 2));
  globalThis.crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, n);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}

// Duplicate key for schema 2. savedAt and revision are storage stamps, not content.
export function canonical(job) {
  const { savedAt, revision, ...rest } = C.normaliseJobV2(job);
  return JSON.stringify(sortKeys(rest));
}

function parseMarker(raw) {
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && typeof d.jobId === 'string' ? d : null;
  } catch { return null; }
}

function parseRescue(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || (d.v !== 1 && d.v !== 2)) return null;
    const v = C.validateJobV2(d.job);
    if (!v.ok) return null;
    return {
      jobId: typeof d.jobId === 'string' ? d.jobId : null,
      baseRev: d.baseRev,
      at: d.at,
      job: C.normaliseJobV2(v.job),
    };
  } catch { return null; }
}

function parseJournal(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || (d.v !== 1 && d.v !== 2) || typeof d.archiveSha256 !== 'string' || !Array.isArray(d.planned) || !Array.isArray(d.done)) return null;
    return d;
  } catch { return null; }
}

// Read path only. A v1 envelope, a mismatched id, a bad counter or a schema 2
// payload that validateJobV2 refuses is unreadable and is never rewritten.
function parseEnvelope(raw, jobId) {
  let d;
  try { d = JSON.parse(raw); } catch { return { ok: false, reason: 'the saved record is incomplete or damaged' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.kind !== 'surface-job-envelope' || d.v !== 2) {
    return { ok: false, reason: 'not a saved job record' };
  }
  if (d.jobId !== jobId) return { ok: false, reason: 'the record’s job ID doesn’t match its slot' };
  if (!Number.isInteger(d.writeRev) || d.writeRev < 1) return { ok: false, reason: 'the record’s save counter is damaged' };
  const v = C.validateJobV2(d.job);
  if (!v.ok) return { ok: false, reason: v.errors[0] };
  return {
    ok: true,
    env: {
      kind: 'surface-job-envelope', v: 2, jobId: d.jobId,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : null,
      writeRev: d.writeRev,
      writerTab: typeof d.writerTab === 'string' ? d.writerTab : null,
      origin: d.origin && typeof d.origin === 'object' && !Array.isArray(d.origin) ? d.origin : { kind: 'new' },
      prefs: cleanPrefs(d.prefs),
      job: C.normaliseJobV2(v.job),
    },
  };
}

export function createJobsV2({
  storage, locks = null, sha256 = null, randomHex = defaultRandomHex,
  now = () => new Date().toISOString(), lockWaitMs = LOCK_WAIT_MS, lockDelayMs = 0,
  readOnly = false,
}) {
  const canWrite = !readOnly && !!(locks && typeof locks.request === 'function' && sha256);

  async function withLock(name, fn) {
    if (lockDelayMs) await new Promise(r => setTimeout(r, lockDelayMs));
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

  async function guarded(fn) {
    if (readOnly) return fail('read-only');
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

  // v2 namespace only. v1 keys are not listed, counted or deleted.
  function scan() {
    const res = { jobs: [], markers: new Map(), imports: [], rescues: [], bytes: 0 };
    for (const key of listKeys()) {
      if (!key.startsWith(PREFIX) || key === STATE_KEY) continue;
      let raw = null, readErr = false;
      try { raw = storage.getItem(key); } catch { readErr = true; }
      if (raw === null && !readErr) continue;
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

  function putV2(key, text) {
    assertV2Key(key);
    if (readOnly) throw Object.assign(new Error('read-only'), { code: 'read-only' });
    storage.setItem(key, text);
  }
  function dropV2(key) {
    assertV2Key(key);
    if (readOnly) throw Object.assign(new Error('read-only'), { code: 'read-only' });
    storage.removeItem(key);
  }

  function writeNew(jobs, job, prefs, origin, writerTab, presetId = null) {
    const v = C.validateJobV2(job);
    if (!v.ok) return fail('invalid', { detail: v.errors[0] });
    let id;
    if (presetId) {
      if (!JOB_ID_RE.test(presetId)) return fail('invalid', { detail: 'job id' });
      id = presetId;
    } else {
      try { id = unusedId(new Set(jobs.map(j => j.jobId))); }
      catch (err) { return fail('blocked', { detail: String(err && err.message || err) }); }
    }
    const key = JOB_PREFIX + id;
    if (!key.startsWith(JOB_PREFIX) || storage.getItem(key) !== null) return fail('id-taken');
    const stored = C.normaliseJobV2(v.job);
    if (typeof stored.savedAt !== 'string') stored.savedAt = now();
    const env = {
      kind: 'surface-job-envelope', v: 2, jobId: id, createdAt: now(), writeRev: 1,
      writerTab: writerTab || null,
      origin: origin && typeof origin === 'object' && !Array.isArray(origin) ? origin : { kind: 'new' },
      prefs: cleanPrefs(prefs),
      job: stored,
    };
    const text = JSON.stringify(env);
    if (text.length > MAX_RECORD_CHARS) return fail('too-large', { size: text.length });
    try { putV2(key, text); } catch { return fail('quota'); }
    let back = null;
    try { back = storage.getItem(key); } catch { /* checked below */ }
    if (back !== text) {
      try { dropV2(key); } catch { /* left listed if removal itself fails */ }
      return fail('readback');
    }
    const parsed = parseEnvelope(back, id);
    if (!parsed.ok) {
      try { dropV2(key); } catch { /* own key only */ }
      return fail('readback');
    }
    return { ok: true, jobId: id, writeRev: 1, env: parsed.env, raw: back };
  }

  function create({ job, prefs = null, origin = { kind: 'new' }, writerTab = null } = {}) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      const jobs = scan().jobs;
      if (jobs.length >= MAX_JOBS) return fail('cap', { count: jobs.length });
      return writeNew(jobs, job, prefs, origin, writerTab);
    }));
  }

  function readJob(jobId) {
    if (!JOB_ID_RE.test(String(jobId))) return fail('missing');
    let raw;
    try { raw = storage.getItem(JOB_PREFIX + jobId); } catch { return fail('read-failed'); }
    if (raw === null) return fail('missing');
    const p = parseEnvelope(raw, jobId);
    return p.ok ? { ok: true, env: p.env, raw } : fail('unreadable', { detail: p.reason, raw });
  }

  // Locked compare-and-write of one v2 job. The v1 namespace is not locked or written.
  // A schema 1 record can pass serialiseJob. Reject it before any lock or write.
  function save({ jobId, job, prefs = null, baseRev, writerTab = null }) {
    const checked = C.validateJobV2(job);
    if (!checked.ok) return Promise.resolve(fail('invalid', { detail: checked.errors[0] }));
    let plain;
    try { plain = JSON.parse(C.serialiseJob(job)); }
    catch (err) { return Promise.resolve(fail('invalid', { detail: String(err && err.message || err) })); }
    if (!JOB_ID_RE.test(String(jobId))) return Promise.resolve(fail('missing'));
    return guarded(() => withLock(lockJob(jobId), () => {
      const key = JOB_PREFIX + jobId;
      let raw;
      try { raw = storage.getItem(key); } catch { return fail('read-failed'); }
      if (raw === null) return fail('missing');
      const p = parseEnvelope(raw, jobId);
      if (!p.ok) return fail('unreadable', { detail: p.reason });
      if (p.env.writeRev !== baseRev) return fail('stale', { storedRev: p.env.writeRev, storedWriter: p.env.writerTab || null });
      const env = {
        kind: 'surface-job-envelope', v: 2, jobId, createdAt: p.env.createdAt, writeRev: baseRev + 1,
        writerTab: writerTab || null, origin: p.env.origin,
        prefs: prefs == null ? p.env.prefs : cleanPrefs(prefs),
        job: plain,
      };
      const text = JSON.stringify(env);
      if (text.length > MAX_RECORD_CHARS) return fail('too-large', { size: text.length });
      try { putV2(key, text); } catch { return fail('quota'); }
      let back = null;
      try { back = storage.getItem(key); } catch { /* checked below */ }
      if (back !== text || !parseEnvelope(back, jobId).ok) {
        try {
          putV2(key, raw);
          if (storage.getItem(key) !== raw) return fail('readback');
        } catch { return fail('readback'); }
        return fail('readback');
      }
      return { ok: true, writeRev: env.writeRev, savedAt: plain.savedAt };
    }));
  }

  function remember(s, w) {
    s.jobs.push({
      key: JOB_PREFIX + w.jobId, jobId: w.jobId, raw: w.raw, ok: true, env: w.env, reason: null, size: w.raw.length,
    });
  }

  function jobWithSha(s, sha) {
    return s.jobs.find(j => j.ok && j.env.origin && j.env.origin.v1Sha256 === sha) || null;
  }
  function jobWithCanon(s, canon) {
    return s.jobs.find(j => j.ok && canonical(j.env.job) === canon) || null;
  }
  function findEarlier(s, v1JobId, sha) {
    const job = s.jobs.find(j => j.ok && j.env.origin && j.env.origin.kind === 'v1'
      && j.env.origin.v1JobId === v1JobId && j.env.origin.v1Sha256 && j.env.origin.v1Sha256 !== sha);
    if (job) return { jobId: job.jobId };
    for (const [oldSha, marker] of s.markers) {
      if (oldSha !== sha && marker && marker.v1JobId === v1JobId && typeof marker.jobId === 'string') return { jobId: marker.jobId };
    }
    return null;
  }
  function offerFor(row, earlier) {
    const name = row.up.ok && typeof row.up.job.name === 'string' ? row.up.job.name : row.jobId;
    return {
      v1JobId: row.jobId, name, sha: row.sha, existingJobId: earlier.jobId,
      message: `“${name}” was changed in the older version after it was copied. Add that version as a separate job?`,
    };
  }
  function mayCopyChanged(row, accept, acceptId) {
    return !!accept || (!!acceptId && acceptId === row.jobId);
  }
  function needsCopy(s, row, accept, acceptId) {
    if (!row.up.ok || s.markers.has(row.sha) || jobWithSha(s, row.sha) || jobWithCanon(s, row.canon)) return false;
    if (findEarlier(s, row.jobId, row.sha) && !mayCopyChanged(row, accept, acceptId)) return false;
    return true;
  }

  function writeMarker(s, row, v2JobId) {
    const key = MARKER_PREFIX + row.sha;
    if (!key.startsWith(MARKER_PREFIX) || s.markers.has(row.sha)) return fail('blocked');
    const marker = { v: 1, jobId: v2JobId, v1JobId: row.jobId, byteLength: row.byteLength, at: now() };
    const text = JSON.stringify(marker);
    try { putV2(key, text); } catch { return fail('quota'); }
    let back = null;
    try { back = storage.getItem(key); } catch { /* checked below */ }
    if (back !== text) {
      try { dropV2(key); } catch { return fail('readback'); }
      return fail('readback');
    }
    s.markers.set(row.sha, marker);
    return { ok: true };
  }

  // Readable v1 job envelopes only. The single surface.job.v1 key is not an envelope.
  function listV1Envelopes() {
    const rows = [];
    let unreadable = 0;
    for (const key of listKeys()) {
      if (!key.startsWith(V1_JOB_PREFIX)) continue;
      const jobId = key.slice(V1_JOB_PREFIX.length);
      let raw = null, readErr = false;
      try { raw = storage.getItem(key); } catch { readErr = true; }
      if (raw === null && !readErr) continue;
      if (readErr) { unreadable++; continue; }
      const p = parseV1Envelope(raw, jobId);
      let rawJob = null;
      try { rawJob = JSON.parse(raw).job; } catch { /* unreadable below */ }
      if (!p.ok || !rawJob) { unreadable++; continue; }
      rows.push({ key, jobId, raw, env: p.env, rawJob });
    }
    rows.sort((a, b) => String(a.env.createdAt || '').localeCompare(String(b.env.createdAt || '')) || a.key.localeCompare(b.key));
    return { rows, unreadable };
  }

  async function copyLocked(writerTab, accept, acceptId) {
    const s = scan();
    const listed = listV1Envelopes();
    const prepared = [];
    for (let i = 0; i < listed.rows.length; i++) {
      const row = listed.rows[i];
      let sha;
      try { sha = await sha256(row.raw); }
      catch (err) {
        return { ok: false, reason: 'no-hash', copied: 0, remaining: listed.rows.length - i, offers: [], rejected: 0, detail: String(err && err.message || err) };
      }
      const up = C.upgradeV1(row.rawJob);
      prepared.push({ ...row, sha, byteLength: utf8Length(row.raw), up, canon: up.ok ? canonical(up.job) : null });
    }
    let copied = 0;
    let rejected = 0;
    let markerFailed = false;
    const offers = [];
    const stopped = (reason, index, extra = {}) => {
      let remaining = 0;
      for (let j = index; j < prepared.length; j++) if (needsCopy(s, prepared[j], accept, acceptId)) remaining++;
      return {
        ok: false, reason, copied, remaining, offers, rejected, unreadable: listed.unreadable,
        ...(markerFailed ? { markerFailed: true } : {}), ...extra,
      };
    };
    for (let i = 0; i < prepared.length; i++) {
      const row = prepared[i];
      if (s.markers.has(row.sha)) continue;
      const sameSha = jobWithSha(s, row.sha);
      if (sameSha) {
        const marked = writeMarker(s, row, sameSha.jobId);
        if (!marked.ok) markerFailed = true;
        continue;
      }
      if (!row.up.ok) { rejected++; continue; }
      const sameContent = jobWithCanon(s, row.canon);
      if (sameContent) {
        const marked = writeMarker(s, row, sameContent.jobId);
        if (!marked.ok) markerFailed = true;
        continue;
      }
      const earlier = findEarlier(s, row.jobId, row.sha);
      if (earlier && !mayCopyChanged(row, accept, acceptId)) { offers.push(offerFor(row, earlier)); continue; }
      if (s.jobs.length >= MAX_JOBS) return stopped('cap', i, { count: s.jobs.length });
      const w = writeNew(s.jobs, row.up.job, row.env.prefs, {
        kind: 'v1', v1JobId: row.jobId, v1Sha256: row.sha, v1WriteRev: row.env.writeRev,
      }, writerTab);
      if (!w.ok) return stopped(w.reason, i, w.detail ? { detail: w.detail } : {});
      if (canonical(w.env.job) !== row.canon) {
        try { dropV2(JOB_PREFIX + w.jobId); } catch { /* listed unreadable if it remains */ }
        return stopped('readback', i);
      }
      remember(s, w);
      const marked = writeMarker(s, row, w.jobId);
      if (!marked.ok) markerFailed = true;
      copied++;
    }
    return {
      ok: true, copied, remaining: 0, offers, rejected, unreadable: listed.unreadable,
      ...(markerFailed ? { markerFailed: true } : {}),
    };
  }

  // Copy readable v1 envelopes into new schema 2 jobs. Repeated unchanged boots add 0.
  // accept:true adds a changed older source as another v2 job; it never overwrites one.
  async function reconcileV1({ writerTab = null, accept = false, acceptId = null } = {}) {
    if (readOnly) return { ok: false, reason: 'read-only', copied: 0, remaining: null, offers: [] };
    if (!canWrite) return { ok: false, reason: 'no-locks', copied: 0, remaining: null, offers: [] };
    try {
      const outer = await withLock(LOCK_CATALOG, async () => {
        const inner = await withLock(V1_LOCK_CATALOG, () => copyLocked(writerTab, accept, acceptId));
        if (inner && inner.ok === false && inner.reason === 'lock-timeout') {
          let remaining = null;
          try {
            const s = scan();
            const seen = new Set(s.jobs.filter(j => j.ok && j.env.origin && j.env.origin.kind === 'v1').map(j => j.env.origin.v1JobId));
            remaining = listV1Envelopes().rows.filter(r => !seen.has(r.jobId)).length;
          } catch { remaining = null; }
          return { ok: false, reason: 'lock-timeout', copied: 0, remaining, offers: [] };
        }
        return inner;
      });
      if (outer && outer.ok === false && outer.reason === 'lock-timeout' && outer.copied == null) {
        return { ok: false, reason: 'lock-timeout', copied: 0, remaining: null, offers: [] };
      }
      return outer;
    } catch (err) {
      return { ok: false, reason: 'blocked', detail: String(err && err.message || err), copied: 0, remaining: null, offers: [] };
    }
  }

  function readRaw(key) { try { return storage.getItem(key); } catch { return null; } }

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
  function legacyMarker(sha, jobId, byteLength) {
    const key = MARKER_PREFIX + sha;
    const text = JSON.stringify({ v: 1, jobId, byteLength, at: now() });
    try { putV2(key, text); } catch { return false; }
    return readRaw(key) === text;
  }
  async function reconcileLegacy({ writerTab = null, accept = false } = {}) {
    const L = await readLegacy();
    if (L.status !== 'ok') return { ok: true, status: 'none', legacy: L };
    if (!L.sha) return fail('no-hash', { legacy: L });
    const prepared = prepareStoredJob(L.job);
    if (!prepared.ok) return { ok: true, status: 'rejected', legacy: L, detail: prepared.errors[0] };
    if (readOnly) return fail('read-only', { legacy: L });
    if (!canWrite) return fail('no-locks', { legacy: L });
    const r = await guarded(() => withLock(LOCK_CATALOG, () => {
      let cur;
      try { cur = storage.getItem(LEGACY_KEY); } catch { return fail('read-failed'); }
      if (cur !== L.raw) return fail('legacy-changed');
      const s = scan();
      const m = s.markers.get(L.sha);
      if (m) return { ok: true, status: 'migrated', jobId: m.jobId };
      const markerUnreadable = s.markers.has(L.sha);
      const canon = canonical(prepared.job);
      const prior = s.jobs.find(j => j.ok && j.env.origin && j.env.origin.kind === 'legacy' && j.env.origin.legacySha256 === L.sha);
      if (prior) {
        if (!markerUnreadable) legacyMarker(L.sha, prior.jobId, L.byteLength);
        return { ok: true, status: 'repaired', jobId: prior.jobId };
      }
      const same = s.jobs.find(j => j.ok && canonical(j.env.job) === canon);
      if (same) {
        if (!markerUnreadable) legacyMarker(L.sha, same.jobId, L.byteLength);
        return { ok: true, status: 'migrated', jobId: same.jobId, sameContent: true };
      }
      if (markerUnreadable) return { ok: true, status: 'skipped', markerUnreadable: true };
      if (s.markers.size > 0 && !accept) return { ok: true, status: 'offer' };
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      const w = writeNew(s.jobs, prepared.job, null, { kind: 'legacy', legacySha256: L.sha }, writerTab);
      if (!w.ok) return w;
      if (canonical(w.env.job) !== canon) {
        try { dropV2(JOB_PREFIX + w.jobId); } catch { /* listed if it remains */ }
        return fail('readback');
      }
      remember(s, w);
      const marked = markerUnreadable || legacyMarker(L.sha, w.jobId, L.byteLength);
      return { ok: true, status: 'migrated', jobId: w.jobId, created: true, ...(!marked ? { markerFailed: true } : {}) };
    }));
    return { ...r, legacy: L };
  }

  function rescueCount() {
    return listKeys().filter(k => k.startsWith(RESCUE_PREFIX)).length;
  }
  function spareRescueKey(avoid) {
    for (let i = 0; i < 8; i++) {
      const key = RESCUE_PREFIX + 'kept-' + randomHex(8);
      if (key !== avoid && storage.getItem(key) === null) return key;
    }
    return null;
  }
  // A failed update must not report success. One bad write is put back on the
  // same key. If that key keeps mangling bytes, the previous text is copied to
  // another v2 rescue key and the bad key is removed, still within the cap.
  function recoverRescue(key, prior) {
    if (prior === null) {
      try { dropV2(key); } catch { /* listed if removal fails */ }
      return fail('readback');
    }
    try {
      putV2(key, prior);
      if (storage.getItem(key) === prior) return fail('readback');
    } catch { /* the same key will not hold the previous bytes */ }
    try { dropV2(key); } catch { /* still counted below */ }
    if (rescueCount() >= MAX_RESCUES) return fail('readback');
    const alt = spareRescueKey(key);
    if (!alt) return fail('readback');
    try {
      putV2(alt, prior);
      if (storage.getItem(alt) === prior) return fail('readback', { key: alt });
      try { dropV2(alt); } catch { /* listed */ }
    } catch { /* copy did not land */ }
    return fail('readback');
  }
  function writeRescue({ writerTab, jobId = null, baseRev = null, job }) {
    if (readOnly) return fail('read-only');
    const checked = C.validateJobV2(job);
    if (!checked.ok) return fail('invalid');
    let plain;
    try { plain = JSON.parse(C.serialiseJob(job)); } catch { return fail('invalid'); }
    const key = RESCUE_PREFIX + writerTab;
    let prior = null;
    try { prior = storage.getItem(key); } catch { return fail('read-failed'); }
    try {
      if (prior === null && rescueCount() >= MAX_RESCUES) return fail('rescue-full');
      const text = JSON.stringify({ v: 2, jobId, baseRev, at: now(), job: plain });
      if (text.length > MAX_RECORD_CHARS) return fail('too-large');
      putV2(key, text);
      let back = null;
      try { back = storage.getItem(key); } catch { back = null; }
      if (back === text && parseRescue(back)) return { ok: true, key };
      return recoverRescue(key, prior);
    } catch (err) {
      if (readOnly || (err && err.code === 'read-only')) return fail('read-only');
      return fail('quota');
    }
  }
  function clearRescue(writerTab) {
    if (readOnly) return;
    const key = RESCUE_PREFIX + writerTab;
    try { if (storage.getItem(key) !== null) dropV2(key); } catch { /* listed in Recover */ }
  }
  function rescueRoom(writerTab) {
    try {
      if (storage.getItem(RESCUE_PREFIX + writerTab) !== null) return true;
      return listKeys().filter(k => k.startsWith(RESCUE_PREFIX)).length < MAX_RESCUES;
    } catch { return false; }
  }
  function dismissRescue(key) {
    if (readOnly) return false;
    if (!String(key).startsWith(RESCUE_PREFIX)) return false;
    try { dropV2(key); return storage.getItem(key) === null; } catch { return false; }
  }
  function promoteRescue({ key, writerTab = null }) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      if (!String(key).startsWith(RESCUE_PREFIX)) return fail('invalid');
      let raw;
      try { raw = storage.getItem(key); } catch { return fail('read-failed'); }
      const data = raw === null ? null : parseRescue(raw);
      if (!data) return fail('unreadable');
      const s = scan();
      const canon = canonical(data.job);
      const same = s.jobs.find(j => j.ok && canonical(j.env.job) === canon);
      if (same) {
        try { dropV2(key); } catch { /* still listed; content is safe in the matching job */ }
        return { ok: true, jobId: same.jobId, existing: true };
      }
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      const w = writeNew(s.jobs, data.job, null, { kind: 'rescue', fromJobId: data.jobId }, writerTab);
      if (!w.ok) return w;
      remember(s, w);
      try { dropV2(key); } catch { /* still listed; content is safe in the new job */ }
      return w;
    }));
  }

  async function importArchive({ text, byteSize, writerTab = null }) {
    const v = validateArchive(text, byteSize);
    if (!v.ok) return fail('invalid', { errors: v.errors, bad: v.bad });
    if (readOnly) return fail('read-only');
    if (!canWrite) return fail('no-locks');
    let archiveSha;
    try { archiveSha = await sha256(text); } catch { return fail('no-hash'); }
    return guarded(() => withLock(LOCK_CATALOG, () => {
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
      const clearJournals = () => { for (const i of sameArchive) { try { dropV2(i.key); } catch { /* still listed */ } } };
      if (s.jobs.length + plan.length > MAX_JOBS) {
        return fail('cap', { existing: s.jobs.length, adding: plan.length, max: MAX_JOBS });
      }
      if (!plan.length) { clearJournals(); return { ok: true, added: 0, skipped, total }; }
      const importId = sameArchive.length ? sameArchive[0].importId : 'I' + randomHex(16);
      const jkey = IMPORT_PREFIX + importId;
      const taken = new Set(s.jobs.map(j => j.jobId));
      const planned = plan.map(e => { const id = unusedId(taken); taken.add(id); return { entryIndex: e.index, jobId: id }; });
      const journal = { v: 2, archiveSha256: archiveSha, at: now(), planned, done: [] };
      let jtext = JSON.stringify(journal);
      let jback = null;
      try { putV2(jkey, jtext); jback = storage.getItem(jkey); } catch { /* checked below */ }
      if (jback !== jtext) {
        if (!sameArchive.length) { try { dropV2(jkey); } catch { /* listed */ } }
        return fail('journal', { added: 0, total: plan.length, skipped });
      }
      for (const [k, e] of plan.entries()) {
        const w = writeNew(s.jobs, e.job, e.prefs, { kind: 'import', archiveSha256: archiveSha, entryIndex: e.index }, writerTab, planned[k].jobId);
        if (!w.ok) return fail(w.reason, { added: k, total: plan.length, skipped, importId });
        remember(s, w);
        journal.done.push(planned[k].jobId);
        try { jtext = JSON.stringify(journal); putV2(jkey, jtext); } catch { /* the job is complete; retry dedupes it */ }
      }
      try { dropV2(jkey); } catch { /* listed as incomplete; retry clears it */ }
      clearJournals();
      return { ok: true, added: plan.length, skipped, total };
    }));
  }
  function dismissJournal(key) {
    if (readOnly) return false;
    if (!String(key).startsWith(IMPORT_PREFIX)) return false;
    try { dropV2(key); return storage.getItem(key) === null; } catch { return false; }
  }

  function readState() {
    try {
      const raw = storage.getItem(STATE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && (d.v === 1 || d.v === 2) && JOB_ID_RE.test(String(d.lastOpenedId))) return d.lastOpenedId;
      }
    } catch { /* fall through to the read-only v1 state */ }
    try {
      const raw = storage.getItem(V1_STATE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !JOB_ID_RE.test(String(d.lastOpenedId))) return null;
      const hit = scan().jobs.find(j => j.ok && j.env.origin && j.env.origin.kind === 'v1' && j.env.origin.v1JobId === d.lastOpenedId);
      return hit ? hit.jobId : null;
    } catch { return null; }
  }
  function writeState(lastOpenedId) {
    if (readOnly || !canWrite || !JOB_ID_RE.test(String(lastOpenedId))) return false;
    try { putV2(STATE_KEY, JSON.stringify({ v: 2, lastOpenedId })); return true; } catch { return false; }
  }

  function peekNewer() {
    try { return listKeys().some(key => key.startsWith('surface.jobs.v3.')); }
    catch { return false; }
  }

  function listLegacyKept() {
    const out = [];
    for (const key of listKeys()) {
      if (!key.startsWith(V1_PREFIX)) continue;
      const rescue = key.startsWith(V1_PREFIX + 'rescue.');
      const journal = key.startsWith(V1_PREFIX + 'import.');
      const jobKey = key.startsWith(V1_JOB_PREFIX);
      if (!rescue && !journal && !jobKey) continue;
      let raw = null;
      try { raw = storage.getItem(key); } catch { raw = null; }
      if (raw === null) continue;
      if (jobKey) {
        const parsed = parseV1Envelope(raw, key.slice(V1_JOB_PREFIX.length));
        if (parsed.ok) continue;
        out.push({ kind: 'v1-job', key, raw, reason: parsed.reason });
      } else if (rescue) out.push({ kind: 'v1-rescue', key, raw });
      else out.push({ kind: 'v1-import', key, raw });
    }
    return out;
  }

  function promoteLegacyKept({ key, writerTab = null }) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      if (typeof key !== 'string' || !key.startsWith(V1_PREFIX + 'rescue.')) return fail('invalid');
      let raw;
      try { raw = storage.getItem(key); } catch { return fail('read-failed'); }
      let data = null;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!data || !data.job) return fail('unreadable');
      const prepared = prepareStoredJob(data.job);
      if (!prepared.ok) return fail('invalid', { detail: prepared.errors[0] });
      const s = scan();
      const canon = canonical(prepared.job);
      const same = s.jobs.find(j => j.ok && canonical(j.env.job) === canon);
      if (same) return { ok: true, jobId: same.jobId, existing: true };
      if (s.jobs.length >= MAX_JOBS) return fail('cap', { count: s.jobs.length });
      const w = writeNew(s.jobs, prepared.job, null, { kind: 'legacy', from: 'v1-rescue' }, writerTab);
      if (w.ok) remember(s, w);
      return w;
    }));
  }

  return {
    canWrite, scan, safeScan, create, save, readJob, readRaw, acquireOwner,
    peekLegacy, readLegacy, reconcileLegacy, writeRescue, clearRescue, rescueRoom, dismissRescue, promoteRescue,
    importArchive, dismissJournal, readState, writeState, reconcileV1, peekNewer, listLegacyKept, promoteLegacyKept,
  };
}

export function createJobs(opts) { return createJobsV2(opts); }

function prepareStoredJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return { ok: false, errors: ['not an object'] };
  if (job.schemaVersion === 2) {
    const v = C.validateJobV2(job);
    return v.ok ? { ok: true, job: C.normaliseJobV2(v.job) } : v;
  }
  if (job.schemaVersion === 1) return C.upgradeV1(job);
  return { ok: false, errors: ['This backup was made by a newer version of this app.'] };
}

export function isArchiveText(text) {
  try { const d = JSON.parse(text); return !!d && typeof d === 'object' && d.schema === ARCHIVE_SCHEMA; }
  catch { return false; }
}

export function validateArchive(text, byteSize) {
  const size = Number.isFinite(byteSize) ? byteSize : utf8Length(text);
  if (size > MAX_ARCHIVE_BYTES) {
    return { ok: false, errors: [`the file is ${(size / 1e6).toFixed(1)} MB; an archive can be at most ${MAX_ARCHIVE_BYTES / 1e6} MB`], bad: [] };
  }
  let d;
  try { d = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'], bad: [] }; }
  if (!d || typeof d !== 'object' || d.schema !== ARCHIVE_SCHEMA) return { ok: false, errors: ['not an all-jobs archive'], bad: [] };
  if (d.v !== 1 && d.v !== 2) return { ok: false, errors: ['made by a newer version of this app'], bad: [] };
  if (!Array.isArray(d.entries) || d.entries.length < 1 || d.entries.length > MAX_JOBS) {
    const n = Array.isArray(d.entries) ? d.entries.length : 0;
    return { ok: false, errors: [`it holds ${n} jobs; an archive must hold 1 to ${MAX_JOBS}`], bad: [] };
  }
  const bad = [];
  const entries = [];
  for (const [i, e] of d.entries.entries()) {
    if (!e || typeof e !== 'object') { bad.push({ index: i, reason: 'not a job entry' }); continue; }
    const prepared = prepareStoredJob(e.job);
    if (!prepared.ok) { bad.push({ index: i, reason: prepared.errors[0] }); continue; }
    const text1 = JSON.stringify(prepared.job);
    if (text1.length + ENVELOPE_ROOM > MAX_RECORD_CHARS) { bad.push({ index: i, reason: 'too large to store on this device' }); continue; }
    entries.push({ index: i, job: prepared.job, prefs: cleanPrefs(e.prefs), canon: canonical(prepared.job) });
  }
  if (bad.length) return { ok: false, errors: bad.map(b => `job ${b.index + 1}: ${b.reason}`), bad };
  return { ok: true, entries };
}

export function buildArchive(scanResult, exportedAt) {
  const readable = scanResult.jobs.filter(j => j.ok);
  const entries = readable.map(j => {
    let job = j.env.job;
    try { job = JSON.parse(j.raw).job; } catch { /* parsed copy is equivalent */ }
    return { job, prefs: j.env.prefs };
  });
  return {
    text: JSON.stringify({ schema: ARCHIVE_SCHEMA, v: 2, exportedAt, entries }),
    count: readable.length,
    unreadable: scanResult.jobs.length - readable.length,
  };
}
