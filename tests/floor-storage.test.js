// EP-FLOOR-02 storage tracer. One public journey. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addZone, blankJobV2, validateJob } from '../prototype/js/core.js';
import { createJobsV2 } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

const LEGACY_KEY = 'surface.job.v1';
const V1_PREFIX = 'surface.jobs.v1.';
const V2_JOB_PREFIX = 'surface.jobs.v2.job.';

test('a new schema 2 zone job reopens from its v2 slot and the older v1 record stays byte-for-byte', async () => {
  const storage = fakeStorage();
  const legacyJob = JSON.parse(readFileSync(new URL('./fixtures/legacy-sample-backup.json', import.meta.url), 'utf8'));
  const legacyRecord = { v: 1, job: legacyJob };
  assert.equal(validateJob(legacyRecord.job).ok, true);
  const olderRaw = JSON.stringify(legacyRecord);
  storage.setItem(LEGACY_KEY, olderRaw);

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

  const job = blankJobV2('Barber refit');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  addZone(job, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });

  const jobs = createJobsV2({ storage, locks: fakeLocks(), sha256, randomHex });
  const created = await jobs.create({ job });
  assert.equal(created.ok, true);
  assert.match(created.jobId, /^J[0-9a-f]{16}$/);

  const opened = await jobs.readJob(created.jobId);
  assert.equal(opened.ok, true);
  assert.equal(opened.env.kind, 'surface-job-envelope');
  assert.equal(opened.env.v, 2);
  assert.equal(opened.env.jobId, created.jobId);
  const zone = [{ id: 'Z1', name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 }];
  assert.deepEqual(opened.env.job.floor.zones, zone);

  const slotKey = V2_JOB_PREFIX + created.jobId;
  const slot = JSON.parse(storage.getItem(slotKey));
  assert.equal(slot.v, 2);
  assert.equal(slot.jobId, created.jobId);
  assert.deepEqual(slot.job.floor.zones, zone);
  assert.equal(storage.getItem(LEGACY_KEY), olderRaw);
  assert.deepEqual(v1Touches, []);
});
