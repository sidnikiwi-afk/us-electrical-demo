// Rectangular zones on one floor. No interior walls in this slice.
// Plan space is mm, x to the right, y down, origin at the inner corner of walls A and D.

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

// Exterior faces that lie on a zone edge. Order is north, east, south, west.
// Face offsets are whole-face fromLeft millimetres.
export function zoneExteriorFaces(room, zone) {
  if (!room || !zone) return [];
  const W = Math.round(Number(room.widthM) * 1000);
  const D = Math.round(Number(room.depthM) * 1000);
  const { x0, y0, x1, y1 } = zone;
  const faces = [];
  if (y0 === 0 && x1 > x0) faces.push({ edge: 'N', wall: 'A', face: 'S', fromMm: x0, toMm: x1 });
  if (x1 === W && y1 > y0) faces.push({ edge: 'E', wall: 'B', face: 'W', fromMm: y0, toMm: y1 });
  if (y1 === D && x1 > x0) faces.push({ edge: 'S', wall: 'C', face: 'N', fromMm: W - x1, toMm: W - x0 });
  if (x0 === 0 && y1 > y0) faces.push({ edge: 'W', wall: 'D', face: 'E', fromMm: D - y1, toMm: D - y0 });
  return faces;
}

const EDGE_LABEL = { N: 'North', E: 'East', S: 'South', W: 'West' };

export function edgeNotes(zone, faces) {
  if (!zone) return [];
  const width = zone.x1 - zone.x0;
  const depth = zone.y1 - zone.y0;
  const edges = [['N', width], ['E', depth], ['S', width], ['W', depth]];
  const notes = [];
  for (const [edge, len] of edges) {
    const covered = (faces || []).filter(f => f.edge === edge).reduce((sum, f) => sum + (f.toMm - f.fromMm), 0);
    if (covered <= 0) notes.push(`${EDGE_LABEL[edge]} edge: no wall`);
    else if (covered < len) notes.push(`${EDGE_LABEL[edge]} edge: wall on ${(covered / 1000).toFixed(2)} of ${(len / 1000).toFixed(2)} m`);
  }
  return notes;
}

export function fittingOnFace(item, face) {
  if (!item || !face || item.wall !== face.wall) return false;
  return item.fromLeftMm >= face.fromMm && item.fromLeftMm <= face.toMm;
}

export function positiveFaces(room, zone) {
  return zoneExteriorFaces(room, zone).filter(face => face.toMm > face.fromMm);
}

export function zoneFacts(job, zone) {
  const faces = positiveFaces(job && job.room, zone);
  const fittings = ((job && job.items) || []).filter(item => faces.some(face => fittingOnFace(item, face))).length;
  const bare = 4 - faces.length;
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

// Names zones that would fall outside a smaller floor. Null when the size is fine.
export function outsideFloorMessage(job, widthM, depthM) {
  const W = Math.round(Number(widthM) * 1000);
  const D = Math.round(Number(depthM) * 1000);
  const names = [];
  for (const z of zonesOf(job)) {
    if (z.x0 < 0 || z.y0 < 0 || z.x1 > W || z.y1 > D) names.push(`zone ${z.name}`);
  }
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `The floor can’t be that small yet. ${list} would be outside it. Move or remove them first.`;
}
