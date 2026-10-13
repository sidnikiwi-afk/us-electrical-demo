// EP-FLOOR-03 wall validation. Public saved-data cases. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../prototype/js/core.js';

function roomJob() {
  const job = C.blankJobV2('Synthetic walls');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  job.rates.surface = 1000;
  return job;
}

const snap = (job) => JSON.stringify(job);

test('vertical E and W offsets mirror onto one plan point', () => {
  const job = roomJob();
  assert.equal(C.addWall(job, { x1: 4000, y1: 1000, x2: 4000, y2: 5000 }), 'W1');
  assert.equal(C.placeItem(job, 'surface', 'W1', 1500, 450, '', 'W'), 'F1');
  assert.equal(C.placeItem(job, 'surface', 'W1', 2500, 450, '', 'E'), 'F2');
  const plan = { x: 4000, y: 2500 };
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'W', 1500), plan);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'E', 2500), plan);
  assert.equal(C.maxFromLeft(job, job.items[0]), 4000);

  C.replaceWall(job, 'W1', { x1: 4000, y1: 1000, x2: 4000, y2: 5600 });
  assert.equal(job.items[0].fromLeftMm, 1500);
  assert.equal(job.items[0].face, 'W');
  assert.equal(job.items[1].fromLeftMm, 3100);
  assert.equal(job.items[1].face, 'E');
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'W', job.items[0].fromLeftMm), plan);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'E', job.items[1].fromLeftMm), plan);

  C.replaceWall(job, 'W1', { x1: 4500, y1: 1000, x2: 4500, y2: 5600 });
  assert.equal(job.items[0].fromLeftMm, 1500);
  assert.equal(job.items[1].fromLeftMm, 3100);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'W', 1500), { x: 4500, y: 2500 });
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'E', 3100), { x: 4500, y: 2500 });
  assert.equal(C.breakdown(job).totalPence, 2000);
  assert.equal(C.breakdown(job).chargeableCount, 2);
  assert.equal(job.floor.nextWallNo, 2);
});

test('malformed, boundary and overlapping walls are refused without mutation', () => {
  const job = roomJob();
  const before = snap(job);
  assert.throws(() => C.addWall(job, { x1: 1000.5, y1: 1000, x2: 2000, y2: 1000 }), /whole millimetres/);
  assert.throws(() => C.addWall(job, { x1: 2000, y1: 1000, x2: 1000, y2: 1000 }), /ends in order/);
  assert.throws(() => C.addWall(job, { x1: 1000, y1: 1000, x2: 2000, y2: 1800 }), /horizontal or vertical/);
  assert.throws(() => C.addWall(job, { x1: 1000, y1: 2000, x2: 1099, y2: 2000 }), /at least 100 mm/);
  assert.throws(() => C.addWall(job, { x1: 1000, y1: 1000, x2: 9001, y2: 1000 }), /inside the floor/);
  assert.throws(() => C.addWall(job, { x1: 1000, y1: 0, x2: 2000, y2: 0 }), /outside of the floor/);
  assert.throws(() => C.addWall(job, { x1: 0, y1: 1000, x2: 0, y2: 2500 }), /outside of the floor/);
  assert.throws(() => C.addWall(job, { x1: 9000, y1: 1000, x2: 9000, y2: 2500 }), /outside of the floor/);
  assert.equal(snap(job), before);

  assert.equal(C.addWall(job, { x1: 0, y1: 1500, x2: 2000, y2: 1500 }), 'W1');
  assert.equal(C.addWall(job, { x1: 1000, y1: 2000, x2: 3000, y2: 2000 }), 'W2');
  assert.equal(C.addWall(job, { x1: 3000, y1: 2000, x2: 5000, y2: 2000 }), 'W3');
  assert.equal(C.addWall(job, { x1: 2000, y1: 2000, x2: 2000, y2: 4000 }), 'W4');
  const joined = snap(job);
  assert.throws(() => C.addWall(job, { x1: 2500, y1: 2000, x2: 4000, y2: 2000 }), /cover 0\.50 m of W2/);
  assert.equal(snap(job), joined);
  assert.equal(job.floor.nextWallNo, 5);
});

