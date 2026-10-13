// Pure job record, pricing, validation, CSV and serialisation.
// No DOM, no storage, no network. All money is integer pence.
// Example rates only — nothing here is a real quotation or installation advice.

import {
  MSG,
  isWallId,
  parseFaceView,
  wallAxis,
  wallLength,
  planFromOffset,
  carriedOffset,
  wallsError,
  placementError,
  interiorFittingError,
  interiorMarkError,
  attachmentProblem,
} from './floor-walls.js';
import {
  carriedRun,
  copyRoute,
  routesError,
  runOffWall,
  wallGeometry,
} from './floor-routes.js';

export const SCHEMA = 'surface-job';
export const SCHEMA_VERSION = 1;
export const BUILD = 'surface-proto-v15-floor-routes-20261013';

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

// Layers group fittings for showing and hiding only. A layer never changes
// pricing, and 'other' keeps existing/unknown fittings until the user assigns them.
export const LAYERS = ['lighting', 'power', 'threephase', 'other'];
export const LAYER_LABELS = {
  lighting: 'Lighting',
  power: 'Sockets & spurs',
  threephase: 'Three-phase',
  other: 'Other / unassigned',
};

// Fitting types. All but the last two are chargeable work types; existing and
// unknown are excluded. `layer` is each type's default layer. Default heights
// are editable sample placement values, not installation advice.
export const TYPES = {
  surface:    { label: 'New surface socket',    symbol: 'SS', defaultHeightMm: 450,  chargeable: true,  layer: 'power' },
  recessed:   { label: 'New recessed socket',   symbol: 'RS', defaultHeightMm: 450,  chargeable: true,  layer: 'power' },
  replacement:{ label: 'Replacement socket',    symbol: 'RP', defaultHeightMm: 450,  chargeable: true,  layer: 'power' },
  switch:     { label: 'Switch',                symbol: 'SW', defaultHeightMm: 1200, chargeable: true,  layer: 'lighting' },
  downlight:  { label: 'Downlight',             symbol: 'DL', defaultHeightMm: null, chargeable: true,  layer: 'lighting' }, // ceiling
  spur:       { label: 'Fused spur',            symbol: 'FS', defaultHeightMm: 450,  chargeable: true,  layer: 'power' },
  threephase: { label: 'Three-phase point',     symbol: '3P', defaultHeightMm: 1200, chargeable: true,  layer: 'threephase' },
  existing:   { label: 'Existing – no work',    symbol: 'EX', defaultHeightMm: 450,  chargeable: false, layer: 'other' },
  unknown:    { label: 'Unknown – unpriced',    symbol: '?',  defaultHeightMm: 450,  chargeable: false, layer: 'other' },
};

export const RATE_KEYS = ['surface', 'recessed', 'replacement', 'switch', 'downlight', 'spur', 'threephase'];
export const WALLS = ['A', 'B', 'C', 'D'];
export const VIEWS = ['PLAN', 'A', 'B', 'C', 'D']; // annotation views

export const CEILING = 'CEIL';

export function defaultRates() {
  // Example rates only, integer pence. Fused spur and three-phase point have
  // no example rate: they stay unpriced until the user enters one.
  return { surface: 3500, recessed: 5500, replacement: 1500, switch: 2500, downlight: 3000, spur: null, threephase: null };
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
    items: [],       // {id, type, wall, fromLeftMm, heightMm, notes, layer?} — layer only when it differs from the type default
    rates: defaultRates(),
    jobNotes: '',
    annotations: { PLAN: [], A: [], B: [], C: [], D: [] }, // strokes: {points:[[x,y],...]}
    notePins: [],    // {id, view, x, y, text}
    sample: false,
  };
}

// Schema 2 job: same record as blankJob, plus an empty floor. Counters only move forward.
export function blankJobV2(name = 'Untitled room') {
  const job = blankJob(name);
  job.schemaVersion = 2;
  job.floor = {
    walls: [],
    zones: [],
    routes: [],
    nextWallNo: 1,
    nextZoneNo: 1,
    nextRouteNo: 1,
  };
  return job;
}

// Adds one named rectangle. Validates a copy first, so a refusal throws and leaves job untouched.
export function addZone(job, spec) {
  const trial = cloneData(job);
  const floor = trial && trial.floor;
  const n = floor && floor.nextZoneNo;
  const zone = {
    id: 'Z' + n,
    name: spec && typeof spec.name === 'string' ? spec.name.trim() : spec && spec.name,
    x0: spec && spec.x0,
    y0: spec && spec.y0,
    x1: spec && spec.x1,
    y1: spec && spec.y1,
  };
  if (floor && Array.isArray(floor.zones) && Number.isInteger(n)) {
    floor.zones.push(zone);
    floor.nextZoneNo = n + 1;
  }
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.zones.push({ id: zone.id, name: zone.name, x0: zone.x0, y0: zone.y0, x1: zone.x1, y1: zone.y1 });
  job.floor.nextZoneNo = n + 1;
  return zone.id;
}

