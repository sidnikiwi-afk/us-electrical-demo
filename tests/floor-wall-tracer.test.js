// EP-FLOOR-03 wall/fitting saved-data tracer. One public journey. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../prototype/js/core.js';
import { createJobsV2 } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

const V2_PREFIX = 'surface.jobs.v2.';
const PLAN = { x: 3500, y: 3000 };

function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
  return keys;
}

test('saved horizontal wall keeps face offsets and refuses a stranded edit', async () => {
  const job = C.blankJobV2('Synthetic walls');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  job.rates.surface = 1000;

  const zoneId = C.addZone(job, { name: 'Retained', x0: 2500, y0: 0, x1: 6000, y1: 3000 });
  assert.equal(zoneId, 'Z1');

  assert.equal(typeof C.addWall, 'function');
  assert.equal(typeof C.replaceWall, 'function');
  assert.equal(typeof C.removeWall, 'function');
  assert.equal(typeof C.faceOffsetToPlan, 'function');

  const wallId = C.addWall(job, { x1: 2500, y1: 3000, x2: 6000, y2: 3000 });
  assert.equal(wallId, 'W1');
  assert.equal(job.floor.nextWallNo, 2);
  assert.deepEqual(job.floor.walls, [
    { id: 'W1', x1: 2500, y1: 3000, x2: 6000, y2: 3000 },
  ]);

  const beforeFace = JSON.stringify(job);
  assert.throws(() => C.placeItem(job, 'surface', 'W1', 1000, 450, '', 'E'));
  assert.equal(JSON.stringify(job), beforeFace);
  assert.equal(job.nextId, 1);
  assert.deepEqual(job.items, []);

  const northId = C.placeItem(job, 'surface', 'W1', 2500, 450, '', 'N');
  const southId = C.placeItem(job, 'surface', 'W1', 1000, 450, '', 'S');
  assert.equal(northId, 'F1');
  assert.equal(southId, 'F2');
  assert.deepEqual(job.items, [
    { id: 'F1', type: 'surface', wall: 'W1', fromLeftMm: 2500, heightMm: 450, notes: '', face: 'N' },
    { id: 'F2', type: 'surface', wall: 'W1', fromLeftMm: 1000, heightMm: 450, notes: '', face: 'S' },
  ]);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'N', 2500), PLAN);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'S', 1000), PLAN);

  const priced = C.breakdown(job);
  assert.equal(priced.totalPence, 2000);
  assert.equal(priced.chargeableCount, 2);
  assert.equal(job.rates.surface, 1000);
  assert.equal(C.validateJobV2(job).ok, true);

  const reopened = C.parseBackup(C.serialiseJob(job));
  assert.equal(reopened.ok, true);
  assert.equal(C.validateJobV2(reopened.job).ok, true);
  assert.deepEqual(reopened.job.floor.walls, job.floor.walls);
  assert.deepEqual(reopened.job.floor.zones, [
    { id: 'Z1', name: 'Retained', x0: 2500, y0: 0, x1: 6000, y1: 3000 },
  ]);
  assert.equal(reopened.job.floor.nextWallNo, 2);
  assert.deepEqual(reopened.job.items.map(item => ({ id: item.id, wall: item.wall, face: item.face, fromLeftMm: item.fromLeftMm })), [
    { id: 'F1', wall: 'W1', face: 'N', fromLeftMm: 2500 },
    { id: 'F2', wall: 'W1', face: 'S', fromLeftMm: 1000 },
  ]);

  const storage = fakeStorage();
  const jobs = createJobsV2({ storage, locks: fakeLocks(), sha256, randomHex });
  const created = await jobs.create({ job });
  assert.equal(created.ok, true);
  const opened = await jobs.readJob(created.jobId);
  assert.equal(opened.ok, true);
  assert.equal(opened.env.v, 2);
  assert.equal(C.validateJobV2(opened.env.job).ok, true);
  assert.deepEqual(opened.env.job.floor.walls, job.floor.walls);
  assert.deepEqual(opened.env.job.floor.zones, reopened.job.floor.zones);
  assert.deepEqual(opened.env.job.items.map(item => item.face), ['N', 'S']);
  assert.equal(opened.env.job.rates.surface, 1000);
  const keys = storageKeys(storage);
  assert.ok(keys.length >= 1);
  assert.ok(keys.every(key => key.startsWith(V2_PREFIX)));

  C.replaceWall(job, 'W1', { x1: 2500, y1: 3000, x2: 6500, y2: 3000 });
  assert.deepEqual(job.floor.walls, [
    { id: 'W1', x1: 2500, y1: 3000, x2: 6500, y2: 3000 },
  ]);
  assert.equal(job.floor.nextWallNo, 2);
  assert.equal(job.items[0].fromLeftMm, 3000);
  assert.equal(job.items[0].face, 'N');
  assert.equal(job.items[1].fromLeftMm, 1000);
  assert.equal(job.items[1].face, 'S');
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'N', job.items[0].fromLeftMm), PLAN);
  assert.deepEqual(C.faceOffsetToPlan(job, 'W1', 'S', job.items[1].fromLeftMm), PLAN);
  assert.equal(C.breakdown(job).totalPence, 2000);
  assert.equal(C.breakdown(job).chargeableCount, 2);
  assert.equal(job.rates.surface, 1000);

  const extended = JSON.stringify(job);
  assert.throws(() => C.replaceWall(job, 'W1', { x1: 2500, y1: 3000, x2: 3200, y2: 3000 }));
  assert.equal(JSON.stringify(job), extended);
  assert.throws(() => C.removeWall(job, 'W1'));
  assert.equal(JSON.stringify(job), extended);
});
