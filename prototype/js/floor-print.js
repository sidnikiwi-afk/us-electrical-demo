// Pure print-sheet planning. No DOM and no job mutation.
// Face offsets match floor-zones.js: viewed from the left of the face.

import { zonesOf, zoneTouchingFaces, wholeFloorFaces } from './floor-zones.js';
import { wallLength } from './floor-walls.js';

export const BUILD = 'surface-proto-v17-floor-final-20261013';

const EXTERIOR_NAME = {
  A: 'North wall (A)',
  B: 'East wall (B)',
  C: 'South wall (C)',
  D: 'West wall (D)',
};
const EXTERIOR_RANK = { A: 0, B: 1, C: 2, D: 3 };
const FACE_RANK = { N: 0, E: 1, S: 2, W: 3 };
const LOOKING = {
  A: 'north', B: 'east', C: 'south', D: 'west',
  N: 'south', E: 'west', S: 'north', W: 'east',
};

function metres(mm) {
  return (Number(mm) / 1000).toFixed(2);
}

function faceLength(job, face) {
  if (face.wall === 'A' || face.wall === 'C') return Math.round(Number(job.room.widthM) * 1000);
  if (face.wall === 'B' || face.wall === 'D') return Math.round(Number(job.room.depthM) * 1000);
  const walls = job && job.floor && Array.isArray(job.floor.walls) ? job.floor.walls : [];
  const wall = walls.find(item => item && item.id === face.wall);
  return wall ? wallLength(wall) : 0;
}

export function faceTitleName(face) {
  if (EXTERIOR_NAME[face.wall]) return EXTERIOR_NAME[face.wall];
  // A face on a zone edge uses the edge name: "North wall (W6)".
  if (face.edge && face.label) return face.label;
  return face.sideLabel || face.label || String(face.wall);
}

export function lookingWord(face) {
  if (EXTERIOR_NAME[face.wall]) return LOOKING[face.wall];
  return LOOKING[face.face] || 'north';
}

export function sheetSubtitle(sheet) {
  return `Looking ${lookingWord(sheet)} · ${metres(sheet.fromMm)} to ${metres(sheet.toMm)} m of ${metres(sheet.lengthMm)} m · key plan shows this wall in red`;
}

function wallRank(id) {
  if (Object.prototype.hasOwnProperty.call(EXTERIOR_RANK, id)) return EXTERIOR_RANK[id];
  const n = Number(String(id || '').slice(1));
  return 100 + (Number.isInteger(n) ? n : 999);
}

function compareSheets(a, b) {
  return wallRank(a.wall) - wallRank(b.wall)
    || (FACE_RANK[a.face] ?? 0) - (FACE_RANK[b.face] ?? 0);
}

// Endpoints of a zone clip that fall strictly inside the printed range.
function boundarySides(ranges, names, atMm) {
  const left = [];
  const right = [];
  ranges.forEach((range, i) => {
    const name = names[i];
    if (range[1] === atMm && !left.includes(name)) left.push(name);
    if (range[0] === atMm && !right.includes(name)) right.push(name);
  });
  return { left, right };
}

function boundariesFor(ranges, names, from, to) {
  const at = new Map();
  ranges.forEach((range, i) => {
    for (const mm of range) {
      if (mm <= from || mm >= to) continue;
      if (!at.has(mm)) at.set(mm, []);
      const list = at.get(mm);
      if (!list.includes(names[i])) list.push(names[i]);
    }
  });
  return [...at.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMm, zoneNames]) => {
      const sides = boundarySides(ranges, names, atMm);
      return { atMm, names: zoneNames, left: sides.left, right: sides.right };
    });
}

function finishSheet(job, face, fromMm, toMm, zoneNames, ranges, boundaryNames) {
  const lengthMm = faceLength(job, face);
  const sheet = {
    wall: face.wall,
    face: face.face,
    view: face.view,
    interior: !!face.interior,
    sideLabel: face.sideLabel || '',
    label: face.label || '',
    edge: face.edge || null,
    fromMm,
    toMm,
    lengthMm,
    zoneNames,
    boundaries: boundariesFor(ranges, boundaryNames, fromMm, toMm),
  };
  const scope = zoneNames.length ? zoneNames.join(', ') : 'Whole floor';
  sheet.title = `${scope} · ${faceTitleName(sheet)}`;
  sheet.subtitle = sheetSubtitle(sheet);
  return sheet;
}

export function useLegacyPack(job) {
  const floor = job && job.floor;
  const zones = floor && Array.isArray(floor.zones) ? floor.zones.length : 0;
  const walls = floor && Array.isArray(floor.walls) ? floor.walls.length : 0;
  const routes = floor && Array.isArray(floor.routes) ? floor.routes.length : 0;
  return zones === 0 && walls === 0 && routes === 0;
}

// whole: every physical face, full length.
// Otherwise one sheet per face touched by the ticked zones, range = hull of those clips.
export function planSheets(job, choice) {
  const whole = !choice || choice.whole;
  const wanted = new Set((choice && choice.zoneIds) || []);
  if (whole) {
    const rangesByFace = new Map();
    for (const zone of zonesOf(job)) {
      for (const face of zoneTouchingFaces(job, zone)) {
        const key = face.wall + '|' + face.face;
        if (!rangesByFace.has(key)) rangesByFace.set(key, { ranges: [], names: [] });
        const bucket = rangesByFace.get(key);
        bucket.ranges.push([face.fromMm, face.toMm]);
        bucket.names.push(zone.name);
      }
    }
    const sheets = wholeFloorFaces(job).map(face => {
      const bucket = rangesByFace.get(face.wall + '|' + face.face) || { ranges: [], names: [] };
      const lengthMm = faceLength(job, face);
      return finishSheet(job, face, 0, lengthMm, [], bucket.ranges, bucket.names);
    });
    return { sheets, sharedWalls: 0 };
  }
  const selected = zonesOf(job).filter(zone => wanted.has(zone.id));
  const buckets = new Map();
  for (const zone of selected) {
    for (const face of zoneTouchingFaces(job, zone)) {
      const key = face.wall + '|' + face.face;
      if (!buckets.has(key)) buckets.set(key, { face, ranges: [], names: [], zones: new Set() });
      const bucket = buckets.get(key);
      bucket.ranges.push([face.fromMm, face.toMm]);
      bucket.names.push(zone.name);
      bucket.zones.add(zone.id);
    }
  }
  const shared = new Set();
  for (const bucket of buckets.values()) {
    if (bucket.zones.size >= 2) shared.add(bucket.face.wall);
  }
  const sheets = [...buckets.values()].map(bucket => {
    const fromMm = Math.min(...bucket.ranges.map(range => range[0]));
    const toMm = Math.max(...bucket.ranges.map(range => range[1]));
    return finishSheet(job, bucket.face, fromMm, toMm, bucket.names, bucket.ranges, bucket.names);
  });
  sheets.sort(compareSheets);
  return { sheets, sharedWalls: shared.size };
}

export function countLine(sheetCount, sharedWalls) {
  const sheets = `${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`;
  if (sharedWalls === 1) return `${sheets}. 1 wall is shared by the ticked zones and prints once.`;
  if (sharedWalls > 1) return `${sheets}. ${sharedWalls} walls are shared by the ticked zones and print once.`;
  return sheets;
}