// Replaces one zone's name and bounds. A refusal throws and leaves job untouched.
export function replaceZone(job, id, spec) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.zones)) throw new Error('This job has no floor.');
  const z = trial.floor.zones.find(item => item.id === id);
  if (!z) throw new Error('That zone is not on this floor.');
  z.name = spec && typeof spec.name === 'string' ? spec.name.trim() : z.name;
  z.x0 = spec.x0;
  z.y0 = spec.y0;
  z.x1 = spec.x1;
  z.y1 = spec.y1;
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  const live = job.floor.zones.find(item => item.id === id);
  live.name = z.name;
  live.x0 = z.x0;
  live.y0 = z.y0;
  live.x1 = z.x1;
  live.y1 = z.y1;
  return id;
}

function wallOn(job, id) {
  const walls = job && job.floor && Array.isArray(job.floor.walls) ? job.floor.walls : null;
  if (!walls) return null;
  return walls.find(wall => wall.id === id) || null;
}

// Adds one interior wall. A refusal throws and leaves the job untouched.
export function addWall(job, spec) {
  const trial = cloneData(job);
  const floor = trial && trial.floor;
  const n = floor && floor.nextWallNo;
  const wall = {
    id: 'W' + n,
    x1: spec && spec.x1,
    y1: spec && spec.y1,
    x2: spec && spec.x2,
    y2: spec && spec.y2,
  };
  if (floor && Array.isArray(floor.walls) && Number.isInteger(n)) {
    floor.walls.push(wall);
    floor.nextWallNo = n + 1;
  }
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.walls.push({ id: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 });
  job.floor.nextWallNo = n + 1;
  return wall.id;
}

// Moves a wall. Endpoint edits keep plan positions; a new line carries offsets.
// A refusal throws and leaves the job untouched.
export function replaceWall(job, id, spec) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.walls)) throw new Error('This job has no floor.');
  const wall = trial.floor.walls.find(item => item.id === id);
  if (!wall) throw new Error(MSG.missingWall);
  const before = { id: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 };
  wall.x1 = spec && spec.x1;
  wall.y1 = spec && spec.y1;
  wall.x2 = spec && spec.x2;
  wall.y2 = spec && spec.y2;
  const stranded = remapWallAttachments(trial, id, before, wall);
  if (stranded) throw new Error(stranded);
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  const live = job.floor.walls.find(item => item.id === id);
  live.x1 = wall.x1;
  live.y1 = wall.y1;
  live.x2 = wall.x2;
  live.y2 = wall.y2;
  copyWallAttachments(job, trial, id);
  return id;
}

function remapWallAttachments(trial, id, before, wall) {
  if (!wallAxis(wall)) return null;
  for (const it of trial.items || []) {
    if (!it || it.wall !== id) continue;
    it.fromLeftMm = carriedOffset(before, wall, it.face, it.fromLeftMm);
    const problem = attachmentProblem(wall, it.face, it.fromLeftMm, 'fitting');
    if (problem) return problem;
  }
  for (const pin of trial.notePins || []) {
    const parsed = pin && parseFaceView(pin.view);
    if (!parsed || parsed.id !== id) continue;
    pin.x = carriedOffset(before, wall, parsed.face, pin.x);
    const problem = attachmentProblem(wall, parsed.face, pin.x, 'note');
    if (problem) return problem;
  }
  for (const key of Object.keys(trial.annotations || {})) {
    const parsed = parseFaceView(key);
    if (!parsed || parsed.id !== id) continue;
    const strokes = trial.annotations[key];
    if (!Array.isArray(strokes)) continue;
    for (const stroke of strokes) {
      if (!stroke || !Array.isArray(stroke.points)) continue;
      for (const point of stroke.points) {
        if (!Array.isArray(point) || typeof point[0] !== 'number') continue;
        point[0] = carriedOffset(before, wall, parsed.face, point[0]);
        const problem = attachmentProblem(wall, parsed.face, point[0], 'sketch');
        if (problem) return problem;
      }
    }
  }
  for (const route of (trial.floor && trial.floor.routes) || []) {
    if (!route || route.wall !== id) continue;
    const moved = carriedRun(before, wall, route);
    route.startMm = moved.startMm;
    route.endMm = moved.endMm;
    const problem = runOffWall(wall, route.face, route.startMm, route.endMm);
    if (problem) return problem;
  }
  return null;
}

