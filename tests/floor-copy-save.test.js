// EP-FLOOR-02 copy/save red tracer. One public journey. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addZone, blankJob, placeItem } from '../prototype/js/core.js';
import { createJobs } from '../prototype/js/jobs.js';
import { createJobsV2 } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

const LEGACY_KEY = 'surface.job.v1';
const V1_PREFIX = 'surface.jobs.v1.';

function v1Bytes(storage) {
  const out = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === LEGACY_KEY || (typeof key === 'string' && key.startsWith(V1_PREFIX))) {
      out.set(key, storage.getItem(key));
    }
  }
  return out;
}

test('copy a v1 job into schema 2, save a Cutting floor zone, and leave every old byte unchanged', async () => {
  const storage = fakeStorage();
  const locks = fakeLocks();
  const older = createJobs({ storage, locks, sha256, randomHex });
  const job = blankJob('Barber refit');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  job.rates.surface = 7777;
  placeItem(job, 'surface', 'B', 1500, 450, '');

  const seeded = await older.create({ job });
  assert.equal(seeded.ok, true);

  const captured = v1Bytes(storage);
  const v1Key = V1_PREFIX + 'job.' + seeded.jobId;
  assert.equal(typeof captured.get(v1Key), 'string');
  const v1Job = JSON.parse(captured.get(v1Key)).job;
  assert.deepEqual(v1Job.room, { widthM: 9, depthM: 6, heightM: 2.7 });
  assert.equal(v1Job.rates.surface, 7777);
  assert.deepEqual(v1Job.items, [
    { id: 'F1', type: 'surface', wall: 'B', fromLeftMm: 1500, heightMm: 450, notes: '' },
  ]);

  const v1Touches = [];
  const refuseV1 = (key) => {
    if (key === LEGACY_KEY || String(key).startsWith(V1_PREFIX)) {
      v1Touches.push(String(key));
      throw new Error('v1 write refused: ' + key);
    }
  };
  const origSet = storage.setItem.bind(storage);
  const origRemove = storage.removeItem.bind(storage);
  storage.setItem = (key, value) => {
    refuseV1(key);
    return origSet(key, value);
  };
  storage.removeItem = (key) => {
    refuseV1(key);
    return origRemove(key);
  };

  const jobs = createJobsV2({ storage, locks, sha256, randomHex });
  const first = await jobs.reconcileV1();
  assert.equal(first.ok, true);
  assert.equal(first.copied, 1);

  const listed = jobs.scan();
  assert.equal(listed.jobs.length, 1);
  const row = listed.jobs[0];
  assert.equal(row.ok, true);
  assert.equal(row.env.kind, 'surface-job-envelope');
  assert.equal(row.env.v, 2);
  assert.equal(row.env.job.schemaVersion, 2);
  assert.equal(row.env.job.name, v1Job.name);
  assert.equal(row.env.job.revision, v1Job.revision);
  assert.deepEqual(row.env.job.room, v1Job.room);
  assert.deepEqual(row.env.job.items, v1Job.items);
  assert.deepEqual(row.env.job.rates, v1Job.rates);
  assert.deepEqual(row.env.job.floor, {
    walls: [],
    zones: [],
    routes: [],
    nextWallNo: 1,
    nextZoneNo: 1,
    nextRouteNo: 1,
  });

  const zoneId = addZone(row.env.job, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });
  assert.equal(zoneId, 'Z1');
  row.env.job.revision += 1;
  const baseRev = row.env.writeRev;
  const saved = await jobs.save({ jobId: row.jobId, job: row.env.job, baseRev });
  assert.equal(saved.ok, true);
  assert.equal(saved.writeRev, baseRev + 1);

  const opened = await jobs.readJob(row.jobId);
  assert.equal(opened.ok, true);
  const zone = [{ id: 'Z1', name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 }];
  assert.deepEqual(opened.env.job.floor.zones, zone);
  assert.equal(opened.env.job.rates.surface, 7777);
  assert.equal(opened.env.job.revision, v1Job.revision + 1);
  assert.deepEqual(opened.env.job.items, v1Job.items);

  const second = await jobs.reconcileV1();
  assert.equal(second.ok, true);
  assert.equal(second.copied, 0);
  const again = jobs.scan();
  assert.equal(again.jobs.length, 1);
  assert.equal(again.jobs[0].ok, true);
  assert.equal(again.jobs[0].jobId, row.jobId);
  assert.deepEqual(again.jobs[0].env.job.floor.zones, zone);
  assert.equal(again.jobs[0].env.job.rates.surface, 7777);

  const after = v1Bytes(storage);
  assert.equal(after.size, captured.size);
  for (const [key, raw] of captured) assert.equal(after.get(key), raw);
  assert.deepEqual(v1Touches, []);
});