test('the wall cap and a route are refused, and legacy placement is unchanged', () => {
  const job = roomJob();
  for (let i = 0; i < 50; i += 1) {
    const y = 100 + i * 100;
    C.addWall(job, { x1: 1000, y1: y, x2: 2000, y2: y });
  }
  assert.equal(job.floor.walls.length, 50);
  assert.equal(job.floor.nextWallNo, 51);
  const full = snap(job);
  assert.throws(() => C.addWall(job, { x1: 1000, y1: 5200, x2: 2000, y2: 5200 }), /50 walls/);
  assert.equal(snap(job), full);

  const legacy = roomJob();
  const id = C.placeItem(legacy, 'surface', 'B', 1500, 450, 'keep');
  assert.equal(legacy.items[0].face, undefined);
  assert.equal(id, 'F1');
  assert.equal(C.placeLike(legacy, { type: 'switch' }, 'A', 400, 1200), 'F2');
  assert.equal(legacy.items[1].face, undefined);
  assert.equal(C.breakdown(legacy).totalPence, 3500);
  const plain = snap(legacy);
  assert.throws(() => C.placeItem(legacy, 'surface', 'A', 100, 450, '', 'S'), /not on this wall/);
  assert.equal(snap(legacy), plain);
  legacy.floor.routes.push({ id: 'R1' });
  const routed = C.validateJobV2(legacy);
  assert.equal(routed.ok, false);
  assert.match(routed.errors[0], /routes/);
});