function copyWallAttachments(job, trial, id) {
  for (const it of trial.items || []) {
    if (!it || it.wall !== id) continue;
    const live = job.items.find(item => item.id === it.id);
    if (live) live.fromLeftMm = it.fromLeftMm;
  }
  const pins = trial.notePins || [];
  for (let i = 0; i < pins.length; i += 1) {
    const parsed = parseFaceView(pins[i] && pins[i].view);
    if (!parsed || parsed.id !== id) continue;
    if (job.notePins && job.notePins[i]) job.notePins[i].x = pins[i].x;
  }
  for (const key of Object.keys(trial.annotations || {})) {
    const parsed = parseFaceView(key);
    if (!parsed || parsed.id !== id) continue;
    if (!job.annotations) job.annotations = {};
    job.annotations[key] = JSON.parse(JSON.stringify(trial.annotations[key]));
  }
  for (const route of (trial.floor && trial.floor.routes) || []) {
    if (!route || route.wall !== id) continue;
    const live = ((job.floor && job.floor.routes) || []).find(item => item && item.id === route.id);
    if (!live) continue;
    live.startMm = route.startMm;
    live.endMm = route.endMm;
  }
}

function wallHasAttachment(job, id) {
  if ((job.items || []).some(it => it && it.wall === id)) return true;
  if ((job.notePins || []).some(pin => {
    const parsed = pin && parseFaceView(pin.view);
    return parsed && parsed.id === id;
  })) return true;
  for (const key of Object.keys(job.annotations || {})) {
    const parsed = parseFaceView(key);
    if (!parsed || parsed.id !== id) continue;
    const strokes = job.annotations[key];
    if (Array.isArray(strokes) && strokes.length > 0) return true;
  }
  return false;
}

function cleanEmptyFaceKeys(job, id) {
  const ann = job && job.annotations;
  if (!ann) return;
  for (const key of Object.keys(ann)) {
    const parsed = parseFaceView(key);
    if (!parsed || parsed.id !== id) continue;
    if (Array.isArray(ann[key]) && ann[key].length === 0) delete ann[key];
  }
}

// Removes one interior wall. The wall counter stays, so the ID is not reused.
// A wall with fittings, notes or sketches is refused and left untouched.
export function removeWall(job, id) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.walls)) throw new Error('This job has no floor.');
  if (!trial.floor.walls.some(wall => wall.id === id)) throw new Error(MSG.missingWall);
  if (wallHasAttachment(trial, id)) throw new Error(MSG.removeBlocked);
  if ((trial.floor.routes || []).some(route => route && route.wall === id)) {
    throw new Error('Remove the runs on this wall first.');
  }
  trial.floor.walls = trial.floor.walls.filter(wall => wall.id !== id);
  cleanEmptyFaceKeys(trial, id);
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.walls = job.floor.walls.filter(wall => wall.id !== id);
  cleanEmptyFaceKeys(job, id);
}

export function faceOffsetToPlan(job, wallId, face, offsetMm) {
  const wall = wallGeometry(job, wallId);
  if (!wall) throw new Error(MSG.missingWall);
  const plan = planFromOffset(wall, face, offsetMm);
  if (!plan) throw new Error(MSG.badFace);
  return { x: plan.x, y: plan.y };
}

function routeFromSpec(id, spec, notesFallback) {
  const notes = spec && Object.prototype.hasOwnProperty.call(spec, 'notes') ? spec.notes : notesFallback;
  return {
    id,
    type: spec && spec.type,
    wall: spec && spec.wall,
    face: spec && spec.face,
    startMm: spec && spec.startMm,
    endMm: spec && spec.endMm,
    heightMm: spec && spec.heightMm,
    notes: notes === undefined ? '' : notes,
  };
}

// Adds one straight run on a wall face. A refusal throws and leaves the job untouched.
export function addRoute(job, spec) {
  const trial = cloneData(job);
  const floor = trial && trial.floor;
  const n = floor && floor.nextRouteNo;
  const route = routeFromSpec('R' + n, spec, '');
  if (floor && Array.isArray(floor.routes) && Number.isInteger(n)) {
    floor.routes.push(route);
    floor.nextRouteNo = n + 1;
  }
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.routes.push(copyRoute(route));
  job.floor.nextRouteNo = n + 1;
  return route.id;
}

// Replaces one run. The id stays put. A refusal throws and leaves the job untouched.
export function replaceRoute(job, id, spec) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.routes)) throw new Error('This job has no floor.');
  const route = trial.floor.routes.find(item => item && item.id === id);
  if (!route) throw new Error('That run is not on this floor.');
  const next = routeFromSpec(id, spec, route.notes);
  route.type = next.type;
  route.wall = next.wall;
  route.face = next.face;
  route.startMm = next.startMm;
  route.endMm = next.endMm;
  route.heightMm = next.heightMm;
  route.notes = next.notes;
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  const live = job.floor.routes.find(item => item && item.id === id);
  live.type = route.type;
  live.wall = route.wall;
  live.face = route.face;
  live.startMm = route.startMm;
  live.endMm = route.endMm;
  live.heightMm = route.heightMm;
  live.notes = route.notes;
  return id;
}

