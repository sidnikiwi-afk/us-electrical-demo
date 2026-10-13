// Straight trunking and conduit on one wall face.
// Offsets are whole-face millimetres, viewed from the left.
// Runs are not priced, measured as quantities, or drawn on the ceiling.

import {
  carriedOffset,
  facesFor,
  isWallId,
  wallLength,
} from './floor-walls.js';

export const MAX_ROUTES = 100;
export const MIN_ROUTE_MM = 50;
export const MAX_NOTES = 200;

const ROUTE_KEYS = ['id', 'type', 'wall', 'face', 'startMm', 'endMm', 'heightMm', 'notes'];
const EXTERIOR_FACE = { A: 'S', B: 'W', C: 'N', D: 'E' };

export function routeNumber(id) {
  if (typeof id !== 'string') return null;
  const m = /^R(\d+)$/.exec(id);
  if (!m || String(Number(m[1])) !== m[1]) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function routeLabel(route) {
  const n = routeNumber(route && route.id);
  if (!n) return 'run';
  return (route.type === 'conduit' ? 'C' : 'T') + n;
}

export function exteriorWall(room, id) {
  const face = EXTERIOR_FACE[id];
  if (!face || !room) return null;
  const W = Math.round(Number(room.widthM) * 1000);
  const D = Math.round(Number(room.depthM) * 1000);
  if (!Number.isInteger(W) || !Number.isInteger(D) || W < 0 || D < 0) return null;
  if (id === 'A') return { id, x1: 0, y1: 0, x2: W, y2: 0, onlyFace: face };
  if (id === 'C') return { id, x1: 0, y1: D, x2: W, y2: D, onlyFace: face };
  if (id === 'B') return { id, x1: W, y1: 0, x2: W, y2: D, onlyFace: face };
  return { id, x1: 0, y1: 0, x2: 0, y2: D, onlyFace: face };
}

export function wallGeometry(job, wallId) {
  if (isWallId(wallId)) {
    const walls = job && job.floor && Array.isArray(job.floor.walls) ? job.floor.walls : [];
    return walls.find(wall => wall && wall.id === wallId) || null;
  }
  return exteriorWall(job && job.room, wallId);
}

export function faceAllowed(wall, face) {
  if (!wall) return false;
  if (wall.onlyFace) return face === wall.onlyFace;
  return facesFor(wall).includes(face);
}

export function ceilingMm(room) {
  return room && room.heightM ? Math.round(Number(room.heightM) * 1000) : 0;
}

function offWallMessage(length) {
  return `Keep the run on this wall, which is ${(length / 1000).toFixed(2)} m long.`;
}

export function routeRecordError(route, index, job, nextRouteNo, seen) {
  const at = `floor.routes[${index}]`;
  if (!route || typeof route !== 'object' || Array.isArray(route)) return `${at}: not an object`;
  for (const key of Object.keys(route)) {
    if (!ROUTE_KEYS.includes(key)) return `${at}: unsupported field`;
  }
  const n = routeNumber(route.id);
  if (!n) return `${at}.id: bad format`;
  if (seen.has(route.id)) return `duplicate id ${route.id}`;
  if (!Number.isInteger(nextRouteNo) || n >= nextRouteNo) return `${at}.id: exceeds nextRouteNo`;
  if (route.type !== 'trunking' && route.type !== 'conduit') return `${at}.type: trunking or conduit`;
  if (route.wall === 'CEIL') return `${at}.wall: ceiling routes are not accepted`;
  const wall = wallGeometry(job, route.wall);
  if (!wall) return `${at}.wall: that wall is not on this floor`;
  if (!faceAllowed(wall, route.face)) return `${at}.face: that face is not on this wall`;
  if (![route.startMm, route.endMm, route.heightMm].every(Number.isInteger)) return 'A run must use whole millimetres.';
  const length = wallLength(wall);
  if (route.startMm < 0 || route.endMm > length || route.startMm >= route.endMm) return offWallMessage(length);
  if (route.endMm - route.startMm < MIN_ROUTE_MM) return 'A run must be at least 50 mm long.';
  const ceiling = ceilingMm(job && job.room);
  if (route.heightMm < 0 || route.heightMm > ceiling) return `Height must be 0 to ${ceiling} mm.`;
  if (typeof route.notes !== 'string' || route.notes.length > MAX_NOTES) return `${at}.notes: invalid`;
  return null;
}

export function routesError(job) {
  const floor = job && job.floor;
  if (!floor || !Array.isArray(floor.routes)) return 'floor.routes: not an array';
  if (floor.routes.length > MAX_ROUTES) return 'This floor already has 100 runs, which is the most it can hold.';
  const seen = new Set();
  for (let i = 0; i < floor.routes.length; i += 1) {
    const err = routeRecordError(floor.routes[i], i, job, floor.nextRouteNo, seen);
    if (err) return err;
    seen.add(floor.routes[i].id);
  }
  return null;
}

export function carriedRun(before, after, route) {
  return {
    startMm: carriedOffset(before, after, route.face, route.startMm),
    endMm: carriedOffset(before, after, route.face, route.endMm),
  };
}

export function runOffWall(wall, face, startMm, endMm) {
  if (!faceAllowed(wall, face)) return 'This change would leave a route off the wall.';
  const length = wallLength(wall);
  const bad = !Number.isInteger(startMm) || !Number.isInteger(endMm)
    || startMm < 0 || endMm > length || startMm >= endMm || endMm - startMm < MIN_ROUTE_MM;
  return bad ? 'This change would leave a route off the wall.' : null;
}

export function copyRoute(route) {
  return {
    id: route.id,
    type: route.type,
    wall: route.wall,
    face: route.face,
    startMm: route.startMm,
    endMm: route.endMm,
    heightMm: route.heightMm,
    notes: route.notes,
  };
}