test('invalid faces and offsets do not place, and a stale fitting is not clamped', () => {
  const job = roomJob();
  C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  const before = snap(job);
  assert.throws(() => C.placeItem(job, 'surface', 'W1', 1000, 450, ''), /not on this wall/);
  assert.throws(() => C.placeItem(job, 'surface', 'W1', 1000, 450, '', 'E'), /not on this wall/);
  assert.throws(() => C.placeItem(job, 'surface', 'W1', 3501, 450, '', 'S'), /off the wall/);
  assert.throws(() => C.placeItem(job, 'surface', 'W1', 100, 2701, '', 'S'), /height must be 0/);
  assert.throws(() => C.placeItem(job, 'surface', 'W9', 100, 450, '', 'S'), /not on this floor/);
  assert.equal(snap(job), before);
  assert.equal(job.nextId, 1);

  const like = C.placeLike(job, { type: 'surface', layer: 'power' }, 'W1', 1000, 450, 'S');
  assert.equal(like, 'F1');
  assert.equal(job.items[0].face, 'S');
  assert.equal(job.items[0].fromLeftMm, 1000);
  C.setItemType(job, 'F1', 'downlight');
  assert.equal(job.items[0].wall, C.CEILING);
  assert.equal(job.items[0].face, undefined);

  const held = roomJob();
  C.addWall(held, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  C.placeItem(held, 'surface', 'W1', 1000, 450, '', 'S');
  held.items[0].fromLeftMm = 9000;
  const stale = C.validateJobV2(held);
  assert.equal(stale.ok, false);
  assert.match(stale.errors[0], /outside wall/);
  assert.equal(held.items[0].fromLeftMm, 9000);
  held.items[0].fromLeftMm = 1000;
  held.items[0].wall = 'W9';
  assert.match(C.validateJobV2(held).errors[0], /not on this floor/);
  assert.equal(held.items[0].wall, 'W9');
});

test('attached edits and deletion are atomic; an unattached wall id is not reused', () => {
  const job = roomJob();
  C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  C.placeItem(job, 'surface', 'W1', 2500, 450, '', 'N');
  const placed = snap(job);
  assert.throws(() => C.replaceWall(job, 'W1', { x1: 2500, y1: 3000, x2: 3200, y2: 3000 }), /leave a fitting off the wall/);
  assert.throws(() => C.replaceWall(job, 'W1', { x1: 4000, y1: 1000, x2: 4000, y2: 4000 }), /not on this wall/);
  assert.throws(() => C.removeWall(job, 'W1'), /fittings, notes and sketches/);
  assert.equal(snap(job), placed);
  assert.equal(job.floor.nextWallNo, 2);
  assert.equal(job.nextId, 2);

  const bare = roomJob();
  C.addWall(bare, { x1: 1000, y1: 1000, x2: 2500, y2: 1000 });
  bare.annotations['W1.N'] = [];
  bare.annotations['W1.S'] = [];
  C.removeWall(bare, 'W1');
  assert.equal(bare.floor.walls.length, 0);
  assert.equal(bare.floor.nextWallNo, 2);
  assert.equal(bare.annotations['W1.N'], undefined);
  assert.equal(bare.annotations['W1.S'], undefined);
  assert.ok(Array.isArray(bare.annotations.PLAN));
  assert.equal(C.addWall(bare, { x1: 1000, y1: 1200, x2: 2500, y2: 1200 }), 'W2');
  assert.equal(bare.floor.nextWallNo, 3);

  const shrunk = roomJob();
  C.addWall(shrunk, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  C.placeItem(shrunk, 'surface', 'W1', 1000, 450, '', 'S');
  const wide = snap(shrunk);
  assert.deepEqual(C.itemsOutside(shrunk, 1, 1, 2.7), []);
  C.moveOutsideItemsToEdge(shrunk, 1, 1, 2.7);
  assert.equal(snap(shrunk), wide);
  assert.equal(shrunk.floor.walls.length, 1);
});

test('face notes and sketches survive backup and remap, and a short wall is atomic', () => {
  const job = roomJob();
  C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  job.notePins.push(
    { id: 'P1', view: 'W1.N', x: 2500, y: 400, text: 'north mark' },
    { id: 'P2', view: 'W1.S', x: 1000, y: 400, text: 'south mark' },
  );
  job.annotations['W1.N'] = [{ points: [[2500, 400], [2600, 500]] }];
  job.annotations['W1.S'] = [{ points: [[1000, 300]] }];
  assert.equal(C.validateJobV2(job).ok, true);
  const reopened = C.parseBackup(C.serialiseJob(job));
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.job.notePins.map(pin => ({ view: pin.view, x: pin.x })), [
    { view: 'W1.N', x: 2500 },
    { view: 'W1.S', x: 1000 },
  ]);
  assert.deepEqual(reopened.job.annotations['W1.N'][0].points, [[2500, 400], [2600, 500]]);
  assert.deepEqual(reopened.job.floor.walls, [{ id: 'W1', x1: 2500, y1: 3000, x2: 6000, y2: 3000 }]);

  C.replaceWall(job, 'W1', { x1: 2500, y1: 3000, x2: 6500, y2: 3000 });
  assert.equal(job.notePins[0].x, 3000);
  assert.equal(job.notePins[1].x, 1000);
  assert.deepEqual(job.annotations['W1.N'][0].points, [[3000, 400], [3100, 500]]);
  assert.deepEqual(job.annotations['W1.S'][0].points, [[1000, 300]]);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'N', 3000), { x: 3500, y: 3000 });
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'S', 1000), { x: 3500, y: 3000 });

  const extended = snap(job);
  assert.throws(() => C.replaceWall(job, 'W1', { x1: 2500, y1: 3000, x2: 3200, y2: 3000 }), /leave a note off the wall/);
  assert.equal(snap(job), extended);
  assert.throws(() => C.removeWall(job, 'W1'), /fittings, notes and sketches/);
  assert.equal(snap(job), extended);
  assert.equal(job.floor.nextWallNo, 2);
});


test('canonical interior face views use the agreed dotted saved key', () => {
  const job = roomJob();
  C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  job.annotations['W1.N'] = [{ points: [[1000, 400], [1500, 500]] }];
  job.notePins = [{ id: 'P1', view: 'W1.N', x: 1000, y: 400, text: 'north note' }];
  assert.equal(C.validateJobV2(job).ok, true);
  const opened = C.parseBackup(C.serialiseJob(job));
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.job.annotations['W1.N'], job.annotations['W1.N']);
  assert.equal(opened.job.notePins[0].view, 'W1.N');
  const bad = JSON.parse(JSON.stringify(job));
  bad.notePins[0].view = 'W1N';
  assert.equal(C.validateJobV2(bad).ok, false);
});