// Removes one run. The route counter stays, so the id is not reused.
export function removeRoute(job, id) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.routes)) throw new Error('This job has no floor.');
  const next = trial.floor.routes.filter(item => item && item.id !== id);
  if (next.length === trial.floor.routes.length) throw new Error('That run is not on this floor.');
  trial.floor.routes = next;
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.routes = job.floor.routes.filter(item => item && item.id !== id);
}

// Removes one zone. The zone counter stays where it is, so the ID is not reused.
export function removeZone(job, id) {
  const trial = cloneData(job);
  if (!trial || !trial.floor || !Array.isArray(trial.floor.zones)) throw new Error('This job has no floor.');
  const next = trial.floor.zones.filter(item => item.id !== id);
  if (next.length === trial.floor.zones.length) throw new Error('That zone is not on this floor.');
  trial.floor.zones = next;
  const v = validateJobV2(trial);
  if (!v.ok) throw new Error(v.errors[0]);
  job.floor.zones = job.floor.zones.filter(item => item.id !== id);
}

// Undo and redo keep the higher counter, same rule as fitting IDs.
export function monotonicFloorCounters(restored, current) {
  if (!restored || !restored.floor || !current || !current.floor) return restored;
  restored.floor.nextWallNo = Math.max(restored.floor.nextWallNo, current.floor.nextWallNo);
  restored.floor.nextZoneNo = Math.max(restored.floor.nextZoneNo, current.floor.nextZoneNo);
  restored.floor.nextRouteNo = Math.max(restored.floor.nextRouteNo, current.floor.nextRouteNo);
  return restored;
}

function cloneData(job) {
  try { return JSON.parse(JSON.stringify(job)); }
  catch { return null; }
}

export function makeId(job) {
  return 'F' + job.nextId;
}

export function placeItem(job, type, wall, fromLeftMm, heightMm, notes = '', face) {
  if (!TYPES[type]) throw new Error(`unknown fitting type "${type}"`);
  const legacy = WALLS.includes(wall) || wall === CEILING;
  const interior = isWallId(wall);
  if (!legacy && !interior) throw new Error(`unknown wall "${wall}"`);
  if (job.items.length >= LIMITS.maxItems) throw new Error('too many fittings');
  if (interior) {
    const err = placementError(wallOn(job, wall), fromLeftMm, heightMm, face, ceilingHeightMm(job.room));
    if (err) throw new Error(err);
  } else if (face !== undefined) {
    throw new Error(MSG.badFace);
  }
  const id = makeId(job);
  const item = {
    id,
    type,
    wall,
    fromLeftMm: Math.round(fromLeftMm),
    heightMm: Math.round(heightMm),
    notes: String(notes).slice(0, LIMITS.maxTextLen),
  };
  if (interior) item.face = face;
  job.items.push(item);
  job.nextId += 1;
  return id;
}

// "Place like this": a new fitting with the template's type and layer and a
// blank note. The layer is stored only when it differs from the type default.
// Checks the layer before placing, so every throw leaves the job untouched.
export function placeLike(job, template, wall, fromLeftMm, heightMm, face) {
  const layer = template?.layer ?? null;
  if (layer !== null && !isLayer(layer)) throw new Error(`unknown layer "${String(layer).slice(0, 40)}"`);
  const id = placeItem(job, template?.type, wall, fromLeftMm, heightMm, '', face);
  if (layer !== null && layer !== defaultLayerFor(template.type)) job.items[job.items.length - 1].layer = layer;
  return id;
}

// The next fitting ID is always one more than the highest ever issued in the
// job, so undo and redo keep the larger counter and an ID is never reissued.
export function monotonicNextId(restored, current) {
  return Math.max(restored.nextId, current.nextId);
}

// A wall height kept inside [0, ceiling]. `clamped` says whether it changed.
export function clampWallHeight(job, heightMm) {
  const max = ceilingHeightMm(job.room);
  if (!max) return { heightMm: Math.round(heightMm), clamped: false }; // no ceiling height entered yet
  const h = Math.max(0, Math.min(Math.round(heightMm), max));
  return { heightMm: h, clamped: heightMm < 0 || heightMm > max };
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
  if (isWallId(item.wall)) {
    const wall = wallOn(job, item.wall);
    return wall ? wallLength(wall) : 0;
  }
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
    // Interior offsets belong to the wall, not the room rectangle.
    if (isWallId(it.wall)) return false;
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
    if (isWallId(it.wall)) return;
    const maxL = maxFromLeft(trial, it);
    const maxH = maxHeight(trial, it);
    const l = Number.isFinite(it.fromLeftMm) ? it.fromLeftMm : 0;
    const h = Number.isFinite(it.heightMm) ? it.heightMm : 0;
    it.fromLeftMm = Math.max(0, Math.min(Math.round(l), maxL));
    it.heightMm = Math.max(0, Math.min(Math.round(h), maxH));
  });
}

