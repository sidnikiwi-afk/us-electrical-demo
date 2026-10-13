// Interior wall geometry. Plan millimetres, x right, y down.
// Offsets are viewed-from-left: S=x-x1, N=x2-x, W=y-y1, E=y2-y.
// No zones, routes, or pricing here.

export const MAX_WALLS = 50;
export const MIN_WALL_MM = 100;
const WALL_KEYS = ['id', 'x1', 'y1', 'x2', 'y2'];

export const MSG = {
  missingWall: 'That wall is not on this floor.',
  badFace: 'That face is not on this wall.',
  offFitting: 'That fitting would sit off the wall.',
  strandFitting: 'This change would leave a fitting off the wall.',
  strandNote: 'This change would leave a note off the wall.',
  strandSketch: 'This change would leave a sketch off the wall.',
  removeBlocked: 'Remove the fittings, notes and sketches on this wall first.',
};

export function isWallId(id) {
  if (typeof id !== 'string') return false;
  const m = /^W(\d+)$/.exec(id);
  if (!m || String(Number(m[1])) !== m[1]) return false;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1;
}

export function parseFaceView(key) {
  if (typeof key !== 'string') return null;
  const m = /^W(\d+)\.([NSEW])$/.exec(key);
  if (!m || String(Number(m[1])) !== m[1]) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return { id: 'W' + n, face: m[2] };
}

export function wallAxis(wall) {
  if (!wall) return null;
  const horizontal = wall.y1 === wall.y2;
  const vertical = wall.x1 === wall.x2;
  if (horizontal === vertical) return null;
  return horizontal ? 'H' : 'V';
}

export function wallLength(wall) {
  const axis = wallAxis(wall);
  if (axis === 'H') return wall.x2 - wall.x1;
  if (axis === 'V') return wall.y2 - wall.y1;
  return 0;
}

export function facesFor(wall) {
  const axis = wallAxis(wall);
  if (axis === 'H') return ['N', 'S'];
  if (axis === 'V') return ['E', 'W'];
  return [];
}

export function planFromOffset(wall, face, offsetMm) {
  if (!facesFor(wall).includes(face) || typeof offsetMm !== 'number' || !Number.isFinite(offsetMm)) return null;
  if (face === 'S') return { x: wall.x1 + offsetMm, y: wall.y1 };
  if (face === 'N') return { x: wall.x2 - offsetMm, y: wall.y1 };
  if (face === 'W') return { x: wall.x1, y: wall.y1 + offsetMm };
  if (face === 'E') return { x: wall.x1, y: wall.y2 - offsetMm };
  return null;
}

export function offsetFromPlan(wall, face, plan) {
  if (!plan || !facesFor(wall).includes(face)) return null;
  if (face === 'S') return plan.x - wall.x1;
  if (face === 'N') return wall.x2 - plan.x;
  if (face === 'W') return plan.y - wall.y1;
  if (face === 'E') return wall.y2 - plan.y;
  return null;
}

export function sameWallLine(a, b) {
  const axis = wallAxis(a);
  if (!axis || axis !== wallAxis(b)) return false;
  return axis === 'H' ? a.y1 === b.y1 : a.x1 === b.x1;
}

// Same line keeps the plan point. A moved line carries the offset with the wall.
export function carriedOffset(oldWall, newWall, face, offsetMm) {
  if (!sameWallLine(oldWall, newWall)) return offsetMm;
  const plan = planFromOffset(oldWall, face, offsetMm);
  if (!plan) return offsetMm;
  const next = offsetFromPlan(newWall, face, plan);
  return next === null ? offsetMm : next;
}

function overlapMm(a, b) {
  if (!sameWallLine(a, b)) return 0;
  if (wallAxis(a) === 'H') return Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  return Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
}

export function wallRecordError(wall, index, widthMm, depthMm, others, nextWallNo, seen, room) {
  const at = `floor.walls[${index}]`;
  if (!wall || typeof wall !== 'object' || Array.isArray(wall)) return `${at}: not an object`;
  for (const key of Object.keys(wall)) {
    if (!WALL_KEYS.includes(key)) return `${at}: unsupported field`;
  }
  if (!isWallId(wall.id)) return `${at}.id: bad format`;
  const n = Number(wall.id.slice(1));
  if (seen.has(wall.id)) return `duplicate id ${wall.id}`;
  if (n >= nextWallNo) return `${at}.id: exceeds nextWallNo`;
  if (![wall.x1, wall.y1, wall.x2, wall.y2].every(Number.isInteger)) return 'A wall must use whole millimetres.';
  if (wall.x1 > wall.x2 || wall.y1 > wall.y2) return 'Keep a wall’s ends in order, with x1 ≤ x2 and y1 ≤ y2.';
  if (!wallAxis(wall)) return 'A wall must be horizontal or vertical.';
  if (wallLength(wall) < MIN_WALL_MM) return 'A wall must be at least 100 mm long.';
  if (wall.x1 < 0 || wall.y1 < 0 || wall.x2 > widthMm || wall.y2 > depthMm) {
    return `Keep the wall inside the floor, which is ${room.widthM.toFixed(2)} × ${room.depthM.toFixed(2)} m.`;
  }
  const axis = wallAxis(wall);
  const onExterior = axis === 'H'
    ? wall.y1 === 0 || wall.y1 === depthMm
    : wall.x1 === 0 || wall.x1 === widthMm;
  if (onExterior) return 'A wall can’t sit on the outside of the floor.';
  for (const other of others) {
    const cover = overlapMm(wall, other);
    if (cover > 0) {
      return `Walls can’t overlap. This one would cover ${(cover / 1000).toFixed(2)} m of ${other.id}.`;
    }
  }
  return null;
}

