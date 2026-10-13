# EP-FLOOR-01 storage design: version isolation for floor geometry

Packet EP-FLOOR-01 v1, snapshot 62c59e2, runtime reference 94d6345. Author: Opus 5.5 (claude-opus-5-5). This is an architectural recommendation and contains no code. The controller verifies the anchors before any edit. All tests are NOT RUN.

## 1. Facts in the current code that decide the design

- F1. The old app reads job records only under `surface.jobs.v1.` and the single key `surface.job.v1` (jobs.js:11-20, `scan` at jobs.js:197). It ignores every other key.
- F2. An old envelope must have `kind: 'surface-job-envelope'` and `v: 1` (jobs.js:75). The job inside must pass `validateJob`, which requires `schemaVersion === 1` (core.js:5-6, 348).
- F3. `validateJob` ignores fields it doesn't know. `normaliseJob` copies them through with `...job` (core.js:438), and `save` writes them back (jobs.js:276, 290). Consequence: a job tagged schemaVersion 1 that carried a `floor` block would load in the old app, which could then change the room size or delete fittings and save stale geometry next to them. **New data must never be tagged schemaVersion 1.**
- F4. The old app lists unreadable records under its own prefix in Recover, and the user can delete them there (ui.js:658, 742). They also count toward its 20-job cap (jobs.js:22, 268). So a v2 record placed under the v1 prefix would be safe from overwriting, but the old app could still delete it, and it would take up job slots.
- F5. Old archive import refuses `v !== 1` with "made by a newer version of this app" (jobs.js:131). Old single-job import refuses any `schemaVersion` other than 1 (core.js:348 via `parseBackup`, core.js:454).
- F6. Legacy copy-upgrade already exists for `surface.job.v1`. It copies and never moves, uses a sha256 marker, checks readback, repairs a crash between job and marker, and offers instead of auto-adding after a rollback (jobs.js:332-399). This design reuses that pattern one level up.
- F7. The service worker precaches all modules atomically under one cache name (sw.js:3, 8). A page served without the worker can still mix module versions from the HTTP cache.

## 2. Decision

Schema 2 records live in a **separate namespace with their own envelope version and job schemaVersion**. Every older namespace is read-only for the new code.

| Thing | Old (kept, read only) | New |
| --- | --- | --- |
| Job schema | `schema 'surface-job'`, `schemaVersion 1` | `schema 'surface-job'`, `schemaVersion 2` |
| Key prefix | `surface.jobs.v1.` | `surface.jobs.v2.` |
| Envelope | `kind 'surface-job-envelope'`, `v 1` | same kind, `v 2` |
| Job / marker / import / rescue / state keys | `…v1.job.`, `.migrated.`, `.import.`, `.rescue.`, `.state` | same suffixes under `surface.jobs.v2.` |
| Locks | `surface.jobs.v1.lock.*` | `surface.jobs.v2.lock.*` |
| Single-job backup | job JSON, schemaVersion 1 | job JSON, schemaVersion 2 |
| All-jobs archive | `schema 'surface-jobs-archive'`, `v 1` | same schema name, `v 2` |
| Service worker cache | `surface-proto-v12-jobs-review-20261004` | new name, for example `surface-proto-v13-floor-zones-<date>` |

Hard invariant **I1**: new code never calls `setItem` or `removeItem` on a key that starts with `surface.jobs.v1.` or equals `surface.job.v1`. One test wraps storage and fails on any such call during boot, open, save, import, Recover and print.

Reasons:
- F1 means the old app can't see, count, delete or overwrite v2 records, so "old app silently writes over new geometry" can't happen.
- F2 and F5 mean a v2 job or archive given to the old app by hand is rejected with its existing message.
- F3 is the reason a schemaVersion bump alone isn't enough. A separate prefix is needed as well, because of F4.

## 3. Schema 2 job (data contract for the validators)

All v1 fields stay with the same meaning. Schema 2 adds:

```
floor: {
  walls:  [{ id:'W<n>', x1, y1, x2, y2 }],            // interior only; A to D stay implicit from room
  zones:  [{ id:'Z<n>', name, x0, y0, x1, y1 }],
  routes: [{ id:'R<n>', type:'trunking'|'conduit', wall, face, startMm, endMm, heightMm, notes }],
  nextWallNo, nextZoneNo, nextRouteNo                    // integers >= 1, monotonic like nextId
}
items[i].face   // required when items[i].wall is an interior wall ID; absent for A to D and CEIL
annotations / notePins view keys: 'PLAN','A'..'D' plus '<wallId>.<face>' for interior faces
```