// ---- Layers --------------------------------------------------------------

export function isLayer(v) {
  return typeof v === 'string' && LAYERS.includes(v);
}

export function defaultLayerFor(type) {
  return TYPES[type]?.layer ?? 'other';
}

export function layerOf(item) {
  return isLayer(item?.layer) ? item.layer : defaultLayerFor(item?.type);
}

// null, undefined or '' goes back to the type default. Only a layer that
// differs from the default is stored, so a plain fitting has no layer key.
export function setItemLayer(job, id, layer) {
  const it = job.items.find(i => i.id === id);
  if (!it) throw new Error(`no fitting "${id}"`);
  if (layer === null || layer === undefined || layer === '') { delete it.layer; return layerOf(it); }
  if (!isLayer(layer)) throw new Error(`unknown layer "${String(layer).slice(0, 40)}"`);
  if (layer === defaultLayerFor(it.type)) delete it.layer;
  else it.layer = layer;
  return layerOf(it);
}

// Changing type always drops an explicit layer: the fitting takes the new
// type's default. Downlights move to the ceiling; anything else leaving the
// ceiling goes to Wall A. Position is then kept inside the room.
export function setItemType(job, id, type) {
  if (!TYPES[type]) throw new Error(`unknown fitting type "${type}"`);
  const it = job.items.find(i => i.id === id);
  if (!it) throw new Error(`no fitting "${id}"`);
  it.type = type;
  delete it.layer;
  if (type === 'downlight') it.wall = CEILING;
  else if (it.wall === CEILING) it.wall = 'A';
  if (!isWallId(it.wall)) delete it.face;
  clampItem(job, it);
  return it;
}

// Wall fittings only: a ceiling fitting's heightMm is a plan position, not a
// height. Checks everything before changing anything, so a throw leaves the
// job untouched. The raw value is range-checked BEFORE rounding, so rounding
// can never carry an out-of-range input inside the limit.
export function setWallHeights(job, ids, heightMm) {
  const max = ceilingHeightMm(job.room);
  if (!max) throw new Error('set the room size first');
  if (typeof heightMm !== 'number' || !Number.isFinite(heightMm)) throw new Error('enter a height in mm');
  if (heightMm < 0 || heightMm > max) throw new Error(`height must be 0–${max} mm`);
  const h = Math.round(heightMm);
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error('no fittings selected');
  const items = unique.map(id => {
    const it = job.items.find(i => i.id === id);
    if (!it) throw new Error(`no fitting "${id}"`);
    if (!TYPES[it.type]) throw new Error(`unknown fitting type "${it.type}"`);
    if (it.wall === CEILING) throw new Error(`${id} is a ceiling fitting`);
    return it;
  });
  let changed = 0;
  for (const it of items) if (it.heightMm !== h) { it.heightMm = h; changed += 1; }
  return { heightMm: h, count: items.length, changed };
}

