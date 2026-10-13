// EP-FLOOR-02 storage safety regressions. Public factory only. NOT RUN here.
// The mangled writeRescue update is expected to fail on the current candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankJob, blankJobV2 } from '../prototype/js/core.js';
import { createJobs as createJobsV1, validateArchive as validateArchiveV1 } from '../prototype/js/jobs.js';
import { createJobsV2, validateArchive, buildArchive, LEGACY_KEY, MAX_RESCUES } from '../prototype/js/jobs-v2.js';
import { fakeLocks, fakeStorage, randomHex, sha256 } from './ep21-fakes.js';

const V1_PREFIX = 'surface.jobs.v1.';
const V2_JOB = 'surface.jobs.v2.job.';
const V2_MARKER = 'surface.jobs.v2.migrated.';
const V2_RESCUE = 'surface.jobs.v2.rescue.';

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
function v1Bytes(storage) {
  const out = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === LEGACY_KEY || (typeof key === 'string' && key.startsWith(V1_PREFIX))) out.set(key, storage.getItem(key));
  }
  return out;
}
function spyV1(storage) {
  const touches = [];
  const origSet = storage.setItem.bind(storage);
  const origRemove = storage.removeItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === LEGACY_KEY || String(key).startsWith(V1_PREFIX)) touches.push(['set', String(key)]);
    return origSet(key, value);
  };
  storage.removeItem = (key) => {
    if (key === LEGACY_KEY || String(key).startsWith(V1_PREFIX)) touches.push(['remove', String(key)]);
    return origRemove(key);
  };
  return touches;
}
function sameBytes(a, b) {
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

test('create and save report quota and readback without losing a previous record', async () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const made = await jobs.create({ job: job2('Kept') });
  assert.equal(made.ok, true);
  const key = V2_JOB + made.jobId;
  const original = storage.getItem(key);

  storage.faults.set = () => true;
  const quotaSave = await jobs.save({ jobId: made.jobId, job: job2('Quota'), baseRev: made.writeRev });
  assert.equal(quotaSave.ok, false);
  assert.equal(quotaSave.reason, 'quota');
  assert.equal(storage.getItem(key), original);
  storage.faults.set = null;

  let mangled = false;
  storage.faults.mangle = () => {
    if (mangled) return false;
    mangled = true;
    return true;
  };
  const readback = await jobs.save({ jobId: made.jobId, job: job2('Readback'), baseRev: made.writeRev });
  assert.equal(readback.ok, false);
  assert.equal(readback.reason, 'readback');
  assert.equal(storage.getItem(key), original);
  storage.faults.mangle = null;

  const empty = fakeStorage();
  const fresh = factory(empty, fakeLocks());
  empty.faults.set = () => true;
  const quotaCreate = await fresh.create({ job: job2('New') });
  assert.equal(quotaCreate.ok, false);
  assert.equal(quotaCreate.reason, 'quota');
  assert.equal(fresh.scan().jobs.length, 0);
  empty.faults.set = null;
  empty.faults.mangle = () => true;
  const badCreate = await fresh.create({ job: job2('New') });
  assert.equal(badCreate.ok, false);
  assert.equal(badCreate.reason, 'readback');
  assert.equal(fresh.scan().jobs.length, 0);
});

test('a stale save leaves the stored revision in place', async () => {
  const jobs = factory(fakeStorage(), fakeLocks());
  const made = await jobs.create({ job: job2('First') });
  const renamed = job2('Second');
  const saved = await jobs.save({ jobId: made.jobId, job: renamed, baseRev: made.writeRev, writerTab: 'T1' });
  assert.equal(saved.ok, true);
  assert.equal(saved.writeRev, 2);
  const stale = await jobs.save({ jobId: made.jobId, job: job2('Third'), baseRev: made.writeRev, writerTab: 'T2' });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale');
  assert.equal(stale.storedRev, 2);
  assert.equal(stale.storedWriter, 'T1');
  assert.equal(jobs.readJob(made.jobId).env.job.name, 'Second');
});

