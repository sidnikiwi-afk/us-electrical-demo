// Zone refusal and v2 recovery checks. NOT RUN by the file-only worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addZone, blankJob, blankJobV2, removeZone, replaceZone, upgradeV1, monotonicFloorCounters } from '../prototype/js/core.js';
import { createJobs } from '../prototype/js/jobs.js';
import { createJobsV2, validateArchive, buildArchive, BUILD } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

function roomJob() {
  const job = blankJobV2('Barber refit');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  return job;
}

test('a refused zone edit is byte-identical and keeps the next zone number', () => {
  const job = roomJob();
  addZone(job, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });
  const before = JSON.stringify(job);
  assert.throws(() => replaceZone(job, 'Z1', { name: '   ', x0: 2500, y0: 0, x1: 6000, y1: 6000 }));
  assert.throws(() => replaceZone(job, 'Z1', { name: 'Cutting floor', x0: -10, y0: 0, x1: 6000, y1: 6000 }));
  assert.equal(JSON.stringify(job), before);
  removeZone(job, 'Z1');
  assert.equal(job.floor.zones.length, 0);
  assert.equal(job.floor.nextZoneNo, 2);
  const restored = JSON.parse(before);
  monotonicFloorCounters(restored, job);
  assert.equal(restored.floor.nextZoneNo, 2);
});

test('a disguised v1 backup is refused and a v1 archive upgrades without writing v1 keys', async () => {
  const disguised = blankJob('Old');
  disguised.room = { widthM: 4, depthM: 3, heightM: 2.4 };
  disguised.floor = { walls: [], zones: [], routes: [], nextWallNo: 1, nextZoneNo: 1, nextRouteNo: 1 };
  const refused = upgradeV1(disguised);
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0], /can’t be trusted/);

  const plain = blankJob('Old');
  plain.room = { widthM: 4, depthM: 3, heightM: 2.4 };
  const archive = JSON.stringify({ schema: 'surface-jobs-archive', v: 1, exportedAt: '2026-10-12T00:00:00.000Z', entries: [{ job: plain, prefs: null }] });
  const parsed = validateArchive(archive, archive.length);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries[0].job.schemaVersion, 2);
  assert.equal(parsed.entries[0].job.floor.zones.length, 0);

  const storage = fakeStorage();
  const locks = fakeLocks();
  const older = createJobs({ storage, locks, sha256, randomHex });
  const seeded = await older.create({ job: plain });
  assert.equal(seeded.ok, true);
  const jobs = createJobsV2({ storage, locks, sha256, randomHex });
  const copied = await jobs.reconcileV1();
  assert.equal(copied.copied, 1);
  const again = await jobs.reconcileV1({ accept: true });
  assert.equal(again.copied, 0);
  const listed = jobs.scan();
  const text = buildArchive(listed, '2026-10-12T00:00:00.000Z').text;
  assert.equal(JSON.parse(text).v, 2);
  assert.equal(BUILD, 'surface-proto-v15-floor-routes-20261013');
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (String(key).startsWith('surface.jobs.v1.') || key === 'surface.job.v1') {
      assert.equal(storage.getItem(key), storage.getItem(key));
    }
  }
});