// [{heightMm, count}] in ascending height, for the "current heights" summary.
// Ceiling, missing or unknown-type IDs are skipped, never counted.
export function heightGroups(job, ids) {
  const groups = new Map();
  for (const id of new Set(ids)) {
    const it = job.items.find(i => i.id === id);
    if (!it || !TYPES[it.type] || it.wall === CEILING) continue;
    groups.set(it.heightMm, (groups.get(it.heightMm) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([heightMm, count]) => ({ heightMm, count }));
}

// Visibility is view state (a list or Set of layer ids), never stored in the
// job. null/undefined means all layers; unknown names are ignored.
export function normaliseVisibility(visible) {
  if (visible === null || visible === undefined) return [...LAYERS];
  const s = new Set(visible);
  return LAYERS.filter(l => s.has(l));
}

export function visibleItems(job, visible) {
  const s = new Set(normaliseVisibility(visible));
  return job.items.filter(it => s.has(layerOf(it)));
}

export function layerCounts(job, items = job.items) {
  const counts = Object.fromEntries(LAYERS.map(l => [l, 0]));
  for (const it of items) counts[layerOf(it)] += 1;
  return counts;
}

export function visibilityLabel(visible) {
  const v = normaliseVisibility(visible);
  if (v.length === LAYERS.length) return 'All layers';
  if (!v.length) return 'No layers';
  return v.map(l => LAYER_LABELS[l]).join(' + ');
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
    // Count every AFFECTED FITTING, not unpriced type rows: 2 spurs + 2
    // three-phase points + 1 unknown = 5, never "2 types + 1".
    unpricedCount: rows.filter(r => r.status === 'unpriced').reduce((s, r) => s + r.qty, 0) + unknownQty,
    chargeableCount: rows.reduce((s, r) => s + r.qty, 0),
    complete: rows.every(r => r.status === 'priced') && unknownQty === 0,
  };
}

// The affected-fitting wording is shared by the room/status counts, the quote
// bar, the breakdown drawer, the CSV and the print pack, so the count and the
// phrase can never drift apart between surfaces.
export function unpricedPhrase(n) {
  return `${n} ${n === 1 ? 'fitting needs' : 'fittings need'} a price`;
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

export function validateJob(job, opts) {
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
      const interiorId = !!(opts && opts.allowInterior && isWallId(it.wall));
      const wallOk = WALLS.includes(it.wall) || it.wall === CEILING || interiorId;
      if (!wallOk) errs.push(`${w}.wall: invalid`);
      if (!Number.isInteger(it.fromLeftMm) || it.fromLeftMm < 0) errs.push(`${w}.fromLeftMm: invalid`);
      if (!Number.isInteger(it.heightMm) || it.heightMm < 0) errs.push(`${w}.heightMm: invalid`);
      if (typeof it.notes !== 'string' || it.notes.length > LIMITS.maxTextLen) errs.push(`${w}.notes: invalid`);
      // absent or null = type default; anything else must be a known layer
      if (it.layer !== undefined && it.layer !== null && !isLayer(it.layer)) {
        errs.push(`${w}.layer: unknown "${String(it.layer).slice(0, 40)}"`);
      }
      if (wallOk && TYPES[it.type] && Number.isInteger(it.fromLeftMm) && Number.isInteger(it.heightMm)
        && isFiniteNum(job.room?.widthM) && isFiniteNum(job.room?.depthM) && isFiniteNum(job.room?.heightM)) {
        const trial = { room: job.room };
        const fake = { wall: it.wall, fromLeftMm: it.fromLeftMm, heightMm: it.heightMm };
        if (!interiorId && fake.fromLeftMm > maxFromLeft(trial, fake)) errs.push(`${w}.fromLeftMm: outside wall`);
        if (!interiorId && fake.heightMm > maxHeight(trial, fake)) errs.push(`${w}.heightMm: outside room`);
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
      const faceView = opts && opts.allowInterior && parseFaceView(view);
      if (!VIEWS.includes(view) && !faceView) { errs.push(`annotations.${view}: unknown view`); continue; }
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
      const pinFace = opts && opts.allowInterior && pin && parseFaceView(pin.view);
      if (!pin || typeof pin !== 'object' || (!VIEWS.includes(pin.view) && !pinFace)) { errs.push(`${w}: invalid`); continue; }
      if (!Number.isInteger(pin.x) || !Number.isInteger(pin.y)) errs.push(`${w}: non-finite position`);
      if (typeof pin.text !== 'string' || pin.text.length > 200) errs.push(`${w}: invalid text`);
      if (typeof pin.id !== 'string' || pin.id.length > 64) errs.push(`${w}: invalid id`);
    }
  }
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, job };
}

const MAX_ZONES = 30;
const MIN_ZONE_MM = 100;
const MAX_ZONE_NAME = 60;
const FLOOR_KEYS = ['walls', 'zones', 'routes', 'nextWallNo', 'nextZoneNo', 'nextRouteNo'];
const ZONE_KEYS = ['id', 'name', 'x0', 'y0', 'x1', 'y1'];

function floorErrors(job) {
  const floor = job.floor;
  if (!floor || typeof floor !== 'object' || Array.isArray(floor)) return ['floor: missing or invalid'];
  for (const k of Object.keys(floor)) {
    if (!FLOOR_KEYS.includes(k)) return ['floor: unsupported field'];
  }
  if (!Array.isArray(floor.walls)) return ['floor.walls: not an array'];
  const wallErr = wallsError(floor.walls, floor.nextWallNo, wallLengthMm(job.room, 'A'), wallLengthMm(job.room, 'B'), job.room);
  if (wallErr) return [wallErr];
  if (!Array.isArray(floor.routes)) return ['floor.routes: not an array'];
  if (!Array.isArray(floor.zones)) return ['floor.zones: not an array'];
  if (!Number.isInteger(floor.nextWallNo) || floor.nextWallNo < 1) return ['floor.nextWallNo: invalid'];
  if (!Number.isInteger(floor.nextZoneNo) || floor.nextZoneNo < 1) return ['floor.nextZoneNo: invalid'];
  if (!Number.isInteger(floor.nextRouteNo) || floor.nextRouteNo < 1) return ['floor.nextRouteNo: invalid'];
  const routeErr = routesError(job);
  if (routeErr) return [routeErr];
  if (floor.zones.length > MAX_ZONES) return ['This floor already has 30 zones, which is the most it can hold.'];

  const widthMm = wallLengthMm(job.room, 'A');
  const depthMm = wallLengthMm(job.room, 'B');
  const seen = new Set();
  const accepted = [];
  for (let i = 0; i < floor.zones.length; i++) {
    const err = zoneProblem(floor.zones[i], i, widthMm, depthMm, job.room, accepted, floor.nextZoneNo, seen);
    if (err) return [err];
    accepted.push(floor.zones[i]);
    seen.add(floor.zones[i].id);
  }
  return [];
}