test('missing locks refuse create, save, import, and copy', async () => {
  const storage = fakeStorage();
  const writer = factory(storage, fakeLocks());
  const made = await writer.create({ job: job2('Locked') });
  const quiet = createJobsV2({ storage, sha256, randomHex });
  assert.equal(quiet.canWrite, false);
  const sets = storage.sets.length;
  const created = await quiet.create({ job: job2('Nope') });
  const saved = await quiet.save({ jobId: made.jobId, job: job2('Nope'), baseRev: made.writeRev });
  const imported = await quiet.importArchive({ text: archiveText([job1('Nope')], 1) });
  const copied = await quiet.reconcileV1();
  assert.equal(created.reason, 'no-locks');
  assert.equal(saved.reason, 'no-locks');
  assert.equal(imported.reason, 'no-locks');
  assert.equal(copied.reason, 'no-locks');
  assert.equal(storage.sets.length, sets);
  assert.equal(quiet.readJob(made.jobId).env.writeRev, 1);
});

test('owner and catalogue locks time out instead of stealing', async () => {
  const storage = fakeStorage();
  const locks = fakeLocks();
  const jobs = factory(storage, locks);
  const made = await jobs.create({ job: job2('Owned') });
  const owner = await jobs.acquireOwner(made.jobId, 40);
  assert.ok(owner);
  assert.equal(await jobs.acquireOwner(made.jobId, 40), null);
  owner.release();

  locks.holdForever('surface.jobs.v2.lock.catalog');
  const blocked = await jobs.create({ job: job2('Busy') });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'lock-timeout');
  assert.equal(jobs.scan().jobs.length, 1);

  const v1Storage = fakeStorage();
  const v1Locks = fakeLocks();
  const older = createJobsV1({ storage: v1Storage, locks: fakeLocks(), sha256, randomHex });
  const seeded = await older.create({ job: job1('Old catalog') });
  assert.equal(seeded.ok, true);
  const copier = factory(v1Storage, v1Locks);
  v1Locks.holdForever('surface.jobs.v1.lock.catalog');
  const copy = await copier.reconcileV1({ writerTab: 'Tnew' });
  assert.equal(copy.ok, false);
  assert.equal(copy.reason, 'lock-timeout');
  assert.equal(copy.copied, 0);
  assert.equal(copier.scan().jobs.filter((row) => row.ok && row.env.origin.kind === 'v1').length, 0);
});

test('a corrupt v2 record stays byte for byte and is not rewritten', async () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const made = await jobs.create({ job: job2('Whole') });
  const key = V2_JOB + made.jobId;
  storage.setItem(key, '{');
  const sets = storage.sets.length;
  const saved = await jobs.save({ jobId: made.jobId, job: job2('Whole'), baseRev: 1 });
  const read = jobs.readJob(made.jobId);
  assert.equal(saved.ok, false);
  assert.equal(saved.reason, 'unreadable');
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'unreadable');
  assert.equal(storage.getItem(key), '{');
  assert.equal(storage.sets.length, sets);
  assert.equal(jobs.scan().jobs.find((row) => row.jobId === made.jobId).ok, false);
});

test('v1 copies repair a missing marker, skip unchanged bytes, and offer a changed job', async () => {
  const storage = fakeStorage();
  const locks = fakeLocks();
  const older = createJobsV1({ storage, locks, sha256, randomHex });
  const original = job1('Kitchen refit');
  const seeded = await older.create({ job: original });
  assert.equal(seeded.ok, true);
  const jobs = factory(storage, locks);
  const touches = spyV1(storage);
  const before = v1Bytes(storage);
  const still = () => {
    const n = touches.length;
    return () => assert.equal(touches.length, n);
  };

  const afterFirst = still();
  const first = await jobs.reconcileV1({ writerTab: 'Tnew' });
  assert.equal(first.ok, true);
  assert.equal(first.copied, 1);
  afterFirst();
  sameBytes(before, v1Bytes(storage));
  const marker = [...Array(storage.length).keys()].map((i) => storage.key(i)).find((key) => key.startsWith(V2_MARKER));
  assert.equal(typeof marker, 'string');
  storage.removeItem(marker);
  const afterRepair = still();
  const repaired = await jobs.reconcileV1({ writerTab: 'Tnew' });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.copied, 0);
  assert.equal(jobs.scan().jobs.length, 1);
  assert.equal(storage.getItem(marker) !== null, true);
  afterRepair();
  sameBytes(before, v1Bytes(storage));

  const afterAgain = still();
  const again = await jobs.reconcileV1({ writerTab: 'Tnew' });
  assert.equal(again.copied, 0);
  assert.equal(jobs.scan().jobs.length, 1);
  afterAgain();

  const edited = job1('Kitchen refit changed');
  const v1Save = await older.save({ jobId: seeded.jobId, job: edited, baseRev: seeded.writeRev });
  assert.equal(v1Save.ok, true);
  const held = v1Bytes(storage);
  const afterOffer = still();
  const offered = await jobs.reconcileV1({ writerTab: 'Tnew' });
  assert.equal(offered.ok, true);
  assert.equal(offered.copied, 0);
  assert.equal(offered.offers.length, 1);
  assert.equal(offered.offers[0].v1JobId, seeded.jobId);
  afterOffer();
  const afterAccept = still();
  const accepted = await jobs.reconcileV1({ writerTab: 'Tnew', acceptId: seeded.jobId });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.copied, 1);
  assert.equal(jobs.scan().jobs.length, 2);
  afterAccept();
  sameBytes(held, v1Bytes(storage));
  assert.equal(touches.filter((row) => row[0] === 'remove').length, 0);
});

