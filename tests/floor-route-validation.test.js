// EP-FLOOR-04 saved containment validation. NOT RUN by the file-only author.
// Literal refusals, wall attachment, and exterior faces A–D.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../prototype/js/core.js';
import { outsideFloorMessage } from '../prototype/js/floor-zones.js';

function roomJob() {
  const job = C.blankJobV2('Synthetic containment');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  return job;
}

const snap = (job) => JSON.stringify(job);

function addHorizontal(job) {
  return C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
}

test('refused runs leave the job and the route counter unchanged', () => {
  const job = roomJob();
  const wall = addHorizontal(job);
  const bare = snap(job);
  assert.throws(() => C.addRoute(job, { type: 'tray', wall, face: 'N', startMm: 0, endMm: 100, heightMm: 0, notes: '' }), /trunking or conduit/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall: 'CEIL', face: 'N', startMm: 0, endMm: 100, heightMm: 0, notes: '' }), /ceiling routes are not accepted/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'E', startMm: 0, endMm: 100, heightMm: 0, notes: '' }), /that face is not on this wall/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall: 'W9', face: 'N', startMm: 0, endMm: 100, heightMm: 0, notes: '' }), /that wall is not on this floor/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 1.5, endMm: 100, heightMm: 0, notes: '' }), /whole millimetres/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: -1, endMm: 100, heightMm: 0, notes: '' }), /3\.50 m long/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 3501, heightMm: 0, notes: '' }), /3\.50 m long/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 200, endMm: 200, heightMm: 0, notes: '' }), /3\.50 m long/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 49, heightMm: 0, notes: '' }), /at least 50 mm/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: -1, notes: '' }), /Height must be 0 to 2700 mm/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 2701, notes: '' }), /Height must be 0 to 2700 mm/);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: 'x'.repeat(201) }), /notes: invalid/);
  assert.equal(snap(job), bare);
  assert.equal(job.floor.nextRouteNo, 1);
  assert.equal(job.floor.routes.length, 0);

  assert.equal(C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 3500, heightMm: 0, notes: '' }), 'R1');
  assert.equal(C.addRoute(job, { type: 'conduit', wall, face: 'S', startMm: 0, endMm: 50, heightMm: 2700 }), 'R2');
  assert.equal(job.floor.routes[1].notes, '');
  const held = snap(job);
  assert.throws(() => C.replaceRoute(job, 'R1', { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 40, heightMm: 0, notes: '' }), /at least 50 mm/);
  assert.throws(() => C.replaceRoute(job, 'R9', { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: '' }), /not on this floor/);
  assert.throws(() => C.removeRoute(job, 'R9'), /not on this floor/);
  assert.equal(snap(job), held);

  const broken = roomJob();
  addHorizontal(broken);
  broken.floor.routes.push({ id: 'R1' });
  const routed = C.validateJobV2(broken);
  assert.equal(routed.ok, false);
  assert.match(routed.errors[0], /floor\.routes\[0\]\.id: exceeds nextRouteNo/);

  const dup = roomJob();
  addHorizontal(dup);
  C.addRoute(dup, { type: 'trunking', wall: 'W1', face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: '' });
  dup.floor.routes.push({ ...dup.floor.routes[0] });
  assert.match(C.validateJobV2(dup).errors[0], /duplicate id R1/);
  dup.floor.routes[1] = { ...dup.floor.routes[0], id: 'R9' };
  assert.match(C.validateJobV2(dup).errors[0], /exceeds nextRouteNo/);
  dup.floor.routes[1] = { ...dup.floor.routes[0], id: 'R01' };
  assert.match(C.validateJobV2(dup).errors[0], /bad format/);
  dup.floor.routes[0].extra = 1;
  assert.match(C.validateJobV2(dup).errors[0], /unsupported field/);
});

test('a floor holds 100 runs and refuses the next one without moving the counter', () => {
  const job = roomJob();
  const wall = addHorizontal(job);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(C.addRoute(job, { type: i % 2 ? 'conduit' : 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: '' }), 'R' + (i + 1));
  }
  const full = snap(job);
  assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: '' }), /100 runs/);
  assert.equal(snap(job), full);
  assert.equal(job.floor.nextRouteNo, 101);
  assert.equal(job.floor.routes.length, 100);
});