function zoneProblem(z, i, widthMm, depthMm, room, others, nextZoneNo, seen) {
  const at = `floor.zones[${i}]`;
  if (!z || typeof z !== 'object' || Array.isArray(z)) return `${at}: not an object`;
  for (const k of Object.keys(z)) {
    if (!ZONE_KEYS.includes(k)) return `${at}: unsupported field`;
  }
  if (typeof z.id !== 'string' || !/^Z\d+$/.test(z.id)) return `${at}.id: bad format`;
  const n = Number(z.id.slice(1));
  if (!Number.isInteger(n) || n < 1 || z.id !== 'Z' + n) return `${at}.id: bad format`;
  if (seen.has(z.id)) return `duplicate id ${z.id}`;
  if (n >= nextZoneNo) return `${at}.id: exceeds nextZoneNo`;
  if (![z.x0, z.y0, z.x1, z.y1].every(Number.isInteger)) return 'A zone must use whole millimetres.';
  if (z.x1 - z.x0 < MIN_ZONE_MM || z.y1 - z.y0 < MIN_ZONE_MM) {
    return 'A zone must be at least 100 mm wide and deep.';
  }
  if (z.x0 < 0 || z.y0 < 0 || z.x1 > widthMm || z.y1 > depthMm) {
    return `Keep the zone inside the floor, which is ${room.widthM.toFixed(2)} × ${room.depthM.toFixed(2)} m.`;
  }
  for (const o of others) {
    if (z.x0 < o.x1 && o.x0 < z.x1 && z.y0 < o.y1 && o.y0 < z.y1) {
      const w = Math.min(z.x1, o.x1) - Math.max(z.x0, o.x0);
      const d = Math.min(z.y1, o.y1) - Math.max(z.y0, o.y0);
      return `Zones can't overlap. This one would cover ${(w / 1000).toFixed(2)} × ${(d / 1000).toFixed(2)} m of ${o.name}.`;
    }
  }
  if (typeof z.name !== 'string' || z.name.trim().length < 1 || z.name.length > MAX_ZONE_NAME) {
    return 'A zone name must be 1 to 60 characters.';
  }
  const clash = others.find(o => typeof o.name === 'string' && o.name.trim().toLowerCase() === z.name.trim().toLowerCase());
  if (clash) return `Another zone is already called ${clash.name}.`;
  return null;
}

// Schema 2 only. Version 1 stays on validateJob, which still rejects every other version.
export function validateJobV2(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return { ok: false, errors: ['not an object'] };
  if (job.schemaVersion !== 2) return { ok: false, errors: ['schemaVersion: expected 2'] };
  const base = validateJob({ ...job, schemaVersion: SCHEMA_VERSION }, { allowInterior: true });
  if (!base.ok) return base;
  const errors = floorErrors(job);
  if (errors.length) return { ok: false, errors };
  const fitting = interiorFittingError(job.items, job.floor.walls, ceilingHeightMm(job.room));
  if (fitting) return { ok: false, errors: [fitting] };
  const marks = interiorMarkError(job, job.floor.walls);
  if (marks) return { ok: false, errors: [marks] };
  return { ok: true, job };
}

export function serialiseJob(job) {
  // Persistence must agree with import validation. Schema 2 uses its own
  // validator; every other record still goes through validateJob.
  const v = job && typeof job === 'object' && !Array.isArray(job) && job.schemaVersion === 2
    ? validateJobV2(job)
    : validateJob(job);
  if (!v.ok) throw new Error('job failed validation: ' + v.errors[0]);
  return JSON.stringify({ ...job, savedAt: new Date().toISOString() });
}

export function normaliseJob(job) {
  // Fill any missing annotation view and notePins so renders and Draw never
  // hit undefined arrays. Older backups lack the newer rate keys: those become
  // null (unpriced), never a guessed price. A null item layer is dropped so the
  // fitting uses its type default. Returns a shallow-copied job; never mutates input.
  const out = { ...job, annotations: { ...(job.annotations ?? {}) }, notePins: Array.isArray(job.notePins) ? job.notePins : [] };
  for (const v of VIEWS) if (!Array.isArray(out.annotations[v])) out.annotations[v] = [];
  if (job.rates && typeof job.rates === 'object') {
    out.rates = { ...job.rates };
    for (const k of RATE_KEYS) if (out.rates[k] === undefined) out.rates[k] = null;
  }
  if (Array.isArray(job.items)) {
    out.items = job.items.map(it => {
      if (!it || it.layer !== null) return it;
      const { layer, ...rest } = it;
      return rest;
    });
  }
  return out;
}

