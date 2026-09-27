// Pure job record, pricing, validation, CSV and serialisation.
// No DOM, no storage, no network. All money is integer pence.
// Example rates only — nothing here is a real quotation or installation advice.

export const SCHEMA = 'surface-job';
export const SCHEMA_VERSION = 1;

export const LIMITS = {
  maxWallM: 20,        // room width / depth
  minWallM: 0.1,
  maxHeightM: 5,
  minHeightM: 0.1,
  maxTextLen: 500,     // notes and job name fields
  maxItems: 200,
  maxStrokesPerView: 100,
  maxPointsPerStroke: 500,
  historyLimit: 50,
};

// Fitting types. The first five are chargeable work types; the last two are excluded.
export const TYPES = {
  surface:    { label: 'New surface socket',    symbol: 'SS', defaultHeightMm: 450,  chargeable: true },
  recessed:   { label: 'New recessed socket',   symbol: 'RS', defaultHeightMm: 450,  chargeable: true },
  replacement:{ label: 'Replacement socket',    symbol: 'RP', defaultHeightMm: 450,  chargeable: true },
  switch:     { label: 'Switch',                symbol: 'SW', defaultHeightMm: 1200, chargeable: true },
  downlight:  { label: 'Downlight',             symbol: 'DL', defaultHeightMm: null, chargeable: true }, // ceiling
  existing:   { label: 'Existing – no work',    symbol: 'EX', defaultHeightMm: 450,  chargeable: false },
  unknown:    { label: 'Unknown – unpriced',    symbol: '?',  defaultHeightMm: 450,  chargeable: false },
};

export const RATE_KEYS = ['surface', 'recessed', 'replacement', 'switch', 'downlight'];
export const WALLS = ['A', 'B', 'C', 'D'];
export const VIEWS = ['PLAN', 'A', 'B', 'C', 'D']; // annotation views

export const CEILING = 'CEIL';

export function defaultRates() {
  // Example rates only, integer pence. replacement left unpriced in sample only.
  return { surface: 3500, recessed: 5500, replacement: 1500, switch: 2500, downlight: 3000 };
}

export function blankJob(name = 'Untitled room') {
  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    name: String(name).slice(0, LIMITS.maxTextLen),
    createdAt: new Date().toISOString(),
    savedAt: null,
    revision: 1,
    room: { widthM: null, depthM: null, heightM: null }, // null = not entered yet
    nextId: 1,
    items: [],       // {id, type, wall, fromLeftMm, heightMm, notes}
    rates: defaultRates(),
    jobNotes: '',
    annotations: { PLAN: [], A: [], B: [], C: [], D: [] }, // strokes: {points:[[x,y],...]}
    notePins: [],    // {id, view, x, y, text}
    sample: false,
  };
}

export function makeId(job) {
  return 'F' + job.nextId;
}

export function placeItem(job, type, wall, fromLeftMm, heightMm, notes = '') {
  if (!TYPES[type]) throw new Error(`unknown fitting type "${type}"`);
  if (!(WALLS.includes(wall) || wall === CEILING)) throw new Error(`unknown wall "${wall}"`);
  if (job.items.length >= LIMITS.maxItems) throw new Error('too many fittings');
  const id = makeId(job);
  job.items.push({ id, type, wall, fromLeftMm: Math.round(fromLeftMm), heightMm: Math.round(heightMm), notes: String(notes).slice(0, LIMITS.maxTextLen) });
  job.nextId += 1;
  return id;
}

export function wallLengthMm(room, wall) {
  if (!room.widthM || !room.depthM) return 0;
  return (wall === 'A' || wall === 'C') ? Math.round(room.widthM * 1000) : Math.round(room.depthM * 1000);
}

export function ceilingHeightMm(room) {
  return room.heightM ? Math.round(room.heightM * 1000) : 0;
}

export function maxFromLeft(job, item) {
  if (item.wall === CEILING) return wallLengthMm(job.room, 'A'); // ceiling x across width
  return wallLengthMm(job.room, item.wall);
}

export function maxHeight(job, item) {
  // For ceiling fittings heightMm stores the y coordinate across the room depth.
  if (item.wall === CEILING) return wallLengthMm(job.room, 'B');
  return ceilingHeightMm(job.room);
}