export function wallsError(walls, nextWallNo, widthMm, depthMm, room) {
  if (!Array.isArray(walls)) return 'floor.walls: not an array';
  if (walls.length > MAX_WALLS) return 'This floor already has 50 walls, which is the most it can hold.';
  const seen = new Set();
  const accepted = [];
  for (let i = 0; i < walls.length; i += 1) {
    const err = wallRecordError(walls[i], i, widthMm, depthMm, accepted, nextWallNo, seen, room);
    if (err) return err;
    accepted.push(walls[i]);
    seen.add(walls[i].id);
  }
  return null;
}

export function placementError(wall, fromLeftMm, heightMm, face, ceilingMm) {
  if (!wall) return MSG.missingWall;
  if (!facesFor(wall).includes(face)) return MSG.badFace;
  const length = wallLength(wall);
  if (typeof fromLeftMm !== 'number' || !Number.isFinite(fromLeftMm) || fromLeftMm < 0 || fromLeftMm > length) {
    return MSG.offFitting;
  }
  if (!ceilingMm) return 'set the room size first';
  if (typeof heightMm !== 'number' || !Number.isFinite(heightMm) || heightMm < 0 || heightMm > ceilingMm) {
    return `height must be 0–${ceilingMm} mm`;
  }
  return null;
}

export function interiorFittingError(items, walls, ceilingMm) {
  const byId = new Map((walls || []).map(wall => [wall.id, wall]));
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    if (!isWallId(it.wall)) {
      if (Object.prototype.hasOwnProperty.call(it, 'face')) return `items[${i}].face: that face is not on this wall`;
      continue;
    }
    const wall = byId.get(it.wall);
    if (!wall) return `items[${i}].wall: that wall is not on this floor`;
    if (!facesFor(wall).includes(it.face)) return `items[${i}].face: that face is not on this wall`;
    const length = wallLength(wall);
    if (!Number.isInteger(it.fromLeftMm) || it.fromLeftMm < 0 || it.fromLeftMm > length) {
      return `items[${i}].fromLeftMm: outside wall`;
    }
    if (!Number.isInteger(it.heightMm) || it.heightMm < 0 || it.heightMm > ceilingMm) {
      return `items[${i}].heightMm: outside room`;
    }
  }
  return null;
}

export function interiorMarkError(job, walls) {
  const byId = new Map((walls || []).map(wall => [wall.id, wall]));
  const ann = job.annotations || {};
  for (const key of Object.keys(ann)) {
    const parsed = parseFaceView(key);
    if (!parsed) continue;
    const wall = byId.get(parsed.id);
    if (!wall) return `annotations.${key}: that wall is not on this floor`;
    if (!facesFor(wall).includes(parsed.face)) return `annotations.${key}: that face is not on this wall`;
    const strokes = ann[key];
    if (!Array.isArray(strokes)) return `annotations.${key}: invalid`;
    const length = wallLength(wall);
    for (let si = 0; si < strokes.length; si += 1) {
      const stroke = strokes[si];
      if (!stroke || !Array.isArray(stroke.points)) continue;
      for (const point of stroke.points) {
        if (!Array.isArray(point) || typeof point[0] !== 'number' || !Number.isFinite(point[0]) || point[0] < 0 || point[0] > length) {
          return `annotations.${key}[${si}]: outside wall`;
        }
      }
    }
  }
  const pins = Array.isArray(job.notePins) ? job.notePins : [];
  for (let i = 0; i < pins.length; i += 1) {
    const pin = pins[i];
    const parsed = pin && parseFaceView(pin.view);
    if (!parsed) continue;
    const wall = byId.get(parsed.id);
    if (!wall) return `notePins[${i}]: that wall is not on this floor`;
    if (!facesFor(wall).includes(parsed.face)) return `notePins[${i}]: that face is not on this wall`;
    const length = wallLength(wall);
    if (!Number.isInteger(pin.x) || pin.x < 0 || pin.x > length) return `notePins[${i}]: outside wall`;
  }
  return null;
}

export function attachmentProblem(wall, face, offset, kind) {
  if (!wallAxis(wall)) return null;
  if (!facesFor(wall).includes(face)) return MSG.badFace;
  const length = wallLength(wall);
  const integer = kind !== 'sketch';
  const bad = typeof offset !== 'number' || !Number.isFinite(offset)
    || (integer && !Number.isInteger(offset))
    || offset < 0 || offset > length;
  if (!bad) return null;
  if (kind === 'note') return MSG.strandNote;
  if (kind === 'sketch') return MSG.strandSketch;
  return MSG.strandFitting;
}
