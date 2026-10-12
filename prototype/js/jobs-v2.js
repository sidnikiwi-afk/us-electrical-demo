// Schema 2 jobs under surface.jobs.v2. (EP-FLOOR-02). Storage, locks and sha256
// are injected. This factory never writes surface.jobs.v1.* or surface.job.v1.
// Older namespaces are not scanned into the v2 job cap.
import * as C from './core.js';
import { cleanPrefs, LOCK_WAIT_MS, MAX_JOBS, MAX_RECORD_CHARS } from './jobs.js';

const PREFIX = 'surface.jobs.v2.';
const JOB_PREFIX = PREFIX + 'job.';
const LOCK_CATALOG = PREFIX + 'lock.catalog';
const JOB_ID_RE = /^J[0-9a-f]{16}$/;
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

function defaultRandomHex(n) {
  const b = new Uint8Array(Math.ceil(n / 2));
  globalThis.crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, n);
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

  // v2 job slots only. Legacy and surface.jobs.v1.* keys are ignored, never written.
  function listJobs() {
    const n = storage.length;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(JOB_PREFIX)) continue;
      const jobId = key.slice(JOB_PREFIX.length);
      let raw = null, readErr = false;
      try { raw = storage.getItem(key); } catch { readErr = true; }
      if (raw === null && !readErr) continue;
      jobs.push({ key, jobId });
    }
    return jobs;
  }

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
    const id = unusedId(new Set(jobs.map(j => j.jobId)));
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
    return { ok: true, jobId: id, writeRev: 1, env: parsed.env };
  }

  function create({ job, prefs = null, origin = { kind: 'new' }, writerTab = null } = {}) {
    return guarded(() => withLock(LOCK_CATALOG, () => {
      const jobs = listJobs();
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

  return { canWrite, create, readJob };
}