// Copies a floor that already validated. Missing or malformed floor data is left
// alone, never replaced with an empty floor.
export function normaliseJobV2(job) {
  const out = normaliseJob(job);
  const f = job && job.floor;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
  if (!Array.isArray(f.walls) || !Array.isArray(f.zones) || !Array.isArray(f.routes)) return out;
  out.floor = {
    walls: f.walls.map(w => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
    zones: f.zones.map(z => ({ id: z.id, name: z.name, x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 })),
    routes: f.routes.map(r => copyRoute(r)),
    nextWallNo: f.nextWallNo,
    nextZoneNo: f.nextZoneNo,
    nextRouteNo: f.nextRouteNo,
  };
  return out;
}

const DISGUISED_V1 = 'This backup has floor data under an older version number, so it can\u2019t be trusted.';

function hasDisguisedGeometry(job) {
  if (Object.prototype.hasOwnProperty.call(job, 'floor')) return true;
  if (!Array.isArray(job.items)) return false;
  return job.items.some(it => it && typeof it === 'object' && !Array.isArray(it)
    && Object.prototype.hasOwnProperty.call(it, 'face'));
}

// Pure copy of a schema 1 job into schema 2 with an empty floor.
// A floor block or a fitting face on schema 1 is invalid. This does not strip it.
export function upgradeV1(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return { ok: false, errors: ['not an object'] };
  if (hasDisguisedGeometry(job)) return { ok: false, errors: [DISGUISED_V1] };
  const v = validateJob(job);
  if (!v.ok) return v;
  let copy;
  try { copy = JSON.parse(JSON.stringify(job)); } catch { return { ok: false, errors: ['not an object'] }; }
  copy.schemaVersion = 2;
  copy.floor = {
    walls: [],
    zones: [],
    routes: [],
    nextWallNo: 1,
    nextZoneNo: 1,
    nextRouteNo: 1,
  };
  const v2 = validateJobV2(copy);
  if (!v2.ok) return v2;
  return { ok: true, job: normaliseJobV2(copy) };
}

export function parseBackup(text) {
  // Untrusted input. Returns validateJob-style result; never throws.
  // Only schemaVersion 2 takes the floor path. Other versions, including
  // unknown ones, stay on validateJob and are rejected there.
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
  if (Array.isArray(data) || data === null || typeof data !== 'object') {
    return { ok: false, errors: ['not a job object'] };
  }
  if (data.schemaVersion === 2) {
    const v2 = validateJobV2(data);
    if (!v2.ok) return v2;
    return { ok: true, job: normaliseJobV2(v2.job) };
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
  lines.push([csvCell(bd.complete ? `Total ${formatPence(bd.totalPence)}` : `Total so far ${formatPence(bd.totalPence)} – incomplete, ${unpricedPhrase(bd.unpricedCount)}`)].join(','));
  lines.push([csvCell('Whole job, all layers. Hiding layers on screen never changes this file.')].join(','));
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

export function layersDemoJob() {
  // Synthetic workshop, 7.00 × 5.00 × 3.00 m, covering lighting, sockets &
  // spurs and three-phase. Fused spur and three-phase point rates are left
  // blank on purpose so the quote shows them as needing a price. Positions are
  // made-up sample placements, not a design.
  const j = blankJob('Workshop – layers demo (made-up)');
  j.sample = true;
  j.room = { widthM: 7.0, depthM: 5.0, heightM: 3.0 };
  j.rates = defaultRates();
  placeItem(j, 'switch', 'A', 400, 1200, 'By door');
  placeItem(j, 'switch', 'C', 6500, 1200, 'Second door');
  placeItem(j, 'downlight', CEILING, 1800, 1500, '');
  placeItem(j, 'downlight', CEILING, 5200, 1500, '');
  placeItem(j, 'downlight', CEILING, 1800, 3500, '');
  placeItem(j, 'downlight', CEILING, 5200, 3500, '');
  placeItem(j, 'surface', 'A', 2000, 450, 'Bench');
  placeItem(j, 'surface', 'A', 4500, 450, 'Bench');
  placeItem(j, 'recessed', 'D', 2500, 450, '');
  placeItem(j, 'spur', 'B', 800, 450, 'Sample spur – price not set');
  placeItem(j, 'spur', 'C', 2000, 1100, 'Sample spur – price not set');
  placeItem(j, 'threephase', 'B', 2500, 1200, 'Sample machine point – price not set');
  placeItem(j, 'threephase', 'D', 1000, 1200, 'Sample machine point – price not set');
  const kept = placeItem(j, 'existing', 'C', 4500, 450, 'Existing socket kept – shown with sockets');
  setItemLayer(j, kept, 'power');
  placeItem(j, 'unknown', 'D', 4200, 1800, 'Old box – needs checking');
  j.jobNotes = 'Made-up layers demo, not a real customer. Fused spur and three-phase point have no example rate, so the total is incomplete until you add your own in Rates.';
  return j;
}
