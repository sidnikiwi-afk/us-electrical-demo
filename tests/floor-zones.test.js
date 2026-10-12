// EP-FLOOR-02 tracer. Worked literals from UX-CONTRACT §13 check 2. NOT RUN here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addZone, blankJobV2, parseBackup, serialiseJob } from '../prototype/js/core.js';

test('a named rectangular zone on a new schema 2 job survives serialise and reopen', () => {
  const job = blankJobV2('Barber refit');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };

  const id = addZone(job, {
    name: 'Cutting floor',
    x0: 2500,
    y0: 0,
    x1: 6000,
    y1: 6000,
  });

  const text = serialiseJob(job);
  const reopened = parseBackup(text);

  assert.equal(reopened.ok, true);
  const got = reopened.job;
  assert.equal(id, 'Z1');
  assert.equal(got.schema, 'surface-job');
  assert.equal(got.schemaVersion, 2);
  assert.equal(got.name, 'Barber refit');
  assert.deepEqual(got.room, { widthM: 9, depthM: 6, heightM: 2.7 });
  assert.equal(got.floor.nextWallNo, 1);
  assert.equal(got.floor.nextZoneNo, 2);
  assert.equal(got.floor.nextRouteNo, 1);
  assert.deepEqual(got.floor.walls, []);
  assert.deepEqual(got.floor.routes, []);
  assert.deepEqual(got.floor.zones, [
    { id: 'Z1', name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 },
  ]);
});
