// EP-FLOOR-02 save validation regression. One public journey. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankJob, blankJobV2, validateJob } from '../prototype/js/core.js';
import { createJobsV2 } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

const V2_JOB_PREFIX = 'surface.jobs.v2.job.';

test('a valid schema 1 job saved into an existing v2 slot is invalid and writes nothing', async () => {
  const storage = fakeStorage();
  const jobs = createJobsV2({ storage, locks: fakeLocks(), sha256, randomHex });
  const stored = blankJobV2('Barber refit');
  stored.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  const created = await jobs.create({ job: stored });
  assert.equal(created.ok, true);

  const key = V2_JOB_PREFIX + created.jobId;
  const original = storage.getItem(key);
  assert.equal(typeof original, 'string');

  let writes = 0;
  let removes = 0;
  const origSet = storage.setItem.bind(storage);
  const origRemove = storage.removeItem.bind(storage);
  storage.setItem = (k, v) => { writes += 1; return origSet(k, v); };
  storage.removeItem = (k) => { removes += 1; return origRemove(k); };

  const legacy = blankJob('Older room');
  legacy.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(validateJob(legacy).ok, true);

  const saved = await jobs.save({ jobId: created.jobId, job: legacy, baseRev: created.writeRev });
  assert.equal(saved.ok, false);
  assert.equal(saved.reason, 'invalid');
  assert.equal(writes, 0);
  assert.equal(removes, 0);
  assert.equal(storage.getItem(key), original);
});