`validateJobV2` rules. Each one is a negative test.
- All mm values are integers. Walls are axis aligned, at least 100 mm long, inside the floor and not on its boundary, with no collinear overlap. Wall IDs match `^W\d+$`, are unique and are each below `nextWallNo`.
- Zones are at least 100 × 100 mm, inside the floor, don't overlap (shared edges are fine), have unique names ignoring case, and have IDs below `nextZoneNo`.
- Routes reference an existing wall/face pair valid for its orientation (section 1 of UX-CONTRACT). They satisfy `0 <= startMm < endMm <= faceLength` with a length of at least 50 mm and a height between 0 and the ceiling. IDs are below `nextRouteNo`.
- Items on interior walls have a valid face and lie within the face length and ceiling. A to D and CEIL keep the v1 rules unchanged.
- Annotation and pin keys must name an existing face.
- Limits: 50 walls, 30 zones, 100 routes, and the record size limit (jobs.js:27) stays.
- `normaliseJobV2` fills missing `floor` arrays and counters. `serialiseJob` refuses anything that `validateJobV2` rejects, as the v1 serialiser does (core.js:425).

Upgrading v1 to v2 is a pure function `upgradeV1(job)`. It copies every field, sets `schemaVersion: 2` and adds an empty `floor` with counters at 1. It doesn't touch items, rates, notes, annotations, `createdAt` or `savedAt`, so it loses nothing and gives the same result every time. `canonicalV2(upgradeV1(x))` is the duplicate key for upgraded content.

Keep the existing v1 `validateJob`/`parseBackup` exported unchanged as `validateJobV1`/`parseBackupV1`. Existing pure tests keep running against them. New import and copy paths add one check on top: a schemaVersion 1 job that has a `floor` key, or an item with a `face` key, is refused as "This backup has floor data under an older version number, so it can't be trusted." This catches disguised data without changing the v1 validator itself.

## 4. Boot and copy-upgrade (extends §4.6 boot, ui.js:3251)

The order is fixed. Each step runs under `surface.jobs.v2.lock.catalog`.

1. **Build check.** `core.js`, `jobs.js` and `ui.js` each export the same `BUILD` string. If they differ, open read-only with "This page loaded parts of two app versions. Reload to finish updating. Nothing has been saved." and skip every write path.
2. **Newer namespace check.** If any `surface.jobs.v3.` key exists, show "Jobs saved by a newer version of this app are on this device. This version can't open them and won't change them." The app still works on v2.
3. **Single legacy key.** Run `reconcileLegacy` again with the v2 prefix and `upgradeV1`. The marker is `surface.jobs.v2.migrated.<sha256(raw)>` and the origin is `{kind:'legacy', legacySha256}`.
4. **v1 namespace copy.**
   - Try `surface.jobs.v1.lock.catalog` with the bounded wait (jobs.js:30). This stops a copy happening halfway through an old-tab archive import. On timeout, skip the step for this boot and show "An older version of this app is busy in another tab. Older jobs will be copied next time."
   - Then, for every readable v1 envelope, oldest `createdAt` first:
     - Hash the raw record bytes (`sha256(raw)`).
     - A marker `…v2.migrated.<sha>` already exists: skip.
     - A v2 job with `origin.v1Sha256 === sha` exists: write the marker (repair) and skip.
     - A v2 job has the same `canonicalV2(upgradeV1(job))`: write the marker pointing to it and skip.
     - Other v2 markers already point to an earlier hash of the **same v1 jobId** (the old app edited it after the copy): don't add it. Record an **offer**: "“Kitchen refit” was changed in the older version after it was copied. Add that version as a separate job?" Buttons: `Add as separate job` and `Not now`. It works like the existing `offer` (jobs.js:386).
     - Otherwise copy it: `writeNew` under v2 with origin `{kind:'v1', v1JobId, v1Sha256: sha, v1WriteRev}` and prefs copied. Read back, compare `canonicalV2`, then write the marker.
   - Release the v1 lock. Unreadable v1 records aren't copied. Recover lists them for download only, with no delete (I1).
5. **v1 rescues and journals.** List them in Recover under "From the older version (kept as they are)". The only actions are `Download` and `Open as new job` (copy-upgrade with a sha marker). They never force Recover open.
6. Reopen the last job from `surface.jobs.v2.state`. On the first boot after upgrade, fall back to the v2 copy of `surface.jobs.v1.state`'s job, which is read only.

A v1 record is never upgraded where it sits. Its raw bytes stay in place, and the old app can still read them byte for byte.

## 5. Failure handling

- **Quota or readback failure during the copy.**
  - Stop copying. Every job already copied keeps its marker. The failed job's own new key is removed, as `writeNew` already does (jobs.js:254-257).
  - Show: "Only 7 of 12 older jobs could be copied because this device's storage is full. The rest are still saved in the older format. Download all jobs to keep a copy."
  - The download builds a **v1** archive from the uncopied v1 records' raw jobs, which the old app can import.
  - The next boot retries, and the markers stop any duplicates.
