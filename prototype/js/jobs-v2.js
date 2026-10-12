// Schema 2 jobs under surface.jobs.v2. (EP-FLOOR-02). Storage, locks and sha256
// are injected. This factory never writes surface.jobs.v1.* or surface.job.v1.
// v1 envelopes are read with the pure v1 parser, then copied into new v2 slots.
import * as C from './core.js';
import {
  cleanPrefs, LOCK_WAIT_MS, LOCK_CATALOG as V1_LOCK_CATALOG, MAX_JOBS, MAX_RECORD_CHARS, utf8Length,
  parseEnvelope as parseV1Envelope,
} from './jobs.js';

const PREFIX = 'surface.jobs.v2.';
const JOB_PREFIX = PREFIX + 'job.';
const MARKER_PREFIX = PREFIX + 'migrated.';
const IMPORT_PREFIX = PREFIX + 'import.';
const RESCUE_PREFIX = PREFIX + 'rescue.';
const STATE_KEY = PREFIX + 'state';
const LOCK_CATALOG = PREFIX + 'lock.catalog';
const V1_JOB_PREFIX = 'surface.jobs.v1.job.';
const lockJob = (id) => PREFIX + 'lock.job.' + id;
const JOB_ID_RE = /^J[0-9a-f]{16}$/;
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

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
function canonicalV2(job) {
  const { savedAt, revision, ...rest } = C.normaliseJobV2(job);
  return JSON.stringify(sortKeys(rest));
}

function parseMarker(raw) {
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && typeof d.jobId === 'string' ? d : null;
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
}) {
  const canWrite = !!(locks && typeof locks.request === 'function' && sha256);

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
        res.imports.push({ key, importId: key.slice(IMPORT_PREFIX.length), raw, ok: false, data: null });
      } else if (key.startsWith(RESCUE_PREFIX)) {
        res.rescues.push({ key, writerTab: key.slice(RESCUE_PREFIX.length), raw, ok: false, data: null });
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

  function writeNew(jobs, job, prefs, origin, writerTab) {
    const v = C.validateJobV2(job);
    if (!v.ok) return fail('invalid', { detail: v.errors[0] });
    let id;
    try { id = unusedId(new Set(jobs.map(j => j.jobId))); }
    catch (err) { return fail('blocked', { detail: String(err && err.message || err) }); }
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
    try { storage.setItem(key, text); } catch { return fail('quota'); }
    let back = null;
    try { back = storage.getItem(key); } catch { /* checked below */ }
    if (back !== text) {
      try { storage.removeItem(key); } catch { /* left listed if removal itself fails */ }
      return fail('readback');
    }
    const parsed = parseEnvelope(back, id);
    if (!parsed.ok) {
      try { storage.removeItem(key); } catch { /* own key only */ }
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
      try { storage.setItem(key, text); } catch { return fail('quota'); }
      let back = null;
      try { back = storage.getItem(key); } catch { /* checked below */ }
      if (back !== text || !parseEnvelope(back, jobId).ok) {
        try {
          storage.setItem(key, raw);
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
    return s.jobs.find(j => j.ok && canonicalV2(j.env.job) === canon) || null;
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
  function needsCopy(s, row, accept) {
    if (!row.up.ok || s.markers.has(row.sha) || jobWithSha(s, row.sha) || jobWithCanon(s, row.canon)) return false;
    if (findEarlier(s, row.jobId, row.sha) && !accept) return false;
    return true;
  }

  function writeMarker(s, row, v2JobId) {
    const key = MARKER_PREFIX + row.sha;
    if (!key.startsWith(MARKER_PREFIX) || s.markers.has(row.sha)) return fail('blocked');
    const marker = { v: 1, jobId: v2JobId, v1JobId: row.jobId, byteLength: row.byteLength, at: now() };
    const text = JSON.stringify(marker);
    try { storage.setItem(key, text); } catch { return fail('quota'); }
    let back = null;
    try { back = storage.getItem(key); } catch { /* checked below */ }
    if (back !== text) {
      try { storage.removeItem(key); } catch { return fail('readback'); }
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

  async function copyLocked(writerTab, accept) {
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
      prepared.push({ ...row, sha, byteLength: utf8Length(row.raw), up, canon: up.ok ? canonicalV2(up.job) : null });
    }
    let copied = 0;
    let rejected = 0;
    let markerFailed = false;
    const offers = [];
    const stopped = (reason, index, extra = {}) => {
      let remaining = 0;
      for (let j = index; j < prepared.length; j++) if (needsCopy(s, prepared[j], accept)) remaining++;
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
      if (earlier && !accept) { offers.push(offerFor(row, earlier)); continue; }
      if (s.jobs.length >= MAX_JOBS) return stopped('cap', i, { count: s.jobs.length });
      const w = writeNew(s.jobs, row.up.job, row.env.prefs, {
        kind: 'v1', v1JobId: row.jobId, v1Sha256: row.sha, v1WriteRev: row.env.writeRev,
      }, writerTab);
      if (!w.ok) return stopped(w.reason, i, w.detail ? { detail: w.detail } : {});
      if (canonicalV2(w.env.job) !== row.canon) {
        try { storage.removeItem(JOB_PREFIX + w.jobId); } catch { /* listed unreadable if it remains */ }
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
  async function reconcileV1({ writerTab = null, accept = false } = {}) {
    if (!canWrite) return { ok: false, reason: 'no-locks', copied: 0, remaining: null, offers: [] };
    try {
      const outer = await withLock(LOCK_CATALOG, async () => {
        const inner = await withLock(V1_LOCK_CATALOG, () => copyLocked(writerTab, accept));
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

  return { canWrite, create, readJob, scan, safeScan, save, reconcileV1 };
}
