// Zone geometry and refusal copy used by the corrections slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankJobV2, addZone, replaceZone } from '../prototype/js/core.js';
import { positiveFaces, zoneFacts, outsideFloorMessage, edgeNotes } from '../prototype/js/floor-zones.js';

function floor() {
  const job = blankJobV2('Shop');
  job.room = { widthM: 9, depthM: 6, heightM: 2.7 };
  return job;
}

test('outside floor copy uses an apostrophe, not a backslash escape', () => {
  const job = floor();
  addZone(job, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });
  const msg = outsideFloorMessage(job, 2, 2);
  assert.equal(msg.includes('\\'), false);
  assert.match(msg, /The floor can’t be that small yet\. zone Cutting floor would be outside it\./);
});

test('a zone on the north and south edges lists only those faces', () => {
  const job = floor();
  const zone = { id: 'Z1', name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 };
  const faces = positiveFaces(job.room, zone);
  assert.deepEqual(faces.map(face => face.wall), ['A', 'C']);
  assert.equal(faces[0].fromMm, 2500);
  assert.equal(faces[0].toMm, 6000);
  assert.equal(faces[1].fromMm, 3000);
  assert.equal(faces[1].toMm, 6500);
  const facts = zoneFacts(job, zone);
  assert.equal(facts.faces, 2);
  assert.equal(facts.bareEdges, 2);
  assert.equal(facts.fittings, 0);
  assert.deepEqual(edgeNotes(zone, faces), ['East edge: no wall', 'West edge: no wall']);
});

test('a refused zone resize is byte for byte and does not reuse the zone counter', () => {
  const job = floor();
  addZone(job, { name: 'Cutting floor', x0: 2500, y0: 0, x1: 6000, y1: 6000 });
  const before = JSON.stringify(job);
  assert.throws(() => replaceZone(job, 'Z1', { name: 'Cutting floor', x0: 2500, y0: 0, x1: 12000, y1: 6000 }), /Keep the zone inside the floor/);
  assert.equal(JSON.stringify(job), before);
  assert.equal(job.floor.nextZoneNo, 2);
});
