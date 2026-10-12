// Read-only factory: every exposed mutation is refused and storage is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankJob, blankJobV2 } from '../prototype/js/core.js';
import { createJobs as createJobsV1 } from '../prototype/js/jobs.js';
import { createJobsV2, LEGACY_KEY } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

function job1(name) {
  const job = blankJob(name);
  job.room = { widthM: 6, depthM: 4, heightM: 2.7 };
  return job;
}
function job2(name) {
  const job = blankJobV2(name);
  job.room = { widthM: 6, depthM: 4, heightM: 2.7 };
  return job;
}
function factory(storage, locks, extra = {}) {
  return createJobsV2({ storage, locks, sha256, randomHex, lockWaitMs: 40, ...extra });
}
function dump(storage) {
  const out = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    out.set(key, storage.getItem(key));
  }
  return out;
}
function same(a, b) {
  assert.equal(a.size, b.size);
  for (const [key, value] of a) assert.equal(b.get(key), value);
}
function archiveText(entries, version) {
  return JSON.stringify({
    schema: 'surface-jobs-archive',
    v: version,
    exportedAt: '2026-10-12T00:00:00.000Z',
    entries: entries.map((job) => ({ job, prefs: null })),
  });
}

test('a factory without locks still refuses with no-locks and does not write', async () => {
  const storage = fakeStorage();
  const sets = storage.sets.length;
  const quiet = createJobsV2({ storage, sha256, randomHex });
  const created = await quiet.create({ job: job2('Nope') });
  assert.equal(quiet.canWrite, false);
  assert.equal(created.ok, false);
  assert.equal(created.reason, 'no-locks');
  assert.equal(storage.sets.length, sets);
});

test('readOnly prohibits every exposed mutation', async () => {
  const storage = fakeStorage();
  const live = factory(storage, fakeLocks());
  const made = await live.create({ job: job2('Kept') });
  assert.equal(made.ok, true);
  const rescue = live.writeRescue({ writerTab: 'T1', jobId: made.jobId, baseRev: 1, job: job2('Rescue copy') });
  assert.equal(rescue.ok, true);
  assert.equal(live.writeState(made.jobId), true);
  const older = createJobsV1({ storage, locks: fakeLocks(), sha256, randomHex });
  const seeded = await older.create({ job: job1('Older') });
  assert.equal(seeded.ok, true);
  storage.setItem(LEGACY_KEY, JSON.stringify(job1('Single')));
  storage.setItem('surface.jobs.v1.rescue.Told', JSON.stringify({ v: 1, job: job1('Old rescue') }));
  storage.setItem('surface.jobs.v2.import.Iabc', JSON.stringify({ v: 2, archiveSha256: 'abc', planned: [], done: [] }));
  const before = dump(storage);
  let removes = 0;
  const origRemove = storage.removeItem.bind(storage);
  storage.removeItem = (key) => { removes += 1; return origRemove(key); };
  const sets = storage.sets.length;
  const quiet = factory(storage, fakeLocks(), { readOnly: true });
  assert.equal(quiet.canWrite, false);

  const created = await quiet.create({ job: job2('Nope') });
  const saved = await quiet.save({ jobId: made.jobId, job: job2('Nope'), baseRev: made.writeRev });
  const imported = await quiet.importArchive({ text: archiveText([job1('Archive')], 1) });
  const copied = await quiet.reconcileV1({ writerTab: 'Tnew' });
  const legacy = await quiet.reconcileLegacy({ writerTab: 'Tnew' });
  const rescued = quiet.writeRescue({ writerTab: 'T1', job: job2('Replacement') });
  quiet.clearRescue('T1');
  const dismissed = quiet.dismissRescue(rescue.key);
  const promoted = await quiet.promoteRescue({ key: rescue.key, writerTab: 'Tnew' });
  const state = quiet.writeState(made.jobId);
  const journal = quiet.dismissJournal('surface.jobs.v2.import.Iabc');
  const legacyKept = await quiet.promoteLegacyKept({ key: 'surface.jobs.v1.rescue.Told', writerTab: 'Tnew' });

  for (const row of [created, saved, imported, copied, legacy, rescued, promoted, legacyKept]) {
    assert.equal(row.ok, false);
    assert.equal(row.reason, 'read-only');
  }
  assert.equal(dismissed, false);
  assert.equal(state, false);
  assert.equal(journal, false);
  assert.equal(removes, 0);
  assert.equal(storage.sets.length, sets);
  same(before, dump(storage));
  assert.equal(quiet.readJob(made.jobId).env.job.name, 'Kept');
  assert.equal(quiet.readRaw(rescue.key).includes('Rescue copy'), true);
});

test('readOnly still rejects an invalid archive before any write', async () => {
  const storage = fakeStorage();
  const quiet = factory(storage, fakeLocks(), { readOnly: true });
  const sets = storage.sets.length;
  const bad = await quiet.importArchive({ text: JSON.stringify({ schema: 'surface-jobs-archive', v: 9, entries: [{}] }) });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid');
  assert.equal(storage.sets.length, sets);
});