test('single-key legacy copy keeps the old record and does not write it', async () => {
  const storage = fakeStorage();
  const raw = JSON.stringify(job1('Single key'));
  storage.setItem(LEGACY_KEY, raw);
  const jobs = factory(storage, fakeLocks());
  const touches = spyV1(storage);
  const copied = await jobs.reconcileLegacy({ writerTab: 'Tnew' });
  assert.equal(copied.ok, true);
  assert.equal(copied.status, 'migrated');
  assert.equal(copied.created, true);
  assert.equal(storage.getItem(LEGACY_KEY), raw);
  const second = await jobs.reconcileLegacy({ writerTab: 'Tnew' });
  assert.equal(second.ok, true);
  assert.equal(second.status, 'migrated');
  assert.equal(second.created, undefined);
  assert.equal(jobs.scan().jobs.length, 1);
  assert.equal(jobs.scan().jobs[0].env.job.schemaVersion, 2);
  assert.equal(touches.length, 0);
});

test('rescue promote, dismiss, and the three-copy cap use only v2 keys', async () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const made = await jobs.create({ job: job2('Already stored') });
  const same = jobs.writeRescue({ writerTab: 'Tsame', jobId: made.jobId, baseRev: 1, job: jobs.readJob(made.jobId).env.job });
  assert.equal(same.ok, true);
  const opened = jobs.scan().rescues.find((row) => row.key === same.key);
  assert.equal(opened.ok, true);
  assert.equal(opened.data.job.name, 'Already stored');
  const promoted = await jobs.promoteRescue({ key: same.key, writerTab: 'Tnew' });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.existing, true);
  assert.equal(storage.getItem(same.key), null);

  const extra = jobs.writeRescue({ writerTab: 'Textra', job: job2('Recovered page') });
  const added = await jobs.promoteRescue({ key: extra.key, writerTab: 'Tnew' });
  assert.equal(added.ok, true);
  assert.equal(storage.getItem(extra.key), null);
  assert.equal(jobs.readJob(added.jobId).env.job.name, 'Recovered page');

  const gone = jobs.writeRescue({ writerTab: 'Tgone', job: job2('Dismiss me') });
  assert.equal(jobs.dismissRescue(gone.key), true);
  assert.equal(storage.getItem(gone.key), null);
  assert.equal(jobs.dismissRescue(LEGACY_KEY), false);

  for (let i = 0; i < MAX_RESCUES; i++) {
    const kept = jobs.writeRescue({ writerTab: 'Tcap' + i, job: job2('Cap ' + i) });
    assert.equal(kept.ok, true);
  }
  const full = jobs.writeRescue({ writerTab: 'Tcap-overflow', job: job2('Overflow') });
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'rescue-full');
  assert.equal(storage.getItem(V2_RESCUE + 'Tcap-overflow'), null);
  assert.equal(jobs.rescueRoom('Tcap0'), true);
  assert.equal(jobs.rescueRoom('Tcap-overflow'), false);
  const replaced = jobs.writeRescue({ writerTab: 'Tcap0', job: job2('Cap 0 again') });
  assert.equal(replaced.ok, true);
  assert.equal(jobs.scan().rescues.filter((row) => row.key.startsWith(V2_RESCUE + 'Tcap')).length, MAX_RESCUES);
});

