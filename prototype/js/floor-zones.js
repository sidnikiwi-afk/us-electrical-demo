// Rectangular zones and the faces a zone can open.
// Plan space is mm, x to the right, y down, origin at the inner corner of walls A and D.
// Interior face offsets use the same viewed-from-left rule as floor-walls.js.

import { facesFor, isWallId, wallAxis, wallLength } from './floor-walls.js';

export function zonesOf(job) {
  const list = job && job.floor && Array.isArray(job.floor.zones) ? job.floor.zones : [];
  return list.slice().sort((a, b) => zoneNo(a.id) - zoneNo(b.id));
}

export function zoneById(job, id) {
  return zonesOf(job).find(z => z.id === id) || null;
}

function zoneNo(id) {
  const n = Number(String(id || '').slice(1));
  return Number.isInteger(n) ? n : 0;
}

export function wallsOf(job) {
  const list = job && job.floor && Array.isArray(job.floor.walls) ? job.floor.walls : [];
  return list.slice().sort((a, b) => zoneNo(a.id) - zoneNo(b.id));
}

function roomSpan(room) {
  return {
    W: Math.round(Number(room && room.widthM) * 1000),
    D: Math.round(Number(room && room.depthM) * 1000),
  };
}

// Exterior faces that lie on a zone edge. Order is north, east, south, west.
// Face offsets are whole-face fromLeft millimetres.
export function zoneExteriorFaces(room, zone) {
  if (!room || !zone) return [];
  const { W, D } = roomSpan(room);
  const { x0, y0, x1, y1 } = zone;
  const faces = [];
  if (y0 === 0 && x1 > x0) faces.push({ edge: 'N', wall: 'A', face: 'S', fromMm: x0, toMm: x1, view: 'A', interior: false, partition: false });
  if (x1 === W && y1 > y0) faces.push({ edge: 'E', wall: 'B', face: 'W', fromMm: y0, toMm: y1, view: 'B', interior: false, partition: false });
  if (y1 === D && x1 > x0) faces.push({ edge: 'S', wall: 'C', face: 'N', fromMm: W - x1, toMm: W - x0, view: 'C', interior: false, partition: false });
  if (x0 === 0 && y1 > y0) faces.push({ edge: 'W', wall: 'D', face: 'E', fromMm: D - y1, toMm: D - y0, view: 'D', interior: false, partition: false });
  return faces;
}

const EDGE_LABEL = { N: 'North', E: 'East', S: 'South', W: 'West' };
const SIDE_LABEL = { N: 'north', E: 'east', S: 'south', W: 'west' };
const FACE_ORDER = { N: 0, E: 1, S: 2, W: 3 };
const EDGE_ORDER = { N: 0, E: 1, S: 2, W: 3 };

export function edgeNotes(zone, faces) {
  if (!zone) return [];
  const width = zone.x1 - zone.x0;
  const depth = zone.y1 - zone.y0;
  const edges = [['N', width], ['E', depth], ['S', width], ['W', depth]];
  const notes = [];
  for (const [edge, len] of edges) {
    const covered = (faces || []).filter(f => f.edge === edge).reduce((sum, f) => sum + Math.max(0, f.toMm - f.fromMm), 0);
    if (covered <= 0) notes.push(`${EDGE_LABEL[edge]} edge: no wall`);
    else if (covered < len) notes.push(`${EDGE_LABEL[edge]} edge: wall on ${(covered / 1000).toFixed(2)} of ${(len / 1000).toFixed(2)} m`);
  }
  return notes;
}

export function fittingOnFace(item, face) {
  if (!item || !face || item.wall !== face.wall) return false;
  if (isWallId(item.wall) && item.face !== face.face) return false;
  return item.fromLeftMm >= face.fromMm && item.fromLeftMm <= face.toMm;
}

export function positiveFaces(room, zone) {
  return zoneExteriorFaces(room, zone).filter(face => face.toMm > face.fromMm);
}

function overlapSpan(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi > lo ? [lo, hi] : null;
}

function offsetsFor(wall, face, lo, hi) {
  if (face === 'S') return [lo - wall.x1, hi - wall.x1];
  if (face === 'N') return [wall.x2 - hi, wall.x2 - lo];
  if (face === 'W') return [lo - wall.y1, hi - wall.y1];
  if (face === 'E') return [wall.y2 - hi, wall.y2 - lo];
  return null;
}

function describeFace(wall, face, lo, hi, edge) {
  const range = offsetsFor(wall, face, lo, hi);
  if (!range || range[1] <= range[0]) return null;
  const side = `${wall.id} ${SIDE_LABEL[face]} side`;
  return {
    edge: edge || null,
    wall: wall.id,
    face,
    fromMm: range[0],
    toMm: range[1],
    view: `${wall.id}.${face}`,
    interior: true,
    partition: !edge,
    label: edge ? `${EDGE_LABEL[edge]} wall (${wall.id})` : side,
    sideLabel: side,
  };
}

function interiorFacesForZone(wall, zone) {
  const axis = wallAxis(wall);
  if (!axis || !zone) return [];
  if (axis === 'H') {
    const y = wall.y1;
    const span = overlapSpan(wall.x1, wall.x2, zone.x0, zone.x1);
    if (!span) return [];
    const onNorth = y === zone.y0;
    const onSouth = y === zone.y1;
    const inside = y > zone.y0 && y < zone.y1;
    if (!onNorth && !onSouth && !inside) return [];
    const edge = onNorth ? 'N' : onSouth ? 'S' : null;
    const faces = onNorth ? ['S'] : onSouth ? ['N'] : ['N', 'S'];
    return faces.map(face => describeFace(wall, face, span[0], span[1], edge)).filter(Boolean);
  }
  const x = wall.x1;
  const span = overlapSpan(wall.y1, wall.y2, zone.y0, zone.y1);
  if (!span) return [];
  const onWest = x === zone.x0;
  const onEast = x === zone.x1;
  const inside = x > zone.x0 && x < zone.x1;
  if (!onWest && !onEast && !inside) return [];
  const edge = onWest ? 'W' : onEast ? 'E' : null;
  const faces = onWest ? ['E'] : onEast ? ['W'] : ['E', 'W'];
  return faces.map(face => describeFace(wall, face, span[0], span[1], edge)).filter(Boolean);
}