- **Cap.** v2 keeps `MAX_JOBS` 20. If copying would pass it, copy none of the rest. Show "The job list is full (20 jobs), so 3 older jobs weren't copied. Open Jobs to remove one, or download them."
- **Save failures.** The existing `quota`, `readback`, `stale`, `lock-timeout` and `blocked` results and their messages apply unchanged to v2 saves. Rescue copies go to `surface.jobs.v2.rescue.<tab>`.
- **Locks unavailable.** This is the existing protected read-only fallback (jobs.js:162, 181). Nothing is copied. v1 jobs open in memory after `upgradeV1`, marked "Not saved on this device". Download backup still works.
- **Corrupted v2 record.** Same as today: listed as unreadable, never rewritten, downloadable. Delete needs confirmation and acts on v2 keys only.

## 6. Old and new tabs at the same time

- Old tab (cached v12) and new tab: they share no keys or locks, so neither can overwrite the other. Edits made in the old tab after the copy show up in the new app as the offer in step 4. The new app never merges them automatically.
- Two new tabs: the existing owner lock (`lockOwner`, jobs.js:314) and the `writeRev` compare-and-write (jobs.js:287) apply under the v2 prefix.
- A new tab that has a v1 job only in memory (no locks) can't save over the v1 record, because of I1.

## 7. Import and export

- Single-job import accepts schemaVersion 1 (runs `upgradeV1`, origin `{kind:'import'}`) or 2, and always creates a new v2 job (`create`, jobs.js:265).
- An unknown schemaVersion gets "This backup was made by a newer version of this app." Anything else gets the existing error text.
- All-jobs import accepts archive `v 1` (upgrade each entry) or `v 2`. The validate, journal, apply phases and duplicate rule (jobs.js:463-511) stay, with duplicates judged by `canonicalV2` after upgrading. The journal lives under `surface.jobs.v2.import.`.
- Export writes schemaVersion 2 jobs and archive `v 2`. The old app rejects both with its own messages (F5). Nothing gets truncated or misread.
- Exports don't offer a downgrade to v1. See UNRESOLVED in 01-RESULT.md.

## 8. Rollback

- **What survives a rollback to 94d6345 or any v1 build.** The old app finds `surface.job.v1` and `surface.jobs.v1.*` exactly as they were before the upgrade, so all older jobs open and save normally.
- **What doesn't.** Jobs created in v2, and edits made in v2 to copied jobs, are invisible to the old app. Their v2 backups can't be imported there.
- **Recovery.** Records stay in `surface.jobs.v2.*`. Re-deploying the new build shows them again. A rollback must never clear site data. Release notes must say this before publication.
- **Rollback, edits, then upgrade again.** Step 4 offers the changed v1 jobs. Nothing gets duplicated silently or lost.
- **Space.** v1 records are never removed, so storage use grows by about the size of the copied jobs. Freeing space would be a destructive action and needs separate approval.

## 9. Acceptance cases (synthetic fixtures only; NOT RUN)

1. Fixture: legacy `surface.job.v1` plus 3 v1 envelopes. After boot there are 4 v2 jobs, 4 v2 markers, and every v1 key's bytes match the pre-boot snapshot (I1 spy shows no writes).
2. Run boot twice: still 4 v2 jobs.
3. Kill the boot between the job write and the marker write: the next boot repairs the marker and adds no fifth job.
4. Make `setItem` throw quota on the 3rd copy: 2 copied, the 3rd key is absent, the message names 2 of 4, and the v1 archive download imports cleanly into the v1 `importArchive`.
5. Old app (94d6345 jobs.js/core.js loaded in the test) on storage holding v2 jobs: `scan().jobs` has only v1 jobs, the count stays under the cap, and Recover lists no v2 keys.
6. Old `parseBackup` on a v2 backup: refused with "schemaVersion: expected 1". Old `validateArchive` on a v2 archive: refused with "made by a newer version of this app".
7. A v2 job with an interior wall, tagged schemaVersion 1 by hand: the new import and copy paths refuse it with the disguise message, and no job is created.
8. Edit a copied job in the old app (new v1 hash): the next new-app boot gives an offer, not a copy. Accepting adds one job and refusing adds none.
9. Old-tab v1 catalogue lock held for longer than the wait: the copy is skipped with the notice, and nothing is written.
10. The v1 and v2 all-jobs archives both import. A second import of the same archive adds 0.
11. Mixed module build strings: read-only banner, no `setItem` at all.
12. Round trip: walls, zones, routes, face items, face sketches and pins survive save, reopen, single backup and archive, compared by `canonicalV2`.