export function clampItem(job, item) {
  const maxL = maxFromLeft(job, item);
  const maxH = maxHeight(job, item);
  const it = job.items.find(i => i.id === item.id);
  if (!it) return false;
  let changed = false;
  let l = Math.round(Number(it.fromLeftMm));
  let h = Math.round(Number(it.heightMm));
  if (!Number.isFinite(l) || l < 0) { l = 0; changed = true; }
  if (l > maxL) { l = maxL; changed = true; }
  if (!Number.isFinite(h) || h < 0) { h = 0; changed = true; }
  if (h > maxH) { h = maxH; changed = true; }
  it.fromLeftMm = l; it.heightMm = h;
  return changed;
}

// Items that would fall outside if the room changed to the given size.
export function itemsOutside(job, widthM, depthM, heightM) {
  const trial = { ...job, room: { widthM, depthM, heightM } };
  return job.items.filter(it => {
    const maxL = maxFromLeft(trial, it);
    const maxH = maxHeight(trial, it);
    return it.fromLeftMm > maxL || it.heightMm > maxH;
  });
}

export function moveOutsideItemsToEdge(job, widthM, depthM, heightM) {
  // Clamp every item against the *new* size passed in, not job.room (the
  // caller may not have applied it yet). Non-finite values become 0.
  const trial = { ...job, room: { widthM, depthM, heightM } };
  job.items.forEach(it => {
    const maxL = maxFromLeft(trial, it);
    const maxH = maxHeight(trial, it);
    const l = Number.isFinite(it.fromLeftMm) ? it.fromLeftMm : 0;
    const h = Number.isFinite(it.heightMm) ? it.heightMm : 0;
    it.fromLeftMm = Math.max(0, Math.min(Math.round(l), maxL));
    it.heightMm = Math.max(0, Math.min(Math.round(h), maxH));
  });
}

// ---- Pricing -----------------------------------------------------------