test('endpoint edits keep plan positions, a moved line carries the run, and deletion does not reuse the id', () => {
  const job = roomJob();
  const wall = C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  const id = C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 1000, endMm: 2500, heightMm: 1200, notes: 'Synthetic run' });
  C.addRoute(job, { type: 'conduit', wall, face: 'S', startMm: 500, endMm: 2000, heightMm: 450, notes: '' });
  assert.deepEqual(C.faceOffsetToPlan(job, wall, 'N', 1000), { x: 5000, y: 3000 });
  const price = JSON.stringify(C.breakdown(job));

  C.replaceWall(job, wall, { x1: 2500, y1: 3000, x2: 6500, y2: 3000 });
  assert.equal(job.floor.routes[0].startMm, 1500);
  assert.equal(job.floor.routes[0].endMm, 3000);
  assert.equal(job.floor.routes[1].startMm, 500);
  assert.equal(job.floor.routes[1].endMm, 2000);
  assert.deepEqual(C.faceOffsetToPlan(job, wall, 'N', 1500), { x: 5000, y: 3000 });

  const beforeShort = snap(job);
  assert.throws(() => C.replaceWall(job, wall, { x1: 2500, y1: 3000, x2: 3200, y2: 3000 }), /leave a route off the wall/);
  assert.equal(snap(job), beforeShort);

  C.replaceWall(job, wall, { x1: 2500, y1: 3600, x2: 6500, y2: 3600 });
  assert.equal(job.floor.routes[0].startMm, 1500);
  assert.equal(job.floor.routes[0].endMm, 3000);
  assert.deepEqual(C.faceOffsetToPlan(job, wall, 'N', 1500), { x: 5000, y: 3600 });
  assert.equal(JSON.stringify(C.breakdown(job)), price);

  const blocked = snap(job);
  assert.throws(() => C.removeWall(job, wall), /Remove the runs on this wall first/);
  assert.equal(snap(job), blocked);

  assert.equal(JSON.stringify(C.breakdown(job)), price);
  C.placeItem(job, 'surface', wall, 100, 450, '', 'S');
  const priceWithFitting = JSON.stringify(C.breakdown(job));
  const withFitting = snap(job);
  assert.throws(() => C.removeWall(job, wall), /fittings, notes and sketches/);
  assert.equal(snap(job), withFitting);

  C.removeRoute(job, id);
  assert.equal(job.floor.routes.length, 1);
  assert.equal(job.floor.nextRouteNo, 3);
  C.removeRoute(job, 'R2');
  assert.equal(job.floor.routes.length, 0);
  assert.equal(C.addRoute(job, { type: 'trunking', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: '' }), 'R3');
  C.replaceRoute(job, 'R3', { type: 'conduit', wall, face: 'N', startMm: 0, endMm: 50, heightMm: 0, notes: 'kept' });
  assert.equal(job.floor.routes[0].id, 'R3');
  assert.equal(JSON.stringify(C.breakdown(job)), priceWithFitting);
  assert.equal(job.floor.routes[0].type, 'conduit');
  assert.equal(C.monotonicFloorCounters(
    { floor: { nextRouteNo: 1, nextWallNo: 1, nextZoneNo: 1 } },
    job,
  ).floor.nextRouteNo, 4);
});

test('exterior faces A to D accept only the inside face', () => {
  const job = roomJob();
  const specs = [
    ['A', 'S', 'N'],
    ['B', 'W', 'E'],
    ['C', 'N', 'S'],
    ['D', 'E', 'W'],
  ];
  for (const [wall, okFace, badFace] of specs) {
    const before = snap(job);
    assert.throws(() => C.addRoute(job, { type: 'trunking', wall, face: badFace, startMm: 0, endMm: 50, heightMm: 0, notes: '' }), /that face is not on this wall/);
    assert.equal(snap(job), before);
    const id = C.addRoute(job, { type: 'conduit', wall, face: okFace, startMm: 0, endMm: 50, heightMm: 0, notes: '' });
    assert.equal(job.floor.routes.at(-1).face, okFace);
    assert.equal(id, 'R' + job.floor.routes.length);
  }
  assert.deepEqual(C.faceOffsetToPlan(job, 'A', 'S', 1000), { x: 1000, y: 0 });
  assert.deepEqual(C.faceOffsetToPlan(job, 'C', 'N', 1000), { x: 8000, y: 6000 });
  assert.deepEqual(C.faceOffsetToPlan(job, 'B', 'W', 1000), { x: 9000, y: 1000 });
  assert.deepEqual(C.faceOffsetToPlan(job, 'D', 'E', 1000), { x: 0, y: 5000 });
  assert.equal(C.validateJobV2(job).ok, true);
});

test('a smaller floor names a run that would fall outside, and the two-argument zone sentence stays', () => {
  const zoned = roomJob();
  C.addZone(zoned, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });
  assert.equal(
    outsideFloorMessage(zoned, 2, 2),
    'The floor can’t be that small yet. zone Cutting floor would be outside it. Move or remove them first.',
  );

  const job = roomJob();
  C.addRoute(job, { type: 'trunking', wall: 'A', face: 'S', startMm: 0, endMm: 5000, heightMm: 1200, notes: '' });
  assert.match(outsideFloorMessage(job, 2, 6, 2.7), /route T1/);
  assert.match(outsideFloorMessage(job, 9, 6, 1), /route T1/);
  assert.equal(outsideFloorMessage(job, 9, 6, 2.7), null);

  const walled = roomJob();
  C.addWall(walled, { x1: 1000, y1: 1000, x2: 4000, y2: 1000 });
  C.addRoute(walled, { type: 'trunking', wall: 'W1', face: 'N', startMm: 0, endMm: 50, heightMm: 1200, notes: '' });
  const named = outsideFloorMessage(walled, 2, 2, 2.7);
  assert.match(named, /W1/);
  assert.equal(named.includes('route'), false);
});

test('a schema 1 job still validates without a floor', () => {
  const legacy = C.blankJob('Synthetic legacy');
  legacy.room = { widthM: 4, depthM: 3, heightM: 2.4 };
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'floor'), false);
  assert.equal(C.validateJob(legacy).ok, true);
});