function byEdge(a, b) {
  return (EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge])
    || (zoneNo(a.wall) - zoneNo(b.wall))
    || (String(a.wall).localeCompare(String(b.wall)))
    || ((FACE_ORDER[a.face] ?? 0) - (FACE_ORDER[b.face] ?? 0));
}

// Faces that touch a zone: outside walls and interior walls on its edges, then partitions.
export function zoneTouchingFaces(job, zone) {
  if (!zone) return [];
  const room = job && job.room;
  const edgeFaces = positiveFaces(room, zone).map(face => ({
    ...face,
    label: `Wall ${face.wall}`,
    sideLabel: `Wall ${face.wall}`,
  }));
  const partitions = [];
  for (const wall of wallsOf(job)) {
    for (const face of interiorFacesForZone(wall, zone)) {
      if (face.partition) partitions.push(face);
      else edgeFaces.push(face);
    }
  }
  edgeFaces.sort(byEdge);
  partitions.sort((a, b) => zoneNo(a.wall) - zoneNo(b.wall) || FACE_ORDER[a.face] - FACE_ORDER[b.face]);
  return edgeFaces.concat(partitions);
}

// Whole floor: walls A to D, then every interior face in wall-number order.
export function wholeFloorFaces(job) {
  const { W, D } = roomSpan(job && job.room);
  const faces = [
    { edge: 'N', wall: 'A', face: 'S', fromMm: 0, toMm: W, view: 'A', interior: false, partition: false, label: 'Wall A', sideLabel: 'Wall A' },
    { edge: 'E', wall: 'B', face: 'W', fromMm: 0, toMm: D, view: 'B', interior: false, partition: false, label: 'Wall B', sideLabel: 'Wall B' },
    { edge: 'S', wall: 'C', face: 'N', fromMm: 0, toMm: W, view: 'C', interior: false, partition: false, label: 'Wall C', sideLabel: 'Wall C' },
    { edge: 'W', wall: 'D', face: 'E', fromMm: 0, toMm: D, view: 'D', interior: false, partition: false, label: 'Wall D', sideLabel: 'Wall D' },
  ];
  for (const wall of wallsOf(job)) {
    const ordered = facesFor(wall).slice().sort((a, b) => FACE_ORDER[a] - FACE_ORDER[b]);
    for (const face of ordered) {
      const described = describeFace(wall, face, wallAxis(wall) === 'H' ? wall.x1 : wall.y1, wallAxis(wall) === 'H' ? wall.x2 : wall.y2, null);
      if (!described) continue;
      described.partition = true;
      described.label = described.sideLabel;
      described.toMm = wallLength(wall);
      described.fromMm = 0;
      faces.push(described);
    }
  }
  return faces;
}

export function zoneFacts(job, zone) {
  const faces = zoneTouchingFaces(job, zone);
  const fittings = ((job && job.items) || []).filter(item => faces.some(face => fittingOnFace(item, face))).length;
  const bare = edgeNotes(zone, faces).filter(line => line.endsWith('no wall')).length;
  return { faces: faces.length, bareEdges: bare, fittings };
}

export function zoneAtPoint(zones, x, y) {
  for (const z of zones) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z.id;
  }
  return null;
}

export function snapToGuides(value, tolerance, guides) {
  for (const guide of guides) {
    if (Math.abs(value - guide) <= tolerance) return guide;
  }
  return Math.round(value / 50) * 50;
}

// Nearest guide within tolerance, otherwise the 50 mm grid.
export function snapNearest(value, tolerance, guides) {
  let best = null;
  let bestD = tolerance;
  for (const guide of guides || []) {
    const d = Math.abs(value - guide);
    if (d <= bestD) { best = guide; bestD = d; }
  }
  if (best !== null) return best;
  return Math.round(value / 50) * 50;
}

function listNames(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function wallOutside(wall, widthMm, depthMm) {
  if (!wall) return false;
  if (wall.x1 < 0 || wall.y1 < 0 || wall.x2 > widthMm || wall.y2 > depthMm) return true;
  const axis = wallAxis(wall);
  if (axis === 'H' && (wall.y1 === 0 || wall.y1 === depthMm)) return true;
  if (axis === 'V' && (wall.x1 === 0 || wall.x1 === widthMm)) return true;
  return false;
}

// Names walls and zones that would fall outside a smaller floor. Null when the size is fine.
export function outsideFloorMessage(job, widthM, depthM) {
  const W = Math.round(Number(widthM) * 1000);
  const D = Math.round(Number(depthM) * 1000);
  const names = [];
  for (const wall of wallsOf(job)) {
    if (wallOutside(wall, W, D)) names.push(wall.id);
  }
  for (const z of zonesOf(job)) {
    if (z.x0 < 0 || z.y0 < 0 || z.x1 > W || z.y1 > D) names.push(`zone ${z.name}`);
  }
  if (!names.length) return null;
  return `The floor can’t be that small yet. ${listNames(names)} would be outside it. Move or remove them first.`;
}