export function rateFor(job, type) {
  // Returns integer pence, or null when unpriced (never zero-by-default).
  const v = job.rates[type];
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function breakdown(job) {
  const rows = [];
  for (const key of RATE_KEYS) {
    const qty = job.items.filter(i => i.type === key).length;
    if (qty === 0) continue;
    const rate = rateFor(job, key);
    rows.push({
      type: key, label: TYPES[key].label, qty,
      ratePence: rate,
      linePence: rate === null ? null : rate * qty,
      status: rate === null ? 'unpriced' : 'priced',
    });
  }
  const unknownQty = job.items.filter(i => i.type === 'unknown').length;
  const existingQty = job.items.filter(i => i.type === 'existing').length;
  return {
    rows,
    unknownQty,
    existingQty,
    totalPence: rows.reduce((s, r) => s + (r.linePence ?? 0), 0),
    unpricedCount: rows.filter(r => r.status === 'unpriced').length + unknownQty,
    chargeableCount: rows.reduce((s, r) => s + r.qty, 0),
    complete: rows.every(r => r.status === 'priced') && unknownQty === 0,
  };
}

export function formatPence(p) {
  if (p === null || p === undefined) return '—';
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  return `${sign}£${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// ---- Serialisation, backup validation -----------------------------------

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

export function validateRoom(room, errs, prefix = 'room') {
  for (const k of ['widthM', 'depthM', 'heightM']) {
    const v = room?.[k];
    if (!isFiniteNum(v)) { errs.push(`${prefix}.${k}: missing or not a number`); continue; }
    const max = k === 'heightM' ? LIMITS.maxHeightM : LIMITS.maxWallM;
    if (!(v >= LIMITS.minWallM && v <= max)) errs.push(`${prefix}.${k}: ${v} out of bounds`);
  }
}

export function validateJob(job) {
  // Returns {ok:true, job} or {ok:false, errors:[string]}. Atomic: never mutates input.
  const errs = [];
  if (!job || typeof job !== 'object') return { ok: false, errors: ['not an object'] };
  if (job.schema !== SCHEMA) errs.push(`schema: expected "${SCHEMA}"`);
  if (job.schemaVersion !== SCHEMA_VERSION) errs.push(`schemaVersion: expected ${SCHEMA_VERSION}`);
  if (typeof job.name !== 'string' || job.name.length > LIMITS.maxTextLen) errs.push('name: invalid');
  validateRoom(job.room, errs);
  if (!Number.isInteger(job.nextId) || job.nextId < 1) errs.push('nextId: invalid');
  if (!Array.isArray(job.items)) { errs.push('items: not an array'); }
  else {
    if (job.items.length > LIMITS.maxItems) errs.push(`items: too many (max ${LIMITS.maxItems})`);
    const seen = new Set();
    for (const [i, it] of job.items.entries()) {
      const w = `items[${i}]`;
      if (!it || typeof it !== 'object') { errs.push(`${w}: not an object`); continue; }
      if (!/^F\d+$/.test(it.id ?? '')) errs.push(`${w}.id: bad format`);
      else if (Number(parseInt(it.id.slice(1))) >= job.nextId) errs.push(`${w}.id: exceeds nextId`);
      else if (seen.has(it.id)) errs.push(`duplicate id ${it.id}`);
      seen.add(it.id);
      if (!TYPES[it.type]) errs.push(`${w}.type: unknown "${it.type}"`);
      const wallOk = WALLS.includes(it.wall) || it.wall === CEILING;
      if (!wallOk) errs.push(`${w}.wall: invalid`);
      if (!Number.isInteger(it.fromLeftMm) || it.fromLeftMm < 0) errs.push(`${w}.fromLeftMm: invalid`);
      if (!Number.isInteger(it.heightMm) || it.heightMm < 0) errs.push(`${w}.heightMm: invalid`);
      if (typeof it.notes !== 'string' || it.notes.length > LIMITS.maxTextLen) errs.push(`${w}.notes: invalid`);
      if (wallOk && TYPES[it.type] && Number.isInteger(it.fromLeftMm) && Number.isInteger(it.heightMm)
        && isFiniteNum(job.room?.widthM) && isFiniteNum(job.room?.depthM) && isFiniteNum(job.room?.heightM)) {
        const trial = { room: job.room };
        const fake = { wall: it.wall, fromLeftMm: it.fromLeftMm, heightMm: it.heightMm };
        if (fake.fromLeftMm > maxFromLeft(trial, fake)) errs.push(`${w}.fromLeftMm: outside wall`);
        if (fake.heightMm > maxHeight(trial, fake)) errs.push(`${w}.heightMm: outside room`);
      }
    }
  }
  if (!job.rates || typeof job.rates !== 'object') errs.push('rates: missing');
  else {
    for (const k of RATE_KEYS) {
      const v = job.rates[k];
      if (v === null || v === undefined) continue; // unpriced is allowed
      if (!Number.isInteger(v) || v <= 0 || v > 100000000) errs.push(`rates.${k}: must be positive whole pence or null`);
    }
  }
  if (typeof job.jobNotes !== 'string' || job.jobNotes.length > 5000) errs.push('jobNotes: invalid');
  const ann = job.annotations ?? {};
  if (typeof ann !== 'object' || Array.isArray(ann)) errs.push('annotations: not an object');
  else {
    for (const view of Object.keys(ann)) {
      if (!VIEWS.includes(view)) { errs.push(`annotations.${view}: unknown view`); continue; }
      const strokes = ann[view];
      if (strokes == null) continue; // sparse backup: normaliseJob fills the missing view with []
      if (!Array.isArray(strokes) || strokes.length > LIMITS.maxStrokesPerView) { errs.push(`annotations.${view}: invalid`); continue; }
      for (const [si, s] of strokes.entries()) {
        if (!s || typeof s !== 'object' || !Array.isArray(s.points) || s.points.length < 1 || s.points.length > LIMITS.maxPointsPerStroke) {
          errs.push(`annotations.${view}[${si}]: bad stroke`); break;
        }
        const okPts = s.points.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!okPts) { errs.push(`annotations.${view}[${si}]: non-finite point`); break; }
      }
    }
  }
  if (job.notePins === undefined || job.notePins === null) {
    // older backup without pins: normaliseJob fills [] — not an error
  } else if (!Array.isArray(job.notePins) || job.notePins.length > 100) {
    errs.push('notePins: invalid');
  } else {
    for (const [ni, pin] of job.notePins.entries()) {
      const w = `notePins[${ni}]`;
      if (!pin || typeof pin !== 'object' || !VIEWS.includes(pin.view)) { errs.push(`${w}: invalid`); continue; }
      if (!Number.isInteger(pin.x) || !Number.isInteger(pin.y)) errs.push(`${w}: non-finite position`);
      if (typeof pin.text !== 'string' || pin.text.length > 200) errs.push(`${w}: invalid text`);
      if (typeof pin.id !== 'string' || pin.id.length > 64) errs.push(`${w}: invalid id`);
    }
  }
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, job };
}

export function serialiseJob(job) {
  // Persistence must agree with import validation: refuse to save a job that
  // validateJob would reject. Callers catch and surface an honest error.
  const v = validateJob(job);
  if (!v.ok) throw new Error('job failed validation: ' + v.errors[0]);
  return JSON.stringify({ ...job, savedAt: new Date().toISOString() });
}

export function normaliseJob(job) {
  // Fill any missing annotation view and notePins so renders and Draw never
  // hit undefined arrays. Returns a shallow-copied job; never mutates input.
  const out = { ...job, annotations: { ...(job.annotations ?? {}) }, notePins: Array.isArray(job.notePins) ? job.notePins : [] };
  for (const v of VIEWS) if (!Array.isArray(out.annotations[v])) out.annotations[v] = [];
  return out;
}

export function parseBackup(text) {
  // Untrusted input. Returns validateJob-style result; never throws.
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
  if (Array.isArray(data) || data === null || typeof data !== 'object') {
    return { ok: false, errors: ['not a job object'] };
  }
  const v = validateJob(data);
  if (!v.ok) return v;
  return { ok: true, job: normaliseJob(v.job) };
}

export function summariseBackup(job) {
  const bd = breakdown(job);
  return {
    name: job.name,
    size: `${job.room.widthM.toFixed(2)} × ${job.room.depthM.toFixed(2)} × ${job.room.heightM.toFixed(2)} m`,
    items: job.items.length,
    savedAt: job.savedAt || job.createdAt,
    complete: bd.complete,
  };
}

// ---- CSV ----------------------------------------------------------------

export function csvCell(v) {
  // Quote everything; neutralise formula-leading characters.
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function jobCsv(job) {
  const bd = breakdown(job);
  const rev = `revision ${job.revision}, ${job.savedAt ? new Date(job.savedAt).toISOString().slice(0, 10) : 'not saved'}`;
  const lines = [];
  lines.push([csvCell(job.name)].join(','));
  lines.push([csvCell(rev)].join(','));
  lines.push([csvCell('Example labour rates only – not a quotation')].join(','));
  lines.push('');
  lines.push(['work type', 'quantity', 'rate (£)', 'line total (£)', 'status'].map(csvCell).join(','));
  for (const r of bd.rows) {
    lines.push([
      csvCell(r.label), r.qty,
      r.ratePence === null ? '' : (r.ratePence / 100).toFixed(2),
      r.linePence === null ? '' : (r.linePence / 100).toFixed(2),
      csvCell(r.status),
    ].join(','));
  }
  if (bd.unknownQty > 0) {
    lines.push([csvCell(TYPES.unknown.label), bd.unknownQty, '', '', csvCell('unpriced')].join(','));
  }
  if (bd.existingQty > 0) {
    lines.push([csvCell(TYPES.existing.label), bd.existingQty, '', '', csvCell('excluded')].join(','));
  }
  lines.push('');
  lines.push([csvCell(bd.complete ? `Total ${formatPence(bd.totalPence)}` : `Total so far ${formatPence(bd.totalPence)} – incomplete, ${bd.unpricedCount} unpriced`)].join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---- Sample job ----------------------------------------------------------

export function sampleJob() {
  // Synthetic barber shop, 6.00 × 4.00 × 2.70 m. Example data only. The
  // unknown fitting exercises the unpriced/incomplete-total behaviour.
  const j = blankJob('Barber shop – example job');
  j.sample = true;
  j.room = { widthM: 6.0, depthM: 4.0, heightM: 2.7 };
  j.rates = { surface: 3500, recessed: 5500, replacement: 1500, switch: 2500, downlight: 3000 };
  placeItem(j, 'surface', 'A', 800, 450, 'Behind mirror station');
  placeItem(j, 'surface', 'A', 3200, 450, '');
  placeItem(j, 'recessed', 'B', 1200, 450, 'Floor box by styling chair');
  placeItem(j, 'switch', 'A', 300, 1200, 'By door');
  placeItem(j, 'switch', 'D', 2500, 1200, 'Two-way');
  placeItem(j, 'downlight', CEILING, 1500, 2000, '');
  placeItem(j, 'downlight', CEILING, 3000, 2000, '');
  placeItem(j, 'downlight', CEILING, 4500, 2000, '');
  placeItem(j, 'downlight', CEILING, 2200, 3200, '');
  placeItem(j, 'replacement', 'C', 3000, 450, '');
  placeItem(j, 'existing', 'D', 1500, 450, 'Keep as is');
  placeItem(j, 'unknown', 'C', 1200, 1800, 'Old isolator? – needs pricing');
  j.jobNotes = 'Made-up example job for review — not a real customer.';
  return j;
}
