// EP21-02 test fakes for jobs.js: a Storage-like map whose get/set/key/remove
// can throw, hit a quota or mangle a value, and a Web Locks-like adapter
// (exclusive, FIFO, ifAvailable, AbortSignal) that can also be held forever.
// Synthetic only.
import { createHash } from 'node:crypto';

export function fakeStorage({ quotaChars = Infinity } = {}) {
  const m = new Map();
  const faults = { get: null, set: null, key: null, remove: null, mangle: null };
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const quota = () => Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
  const store = {
    map: m,
    faults,
    sets: [], // every successful setItem key, in order
    get length() { return m.size; },
    key(i) {
      if (faults.key && faults.key(i)) throw new Error('key() blocked');
      return [...m.keys()][i] ?? null;
    },
    getItem(k) {
      if (faults.get && faults.get(k)) throw new Error('getItem blocked');
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      v = String(v);
      if (faults.set && faults.set(k, v)) throw quota();
      const next = used() - (m.has(k) ? k.length + m.get(k).length : 0) + k.length + v.length;
      if (next > quotaChars) throw quota();
      m.set(k, faults.mangle && faults.mangle(k) ? v.slice(0, -1) : v);
      store.sets.push(k);
    },
    removeItem(k) {
      if (faults.remove && faults.remove(k)) throw new Error('removeItem blocked');
      m.delete(k);
    },
  };
  return store;
}

export function snapshot(store) { return new Map(store.map); }
// Keys whose bytes differ (added, removed or changed) between two snapshots.
export function changedKeys(before, after) {
  const out = [];
  for (const [k, v] of before) if (after.get(k) !== v) out.push(k);
  for (const k of after.keys()) if (!before.has(k)) out.push(k);
  return out;
}

export function fakeLocks() {
  const held = new Set();
  const queues = new Map();
  const forever = new Set(); // names held by nobody's callback, never released
  async function request(name, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    if (opts.ifAvailable && opts.signal) throw new Error('NotSupportedError');
    const q = queues.get(name) || [];
    queues.set(name, q);
    const busy = held.has(name) || forever.has(name);
    if (opts.ifAvailable && busy) return fn(null);
    if (busy) {
      await new Promise((resolve, reject) => {
        const entry = { resolve };
        q.push(entry);
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const i = q.indexOf(entry);
            if (i >= 0) { q.splice(i, 1); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }
          });
        }
      });
    } else held.add(name);
    try { return await fn({ name, mode: 'exclusive' }); }
    finally {
      const next = q.shift();
      if (next) next.resolve(); else held.delete(name);
    }
  }
  return { request, holdForever: (name) => forever.add(name), held };
}

export const sha256 = async (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let counter = 0;
// Deterministic-enough unique hex for IDs in tests.
export const randomHex = (n) => {
  counter += 1;
  return createHash('sha256').update('id' + counter + Math.random()).digest('hex').slice(0, n);
};