test('one mangled rescue update is restored on the same key', () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const first = jobs.writeRescue({ writerTab: 'Tkeep', jobId: 'Jprev', baseRev: 1, job: job2('Previous rescue') });
  assert.equal(first.ok, true);
  const kept = storage.getItem(first.key);
  let shots = 0;
  storage.faults.mangle = (key) => key === first.key && shots++ === 0;
  const second = jobs.writeRescue({ writerTab: 'Tkeep', jobId: 'Jnext', baseRev: 2, job: job2('Replacement rescue') });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'readback');
  assert.equal(storage.getItem(first.key), kept);
  const listed = jobs.scan().rescues.find((row) => row.key === first.key);
  assert.equal(listed.ok, true);
  assert.equal(listed.data.job.name, 'Previous rescue');
  assert.equal(jobs.readRaw(first.key), kept);
});

test('a persistently mangled rescue key stays unsuccessful and the previous bytes stay readable', () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const first = jobs.writeRescue({ writerTab: 'Tkeep', jobId: 'Jprev', baseRev: 1, job: job2('Previous rescue') });
  assert.equal(first.ok, true);
  const kept = storage.getItem(first.key);
  storage.faults.mangle = (key) => key === first.key;
  const second = jobs.writeRescue({ writerTab: 'Tkeep', jobId: 'Jnext', baseRev: 2, job: job2('Replacement rescue') });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'readback');
  assert.equal(jobs.scan().rescues.length <= MAX_RESCUES, true);
  const listed = jobs.scan().rescues.find((row) => row.ok && row.data.job.name === 'Previous rescue');
  assert.ok(listed);
  assert.equal(jobs.readRaw(listed.key), kept);
  assert.equal(listed.data.job.name, 'Previous rescue');
});

test('archive import rejects a bad file, upgrades v1, and resumes after the second job fails', async () => {
  const storage = fakeStorage();
  const locks = fakeLocks();
  const jobs = factory(storage, locks);
  const touches = spyV1(storage);
  const sets = storage.sets.length;
  const bad = await jobs.importArchive({ text: JSON.stringify({ schema: 'surface-jobs-archive', v: 9, entries: [{}] }) });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid');
  assert.match(bad.errors[0], /newer version/);
  assert.equal(storage.sets.length, sets);

  const v1Text = archiveText([job1('Archive one'), job1('Archive two')], 1);
  let jobWrites = 0;
  storage.faults.set = (key) => {
    if (!String(key).startsWith(V2_JOB)) return false;
    jobWrites += 1;
    return jobWrites >= 2;
  };
  const stopped = await jobs.importArchive({ text: v1Text, byteSize: v1Text.length });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.reason, 'quota');
  assert.equal(stopped.added, 1);
  assert.equal(stopped.total, 2);
  assert.equal(jobs.scan().jobs.length, 1);
  assert.equal(jobs.scan().imports.length, 1);
  assert.equal(jobs.scan().jobs[0].env.job.schemaVersion, 2);
  storage.faults.set = null;
  const resumed = await jobs.importArchive({ text: v1Text, byteSize: v1Text.length });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.added, 1);
  assert.equal(resumed.skipped, 1);
  assert.equal(jobs.scan().jobs.length, 2);
  assert.equal(jobs.scan().imports.length, 0);

  const exported = buildArchive(jobs.scan(), '2026-10-12T00:00:00.000Z');
  assert.equal(JSON.parse(exported.text).v, 2);
  const oldView = validateArchiveV1(exported.text, exported.text.length);
  assert.equal(oldView.ok, false);
  assert.equal(oldView.errors[0], 'made by a newer version of this app');
  const checked = validateArchive(exported.text, exported.text.length);
  assert.equal(checked.ok, true);
  const repeat = await jobs.importArchive({ text: exported.text, byteSize: exported.text.length });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.added, 0);
  assert.equal(repeat.skipped, 2);
  assert.equal(touches.length, 0);
});

test('the old job store does not list or remove v2 records', async () => {
  const storage = fakeStorage();
  const jobs = factory(storage, fakeLocks());
  const made = await jobs.create({ job: job2('Visible only to v2') });
  assert.equal(made.ok, true);
  jobs.writeRescue({ writerTab: 'Tkeep', job: job2('Visible only to v2') });
  const before = v1Bytes(storage);
  const older = createJobsV1({ storage, locks: fakeLocks(), sha256, randomHex });
  const listed = older.scan();
  assert.equal(listed.jobs.length, 0);
  assert.equal(listed.rescues.length, 0);
  assert.equal(listed.imports.length, 0);
  const touches = spyV1(storage);
  await older.reconcileLegacy();
  assert.equal(touches.length, 0);
  sameBytes(before, v1Bytes(storage));
  assert.equal(jobs.readJob(made.jobId).ok, true);
});
